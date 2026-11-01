# Resonance Store - start the server automatically and keep it running
#   default      : starts when THIS Windows user logs on (no admin needed; works with a OneDrive-synced backup folder)
#   -AtStartup   : starts when the PC boots, before anyone logs on (needs admin; runs as SYSTEM, so backupDir
#                  must be a network share - SYSTEM cannot see a user's OneDrive folder)
param([switch]$AtStartup)
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
$task = 'Resonance Store Server'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node){ throw 'Node.js is not installed. Run 1-check.bat first.' }
$cfg = Get-Content (Join-Path $app 'server-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

New-Item -ItemType Directory -Force (Join-Path $app 'data') | Out-Null
# cmd keeps the console output in data\server.log (the task window is hidden)
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$node`" server.js >> data\server.log 2>&1`"" -WorkingDirectory $app
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

if ($AtStartup){
  if (-not $admin){ throw '-AtStartup needs "Run as administrator".' }
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
}
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Task '$task' registered ($(if($AtStartup){'at PC start, as SYSTEM'}else{"at log-on of $env:USERNAME"}))." -ForegroundColor Green

# open the port for the other lab PCs (company network only)
if ($admin){
  if (-not (Get-NetFirewallRule -DisplayName 'Resonance Store' -ErrorAction SilentlyContinue)){
    New-NetFirewallRule -DisplayName 'Resonance Store' -Direction Inbound -Protocol TCP -LocalPort $cfg.port -Action Allow -Profile Domain,Private | Out-Null
    Write-Host "Firewall: port $($cfg.port) opened for the company network." -ForegroundColor Green
  }
} else {
  Write-Host "Firewall not changed (not administrator). Ask IT to allow inbound TCP $($cfg.port), or re-run this as administrator." -ForegroundColor Yellow
}

Start-ScheduledTask -TaskName $task
Start-Sleep -Seconds 3
try { $h = Invoke-RestMethod "http://localhost:$($cfg.port)/api/health" -TimeoutSec 5; Write-Host "Server is running (data version $($h.version))." -ForegroundColor Green }
catch { Write-Host "Server did not answer yet - check data\server.log, then run 3-status.bat" -ForegroundColor Red }
