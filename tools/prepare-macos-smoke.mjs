import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

if (process.platform !== 'darwin') throw new Error('This setup requires an actual macOS runner.');
const channel = process.env.OCEAN_SMOKE_CHANNEL || 'stable';
if (!['stable', 'insider'].includes(channel)) throw new Error('Unsupported VS Code channel');
const platform = process.arch === 'arm64' ? 'darwin-arm64' : process.arch === 'x64' ? 'darwin' : undefined;
if (!platform) throw new Error('Unsupported Mac architecture');
const manifest = JSON.parse(await fs.readFile('extension/package.json', 'utf8'));
const version = (process.env.OCEAN_SMOKE_RELEASE || manifest.version).replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a numeric release version');
const directory = await fs.mkdtemp(path.join(await fs.realpath(process.env.RUNNER_TEMP || os.tmpdir()), 'ocean-window-macos-'));
const output = path.resolve('macos-smoke-artifacts');
await fs.mkdir(output, { recursive: true });
async function response(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!result.ok) throw new Error(`Download returned ${result.status}: ${url}`);
  return result;
}
async function download(url, destination) {
  await pipeline(Readable.fromWeb((await response(url)).body), createWriteStream(destination, { flags: 'wx' }));
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const metadata = await (await response(`https://update.code.visualstudio.com/api/update/${platform}/${channel}/latest`)).json();
if (!/^[a-f0-9]{64}$/i.test(metadata.sha256hash) || new URL(metadata.url).protocol !== 'https:') throw new Error('Invalid Microsoft download metadata');
const archive = path.join(directory, 'vscode.zip');
await download(metadata.url, archive);
if (await sha256(archive) !== metadata.sha256hash.toLowerCase()) throw new Error('VS Code archive checksum mismatch');
const applicationDirectory = path.join(directory, 'application');
await fs.mkdir(applicationDirectory);
await promisify(execFile)('ditto', ['-x', '-k', archive, applicationDirectory], { timeout: 120_000 });
const apps = (await fs.readdir(applicationDirectory, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.endsWith('.app'));
if (apps.length !== 1) throw new Error('Expected one downloaded application bundle');
const bundle = path.join(applicationDirectory, apps[0].name);
const appRoot = await fs.realpath(path.join(bundle, 'Contents', 'Resources', 'app'));
const { stdout: executableEntry } = await promisify(execFile)('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(bundle, 'Contents', 'Info.plist')]);
const executableName = executableEntry.trim();
if (!executableName || path.basename(executableName) !== executableName) throw new Error('Invalid bundle executable name');
const executable = await fs.realpath(path.join(bundle, 'Contents', 'MacOS', executableName));
let vsix, expected, extensionSource;
if (process.env.OCEAN_SMOKE_VSIX) {
  vsix = await fs.realpath(path.resolve(process.env.OCEAN_SMOKE_VSIX));
  if (!(await fs.stat(vsix)).isFile() || !vsix.endsWith('.vsix')) throw new Error('Expected a candidate VSIX file');
  expected = await sha256(vsix);
  extensionSource = 'candidate built from the checked-out source';
} else {
  vsix = path.join(directory, `ocean-window-${version}.vsix`);
  const release = `https://github.com/zeusu-sato/ocean-window/releases/download/v${version}`;
  const checksums = await (await response(`${release}/SHA256SUMS.txt`)).text();
  expected = checksums.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[1] === path.basename(vsix))?.[0];
  if (!/^[a-f0-9]{64}$/i.test(expected || '')) throw new Error('Release checksum missing');
  await download(`${release}/${path.basename(vsix)}`, vsix);
  if (await sha256(vsix) !== expected.toLowerCase()) throw new Error('Published VSIX checksum mismatch');
  extensionSource = 'published GitHub release';
}
const report = { platform: process.platform, architecture: process.arch, channel, metadata, extensionVersion: version,
  extensionSource, sourceCommit: process.env.GITHUB_SHA || null, vsixSha256: expected, appRoot, executable, vsix, output };
await fs.writeFile(path.join(output, 'downloads.json'), JSON.stringify(report, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `app_root=${appRoot}\nexecutable=${executable}\nvsix=${vsix}\noutput=${output}\n`);
}
console.log(JSON.stringify(report, null, 2));
