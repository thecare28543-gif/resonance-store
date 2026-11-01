@echo off
rem Resonance Store - start the data server on this PC (needs Node.js 18+)
rem Open http://localhost:8080 on this PC, or the address shown below from other PCs.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download it from https://nodejs.org & pause & exit /b 1)
node server.js
pause
