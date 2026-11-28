@echo off
setlocal
cd /d "%~dp0"

echo Checking Node.js and npm...
where node >nul 2>nul || (echo Node.js is not installed. Install Node.js 22 or newer, then run this again. & pause & exit /b 1)
where npm >nul 2>nul || (echo npm was not found. Reinstall Node.js with npm included. & pause & exit /b 1)

for /f "delims=" %%V in ('node --version') do echo Found Node.js %%V

echo Installing project dependencies...
npm install --no-audit --no-fund
if errorlevel 1 (echo Dependency installation failed. Check your internet connection and npm output. & pause & exit /b 1)

echo Installing Chromium for Playwright...
npx playwright install chromium
if errorlevel 1 (echo Chromium installation failed. Run npx playwright install chromium manually. & pause & exit /b 1)

if not exist ".env" copy ".env.example" ".env" >nul
if not exist "private" mkdir "private"
if not exist "private\base-cv.md" copy "examples\base-cv.example.md" "private\base-cv.md" >nul
if not exist "private\profile.md" copy "examples\profile.example.md" "private\profile.md" >nul
if not exist "private\application-profile.json" copy "examples\application-profile.example.json" "private\application-profile.json" >nul

echo.
echo Setup completed.
echo Next: edit .env and all three files in the private folder.
echo Keep AUTO_APPLY_ENABLED=false until your profile and allowlists are correct.
echo Then run: npm run check, npm run register-commands, and npm start.
pause
