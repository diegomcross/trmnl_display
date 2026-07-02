<#
  watch-destiny.ps1 -- auto-launch the TRMNL Destiny 2 server with the game.

  Watches for the Destiny 2 process. When the game starts, it launches
  node server.js (hidden) from this script's folder; when the game closes,
  it stops the server again.

  FIRST-TIME SETUP (registers a logon Task Scheduler task -- run once):
      powershell -ExecutionPolicy Bypass -File watch-destiny.ps1 -Setup

  MANUAL RUN:
      powershell -ExecutionPolicy Bypass -File watch-destiny.ps1

  OPTIONS:
      -KeepRunning   Don't stop server when game closes
      -Setup         Register the Task Scheduler logon task, then start watching
      -Uninstall     Remove the Task Scheduler task
#>

param(
  [string]$ProcessName = "destiny2",
  [int]$Port = 3000,
  [int]$PollSeconds = 15,
  [switch]$KeepRunning,
  [switch]$Setup,
  [switch]$Uninstall
)

$ErrorActionPreference = "SilentlyContinue"
$TaskName = "TRMNL Destiny watcher"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $repo "watcher.log"

function Log($msg) {
  $line = "[" + (Get-Date -Format "HH:mm:ss") + "] " + $msg
  Write-Host $line
  try { Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue } catch {}
}

function Register-WatcherTask {
  $scriptPath = Join-Path $repo "watch-destiny.ps1"
  $arg = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"" + $scriptPath + "`""
  $action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
  $trigger  = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0
  Register-ScheduledTask -TaskName $TaskName -Force -Action $action -Trigger $trigger -Settings $settings | Out-Null
  Write-Host "Task registered. It will start automatically on every login."
  Write-Host "Starting the watcher now..."
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Task removed."
  exit 0
}

if ($Setup) {
  Register-WatcherTask
}

# Find node.exe -- Task Scheduler runs without the user PATH so we search explicitly.
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
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  $nvmRoot = "$env:APPDATA\nvm"
  if (Test-Path $nvmRoot) {
    $ver = Get-ChildItem $nvmRoot -Directory -ErrorAction SilentlyContinue |
           Sort-Object Name -Descending |
           Select-Object -First 1
    if ($ver) {
      $candidate = Join-Path $ver.FullName "node.exe"
      if (Test-Path $candidate) { return $candidate }
    }
  }
  return $null
}

$nodePath = Find-Node
if (-not $nodePath) {
  Log "ERROR: node.exe not found. Install Node.js or check your PATH."
  exit 1
}
Log "Using node: $nodePath"

function Test-PortOpen($p) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect("127.0.0.1", $p); $client.Close(); return $true } catch { return $false }
}

Log "Watching for '$ProcessName' (repo: $repo, port: $Port). Ctrl+C to stop."

$server = $null

while ($true) {
  $gameUp   = [bool](Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
  $serverUp = ($server -ne $null) -and (-not $server.HasExited)

  if ($gameUp -and (-not $serverUp)) {
    if (Test-PortOpen $Port) {
      Log "Game running, port $Port already in use -- external server detected."
    } else {
      if ($server -ne $null -and $server.HasExited) {
        $reason = "crashed - restarting"
      } else {
        $reason = "starting"
      }
      Log "Game running -> server $reason."
      $server = Start-Process `
        -FilePath $nodePath `
        -ArgumentList "server.js" `
        -WorkingDirectory $repo `
        -WindowStyle Hidden `
        -PassThru
    }
  } elseif ((-not $gameUp) -and $serverUp -and (-not $KeepRunning)) {
    Log "Game closed -> stopping server."
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    $server = $null
  }

  Start-Sleep -Seconds $PollSeconds
}
