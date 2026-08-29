<#
  watchdog.ps1 -- keep both Destiny servers alive, always.

  WHY THIS EXISTS (2026-08-29, Diego: "App is crashing instead of staying live
  all the time"):

  The always-on design had a hole. Each server is started by a keep-alive
  launcher (start-display.ps1 / start-vault.ps1) whose `while ($true)` loop
  restarts node if node exits. That covers node crashing. It does NOT cover the
  LAUNCHER ITSELF dying -- and when the launcher dies, nothing is left to restart
  anything. The only other recovery path is the Startup-folder login item, which
  fires once at login, so a launcher lost mid-session stays lost until the next
  reboot or a manual REBOOT.cmd. vault.log shows the shape of it: the last
  "exited (code N). Restarting in 5s" line is 2026-07-28, while the servers have
  been started from scratch many times since.

  A launcher can die from: an agent shell exiting and taking its process tree with
  it, a Windows job-object kill, the user closing a stray console window, or an
  OOM/forced kill.

  This watchdog closes that hole. Every 60s it checks whether ports 3000 and 8787
  are actually accepting connections -- the real test, not "is a process named node
  running" -- and relaunches only the side that is down, using the same hidden,
  detached mechanism REBOOT.cmd uses (WMI -> wscript -> hidden PowerShell), so the
  relaunched server is not a child of this watchdog and never shows a window.

  It is deliberately dumb and cheap: two TCP connects a minute, no Bungie calls, no
  DIM calls, no disk writes unless something actually changed.

  INSTALL (hidden login item + start now):
      powershell -ExecutionPolicy Bypass -File watchdog.ps1 -Install
  REMOVE:
      powershell -ExecutionPolicy Bypass -File watchdog.ps1 -Uninstall

  Keep this file ASCII-only (Windows PowerShell 5.1 chokes on non-ASCII).
#>

param(
  [switch]$Install,
  [switch]$Uninstall,
  [int]$IntervalSeconds = 60
)

$Name       = "TRMNL Watchdog"
$repo       = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $repo "watchdog.ps1"
$logFile    = Join-Path $repo "watchdog.log"
$hiddenVbs  = Join-Path $repo "start-hidden.vbs"
$startupDir = [Environment]::GetFolderPath('Startup')
$lnkPath    = Join-Path $startupDir ($Name + ".lnk")

# port -> the launcher that owns it
$Targets = @(
  @{ Port = 3000; Script = "start-display.ps1"; Label = "display server"  },
  @{ Port = 8787; Script = "start-vault.ps1";   Label = "Vault Verdict"   }
)

function Log($msg) {
  $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $msg
  Write-Host $line
  try {
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
      Move-Item $logFile ($logFile + ".old") -Force -ErrorAction SilentlyContinue
    }
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
  } catch {}
}

function Test-PortOpen($p) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $p, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(3000, $false)) { $client.Close(); return $false }
    $client.EndConnect($iar); $client.Close(); return $true
  } catch { try { $client.Close() } catch {}; return $false }
}

# Start a launcher hidden AND detached from this process, exactly as REBOOT.cmd does.
# WMI creates it from WmiPrvSE, so it is not a child of the watchdog and does not die
# with it; wscript.exe is a GUI host, so no console window is ever allocated.
function Start-Detached($scriptName) {
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $target = Join-Path $repo $scriptName
  $inner = '"' + $ps + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $target + '"'
  $outer = 'wscript.exe //nologo "' + $hiddenVbs + '" "' + $inner.Replace('"', '""') + '"'
  try {
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
           -Arguments @{ CommandLine = $outer; CurrentDirectory = $repo } -ErrorAction Stop
    if ($r.ReturnValue -ne 0) { Log ("  WMI launch of " + $scriptName + " returned " + $r.ReturnValue); return $false }
    return $true
  } catch {
    Log ("  WMI launch of " + $scriptName + " failed: " + $_.Exception.Message)
    return $false
  }
}

function Install-LoginItem {
  $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
  if (-not $psExe) { $psExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" }
  try {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnkPath)
    $sc.TargetPath = "wscript.exe"
    $sc.Arguments  = '//nologo "' + $hiddenVbs + '" "' + `
                     ('"' + $psExe + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '"').Replace('"','""') + '"'
    $sc.WorkingDirectory = $repo
    $sc.WindowStyle = 7
    $sc.Description = "Keep the TRMNL Destiny servers alive"
    $sc.Save()
    if (Test-Path $lnkPath) { Write-Host ("Login item created: " + $lnkPath) }
  } catch {
    Write-Host ("ERROR creating login item: " + $_.Exception.Message)
  }
}

if ($Uninstall) {
  if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force -ErrorAction SilentlyContinue; Write-Host ("Removed " + $lnkPath) }
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match 'watchdog\.ps1' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host "Watchdog removed."
  exit 0
}

if ($Install) {
  Install-LoginItem
  $already = Get-CimInstance Win32_Process |
             Where-Object { $_.CommandLine -match 'watchdog\.ps1' -and $_.CommandLine -notmatch '-Install' -and $_.ProcessId -ne $PID }
  if ($already) { Write-Host "Watchdog already running."; exit 0 }
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $inner = '"' + $ps + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '"'
  $outer = 'wscript.exe //nologo "' + $hiddenVbs + '" "' + $inner.Replace('"','""') + '"'
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $outer; CurrentDirectory = $repo }
  if ($r.ReturnValue -eq 0) { Write-Host "Watchdog started." } else { Write-Host ("Watchdog start returned " + $r.ReturnValue) }
  exit 0
}

# ---- default: run the watch loop ----
# Never allow two watchdogs; a second one would double every relaunch.
$dupes = Get-CimInstance Win32_Process |
         Where-Object { $_.CommandLine -match 'watchdog.ps1' -and $_.CommandLine -notmatch '-Install|-Uninstall' -and $_.ProcessId -ne $PID }
if ($dupes) { Log "Another watchdog is already running -- exiting."; exit 0 }

Log ("Watchdog started (pid " + $PID + "), checking ports " + (($Targets | ForEach-Object { $_.Port }) -join ', ') + " every " + $IntervalSeconds + "s.")
$down = @{}   # port -> consecutive failed checks

while ($true) {
  foreach ($t in $Targets) {
    if (Test-PortOpen $t.Port) {
      if ($down[$t.Port]) { Log ("  " + $t.Label + " (port " + $t.Port + ") is back up."); $down[$t.Port] = 0 }
      continue
    }
    $down[$t.Port] = [int]$down[$t.Port] + 1
    # Require two consecutive misses before acting, so a server that is merely busy
    # or mid-restart (the launcher's own 5s backoff) is never double-started.
    if ($down[$t.Port] -lt 2) { Log ("  " + $t.Label + " (port " + $t.Port + ") did not answer -- rechecking."); continue }
    $hasLauncher = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match [regex]::Escape($t.Script) }
    if ($hasLauncher) { Log ("  " + $t.Label + " down but its launcher is alive -- letting the launcher retry."); continue }
    Log ("  " + $t.Label + " (port " + $t.Port + ") is DOWN and has no launcher -- restarting it.")
    if (Start-Detached $t.Script) { $down[$t.Port] = 0 }
  }
  Start-Sleep -Seconds $IntervalSeconds
}
