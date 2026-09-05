import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'vscode-ocean-window';
const OWNER_FILE = '.ocean-window-owner.json';
const START = '<!-- OCEAN-WINDOW:START -->';
const END = '<!-- OCEAN-WINDOW:END -->';
const PAYLOAD_NAME = 'ocean-window';

async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function regularFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${file}`);
  return stat;
}

export async function resolveAppRoot(explicit, resolution = {}) {
  if (explicit) return fs.realpath(path.resolve(explicit));
  const platform = resolution.platform || process.platform;
  const environment = resolution.environment || process.env;
  const userHome = resolution.userHome || os.homedir();
  const pathEntries = (environment.PATH || '').split(path.delimiter).filter(Boolean);
  if (platform === 'win32') {
    const candidates = [...pathEntries.map(directory => path.join(directory, 'code-insiders.cmd')),
      path.join(environment.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local'), 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd')];
    for (const command of [...new Set(candidates)]) {
      if (!await exists(command)) continue;
      const text = await fs.readFile(command, 'utf8');
      const match = text.match(/%~dp0([^"\r\n]*resources[\\/]app)[\\/]out[\\/]cli\.js/i);
      if (!match) continue;
      return fs.realpath(path.resolve(path.dirname(command), match[1].replace(/[\\/]/g, path.sep)));
    }
  } else {
    // Resolve launcher symlinks without executing a shell or a VS Code process.
    const roots = [];
    for (const directory of pathEntries) {
      const command = path.join(directory, 'code-insiders');
      if (!await exists(command)) continue;
      const launcher = await fs.realpath(command);
      roots.push(path.resolve(path.dirname(launcher), '..', 'resources', 'app'),
        path.resolve(path.dirname(launcher), '..'));
    }
    roots.push(...(platform === 'darwin'
      ? [path.join('/Applications', 'Visual Studio Code - Insiders.app', 'Contents', 'Resources', 'app'),
        path.join(userHome, 'Applications', 'Visual Studio Code - Insiders.app', 'Contents', 'Resources', 'app')]
      : ['/usr/share/code-insiders/resources/app', '/usr/lib/code-insiders/resources/app']));
    for (const candidate of [...new Set(roots)]) {
      if (!await exists(candidate)) continue;
      const root = await fs.realpath(candidate);
      try { await locateWorkbench(root); return root; }
      catch (error) { if (!error.message.startsWith('Cannot find workbench HTML under ')) throw error; }
    }
  }
  throw new Error('Cannot resolve VS Code Insiders. Pass --app-root with its resources/app directory (macOS: Contents/Resources/app).');
}

async function locateWorkbench(appRoot) {
  for (const kind of ['electron-browser', 'electron-sandbox']) {
    for (const name of ['workbench.html', 'workbench.esm.html']) {
      const candidate = path.join(appRoot, 'out', 'vs', 'code', kind, 'workbench', name);
      if (await exists(candidate)) {
        await regularFile(candidate);
        const resolved = await fs.realpath(candidate);
        if (!inside(appRoot, resolved)) throw new Error('Workbench resolves outside the selected app root.');
        return resolved;
      }
    }
  }
  throw new Error(`Cannot find workbench HTML under ${appRoot}`);
}

function removeBlock(html) {
  const starts = html.split(START).length - 1;
  const ends = html.split(END).length - 1;
  if (starts === 0 && ends === 0) return { html, installed: false };
  if (starts !== 1 || ends !== 1 || html.indexOf(END) < html.indexOf(START)) {
    throw new Error('Ocean Window markers are incomplete or duplicated; refusing to modify HTML.');
  }
  const from = html.indexOf(START);
  let to = html.indexOf(END) + END.length;
  if (html.slice(to, to + 2) === '\r\n') to += 2;
  else if (html[to] === '\n') to += 1;
  return { html: html.slice(0, from) + html.slice(to), installed: true };
}

function cspTags(html) {
  return (html.match(/<meta\b[^>]*>/gi) || []).filter(tag => /http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag));
}

function validateCsp(html) {
  const tags = cspTags(html);
  if (tags.length !== 1) throw new Error('Expected exactly one existing Content-Security-Policy meta tag.');
  const attributes = Object.fromEntries([...tags[0].matchAll(/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(match => [match[1].toLowerCase(), match[3]]));
  const directives = Object.fromEntries((attributes.content || '').split(';').map(value => value.trim().split(/\s+/)).filter(parts => parts[0]).map(([key, ...values]) => [key, values]));
  for (const resource of ['script', 'style']) {
    const values = directives[`${resource}-src-elem`] || directives[`${resource}-src`] || directives['default-src'] || [];
    if (!values.includes("'self'")) throw new Error(`Existing CSP does not permit local ${resource} resources; no policy changes will be made.`);
  }
  for (const [resource, origin] of [['img', 'https://upload.wikimedia.org'], ['img', 'https://thumb.wikimedia.org'], ['connect', 'https://commons.wikimedia.org']]) {
    const values = directives[`${resource}-src`] || directives['default-src'] || [];
    if (!values.includes('https:') && !values.includes(origin)) throw new Error(`Existing CSP does not permit ${resource} access to ${origin}; no policy changes will be made.`);
  }
}

function injectBlock(html) {
  const { html: clean } = removeBlock(html);
  validateCsp(clean);
  const closing = [...clean.matchAll(/<\/html\s*>/gi)];
  const scripts = [...clean.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)];
  if (closing.length !== 1 || scripts.length === 0 || !scripts.some(match => /\bsrc\s*=\s*["'][^"']*workbench[^"']*\.js["']/i.test(match[0]))) {
    throw new Error('Workbench startup structure is unfamiliar; refusing to modify HTML.');
  }
  const index = closing[0].index;
  if (scripts.some(match => match.index >= index)) throw new Error('Unexpected script after closing HTML.');
  const newline = clean.includes('\r\n') ? '\r\n' : '\n';
  const block = [START,
    '<link rel="stylesheet" href="./ocean-window/ocean-window.css">',
    '<script src="./ocean-window/ocean-window.js" defer></script>', END, ''].join(newline);
  const patched = clean.slice(0, index) + block + clean.slice(index);
  if (JSON.stringify(cspTags(patched)) !== JSON.stringify(cspTags(html))) throw new Error('CSP preservation check failed.');
  return patched;
}

function textValue(value, label, limit = 1000) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > limit) throw new Error(`Invalid ${label}`);
}

async function readPayload(sourceRoot, configOverride) {
  const configPath = path.join(sourceRoot, 'config.json');
  const manifestPath = path.join(sourceRoot, 'assets', 'photos.json');
  const cssPath = path.join(sourceRoot, 'src', 'ocean-window.css');
  const providerPath = path.join(sourceRoot, 'src', 'wikimedia-source.js');
  const jsPath = path.join(sourceRoot, 'src', 'ocean-window.js');
  await Promise.all([configPath, manifestPath, cssPath, providerPath, jsPath].map(regularFile));
  const [defaults, photos, css, providerJs, sourceJs] = await Promise.all([
    fs.readFile(configPath, 'utf8').then(JSON.parse), fs.readFile(manifestPath, 'utf8').then(JSON.parse),
    fs.readFile(cssPath), fs.readFile(providerPath, 'utf8'), fs.readFile(jsPath, 'utf8')]);
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) throw new Error('config.json must contain an object.');
  if (configOverride !== undefined && (!configOverride || typeof configOverride !== 'object' || Array.isArray(configOverride))) throw new Error('configOverride must be an object.');
  const config = { ...defaults, ...configOverride };
  if (!Number.isFinite(config.intervalMinutes) || config.intervalMinutes < 1 || config.intervalMinutes > 1440) throw new Error('intervalMinutes must be between 1 and 1440.');
  if (!Number.isFinite(config.brightness) || config.brightness < 0 || config.brightness > 1) throw new Error('brightness must be between 0 and 1.');
  if (typeof config.enabled !== 'boolean' || typeof config.showCaption !== 'boolean') throw new Error('enabled and showCaption must be booleans.');
  if (config.source !== 'wikimedia') throw new Error('source must be wikimedia.');
  if (!Number.isFinite(config.refreshHours) || config.refreshHours < 1 || config.refreshHours > 168) throw new Error('refreshHours must be between 1 and 168.');
  if (!Number.isInteger(config.targetPhotoCount) || config.targetPhotoCount < 1 || config.targetPhotoCount > 200) throw new Error('targetPhotoCount must be an integer between 1 and 200.');
  if (!Array.isArray(photos) || photos.length === 0 || photos.length > 100) throw new Error('photos.json must contain 1 to 100 photos.');
  const files = new Map([['ocean-window.css', css]]);
  const ids = new Set();
  for (const photo of photos) {
    if (!photo || typeof photo !== 'object') throw new Error('Invalid photo metadata.');
    for (const field of ['id', 'label', 'country', 'imageUrl', 'sourceUrl', 'author', 'license', 'licenseUrl', 'position']) textValue(photo[field], `photo.${field}`);
    if (ids.has(photo.id)) throw new Error('Photo IDs must be unique.');
    ids.add(photo.id);
    for (const field of ['sourceUrl', 'licenseUrl']) if (new URL(photo[field]).protocol !== 'https:') throw new Error(`photo.${field} must be HTTPS.`);
    const imageUrl = new URL(photo.imageUrl);
    if (imageUrl.protocol !== 'https:' || !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(imageUrl.hostname) || !imageUrl.pathname.startsWith('/wikipedia/commons/') || !/\.jpe?g$/i.test(imageUrl.pathname) || imageUrl.username || imageUrl.password || imageUrl.port) throw new Error('photo.imageUrl must be a Wikimedia Commons HTTPS JPEG on upload.wikimedia.org or thumb.wikimedia.org.');
  }
  const bootstrap = JSON.stringify({ intervalMinutes: config.intervalMinutes, brightness: config.brightness,
    enabled: config.enabled, showCaption: config.showCaption, source: config.source,
    refreshHours: config.refreshHours, targetPhotoCount: config.targetPhotoCount, photos }).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const js = `globalThis.__oceanWindowConfig = ${bootstrap};\n${providerJs}\n;\n${sourceJs}`;
  new vm.Script(js, { filename: 'ocean-window.js' });
  if (css.length === 0) throw new Error('Ocean Window CSS is empty.');
  files.set('ocean-window.js', Buffer.from(js));
  files.set('assets/photos.json', Buffer.from(`${JSON.stringify(photos, null, 2)}\n`));
  files.set(OWNER_FILE, Buffer.from(`${JSON.stringify({ owner: OWNER, version: 1, files: [...files.keys()].sort() }, null, 2)}\n`));
  return { files, photoCount: photos.length, config };
}

// Only directories with our marker and exactly our known regular files may be replaced or removed.
async function inspectOwned(directory) {
  if (!await exists(directory)) return false;
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Refusing non-directory or symlink payload: ${directory}`);
  const markerPath = path.join(directory, OWNER_FILE);
  await regularFile(markerPath);
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  if (marker.owner !== OWNER || marker.version !== 1 || !Array.isArray(marker.files)) throw new Error(`Unrecognized payload owner: ${directory}`);
  const expected = new Set([...marker.files, OWNER_FILE]);
  if (expected.size !== marker.files.length + 1) throw new Error('Duplicate payload file records.');
  for (const name of expected) if (!/^(?:ocean-window\.(?:js|css)|assets\/(?:photos\/)?[a-z\d][a-z\d._-]*\.(?:jpe?g|json)|\.ocean-window-owner\.json)$/i.test(name)) throw new Error(`Unsafe payload record: ${name}`);
  const actual = [];
  async function visit(relative = '') {
    for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Payload has a symlink: ${name}`);
      if (entry.isFile()) actual.push(name);
      else if (entry.isDirectory() && ['assets', 'assets/photos'].includes(name)) {
        if (![...expected].some(file => file.startsWith(`${name}/`))) throw new Error(`Unexpected empty payload folder: ${name}`);
        await visit(name);
      } else {
        throw new Error(`Unexpected payload entry: ${name}`);
      }
    }
  }
  await visit();
  if (actual.length !== expected.size || actual.some(name => !expected.has(name))) throw new Error(`Payload contains missing or unrelated files: ${directory}`);
  return true;
}

async function removeOwned(directory, parent) {
  const absolute = path.resolve(directory);
  const absoluteParent = await fs.realpath(parent);
  if (!inside(absoluteParent, absolute) || path.dirname(absolute) !== absoluteParent) throw new Error('Payload removal is outside its expected parent.');
  if (!await inspectOwned(absolute)) return;
  const marker = JSON.parse(await fs.readFile(path.join(absolute, OWNER_FILE), 'utf8'));
  for (const name of marker.files) await fs.unlink(path.join(absolute, name));
  if (await exists(path.join(absolute, 'assets', 'photos'))) await fs.rmdir(path.join(absolute, 'assets', 'photos'));
  if (await exists(path.join(absolute, 'assets'))) await fs.rmdir(path.join(absolute, 'assets'));
  await fs.unlink(path.join(absolute, OWNER_FILE));
  await fs.rmdir(absolute);
}

async function writeStage(parent, files) {
  const directory = await fs.mkdtemp(path.join(parent, '.ocean-window-stage-'));
  await fs.mkdir(path.join(directory, 'assets'));
  const nestedPhotos = [...files.keys()].some(name => name.startsWith('assets/photos/'));
  if (nestedPhotos) await fs.mkdir(path.join(directory, 'assets', 'photos'));
  try {
    for (const [name, data] of files) await fs.writeFile(path.join(directory, name), data, { flag: 'wx' });
    return directory;
  } catch (error) {
    // Remove only the exact entries this operation could have created, never recurse.
    for (const name of files.keys()) if (await exists(path.join(directory, name))) await fs.unlink(path.join(directory, name));
    if (nestedPhotos) await fs.rmdir(path.join(directory, 'assets', 'photos'));
    await fs.rmdir(path.join(directory, 'assets'));
    await fs.rmdir(directory);
    throw error;
  }
}

async function atomicWrite(file, data, mode) {
  const temporary = path.join(path.dirname(file), `.ocean-window-html-${crypto.randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx', mode);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally {
    if (await exists(temporary)) await fs.unlink(temporary);
  }
}

async function renamePayload(from, to) {
  // Windows can briefly deny a directory rename while a scanner holds a child
  // handle. Retry only these sharing errors, with a strict 175 ms total delay.
  const delays = [25, 50, 100];
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(from, to); return; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= delays.length) throw error;
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }
}

async function replaceBuiltPayload(parent, files) {
  const destination = path.join(parent, PAYLOAD_NAME);
  const hadOld = await inspectOwned(destination);
  const stage = await writeStage(parent, files);
  const previous = path.join(parent, `.ocean-window-previous-${crypto.randomUUID()}`);
  if (hadOld) await renamePayload(destination, previous);
  try { await renamePayload(stage, destination); } catch (error) {
    if (hadOld) await renamePayload(previous, destination);
    await removeOwned(stage, parent);
    throw error;
  }
  if (hadOld) await removeOwned(previous, parent);
  return destination;
}

async function runInstallUnlocked(options = {}) {
  const sourceRoot = await fs.realpath(options.sourceRoot || SOURCE_ROOT);
  const appRoot = await resolveAppRoot(options.appRoot);
  const htmlPath = await locateWorkbench(appRoot);
  const workbenchDir = path.dirname(htmlPath);
  const target = path.join(workbenchDir, PAYLOAD_NAME);
  const backup = `${htmlPath}.ocean-window.bak`;
  const htmlStat = await regularFile(htmlPath);
  const original = await fs.readFile(htmlPath);
  const text = original.toString('utf8');
  if (!Buffer.from(text).equals(original)) throw new Error('Workbench HTML is not valid UTF-8.');
  const current = removeBlock(text);
  const hadPayload = await inspectOwned(target);
  const payload = options.uninstall ? undefined : await readPayload(sourceRoot, options.configOverride);
  const next = options.uninstall ? current.html : injectBlock(text);
  const distParent = path.join(sourceRoot, 'dist');
  if (!options.uninstall && !options.skipDist && await exists(distParent)) {
    const distStat = await fs.lstat(distParent);
    if (!distStat.isDirectory() || distStat.isSymbolicLink()) throw new Error('dist must be a regular directory.');
    await inspectOwned(path.join(distParent, PAYLOAD_NAME));
  }
  if (await exists(backup)) await regularFile(backup);
  const report = { ok: true, action: options.uninstall ? 'uninstall' : 'install', dryRun: !!options.dryRun,
    appRoot, workbench: htmlPath, payload: target, backup, previouslyInstalled: current.installed,
    changed: options.uninstall ? current.installed || hadPayload : true, cspPreserved: true,
    ...(payload ? { photoCount: payload.photoCount, ...(!options.skipDist ? { dist: path.join(distParent, PAYLOAD_NAME) } : {}) } : {}), warnings: [] };
  if (options.dryRun || !report.changed) return report;
  if (!options.uninstall && !options.skipDist) {
    await fs.mkdir(distParent, { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await replaceBuiltPayload(distParent, payload.files);
  }
  if (!(await fs.readFile(htmlPath)).equals(original)) throw new Error('Workbench HTML changed during preparation; retry without overwriting the concurrent change.');
  if (!options.uninstall && !await exists(backup)) await fs.writeFile(backup, original, { flag: 'wx', mode: htmlStat.mode });
  const stage = options.uninstall ? undefined : await writeStage(workbenchDir, payload.files);
  const previous = path.join(workbenchDir, `.ocean-window-previous-${crypto.randomUUID()}`);
  let movedOld = false;
  let placedNew = false;
  try {
    if (hadPayload) { await renamePayload(target, previous); movedOld = true; }
    if (stage) { await renamePayload(stage, target); placedNew = true; }
    // HTML switches last, after the complete local payload is available.
    if (!(await fs.readFile(htmlPath)).equals(original)) throw new Error('Workbench HTML changed before commit; preserving the concurrent change.');
    await atomicWrite(htmlPath, next, htmlStat.mode);
  } catch (error) {
    if (placedNew) await removeOwned(target, workbenchDir);
    if (movedOld) await renamePayload(previous, target);
    if (stage && await exists(stage)) await removeOwned(stage, workbenchDir);
    throw error;
  }
  if (movedOld) {
    try { await removeOwned(previous, workbenchDir); } catch (error) { report.warnings.push(`Previous owned payload remains at ${previous}: ${error.message}`); }
  }
  report.backupExists = await exists(backup);
  report.reloadRequired = true;
  return report;
}

// Serialize CLI, extension windows, and the uninstall hook against this exact workbench.
async function runInstallWithLock(options) {
  if (options.dryRun) return runInstallUnlocked(options);
  const appRoot = await resolveAppRoot(options.appRoot);
  const htmlPath = await locateWorkbench(appRoot);
  const lockPath = `${htmlPath}.ocean-window.lock`;
  const token = crypto.randomUUID();
  const content = JSON.stringify({ owner: OWNER, pid: process.pid, token });
  let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { handle = await fs.open(lockPath, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await regularFile(lockPath);
      const oldText = await fs.readFile(lockPath, 'utf8');
      let lock;
      try { lock = JSON.parse(oldText); } catch { throw new Error(`Unrecognized Ocean Window lock: ${lockPath}`); }
      if (lock.owner !== OWNER || !Number.isInteger(lock.pid) || lock.pid <= 0) throw new Error(`Unrecognized Ocean Window lock: ${lockPath}`);
      let alive = true;
      try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive || attempt > 0) throw new Error('Another Ocean Window operation is active. Please retry after it finishes.');
      if (await fs.readFile(lockPath, 'utf8') !== oldText) throw new Error('Ocean Window lock changed; please retry.');
      await fs.unlink(lockPath);
    }
  }
  if (!handle) throw new Error('Unable to acquire Ocean Window lock.');
  try {
    await handle.writeFile(content);
    await handle.close();
    return await runInstallUnlocked({ ...options, appRoot });
  } finally {
    await handle.close().catch(() => {});
    if (await fs.readFile(lockPath, 'utf8').catch(() => '') === content) await fs.unlink(lockPath);
  }
}

export async function runInstall(options = {}) {
  const appRoot = await resolveAppRoot(options.appRoot);
  try { return await runInstallWithLock({ ...options, appRoot }); }
  catch (error) {
    const failurePath = typeof error.path === 'string' ? path.resolve(error.path) : undefined;
    if (!['EACCES', 'EPERM', 'EROFS'].includes(error.code) || !failurePath ||
        (failurePath !== appRoot && !inside(appRoot, failurePath))) throw error;
    const reason = error.code === 'EROFS' ? 'is on a read-only filesystem' : 'does not allow this user to write its files';
    const explained = new Error(`The VS Code application ${reason}: ${appRoot}. Ocean Window needs write access to that installation. Use a user-writable installation; for Linux, the official .tar.gz archive extracted into your home directory is one option. A read-only Snap installation cannot be patched. No permissions are changed automatically. Original error: ${error.message}`, { cause: error });
    explained.code = error.code;
    explained.path = error.path;
    explained.appRoot = appRoot;
    explained.oceanWindowNativeAccessError = true;
    throw explained;
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--uninstall') options.uninstall = true;
    else if (arg === '--app-root' && args[index + 1] && !args[index + 1].startsWith('--')) options.appRoot = args[++index];
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await runInstall(parseArgs(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stdout.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`); process.exitCode = 1; }
}
