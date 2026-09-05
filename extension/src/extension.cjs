'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createWebviewHtml, getWebviewOptions, sanitizeWebviewState } = require('./webview.cjs');
const { createMigration } = require('./migration.cjs');
const VIEW_TYPE = 'oceanWindow.scene';
const ENABLED_KEY = 'oceanWindow.webviewEnabled';
const STATE_KEY = 'oceanWindow.webviewState';
const DEFAULTS = { intervalMinutes: 10, brightness: .78, showCaption: true, refreshHours: 24, targetPhotoCount: 60 };

function isOceanTab(tab) {
  // Released desktop builds expose the internal main-thread prefix in TabInputWebview.
  return [VIEW_TYPE, `mainThreadWebview-${VIEW_TYPE}`].includes(tab?.input?.viewType);
}
function createController(vscode, context, dependencies = {}) {
  const output = vscode.window.createOutputChannel('Ocean Window');
  const migration = dependencies.migration || createMigration(vscode, context);
  const local = (en, ja) => vscode.env.language?.startsWith('ja') ? ja : en;
  const panels = new Set(), dismissed = new Set(), disposables = [output];
  let enabled = context.workspaceState.get(ENABLED_KEY, true);
  let sceneState = sanitizeWebviewState(context.workspaceState.get(STATE_KEY));
  let disposed = false, pending = false, running = null, seeds;
  let stateWrites = Promise.resolve(), nativePresent = false;
  const logError = error => output.appendLine(String(error?.stack || error));
  function writeState(key, value) {
    stateWrites = stateWrites.then(() => context.workspaceState.update(key, value)).catch(logError);
    return stateWrites;
  }
  function settings() {
    const config = vscode.workspace.getConfiguration('oceanWindow');
    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, config.get(key, value)]));
  }
  function groupOf(record) {
    return vscode.window.tabGroups.all.find(group => group.viewColumn === record.panel.viewColumn) || record.group;
  }
  function close(record) { record.automatic = true; record.panel.dispose(); }
  function render(record) {
    record.panel.webview.html = createWebviewHtml(vscode, context, record.panel.webview, settings(), seeds, sceneState);
  }
  function create(group) {
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Ocean Window',
      { viewColumn: group.viewColumn, preserveFocus: true },
      { ...getWebviewOptions(vscode, context), retainContextWhenHidden: false });
    const record = { panel, group, automatic: false };
    panels.add(record);
    panel.onDidDispose(() => {
      panels.delete(record);
      // VS Code marks the panel disposed before this event; its getters can throw.
      if (!disposed && !record.automatic) dismissed.add(record.group);
      schedule();
    });
    panel.onDidChangeViewState(() => { record.group = groupOf(record); schedule(); });
    panel.webview.onDidReceiveMessage(message => {
      if (disposed || !panels.has(record) || message?.type !== 'oceanWindow.state') return;
      const valid = sanitizeWebviewState(message.state);
      if (valid) { sceneState = valid; void writeState(STATE_KEY, valid); }
    });
    render(record);
  }
  async function reconcile() {
    if (!seeds) seeds = await (dependencies.loadSeeds?.() || fs.readFile(
      path.join(context.extensionPath, 'runtime', 'assets', 'photos.json'), 'utf8').then(JSON.parse));
    if (disposed) return;
    const groups = vscode.window.tabGroups.all;
    for (const group of dismissed) if (!groups.includes(group)) dismissed.delete(group);
    for (const record of [...panels]) {
      const group = groupOf(record); record.group = group;
      if (!enabled || !groups.includes(group) || group.tabs.some(tab => !isOceanTab(tab))) close(record);
    }
    if (!enabled) return;
    for (const group of groups) {
      if (group.tabs.some(tab => !isOceanTab(tab))) { dismissed.delete(group); continue; }
      const own = [...panels].filter(record => groupOf(record) === group);
      for (const duplicate of own.slice(1)) close(duplicate);
      if (!own.length && !dismissed.has(group) && group.tabs.length === 0) create(group);
    }
  }
  function schedule() {
    if (disposed) return;
    pending = true;
    if (!running) running = Promise.resolve().then(async () => {
      while (pending && !disposed) { pending = false; await reconcile(); }
    }).catch(logError).finally(() => { running = null; if (pending && !disposed) schedule(); });
    return running;
  }
  async function drain() { while (running) await running; await stateWrites; }
  async function enable() {
    enabled = true; dismissed.clear();
    await writeState(ENABLED_KEY, true); schedule(); await drain();
  }
  async function disable() {
    enabled = false;
    await writeState(ENABLED_KEY, false); schedule(); await drain();
    if (nativePresent) void vscode.window.showInformationMessage(local(
      'Ocean Window is off. An older native wallpaper remains; use Restore Legacy Native Wallpaper to remove it.',
      '海の表示を停止しました。旧方式の壁紙が残っています。「旧方式の壁紙を解除」で元に戻せます。'));
  }
  async function restoreLegacy() {
    try {
      const result = await migration.restore(); nativePresent = false;
      if (result.reloadRequired) {
        const reload = local('Reload Window', 'ウィンドウを再読み込み');
        void vscode.window.showInformationMessage(local(
          'The legacy wallpaper was restored. Reload once to finish switching to the standard extension.',
          '旧方式の壁紙を解除しました。一度再読み込みすると新方式への切り替えが完了します。'), reload)
          .then(choice => choice === reload && vscode.commands.executeCommand('workbench.action.reloadWindow'));
      } else void vscode.window.showInformationMessage(local('No legacy wallpaper remains.', '旧方式の壁紙は残っていません。'));
      return result;
    } catch (error) {
      logError(error);
      void vscode.window.showErrorMessage(local('Legacy wallpaper cleanup failed: ', '旧方式の壁紙を解除できませんでした: ') + error.message);
    }
  }
  function status() {
    const result = { enabled, scenes: panels.size, mode: 'webview', legacyWallpaper: nativePresent };
    output.appendLine(JSON.stringify(result));
    void vscode.window.showInformationMessage(local(
      `Ocean Window: ${enabled ? 'on' : 'off'}; ${panels.size} empty editor scene(s).`,
      `Ocean Window: ${enabled ? '表示オン' : '表示オフ'}、空きエリア ${panels.size} か所。`));
    return result;
  }
  function register() {
    for (const [command, handler] of Object.entries({ enable, disable, status, restoreLegacy,
      openSettings: () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:zeusu-sato.ocean-window'),
      openGuide: () => vscode.env.openExternal(vscode.Uri.parse('https://github.com/zeusu-sato/ocean-window#readme'))
    })) disposables.push(vscode.commands.registerCommand(`oceanWindow.${command}`, handler));
    disposables.push(vscode.window.tabGroups.onDidChangeTabs(event => {
      for (const tab of [...event.opened, ...event.closed, ...event.changed]) if (!isOceanTab(tab)) dismissed.delete(tab.group);
      schedule();
    }), vscode.window.tabGroups.onDidChangeTabGroups(() => schedule()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('oceanWindow')) for (const record of panels) render(record);
    }));
    schedule();
    // Read-only detection never gates the standard renderer, including EACCES installs.
    Promise.resolve().then(() => migration.inspect()).then(result => {
      if (disposed || !result.changed) return;
      nativePresent = true;
      const restore = local('Restore Legacy Native Wallpaper', '旧方式の壁紙を解除');
      void vscode.window.showInformationMessage(local(
        'Ocean Window now uses a standard editor tab. A wallpaper from the old version remains in this VS Code installation.',
        'Ocean Window は標準のエディタータブ方式になりました。この VS Code には旧方式の壁紙が残っています。'), restore)
        .then(choice => choice === restore && !disposed && restoreLegacy());
    }).catch(logError);
    return api;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const record of [...panels]) close(record);
    for (const disposable of disposables) disposable.dispose();
    migration.dispose();
  }
  const api = { register, enable, disable, status, restoreLegacy, drain, dispose };
  return api;
}
let controller;
function activate(context) {
  controller = createController(require('vscode'), context).register();
  context.subscriptions.push(controller);
}
async function deactivate() {
  const current = controller;
  controller = undefined;
  current?.dispose();
  await current?.drain();
}
module.exports = { activate, deactivate, createController, isOceanTab, VIEW_TYPE, ENABLED_KEY, STATE_KEY };
