@echo off
REM ===================================================================
REM  REBOOT.cmd -- one-click restart for both Destiny servers.
REM
REM  Double-click this any time you want to (re)start things or load new
REM  code after an update:
REM    * TRMNL display server   (server.js,        port 3000)
REM    * Vault Verdict server   (vault-verdict.js, port 8787)  <-- runs
REM      Weapon Watch, New Drops, the god-roll poller, DIM sync, and the
REM      new Auto-Manager (/auto).
REM
REM  It stops anything already running (servers + their keep-alive
REM  launchers), waits a moment, then starts one fresh launcher for each.
REM  Safe to run whether or not they are currently up.
REM ===================================================================
setlocal
set "DIR=%~dp0"

echo.
echo   Rebooting TRMNL Destiny servers...
echo   Stopping any running servers and launchers...

REM Kill the keep-alive launcher loops first (so they do not relaunch the
REM server we are about to kill), then the node servers themselves.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'start-display\.ps1|start-vault\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2"

echo   Starting display server (port 3000)...
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DIR%start-display.ps1"

echo   Starting Vault Verdict server (port 8787)...
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DIR%start-vault.ps1"

echo.
echo   Done. Both servers are starting in the background.
echo   Display:       http://localhost:3000/display
echo   Auto-Manager:  http://localhost:8787/auto
echo.
timeout /t 4 >nul
endlocal
