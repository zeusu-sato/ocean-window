const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.activate = function activate(context) {
  const bridge = process.env.OCEAN_SMOKE_BRIDGE;
  if (!bridge || !path.isAbsolute(bridge) || !/^ow-webview-[A-Za-z0-9]+$/.test(path.basename(bridge))) throw new Error('Private smoke bridge required');
  let lastId;
  let busy = false;
  function snapshot() {
    return {
      platform: process.platform, architecture: process.arch, uid: process.getuid?.(),
      appRoot: vscode.env.appRoot, oceanActive: vscode.extensions.getExtension('zeusu-sato.ocean-window')?.isActive,
      activeEditor: vscode.window.activeTextEditor?.document.uri.fsPath,
      groups: vscode.window.tabGroups.all.map(group => ({
        column: group.viewColumn, active: group.isActive,
        tabs: group.tabs.map(tab => ({ label: tab.label, active: tab.isActive, preview: tab.isPreview, viewType: tab.input?.viewType, uri: tab.input?.uri?.fsPath }))
      }))
    };
  }
  async function act(request) {
    if (request.operation === 'state') return snapshot();
    if (request.operation === 'command') {
      if (!['oceanWindow.enable', 'oceanWindow.disable', 'oceanWindow.status', 'oceanWindow.openSettings', 'workbench.action.closeAllEditors', 'workbench.action.chat.open'].includes(request.command)) throw new Error('Command not permitted');
      await vscode.commands.executeCommand(request.command);
    } else if (request.operation === 'open') {
      const file = path.resolve(request.file);
      if (!file.startsWith(path.join(bridge, 'fixtures') + path.sep)) throw new Error('Only smoke fixtures may be opened');
      if (request.kind === 'text') await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)), { preview: false });
      else await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file), { preview: false });
    } else if (request.operation === 'closeOcean') {
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => String(tab.input?.viewType).endsWith('oceanWindow.scene'));
      await vscode.window.tabGroups.close(tabs, true);
    } else if (request.operation === 'config') {
      if (!['brightness', 'showCaption', 'intervalMinutes'].includes(request.key)) throw new Error('Setting not permitted');
      await vscode.workspace.getConfiguration('oceanWindow').update(request.key, request.value, vscode.ConfigurationTarget.Global);
    } else throw new Error('Operation not permitted');
    return snapshot();
  }
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const request = JSON.parse(await fs.readFile(path.join(bridge, 'request.json'), 'utf8'));
      if (request.id === lastId) return;
      lastId = request.id;
      let response;
      try { response = { id: request.id, value: await act(request) }; }
      catch (error) { response = { id: request.id, error: String(error.stack || error) }; }
      await fs.writeFile(path.join(bridge, 'response.pending.json'), JSON.stringify(response));
      await fs.rename(path.join(bridge, 'response.pending.json'), path.join(bridge, 'response.json'));
    } catch (error) { if (error.code !== 'ENOENT') console.error(error); }
    finally { busy = false; }
  }, 50);
  context.subscriptions.push({ dispose() { clearInterval(timer); } });
};
