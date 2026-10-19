# Fetches the Go dependencies for ReadS. Kept as a script so the exact
# resolution order (wails v3 first, then the rest) is reproducible.
. "$PSScriptRoot\goenv.ps1"
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path 'go.mod')) {
    go mod init reads
}

Write-Host '--- go get wails v3 ---'
go get github.com/wailsapp/wails/v3@v3.0.0-beta.27

Write-Host '--- go get libraries ---'
go get github.com/mmcdole/gofeed@latest
go get github.com/go-shiori/go-readability@latest
go get modernc.org/sqlite@latest
go get golang.org/x/net@latest
go get golang.org/x/text@latest

Write-Host '--- go mod tidy ---'
go mod tidy

Write-Host '--- resolved versions ---'
go list -m all
