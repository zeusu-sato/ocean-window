[CmdletBinding()]
param(
    [int]$DebugPort = 9451,
    [switch]$PrepareOnly,
    [switch]$EnableExtensions
)

$ErrorActionPreference = 'Stop'
$workspaceDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testDirectory = Join-Path $workspaceDirectory '.test-app'
$profileDirectory = Join-Path $workspaceDirectory '.test-profile-native'
$extensionsDirectory = Join-Path $workspaceDirectory '.test-extensions-native'
$sourceInstall = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code Insiders'

# Hardlinks are used only for immutable inputs. Files patched by the installer
# and this private product configuration must always be independent copies.
$preparationScript = @'
import fs from 'node:fs/promises';
import path from 'node:path';
const [workspace, sourceInstall] = process.argv.slice(2);
const destination = path.join(workspace, '.test-app');
const wrapper = await fs.readFile(path.join(sourceInstall, 'bin', 'code-insiders.cmd'), 'utf8');
const version = wrapper.match(/%~dp0\.\.\\([^\\"]+)\\resources\\app\\out\\cli\.js/i)?.[1];
if (!version || !/^[a-f\d]+$/i.test(version)) throw new Error('Cannot resolve active Insiders version.');
const source = path.join(sourceInstall, version);
const ownerPath = path.join(destination, '.ocean-window-native-owner.json');
try {
  await fs.lstat(destination);
  const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
  if (owner.owner !== 'ocean-window-native-test' || owner.version !== version) throw new Error('Existing test app is not the expected owned version.');
  console.log(JSON.stringify({ prepared: true, reused: true, version, executable: path.join(destination, 'Code - Insiders.exe'), appRoot: path.join(destination, 'resources', 'app') }));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  try { await fs.lstat(destination); throw new Error('An incomplete or unrelated .test-app exists; refusing to overwrite it.'); } catch (probe) { if (probe.code !== 'ENOENT') throw probe; }
  await fs.mkdir(destination);
  let linked = 0, copied = 0;
  async function transfer(from, to) {
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      const oldFile = path.join(from, entry.name);
      const newFile = path.join(to, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${oldFile}`);
      if (entry.isDirectory()) { await fs.mkdir(newFile); await transfer(oldFile, newFile); }
      else if (entry.isFile()) {
        const relative = path.relative(source, oldFile).replaceAll('\\', '/');
        if (relative === 'resources/app/product.json' || /\/workbench\/workbench(?:\.esm)?\.html$/.test(relative)) { await fs.copyFile(oldFile, newFile); copied++; }
        else { await fs.link(oldFile, newFile); linked++; }
      }
    }
  }
  await transfer(source, destination);
  await fs.link(path.join(sourceInstall, 'Code - Insiders.exe'), path.join(destination, 'Code - Insiders.exe'));
  linked++;
  const productPath = path.join(destination, 'resources', 'app', 'product.json');
  const product = JSON.parse(await fs.readFile(productPath, 'utf8'));
  Object.assign(product, { nameShort: 'Ocean Window Native Test', nameLong: 'Ocean Window Native Test',
    applicationName: 'ocean-window-native-test', win32MutexName: 'ocean-window-native-test',
    win32AppUserModelId: 'OceanWindow.NativeTest', win32VersionedUpdate: false,
    urlProtocol: 'ocean-window-native-test', dataFolderName: '.ocean-window-native-test',
    sharedDataFolderName: '.ocean-window-native-test-shared' });
  delete product.updateUrl;
  await fs.writeFile(productPath, JSON.stringify(product, null, 2));
  await fs.writeFile(ownerPath, JSON.stringify({ owner: 'ocean-window-native-test', source, version, linked, copied }, null, 2));
  console.log(JSON.stringify({ prepared: true, reused: false, version, linked, copied, executable: path.join(destination, 'Code - Insiders.exe'), appRoot: path.join(destination, 'resources', 'app') }));
}
// The installed Electron executable resolves ICU/DLL/resources beneath its
// version hash. Point that layout back to this private tree, never production.
const versionDirectory = path.join(destination, version);
await fs.mkdir(versionDirectory, { recursive: true });
for (const entry of await fs.readdir(source, { withFileTypes: true })) {
  const from = path.join(destination, entry.name);
  const to = path.join(versionDirectory, entry.name);
  try { await fs.lstat(to); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (entry.isDirectory()) await fs.symlink(from, to, 'junction');
  else if (entry.isFile()) await fs.link(from, to);
}
'@
$preparationScript | & node --input-type=module - $workspaceDirectory $sourceInstall
if ($LASTEXITCODE -ne 0) { throw 'Native test application preparation failed.' }
if ($PrepareOnly) { exit 0 }

if (Get-NetTCPConnection -LocalPort $DebugPort -State Listen -ErrorAction SilentlyContinue) {
    throw "Debug port $DebugPort is already occupied; refusing to use another process."
}
New-Item -ItemType Directory -Path (Join-Path $profileDirectory 'User') -Force | Out-Null
New-Item -ItemType Directory -Path $extensionsDirectory -Force | Out-Null
$testSettings = @{
    'update.mode' = 'none'
    'extensions.autoUpdate' = $false
    'extensions.autoCheckUpdates' = $false
    'telemetry.telemetryLevel' = 'off'
    'workbench.startupEditor' = 'none'
    'security.workspace.trust.enabled' = $false
    'window.restoreWindows' = 'none'
    'workbench.colorTheme' = 'Abyss'
}
$testSettings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $profileDirectory 'User\settings.json') -Encoding UTF8
$hadNodeEnvironment = Test-Path Env:\ELECTRON_RUN_AS_NODE
$previousNodeEnvironment = $env:ELECTRON_RUN_AS_NODE
try {
    Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $launchArguments = @('--new-window', '--skip-welcome', '--skip-release-notes',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
        '--disable-updates', '--disable-telemetry', "--remote-debugging-port=$DebugPort",
        '--user-data-dir', ('"' + $profileDirectory + '"'),
        '--extensions-dir', ('"' + $extensionsDirectory + '"'))
    if (-not $EnableExtensions) { $launchArguments += '--disable-extensions' }
    $testProcess = Start-Process -FilePath (Join-Path $testDirectory 'Code - Insiders.exe') -ArgumentList $launchArguments -WindowStyle Hidden -PassThru
    [ordered]@{ launched = $true; processId = $testProcess.Id; debugPort = $DebugPort; profile = $profileDirectory;
        appRoot = (Join-Path $testDirectory 'resources\app'); executable = (Join-Path $testDirectory 'Code - Insiders.exe') } | ConvertTo-Json
} finally {
    if ($hadNodeEnvironment) { $env:ELECTRON_RUN_AS_NODE = $previousNodeEnvironment }
    else { Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
}
