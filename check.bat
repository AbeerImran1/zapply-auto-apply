@echo off
setlocal
cd /d "%~dp0"
npm run check
if errorlevel 1 pause
