'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createMigration } = require('../src/migration.cjs');

async function fixture(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'ocean-migration-test-'));
  const extensionPath = path.join(directory, 'extensions', 'test.ocean-window-0.3.0');
  const storagePath = path.join(directory, 'storage');
  await fs.mkdir(extensionPath, { recursive: true });
  const state = new Map([['oceanWindow.enabled', true]]);
  const context = {
    extensionPath, extension: { id: 'test.ocean-window', extensionKind: 1 },
    globalStorageUri: { scheme: 'file', fsPath: storagePath }, subscriptions: [],
    globalState: { get: key => state.get(key), update: async (key, value) => state.set(key, value) }
  };
  let outputCount = 0;
  const vscode = {
    UIKind: { Desktop: 1 }, ExtensionKind: { UI: 1 },
    env: { uiKind: 1, language: 'en', appRoot: path.join(directory, 'app') },
    commands: { registerCommand: () => assert.fail('legacy commands must not be registered') },
    workspace: { onDidChangeConfiguration: () => assert.fail('legacy settings listeners must not be registered') },
    window: {
      createOutputChannel: () => { outputCount++; return { appendLine() {}, dispose() {} }; },
      showInformationMessage: () => assert.fail('migration does not display legacy notifications'),
      showWarningMessage: () => assert.fail('migration does not request native enable consent'),
      showErrorMessage: () => assert.fail('migration propagates errors to the new controller')
    }
  };
  const calls = [];
  let installed = !!options.installed;
  const migration = createMigration(vscode, context, { loadInstaller: async () => ({
    runInstall: async args => {
      calls.push(args);
      await options.onInstall?.(args);
      const changed = installed;
      if (!args.dryRun) installed = false;
      return { ok: true, action: 'uninstall', changed, previouslyInstalled: changed,
        dryRun: !!args.dryRun, reloadRequired: !args.dryRun && changed, warnings: [] };
    }
  }) });
  const registry = path.join(path.dirname(extensionPath), '.ocean-window', 'test.ocean-window.json');
  const storage = path.join(storagePath, 'install-receipts.json');
  async function writeReceipts(entries = [{}]) {
    const receipt = { schemaVersion: 1, installs: entries.map(entry => ({
      appRoot: vscode.env.appRoot, sourceRoot: path.join(directory, 'old-extension', 'runtime'),
      state: 'enabled', updatedAt: '2026-09-05T00:00:00.000Z', ...entry
    })) };
    for (const file of [registry, storage]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(receipt));
    }
  }
  t.after(async () => {
    migration.dispose();
    assert.equal(path.dirname(await fs.realpath(directory)), parent);
    assert.ok(path.basename(directory).startsWith('ocean-migration-test-'));
    await fs.rm(directory, { recursive: true });
  });
  return { migration, context, vscode, directory, calls, state, registry, storage, writeReceipts,
    get outputCount() { return outputCount; }, read: file => fs.readFile(file, 'utf8').then(JSON.parse) };
}

test('constructing migration is inert; inspection reads only the current app without receipt writes', async t => {
  const f = await fixture(t, { installed: true });
  assert.equal(f.outputCount, 0);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.migration.inspect()).changed, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].dryRun, true);
  assert.equal(f.calls[0].appRoot, f.vscode.env.appRoot);
  assert.equal(f.context.subscriptions.length, 0);
  await assert.rejects(fs.stat(path.dirname(f.registry)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(f.context.globalStorageUri.fsPath), { code: 'ENOENT' });
});

test('failed first enable on a clean read-only app retires only its receipt without native writes', async t => {
  const f = await fixture(t, { onInstall: args => assert.equal(args.dryRun, true) });
  const otherAppRoot = path.join(f.directory, 'other-app');
  await f.writeReceipts([{ state: 'pending-enable' }, { appRoot: otherAppRoot }]);
  const result = await f.migration.restore();
  assert.equal(result.changed, false);
  assert.equal(result.reloadRequired, false);
  assert.equal(f.calls.length, 1);
  const receipt = await f.read(f.registry);
  assert.equal(receipt.installs.find(entry => entry.appRoot === f.vscode.env.appRoot).state, 'disabled');
  assert.equal(receipt.installs.find(entry => entry.appRoot === otherAppRoot).state, 'enabled');
  assert.deepEqual(receipt, await f.read(f.storage));
  assert.equal(f.state.get('oceanWindow.enabled'), true, 'legacy cleanup must preserve the new scene state');
});

test('manual patch without a receipt restores only the current app and preserves new scene state', async t => {
  const f = await fixture(t, { installed: true });
  const report = await f.migration.restore();
  assert.equal(report.reloadRequired, true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].dryRun, true);
  assert.equal(f.calls[1].dryRun, undefined);
  assert.ok(f.calls.every(call => call.appRoot === f.vscode.env.appRoot && call.uninstall && call.skipDist));
  assert.equal((await f.read(f.registry)).installs[0].state, 'disabled');
  assert.equal(f.state.get('oceanWindow.enabled'), true);
});

test('clean app without an old receipt creates no ownership record and requires no reload', async t => {
  const f = await fixture(t);
  assert.equal((await f.migration.restore()).reloadRequired, false);
  assert.ok(f.calls.every(call => call.dryRun));
  await assert.rejects(fs.stat(f.registry), { code: 'ENOENT' });
  await assert.rejects(fs.stat(f.storage), { code: 'ENOENT' });
});

test('failed explicit restoration propagates its error and retains recovery ownership', async t => {
  const f = await fixture(t, { installed: true, onInstall: args => {
    if (!args.dryRun) throw Object.assign(new Error('read-only legacy app'), { code: 'EACCES' });
  } });
  await f.writeReceipts();
  await assert.rejects(f.migration.restore(), /read-only legacy app/);
  assert.equal((await f.read(f.registry)).installs[0].state, 'pending-disable');
  assert.equal(f.state.get('oceanWindow.enabled'), true);
  await assert.rejects(fs.stat(`${f.registry}.lock`), { code: 'ENOENT' });
});

test('invalid receipts prevent an explicit native restore before mutation', async t => {
  const f = await fixture(t, { installed: true });
  await f.writeReceipts([{ appRoot: '../untrusted' }]);
  await assert.rejects(f.migration.restore(), /Invalid Ocean Window install receipt entry/);
  assert.ok(f.calls.every(call => call.dryRun));
});
