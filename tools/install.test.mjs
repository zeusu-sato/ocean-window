import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runInstall } from './install.mjs';

const originalHtml = '<!doctype html>\r\n<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'; img-src \'self\' https:; connect-src \'self\' https:;"></head><body></body>\r\n<script src="./workbench.js" type="module"></script>\r\n</html>\r\n';

async function fixture(t) {
  const temporaryParent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temporaryParent, 'ocean-window-test-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), temporaryParent);
    assert.match(path.basename(resolved), /^ocean-window-test-/);
    await fs.rm(resolved, { recursive: true, force: false });
  });
  const sourceRoot = path.join(root, 'source');
  const appRoot = path.join(root, 'app');
  const workbenchDir = path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench');
  const html = path.join(workbenchDir, 'workbench.html');
  await fs.mkdir(workbenchDir, { recursive: true });
  await fs.mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await fs.mkdir(path.join(sourceRoot, 'assets'));
  await fs.writeFile(html, originalHtml);
  await fs.writeFile(path.join(sourceRoot, 'config.json'), JSON.stringify({ intervalMinutes: 10, brightness: 0.78, enabled: true, showCaption: true, source: 'wikimedia', refreshHours: 24, targetPhotoCount: 60 }));
  await fs.writeFile(path.join(sourceRoot, 'src', 'ocean-window.js'), '(() => { globalThis.fixtureConfig = globalThis.__oceanWindowConfig; })();');
  await fs.writeFile(path.join(sourceRoot, 'src', 'wikimedia-source.js'), 'globalThis.__oceanSource = { fixture: true };');
  await fs.writeFile(path.join(sourceRoot, 'src', 'ocean-window.css'), '.editor-group-container.empty { color: inherit; }');
  await fs.writeFile(path.join(sourceRoot, 'assets', 'photos.json'), JSON.stringify([{ id: 'sea', label: 'Sea', country: 'Fixture', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Sea.jpg', sourceUrl: 'https://example.com/photo', author: 'Fixture', license: 'CC0', licenseUrl: 'https://example.com/license', position: 'center' }]));
  return { sourceRoot, appRoot, html, workbenchDir };
}

test('dry run is read-only; install preserves CSP and script order; uninstall restores exact bytes', async t => {
  const f = await fixture(t);
  const dry = await runInstall({ ...f, dryRun: true });
  assert.equal(dry.photoCount, 1);
  assert.equal(await fs.readFile(f.html, 'utf8'), originalHtml);
  assert.deepEqual(await fs.readdir(f.workbenchDir), ['workbench.html']);
  assert.equal(await fs.stat(path.join(f.sourceRoot, 'dist')).catch(() => null), null);
  const installed = await runInstall(f);
  assert.equal(installed.reloadRequired, true);
  const patched = await fs.readFile(f.html, 'utf8');
  assert.ok(patched.indexOf('src="./ocean-window/ocean-window.js"') > patched.indexOf('src="./workbench.js"'));
  assert.equal(patched.match(/<meta[^>]*>/)[0], originalHtml.match(/<meta[^>]*>/)[0]);
  assert.equal(await fs.readFile(installed.backup, 'utf8'), originalHtml);
  const built = await fs.readFile(path.join(installed.payload, 'ocean-window.js'), 'utf8');
  assert.match(built, /^globalThis\.__oceanWindowConfig = /);
  assert.match(built, /"photos":\[/);
  assert.match(built, /"source":"wikimedia"/);
  assert.ok(built.indexOf('globalThis.__oceanSource') > built.indexOf('globalThis.__oceanWindowConfig'));
  assert.ok(built.indexOf('globalThis.fixtureConfig') > built.indexOf('globalThis.__oceanSource'));
  assert.deepEqual(await fs.readdir(path.join(installed.payload, 'assets')), ['photos.json']);
  await runInstall({ ...f, uninstall: true });
  assert.equal(await fs.readFile(f.html, 'utf8'), originalHtml);
  assert.equal(await fs.stat(installed.payload).catch(() => null), null);
  assert.equal((await runInstall({ ...f, uninstall: true })).changed, false);
});

test('reinstall is idempotent and uninstall keeps unrelated later HTML edits', async t => {
  const f = await fixture(t);
  await runInstall(f);
  const first = await fs.readFile(f.html, 'utf8');
  await runInstall(f);
  assert.equal(await fs.readFile(f.html, 'utf8'), first);
  await fs.writeFile(f.html, first.replace('<body>', '<body data-user-edit="keep">'));
  await runInstall({ ...f, uninstall: true });
  assert.equal(await fs.readFile(f.html, 'utf8'), originalHtml.replace('<body>', '<body data-user-edit="keep">'));
});

test('invalid input fails before creating backups or installing files', async t => {
  const f = await fixture(t);
  const manifest = path.join(f.sourceRoot, 'assets', 'photos.json');
  await fs.writeFile(manifest, (await fs.readFile(manifest, 'utf8')).replace('upload.wikimedia.org', 'other.example'));
  await assert.rejects(runInstall(f), /photo.imageUrl/);
  assert.equal(await fs.readFile(f.html, 'utf8'), originalHtml);
  assert.deepEqual(await fs.readdir(f.workbenchDir), ['workbench.html']);
});

test('uninstall refuses to delete an unrelated file in the payload directory', async t => {
  const f = await fixture(t);
  const installed = await runInstall(f);
  const before = await fs.readFile(f.html, 'utf8');
  await fs.writeFile(path.join(installed.payload, 'unrelated.txt'), 'keep');
  await assert.rejects(runInstall({ ...f, uninstall: true }), /unrelated files/);
  assert.equal(await fs.readFile(f.html, 'utf8'), before);
  assert.equal(await fs.readFile(path.join(installed.payload, 'unrelated.txt'), 'utf8'), 'keep');
});

test('an HTML commit failure rolls back to the preceding payload and HTML', async t => {
  const f = await fixture(t);
  const installed = await runInstall(f);
  const beforeHtml = await fs.readFile(f.html);
  const beforeJs = await fs.readFile(path.join(installed.payload, 'ocean-window.js'));
  await fs.writeFile(path.join(f.sourceRoot, 'src', 'ocean-window.js'), 'globalThis.updatedFixture = true;');
  const actualRename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === f.html && path.basename(from).startsWith('.ocean-window-html-')) throw new Error('Injected HTML commit failure');
    return actualRename(from, to);
  };
  try { await assert.rejects(runInstall(f), /Injected HTML commit failure/); }
  finally { fs.rename = actualRename; }
  assert.deepEqual(await fs.readFile(f.html), beforeHtml);
  assert.deepEqual(await fs.readFile(path.join(installed.payload, 'ocean-window.js')), beforeJs);
  assert.equal((await fs.readdir(f.workbenchDir)).some(name => name.startsWith('.ocean-window-')), false);
});

test('transient Windows sharing failures during a built payload rename are retried', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const destination = path.join(f.sourceRoot, 'dist', 'ocean-window');
  const actualRename = fs.rename;
  let attempts = 0;
  fs.rename = async (from, to) => {
    if (to === destination && path.basename(from).startsWith('.ocean-window-stage-')) {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('Injected temporary directory sharing failure'), { code: 'EPERM' });
    }
    return actualRename(from, to);
  };
  let installed;
  try { installed = await runInstall(f); }
  finally { fs.rename = actualRename; }
  assert.equal(attempts, 3);
  assert.equal(installed.reloadRequired, true);
  assert.match(await fs.readFile(f.html, 'utf8'), /OCEAN-WINDOW:START/);
  assert.deepEqual(await fs.readdir(path.join(f.sourceRoot, 'dist')), ['ocean-window']);
});

test('persistent Windows payload sharing failures stop after bounded retries and restore the preceding installation', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const installed = await runInstall({ ...f, skipDist: true });
  const beforeHtml = await fs.readFile(f.html);
  const beforeJs = await fs.readFile(path.join(installed.payload, 'ocean-window.js'));
  await fs.writeFile(path.join(f.sourceRoot, 'src', 'ocean-window.js'), 'globalThis.updatedFixture = true;');
  const actualRename = fs.rename;
  let attempts = 0;
  fs.rename = async (from, to) => {
    if (to === installed.payload && path.basename(from).startsWith('.ocean-window-stage-')) {
      attempts++;
      throw Object.assign(new Error('Injected persistent directory sharing failure'), { code: 'EPERM' });
    }
    return actualRename(from, to);
  };
  try { await assert.rejects(runInstall({ ...f, skipDist: true }), /Injected persistent directory sharing failure/); }
  finally { fs.rename = actualRename; }
  assert.equal(attempts, 4);
  assert.deepEqual(await fs.readFile(f.html), beforeHtml);
  assert.deepEqual(await fs.readFile(path.join(installed.payload, 'ocean-window.js')), beforeJs);
  assert.equal((await fs.readdir(f.workbenchDir)).some(name => name.startsWith('.ocean-window-')), false);
});

test('extension configuration applies without writing into its installed package', async t => {
  const f = await fixture(t);
  const configPath = path.join(f.sourceRoot, 'config.json');
  const original = await fs.readFile(configPath);
  const result = await runInstall({ ...f, skipDist: true, configOverride: { intervalMinutes: 7, brightness: .6 } });
  assert.equal(result.dist, undefined);
  assert.equal(await fs.stat(path.join(f.sourceRoot, 'dist')).catch(() => null), null);
  assert.deepEqual(await fs.readFile(configPath), original);
  assert.match(await fs.readFile(path.join(result.payload, 'ocean-window.js'), 'utf8'), /"intervalMinutes":7,"brightness":0.6/);
});

test('a live native operation lock blocks competing mutations but never read-only inspection', async t => {
  const f = await fixture(t);
  const lock = `${f.html}.ocean-window.lock`;
  await fs.writeFile(lock, JSON.stringify({ owner: 'vscode-ocean-window', pid: process.pid, token: 'fixture' }));
  await runInstall({ ...f, dryRun: true });
  await assert.rejects(runInstall(f), /Another Ocean Window operation/);
  assert.equal(await fs.readFile(f.html, 'utf8'), originalHtml);
  await fs.unlink(lock);
  await runInstall({ ...f, skipDist: true });
  assert.equal(await fs.stat(lock).catch(() => null), null);
});
