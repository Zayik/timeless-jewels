#!/usr/bin/env pwsh
# One-time environment setup for timeless-jewels.
# Run from project root: .\setup.ps1
# Re-running is safe — each step checks before acting.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# ── Helpers ────────────────────────────────────────────────────────────────────
function Has($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }
function Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }

# ── Node.js ────────────────────────────────────────────────────────────────────
Info "Checking Node.js..."
$requiredNode = Get-Content "$root\frontend\.nvmrc" -Raw
$requiredNode = $requiredNode.Trim()
if (Has node) {
    $nodeVer = (node --version) -replace 'v',''
    $nodeMajor = [int]($nodeVer -split '\.')[0]
    $requiredMajor = [int]($requiredNode -split '\.')[0]
    if ($nodeMajor -ge $requiredMajor) {
        Ok "Node.js $nodeVer found (need $requiredNode+)"
    } else {
        Warn "Node.js $nodeVer found but $requiredNode required. Please upgrade from https://nodejs.org/"
        exit 1
    }
} else {
    Warn "Node.js not found. Install Node.js $requiredNode from https://nodejs.org/ and re-run."
    exit 1
}

# ── pnpm ───────────────────────────────────────────────────────────────────────
Info "Checking pnpm..."
if (-not (Has pnpm)) {
    Info "  pnpm not found — installing via npm..."
    npm install -g pnpm

    # Add npm global bin to PATH for this session if needed
    $npmBin = (npm config get prefix)
    if ($env:PATH -notlike "*$npmBin*") {
        $env:PATH += ";$npmBin"
    }

    if (Has pnpm) {
        Ok "pnpm installed"
        Warn "Add '$npmBin' to your user PATH to use pnpm in future terminals:"
        Warn "  [Environment]::SetEnvironmentVariable('PATH', `$env:PATH + ';$npmBin', 'User')"
    } else {
        Warn "pnpm install failed. Try manually: npm install -g pnpm"
        exit 1
    }
} else {
    Ok "pnpm $(pnpm --version) found"
}

# ── Frontend dependencies ──────────────────────────────────────────────────────
Info "Installing frontend dependencies..."
Set-Location "$root\frontend"
pnpm install
Set-Location $root
Ok "Frontend dependencies installed"

# ── Summary ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Environment ready." -ForegroundColor Green
Write-Host "  Run dev server:  " -NoNewline; Write-Host ".\dev.ps1" -ForegroundColor White
Write-Host "  Run checks:      " -NoNewline; Write-Host ".\test.ps1" -ForegroundColor White
Write-Host "  Build:           " -NoNewline; Write-Host "cd frontend; pnpm run build" -ForegroundColor White
