# Resonance Store - stop the server and remove auto-start (the data folder and backups are kept)
$task = 'Resonance Store Server'
$cfg = Get-Content (Join-Path (Split-Path $PSScriptRoot -Parent) 'server-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# find the server before stopping the task: stopping the task ends cmd.exe but leaves node.exe running on its own
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
