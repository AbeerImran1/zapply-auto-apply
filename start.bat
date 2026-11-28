@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  echo .env was not found. Run setup.bat first, then configure your Discord and OpenAI keys.
  pause
  exit /b 1
)
npm start
if errorlevel 1 pause
