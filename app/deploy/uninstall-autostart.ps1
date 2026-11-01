# Resonance Store - stop the server and remove auto-start (the data folder and backups are kept)
$task = 'Resonance Store Server'
$cfg = Get-Content (Join-Path (Split-Path $PSScriptRoot -Parent) 'server-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# stop the hidden launcher first, or it starts the server again
Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | Where-Object { $_.CommandLine -match 'run-server\.vbs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "Stopped launcher (pid $($_.ProcessId))." }

# then the server itself: by its cmd parent, and by whoever holds the port
$cmds = @(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -match 'server\.js >> data\\server\.log' } | ForEach-Object ProcessId)
$pids = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $cmds -contains $_.ParentProcessId } | ForEach-Object ProcessId)
$pids += @(Get-NetTCPConnection -LocalPort $cfg.port -ErrorAction SilentlyContinue | ForEach-Object OwningProcess)

if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue){
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $task -Confirm:$false
  Write-Host "Auto-start removed. Data and backups were not touched." -ForegroundColor Green
} else { Write-Host "Auto-start was not installed." }

$pids | Where-Object { $_ } | Select-Object -Unique | ForEach-Object {
  $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node'){ Stop-Process -Id $_ -Force; Write-Host "Stopped server (pid $_)." }
}
$cmds | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
