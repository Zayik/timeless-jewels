$ErrorActionPreference = "Stop"

Write-Host "Running frontend type-check and linting..." -ForegroundColor Cyan
Push-Location frontend

# Check for package manager
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $pkgManager = "pnpm"
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    $pkgManager = "npm"
} else {
    Write-Warning "No package manager (pnpm/npm) found. Skipping frontend checks."
    Pop-Location
    exit 0
}

Write-Host "Using $pkgManager to run frontend checks..."
& $pkgManager run check
& $pkgManager run lint

Pop-Location

Write-Host "All checks completed successfully!" -ForegroundColor Green
