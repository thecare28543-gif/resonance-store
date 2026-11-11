# Resonance Store (PostgreSQL + log-in) - start the server automatically and keep it running
#   default      : starts when THIS Windows user logs on (no admin needed)
#   -AtStartup   : starts when the PC boots, before anyone logs on (needs admin; runs as SYSTEM)
# The server runs with NO window under a small launcher that starts it again 10 s after it stops
# (also covers PostgreSQL not being up yet right after boot).
param([switch]$AtStartup, [string]$TaskName = 'Resonance Store Server (PostgreSQL)')
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node){ throw 'Node.js is not installed.' }
if ($app -match '[^\x20-\x7E]'){ throw "The app folder path must be plain English letters (now: $app)." }
if (-not (Test-Path (Join-Path $app 'node_modules\pg'))){ throw 'Run "npm install" in the app folder first.' }
$cfg = Get-Content (Join-Path $app 'server-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $cfg.database){ throw 'server-config.json has no "database" section (see db\วิธีตั้งค่าฐานข้อมูล.md).' }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
New-Item -ItemType Directory -Force (Join-Path $app 'data') | Out-Null

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
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Task '$TaskName' registered ($(if($AtStartup){'at PC start, as SYSTEM'}else{"at log-on of $env:USERNAME"}))." -ForegroundColor Green
if ($admin -and -not (Get-NetFirewallRule -DisplayName "Resonance Store $($cfg.port)" -ErrorAction SilentlyContinue)){
  New-NetFirewallRule -DisplayName "Resonance Store $($cfg.port)" -Direction Inbound -Protocol TCP -LocalPort $cfg.port -Action Allow -Profile Domain,Private | Out-Null
  Write-Host "Firewall: port $($cfg.port) opened for the company network." -ForegroundColor Green
} elseif (-not $admin) { Write-Host "Firewall not changed (not administrator): other PCs need inbound TCP $($cfg.port) allowed by IT." -ForegroundColor Yellow }

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
try { $h = Invoke-RestMethod "http://localhost:$($cfg.port)/api/auth/status" -TimeoutSec 5; Write-Host "Server is running on port $($cfg.port)." -ForegroundColor Green }
catch { Write-Host "Server did not answer yet - check data\server.log" -ForegroundColor Red }
