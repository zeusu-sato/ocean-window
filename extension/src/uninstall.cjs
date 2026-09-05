'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { validateReceipts } = require('./legacy.cjs');

async function runUninstall(extensionRoot = path.resolve(__dirname, '..'), loadInstaller) {
  const root = await fs.realpath(extensionRoot);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const id = `${manifest.publisher}.${manifest.name}`;
  if (!/^[a-z0-9][a-z0-9.-]+$/i.test(id)) throw new Error('Invalid extension identity');
  const registryDir = path.join(path.dirname(root), '.ocean-window');
  const receiptPath = path.join(registryDir, `${id}.json`);
  const lockPath = `${receiptPath}.lock`;
  let receiptText;
  try {
    const dir = await fs.lstat(registryDir);
    const stat = await fs.lstat(receiptPath);
    if (!dir.isDirectory() || dir.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Unexpected restore receipt path');
    receiptText = await fs.readFile(receiptPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { restored: 0, skipped: 0, noReceipt: true };
    throw error;
  }
  const token = crypto.randomUUID();
  const lockText = JSON.stringify({ pid: process.pid, createdAt: Date.now(), token });
  let lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { lock = await fs.open(lockPath, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.lstat(lockPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unexpected restore lock');
      const previousText = await fs.readFile(lockPath, 'utf8');
      const previous = JSON.parse(previousText);
      if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw new Error('Invalid restore lock');
      let alive = true;
      try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive || attempt > 0) throw new Error('Ocean Window is busy. Restore Original Editor before uninstalling.');
      if (await fs.readFile(lockPath, 'utf8') !== previousText) throw new Error('Restore lock changed');
      await fs.unlink(lockPath);
    }
  }
  if (!lock) throw new Error('Cannot acquire restore lock');
  const report = { restored: 0, alreadyClean: 0, skipped: 0, errors: [] };
  try {
    await lock.writeFile(lockText);
    await lock.close();
    const receipt = validateReceipts(JSON.parse(await fs.readFile(receiptPath, 'utf8')));
    const sourceRoot = path.join(root, 'runtime');
    const installer = await (loadInstaller ? loadInstaller() : import(pathToFileURL(path.join(sourceRoot, 'tools', 'install.mjs')).href));
    for (const record of receipt.installs) {
      if (!['pending-enable', 'enabled', 'pending-disable', 'disabled'].includes(record.state) ||
          typeof record.appRoot !== 'string' || !path.isAbsolute(record.appRoot) ||
          typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) throw new Error('Invalid restore record');
      if (record.state === 'disabled') { report.skipped++; continue; }
      // An updater may already have removed this exact former application directory.
      try { await fs.access(record.appRoot); }
      catch (error) {
        if (error.code === 'ENOENT') report.skipped++;
        else report.errors.push({ appRoot: record.appRoot, error: error.message });
        continue;
      }
      try {
        const options = { sourceRoot, appRoot: record.appRoot, uninstall: true, skipDist: true };
        const plan = await installer.runInstall({ ...options, dryRun: true });
        if (plan.changed) {
          await installer.runInstall(options);
          report.restored++;
        } else {
          // 0.2.x wrote pending-enable before attempting native writes. Retire
          // that receipt without creating a lock in a clean root-owned app.
          report.alreadyClean++;
        }
      }
      catch (error) { report.errors.push({ appRoot: record.appRoot, error: error.message }); continue; }
      record.state = 'disabled';
      record.updatedAt = new Date(Math.max(Date.now(), Date.parse(record.updatedAt) + 1)).toISOString();
      // Persist each successful restore so a hook interrupted by VS Code's timeout can resume.
      const temp = `${receiptPath}.${token}.tmp`;
      try {
        await fs.writeFile(temp, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
        await fs.rename(temp, receiptPath);
      } finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    if (report.errors.length) {
      const error = new Error(`${report.errors.length} installation(s) could not be restored: ${report.errors.map(item => item.error).join('; ')}`);
      error.report = report;
      throw error;
    }
    return report;
  } finally {
    await lock.close().catch(() => {});
    if (await fs.readFile(lockPath, 'utf8').catch(() => '') === lockText) await fs.unlink(lockPath);
  }
}

module.exports = { runUninstall };
if (require.main === module) {
  runUninstall().then(report => console.log(JSON.stringify(report))).catch(error => {
    if (error.report) console.error(JSON.stringify(error.report));
    console.error(`Ocean Window restore: ${error.message}`);
    process.exitCode = 1;
  });
}
