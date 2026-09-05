'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const RECEIPT_STATES = new Set(['pending-enable', 'enabled', 'pending-disable', 'disabled']);
const CONSENT_KEY = 'oceanWindow.patchConsentVersion';
const DEFAULTS = { intervalMinutes: 10, brightness: 0.78, showCaption: true, refreshHours: 24, targetPhotoCount: 60 };

function validateReceipts(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.installs)) throw new Error('Unrecognized Ocean Window install receipt.');
  for (const entry of value.installs) {
    if (!entry || typeof entry.appRoot !== 'string' || !path.isAbsolute(entry.appRoot) ||
        typeof entry.sourceRoot !== 'string' || !path.isAbsolute(entry.sourceRoot) ||
        !RECEIPT_STATES.has(entry.state) || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) {
      throw new Error('Invalid Ocean Window install receipt entry.');
    }
  }
  if (new Set(value.installs.map(entry => entry.appRoot)).size !== value.installs.length) throw new Error('Duplicate Ocean Window install receipt.');
  return value;
}

async function readReceipt(file, fileSystem = fs) {
  try {
    const stat = await fileSystem.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ocean Window install receipt must be a regular file.');
    return validateReceipts(JSON.parse(await fileSystem.readFile(file, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, installs: [] };
    throw error;
  }
}

async function atomicReceipt(file, receipt, fileSystem = fs) {
  validateReceipts(receipt);
  await fileSystem.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fileSystem.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fileSystem.rename(temporary, file);
  } finally {
    if (handle) await handle.close();
    await fileSystem.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function mergeReceipts(...receipts) {
  const entries = new Map();
  for (const receipt of receipts) {
    for (const entry of receipt.installs) {
      const previous = entries.get(entry.appRoot);
      if (!previous || Date.parse(entry.updatedAt) >= Date.parse(previous.updatedAt)) entries.set(entry.appRoot, entry);
    }
  }
  return { schemaVersion: 1, installs: [...entries.values()].sort((a, b) => a.appRoot.localeCompare(b.appRoot)) };
}

function createController(vscode, context, dependencies = {}) {
  const fileSystem = dependencies.fs || fs;
  const processKill = dependencies.processKill || process.kill.bind(process);
  const loadInstaller = dependencies.loadInstaller || (() => import(pathToFileURL(path.join(context.extensionPath, 'runtime', 'tools', 'install.mjs')).href));
  const japanese = vscode.env.language?.toLowerCase().startsWith('ja');
  const local = (en, ja) => japanese ? ja : en;
  const sourceRoot = path.join(context.extensionPath, 'runtime');
  const appRoot = vscode.env.appRoot;
  // Desktop UI hosts can expose local user data with the vscode-userdata scheme.
  // VS Code maps that provider to the same native path (also exposed through
  // ExtensionContext.globalStoragePath); require the local UI host explicitly.
  const desktop = vscode.env.uiKind === vscode.UIKind.Desktop && context.extension.extensionKind === vscode.ExtensionKind.UI &&
    typeof appRoot === 'string' && path.isAbsolute(appRoot) &&
    ['file', 'vscode-userdata'].includes(context.globalStorageUri.scheme) &&
    typeof context.globalStorageUri.fsPath === 'string' && path.isAbsolute(context.globalStorageUri.fsPath);
  const extensionId = context.extension.id;
  if (!/^[a-z0-9][a-z0-9.-]+$/i.test(extensionId)) throw new Error('Invalid extension identifier.');
  const registryDirectory = path.join(path.dirname(context.extensionPath), '.ocean-window');
  const sharedReceipt = path.join(registryDirectory, `${extensionId}.json`);
  const storageReceipt = path.join(context.globalStorageUri.fsPath, 'install-receipts.json');
  const lockPath = `${sharedReceipt}.lock`;
  const output = vscode.window.createOutputChannel('Ocean Window');
  const disposables = [output];
  let queue = Promise.resolve();
  let disposed = false;
  let settingsNoticePending = false;

  function log(value) { output.appendLine(typeof value === 'string' ? value : JSON.stringify(value, null, 2)); }
  function serialize(operation) {
    const result = queue.then(() => disposed ? undefined : operation());
    queue = result.catch(() => {});
    return result;
  }
  function notify(show, onChoice = () => {}, onSettled = () => {}) {
    // VS Code's nonmodal notification promise stays pending until dismissal.
    // Never put that wait in the command queue or extension shutdown path.
    let pending;
    try { pending = show(); }
    catch (error) { log(`Notification: ${error.message}`); onSettled(); return; }
    void Promise.resolve(pending)
      .then(choice => disposed ? undefined : onChoice(choice))
      .catch(error => log(`Notification action: ${error.message}`))
      .finally(onSettled);
  }
  function reportError(error) {
    log(error.stack || error.message || String(error));
    notify(() => vscode.window.showErrorMessage(local('Ocean Window could not complete the operation: ', 'Ocean Window の操作を完了できませんでした: ') + error.message));
  }
  function command(operation) { return () => serialize(operation).catch(reportError); }
  function requireDesktop() {
    if (!desktop) throw new Error(local('This feature requires the local desktop edition of VS Code.', 'この機能はローカルのデスクトップ版 VS Code で利用できます。'));
  }
  async function receipts() {
    return mergeReceipts(await readReceipt(storageReceipt, fileSystem), await readReceipt(sharedReceipt, fileSystem));
  }
  async function saveReceipts(receipt) {
    // The sibling registry survives extension upgrades, even when the upgraded
    // extension is uninstalled before it has ever activated.
    await atomicReceipt(storageReceipt, receipt, fileSystem);
    await atomicReceipt(sharedReceipt, receipt, fileSystem);
  }
  async function saveState(state) {
    const receipt = await receipts();
    const previous = receipt.installs.find(entry => entry.appRoot === appRoot);
    const timestamp = Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0);
    receipt.installs = receipt.installs.filter(entry => entry.appRoot !== appRoot);
    receipt.installs.push({ appRoot, sourceRoot, state, updatedAt: new Date(timestamp).toISOString() });
    await saveReceipts(receipt);
  }
  async function withReceiptLock(operation) {
    // Multiple VS Code windows share this registry. Refuse concurrent
    // receipt changes; the installer separately protects its native HTML writes.
    await fileSystem.mkdir(registryDirectory, { recursive: true });
    const registryStat = await fileSystem.lstat(registryDirectory);
    if (!registryStat.isDirectory() || registryStat.isSymbolicLink()) throw new Error('Ocean Window receipt registry must be a regular directory.');
    let handle;
    const lockText = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token: crypto.randomUUID() });
    for (let attempt = 0; attempt < 2; attempt++) {
      try { handle = await fileSystem.open(lockPath, 'wx', 0o600); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const stat = await fileSystem.lstat(lockPath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Ocean Window receipt lock must be a regular file.');
        const oldText = await fileSystem.readFile(lockPath, 'utf8');
        let lock;
        try { lock = JSON.parse(oldText); } catch { throw new Error('Unrecognized Ocean Window receipt lock.'); }
        if (!Number.isInteger(lock.pid) || lock.pid <= 0) throw new Error('Unrecognized Ocean Window receipt lock.');
        let alive = true;
        try { processKill(lock.pid, 0); } catch (probeError) { if (probeError.code === 'ESRCH') alive = false; }
        if (alive || attempt > 0) throw new Error(local('Another Ocean Window operation is active. Retry when it finishes.', '別の Ocean Window 操作が実行中です。終了後に再実行してください。'));
        if (await fileSystem.readFile(lockPath, 'utf8') !== oldText) throw new Error('Ocean Window receipt lock changed; retry the operation.');
        await fileSystem.unlink(lockPath);
      }
    }
    if (!handle) throw new Error('Unable to acquire Ocean Window receipt lock.');
    try {
      await handle.writeFile(lockText);
      await handle.close();
      return await operation();
    } finally {
      await handle.close().catch(() => {});
      if (await fileSystem.readFile(lockPath, 'utf8').catch(() => '') === lockText) await fileSystem.unlink(lockPath);
    }
  }
  function config() {
    const settings = vscode.workspace.getConfiguration('oceanWindow');
    return { enabled: true, source: 'wikimedia', ...Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, settings.get(key, fallback)])) };
  }
  async function inspect() {
    requireDesktop();
    const { runInstall } = await loadInstaller();
    return runInstall({ sourceRoot, appRoot, skipDist: true, uninstall: true, dryRun: true });
  }
  function offerReload(report) {
    log(report);
    if (report.warnings?.length) {
      output.show(true);
      notify(() => vscode.window.showWarningMessage(local('Ocean Window completed with cleanup notes. See the Ocean Window output.', 'Ocean Window の処理は完了しました。後片付けの注意点を出力に記録しました。')));
    }
    if (!report.reloadRequired) {
      notify(() => vscode.window.showInformationMessage(local('Ocean Window is already restored.', 'Ocean Window はすでに元に戻っています。')));
      return;
    }
    const reload = local('Reload Window', 'ウィンドウの再読み込み');
    const message = report.action === 'uninstall'
      ? local('Ocean Window was restored. Reload this window when your current work is ready. Reload other open windows to remove the scenery there too.', 'Ocean Window を元に戻しました。作業が落ち着いたらウィンドウを再読み込みしてください。他のウィンドウも再読み込みすると海が消えます。')
      : local('Ocean Window is ready. Reload this window when your current work is ready. Other windows using this VS Code installation will also show it after reloading.', 'Ocean Window の準備ができました。作業が落ち着いたらウィンドウを再読み込みしてください。同じ VS Code の他のウィンドウにも再読み込み後に反映されます。');
    notify(() => vscode.window.showInformationMessage(message, reload), choice => {
      if (choice === reload) return vscode.commands.executeCommand('workbench.action.reloadWindow');
    });
  }
  async function enable() {
    requireDesktop();
    if (context.globalState.get(CONSENT_KEY) !== 1) {
      const accept = local('Enable Ocean Window', 'Ocean Window を有効にする');
      const choice = await vscode.window.showWarningMessage(
        local('Ocean Window changes VS Code application files to place scenery in the empty editor area.', 'Ocean Window は空のエディターに海を映すため、VS Code 本体のファイルを変更します。'),
        { modal: true, detail: local(
          'This is an unsupported customization, so VS Code may report that its installation appears corrupt. It affects every window using this VS Code installation. Updates can remove it; apply again after an update. Use Restore before disabling or uninstalling this extension. Nothing is changed until you choose Enable, and reloads are always your choice.',
          '非公式のカスタマイズのため、VS Code が整合性の警告を表示することがあります。同じ VS Code 本体を使うすべてのウィンドウに適用されます。更新で解除された場合は再適用してください。拡張機能の無効化・削除の前に「元に戻す」を実行してください。有効化するまで本体は変更されず、再読み込みも手動です。') }, accept);
      if (choice !== accept) return;
      await context.globalState.update(CONSENT_KEY, 1);
    }
    const report = await withReceiptLock(async () => {
      const { runInstall } = await loadInstaller();
      const options = { sourceRoot, appRoot, skipDist: true, configOverride: config() };
      const plan = await runInstall({ ...options, dryRun: true });
      log(plan);
      await saveState('pending-enable');
      const result = await runInstall(options);
      await saveState('enabled');
      await context.globalState.update('oceanWindow.enabled', true);
      return result;
    });
    offerReload(report);
    return report;
  }
  async function disable() {
    requireDesktop();
    const report = await withReceiptLock(async () => {
      const { runInstall } = await loadInstaller();
      const options = { sourceRoot, appRoot, skipDist: true, uninstall: true };
      log(await runInstall({ ...options, dryRun: true }));
      await saveState('pending-disable');
      const result = await runInstall(options);
      await saveState('disabled');
      await context.globalState.update('oceanWindow.enabled', false);
      return result;
    });
    offerReload(report);
    return report;
  }
  async function status() {
    const report = await inspect();
    log(report);
    output.show(true);
    notify(() => vscode.window.showInformationMessage(report.previouslyInstalled
      ? local('Ocean Window is applied to this VS Code installation. A window reload is needed after applying or restoring it.', 'この VS Code 本体には Ocean Window が適用されています。適用・復元した後はウィンドウの再読み込みが必要です。')
      : local('Ocean Window is not applied to this VS Code installation.', 'この VS Code 本体には Ocean Window が適用されていません。')));
    return report;
  }
  async function startup() {
    if (!desktop) return;
    const receipt = await withReceiptLock(async () => {
      const found = await receipts();
      if (found.installs.length) await saveReceipts(found);
      return found;
    });
    const own = receipt.installs.find(entry => entry.appRoot === appRoot);
    // Windows updates can move resources/app into a new versioned directory.
    // A profile that explicitly enabled Ocean Window may receive a passive
    // reapply notice there, without adopting or modifying the new installation.
    const prior = context.globalState.get('oceanWindow.enabled') === true
      ? receipt.installs.filter(entry => entry.state === 'enabled' || entry.state === 'pending-enable')
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
      : undefined;
    const evidence = own || prior;
    if (!evidence || evidence.state === 'disabled' || evidence.state === 'pending-disable') return;
    const report = await inspect();
    log(report);
    if (report.previouslyInstalled) return;
    const noticeKey = `${vscode.version || 'unknown'}:${appRoot}:${evidence.updatedAt}`;
    if (context.globalState.get('oceanWindow.missingNotice') === noticeKey) return;
    await context.globalState.update('oceanWindow.missingNotice', noticeKey);
    const apply = local('Enable / Apply', '有効化 / 再適用');
    notify(() => vscode.window.showInformationMessage(local(
      'Ocean Window is no longer applied, possibly after a VS Code update. Reapply when convenient.',
      'Ocean Window の適用が解除されています。VS Code の更新後などに起こります。都合のよいときに再適用してください。'), apply), choice => {
      if (choice === apply) return command(enable)();
    });
  }
  async function onSettingsChange(event) {
    if (!event.affectsConfiguration('oceanWindow') || settingsNoticePending || !desktop) return;
    const own = (await receipts()).installs.find(entry => entry.appRoot === appRoot);
    if (!own || own.state === 'disabled') return;
    settingsNoticePending = true;
    const apply = local('Apply Settings', '設定を適用');
    notify(() => vscode.window.showInformationMessage(local(
      'Ocean Window settings changed. Apply them when convenient; a window reload is needed afterward.',
      'Ocean Window の設定が変わりました。都合のよいときに適用してください。その後にウィンドウの再読み込みが必要です。'), apply), choice => {
      if (choice === apply) return command(enable)();
    }, () => { settingsNoticePending = false; });
  }

  function register() {
    for (const [id, action] of Object.entries({
      enable, disable, status,
      openSettings: () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:' + context.extension.id),
      openGuide: () => vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'README.md'))
    })) disposables.push(vscode.commands.registerCommand(`oceanWindow.${id}`, command(action)));
    disposables.push(vscode.workspace.onDidChangeConfiguration(event => { void serialize(() => onSettingsChange(event)).catch(reportError); }));
    context.subscriptions.push(...disposables);
    // Activation never changes VS Code application files and must not fail other
    // extensions just because a receipt or the current app is inaccessible.
    return serialize(startup).catch(error => log(`Startup check: ${error.message}`));
  }
  return { register, enable: command(enable), disable: command(disable), status: command(status),
    drain: () => queue, dispose: () => { disposed = true; for (const item of disposables) item.dispose(); } };
}

let activeController;
function activate(context) {
  activeController = createController(require('vscode'), context);
  return activeController.register();
}
async function deactivate() {
  if (activeController) {
    await activeController.drain();
    activeController.dispose();
    activeController = undefined;
  }
}

module.exports = { activate, deactivate, createController, validateReceipts, mergeReceipts };
