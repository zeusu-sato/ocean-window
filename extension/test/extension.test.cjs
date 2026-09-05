'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, isOceanTab, ENABLED_KEY } = require('../src/extension.cjs');
function event() {
  const listeners = new Set();
  return { subscribe(fn) { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
    fire(value) { for (const listener of listeners) listener(value); } };
}
function fixture({ occupied = false, enabled = true, inspectError = false } = {}) {
  const tabs = event(), groups = event(), config = event(), commands = new Map(), state = new Map([[ENABLED_KEY, enabled]]);
  const group = { viewColumn: 1, tabs: [] }, panels = [], calls = [];
  if (occupied) group.tabs.push({ group, input: { uri: 'initial.md' } });
  const vscode = {
    env: { language: 'en' }, Uri: { joinPath: (uri, ...parts) => ({ toString: () => `https://local.test/${parts.join('/')}` }) },
    commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: (...args) => calls.push(args) },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => key === 'brightness' ? fixture.brightness ?? fallback : fallback }), onDidChangeConfiguration: config.subscribe },
    window: {
      tabGroups: { all: [group], onDidChangeTabs: tabs.subscribe, onDidChangeTabGroups: groups.subscribe },
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      showInformationMessage: async () => undefined, showErrorMessage: async () => undefined,
      createWebviewPanel(type, title, position) {
        assert.equal(position.preserveFocus, true);
        const disposed = event(), changed = event(), messages = event();
        const target = vscode.window.tabGroups.all.find(g => g.viewColumn === position.viewColumn);
        const tab = { group: target, input: { viewType: `mainThreadWebview-${type}` } };
        target.tabs.push(tab);
        const panel = { get viewColumn() { if (panel.closed) throw new Error('Webview is disposed'); return position.viewColumn; }, closed: false, tab,
          webview: { html: '', cspSource: 'https://local.test', asWebviewUri: uri => uri, onDidReceiveMessage: messages.subscribe },
          onDidDispose: disposed.subscribe, onDidChangeViewState: changed.subscribe,
          dispose() {
            if (panel.closed) return;
            panel.closed = true;
            target.tabs.splice(target.tabs.indexOf(tab), 1);
            disposed.fire(); tabs.fire({ opened: [], closed: [tab], changed: [] });
          }
        };
        panels.push(panel); tabs.fire({ opened: [tab], closed: [], changed: [] }); return panel;
      }
    }
  };
  const context = { extensionPath: '/extension', extensionUri: {}, workspaceState: {
    get: (key, fallback) => state.has(key) ? state.get(key) : fallback,
    update: async (key, value) => { state.set(key, value); }
  } };
  let restores = 0;
  const controller = createController(vscode, context, {
    loadSeeds: async () => [], migration: {
      inspect: async () => { if (inspectError) throw new Error('EACCES'); return { changed: false }; },
      restore: async () => { restores++; return { reloadRequired: false }; }, dispose() {}
    }
  }).register();
  function open(input = { uri: 'file.md' }, target = group) {
    const tab = { group: target, input }; target.tabs.push(tab);
    tabs.fire({ opened: [tab], closed: [], changed: [] }); return tab;
  }
  function close(tab) {
    tab.group.tabs.splice(tab.group.tabs.indexOf(tab), 1);
    tabs.fire({ opened: [], closed: [tab], changed: [] });
  }
  return { controller, vscode, panels, group, open, close, state, commands, config, calls, groups,
    get restores() { return restores; } };
}
test('fresh empty editor opens automatically without native writes, restore, or reload', async t => {
  const f = fixture({ inspectError: true }); t.after(() => f.controller.dispose());
  await f.controller.drain();
  assert.equal(f.panels.length, 1); assert.equal(f.restores, 0); assert.deepEqual(f.calls, []);
  assert.match(f.panels[0].webview.html, /Finding your next ocean/);
});
test('every real editor kind closes the scene and last-file close brings it back', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.drain();
  for (const input of [{ uri: 'code.js' }, { viewType: 'markdown.preview' }, { viewType: 'imagePreview' }, { original: 'a', modified: 'b' }, { notebookType: 'jupyter' }]) {
    const file = f.open(input); await f.controller.drain();
    assert.equal(f.group.tabs.filter(isOceanTab).length, 0);
    assert.equal(f.group.tabs.length, 1);
    f.close(file); await f.controller.drain(); assert.equal(f.group.tabs.filter(isOceanTab).length, 1);
  }
});
test('existing open file is never replaced on activation or enable', async t => {
  const f = fixture({ occupied: true }); t.after(() => f.controller.dispose());
  await f.controller.drain(); await f.controller.enable();
  assert.equal(f.panels.length, 0); assert.equal(f.group.tabs[0].input.uri, 'initial.md');
});
test('manual scene close stays dismissed until a file lifecycle or Show command', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.drain();
  f.panels[0].dispose(); await f.controller.drain();
  f.groups.fire({}); await f.controller.drain(); assert.equal(f.group.tabs.length, 0);
  const file = f.open(); await f.controller.drain(); f.close(file); await f.controller.drain();
  assert.equal(f.group.tabs.filter(isOceanTab).length, 1);
  f.panels.at(-1).dispose(); await f.controller.drain(); await f.controller.enable();
  assert.equal(f.group.tabs.filter(isOceanTab).length, 1);
});
test('disable persists without changing files; enable resumes immediately', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.drain();
  await f.controller.disable(); assert.equal(f.state.get(ENABLED_KEY), false); assert.equal(f.group.tabs.length, 0);
  const file = f.open(); await f.controller.drain(); f.close(file); await f.controller.drain();
  assert.equal(f.group.tabs.length, 0); await f.controller.enable(); assert.equal(f.group.tabs.length, 1);
  assert.deepEqual(f.calls, []); assert.equal(f.restores, 0);
});
test('saved disabled state remains off on activation', async t => {
  const f = fixture({ enabled: false }); t.after(() => f.controller.dispose()); await f.controller.drain();
  assert.equal(f.panels.length, 0);
});
test('only empty split groups receive a scene and settings apply without reload', async t => {
  const f = fixture({ occupied: true }); t.after(() => { delete fixture.brightness; f.controller.dispose(); });
  const split = { viewColumn: 2, tabs: [] }; f.vscode.window.tabGroups.all.push(split); f.groups.fire({});
  await f.controller.drain(); assert.equal(f.panels.length, 1); assert.equal(f.panels[0].viewColumn, 2);
  fixture.brightness = .35; f.config.fire({ affectsConfiguration: () => true });
  assert.match(f.panels[0].webview.html, /"brightness":0.35/); assert.deepEqual(f.calls, []);
});
test('legacy cleanup is available only through the explicit command', async t => {
  const f = fixture(); t.after(() => f.controller.dispose()); await f.controller.drain();
  assert.equal(f.restores, 0); await f.commands.get('oceanWindow.restoreLegacy')();
  assert.equal(f.restores, 1); assert.deepEqual(f.calls, []);
});
test('view type matching never mistakes other extensions for Ocean Window', () => {
  assert.equal(isOceanTab({ input: { viewType: 'mainThreadWebview-oceanWindow.scene' } }), true);
  assert.equal(isOceanTab({ input: { viewType: 'oceanWindow.scene' } }), true);
  assert.equal(isOceanTab({ input: { viewType: 'other.oceanWindow.scene' } }), false);
});
