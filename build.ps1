#!/usr/bin/env pwsh
# Builds the WASM binary for the frontend.
# Run from project root: .\build.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host "Building WASM..." -ForegroundColor Cyan
$env:GOOS = 'js'
$env:GOARCH = 'wasm'
go build -o "$root\frontend\static\calculator.wasm" "$root\wasm"
$env:GOOS = ''
$env:GOARCH = ''

Write-Host "Done -> frontend\static\calculator.wasm" -ForegroundColor Green
