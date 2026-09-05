'use strict';

const crypto = require('node:crypto');

const PHOTO_LIMIT = 200;
function text(value, limit) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit) : '';
}
function safeUrl(value, kind) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (kind === 'image' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) &&
        url.pathname.startsWith('/wikipedia/commons/') && /\.jpe?g$/i.test(url.pathname)) {
      url.search = ''; return url.href;
    }
    if (kind === 'source' && url.hostname === 'commons.wikimedia.org' && url.pathname.startsWith('/wiki/File:')) return url.href;
    if (kind === 'license' && url.hostname === 'creativecommons.org' &&
        /^\/(?:licenses\/by(?:-sa)?\/[1-4]\.0|licenses\/by(?:-sa)?\/2\.5|publicdomain\/(?:zero|mark)\/1\.0)\/?$/.test(url.pathname)) return url.href;
  } catch { /* Ignore untrusted persisted metadata. */ }
  return '';
}
function sanitizePhotos(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.slice(0, PHOTO_LIMIT).map(photo => {
    if (!photo || typeof photo !== 'object') return null;
    const id = text(photo.id, 120), label = text(photo.label, 160), author = text(photo.author, 240);
    const imageUrl = safeUrl(photo.imageUrl, 'image'), sourceUrl = safeUrl(photo.sourceUrl, 'source');
    const licenseUrl = safeUrl(photo.licenseUrl, 'license'), license = text(photo.license, 40);
    if (!id || !label || !author || !imageUrl || !sourceUrl || !licenseUrl ||
        !/^(?:CC BY(?:-SA)? [1-4]\.[05]|CC0|Public domain)$/i.test(license) || seen.has(id)) return null;
    seen.add(id);
    return { id, label, country: text(photo.country, 100), author, imageUrl, sourceUrl, license, licenseUrl,
      position: typeof photo.position === 'string' && /^\d{1,3}% \d{1,3}%$/.test(photo.position) ? photo.position : '50% 50%' };
  }).filter(Boolean);
}
function clamp(value, minimum, maximum, fallback) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

// Host-side validation for both workspaceState and messages from this webview.
// Only wallpaper metadata and bounded playback values cross the boundary.
function sanitizeWebviewState(raw) {
  if (!raw || raw.version !== 1 || typeof raw !== 'object') return null;
  let catalog = null, playback = null;
  if (raw.catalog?.version === 1 && Number.isFinite(raw.catalog.fetchedAt) &&
      raw.catalog.fetchedAt >= 0 && raw.catalog.fetchedAt <= Date.now()) {
    const photos = sanitizePhotos(raw.catalog.photos);
    if (photos.length) catalog = { version: 1, fetchedAt: raw.catalog.fetchedAt,
      requestedCount: Math.round(clamp(raw.catalog.requestedCount, 1, PHOTO_LIMIT, photos.length)), photos };
  }
  if (raw.playback?.version === 1) {
    const photos = sanitizePhotos(raw.playback.photos), ids = new Set(photos.map(photo => photo.id));
    if (photos.length) playback = { version: 1, photos,
      currentId: ids.has(raw.playback.currentId) ? raw.playback.currentId : null,
      bagIds: Array.isArray(raw.playback.bagIds) ? [...new Set(raw.playback.bagIds.slice(0, PHOTO_LIMIT))].filter(id => ids.has(id)) : [],
      seenKeys: Array.isArray(raw.playback.seenKeys) ? [...new Set(raw.playback.seenKeys.slice(0, 400)
        .filter(key => typeof key === 'string' && key.length <= 2048))] : [],
      paused: raw.playback.paused === true, remaining: clamp(raw.playback.remaining, 0, 1440 * 60_000, 600_000) };
  }
  return catalog || playback ? { version: 1, catalog, playback } : null;
}

function getWebviewOptions(vscode, context) {
  return { enableScripts: true, localResourceRoots: [
    vscode.Uri.joinPath(context.extensionUri, 'runtime'), vscode.Uri.joinPath(context.extensionUri, 'media')
  ] };
}

function createWebviewHtml(vscode, context, webview, config, seedPhotos, initialState) {
  const nonce = crypto.randomBytes(24).toString('base64');
  const escape = value => String(value).replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const resource = (...parts) => escape(webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, ...parts)).toString());
  const japanese = vscode.env.language?.toLowerCase().startsWith('ja');
  const data = JSON.stringify({ config: { enabled: true, source: 'wikimedia',
    intervalMinutes: clamp(config?.intervalMinutes, 1, 1440, 10), brightness: clamp(config?.brightness, 0, 1, .78),
    showCaption: config?.showCaption !== false, refreshHours: clamp(config?.refreshHours, 1, 168, 24),
    targetPhotoCount: Math.round(clamp(config?.targetPhotoCount, 1, PHOTO_LIMIT, 60)) },
    photos: sanitizePhotos(seedPhotos), state: sanitizeWebviewState(initialState)
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; img-src https://upload.wikimedia.org https://thumb.wikimedia.org; connect-src https://commons.wikimedia.org; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'`;
  return `<!DOCTYPE html>
<html lang="${japanese ? 'ja' : 'en'}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escape(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="no-referrer">
<title>Ocean Window</title>
<link rel="stylesheet" href="${resource('runtime', 'src', 'ocean-window.css')}">
<link rel="stylesheet" href="${resource('media', 'webview.css')}">
</head>
<body>
<main class="monaco-workbench"><div class="part editor"><div class="content"><div class="editor-group-container empty">
<p class="ocean-loading" role="status">${japanese ? '海の写真を読み込んでいます…' : 'Finding your next ocean…'}</p>
</div></div></div></main>
<script id="ocean-window-data" type="application/json" nonce="${nonce}">${data}</script>
<script nonce="${nonce}" src="${resource('runtime', 'src', 'wikimedia-source.js')}"></script>
<script nonce="${nonce}" src="${resource('media', 'webview-bootstrap.js')}"></script>
<script nonce="${nonce}" src="${resource('runtime', 'src', 'ocean-window.js')}"></script>
</body>
</html>`;
}

module.exports = { createWebviewHtml, getWebviewOptions, sanitizeWebviewState };
