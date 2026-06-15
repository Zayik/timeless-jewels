#!/usr/bin/env pwsh
# Starts the local dev server.
# Run from project root: .\dev.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Write-Host "Starting dev server at http://localhost:5173" -ForegroundColor Cyan
Set-Location "$root\frontend"
pnpm run dev
