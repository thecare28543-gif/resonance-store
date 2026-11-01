# Resonance Store - start the server automatically and keep it running
#   default      : starts when THIS Windows user logs on (no admin needed; works with a OneDrive-synced backup folder)
#   -AtStartup   : starts when the PC boots, before anyone logs on (needs admin; runs as SYSTEM, so backupDir
#                  must be a network share - SYSTEM cannot see a user's OneDrive folder)
# The server runs with NO window (so nobody can close it by accident) under a small launcher that restarts it if it stops.
param([switch]$AtStartup)
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
$task = 'Resonance Store Server'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node){ throw 'Node.js is not installed. Run 1-check.bat first.' }
$cfg = Get-Content (Join-Path $app 'server-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
New-Item -ItemType Directory -Force (Join-Path $app 'data') | Out-Null

# hidden launcher: runs node with window style 0 and starts it again 10 s after it stops; output goes to data\server.log
$vbs = Join-Path $PSScriptRoot 'run-server.vbs'
@"
' Resonance Store - keeps server.js running with no window (written by install-autostart.ps1)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$app"
Do
  sh.Run "cmd /c ""$node"" server.js >> data\server.log 2>&1", 0, True
  WScript.Sleep 10000
Loop
"@ | Set-Content $vbs -Encoding ASCII

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $app
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Hidden

if ($AtStartup){
  if (-not $admin){ throw '-AtStartup needs "Run as administrator".' }
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
}
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Task '$task' registered ($(if($AtStartup){'at PC start, as SYSTEM'}else{"at log-on of $env:USERNAME"})). The server runs in the background with no window." -ForegroundColor Green

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
Start-Sleep -Seconds 4
try { $h = Invoke-RestMethod "http://localhost:$($cfg.port)/api/health" -TimeoutSec 5; Write-Host "Server is running (data version $($h.version))." -ForegroundColor Green }
catch { Write-Host "Server did not answer yet - check data\server.log, then run 3-status.bat" -ForegroundColor Red }
