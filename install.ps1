param(
    [Parameter(Mandatory = $false)]
    [string] $Version = "latest",

    [Parameter(Mandatory = $false)]
    [string] $InstallPath = "$env:LOCALAPPDATA\AgentQueue",

    [switch] $Launch,

    [switch] $NoPause
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

$repoUrl = "https://github.com/pa911-eric/AgentQueue"
$releaseApiUrl = "$repoUrl/releases/latest"
$start = [DateTime]::Now
$logPath = Join-Path $env:TEMP ("AgentQueue-install-$([DateTime]::Now.ToString('yyyyMMdd-HHmmss')).log")
$installState = [ordered]@{
    Start = $start
    End = $start
    Tag = $null
    RequestedVersion = $Version
    InstallPath = $InstallPath
    LogPath = $logPath
    Completed = $false
}
$initialInstallPath = $InstallPath
$requestedInstallPath = $InstallPath

function Write-InstallerStatus([string]$state, [string]$message) {
    $color = switch ($state.ToLowerInvariant()) {
        "ok" { "Green" }
        "warn" { "Yellow" }
        "fail" { "Red" }
        default { "Cyan" }
    }
    $label = $state.ToUpperInvariant()
    Write-Host "[AgentQueue Installer] [$label] $message" -ForegroundColor $color
}

function Resolve-Tag([string]$requestedVersion) {
    if ([string]::IsNullOrWhiteSpace($requestedVersion) -or $requestedVersion -ieq "latest") {
        Write-InstallerStatus info "Checking GitHub for the latest release tag..."
        $headers = @{
            accept = "application/vnd.github+json"
            "user-agent" = "AgentQueueInstaller/0.1.0"
        }
        try {
            $release = Invoke-RestMethod -Headers $headers -Uri $releaseApiUrl -ErrorAction Stop
        } catch {
            throw "Unable to resolve latest release from GitHub. Pass -Version explicitly and try again."
        }

        if (-not $release.tag_name) {
            throw "GitHub release metadata did not include a tag name."
        }
        return [string]$release.tag_name
    }

    return if ($requestedVersion -like "v*") { $requestedVersion } else { "v$requestedVersion" }
}

function Check-Node() {
    Write-InstallerStatus info "Checking Node.js runtime"
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js is required but was not found. Install Node.js 18+ and rerun."
    }

    $nodeVersion = & node --version
    if ($nodeVersion -notmatch "^v(?<major>[0-9]+)\.") {
        throw "Unable to parse Node.js version from '$nodeVersion'."
    }

    $major = [int]$Matches.major
    if ($major -lt 18) {
        throw "Node.js 18+ is required. Detected: $nodeVersion"
    }

    Write-InstallerStatus ok "Node.js detected: $nodeVersion"
}

function Wait-ForDashboard([string]$url, [int]$maxWaitSeconds = 15) {
    $deadline = (Get-Date).AddSeconds($maxWaitSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri $url
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return $true }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Open-Browser([string]$url) {
    try {
        Start-Process $url
    } catch {
        Write-InstallerStatus warn "Could not auto-open the browser. Open manually: $url"
    }
}

function Show-Summary() {
    $installPath = $installState.InstallPath
    $tag = $installState.Tag
    $elapsed = [int](($installState.End - $installState.Start).TotalSeconds)
    $launcher = Join-Path $installPath "start-dashboard.cmd"

    Write-Host ""
    Write-Host "AgentQueue install complete."
    Write-Host "Version:    $tag"
    Write-Host "Location:   $installPath"
    Write-Host "Launcher:   $launcher"
    Write-Host "Log file:   $logPath"
    Write-Host "Elapsed:    ${elapsed}s"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  - Start now:      $launcher"
    Write-Host "  - Diagnostics:    node --no-warnings `"$installPath\\server.js`" doctor"
    Write-Host "  - Update checks:  npm --prefix `"$installPath`" run update-check"
    if ($Launch) {
        Write-Host "  - Browser:        Open http://localhost:4173"
    }

    if ($initialInstallPath -ne $installPath) {
        Write-InstallerStatus warn "Existing install was not replaced (in use). Update path: $installPath"
        Write-InstallerStatus warn "Close AgentQueue and rerun installer if you want to update: $initialInstallPath"
    }
}

function Wait-ForConfirmation() {
    if ($NoPause) { return }
    if ([System.Console]::IsInputRedirected -or [System.Console]::IsOutputRedirected) {
        return
    }

        Write-Host ""
        Write-Host "Press Enter to close this window"
        [void][System.Console]::ReadLine()
}

Write-InstallerStatus info "Starting AgentQueue installer"
Write-InstallerStatus info "Requested version: $Version"
Write-InstallerStatus info "Installer log: $logPath"

try {
    Start-Transcript -Path $logPath -Force | Out-Null
    Check-Node

    $tag = Resolve-Tag -requestedVersion $Version
    $installState.Tag = $tag
    $installState.InstallPath = $requestedInstallPath
    $versionWithoutV = $tag.TrimStart("v")
    $archiveUrl = "$repoUrl/archive/refs/tags/$tag.zip"
    $zipPath = Join-Path $env:TEMP "agentqueue-$versionWithoutV.zip"
    $extractPath = Join-Path $env:TEMP "agentqueue-$versionWithoutV-$([DateTime]::Now.ToString('yyyyMMdd-HHmmss'))"
    $repoRoot = Join-Path $extractPath "AgentQueue-$versionWithoutV"
    $alternateRepoRoot = Join-Path $extractPath "AgentQueue-$tag"

    Write-InstallerStatus ok "Resolved install tag: $tag"
    Write-InstallerStatus info "Archive URL: $archiveUrl"

    if (Test-Path $requestedInstallPath) {
        Write-InstallerStatus warn "Existing installation found at $requestedInstallPath"
        try {
            Remove-Item -Recurse -Force -LiteralPath $requestedInstallPath -ErrorAction Stop
            Write-InstallerStatus ok "Removed existing installation."
        } catch {
            $fallbackSuffix = Get-Date -Format "yyyyMMdd-HHmmss"
            $fallbackPath = Join-Path (Split-Path $requestedInstallPath -Parent) "AgentQueue-$fallbackSuffix"
            Write-InstallerStatus warn "Could not replace existing install (likely in use)."
            Write-InstallerStatus warn "Switching to alternate install location: $fallbackPath"
            Write-InstallerStatus warn "Close AgentQueue and rerun installer if you want to update $requestedInstallPath."
            $requestedInstallPath = $fallbackPath
            $installState.InstallPath = $requestedInstallPath
        }
    }

    Write-InstallerStatus info "Downloading release archive..."
    Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -OutFile $zipPath
    Write-InstallerStatus ok "Downloaded to $zipPath"

    if (Test-Path $extractPath) {
        Remove-Item -Recurse -Force -LiteralPath $extractPath
    }

    Write-InstallerStatus info "Expanding package..."
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
    Write-InstallerStatus ok "Expanded archive to $extractPath"

    if (-not (Test-Path $repoRoot)) {
        if (Test-Path $alternateRepoRoot) {
            Write-InstallerStatus warn "Detected v-prefixed archive root: $alternateRepoRoot"
            $repoRoot = $alternateRepoRoot
        } else {
            throw "Could not locate extracted source folder in $extractPath"
        }
    }

    New-Item -ItemType Directory -Path $requestedInstallPath | Out-Null
    Copy-Item -Path (Join-Path $repoRoot "*") -Destination $requestedInstallPath -Recurse -Force
    $installState.InstallPath = $requestedInstallPath
    Write-InstallerStatus ok "Installed to: $requestedInstallPath"
    Write-InstallerStatus info "Launcher: $requestedInstallPath\\start-dashboard.cmd"

    $launcher = Join-Path $requestedInstallPath "start-dashboard.cmd"
    if ($Launch) {
        Write-InstallerStatus info "Launching AgentQueue and opening browser..."
        Start-Process -FilePath $launcher
        if (Wait-ForDashboard "http://localhost:4173") {
            Write-InstallerStatus ok "AgentQueue is running at http://localhost:4173"
            Open-Browser "http://localhost:4173"
        } else {
            Write-InstallerStatus warn "Server did not respond on http://localhost:4173 yet."
            Write-InstallerStatus warn "Run this command manually to start: `"$launcher`""
        }
    } else {
        Write-InstallerStatus info "Run this to start AgentQueue now: `"$launcher`""
    }

    $installState.End = [DateTime]::Now
    Show-Summary
} catch {
    $installState.End = [DateTime]::Now
    Write-InstallerStatus fail "Install failed: $($_.Exception.Message)"
    Write-InstallerStatus fail "Log file: $logPath"
    exit 1
} finally {
    Stop-Transcript | Out-Null
    $installState.Completed = $true
    if ($installState.Tag) {
        Write-InstallerStatus info "Installer finished. Log file is at: $logPath"
    }
    Wait-ForConfirmation
}
