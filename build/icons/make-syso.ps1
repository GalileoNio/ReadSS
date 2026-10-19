# Rebuilds rsrc_windows_amd64.syso from build/icons/appicon.ico.
#
# Wails v3 loads the window icon from resource ID 3; Explorer uses the first
# icon group (ID 1). Both IDs point at the same ICO.
#
#   pwsh -File build/icons/make-syso.ps1
param()

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

. (Join-Path $root 'scripts\goenv.ps1')
$icon = Join-Path $root 'build\icons\appicon.ico'
$out = Join-Path $root 'rsrc_windows_amd64.syso'

Push-Location (Join-Path $PSScriptRoot 'syso-gen')
try {
    go run . $icon $out
    if ($LASTEXITCODE -ne 0) { throw "syso generation failed (exit code $LASTEXITCODE)" }
} finally {
    Pop-Location
}

$item = Get-Item $out
Write-Host ("built {0} ({1:N1} KiB)" -f $item.FullName, ($item.Length / 1KB))
