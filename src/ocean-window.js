/* Empty editor scenery. Wikimedia HTTPS images use Chromium's normal HTTP cache. */
(() => {
  'use strict';
  if (globalThis.__oceanWindow) return;
  const config = globalThis.__oceanWindowConfig || {};
  if (config.enabled === false || !Array.isArray(config.photos) || !config.photos.length) return;
  const cached = globalThis.__oceanSource?.getCached(config) || [];
  let photos = (cached.length ? cached : config.photos).filter(photo => photo.imageUrl && photo.id);
  if (!photos.length) return;
  const interval = Math.max(1, Number(config.intervalMinutes) || 10) * 60_000;
  const brightness = Number.isFinite(config.brightness) ? Math.min(1, Math.max(0, config.brightness)) : .78;
  const groupSelector = '.monaco-workbench .part.editor .editor-group-container';
  const groups = new Map();
  const failed = new Set();
  let failedUntil = 0;
  let observer;
  let waiting;
  let disposed = false;
  let refreshing = false;
  let lastRefresh = 0;
  function photoKey(photo) {
    try { return decodeURIComponent(new URL(photo.sourceUrl).pathname).replaceAll('_', ' '); }
    catch { return photo.id; }
  }

  async function refreshPhotos() {
    if (!globalThis.__oceanSource || refreshing || Date.now() - lastRefresh < 60_000) return;
    refreshing = true;
    lastRefresh = Date.now();
    try {
      const incoming = await globalThis.__oceanSource.load(config);
      if (disposed || !incoming.length) return;
      const known = new Set(photos.map(photoKey));
      photos = incoming;
      for (const state of groups.values()) {
        const queued = new Set(state.bag.map(photoKey));
        state.bag.push(...shuffled(incoming.filter(photo => !known.has(photoKey(photo)) && !queued.has(photoKey(photo)) && !state.seen.has(photoKey(photo)))));
      }
    } catch { /* Retain the current picture if the provider is unavailable. */ }
    finally { refreshing = false; }
  }

  function shuffled(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function iconButton(label, path) {
    const button = element('button', 'ow-button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    button.append(svg);
    return button;
  }

  function addGroup(group) {
    if (groups.has(group)) return;
    const surface = element('div', 'ocean-window');
    surface.style.setProperty('--ow-brightness', String(brightness));
    surface.dataset.ready = 'false';
    surface.setAttribute('role', 'region');
    surface.setAttribute('aria-label', '世界の海');
    const layers = [element('img', 'ow-scene'), element('img', 'ow-scene')];
    for (const layer of layers) { layer.alt = ''; layer.draggable = false; }
    const footer = element('div', 'ow-footer');
    const place = element('div', 'ow-place');
    const country = element('div', 'ow-country');
    if (config.showCaption === false) { place.hidden = true; country.hidden = true; }
    const controls = element('div', 'ow-controls');
    const next = iconButton('次の海へ', 'M3 4v12l8-6z M14 4v12');
    const pause = iconButton('自動切り替えを一時停止', 'M7 4v12 M13 4v12');
    const info = iconButton('写真の出典', 'M10 9v6 M10 5v1 M10 1a9 9 0 1 0 0 18a9 9 0 0 0 0-18');
    const credit = element('div', 'ow-credit');
    info.setAttribute('aria-expanded', 'false');
    controls.append(next, pause, info);
    footer.append(place, country, controls, credit);
    surface.append(...layers, footer);
    const state = { group, surface, layers, footer, place, country, credit, bag: [], current: null,
      layer: 0, paused: false, busy: false, timer: null, due: 0, remaining: interval, generation: 0, seen: new Set() };
    groups.set(group, state);
    group.append(surface);
    next.addEventListener('click', event => { event.stopPropagation(); change(state); });
    pause.addEventListener('click', event => {
      event.stopPropagation();
      state.paused = !state.paused;
      pause.setAttribute('aria-pressed', String(state.paused));
      const label = state.paused ? '自動切り替えを再開' : '自動切り替えを一時停止';
      pause.title = label;
      pause.setAttribute('aria-label', label);
      pause.querySelector('path').setAttribute('d', state.paused ? 'M5 3v14l11-7z' : 'M7 4v12 M13 4v12');
      sync(state);
    });
    info.addEventListener('click', event => {
      event.stopPropagation();
      const open = credit.dataset.open !== 'true';
      credit.dataset.open = String(open);
      info.setAttribute('aria-expanded', String(open));
    });
    // Observe only group class, never editor text, selection or chat contents.
    state.observer = new MutationObserver(() => sync(state));
    state.observer.observe(group, { attributes: true, attributeFilter: ['class'] });
    state.resizeObserver = new ResizeObserver(() => sync(state));
    state.resizeObserver.observe(group);
    sync(state);
  }

  function visible(state) {
    return !disposed && state.group.isConnected && state.group.classList.contains('empty') && !document.hidden &&
      state.group.getBoundingClientRect().width > 0 && state.group.getBoundingClientRect().height > 0 &&
      state.group.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  }

  function stopTimer(state) {
    if (state.timer !== null) {
      state.remaining = Math.max(0, state.due - Date.now());
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function sync(state) {
    if (!visible(state)) {
      stopTimer(state);
      state.surface.inert = true;
      return;
    }
    state.surface.inert = false;
    if (!state.current && !state.busy) { change(state); return; }
    if (state.paused) { stopTimer(state); return; }
    if (!state.busy && state.timer === null && state.current) {
      state.due = Date.now() + state.remaining;
      state.timer = setTimeout(() => { state.timer = null; change(state); }, state.remaining);
    }
  }

  function takePhoto(state) {
    if (failed.size && Date.now() >= failedUntil) failed.clear();
    state.bag = state.bag.filter(photo => !failed.has(photo.id));
    if (!state.bag.length) {
      state.seen.clear();
      state.bag = shuffled(photos.filter(photo => !failed.has(photo.id)));
      if (state.bag.length > 1 && state.current && photoKey(state.bag[0]) === photoKey(state.current)) {
        [state.bag[0], state.bag[1]] = [state.bag[1], state.bag[0]];
      }
    }
    const photo = state.bag.shift();
    if (photo) state.seen.add(photoKey(photo));
    return photo;
  }

  function link(text, url) {
    const a = element('a', '', text);
    // Attribution metadata is plain text and only HTTPS links are accepted.
    if (typeof url === 'string' && url.startsWith('https://')) a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  async function change(state) {
    if (state.busy || !visible(state)) return;
    refreshPhotos();
    stopTimer(state);
    const photo = takePhoto(state);
    if (!photo) {
      // Retry a temporary outage later; never remove the previously displayed picture.
      if (!state.paused) {
        state.remaining = Math.max(60_000, failedUntil - Date.now());
        state.due = Date.now() + state.remaining;
        state.timer = setTimeout(() => { state.timer = null; change(state); }, state.remaining);
      }
      return;
    }
    state.busy = true;
    const generation = ++state.generation;
    const image = new Image();
    const source = photo.imageUrl;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Photo load timeout')), 15_000);
        image.onload = () => { clearTimeout(timeout); resolve(); };
        image.onerror = () => { clearTimeout(timeout); reject(new Error('Photo unavailable')); };
        image.src = source;
      });
      if (disposed || !state.group.isConnected || generation !== state.generation) return;
      const active = 1 - state.layer;
      const layer = state.layers[active];
      layer.src = source;
      layer.style.objectPosition = photo.position || '50% 50%';
      layer.dataset.visible = 'true';
      state.layers[state.layer].dataset.visible = 'false';
      state.layer = active;
      state.current = photo;
      state.surface.dataset.photo = photo.id;
      state.surface.dataset.ready = 'true';
      state.place.textContent = photo.label;
      state.country.textContent = photo.country || '';
      state.credit.replaceChildren(
        link('写真', photo.sourceUrl), document.createTextNode(` · ${photo.author || ''} · `),
        link(photo.license || '', photo.licenseUrl)
      );
      state.remaining = interval;
    } catch {
      failed.add(photo.id);
      failedUntil = Date.now() + 15 * 60_000;
    } finally {
      state.busy = false;
      if (!disposed && state.group.isConnected) {
        if (failed.has(photo.id) && failed.size < photos.length) change(state);
        else sync(state);
      }
    }
  }

  function scan() {
    for (const [group, state] of groups) {
      if (!group.isConnected) { stopTimer(state); state.generation++; state.observer.disconnect(); state.resizeObserver.disconnect(); groups.delete(group); }
    }
    document.querySelectorAll(groupSelector).forEach(addGroup);
  }

  function start() {
    if (disposed) return;
    const editor = document.querySelector('.monaco-workbench .part.editor > .content');
    if (!editor) { waiting = setTimeout(start, 300); return; }
    scan();
    observer = new MutationObserver(records => {
      // Workbench split/group changes only. Ignore our image/caption DOM and Monaco line updates.
      const changed = records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && !node.closest?.('.ocean-window') &&
        (node.matches('.editor-group-container') || node.querySelector('.editor-group-container'))));
      if (changed) scan();
    });
    observer.observe(editor, { childList: true, subtree: true });
  }

  const visibilityChanged = () => groups.forEach(sync);
  document.addEventListener('visibilitychange', visibilityChanged);
  const api = {
    dispose() {
      disposed = true;
      clearTimeout(waiting);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', visibilityChanged);
      for (const state of groups.values()) { stopTimer(state); state.observer.disconnect(); state.resizeObserver.disconnect(); state.surface.remove(); }
      groups.clear();
      delete globalThis.__oceanWindow;
    },
    // Diagnostics contain only wallpaper state; never workspace or editor data.
    status() { return [...groups.values()].map(s => ({ photo: s.current?.id, visible: visible(s), paused: s.paused,
      timerActive: s.timer !== null, remaining: s.remaining })); }
  };
  globalThis.__oceanWindow = api;
  start();
})();
