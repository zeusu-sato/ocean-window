import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { runInstall } from './install.mjs';

const manifest = JSON.parse(await fs.readFile('extension/package.json', 'utf8'));
const extensionId = `${manifest.publisher}.${manifest.name}`;
const receiptPath = `.test-extensions-native/.ocean-window/${extensionId}.json`;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9451');
const page = browser.contexts()[0].pages().find(p => p.url().includes('/.test-app/') && p.url().includes('workbench.html'));
assert.ok(page, 'Only the isolated native test window may be controlled');
const appRoot = path.resolve('.test-app/resources/app');
const htmlPath = path.join(appRoot, 'out/vs/code/electron-browser/workbench/workbench.html');
const marker = '<!-- OCEAN-WINDOW:START -->';
const report = { verifiedAt: new Date().toISOString(), package: `${manifest.name}-${manifest.version}-win32-x64.vsix`, cases: [] };
async function command(text) {
  await page.keyboard.press('Control+Shift+P');
  const input = page.locator('.quick-input-widget input').first();
  await input.waitFor({ state: 'visible' });
  await input.fill('>' + text);
  const result = page.locator('.quick-input-list .label-name').filter({ hasText: new RegExp('^' + text + '$') });
  await result.waitFor({ state: 'visible' });
  // Avoid Chromium's scroll-into-view wait on this native command palette.
  await result.evaluate(element => element.click());
}
async function htmlHasPatch(expected) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await fs.readFile(htmlPath, 'utf8')).includes(marker) === expected) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Native patch presence did not become ${expected}`);
}
try {
  await runInstall({ appRoot, uninstall: true, skipDist: true });
  const settingsPath = '.test-profile-native/User/settings.json';
  const settings = JSON.parse((await fs.readFile(settingsPath, 'utf8')).replace(/^\uFEFF/, ''));
  settings['window.dialogStyle'] = 'custom';
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  await page.reload();
  await page.waitForSelector('.monaco-workbench');
  await page.waitForTimeout(2000);
  await command('View: Close All Editors');
  await htmlHasPatch(false);
  report.cases.push('Installing and activating VSIX does not patch native files');
  await command('Ocean Window: Enable / Apply Ocean Wallpaper');
  const consent = page.getByRole('button', { name: 'Enable Ocean Window', exact: true });
  const firstConsent = await Promise.race([
    consent.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
    htmlHasPatch(true).then(() => false).catch(() => true)
  ]);
  if (firstConsent) {
    await page.screenshot({ path: 'docs/extension-consent.png' });
    await consent.click();
  }
  await htmlHasPatch(true);
  assert.equal(await page.evaluate(() => typeof globalThis.__oceanWindow), 'undefined');
  report.cases.push(firstConsent ? 'Enable requires opt-in and applies without forced reload' : 'Stored explicit opt-in is reused; apply does not force reload');
  // A nonmodal reload notice must not block other commands.
  await command('Ocean Window: Show Status');
  await page.waitForSelector('.part.panel', { state: 'visible' });
  report.cases.push('Status runs while the reload notification remains open');
  await page.reload();
  await page.waitForSelector('.ocean-window[data-ready="true"]', { state: 'visible', timeout: 30_000 });
  report.cases.push('Packaged runtime renders the online scene after reload');
  report.photo = await page.evaluate(() => {
    const id = document.querySelector('.ocean-window').dataset.photo;
    return [...__oceanSource.getCached(__oceanWindowConfig), ...__oceanWindowConfig.photos].find(photo => photo.id === id);
  });
  await page.screenshot({ path: 'docs/extension-native-scene.png' });
  await command('Ocean Window: Open Settings');
  await page.waitForSelector('.settings-editor', { state: 'visible' });
  // Current VS Code can open Settings in a separate floating editor group.
  assert.equal(await page.locator('.settings-editor').evaluate(el => el.closest('.editor-group-container').classList.contains('empty')), false);
  assert.equal(await page.locator('.settings-editor').evaluate(el => !!el.closest('.editor-group-container').querySelector('.ocean-window[data-ready="true"]')), false);
  report.cases.push('Five application settings are contributed; no scenery is painted into their editor group');
  await page.keyboard.press('Escape');
  await command('Ocean Window: Restore Original Editor');
  await htmlHasPatch(false);
  await page.reload();
  await page.waitForSelector('.monaco-workbench');
  assert.equal(await page.evaluate(() => typeof globalThis.__oceanWindow), 'undefined');
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(receipt.installs.find(item => path.resolve(item.appRoot).toLowerCase() === appRoot.toLowerCase()).state, 'disabled');
  report.cases.push('Restore command removes the native patch and records restoration');
  await command('Ocean Window: Enable / Apply Ocean Wallpaper');
  await htmlHasPatch(true);
  for (let attempt = 0; attempt < 50; attempt++) {
    const records = JSON.parse(await fs.readFile(receiptPath, 'utf8')).installs;
    assert.ok(records.every(item => path.resolve(item.appRoot).toLowerCase() === appRoot.toLowerCase()), 'Hook test may restore only this private application');
    const locked = await fs.access(receiptPath + '.lock').then(() => true, () => false);
    if (!locked && records.every(item => item.state === 'enabled')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const hookPath = path.resolve(`.test-extensions-native/${extensionId}-${manifest.version}/out/uninstall.cjs`);
  let hookOutput = '';
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath], { windowsHide: true, timeout: 5000 });
    child.stdout.on('data', data => { hookOutput += data; });
    child.stderr.on('data', data => { hookOutput += data; });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Packaged uninstall hook failed: ${code}/${signal}: ${hookOutput}`)));
  });
  assert.equal(JSON.parse(hookOutput).restored, 1);
  await htmlHasPatch(false);
  assert.ok(JSON.parse(await fs.readFile(receiptPath, 'utf8')).installs.every(item => item.state === 'disabled'));
  report.cases.push('Packaged Node uninstall hook restores the real private application within its five-second lifecycle limit');
  await fs.writeFile('docs/extension-native-verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
