@echo off
REM Vault Verdict - first run. Double-click me.
REM Starts the app (minimized) and opens the setup page in your browser.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed yet.
  echo Download the LTS version from https://nodejs.org , install it with all
  echo default options, then double-click this file again.
  echo.
  pause
  exit /b 1
)

start "Vault Verdict" /min cmd /c "node "%~dp0vault-verdict.js" >> "%~dp0vault.log" 2>&1"
timeout /t 3 >nul
start "" http://127.0.0.1:8787/setup

echo.
echo Vault Verdict is starting - your browser is opening the setup page.
echo If the page says "can't be reached", wait 10 seconds and refresh it.
echo You can close this window.
echo.
pause
