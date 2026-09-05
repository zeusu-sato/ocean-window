import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9451');
const page = browser.contexts()[0].pages().find(p => p.url().includes('/.test-app/') && p.url().includes('workbench.html'));
assert.ok(page, 'Only the private native test window may be controlled');
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const report = { verifiedAt: new Date().toISOString(), version: '1.137.0-insider', cases: [] };
async function state() { return page.evaluate(() => globalThis.__oceanWindow?.status()); }
async function command(text) {
  await page.keyboard.press('Control+Shift+P');
  const input = page.locator('.quick-input-widget input').first();
  await input.waitFor({ state: 'visible' });
  await input.fill('>' + text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}
async function openFile(filename) {
  await page.keyboard.press('Control+p');
  const input = page.locator('.quick-input-widget input').first();
  await input.waitFor({ state: 'visible' });
  await input.fill(path.resolve(filename));
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => __oceanWindow.status().every(s => !s.visible));
}

try {
  const settingsPath = '.test-profile-native/User/settings.json';
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  settings['workbench.colorTheme'] = 'Abyss';
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  await page.reload();
  await page.waitForSelector('.ocean-window[data-ready="true"]', { state: 'visible' });
  await page.waitForTimeout(1500);
  const ocean = page.locator('.ocean-window');
  assert.equal(await ocean.isVisible(), true);
  const editor = await page.locator('.part.editor').boundingBox();
  await page.mouse.move(editor.x + editor.width, editor.y + editor.height / 2);
  await page.mouse.down();
  await page.mouse.move(editor.x + 240, editor.y + editor.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.mouse.move(1100, 50);
  await page.waitForTimeout(600);
  report.cases.push({ name: 'empty native editor displays online image', status: await state(),
    image: await ocean.locator('img[data-visible="true"]').getAttribute('src'),
    editorWidth: (await page.locator('.part.editor').boundingBox()).width });
  await page.screenshot({ path: 'docs/native-empty.png' });
  const chatStyle = await page.locator('.part.auxiliarybar').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
  for (const file of ['src/ocean-window.js', 'README.md']) {
    await openFile(file);
    assert.equal(await ocean.isVisible(), false);
    const status = await state();
    assert.ok(status.every(s => !s.timerActive));
    const bg = await page.locator('.monaco-editor').first().evaluate(el => getComputedStyle(el).backgroundColor);
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)');
    report.cases.push({ name: `opened ${file}`, hidden: true, editorBackground: bg, status });
    await page.screenshot({ path: file.endsWith('.md') ? 'docs/native-markdown.png' : 'docs/native-code.png' });
  }
  await command('Markdown: Open Preview');
  assert.equal(await ocean.isVisible(), false);
  report.cases.push({ name: 'Markdown preview also suppresses scenery', hidden: true });
  await command('View: Close All Editors');
  await page.waitForSelector('.ocean-window[data-ready="true"]', { state: 'visible' });
  const first = await ocean.getAttribute('data-photo');
  await page.locator('.editor-group-container.empty').hover();
  await page.getByRole('button', { name: '次の海へ', exact: true }).click();
  await page.waitForFunction(first => document.querySelector('.ocean-window').dataset.photo !== first, first);
  await page.getByRole('button', { name: '自動切り替えを一時停止', exact: true }).click();
  assert.equal((await state())[0].timerActive, false);
  report.cases.push({ name: 'native manual shuffle and pause', status: await state() });
  assert.deepEqual(await page.locator('.part.auxiliarybar').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })), chatStyle);
  report.cases.push({ name: 'chat colors unchanged', style: chatStyle });
  report.cachedPhotos = await page.evaluate(() => __oceanSource.getCached(__oceanWindowConfig).length);
  report.errors = errors;
  assert.equal(errors.length, 0);
  await fs.writeFile('docs/native-verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
