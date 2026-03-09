#!/usr/bin/env pwsh
# Starts the local dev server. Rebuilds WASM first if calculator.wasm is missing or Go sources are newer.
# Run from project root: .\dev.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$wasm = "$root\frontend\static\calculator.wasm"

# Rebuild WASM if missing or any Go source is newer than the existing binary
$needsBuild = -not (Test-Path $wasm)
if (-not $needsBuild) {
    $wasmTime = (Get-Item $wasm).LastWriteTime
    $newerSrc = Get-ChildItem "$root\wasm", "$root\data", "$root\calculator", "$root\random" -Recurse -Filter "*.go" |
        Where-Object { $_.LastWriteTime -gt $wasmTime }
    if ($newerSrc) { $needsBuild = $true }
}

if ($needsBuild) {
    Write-Host "Go sources changed — rebuilding WASM..." -ForegroundColor Cyan
    & "$root\build.ps1"
} else {
    Write-Host "WASM is up to date." -ForegroundColor DarkGray
}

Write-Host "Starting dev server at http://localhost:5173" -ForegroundColor Cyan
Set-Location "$root\frontend"
pnpm dev
