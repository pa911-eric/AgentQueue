@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo AgentQueue needs Node.js 18 or newer.
  echo Install Node.js, then run this launcher again.
  pause
  exit /b 1
)

if "%AGENTQUEUE_OPEN%"=="" set AGENTQUEUE_OPEN=1
node --no-warnings server.js
if errorlevel 1 (
  echo.
  echo AgentQueue stopped with an error. Run npm run doctor for diagnostics.
  pause
  exit /b 1
)
