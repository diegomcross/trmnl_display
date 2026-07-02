<#
  start-display.ps1 -- run the TRMNL Destiny 2 dashboard server ALWAYS-ON.

  Unlike watch-destiny.ps1 (which only runs the server while the game is open),
  this keeps the dashboard server running whether or not Destiny is running, so the
  panel/phone can show the board any time. Data comes from Bungie via tokens.json, so
  the game does NOT need to be running.

  ALWAYS-ON SETUP (add a hidden login item + start now -- run once):
      powershell -ExecutionPolicy Bypass -File start-display.ps1 -Install

  MANUAL START (this window only; close the window to stop):
      powershell -ExecutionPolicy Bypass -File start-display.ps1

  REMOVE THE LOGIN ITEM:
      powershell -ExecutionPolicy Bypass -File start-display.ps1 -Uninstall

  NOTE: auto-start uses the Windows Startup folder (per-user, no admin needed).
  Task Scheduler is intentionally NOT used -- it is blocked ("Access is denied")
  on this machine.

  Keep this file ASCII-only (Windows PowerShell 5.1 parser chokes on non-ASCII).
#>

param(
  [int]$Port = 3000,
  [switch]$Install,
  [switch]$Uninstall
)

$Name = "TRMNL D2 Display"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $repo "start-display.ps1"
$logFile = Join-Path $repo "server.log"
$startupDir = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startupDir ($Name + ".lnk")
$cmdPath = Join-Path $startupDir ($Name + ".cmd")

function Log($msg) {
  $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [launcher] " + $msg
  Write-Host $line
  try { Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue } catch {}
}

# Find node.exe explicitly -- a login shell may not have the user PATH.
function Find-Node {
  $fromPath = (Get-Command "node.exe" -ErrorAction SilentlyContinue)
  if ($fromPath) { return $fromPath.Source }
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    "$env:APPDATA\nvm\current\node.exe",
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $nvmRoot = "$env:APPDATA\nvm"
  if (Test-Path $nvmRoot) {
    $ver = Get-ChildItem $nvmRoot -Directory -ErrorAction SilentlyContinue |
           Sort-Object Name -Descending | Select-Object -First 1
    if ($ver) { $candidate = Join-Path $ver.FullName "node.exe"; if (Test-Path $candidate) { return $candidate } }
  }
  return $null
}

function Test-PortOpen($p) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect("127.0.0.1", $p); $client.Close(); return $true } catch { return $false }
}

function Install-LoginItem {
  $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
  if (-not $psExe) { $psExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" }
  $args = '-WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
  $made = $false
  try {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnkPath)
    $sc.TargetPath = $psExe
    $sc.Arguments = $args
    $sc.WorkingDirectory = $repo
    $sc.WindowStyle = 7
    $sc.Description = "Start the Destiny 2 TRMNL dashboard server at login"
    $sc.Save()
    if (Test-Path $lnkPath) { $made = $true; Write-Host ("Login item created: " + $lnkPath) }
  } catch {
    Write-Host ("Shortcut creation failed (" + $_.Exception.Message + "); writing a .cmd instead.")
  }
  if (-not $made) {
    # Fallback: a .cmd that relaunches itself hidden via PowerShell.
    $cmd = '@echo off' + "`r`n" + 'start "" /min "' + $psExe + '" ' + $args + "`r`n"
    Set-Content -Path $cmdPath -Value $cmd -Encoding ASCII
    if (Test-Path $cmdPath) { Write-Host ("Login item created: " + $cmdPath) }
    else { Write-Host "ERROR: could not create a login item in $startupDir" }
  }
}

function Remove-LoginItem {
  foreach ($p in @($lnkPath, $cmdPath)) { if (Test-Path $p) { Remove-Item $p -Force -ErrorAction SilentlyContinue; Write-Host ("Removed " + $p) } }
  # Best-effort: also drop any old scheduled task from earlier attempts.
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
}

if ($Uninstall) { Remove-LoginItem; Write-Host "Auto-start removed."; exit 0 }

if ($Install) {
  Install-LoginItem
  if (Test-PortOpen $Port) {
    Write-Host "Server already running on port $Port."
  } else {
    $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
    if (-not $psExe) { $psExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" }
    Start-Process -FilePath $psExe -WindowStyle Hidden -WorkingDirectory $repo `
      -ArgumentList ('-WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '"')
    Start-Sleep -Seconds 5
    if (Test-PortOpen $Port) { Write-Host "Server is UP on port $Port. Preview: http://localhost:$Port/" }
    else { Write-Host "Started, but nothing is listening on $Port yet -- check server.log in the repo folder." }
  }
  exit 0
}

# ---- default: run the server in the foreground and keep it alive ----
# This is what the login item invokes. The loop restarts node if it ever exits.
if (Test-PortOpen $Port) { Log "Server already listening on port $Port -- not starting a second copy."; exit 0 }

$nodePath = Find-Node
if (-not $nodePath) { Log "ERROR: node.exe not found. Install Node.js or check your PATH."; exit 1 }

Set-Location $repo
Log "Starting server: $nodePath server.js  (repo: $repo, port: $Port)"
while ($true) {
  & $nodePath "server.js"
  Log ("server.js exited (code " + $LASTEXITCODE + "). Restarting in 5s...")
  Start-Sleep -Seconds 5
}
