<#
  watch-destiny.ps1 — auto-launch the TRMNL Destiny 2 server with the game.

  Watches for the Destiny 2 process. When the game starts, it launches
  `node server.js` (hidden) from this script's folder; when the game closes,
  it stops the server again (so it isn't running/using power when you're not playing).

  RUN IT ONCE (manual):
      powershell -ExecutionPolicy Bypass -File watch-destiny.ps1

  RUN IT AUTOMATICALLY AT LOGIN (so it's always watching) — run this once in an
  Administrator PowerShell, from the repo folder:
      $w = "$PWD\watch-destiny.ps1"
      Register-ScheduledTask -TaskName "TRMNL Destiny watcher" -Force `
        -Action (New-ScheduledTaskAction -Execute "powershell.exe" `
          -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$w`"") `
        -Trigger (New-ScheduledTaskTrigger -AtLogOn) `
        -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)

  Options can be overridden, e.g.:
      powershell -File watch-destiny.ps1 -KeepRunning   (don't stop server when game closes)
#>

param(
  [string]$ProcessName = "destiny2",  # Steam & Epic both use destiny2.exe
  [int]$Port = 3000,
  [int]$PollSeconds = 15,
  [switch]$KeepRunning                # if set, leave the server up after the game exits
)

$ErrorActionPreference = "SilentlyContinue"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = $null

function Log($msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg) }

function Test-PortOpen($p) {
  # true if something is already listening on localhost:$p
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect("127.0.0.1", $p); $client.Close(); return $true } catch { return $false }
}

Log "Watching for '$ProcessName' (server folder: $repo, port: $Port). Ctrl+C to stop."

while ($true) {
  $gameUp   = [bool](Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
  $serverUp = ($server -ne $null) -and (-not $server.HasExited)

  if ($gameUp -and -not $serverUp) {
    if (Test-PortOpen $Port) {
      Log "Game is running and port $Port is already in use — assuming the server is already up."
    } else {
      Log "Game launched -> starting server."
      $server = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $repo -WindowStyle Hidden -PassThru
    }
  }
  elseif (-not $gameUp -and $serverUp -and -not $KeepRunning) {
    Log "Game closed -> stopping server."
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    $server = $null
  }

  Start-Sleep -Seconds $PollSeconds
}
