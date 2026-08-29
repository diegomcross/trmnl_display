@echo off
rem CHECK.cmd - double-click to verify every locked rule is still implemented.
rem Green [OK] lines = healthy. Any [FAIL] line = a rule regressed; tell Claude.
rem Read-only: never writes to Bungie/DIM, never restarts servers.
cd /d "%~dp0"
node tests\guardrails.js
echo.
pause
