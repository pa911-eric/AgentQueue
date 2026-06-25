#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "AgentQueue needs Node.js 18 or newer."
  echo "Install Node.js, then run this launcher again."
  exit 1
fi

export AGENTQUEUE_OPEN="${AGENTQUEUE_OPEN:-1}"
node --no-warnings server.js
