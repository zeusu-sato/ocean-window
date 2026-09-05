import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

// Use only a freshly downloaded application. This test enables and then restores
// Ocean Window in that application; it never discovers or modifies another app.
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  assert.ok(['--app-root', '--executable', '--vsix', '--output'].includes(key) && value && !value.startsWith('--'), `Unexpected argument: ${key}`);
  assert.ok(!Object.hasOwn(options, key), `Duplicate argument: ${key}`);
  options[key] = path.resolve(value);
}
for (const key of ['--app-root', '--executable', '--vsix', '--output']) assert.ok(options[key], `Required: ${key}`);
assert.equal(process.platform, 'darwin', 'This smoke test must run in a native macOS host; another platform is not macOS evidence');

const appRoot = await fs.realpath(options['--app-root']);
const executable = await fs.realpath(options['--executable']);
const vsix = await fs.realpath(options['--vsix']);
const output = options['--output'];
assert.ok(appRoot.endsWith('/Contents/Resources/app'), 'Expected a native macOS application bundle');
assert.equal(path.dirname(executable), path.resolve(appRoot, '../../MacOS'), 'Executable and app root must belong to the same supplied application');
assert.ok((await fs.stat(executable)).isFile(), 'The supplied bundle executable must be a regular file');
assert.ok(!appRoot.startsWith('/Applications/'), 'Use a private downloaded application, not an installed /Applications app');
await fs.mkdir(output, { recursive: true });
// macOS Unix-domain socket paths are limited to 103 bytes. The repository and
// artifact paths on hosted runners are too long for VS Code's main IPC socket.
const stateRoot = await fs.mkdtemp('/tmp/ow-smoke-');
const profile = path.join(stateRoot, 'profile');
const extensions = path.join(stateRoot, 'extensions');
const shared = path.join(stateRoot, 'shared-data');
const fixtures = path.join(stateRoot, 'fixtures');
await Promise.all([fs.mkdir(path.join(profile, 'User'), { recursive: true }), fs.mkdir(extensions), fs.mkdir(shared), fs.mkdir(fixtures)]);
await fs.writeFile(path.join(profile, 'User/settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none',
  'window.dialogStyle': 'custom',
  'security.workspace.trust.enabled': false,
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
  'workbench.colorTheme': 'Abyss',
  'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false
}, null, 2));
const appManifest = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
const product = JSON.parse(await fs.readFile(path.join(appRoot, 'product.json'), 'utf8'));
const htmlPath = path.join(appRoot, 'out/vs/code/electron-browser/workbench/workbench.html');
const originalHtml = await fs.readFile(htmlPath);
assert.ok(!originalHtml.includes('<!-- OCEAN-WINDOW:START -->'), 'The supplied application must start unpatched');
const report = {
  verifiedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  operatingSystem: `${os.type()} ${os.release()}`,
  vscodeVersion: appManifest.version,
  vscodeCommit: product.commit,
  package: path.basename(vsix),
  sha256: createHash('sha256').update(await fs.readFile(vsix)).digest('hex'),
  environment: 'Native macOS desktop Electron with isolated application, profile, extensions and shared data',
  stateRoot,
  cases: []
};
const ownedChildren = new Set();
let browser;
let page;
let appLog;
let receiptPath;
let installedRoot;
let nativeApp;
let stage = 'install';

function spawnOwned(command, args, options = {}) {
  const child = spawn(command, args, { ...options, detached: true });
  if (child.pid) ownedChildren.add(child);
  return child;
}

function terminateGroup(child, signal = 'SIGTERM') {
  if (!child.pid || !ownedChildren.has(child)) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function runOwned(command, args, { env = process.env, timeout = 60_000 } = {}) {
  let outputText = '';
  const child = spawnOwned(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { outputText = (outputText + data).slice(-65_536); });
  child.stderr.on('data', data => { outputText = (outputText + data).slice(-65_536); });
  let timer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Child failed (${code}/${signal}): ${outputText}`)));
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Child exceeded ${timeout} ms: ${outputText}`)), timeout); })
    ]);
    return outputText;
  } finally {
    clearTimeout(timer);
    terminateGroup(child);
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 1000))
      ]);
      if (child.exitCode === null && child.signalCode === null) terminateGroup(child, 'SIGKILL');
    }
    ownedChildren.delete(child);
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function connect(port, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('The private native application exited before CDP became ready');
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1500 }); }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw new Error('Native macOS workbench did not expose CDP within 45 seconds');
}

async function launchApplication() {
  const port = await freePort();
  const appEnv = { ...process.env };
  delete appEnv.ELECTRON_RUN_AS_NODE;
  if (!appLog) appLog = await fs.open(path.join(output, 'application.log'), 'a');
  nativeApp = spawnOwned(executable, [
    `--user-data-dir=${profile}`, `--extensions-dir=${extensions}`, `--shared-data-dir=${shared}`,
    '--locale=en', '--skip-welcome', '--skip-release-notes', '--new-window', `--remote-debugging-port=${port}`
  ], { env: appEnv, stdio: ['ignore', appLog.fd, appLog.fd] });
  nativeApp.once('error', error => { report.launchError = String(error); });
  browser = await connect(port, nativeApp);
  page = undefined;
  const deadline = Date.now() + 30_000;
  while (!page && Date.now() < deadline) {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => {
      const url = decodeURIComponent(candidate.url());
      return url.includes(appRoot) && url.endsWith('/workbench.html');
    });
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'Only the supplied native macOS application may be controlled');
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.bringToFront();
  await page.waitForSelector('.monaco-workbench');
}

async function coldRestartApplication() {
  const precedingApp = nativeApp;
  const precedingPid = precedingApp.pid;
  await browser.close();
  browser = undefined;
  page = undefined;
  const stopped = new Promise(resolve => {
    if (precedingApp.exitCode !== null || precedingApp.signalCode !== null) resolve();
    else precedingApp.once('exit', resolve);
  });
  terminateGroup(precedingApp);
  await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 3000))]);
  terminateGroup(precedingApp, 'SIGKILL');
  await Promise.race([stopped, new Promise((_, reject) => setTimeout(() => reject(new Error('The preceding native application did not exit before cold restart')), 3000))]);
  ownedChildren.delete(precedingApp);
  await htmlHasPatch(true);
  await launchApplication();
  assert.notEqual(nativeApp.pid, precedingPid, 'Cold restart must create a new native application process');
  await page.waitForSelector('.ocean-window[data-ready="true"]', { state: 'visible', timeout: 45_000 });
  await readReceipt('enabled');
  report.coldRestart = { precedingPid, relaunchedPid: nativeApp.pid, sameApplicationAndProfile: true, securitySettingsModified: false };
  await page.screenshot({ path: path.join(output, 'cold-restart.png') });
}

async function command(text) {
  await page.keyboard.press('Meta+Shift+p');
  const input = page.locator('.quick-input-widget input').first();
  await input.waitFor({ state: 'visible' });
  await input.fill('>' + text);
  const result = page.locator('.quick-input-list .label-name').filter({ hasText: new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') });
  await result.waitFor({ state: 'visible' });
  await result.evaluate(element => element.click());
}

async function reloadWindow() {
  // Use the application command, so VS Code disposes its native services before
  // recreating the renderer. A direct page.reload() bypasses that lifecycle.
  await Promise.all([
    page.waitForEvent('domcontentloaded', { timeout: 30_000 }),
    command('Developer: Reload Window')
  ]);
  await page.waitForSelector('.monaco-workbench');
}

async function htmlHasPatch(expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await fs.readFile(htmlPath, 'utf8')).includes('<!-- OCEAN-WINDOW:START -->') === expected) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Native patch presence did not become ${expected}`);
}

async function readReceipt(expectedState) {
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.ok(receipt.installs.length > 0, 'Expected an ownership receipt');
  for (const item of receipt.installs) {
    assert.equal(await fs.realpath(item.appRoot), appRoot, 'The receipt may own only the supplied private application');
    if (expectedState) assert.equal(item.state, expectedState);
  }
  return receipt;
}

async function openFile(file) {
  await page.keyboard.press('Meta+p');
  const input = page.locator('.quick-input-widget input').first();
  await input.waitFor({ state: 'visible' });
  await input.fill(file);
  const result = page.locator('.quick-input-list .label-name').filter({ hasText: path.basename(file) });
  await result.first().waitFor({ state: 'visible' });
  await page.keyboard.press('Enter');
  await page.waitForSelector('.editor-group-container:not(.empty) .monaco-editor', { state: 'visible' });
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('.ocean-window')).some(element =>
    getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0));
}

async function verify() {
  const isolationArgs = [`--user-data-dir=${profile}`, `--extensions-dir=${extensions}`, `--shared-data-dir=${shared}`];
  const installOutput = await runOwned(executable, [path.join(appRoot, 'out/cli.js'), ...isolationArgs, '--install-extension', vsix, '--force'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  await fs.writeFile(path.join(output, 'install.log'), installOutput);
  const extensionFolders = [];
  for (const entry of await fs.readdir(extensions, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(extensions, entry.name);
    const manifest = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    if (manifest.publisher === 'zeusu-sato' && manifest.name === 'ocean-window') extensionFolders.push({ folder, manifest });
  }
  assert.equal(extensionFolders.length, 1, 'Expected exactly one installed Ocean Window package');
  installedRoot = extensionFolders[0].folder;
  report.extensionVersion = extensionFolders[0].manifest.version;
  receiptPath = path.join(extensions, '.ocean-window/zeusu-sato.ocean-window.json');
  stage = 'launch';
  await launchApplication();
  stage = 'opt-in';
  await command('View: Close All Editors');
  await htmlHasPatch(false);
  report.cases.push('Universal VSIX installs and activates in a native macOS extension host without patching on startup');
  await command('Ocean Window: Enable / Apply Ocean Wallpaper');
  const consent = page.getByRole('button', { name: 'Enable Ocean Window', exact: true });
  await consent.waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(output, 'consent.png') });
  await consent.click();
  await htmlHasPatch(true);
  assert.equal(await page.evaluate(() => typeof globalThis.__oceanWindow), 'undefined');
  report.cases.push('Explicit consent writes the macOS workbench patch without forcing reload');
  await command('Ocean Window: Show Status');
  await page.waitForSelector('.part.panel', { state: 'visible' });
  await command('View: Toggle Panel Visibility');
  report.cases.push('Status remains usable while the reload notice is open');
  stage = 'online-photo';
  await reloadWindow();
  await page.waitForSelector('.ocean-window[data-ready="true"]', { state: 'visible', timeout: 45_000 });
  report.photo = await page.evaluate(() => {
    const surface = document.querySelector('.ocean-window[data-ready="true"]');
    const photo = [...__oceanSource.getCached(__oceanWindowConfig), ...__oceanWindowConfig.photos].find(item => item.id === surface.dataset.photo);
    return { ...photo, loadedImages: [...surface.querySelectorAll('img')].filter(image => image.complete && image.naturalWidth > 0).map(image => ({ src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight })) };
  });
  assert.ok(report.photo.loadedImages.some(image => /^https:\/\/(?:thumb|upload)\.wikimedia\.org\//.test(image.src)), 'A real online Wikimedia image must load; fixtures are not online evidence');
  report.cases.push('The packaged renderer fetches a real online sea photograph and displays it in an empty editor');
  await page.screenshot({ path: path.join(output, 'sea.png') });
  stage = 'code-and-markdown';
  const codeFile = path.join(fixtures, 'ocean-smoke.js');
  const markdownFile = path.join(fixtures, 'ocean-smoke.md');
  await fs.writeFile(codeFile, '// Native macOS readability smoke\nconst oceanWindow = "visible only when empty";\nconsole.log(oceanWindow);\n');
  await fs.writeFile(markdownFile, '# Ocean Window\n\nNative macOS Markdown remains readable.\n');
  await openFile(codeFile);
  await page.screenshot({ path: path.join(output, 'code.png') });
  report.cases.push('Opening a JavaScript file hides scenery and preserves the code editor');
  await openFile(markdownFile);
  await page.screenshot({ path: path.join(output, 'markdown.png') });
  report.cases.push('Opening a Markdown file hides scenery and preserves the text editor');
  await command('View: Close All Editors');
  await page.waitForSelector('.ocean-window[data-ready="true"]', { state: 'visible' });
  report.cases.push('Closing all files restores the sea in the empty editor');
  stage = 'cold-restart';
  await coldRestartApplication();
  report.cases.push('The patched macOS application cold-launches in a new native process with the same profile and displays the sea again');
  stage = 'restore';
  await command('Ocean Window: Restore Original Editor');
  await htmlHasPatch(false);
  await reloadWindow();
  assert.equal(await page.evaluate(() => typeof globalThis.__oceanWindow), 'undefined');
  await readReceipt('disabled');
  assert.deepEqual(await fs.readFile(htmlPath), originalHtml);
  report.cases.push('Restore removes the native macOS patch, restores the exact original HTML and records disabled state');
  stage = 'uninstall-hook';
  await command('Ocean Window: Enable / Apply Ocean Wallpaper');
  await htmlHasPatch(true);
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const receipt = await readReceipt();
    const locked = await fs.access(receiptPath + '.lock').then(() => true, () => false);
    if (!locked && receipt.installs.every(item => item.state === 'enabled')) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Enable must finish and release its receipt lock before testing uninstall');
  const hookStarted = performance.now();
  const hookOutput = await runOwned(process.execPath, [path.join(installedRoot, 'out/uninstall.cjs')], { timeout: 5000 });
  report.uninstallHookMilliseconds = Math.round(performance.now() - hookStarted);
  assert.equal(JSON.parse(hookOutput).restored, 1);
  await htmlHasPatch(false);
  await readReceipt('disabled');
  assert.deepEqual(await fs.readFile(htmlPath), originalHtml);
  report.cases.push('The packaged uninstall hook restores the native macOS app within its five-second lifecycle limit');
  report.success = true;
}

let failure;
let deadlineTimer;
try {
  await Promise.race([
    verify(),
    new Promise((_, reject) => { deadlineTimer = setTimeout(() => reject(new Error(`Native smoke exceeded four minutes during ${stage}`)), 240_000); })
  ]);
} catch (error) {
  failure = error;
  report.success = false;
  report.failedStage = stage;
  report.error = String(error.stack || error);
  if (browser) report.rendererUrls = browser.contexts().flatMap(context => context.pages()).map(candidate => candidate.url());
  if (page && !page.isClosed()) {
    report.ui = await page.locator('body').innerText({ timeout: 3000 }).then(text => text.slice(-10_000), () => 'Unable to read failed renderer');
    await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 3000 }).catch(() => {});
  }
} finally {
  clearTimeout(deadlineTimer);
  if (failure && receiptPath && installedRoot) {
    // A failed verification may have already enabled the patch. Its recovery
    // receipt is accepted only when every entry points to this supplied app.
    try {
      await readReceipt();
      report.failureRecovery = await runOwned(process.execPath, [path.join(installedRoot, 'out/uninstall.cjs')], { timeout: 5000 });
    } catch (error) { report.failureRecovery = String(error); }
  }
  if (browser) await browser.close().catch(() => {});
  // Only process groups created by this script are eligible for termination.
  for (const child of ownedChildren) terminateGroup(child);
  if (ownedChildren.size) await new Promise(resolve => setTimeout(resolve, 1000));
  for (const child of ownedChildren) terminateGroup(child, 'SIGKILL');
  if (appLog) await appLog.close();
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
