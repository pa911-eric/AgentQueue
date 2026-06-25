param(
    [Parameter(Mandatory = $false)]
    [string] $Version = "0.1.0",

    [Parameter(Mandatory = $false)]
    [string] $InstallPath = "$env:LOCALAPPDATA\AgentQueue",

    [switch] $Launch
)

$ErrorActionPreference = "Stop"

$tag = if ($Version -like "v*") { $Version } else { "v$Version" }
$logPath = Join-Path $env:TEMP ("AgentQueue-install-$([DateTime]::Now.ToString('yyyyMMdd-HHmmss')).log")
$archiveUrl = "https://github.com/pa911-eric/AgentQueue/archive/refs/tags/$tag.zip"
$zipPath = Join-Path $env:TEMP ("agentqueue-$tag.zip")
$extractPath = Join-Path $env:TEMP ("agentqueue-$tag")
$versionWithoutV = $tag.TrimStart("v")
$repoRoot = Join-Path $extractPath "AgentQueue-$versionWithoutV"
$alternateRepoRoot = Join-Path $extractPath "AgentQueue-$tag"

function Write-Step($message) {
  Write-Host "[AgentQueue Installer] $message"
}

function Wait-ForDashboard($url, [int]$maxWaitSeconds = 15) {
  $deadline = (Get-Date).AddSeconds($maxWaitSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri $url
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

function Open-Browser($url) {
  try {
    Start-Process $url
  } catch {
    Write-Step "Could not auto-open the browser. Open manually: $url"
  }
}

Write-Step "Starting AgentQueue installer for $tag"
Write-Step "Installer log: $logPath"
Write-Step "Downloading $archiveUrl"

Start-Transcript -Path $logPath -Force | Out-Null
try {
  Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -OutFile $zipPath

  if (Test-Path $extractPath) {
    Remove-Item -Recurse -Force -LiteralPath $extractPath
  }

  Write-Step "Expanding package ..."
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force

  if (-not (Test-Path $repoRoot)) {
    if (Test-Path $alternateRepoRoot) {
      Write-Step "Detected v-prefixed archive root: $alternateRepoRoot"
      $repoRoot = $alternateRepoRoot
    } else {
      throw "Could not find extracted AgentQueue source at $repoRoot or $alternateRepoRoot."
    }
  }

  if (Test-Path $InstallPath) {
    Write-Step "Replacing existing installation at $InstallPath"
    Remove-Item -Recurse -Force -LiteralPath $InstallPath
  }

  New-Item -ItemType Directory -Path $InstallPath | Out-Null
  Copy-Item -Path (Join-Path $repoRoot "*") -Destination $InstallPath -Recurse -Force

  Write-Step "Installed to: $InstallPath"
  Write-Step "Launcher: $InstallPath\\start-dashboard.cmd"

  if ($Launch) {
    Write-Step "Launching AgentQueue and opening dashboard in browser..."
    Start-Process -FilePath (Join-Path $InstallPath "start-dashboard.cmd")
    if (Wait-ForDashboard "http://localhost:4173") {
      Write-Step "AgentQueue is running at http://localhost:4173"
      Open-Browser "http://localhost:4173"
    } else {
      Write-Step "Server did not respond on http://localhost:4173 yet."
      Write-Step "Run this command manually to start: `"$InstallPath\\start-dashboard.cmd`""
    }
  } else {
    Write-Step "Run this to start AgentQueue now: `"$InstallPath\\start-dashboard.cmd`""
  }
} catch {
  Write-Step "Install failed: $($_.Exception.Message)"
  Write-Step "Log file: $logPath"
  throw
} finally {
  Stop-Transcript | Out-Null
  Write-Step "Done."
}
