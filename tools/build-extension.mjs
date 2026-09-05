import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'extension/package.json'), 'utf8'));
const stage = path.join(root, '.build', 'extension');
const args = process.argv.slice(2);
let publisher = manifest.publisher;
let packageVsix = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--package') packageVsix = true;
  else if (args[i] === '--publisher' && args[i + 1]) publisher = args[++i];
  else throw new Error(`Unknown argument: ${args[i]}`);
}
if (!/^[a-z0-9][a-z0-9-]*$/i.test(publisher)) throw new Error('Publisher ID must contain letters, numbers and hyphens.');

const copies = new Map([
  ['extension/src/extension.cjs', 'out/extension.cjs'],
  ['extension/src/uninstall.cjs', 'out/uninstall.cjs'],
  ['extension/package.nls.json', 'package.nls.json'],
  ['extension/package.nls.ja.json', 'package.nls.ja.json'],
  ['extension/README.md', 'README.md'],
  ['extension/CHANGELOG.md', 'CHANGELOG.md'],
  ['extension/SUPPORT.md', 'SUPPORT.md'],
  ['LICENSE', 'LICENSE'],
  ['docs/photo-sources.md', 'PHOTO-CREDITS.md'],
  ['config.json', 'runtime/config.json'],
  ['src/ocean-window.js', 'runtime/src/ocean-window.js'],
  ['src/ocean-window.css', 'runtime/src/ocean-window.css'],
  ['src/wikimedia-source.js', 'runtime/src/wikimedia-source.js'],
  ['tools/install.mjs', 'runtime/tools/install.mjs']
]);
const expected = new Set([...copies.values(), 'package.json', 'runtime/assets/photos.json', 'icon.png', '.vscodeignore']);
async function auditStage(directory, relative = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected stage link: ${name}`);
    if (entry.isDirectory()) await auditStage(path.join(directory, entry.name), name);
    else if (!expected.has(name)) throw new Error(`Unexpected stage file; review before packaging: ${name}`);
  }
}
await auditStage(stage);
for (const [source, destination] of copies) {
  await fs.mkdir(path.dirname(path.join(stage, destination)), { recursive: true });
  await fs.copyFile(path.join(root, source), path.join(stage, destination));
}
manifest.publisher = publisher;
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
const photos = JSON.parse(await fs.readFile(path.join(root, 'assets/photos.json'), 'utf8'));
await fs.mkdir(path.join(stage, 'runtime/assets'), { recursive: true });
await fs.writeFile(path.join(stage, 'runtime/assets/photos.json'), JSON.stringify(photos.map(({ filename, ...photo }) => photo), null, 2) + '\n');
await fs.writeFile(path.join(stage, '.vscodeignore'), '**/*.map\n**/.DS_Store\n');
if (publisher === 'ocean-window-local') {
  const readme = await fs.readFile(path.join(stage, 'README.md'), 'utf8');
  await fs.writeFile(path.join(stage, 'README.md'), '> Local preview package: publisher identity is not finalized. This build has not been published to the Marketplace.\n\n' + readme);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
  const icon = await fs.readFile(path.join(root, 'extension/media/icon.svg'), 'utf8');
  await page.setContent(`<html><body style="margin:0;background:transparent">${icon}</body></html>`);
  await page.screenshot({ path: path.join(stage, 'icon.png'), omitBackground: true });
  await fs.copyFile(path.join(stage, 'icon.png'), path.join(root, 'extension/media/icon.png'));
} finally { await browser.close(); }

const result = { staged: stage, publisher, preview: true, target: 'win32-x64' };
if (packageVsix) {
  const releases = path.join(root, 'releases');
  await fs.mkdir(releases, { recursive: true });
  const output = path.join(releases, `ocean-window-${manifest.version}-win32-x64.vsix`);
  const vsceManifestPath = path.join(root, 'node_modules/@vscode/vsce/package.json');
  const vsceManifest = JSON.parse(await fs.readFile(vsceManifestPath, 'utf8'));
  const cli = path.resolve(path.dirname(vsceManifestPath), vsceManifest.bin.vsce);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'package', '--no-dependencies', '--allow-missing-repository',
      '--target', 'win32-x64', '--pre-release', '--out', output], { cwd: stage, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`vsce exited with ${code}`)));
  });
  result.vsix = output;
}
console.log(JSON.stringify(result, null, 2));
