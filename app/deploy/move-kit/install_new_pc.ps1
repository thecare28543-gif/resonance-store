# Resonance Store - install on a NEW PC from this move kit (run as administrator, via INSTALL.bat)
#  1. checks Node.js + PostgreSQL 18 are installed
#  2. copies the app to C:\ResonanceStore2027 (plain-English path, required by the auto-start script)
#  3. creates role rs_app (new random password) + database resonance_store, restores resonance_store.dump
#     (all store data, job details, holds, training, 12 user accounts, backups) - postgres password NOT needed:
#     pg_hba.conf trusts local postgres for a few seconds and is put back exactly as it was
#  4. writes server-config.json, registers auto-start at log-on, opens the firewall port, opens the login page
param([string]$Target = 'C:\ResonanceStore2027', [int]$Port = 8081)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$kit = $PSScriptRoot
$logFile = Join-Path $kit 'install_log.txt'
$log = New-Object System.Collections.Generic.List[string]
function Say($m, $c = 'Gray') { Write-Host "  $m" -ForegroundColor $c; $log.Add("$(Get-Date -Format 'HH:mm:ss') $m") }
function Fail($m) { throw $m }

Write-Host ''
Write-Host '  RESONANCE STORE - install on this PC' -ForegroundColor Green
Write-Host ''
try {
  # ---- 0. checks -----------------------------------------------------------------------------
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { Fail 'Please run INSTALL.bat (it asks for administrator).' }
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Fail 'Node.js is not installed. Install the LTS version from https://nodejs.org then run INSTALL.bat again.' }
  Say "Node.js: $(& $node --version)"
  $svc = Get-Service 'postgresql-x64-*' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $svc) { Fail 'PostgreSQL is not installed. Install PostgreSQL 18 (Windows x86-64) from https://www.postgresql.org/download/windows/ then run INSTALL.bat again.' }
  $ver = [int]($svc.Name -replace '\D', '')
  if ($ver -lt 18) { Fail "PostgreSQL $ver found - version 18 or newer is needed (the data was saved with 18)." }
  $img = (Get-CimInstance Win32_Service -Filter "Name='$($svc.Name)'").PathName
  $bin = Split-Path ($img -replace '^"([^"]+)".*$', '$1')
  if ($img -notmatch '-D\s+"([^"]+)"') { Fail "Cannot find the PostgreSQL data folder from: $img" }
  $pgdata = $Matches[1]
  $psql = Join-Path $bin 'psql.exe'; $pgrestore = Join-Path $bin 'pg_restore.exe'
  if ($svc.Status -ne 'Running') { Start-Service $svc.Name }
  Say "PostgreSQL $ver : $pgdata"
  $dump = Join-Path $kit 'resonance_store.dump'
  if (-not (Test-Path $dump)) { Fail 'resonance_store.dump is missing from the kit.' }
  if ((Test-Path (Join-Path $Target 'server-config.json'))) { Fail "$Target already has an installed copy (server-config.json). Nothing was changed." }
  $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($busy) { Fail "Port $Port is already in use on this PC." }

  # ---- 1. copy the app -----------------------------------------------------------------------
  Say "Copying the app to $Target ..."
  robocopy (Join-Path $kit 'RESONANCE_STORE_2027') $Target /E /NP /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "Copy failed (robocopy $LASTEXITCODE)." }
  New-Item -ItemType Directory -Force (Join-Path $Target 'data') | Out-Null

  # ---- 2. database ---------------------------------------------------------------------------
  $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider; $bytes = New-Object byte[] 32; $rng.GetBytes($bytes)
  $pw = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
  $hba = Join-Path $pgdata 'pg_hba.conf'
  $hbaBackup = Join-Path $pgdata ('pg_hba.conf.before-resonance-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Copy-Item $hba $hbaBackup
  $original = [IO.File]::ReadAllText($hba)
  $env:PGCLIENTENCODING = 'UTF8'
  try {
    $open = "# TEMPORARY (Resonance Store install) - removed automatically`r`nhost all postgres 127.0.0.1/32 trust`r`nhost all postgres ::1/128 trust`r`n"
    [IO.File]::WriteAllText($hba, $open + $original, (New-Object Text.UTF8Encoding $false))
    Restart-Service $svc.Name
    for ($i = 0; $i -lt 40; $i++) { & $psql -h localhost -U postgres -d postgres -w -c 'select 1' *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Milliseconds 500 }
    $exists = (& $psql -h localhost -U postgres -d postgres -w -t -A -c "select count(*) from pg_database where datname='resonance_store'").Trim()
    if ($exists -eq '1') { Fail 'Database resonance_store already exists on this PC. Nothing was changed in the database.' }
    Say 'Creating rs_app + resonance_store ...'
    $role = (& $psql -h localhost -U postgres -d postgres -w -t -A -c "select count(*) from pg_roles where rolname='rs_app'").Trim()
    $verb = if ($role -eq '1') { 'ALTER' } else { 'CREATE' }
    & $psql -h localhost -U postgres -d postgres -w -v ON_ERROR_STOP=1 -q -c "$verb ROLE rs_app LOGIN PASSWORD '$pw'" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Could not create role rs_app.' }
    & $psql -h localhost -U postgres -d postgres -w -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE resonance_store OWNER rs_app ENCODING 'UTF8' TEMPLATE template0" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Could not create database resonance_store.' }
    Say 'Restoring data (store, jobs, holds, training, users, backups) ...'
    $out = & $pgrestore -h localhost -U postgres -w -d resonance_store --no-owner --no-privileges --role=rs_app --exit-on-error $dump 2>&1
    if ($LASTEXITCODE -ne 0) { $out | ForEach-Object { $log.Add("$_") }; Fail 'Restore failed - see install_log.txt.' }
  } finally {
    [IO.File]::WriteAllText($hba, $original, (New-Object Text.UTF8Encoding $false))
    Restart-Service $svc.Name
    $log.Add("pg_hba.conf restored: $([IO.File]::ReadAllText($hba) -eq $original) (backup $hbaBackup)")
  }
  for ($i = 0; $i -lt 40; $i++) { $env:PGPASSWORD = $pw; $n = & $psql -h localhost -U rs_app -d resonance_store -w -t -A -c 'select count(*) from app_users' 2>$null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Milliseconds 500 }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0) { Fail 'rs_app cannot log in to the new database.' }
  Say "Database ready: $($n.Trim()) user accounts." 'Green'

  # ---- 3. config + auto-start ----------------------------------------------------------------
  $cfg = Get-Content (Join-Path $Target 'server-config.example.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $cfg.port = $Port
  $cfg.database.password = $pw
  [IO.File]::WriteAllText((Join-Path $Target 'server-config.json'), ($cfg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  Say 'server-config.json written (new rs_app password is only in this file).'
  & (Join-Path $Target 'deploy\install-autostart.ps1')
  $rule = "Resonance Store $Port"
  if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain, Private | Out-Null
  }
  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress
  Say "DONE. This PC: http://localhost:$Port   Other PCs: http://$($ip):$Port" 'Green'
  Say 'Log in with your GID (User = GID, Password = GID).' 'Green'
  Start-Process "http://localhost:$Port/login.html"
} catch {
  Say "FAILED: $($_.Exception.Message)" 'Red'
} finally {
  [IO.File]::WriteAllLines($logFile, [string[]]$log, (New-Object Text.UTF8Encoding $false))
  Write-Host ''
  Read-Host '  Press Enter to close'
}
