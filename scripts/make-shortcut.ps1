# Creates (or refreshes) a desktop shortcut for the app.
#
#   pwsh -File scripts/make-shortcut.ps1
#   pwsh -File scripts/make-shortcut.ps1 -Name 'ReadS-test'
#
# The shortcut targets build\bin\ReadS.exe (GUI subsystem, no console window) and
# needs no environment variables: the app detects the portable data directory
# next to the build (build\appdata), so the shortcut opens the same library the
# build scripts use.
#
# Kept ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less scripts as
# ANSI, so non-ASCII source text here would be mangled (it broke parsing once).
param(
    [string]$Name = 'ReadS'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$exe = Join-Path $root 'build\bin\ReadS.exe'
$icon = Join-Path $root 'assets\ReadS.ico'
if (-not (Test-Path $exe)) {
    throw "missing $exe - run scripts\build.ps1 first"
}

$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop -or -not (Test-Path $desktop)) {
    throw 'could not resolve the desktop folder'
}
$linkPath = Join-Path $desktop "$Name.lnk"

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($linkPath)
$link.TargetPath = $exe
$link.WorkingDirectory = $root
if (Test-Path $icon) {
    $link.IconLocation = "$icon,0"
}
# "ReadS - RSS reader" in Chinese, built from code points to keep this file ASCII.
$link.Description = 'ReadS - RSS ' + [string][char]0x9605 + [char]0x8BFB + [char]0x5668
$link.WindowStyle = 1
$link.Save()

Write-Host ("shortcut: {0}" -f $linkPath)
Write-Host ("  target: {0}" -f $exe)
$iconText = if (Test-Path $icon) { $icon } else { 'default (app icon)' }
Write-Host ("  icon  : {0}" -f $iconText)
Write-Host ("  data  : {0}" -f (Join-Path $root 'build\appdata'))
