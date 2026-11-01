# Resonance Store - is the server running, and when was the last backup? (changes nothing)
$app = Split-Path $PSScriptRoot -Parent
$cfg = Get-Content (Join-Path $app 'server-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$task = Get-ScheduledTask -TaskName 'Resonance Store Server' -ErrorAction SilentlyContinue
Write-Host "`nResonance Store - status`n"
if ($task){ Write-Host "  auto-start task : $($task.State)" } else { Write-Host "  auto-start task : not installed (run 2-install-autostart.bat)" -ForegroundColor Yellow }
try {
  $h = Invoke-RestMethod "http://localhost:$($cfg.port)/api/health" -TimeoutSec 5
  Write-Host "  server          : RUNNING · data version $($h.version) · last change $($h.updatedAt)" -ForegroundColor Green
  if ($h.lastBackupAt){
    $age = (New-TimeSpan -Start ([datetime]$h.lastBackupAt) -End (Get-Date)).TotalHours
    $col = if ($age -gt 13){ 'Red' } else { 'Green' }
    Write-Host ("  last backup     : {0} ({1:N1} h ago) · {2} files kept" -f $h.lastBackupAt, $age, $h.backups) -ForegroundColor $col
  } else { Write-Host "  last backup     : none yet (one is taken on the first change)" -ForegroundColor Yellow }
  $h.backupDirs | ForEach-Object { Write-Host "  backup folder   : $_" }
} catch { Write-Host "  server          : NOT RUNNING on port $($cfg.port)" -ForegroundColor Red; Write-Host "  look at         : $app\data\server.log" }
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
  ForEach-Object { Write-Host "  lab PCs open    : http://$($_.IPAddress):$($cfg.port)" }
Write-Host ""
