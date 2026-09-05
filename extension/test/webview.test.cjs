'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createWebviewHtml, getWebviewOptions, sanitizeWebviewState } = require('../src/webview.cjs');
const seeds = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../../assets/photos.json'), 'utf8'));

test('webview state rejects unknown hosts and bounds playback references and metadata', () => {
  const raw = { version: 1, secret: 'not persisted', catalog: { version: 1, fetchedAt: Date.now(),
    requestedCount: 900, photos: [seeds[0], { ...seeds[1], imageUrl: 'https://example.com/track.jpg' }] },
  playback: { version: 1, photos: seeds, currentId: 'missing', bagIds: [seeds[1].id, 'missing', seeds[1].id],
    seenKeys: ['known', 'known', 123, 'x'.repeat(2049)], paused: 'true', remaining: -50 } };
  const state = sanitizeWebviewState(raw);
  assert.equal(state.secret, undefined);
  assert.equal(state.catalog.photos.length, 1);
  assert.equal(state.catalog.requestedCount, 200);
  assert.equal(state.playback.currentId, null);
  assert.deepEqual(state.playback.bagIds, [seeds[1].id]);
  assert.deepEqual(state.playback.seenKeys, ['known']);
  assert.equal(state.playback.paused, false);
  assert.equal(state.playback.remaining, 0);
  for (const imageUrl of ['javascript:alert(1)', 'https://thumb.wikimedia.org.evil.test/wikipedia/commons/a.jpg',
    'https://user@upload.wikimedia.org/wikipedia/commons/a.jpg', 'https://upload.wikimedia.org/wikipedia/commons/a.svg']) {
    assert.equal(sanitizeWebviewState({ version: 1, playback: { version: 1, photos: [{ ...seeds[0], imageUrl }] } }), null);
  }
  assert.equal(sanitizeWebviewState({ version: 1, catalog: { version: 1, fetchedAt: Date.now() + 10000, photos: seeds } }), null);
});

test('generated webview has isolated local roots, strict CSP, external scripts, and escaped JSON', () => {
  const vscode = { Uri: { joinPath: (base, ...parts) => `${base}/${parts.join('/')}` }, env: { language: 'en' } };
  const context = { extensionUri: 'extension-root' };
  const webview = { cspSource: 'https://resources.example', asWebviewUri: uri => `https://resources.example/${uri}` };
  assert.deepEqual(getWebviewOptions(vscode, context), { enableScripts: true,
    localResourceRoots: ['extension-root/runtime', 'extension-root/media'] });
  const html = createWebviewHtml(vscode, context, webview, { brightness: 50, targetPhotoCount: 900 },
    [{ ...seeds[0], label: '</script><script>alert(1)</script>' }]);
  assert.ok(!html.includes("'unsafe-inline'"));
  assert.ok(!html.includes("'unsafe-eval'"));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /connect-src https:\/\/commons\.wikimedia\.org;/);
  assert.match(html, /img-src https:\/\/upload\.wikimedia\.org https:\/\/thumb\.wikimedia\.org;/);
  const embedded = html.match(/<script id="ocean-window-data"[^>]*>(.*?)<\/script>/s)[1];
  const data = JSON.parse(embedded);
  assert.equal(data.config.brightness, 1);
  assert.equal(data.config.targetPhotoCount, 200);
  assert.equal(data.photos[0].label, '</script><script>alert(1)</script>');
  assert.equal((html.match(/<script/g) || []).length, 4);
  assert.match(html, /runtime\/src\/wikimedia-source\.js/);
  assert.match(html, /media\/webview-bootstrap\.js/);
});
