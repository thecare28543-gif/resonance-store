@echo off
rem Resonance Store - open the app on this PC.
rem The server normally starts by itself at Windows log-on (Task Scheduler "Resonance Store Server (PostgreSQL)").
rem This file only starts it if it is not running yet (via deploy\run-server.vbs), then opens the login page.
setlocal
cd /d "%~dp0"

set "PORT=8081"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { (Get-Content 'server-config.json' -Raw -ErrorAction Stop | ConvertFrom-Json).port } catch { '' }"`) do if not "%%P"=="" set "PORT=%%P"
set "URL=http://localhost:%PORT%"

call :running
if not errorlevel 1 goto open

where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org & pause & exit /b 1)
echo Starting Resonance Store server on port %PORT% ...
start "" wscript.exe "%~dp0deploy\run-server.vbs"

for /l %%i in (1,1,20) do (
  ping -n 2 127.0.0.1 >nul
  call :running
  if not errorlevel 1 goto open
)
echo.
echo The server did not start within 20 seconds.
echo Check the end of data\server.log for the error.
pause
exit /b 1

:open
echo Resonance Store is running: %URL%
start "" "%URL%/login.html"
exit /b 0

:running
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
exit /b %errorlevel%
