@echo off
rem Resonance Store - install on this (new) PC. Double-click; Windows will ask for administrator.
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_new_pc.ps1"
