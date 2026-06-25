$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "AgentQueue needs Node.js 18 or newer."
  Write-Host "Install Node.js, then run this launcher again."
  Read-Host "Press Enter to close"
  exit 1
}

if (-not $env:AGENTQUEUE_OPEN) {
  $env:AGENTQUEUE_OPEN = "1"
}

node --no-warnings server.js
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "AgentQueue stopped with an error. Run npm run doctor for diagnostics."
  Read-Host "Press Enter to close"
  exit $LASTEXITCODE
}
