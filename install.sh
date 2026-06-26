#!/usr/bin/env bash
set -euo pipefail

VERSION="latest"
INSTALL_PATH=""
LAUNCH=0

if [ -n "${XDG_DATA_HOME:-}" ]; then
  INSTALL_PATH="${XDG_DATA_HOME}/AgentQueue"
else
  INSTALL_PATH="${HOME}/.local/share/AgentQueue"
fi

log_time() {
  date -u +'%Y-%m-%d %H:%M:%S'
}

log_status() {
  local level="$1"
  shift
  printf '[%s] [%s] %s\n' "$(log_time)" "$level" "$*"
}

log_info() { log_status "INFO" "$*"; }
log_ok() { log_status "OK" "$*"; }
log_warn() { log_status "WARN" "$*"; }
log_error() { log_status "ERROR" "$*"; }

usage() {
  cat <<'USAGE'
Usage: install.sh [--version <version|latest>] [--path <install-dir>] [--launch]

Options:
  --version    Version to install (defaults to latest). Use "0.1.0" or "v0.1.0".
  --path       Install target directory (default: "$HOME/.local/share/AgentQueue").
  --launch     Start AgentQueue after installation and open the dashboard URL.
  -h, --help  Show this help.
USAGE
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  local cmd="$1"
  if ! have_cmd "$cmd"; then
    log_error "Missing required command: $cmd"
    exit 1
  fi
}

is_windows() {
  case "${OS:-}" in
    Windows_NT) return 0 ;;
    *) return 1 ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --path)
      INSTALL_PATH="${2:-}"
      shift 2
      ;;
    --launch)
      LAUNCH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [ -z "${INSTALL_PATH}" ]; then
  log_error "Install path resolved to empty value."
  exit 1
fi

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
LOG_PATH="${TMPDIR:-/tmp}/agentqueue-install-${TIMESTAMP}.log"
touch "$LOG_PATH"
chmod 600 "$LOG_PATH" 2>/dev/null || true
exec > >(tee -a "$LOG_PATH") 2>&1

START_TIME="$(date -u +%s)"
REPO_URL="https://github.com/pa911-eric/AgentQueue"
BASE_URL="${REPO_URL}/archive/refs/tags"

normalize_tag() {
  local version="$1"
  if [ "$version" = "latest" ] || [ -z "$version" ]; then
    printf 'latest'
    return
  fi
  case "$version" in
    v[0-9]* ) printf '%s' "$version" ;;
    * ) printf 'v%s' "$version" ;;
  esac
}

fetch_latest_version() {
  local release_json
  if have_cmd curl; then
    release_json="$(curl -fsSL -H "accept: application/vnd.github+json" "https://api.github.com/repos/pa911-eric/AgentQueue/releases/latest")"
  elif have_cmd wget; then
    release_json="$(wget -qO- "https://api.github.com/repos/pa911-eric/AgentQueue/releases/latest")"
  else
    log_error "Either curl or wget is required to install from GitHub."
    exit 1
  fi

  printf '%s' "$release_json" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n '1p'
}

open_browser() {
  local url="$1"
  if have_cmd xdg-open; then
    xdg-open "$url" >/dev/null 2>&1 || true
  elif have_cmd open; then
    open "$url" >/dev/null 2>&1 || true
  elif have_cmd start; then
    start "$url" >/dev/null 2>&1 || true
  fi
}

wait_for_dashboard() {
  local url="$1"
  local timeout="${2:-15}"
  local deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if have_cmd curl; then
      if curl -fsS -o /dev/null "$url" >/dev/null 2>&1; then
        return 0
      fi
    elif have_cmd wget; then
      if wget -qO- "$url" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 0.5
  done
  return 1
}

check_node() {
  log_info "Checking Node.js runtime"
  if ! have_cmd node; then
    log_error "Node.js not found. Install Node.js 18+ and rerun."
    exit 1
  fi

  local node_version
  node_version="$(node -v 2>/dev/null || true)"
  if [[ ! "$node_version" =~ ^v([0-9]+)\. ]]; then
    log_error "Could not detect Node.js version from '$node_version'."
    exit 1
  fi

  local node_major="${BASH_REMATCH[1]}"
  if [ "$node_major" -lt 18 ]; then
    log_error "Node.js 18+ is required. Detected: $node_version"
    exit 1
  fi
  log_ok "Node.js detected: $node_version"
}

cleanup_temp() {
  local path="$1"
  if [ -n "$path" ] && [ -d "$path" ]; then
    rm -rf "$path"
  fi
}

log_info "Starting AgentQueue install"
log_info "Installer log: $LOG_PATH"
log_info "Target: $INSTALL_PATH"
log_info "Requested version: $VERSION"

if is_windows; then
  log_warn "Detected Windows shell environment. Use install.ps1 for best support."
fi

require_cmd node
check_node

REMAINING_TAG="$VERSION"
if [ "$VERSION" = "latest" ]; then
  log_info "Resolving latest release from GitHub"
  RESOLVED_TAG="$(fetch_latest_version)"
  if [ -z "$RESOLVED_TAG" ]; then
    log_error "Could not resolve latest release tag."
    exit 1
  fi
  REMAINING_TAG="$RESOLVED_TAG"
fi

ARCHIVE_TAG="$(normalize_tag "$REMAINING_TAG")"
VERSION_WITHOUT_V="${ARCHIVE_TAG#v}"
ARCHIVE_URL="${BASE_URL}/${ARCHIVE_TAG}.zip"

log_ok "Resolved release tag: ${ARCHIVE_TAG}"
log_info "Archive: ${ARCHIVE_URL}"

require_cmd unzip

TMP_DIR="$(mktemp -d)"
ZIP_PATH="${TMP_DIR}/agentqueue-${ARCHIVE_TAG}.zip"
EXTRACT_PATH="${TMP_DIR}/extract"
mkdir -p "$EXTRACT_PATH"

trap 'cleanup_temp "$TMP_DIR"' EXIT

if have_cmd curl; then
  curl -fsSL -o "$ZIP_PATH" "$ARCHIVE_URL"
else
  wget -qO "$ZIP_PATH" "$ARCHIVE_URL"
fi
log_ok "Downloaded archive"

unzip -q "$ZIP_PATH" -d "$EXTRACT_PATH"
log_ok "Extracted archive"

REPO_ROOT="${EXTRACT_PATH}/AgentQueue-${VERSION_WITHOUT_V}"
ALT_REPO_ROOT="${EXTRACT_PATH}/AgentQueue-${ARCHIVE_TAG}"
if [ -d "$REPO_ROOT" ]; then
  SOURCE_ROOT="$REPO_ROOT"
elif [ -d "$ALT_REPO_ROOT" ]; then
  log_info "Detected v-prefixed archive root: $ALT_REPO_ROOT"
  SOURCE_ROOT="$ALT_REPO_ROOT"
else
  log_error "Could not find expected extracted source directory."
  ls -1 "$EXTRACT_PATH"
  exit 1
fi

if [ -d "$INSTALL_PATH" ]; then
  if rm -rf "$INSTALL_PATH" 2>/dev/null; then
    log_ok "Replaced existing installation at $INSTALL_PATH"
  else
    BACKUP_PATH="${INSTALL_PATH}-old-${TIMESTAMP}"
    log_warn "Could not remove current install; using alternate location: $BACKUP_PATH"
    log_warn "Close AgentQueue and rerun if you need to update $INSTALL_PATH."
    INSTALL_PATH="$BACKUP_PATH"
  fi
fi

mkdir -p "$INSTALL_PATH"
cp -R "$SOURCE_ROOT"/. "$INSTALL_PATH"/
log_ok "Installed to $INSTALL_PATH"

LAUNCHER="$INSTALL_PATH/start-dashboard.sh"

if [ "$LAUNCH" -eq 1 ]; then
  if [ ! -x "$LAUNCHER" ]; then
    log_warn "$LAUNCHER is not executable. Attempting chmod +x."
    chmod +x "$LAUNCHER"
  fi

  log_info "Launching AgentQueue from $LAUNCHER"
  (nohup "$LAUNCHER" >/dev/null 2>&1 &) 
  if wait_for_dashboard "http://localhost:4173" 15; then
    log_ok "AgentQueue is running at http://localhost:4173"
    open_browser "http://localhost:4173"
  else
    log_warn "Server did not respond on localhost:4173 in time."
    log_warn "Start manually with: \"$LAUNCHER\""
  fi
fi

END_TIME="$(date -u +%s)"
ELAPSED=$((END_TIME - START_TIME))
log_ok "Install complete in ${ELAPSED}s"
cat <<SUMMARY

AgentQueue install complete.

Version:    ${ARCHIVE_TAG}
Location:   ${INSTALL_PATH}
Launcher:   ${LAUNCHER}
Config:     ${INSTALL_PATH}/.agentqueue.example.json
Log file:   ${LOG_PATH}

Next steps:
  - Start now:      ${LAUNCHER}
  - Update check:    npm --prefix \"${INSTALL_PATH}\" run update-check
  - Diagnostics:     node --no-warnings \"${INSTALL_PATH}/server.js\" doctor
SUMMARY
exit 0
