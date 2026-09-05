import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWebviewHtml, sanitizeWebviewState } = require('../extension/src/webview.cjs');
const seeds = JSON.parse(fs.readFileSync('assets/photos.json', 'utf8'));

test('strict-CSP webview restores the photo, paused timer, and next shuffle choice after recreation', async ({ page }) => {
  let saved = null;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Content Security Policy/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(() => {
    globalThis.acquireVsCodeApi = () => ({ getState: () => null, setState: state => { globalThis.savedWallpaper = state; }, postMessage: () => {} });
  });
  await page.route('https://commons.wikimedia.org/w/api.php**', route => route.abort());
  await page.route(/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//, route => {
    const photo = seeds.find(item => item.imageUrl === route.request().url());
    return photo ? route.fulfill({ path: path.resolve('assets', photo.filename), contentType: 'image/jpeg' }) : route.abort();
  });
  await page.route('**/webview-fixture**', route => {
    const vscode = { Uri: { joinPath: (base, ...parts) => parts.join('/') }, env: { language: 'ja' } };
    const webview = { cspSource: 'http://127.0.0.1:4179', asWebviewUri: uri =>
      `http://127.0.0.1:4179/${uri.startsWith('runtime/') ? uri.slice('runtime/'.length) : `extension/${uri}`}` };
    return route.fulfill({ contentType: 'text/html', body: createWebviewHtml(vscode, { extensionUri: '' }, webview,
      { intervalMinutes: 10, brightness: .65, targetPhotoCount: seeds.length }, seeds, saved) });
  });
  await page.goto('/webview-fixture');
  const ocean = page.locator('.ocean-window[data-ready="true"]');
  await expect(ocean).toBeVisible();
  await page.locator('.editor-group-container').hover();
  await page.getByRole('button', { name: '自動切り替えを一時停止', exact: true }).click();
  await expect.poll(() => page.evaluate(() => savedWallpaper?.playback.paused)).toBe(true);
  saved = sanitizeWebviewState(await page.evaluate(() => savedWallpaper));
  const current = saved.playback.currentId, next = saved.playback.bagIds[0];
  expect(next).toBeTruthy();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/webview-fixture?recreated');
  await expect(ocean).toHaveAttribute('data-photo', current);
  await expect.poll(() => page.evaluate(() => __oceanWindow.status()[0].paused)).toBe(true);
  expect(await page.evaluate(() => __oceanWindow.status()[0].timerActive)).toBe(false);
  await page.locator('.editor-group-container').hover();
  await page.getByRole('button', { name: '次の海へ' }).click();
  await expect(ocean).toHaveAttribute('data-photo', next);
  await expect(page.getByRole('button', { name: '自動切り替えを再開', exact: true })).toBeVisible();
  expect(await ocean.evaluate(element => element.style.getPropertyValue('--ow-brightness'))).toBe('0.65');
  expect(errors).toEqual([]);
});
