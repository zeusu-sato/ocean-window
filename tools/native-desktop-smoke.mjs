import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { chromium } from 'playwright';

// Control only a supplied private application. Test fixtures and extension
// state use a separate temporary path, kept short for macOS IPC sockets.
const args = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--app-root','--executable','--vsix','--output'].includes(key) && value && !value.startsWith('--'), 'Unexpected argument: ' + key);
  assert.ok(!Object.hasOwn(args,key), 'Duplicate argument: ' + key); args[key] = path.resolve(value);
}
for(const key of ['--app-root','--executable','--vsix','--output']) assert.ok(args[key], 'Required: ' + key);
assert.ok(['darwin', 'win32'].includes(process.platform), 'This smoke requires a native macOS or Windows host');
const appRoot=await fs.realpath(args['--app-root']), executable=await fs.realpath(args['--executable']);
const vsix=await fs.realpath(args['--vsix']), output=args['--output'];
const samePath = (left, right) => path.relative(left, right) === '';
if (process.platform === 'darwin') {
  assert.ok(appRoot.endsWith('/Contents/Resources/app'));
  assert.equal(path.dirname(executable), path.resolve(appRoot, '../../MacOS'), 'Executable must belong to supplied bundle');
  assert.ok(!appRoot.startsWith('/Applications/'), 'Use a private downloaded application');
} else {
  const privateApps = await fs.realpath(fileURLToPath(new URL('../.test-app', import.meta.url)));
  const relative = path.relative(privateApps, appRoot);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Windows application must be inside the repository .test-app directory');
  assert.ok(samePath(path.dirname(executable), path.resolve(appRoot, '../..')), 'Executable must belong to supplied application');
  assert.match(path.basename(executable), /^Code(?: - Insiders)?\.exe$/i);
}
assert.ok((await fs.stat(executable)).isFile());
let htmlPath;
for(const kind of ['electron-browser','electron-sandbox']) for(const name of ['workbench.html','workbench.esm.html']) {
  const candidate=path.join(appRoot,'out/vs/code',kind,'workbench',name);
  if(await fs.stat(candidate).then(stat=>stat.isFile(),error=>{if(error.code==='ENOENT')return false;throw error;})) htmlPath ||=candidate;
}
assert.ok(htmlPath,'Expected native workbench HTML');
const bridge=await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'ow-webview-'));
const profile=path.join(bridge,'profile'), extensions=path.join(bridge,'extensions'), shared=path.join(bridge,'shared-data');
const driverPath=path.join(bridge,'driver'), fixtures=path.join(bridge,'fixtures');
await Promise.all([fs.mkdir(output,{recursive:true}),fs.mkdir(path.join(profile,'User'),{recursive:true}),...[extensions,shared,driverPath,fixtures].map(folder=>fs.mkdir(folder))]);
await fs.writeFile(path.join(profile,'User/settings.json'),JSON.stringify({
  'workbench.startupEditor':'none','window.dialogStyle':'custom','security.workspace.trust.enabled':false,
  'update.mode':'none','telemetry.telemetryLevel':'off','workbench.colorTheme':'Abyss','extensions.autoUpdate':false,'extensions.autoCheckUpdates':false
},null,2));
const extensionManifest = JSON.parse(await fs.readFile(new URL('../extension/package.json', import.meta.url), 'utf8'));
await fs.writeFile(path.join(driverPath,'package.json'),JSON.stringify({name:'ocean-window-smoke-driver',publisher:'ocean-window-tests',version:'0.0.1',engines:extensionManifest.engines,activationEvents:['onStartupFinished'],main:'./driver.cjs',extensionKind:['ui']}));
await fs.copyFile(new URL('./webview-smoke-driver.cjs', import.meta.url), path.join(driverPath, 'driver.cjs'));
const originalHtml = await fs.readFile(htmlPath);
const originalDirectory = await fs.readdir(path.dirname(htmlPath));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.ok(!originalHtml.includes('OCEAN-WINDOW:START'), 'Private native application must start unpatched');
const appManifest = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
const product = JSON.parse(await fs.readFile(path.join(appRoot, 'product.json'), 'utf8'));
const report = {
  verifiedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, uid: process.getuid?.(),
  vscodeVersion: appManifest.version, vscodeCommit: product.commit,
  package: path.basename(vsix), sha256: hash(await fs.readFile(vsix)), originalWorkbenchSha256: hash(originalHtml),
  nativeAppOwnerUid: (await fs.stat(appRoot)).uid,
  environment: `Native ${process.platform === 'win32' ? 'Windows' : 'macOS'} Electron desktop with isolated app, profile, workspace, installed VSIX and supported-API driver`,
  isolation: { appRoot, bridge, profile, extensions, shared },
  cases: []
};
const children = new Set();
let browser;
let page;
let log;
let phase = 'install';
let app;
let serial = 0;

function start(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, { ...options, detached: process.platform !== 'win32', windowsHide: true });
  if (child.pid) children.add(child);
  return child;
}
function stop(child, signal = 'SIGTERM') {
  if (!child.pid || !children.has(child)) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000, encoding: 'utf8' });
    if (result.error) throw result.error;
    return;
  }
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function run(command, commandArgs, options = {}) {
  let text = '';
  const child = start(command, commandArgs, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { text = (text + data).slice(-60_000); });
  child.stderr.on('data', data => { text = (text + data).slice(-60_000); });
  let timer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`CLI failed ${code}: ${text}`))); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CLI exceeded 60 seconds')), 60_000); })
    ]);
    return text;
  } finally { clearTimeout(timer); stop(child, 'SIGKILL'); children.delete(child); }
}
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function request(operation, values = {}) {
  const id = ++serial;
  await fs.writeFile(path.join(bridge, 'request.pending.json'), JSON.stringify({ id, operation, ...values }));
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(path.join(bridge, 'request.pending.json'), path.join(bridge, 'request.json')); break; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 49) throw error;
      // The extension host can briefly hold this file open while polling on Windows.
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  for (let attempt = 0; attempt < 400; attempt++) {
    const response = await fs.readFile(path.join(bridge, 'response.json'), 'utf8').then(JSON.parse).catch(() => undefined);
    if (response?.id === id) {
      if (response.error) throw new Error(response.error);
      return response.value;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Native extension-host driver timed out: ${operation}`);
}
const oceanTabs = state => state.groups.flatMap(group => group.tabs).filter(tab => String(tab.viewType).endsWith('oceanWindow.scene'));
async function tabs(count) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const state = await request('state');
    if (oceanTabs(state).length === count) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Ocean tab count did not become ${count}: ${JSON.stringify(await request('state'))}`);
}
async function scene(timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (await frame.locator('.ocean-window[data-ready="true"]').isVisible()) return frame;
      } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Online sea did not render in a real VS Code webview');
}
async function noScene() {
  for (const frame of page.frames()) {
    const visible = await frame.locator('.ocean-window[data-ready="true"]').isVisible().catch(() => false);
    assert.equal(visible, false, 'No Ocean webview may cover an open file');
  }
}
async function waitForImagePreview() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames().filter(candidate => candidate !== page.mainFrame())) {
      const loaded = await frame.evaluate(() => !document.querySelector('.ocean-window') && [...document.images].some(image => image.complete && image.naturalWidth > 0)).catch(() => false);
      if (loaded) return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The native image-preview editor did not decode its image');
}
async function disposedWebviewErrors() {
  const errors = [];
  async function scan(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.isFile() && entry.name.endsWith('.log')) {
        const contents = await fs.readFile(file, 'utf8');
        for (const line of contents.split(/\r?\n/)) if (/webview is disposed/i.test(line)) errors.push({ file: path.relative(profile, file), line });
      }
    }
  }
  await scan(path.join(profile, 'logs'));
  const appLog = await fs.readFile(path.join(output, 'application.log'), 'utf8');
  for (const line of appLog.split(/\r?\n/)) if (/webview is disposed/i.test(line)) errors.push({ file: 'application.log', line });
  return errors;
}
async function screenshot(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await new Promise(resolve => setTimeout(resolve, 200));
  await page.screenshot({ path: path.join(output, name + '.png') });
}
async function launchApplication() {
  const isolation = [`--user-data-dir=${profile}`, `--extensions-dir=${extensions}`, `--shared-data-dir=${shared}`];
  await fs.rm(path.join(bridge, "request.json"), { force: true });
  phase = 'launch';
  const debugPort = await port();
  const appEnv = { ...process.env, OCEAN_SMOKE_BRIDGE: bridge };
  delete appEnv.ELECTRON_RUN_AS_NODE;
  delete appEnv.VSCODE_IPC_HOOK_CLI;
  log ||= await fs.open(path.join(output, 'application.log'), 'a');
  app = start(executable, [...isolation, `--extensionDevelopmentPath=${driverPath}`, '--locale=en', '--skip-welcome', '--skip-release-notes', '--new-window', `--remote-debugging-port=${debugPort}`, fixtures], { env: appEnv, stdio: ['ignore', log.fd, log.fd] });
  app.once('error', error => { report.launchError = String(error); });
  for (let attempt = 0; attempt < 100 && !browser; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 }); }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(browser);
  for (let attempt = 0; attempt < 100 && !page; attempt++) {
    const appUrlPath = appRoot.replaceAll('\\', '/').toLowerCase();
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => decodeURIComponent(candidate.url()).toLowerCase().includes(appUrlPath) && /\/workbench(?:\.esm)?\.html(?:[?#]|$)/.test(candidate.url()));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(page, 'Only the supplied private native application window may be controlled');
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.bringToFront();
}

async function verify() {
  phase = 'install';
  const isolation = [`--user-data-dir=${profile}`, `--extensions-dir=${extensions}`, `--shared-data-dir=${shared}`];
  const installed = await run(executable, [path.join(appRoot, 'out/cli.js'), ...isolation, '--install-extension', vsix, '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  await fs.writeFile(path.join(output, 'install.log'), installed);
  const folder = (await fs.readdir(extensions)).find(name => name.startsWith('zeusu-sato.ocean-window-'));
  assert.ok(folder);
  const installedManifest = JSON.parse(await fs.readFile(path.join(extensions, folder, 'package.json'), 'utf8'));
  report.extensionVersion = installedManifest.version;
  report.extensionEngine = installedManifest.engines.vscode;
  assert.match(report.extensionVersion, /^0\.3\./);
  const code = path.join(fixtures, 'ocean-smoke.js');
  const markdown = path.join(fixtures, 'ocean-smoke.md');
  const picture = path.join(fixtures, 'ocean-smoke.png');
  await fs.writeFile(code, '// Native desktop application; ordinary extension API\nconst oceanWindow = "Only empty editors show the sea";\n');
  await fs.writeFile(markdown, '# Ocean Window\n\nMarkdown is readable with no extra Ocean tab.\n');
  await fs.copyFile(path.join(extensions, folder, 'icon.png'), picture);
  await launchApplication();
  phase = 'automatic-scene';
  const initialState = await tabs(1);
  assert.equal(initialState.platform, process.platform);
  assert.equal(initialState.architecture,process.arch);
  assert.equal(initialState.uid,process.getuid?.());
  assert.equal(await fs.realpath(initialState.appRoot),appRoot);
  assert.equal(initialState.oceanActive, true);
  report.nativeExtensionHost = initialState;
  report.rendererVersions = await page.evaluate(() => ({ userAgent: navigator.userAgent }));
  report.initialRendererTimeOrigin=await page.evaluate(()=>performance.timeOrigin);
  let frame = await scene();
  report.photo = await frame.evaluate(() => {
    const surface = document.querySelector('.ocean-window[data-ready="true"]');
    return { photo: surface?.dataset.photo, images: [...surface.querySelectorAll('img')].filter(image => image.complete && image.naturalWidth > 0).map(image => ({ src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight })) };
  });
  assert.ok(report.photo.images.some(image => /^https:\/\/(?:thumb|upload)\.wikimedia\.org\//.test(image.src)));
  assert.deepEqual(await fs.readFile(htmlPath), originalHtml);
  await screenshot('automatic-sea');
  report.cases.push('Installing the VSIX in the native desktop host automatically displays a real online sea in an empty editor, without permission setup, consent dialog or reload');
  phase = 'file-lifecycle';
  for (const [file, kind, name] of [[code, 'text', 'code'], [markdown, 'text', 'markdown'], [picture, 'custom', 'image']]) {
    await request('open', { file, kind });
    const state = await tabs(0);
    assert.ok(state.groups.some(group => group.tabs.some(tab => tab.uri && samePath(tab.uri, file))), `Expected native ${name} editor tab`);
    await noScene();
    if (kind === 'custom') await waitForImagePreview();
    await screenshot(name);
    report.cases.push(`Opening ${name} closes the Ocean panel completely and leaves no extra Ocean tab`);
  }
  phase = 'chat-focus';
  await request('command', { command: 'workbench.action.chat.open' });
  const chatInput = page.locator('.interactive-input-part textarea, .interactive-input-part [contenteditable="true"]').first();
  await chatInput.waitFor({ state: 'attached' });
  await chatInput.evaluate(element => element.focus());
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.interactive-input-part')), true);
  await request('command', { command: 'workbench.action.closeAllEditors' });
  await tabs(1);
  await scene();
  report.chatFocusAfterReturn = await page.evaluate(() => ({ preserved: !!document.activeElement?.closest('.interactive-input-part'), activeTag: document.activeElement?.tagName, activeAriaLabel: document.activeElement?.getAttribute('aria-label') }));
  assert.equal(report.chatFocusAfterReturn.preserved, true, 'Returning the Ocean panel must preserve chat input focus');
  await screenshot('chat-focus-preserved');
  report.cases.push('Closing all files returns the sea while preserving focus in the chat input');
  phase = 'scene-continuity';
  frame = await scene();
  const photoBeforeFile = await frame.locator('.ocean-window').getAttribute('data-photo');
  await frame.getByRole('button', { name: '自動切り替えを一時停止', exact: true }).evaluate(element => element.click());
  await frame.waitForFunction(() => globalThis.__oceanWindow.status()[0]?.paused === true);
  await request('open', { file: code, kind: 'text' });
  await tabs(0);
  await request('command', { command: 'workbench.action.closeAllEditors' });
  await tabs(1);
  frame = await scene();
  assert.equal(await frame.locator('.ocean-window').getAttribute('data-photo'), photoBeforeFile);
  assert.equal(await frame.evaluate(() => globalThis.__oceanWindow.status()[0]?.paused), true);
  report.cases.push('The current photograph and pause choice survive closing the webview for a file and reopening it afterward');
  phase = 'live-settings';
  await request('config', { key: 'brightness', value: 0.43 });
  for (let attempt = 0; attempt < 100; attempt++) {
    frame = await scene();
    if (await frame.locator('.ocean-window').evaluate(element => element.style.getPropertyValue('--ow-brightness') === '0.43').catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await frame.locator('.ocean-window').evaluate(element => element.style.getPropertyValue('--ow-brightness')), '0.43');
  await request('config', { key: 'showCaption', value: false });
  for (let attempt = 0; attempt < 100; attempt++) {
    frame = await scene();
    if (await frame.locator('.ow-place').evaluate(element => element.hidden).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await frame.locator('.ow-place').evaluate(element => element.hidden), true);
  await tabs(1);
  report.cases.push('Brightness and caption settings update the existing webview live without native reload or extra tabs');
  phase = 'manual-dismissal';
  await request('closeOcean');
  await tabs(0);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await tabs(0);
  report.cases.push('Manually closing the Ocean panel leaves it dismissed while the editor remains empty');
  await request('open', { file: code, kind: 'text' });
  await tabs(0);
  await request('command', { command: 'workbench.action.closeAllEditors' });
  await tabs(1);
  await scene();
  report.cases.push('Opening and then closing another file resets manual dismissal and returns the sea');
  phase = 'cold-restart';
  assert.equal(await page.evaluate(()=>performance.timeOrigin),report.initialRendererTimeOrigin,'File activity and settings must not reload the window');
  frame=await scene();
  await frame.locator('.editor-group-container').hover();
  if (!await frame.evaluate(() => globalThis.__oceanWindow.status()[0]?.paused)) {
    await frame.locator('.ow-controls button').nth(1).click();
    await frame.waitForFunction(() => globalThis.__oceanWindow.status()[0]?.paused === true);
  }
  const saved=await frame.evaluate(()=>globalThis.__oceanWindow.exportState());
  assert.equal(saved.paused,true); assert.ok(saved.currentId && saved.bagIds[0]);
  await new Promise(resolve=>setTimeout(resolve,2000));
  const previousApp=app;
  const stopped=new Promise(resolve=>{if(previousApp.exitCode!==null || previousApp.signalCode!==null)resolve();else previousApp.once('exit',resolve);});
  await browser.close(); browser=undefined; page=undefined;
  stop(previousApp);
  await Promise.race([stopped,new Promise(resolve=>setTimeout(resolve,3000))]);
  if(previousApp.exitCode===null && previousApp.signalCode===null) stop(previousApp,'SIGKILL');
  await Promise.race([stopped,new Promise((_,reject)=>setTimeout(()=>reject(Error('Previous app did not exit')),3000))]);
  children.delete(previousApp);
  await launchApplication(); assert.notEqual(app.pid,previousApp.pid);
  report.coldRestart={precedingPid:previousApp.pid,relaunchedPid:app.pid,sameApplicationProfileAndWorkspace:true};
  await tabs(1); frame=await scene();
  const restored=await frame.evaluate(()=>globalThis.__oceanWindow.exportState());
  assert.equal(restored.currentId,saved.currentId); assert.equal(restored.paused,true); assert.equal(restored.bagIds[0],saved.bagIds[0]);
  await frame.locator('.editor-group-container').hover();
  await frame.getByRole('button', { name: '\u6b21\u306e\u6d77\u3078', exact: true }).click();
  await frame.waitForFunction(id=>document.querySelector('.ocean-window[data-ready="true"]')?.dataset.photo===id,saved.bagIds[0]);
  await screenshot('cold-restart');
  report.cases.push('A new native process restores current photo, pause state and next shuffle choice in the same workspace');
  phase = 'disable';
  await request('command', { command: 'oceanWindow.disable' });
  await tabs(0);
  await request('open', { file: markdown, kind: 'text' });
  await request('command', { command: 'workbench.action.closeAllEditors' });
  await new Promise(resolve => setTimeout(resolve, 1000));
  await tabs(0);
  report.cases.push('Disable closes Ocean and prevents respawning through further file activity');
  await request('command', { command: 'oceanWindow.enable' });
  await tabs(1);
  await scene();
  report.cases.push('Enable restores the sea immediately through the standard extension API');
  phase = 'final-native-integrity';
  assert.deepEqual(await fs.readFile(htmlPath), originalHtml);
  assert.deepEqual(await fs.readdir(path.dirname(htmlPath)), originalDirectory);
  report.finalWorkbenchSha256 = hash(await fs.readFile(htmlPath));
  report.cases.push('Native application HTML and workbench directory remain exactly unchanged after every operation');
  report.disposedWebviewErrors = await disposedWebviewErrors();
  assert.deepEqual(report.disposedWebviewErrors, [], 'Native application and extension-host logs must contain no disposed-webview errors');
  report.cases.push('Native application and extension-host logs contain no disposed-webview errors');
  report.success = true;
}
let timer;
let failure;
try {
  await Promise.race([verify(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Smoke exceeded six minutes at ${phase}`)), 360_000); })]);
} catch (error) {
  failure = error;
  report.success = false;
  report.failedPhase = phase;
  report.error = String(error.stack || error);
  if (page && !page.isClosed()) {
    report.ui = await page.locator('body').innerText({ timeout: 3000 }).then(text => text.slice(-10_000), () => 'No UI');
    report.frameUrls = page.frames().map(frame => frame.url());
    await screenshot('failure').catch(() => {});
  }
} finally {
  clearTimeout(timer);
  if (browser) await browser.close().catch(() => {});
  for (const child of children) stop(child);
  await new Promise(resolve => setTimeout(resolve, 1000));
  for (const child of children) stop(child, 'SIGKILL');
  if (log) await log.close();
  report.finalWorkbenchSha256 = hash(await fs.readFile(htmlPath));
  report.nativeFilesUnchanged=report.finalWorkbenchSha256===report.originalWorkbenchSha256 && JSON.stringify(await fs.readdir(path.dirname(htmlPath)))===JSON.stringify(originalDirectory);
  if(!report.nativeFilesUnchanged){report.success=false;failure ||= Error('Native workbench changed');}
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
