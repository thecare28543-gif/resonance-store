# Resonance Store (PostgreSQL) - stop the server and remove the auto-start task (data in PostgreSQL stays)
param([string]$TaskName = 'Resonance Store Server (PostgreSQL)')
$app = Split-Path $PSScriptRoot -Parent
$cfg = Get-Content (Join-Path $app 'server-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
# the launcher and node keep running after the task stops: end the ones that belong to this folder / port
Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | Where-Object { $_.CommandLine -like "*$PSScriptRoot*run-server.vbs*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$pids = (Get-NetTCPConnection -LocalPort $cfg.port -State Listen -ErrorAction SilentlyContinue).OwningProcess
$pids | Where-Object { $_ } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Write-Host "Auto-start removed and server on port $($cfg.port) stopped. Data in PostgreSQL is untouched." -ForegroundColor Green
