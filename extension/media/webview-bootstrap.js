/* Bridge wallpaper-only state to the standard VS Code webview API. */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const data = JSON.parse(document.getElementById('ocean-window-data').textContent);
  const initial = vscode.getState() || data.state;
  globalThis.__oceanWindowConfig = { ...data.config, photos: globalThis.__oceanSource.normalizePhotos(data.photos) };
  if (initial?.version === 1) {
    globalThis.__oceanSource.importCache(initial.catalog);
    globalThis.__oceanWindowInitialState = initial.playback;
  }
  let queued = false;
  let previous = '';
  function persist() {
    queued = false;
    const playback = globalThis.__oceanWindow?.exportState();
    if (!playback) return;
    const state = { version: 1, catalog: globalThis.__oceanSource.exportCache(), playback };
    const encoded = JSON.stringify(state);
    if (encoded === previous) return;
    previous = encoded;
    vscode.setState(state);
    vscode.postMessage({ type: 'oceanWindow.state', state });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(persist);
  }
  globalThis.addEventListener('ocean-window-state-change', schedule);
  globalThis.addEventListener('ocean-window-catalog-change', schedule);
  globalThis.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
})();
