# Resonance Store - is the server running? (changes nothing)
# Data, backups and log-ins live in PostgreSQL: see them in pgAdmin (tables rs_backups, login_log) or in the web as an admin.
$app = Split-Path $PSScriptRoot -Parent
$cfg = Get-Content (Join-Path $app 'server-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$task = Get-ScheduledTask -TaskName 'Resonance Store Server (PostgreSQL)' -ErrorAction SilentlyContinue
Write-Host "`nResonance Store - status`n"
if ($task){ Write-Host "  auto-start task : $($task.State)" } else { Write-Host "  auto-start task : not installed (run 2-install-autostart.bat)" -ForegroundColor Yellow }
try {
  $s = Invoke-RestMethod "http://localhost:$($cfg.port)/api/auth/status" -TimeoutSec 5
  Write-Host "  server          : RUNNING on port $($cfg.port)" -ForegroundColor Green
  if ($s.setupNeeded){ Write-Host "  first admin     : not created yet - setup code in $app\data\setup-token.txt" -ForegroundColor Yellow }
} catch { Write-Host "  server          : NOT RUNNING on port $($cfg.port)" -ForegroundColor Red; Write-Host "  look at         : $app\data\server.log" }
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
  ForEach-Object { Write-Host "  lab PCs open    : http://$($_.IPAddress):$($cfg.port)" }
Write-Host ""
