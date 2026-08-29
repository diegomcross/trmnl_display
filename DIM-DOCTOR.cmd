@echo off
REM Double-click me when DIM tags look stale or the "Updated" chip says DIM sync error.
REM Read-only: this only reports what is wrong and how to fix it. It changes nothing.
cd /d "%~dp0"
node dim-doctor.js
echo.
pause
