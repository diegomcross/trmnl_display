' start-hidden.vbs -- launch one of the keep-alive launchers with NO window at all.
'
' Why this exists (2026-08-29, Diego: "cmd window stay open instead of disappearing
' from my taskbar"):
'   REBOOT.cmd used  start "" powershell -WindowStyle Hidden -File start-vault.ps1
'   `start` allocates a NEW CONSOLE before powershell.exe ever runs, so Windows spawns a
'   conhost.exe for it. -WindowStyle Hidden then hides the PowerShell window, but the
'   console host is already there and stays for the life of the launcher -- one stray
'   window per server, sitting in Diego's taskbar.
'
' wscript.exe is a GUI subsystem host: it gets no console. WshShell.Run(cmd, 0, False)
' starts the launcher with window style 0 (hidden) and returns immediately, so nothing
' visible is ever created.
'
' Usage:  wscript.exe //nologo start-hidden.vbs "<full command line to run>"
' Keep this file ASCII-only.

Option Explicit
Dim sh, cmd
If WScript.Arguments.Count < 1 Then WScript.Quit 1
cmd = WScript.Arguments(0)
Set sh = CreateObject("WScript.Shell")
' 0 = hidden window, False = do not wait for it to finish
sh.Run cmd, 0, False
WScript.Quit 0
