'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runUninstall } = require('../src/uninstall.cjs');

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'ocean-hook-test-'));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(root)), parent);
    assert.ok(path.basename(root).startsWith('ocean-hook-test-'));
    await fs.rm(root, { recursive: true });
  });
  const extensionRoot = path.join(root, 'preview.ocean-window-0.2.0');
  const registry = path.join(root, '.ocean-window');
  await fs.mkdir(extensionRoot);
  await fs.mkdir(registry);
  await fs.writeFile(path.join(extensionRoot, 'package.json'), JSON.stringify({ publisher: 'preview', name: 'ocean-window' }));
  const appRoot = path.join(root, 'app');
  await fs.mkdir(appRoot);
  const receiptPath = path.join(registry, 'preview.ocean-window.json');
  const receipt = { schemaVersion: 1, installs: [{ appRoot, sourceRoot: '/gone-old-version/runtime', state: 'enabled', updatedAt: new Date().toISOString() }] };
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  return { extensionRoot, receiptPath, appRoot, receipt };
}

test('latest unactivated version restores from stable receipt using its own bundled installer', async t => {
  const f = await fixture(t);
  const calls = [];
  const result = await runUninstall(f.extensionRoot, async () => ({ runInstall: async options => calls.push(options) }));
  assert.equal(result.restored, 1);
  assert.equal(calls[0].sourceRoot, path.join(f.extensionRoot, 'runtime'));
  assert.equal(calls[0].appRoot, f.appRoot);
  assert.equal(calls[0].uninstall, true);
  assert.equal(JSON.parse(await fs.readFile(f.receiptPath, 'utf8')).installs[0].state, 'disabled');
  assert.equal(await fs.stat(`${f.receiptPath}.lock`).catch(() => null), null);
});

test('failed restoration preserves receipt for manual recovery', async t => {
  const f = await fixture(t);
  await assert.rejects(runUninstall(f.extensionRoot, async () => ({ runInstall: async () => { throw new Error('permission denied'); } })), /permission denied/);
  assert.equal(JSON.parse(await fs.readFile(f.receiptPath, 'utf8')).installs[0].state, 'enabled');
  assert.equal(await fs.stat(`${f.receiptPath}.lock`).catch(() => null), null);
});

test('uninstall hook never races a live extension command', async t => {
  const f = await fixture(t);
  const lock = `${f.receiptPath}.lock`;
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
  await assert.rejects(runUninstall(f.extensionRoot, async () => { throw new Error('must not load'); }), /busy/);
  assert.ok(await fs.stat(lock));
});

test('many past Insiders builds do not prevent restoration of the current version', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 110; index++) f.receipt.installs.unshift({ ...f.receipt.installs.at(-1), appRoot: path.join(f.appRoot, `removed-${index}`) });
  await fs.writeFile(f.receiptPath, JSON.stringify(f.receipt));
  let calls = 0;
  const result = await runUninstall(f.extensionRoot, async () => ({ runInstall: async () => { calls++; } }));
  assert.equal(calls, 1);
  assert.equal(result.restored, 1);
  assert.equal(result.skipped, 110);
});

test('an incomplete old install does not block restoration of a healthy current install', async t => {
  const f = await fixture(t);
  const obsolete = path.join(f.appRoot, 'obsolete');
  await fs.mkdir(obsolete);
  f.receipt.installs.unshift({ ...f.receipt.installs[0], appRoot: obsolete });
  await fs.writeFile(f.receiptPath, JSON.stringify(f.receipt));
  await assert.rejects(runUninstall(f.extensionRoot, async () => ({ runInstall: async ({ appRoot }) => {
    if (appRoot === obsolete) throw new Error('old workbench unavailable');
  } })), error => error.report.restored === 1 && error.report.errors.length === 1);
  const after = JSON.parse(await fs.readFile(f.receiptPath, 'utf8'));
  assert.equal(after.installs[0].state, 'enabled');
  assert.equal(after.installs[1].state, 'disabled');
});
