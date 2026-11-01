# Resonance Store - check this PC is ready to be the server (changes nothing)
$ErrorActionPreference = 'Continue'
$app = Split-Path $PSScriptRoot -Parent
$ok = $true
function Good($t){ Write-Host "  [OK]   $t" -ForegroundColor Green }
function Bad($t){ Write-Host "  [!!]   $t" -ForegroundColor Red; $script:ok = $false }
function Note($t){ Write-Host "  [--]   $t" -ForegroundColor Yellow }

Write-Host "`nResonance Store - server readiness check`n"

# Node.js 18+
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node){ Bad "Node.js is not installed. Install the LTS version from https://nodejs.org" }
else {
  $v = (& node -v) -replace '^v',''
  if ([int]($v.Split('.')[0]) -ge 18){ Good "Node.js $v" } else { Bad "Node.js $v is too old (need 18 or newer)" }
}

# app files
foreach($f in 'server.js','RESONANCE_STORE.html','app.js','sync.js','server-config.json'){
  if (-not (Test-Path (Join-Path $app $f))){ Bad "missing file: $f" }
}
if ($ok){ Good "app files found in $app" }

# config + backup folder
try { $cfg = Get-Content (Join-Path $app 'server-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json; Good "server-config.json: port $($cfg.port), keep $($cfg.keepDays) days" }
catch { Bad "server-config.json is not valid JSON: $($_.Exception.Message)"; $cfg = $null }
if ($cfg){
  if (-not $cfg.backupDir){ Note "backupDir is empty: backups go only to $app\data\backups on this PC. Set it to a TEAM SharePoint/OneDrive folder or a network share." }
  else {
    $bd = $cfg.backupDir; if (-not [IO.Path]::IsPathRooted($bd)){ $bd = Join-Path $app $bd }
    try { New-Item -ItemType Directory -Force $bd -ErrorAction Stop | Out-Null; $t = Join-Path $bd '.write-test'; Set-Content $t 'x' -ErrorAction Stop; Remove-Item $t; Good "backup folder is writable: $bd" }
    catch { Bad "cannot write to backup folder $bd : $($_.Exception.Message)" }
    if ($bd -match '\\OneDrive - |\\OneDrive\\' -and $bd -notmatch 'Team|Shared|SharePoint'){ Note "backupDir looks like a PERSONAL OneDrive. It disappears when its owner leaves - prefer a team library." }
  }
  # port free?
  $busy = Get-NetTCPConnection -LocalPort $cfg.port -State Listen -ErrorAction SilentlyContinue
  if ($busy){ Note "port $($cfg.port) is already in use (the server may already be running - see 3-status.bat)" } else { Good "port $($cfg.port) is free" }
}

# addresses other PCs will use
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -ExpandProperty IPAddress
if ($cfg){ $ips | ForEach-Object { Note "other PCs will open: http://$($_):$($cfg.port)   (also http://$($env:COMPUTERNAME):$($cfg.port))" } }

# firewall rule
$rule = Get-NetFirewallRule -DisplayName 'Resonance Store' -ErrorAction SilentlyContinue
if ($rule){ Good "firewall rule 'Resonance Store' exists" } else { Note "no firewall rule yet - 2-install-autostart.bat adds it when run as administrator, or ask IT to open the port" }

Write-Host ""
if ($ok){ Write-Host "Ready. Next: run 2-install-autostart.bat" -ForegroundColor Green } else { Write-Host "Fix the [!!] lines first." -ForegroundColor Red }
