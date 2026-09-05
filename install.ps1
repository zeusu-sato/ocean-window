[CmdletBinding()]
param(
    [string]$AppRoot,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$installerArguments = @((Join-Path $PSScriptRoot 'tools\install.mjs'))
if ($AppRoot) { $installerArguments += @('--app-root', $AppRoot) }
if ($DryRun) { $installerArguments += '--dry-run' }
& node @installerArguments
exit $LASTEXITCODE
