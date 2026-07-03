<#
  start-vault.ps1 -- run the Vault Verdict server (port 8787) ALWAYS-ON.

  This is the server behind Vault Verdict, Weapon Watch, and New Drops. It ALSO
  runs the live god-roll drop poller and the two-way DIM tag sync -- both of which
  only work while this server is running. Keep it always-on so alerts fire and tags
  stay in sync whenever you play, without you starting anything by hand.

  Mirrors start-display.ps1 (which does the same for the e-ink display server) and
  is fully independent of it -- installing/removing this does not touch that one.

  ALWAYS-ON SETUP (add a hidden login item + start now -- run once):
      powershell -ExecutionPolicy Bypass -File start-vault.ps1 -Install

  MANUAL START (this window only; close the window to stop):
      powershell -ExecutionPolicy Bypass -File start-vault.ps1

  REMOVE THE LOGIN ITEM:
      powershell -ExecutionPolicy Bypass -File start-vault.ps1 -Uninstall

  NOTE: auto-start uses the Windows Startup folder (per-user, no admin needed).
  Task Scheduler is intentionally NOT used -- it is blocked ("Access is denied")
  on this machine.

  Keep this file ASCII-only (Windows PowerShell 5.1 parser chokes on non-ASCII).
#>

param(
  [int]$Port = 8787,
  [switch]$Install,
  [switch]$Uninstall
)

$Name = "TRMNL Vault Verdict"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $repo "start-vault.ps1"
$logFile = Join-Path $repo "vault.log"
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
    $sc.Description = "Start the Vault Verdict server (weapons + drop alerts + DIM sync) at login"
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
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
}

if ($Uninstall) { Remove-LoginItem; Write-Host "Auto-start removed."; exit 0 }

if ($Install) {
  Install-LoginItem
  if (Test-PortOpen $Port) {
    Write-Host "Vault Verdict already running on port $Port."
  } else {
    $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
    if (-not $psExe) { $psExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" }
    Start-Process -FilePath $psExe -WindowStyle Hidden -WorkingDirectory $repo `
      -ArgumentList ('-WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '"')
    Start-Sleep -Seconds 5
    if (Test-PortOpen $Port) { Write-Host "Vault Verdict is UP on port $Port. Open: http://localhost:$Port/" }
    else { Write-Host "Started, but nothing is listening on $Port yet -- check vault.log in the repo folder." }
  }
  exit 0
}

# ---- default: run the server in the foreground and keep it alive ----
# This is what the login item invokes. The loop restarts node if it ever exits.
if (Test-PortOpen $Port) { Log "Vault Verdict already listening on port $Port -- not starting a second copy."; exit 0 }

$nodePath = Find-Node
if (-not $nodePath) { Log "ERROR: node.exe not found. Install Node.js or check your PATH."; exit 1 }

Set-Location $repo
Log "Starting server: $nodePath vault-verdict.js  (repo: $repo, port: $Port)"
while ($true) {
  & $nodePath "vault-verdict.js"
  Log ("vault-verdict.js exited (code " + $LASTEXITCODE + "). Restarting in 5s...")
  Start-Sleep -Seconds 5
}
