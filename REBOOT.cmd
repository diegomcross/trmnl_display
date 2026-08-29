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
REM
REM  ---------------------------------------------------------------
REM  2026-08-29 -- Diego: "App is crashing instead of staying live all the
REM  time. And cmd window stay open instead of disappearing from my taskbar."
REM  Both traced to how this file used to start the launchers:
REM
REM      start "" powershell -WindowStyle Hidden -File start-vault.ps1
REM
REM  1) STRAY WINDOW. `start` allocates a NEW CONSOLE before powershell.exe
REM     runs, so Windows spawns a conhost.exe for it. -WindowStyle Hidden
REM     then hides the PowerShell window, but that console host is already
REM     created and lives as long as the launcher -- one stray window per
REM     server in the taskbar.
REM
REM  2) THE SERVERS DIED. Launched this way the launchers are descendants of
REM     whatever ran REBOOT.cmd. When an agent shell runs it, they join that
REM     shell's Windows JOB OBJECT, and every process in the job is killed
REM     when the shell exits. vault.log shows it exactly: started 12:07:13,
REM     last line 12:13:32, nothing until the next manual reboot at 19:02.
REM     Nearly seven hours down, with the keep-alive loop killed too so
REM     nothing could restart it.
REM
REM  FIX: create the launchers through WMI (Win32_Process.Create). WMI spawns
REM  them from WmiPrvSE.exe, so they are NOT in the caller's job object and
REM  survive the shell that started them. WMI runs wscript.exe (a GUI-subsystem
REM  host, so it never gets a console) which in turn starts PowerShell with
REM  window style 0. No console is allocated at any point, and nothing dies
REM  when the launching window closes.
REM ===================================================================
setlocal
set "DIR=%~dp0"
REM strip the trailing backslash so the paths below read cleanly
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

echo.
echo   Rebooting TRMNL Destiny servers...
echo   Stopping any running servers and launchers...

REM Kill the keep-alive launcher loops first (so they do not relaunch the
REM server we are about to kill), then the node servers themselves, then any
REM console host left orphaned by an older version of this script.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'start-display\.ps1|start-vault\.ps1|start-hidden\.vbs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2"

echo   Starting display server (port 3000)...
call :spawn "%DIR%\start-display.ps1"

echo   Starting Vault Verdict server (port 8787)...
call :spawn "%DIR%\start-vault.ps1"

echo.
echo   Done. Both servers are starting in the background.
echo   They keep running after you close this window.
echo   Display:       http://localhost:3000/display
echo   Auto-Manager:  http://localhost:8787/auto
echo.
REM `timeout` reads the console and fails with "Input redirection is not
REM supported" when this file is run non-interactively. ping just waits.
ping -n 4 127.0.0.1 >nul 2>&1
endlocal
goto :eof

REM ---- spawn <launcher.ps1> : hidden, detached, outside any job object ----
:spawn
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'; $inner = '\"' + $ps + '\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%~1\"'; $outer = 'wscript.exe //nologo \"%DIR%\start-hidden.vbs\" \"' + $inner.Replace('\"','\"\"') + '\"'; $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $outer; CurrentDirectory = '%DIR%' }; if ($r.ReturnValue -ne 0) { Write-Host ('   WARNING: launch returned ' + $r.ReturnValue + ' for %~1') }"
goto :eof
