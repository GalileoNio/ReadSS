# Dot-source this to get a working, sandbox-contained pnpm/Node environment.
#   . .\scripts\pnpmenv.ps1
# npm/pnpm caches and the pnpm store default to %LOCALAPPDATA%, which the DSH
# sandbox does not allow us to write, so they are redirected into the workspace.

$ReadSRoot = Split-Path -Parent $PSScriptRoot
$Toolchain = Join-Path $ReadSRoot '.toolchain'

$NodeHome = 'C:\Users\kelon\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node'
$env:PATH = (Join-Path $NodeHome 'bin') + ';' + $env:PATH

$env:PNPM_HOME = Join-Path $Toolchain 'pnpm-home'
$env:npm_config_cache = Join-Path $Toolchain 'npm-cache'
$env:npm_config_store_dir = Join-Path $Toolchain 'pnpm-store'
$env:npm_config_update_notifier = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_audit = 'false'
# pnpm refuses to purge a stale node_modules without a TTY; this sandbox has
# no interactive terminal, so opt into the non-interactive behaviour.
$env:CI = 'true'

foreach ($d in @($env:PNPM_HOME, $env:npm_config_cache, $env:npm_config_store_dir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

# `pnpm` is shipped as an .mjs entrypoint rather than a shim. The store
# location comes from $env:npm_config_store_dir (set above), so no flags are
# needed here — passing --store-dir would collide with subcommands like `run`.
function pnpm {
    & node 'C:\Users\kelon\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs' @args
}
