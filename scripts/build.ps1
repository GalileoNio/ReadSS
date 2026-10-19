# Builds ReadS. Kept as a script so the build is reproducible and so the
# frontend is always rebuilt into frontend/dist before Go embeds it.
#
#   pwsh -File scripts/build.ps1            # release build
#   pwsh -File scripts/build.ps1 -SkipWeb   # Go only (frontend/dist already built)
param(
    [switch]$SkipWeb,
    [string]$Output = 'build\bin\ReadS.exe'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

<#
Runs a native command and fails the script only on a non-zero exit code.

Windows PowerShell 5.1 promotes anything a native command writes to stderr into
a terminating error while $ErrorActionPreference is 'Stop' — and both Vite and
`go vet` legitimately write warnings there. So stderr is collected and echoed
instead of aborting, and the exit code is checked explicitly.
#>
function Invoke-Native {
    param(
        [Parameter(Mandatory)][scriptblock]$Command,
        [Parameter(Mandatory)][string]$What
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Command 2>&1 | ForEach-Object { Write-Host $_ }
    } finally {
        $ErrorActionPreference = $previous
    }

    if ($LASTEXITCODE -ne 0) {
        throw "$What failed (exit code $LASTEXITCODE)"
    }
}

if (-not $SkipWeb) {
    Write-Host '--- building frontend ---'
    . "$PSScriptRoot\pnpmenv.ps1"
    Push-Location "$root\frontend"
    try {
        Invoke-Native { pnpm run build } 'frontend build'
    } finally {
        Pop-Location
    }
}

# Wails resolves bindings by exact Go method name, so a frontend typo such as
# AddFeedByUrl/AddFeedByURL only fails at runtime. Check it on every build.
Write-Host '--- checking binding names ---'
Invoke-Native { node "$PSScriptRoot\check-bindings.mjs" } 'binding check'

# Icon choice is invisible to the type checker: a view tab missing its own glyph
# case silently renders the fallback icon, and one icon can drift into several
# meanings at once. Both are checked against DESIGN.md §7.
Write-Host '--- checking icons ---'
Invoke-Native { node "$PSScriptRoot\check-icons.mjs" } 'icon check'

Write-Host '--- vetting Go ---'
. "$PSScriptRoot\goenv.ps1"

# Format and vet only our own packages; never the toolchain or module cache.
$ours = @('main.go', 'selftest.go', 'cli.go') + (Get-ChildItem "$root\internal" -Recurse -Filter *.go |
    ForEach-Object { $_.FullName })
$unformatted = gofmt -l $ours
if ($unformatted) {
    Write-Host "gofmt: reformatting unformatted files"
    gofmt -w $ours
}

Invoke-Native { go vet ./internal/... . } 'go vet'

Write-Host '--- building ReadS.exe ---'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null

# The desktop app is a GUI-subsystem binary: double-clicking it (or using the
# desktop shortcut) must not open a console window. Logs still go to
# build/appdata/reads.log.
Invoke-Native { go build -trimpath -ldflags '-s -w -H windowsgui' -o $Output . } 'go build'

# A console-subsystem twin keeps --selftest / --subscribe / --probe usable from a
# terminal, where the GUI binary cannot write to stdout.
$cliOutput = Join-Path (Split-Path -Parent $Output) 'ReadS-cli.exe'
Invoke-Native { go build -trimpath -ldflags '-s -w' -o $cliOutput . } 'go build (cli)'

$exe = Get-Item $Output
Write-Host ("built {0} ({1:N1} MiB)" -f $exe.FullName, ($exe.Length / 1MB))
$cli = Get-Item $cliOutput
Write-Host ("built {0} ({1:N1} MiB, console)" -f $cli.FullName, ($cli.Length / 1MB))
