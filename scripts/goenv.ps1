# Dot-source this to get a working, sandbox-contained Go environment.
#   . .\scripts\goenv.ps1
# Everything Go writes (build cache, module cache, GOPATH, temp) lives inside
# the workspace, because the DSH file sandbox only allows writes there.

$ReadSRoot = Split-Path -Parent $PSScriptRoot
$Toolchain = Join-Path $ReadSRoot '.toolchain'

$env:GOROOT = Join-Path $Toolchain 'go'
$env:PATH = (Join-Path $env:GOROOT 'bin') + ';' + $env:PATH

$env:GOPATH = Join-Path $Toolchain 'gopath'
$env:GOMODCACHE = Join-Path $Toolchain 'gomodcache'
$env:GOCACHE = Join-Path $Toolchain 'gocache'
$env:GOTMPDIR = Join-Path $Toolchain 'tmp'
$env:GOENV = Join-Path $Toolchain 'goenv'
$env:GOBIN = Join-Path $Toolchain 'bin'

foreach ($d in @($env:GOPATH, $env:GOMODCACHE, $env:GOCACHE, $env:GOTMPDIR, $env:GOBIN)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
}

# Network: proxy.golang.org and sum.golang.org are unreachable here; goproxy.cn works.
$env:GOPROXY = 'https://goproxy.cn,direct'
$env:GOSUMDB = 'off'
$env:GONOSUMDB = '*'
$env:GOFLAGS = '-mod=mod'
$env:GOTOOLCHAIN = 'local'

$env:GO111MODULE = 'on'
# Keep the toolchain quiet about telemetry and the standard toolchain path.
$env:GOTELEMETRY = 'off'
