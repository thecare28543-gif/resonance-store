# Resonance Store - run every automated test against a THROW-AWAY PostgreSQL cluster (never the real database)
#   usage:  powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1
#   needs:  Node.js 18+, Microsoft Edge, PostgreSQL 13+ installed (only its bin\ programs are used),
#           "npm install" done once in app\ and in tests\
param(
  [string]$App = (Join-Path (Split-Path $PSScriptRoot -Parent) 'app'),
  [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
  [int]$Port = 55432
)
$ErrorActionPreference = 'Continue'   # native programs write notices to stderr; exit codes are checked instead
$work = Join-Path $env:TEMP 'resonance-tests'
$pgdata = Join-Path $work 'pgdata'
$shots = Join-Path $work 'screenshots'
if (-not (Test-Path (Join-Path $App 'node_modules\pg'))) { Write-Host "Run 'npm install' in $App first." -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules\playwright-core'))) { Write-Host "Run 'npm install' in $PSScriptRoot first." -ForegroundColor Red; exit 1 }

# 1. a private PostgreSQL just for the tests: local only, no password, rebuilt every run
if (Test-Path $pgdata) { & "$PgBin\pg_ctl.exe" -D $pgdata stop -m fast 2>$null | Out-Null; Start-Sleep 2; Remove-Item $pgdata -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force $work, $shots | Out-Null
& "$PgBin\initdb.exe" -D $pgdata -U postgres -A trust -E UTF8 --locale=C 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "initdb failed (is PostgreSQL in $PgBin ?)" -ForegroundColor Red; exit 1 }
Start-Process "$PgBin\pg_ctl.exe" -ArgumentList "-D `"$pgdata`" -o `"-p $Port -c listen_addresses=localhost`" -l `"$work\pg.log`" start" -WindowStyle Hidden
$up = $false
for ($i = 0; $i -lt 60; $i++) { & "$PgBin\psql.exe" -h localhost -p $Port -U postgres -w -c 'select 1' 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $up = $true; break }; Start-Sleep -Milliseconds 500 }
if (-not $up) { Write-Host "Test PostgreSQL did not start - see $work\pg.log" -ForegroundColor Red; exit 1 }

$env:NODE_PATH = Join-Path $PSScriptRoot 'node_modules'
$results = @()
try {
  foreach ($t in @(
      @{ name = 'API (log-in, roles, accounts, data)'; file = 'auth_api.js'; db = 'rs_auth'; extra = @() },
      @{ name = '2 PCs end-to-end (sync, races, Hold, 80 cap)'; file = 'e2e.js'; db = 'rs_e2e'; extra = @() },
      @{ name = 'UI (log-in page, users page, viewer)'; file = 'ui_login.js'; db = 'rs_ui'; extra = @($shots) })) {
    & "$PgBin\psql.exe" -h localhost -p $Port -U postgres -w -q -c "create database $($t.db)" 2>$null | Out-Null
    Write-Host "`n== $($t.name)" -ForegroundColor Cyan
    $out = & node (Join-Path $PSScriptRoot $t.file) $App "postgres://postgres@localhost:$Port/$($t.db)" @($t.extra) 2>&1
    $out | Where-Object { "$_" -match '^(PASS|FAIL|---)' } | ForEach-Object { if ("$_" -match '^FAIL') { Write-Host $_ -ForegroundColor Red } else { Write-Host $_ } }
    $results += [pscustomobject]@{ Test = $t.name; Result = ($out | Where-Object { "$_" -match '^---' } | Select-Object -Last 1) }
  }
} finally {
  & "$PgBin\pg_ctl.exe" -D $pgdata stop -m fast 2>$null | Out-Null
}
Write-Host "`nSummary" -ForegroundColor Green
$results | Format-Table -AutoSize
Write-Host "Screenshots: $shots"
