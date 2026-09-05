'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createController, validateReceipts } = require('../src/extension.cjs');

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocean-extension-test-'));
  const extensionPath = path.join(directory, 'extensions', 'test.ocean-window-0.1.0');
  const storagePath = path.join(directory, 'storage');
  await fs.mkdir(extensionPath, { recursive: true });
  const commands = new Map();
  const calls = [];
  const messages = [];
  const execution = [];
  const lines = [];
  const state = new Map(Object.entries(options.state || {}));
  let settingsCallback;
  let installed = Boolean(options.installed);
  let activeCalls = 0;
  let maximumActive = 0;
  const context = {
    extensionPath, extensionUri: { fsPath: extensionPath, scheme: 'file' },
    extension: { id: 'test.ocean-window', extensionKind: options.extensionKind ?? 1 },
    globalStorageUri: { fsPath: storagePath, scheme: options.storageScheme || 'file' }, subscriptions: [],
    globalState: { get: key => state.get(key), update: async (key, value) => { state.set(key, value); } }
  };
  const vscode = {
    version: '1.101.0', UIKind: { Desktop: 1, Web: 2 }, ExtensionKind: { UI: 1, Workspace: 2 },
    env: { uiKind: options.web ? 2 : 1, appRoot: path.join(directory, 'VSCode', 'resources', 'app'), language: options.language || 'en' },
    Uri: { joinPath: (uri, ...parts) => ({ scheme: uri.scheme, fsPath: path.join(uri.fsPath, ...parts) }) },
    commands: {
      registerCommand: (id, action) => { commands.set(id, action); return { dispose() {} }; },
      executeCommand: async (...args) => { execution.push(args); }
    },
    workspace: {
      getConfiguration: section => { assert.equal(section, 'oceanWindow'); return { get: (key, fallback) => options.config?.[key] ?? fallback }; },
      onDidChangeConfiguration: callback => { settingsCallback = callback; return { dispose() {} }; }
    },
    window: {
      createOutputChannel: () => ({ appendLine: line => lines.push(line), show() {}, dispose() {} }),
      showWarningMessage: async (message, ...args) => {
        messages.push({ kind: 'warning', message, args });
        if (args[0]?.modal) return options.consent === false ? undefined : args[1];
      },
      showInformationMessage: async (message, ...args) => {
        messages.push({ kind: 'info', message, args });
        return options.informationChoice?.(message, args);
      },
      showErrorMessage: async message => { messages.push({ kind: 'error', message }); }
    }
  };
  const registry = path.join(directory, 'extensions', '.ocean-window', 'test.ocean-window.json');
  const storage = path.join(storagePath, 'install-receipts.json');
  const loader = async () => ({
    runInstall: async args => {
      calls.push(args);
      activeCalls++;
      maximumActive = Math.max(maximumActive, activeCalls);
      try {
        await options.onInstall?.(args, { registry, storage });
        const previous = installed;
        if (!args.dryRun) installed = !args.uninstall;
        return { ok: true, action: args.uninstall ? 'uninstall' : 'install', dryRun: Boolean(args.dryRun),
          previouslyInstalled: previous, changed: previous || !args.uninstall,
          reloadRequired: args.dryRun ? undefined : previous || !args.uninstall, warnings: [] };
      } finally { activeCalls--; }
    }
  });
  const controller = createController(vscode, context, { loadInstaller: loader,
    ...(options.fs ? { fs: options.fs } : {}), ...(options.processKill ? { processKill: options.processKill } : {}) });
  t.after(async () => {
    await controller.drain();
    controller.dispose();
    assert.equal(path.dirname(directory), os.tmpdir());
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function writeReceipt(file, entry) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, installs: [{
      appRoot: vscode.env.appRoot, sourceRoot: path.join(extensionPath, 'runtime'),
      state: 'enabled', updatedAt: '2026-09-05T00:00:00.000Z', ...entry
    }] }));
  }
  return { controller, context, vscode, calls, messages, execution, lines, state, registry, storage, commands,
    get installed() { return installed; }, get maximumActive() { return maximumActive; },
    writeReceipt, readReceipt: async file => JSON.parse(await fs.readFile(file, 'utf8')),
    changeSettings: async (affects = true) => { settingsCallback({ affectsConfiguration: () => affects }); await controller.drain(); },
    errors: () => messages.filter(message => message.kind === 'error'),
    mutations: () => calls.filter(call => !call.dryRun) };
}

test('fresh activation registers commands without patching or prompting', async t => {
  const f = await fixture(t);
  await f.controller.register();
  assert.deepEqual([...f.commands.keys()], ['oceanWindow.enable', 'oceanWindow.disable', 'oceanWindow.status', 'oceanWindow.openSettings', 'oceanWindow.openGuide']);
  assert.equal(f.calls.length, 0);
  assert.equal(f.messages.length, 0);
  assert.equal(f.execution.length, 0);
});

test('declining initial opt-in leaves native files and receipts alone', async t => {
  const f = await fixture(t, { consent: false });
  await f.controller.enable();
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.has('oceanWindow.patchConsentVersion'), false);
  await assert.rejects(fs.stat(f.registry), { code: 'ENOENT' });
  assert.match(f.messages[0].args[0].detail, /installation appears corrupt/);
});

test('enable dry-runs, saves pending recovery receipts, applies bounded settings, then marks enabled', async t => {
  let pendingChecked = false;
  const f = await fixture(t, {
    config: { intervalMinutes: 31, brightness: 0.61, showCaption: false, refreshHours: 48, targetPhotoCount: 90, source: 'arbitrary', appRoot: 'arbitrary' },
    onInstall: async (args, paths) => {
      if (!args.dryRun) {
        for (const file of [paths.registry, paths.storage]) {
          const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
          assert.equal(receipt.installs[0].state, 'pending-enable');
        }
        pendingChecked = true;
      }
    }
  });
  await f.controller.enable();
  assert.equal(pendingChecked, true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].dryRun, true);
  assert.deepEqual(f.calls[1].configOverride, { enabled: true, source: 'wikimedia', intervalMinutes: 31, brightness: 0.61, showCaption: false, refreshHours: 48, targetPhotoCount: 90 });
  assert.equal(f.calls[1].appRoot, f.vscode.env.appRoot);
  assert.equal(f.calls[1].sourceRoot, path.join(f.context.extensionPath, 'runtime'));
  assert.equal(f.calls[1].skipDist, true);
  assert.equal((await f.readReceipt(f.registry)).installs[0].state, 'enabled');
  assert.deepEqual(await f.readReceipt(f.registry), await f.readReceipt(f.storage));
  assert.equal(f.execution.length, 0, 'must never reload automatically');
  assert.equal(f.errors().length, 0);
});

test('restore saves pending-disable before uninstall, disables receipt, and only reloads on action', async t => {
  const f = await fixture(t, { installed: true,
    informationChoice: (message, choices) => message.includes('was restored') ? choices[0] : undefined,
    onInstall: async (args, paths) => {
      if (!args.dryRun) assert.equal(JSON.parse(await fs.readFile(paths.registry, 'utf8')).installs[0].state, 'pending-disable');
    }
  });
  await f.controller.disable();
  assert.ok(f.calls.every(call => call.uninstall));
  assert.equal((await f.readReceipt(f.registry)).installs[0].state, 'disabled');
  assert.equal(f.installed, false);
  assert.equal(f.messages.filter(message => message.kind === 'warning').length, 0);
  assert.deepEqual(f.execution, [['workbench.action.reloadWindow']]);
});

test('installer dry-run failure stops before recording ownership or changing native files', async t => {
  const f = await fixture(t, { onInstall: async args => { if (args.dryRun) throw new Error('Unknown workbench structure'); } });
  await f.controller.enable();
  assert.equal(f.mutations().length, 0);
  assert.match(f.errors()[0].message, /Unknown workbench structure/);
  await assert.rejects(fs.stat(f.registry), { code: 'ENOENT' });
});

test('native mutation failure retains pending receipts for recovery', async t => {
  const f = await fixture(t, { onInstall: async args => { if (!args.dryRun) throw new Error('File is locked'); } });
  await f.controller.enable();
  assert.equal((await f.readReceipt(f.registry)).installs[0].state, 'pending-enable');
  assert.equal((await f.readReceipt(f.storage)).installs[0].state, 'pending-enable');
  assert.equal(f.state.get('oceanWindow.enabled'), undefined);
  assert.match(f.errors()[0].message, /File is locked/);
  await assert.rejects(fs.stat(`${f.registry}.lock`), { code: 'ENOENT' });
});

test('receipt persistence failure aborts before native mutation', async t => {
  const rejectingFs = Object.create(fs);
  rejectingFs.rename = async (from, to) => {
    if (path.basename(to) === 'test.ocean-window.json') throw new Error('Receipt store is read-only');
    return fs.rename(from, to);
  };
  const f = await fixture(t, { fs: rejectingFs });
  await f.controller.enable();
  assert.equal(f.mutations().length, 0);
  assert.match(f.errors()[0].message, /Receipt store is read-only/);
});

test('simultaneous enable and restore serialize and ask initial consent only once', async t => {
  const f = await fixture(t, { onInstall: async () => { await new Promise(resolve => setTimeout(resolve, 5)); } });
  await Promise.all([f.controller.enable(), f.controller.disable(), f.controller.enable()]);
  assert.equal(f.maximumActive, 1);
  assert.deepEqual(f.mutations().map(call => Boolean(call.uninstall)), [false, true, false]);
  assert.equal(f.messages.filter(message => message.args?.[0]?.modal).length, 1);
  assert.equal((await f.readReceipt(f.registry)).installs[0].state, 'enabled');
});

test('web host refuses native operations without asking consent', async t => {
  const f = await fixture(t, { web: true });
  await f.controller.register();
  await f.controller.enable();
  await f.controller.disable();
  assert.equal(f.calls.length, 0);
  assert.equal(f.messages.filter(message => message.kind === 'warning').length, 0);
  assert.equal(f.errors().length, 2);
});

test('Japanese native permission errors explain a writable Linux installation without changing permissions', async t => {
  const f = await fixture(t, { language: 'ja', onInstall: async () => {
    throw Object.assign(new Error('Native access denied'), { code: 'EROFS', appRoot: '/snap/code-insiders/current/resources/app',
      oceanWindowNativeAccessError: true, cause: new Error('Read-only file system') });
  } });
  await f.controller.enable();
  assert.equal(f.mutations().length, 0);
  assert.match(f.errors()[0].message, /読み取り専用/);
  assert.match(f.errors()[0].message, /\.tar\.gz/);
  assert.match(f.errors()[0].message, /権限は自動変更しません/);
  assert.equal(f.execution.length, 0);
});

test('desktop UI host accepts the current vscode-userdata scheme backed by an absolute local path', async t => {
  const f = await fixture(t, { storageScheme: 'vscode-userdata' });
  await f.controller.register();
  await f.controller.enable();
  assert.equal(f.mutations().length, 1);
  assert.equal((await f.readReceipt(f.storage)).installs[0].state, 'enabled');
  assert.equal(f.errors().length, 0);
});

test('workspace extension hosts cannot use native customization even with desktop UI and a file path', async t => {
  const f = await fixture(t, { extensionKind: 2 });
  await f.controller.register();
  await f.controller.enable();
  assert.equal(f.calls.length, 0);
  assert.equal(f.messages.filter(message => message.kind === 'warning').length, 0);
  assert.equal(f.errors().length, 1);
});

test('unknown storage URI schemes remain unsupported in a desktop UI host', async t => {
  const f = await fixture(t, { storageScheme: 'vscode-remote' });
  await f.controller.register();
  await f.controller.enable();
  assert.equal(f.calls.length, 0);
  assert.equal(f.errors().length, 1);
});

test('settings changes never silently patch an existing installation', async t => {
  const f = await fixture(t, { installed: true });
  await f.writeReceipt(f.registry);
  await f.controller.register();
  await f.changeSettings();
  assert.equal(f.mutations().length, 0);
  assert.ok(f.messages.some(message => message.message.includes('settings changed')));
});

test('undismissed nonmodal notifications do not block restore, settings, status, or queue drain', { timeout: 2000 }, async t => {
  const f = await fixture(t, { informationChoice: () => new Promise(() => {}) });
  await f.controller.register();
  const enableReport = await f.controller.enable();
  assert.equal(enableReport.action, 'install');
  await f.changeSettings();
  await f.commands.get('oceanWindow.openSettings')();
  await f.controller.status();
  const restoreReport = await f.controller.disable();
  await f.controller.drain();
  assert.equal(restoreReport.action, 'uninstall');
  assert.deepEqual(f.mutations().map(call => Boolean(call.uninstall)), [false, true]);
  assert.ok(f.messages.some(message => message.message.includes('settings changed')));
  assert.deepEqual(f.execution, [['workbench.action.openSettings', '@ext:test.ocean-window']]);
  assert.equal((await f.readReceipt(f.registry)).installs[0].state, 'disabled');
});

test('an undismissed update notice does not block activation or an explicit restore', { timeout: 2000 }, async t => {
  const f = await fixture(t, { informationChoice: () => new Promise(() => {}) });
  await f.writeReceipt(f.registry);
  await f.controller.register();
  assert.ok(f.messages.some(message => message.message.includes('no longer applied')));
  await f.controller.disable();
  await f.controller.drain();
  assert.equal(f.mutations().length, 1);
  assert.equal(f.mutations()[0].uninstall, true);
});

test('settings apply action starts a new serialized command after its notification resolves', { timeout: 2000 }, async t => {
  let chooseApply;
  const f = await fixture(t, { installed: true, state: { 'oceanWindow.patchConsentVersion': 1 },
    informationChoice: (message, choices) => message.includes('settings changed')
      ? new Promise(resolve => { chooseApply = () => resolve(choices[0]); }) : undefined });
  await f.writeReceipt(f.registry);
  await f.controller.register();
  await f.changeSettings();
  assert.equal(f.mutations().length, 0);
  chooseApply();
  await new Promise(resolve => setImmediate(resolve));
  await f.controller.drain();
  assert.equal(f.mutations().length, 1);
  assert.equal(Boolean(f.mutations()[0].uninstall), false);
});

test('post-update startup uses stable ownership and gives only one passive reapply notice', async t => {
  const f = await fixture(t);
  await f.writeReceipt(f.registry);
  await f.controller.register();
  await f.controller.register();
  assert.equal(f.mutations().length, 0);
  assert.equal(f.messages.filter(message => message.message.includes('no longer applied')).length, 1);
  assert.equal((await f.readReceipt(f.storage)).installs[0].state, 'enabled');
});

test('a changed appRoot after updating prompts a previously enabled profile without adopting the new installation', async t => {
  const f = await fixture(t, { state: { 'oceanWindow.enabled': true } });
  const previousAppRoot = path.join(path.dirname(f.vscode.env.appRoot), 'previous-version', 'app');
  await f.writeReceipt(f.registry, { appRoot: previousAppRoot });
  await f.controller.register();
  await f.controller.register();
  assert.equal(f.mutations().length, 0);
  assert.ok(f.calls.every(call => call.dryRun && call.appRoot === f.vscode.env.appRoot));
  assert.equal(f.messages.filter(message => message.message.includes('no longer applied')).length, 1);
  assert.deepEqual((await f.readReceipt(f.registry)).installs.map(entry => entry.appRoot), [previousAppRoot]);
});

test('another installation receipt does not prompt a profile that never enabled Ocean Window', async t => {
  const f = await fixture(t);
  await f.writeReceipt(f.registry, { appRoot: path.join(path.dirname(f.vscode.env.appRoot), 'other-installation', 'app') });
  await f.controller.register();
  assert.equal(f.calls.length, 0);
  assert.equal(f.messages.length, 0);
});

test('an explicit restored receipt for the current appRoot suppresses a stale enabled profile flag', async t => {
  const f = await fixture(t, { state: { 'oceanWindow.enabled': true } });
  await f.writeReceipt(f.registry, { state: 'disabled' });
  await f.controller.register();
  assert.equal(f.calls.length, 0);
  assert.equal(f.messages.length, 0);
});

test('startup chooses newest disabled receipt so an old profile cannot reactivate ownership', async t => {
  const f = await fixture(t);
  await f.writeReceipt(f.storage, { updatedAt: '2026-09-05T00:00:00.000Z' });
  await f.writeReceipt(f.registry, { state: 'disabled', updatedAt: '2026-09-05T00:00:01.000Z' });
  await f.controller.register();
  assert.equal(f.calls.length, 0);
  assert.equal((await f.readReceipt(f.storage)).installs[0].state, 'disabled');
});

test('existing receipt lock prevents concurrent native mutation', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.registry), { recursive: true });
  await fs.writeFile(`${f.registry}.lock`, JSON.stringify({ pid: process.pid }));
  await f.controller.enable();
  assert.equal(f.calls.length, 0);
  assert.match(f.errors()[0].message, /Another Ocean Window operation/);
  assert.equal(JSON.parse(await fs.readFile(`${f.registry}.lock`, 'utf8')).pid, process.pid);
});

test('only a proven dead process permits reclaiming a stale receipt lock', async t => {
  const f = await fixture(t, { processKill: (pid, signal) => {
    assert.equal(pid, 321);
    assert.equal(signal, 0);
    throw Object.assign(new Error('no process'), { code: 'ESRCH' });
  } });
  await fs.mkdir(path.dirname(f.registry), { recursive: true });
  await fs.writeFile(`${f.registry}.lock`, JSON.stringify({ pid: 321, createdAt: '2026-09-05T00:00:00Z' }));
  await f.controller.enable();
  assert.equal(f.mutations().length, 1);
  assert.equal(f.errors().length, 0);
  await assert.rejects(fs.stat(`${f.registry}.lock`), { code: 'ENOENT' });
});

test('process permission errors preserve an existing receipt lock', async t => {
  const f = await fixture(t, { processKill: () => { throw Object.assign(new Error('no permission'), { code: 'EPERM' }); } });
  await fs.mkdir(path.dirname(f.registry), { recursive: true });
  await fs.writeFile(`${f.registry}.lock`, JSON.stringify({ pid: 321 }));
  await f.controller.enable();
  assert.equal(f.mutations().length, 0);
  assert.equal(JSON.parse(await fs.readFile(`${f.registry}.lock`, 'utf8')).pid, 321);
});

test('malformed ownership is rejected without running installer mutations', async t => {
  assert.throws(() => validateReceipts({ schemaVersion: 1, installs: [{ appRoot: '../outside', sourceRoot: '/runtime', state: 'enabled', updatedAt: '2026-09-05' }] }), /Invalid/);
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.registry), { recursive: true });
  await fs.writeFile(f.registry, '{invalid');
  await f.controller.enable();
  assert.equal(f.mutations().length, 0);
  assert.equal(f.errors().length, 1);
});

test('settings and guide commands use the installed extension identity and package README', async t => {
  const f = await fixture(t, { language: 'ja' });
  await f.controller.register();
  await f.commands.get('oceanWindow.openSettings')();
  await f.commands.get('oceanWindow.openGuide')();
  assert.deepEqual(f.execution[0], ['workbench.action.openSettings', '@ext:test.ocean-window']);
  assert.equal(f.execution[1][0], 'markdown.showPreview');
  assert.equal(f.execution[1][1].fsPath, path.join(f.context.extensionPath, 'README.md'));
});
