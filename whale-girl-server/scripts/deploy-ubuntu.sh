#!/usr/bin/env bash
# Whale Girl — optional rsync deploy wrapper (M4.2 pattern 2, for operators who
# already use SSH). It is NOT required for the cloud pattern: the console
# walkthrough (git clone + install-ubuntu.sh) works without it.
#
# Usage:
#   bash scripts/deploy-ubuntu.sh [--dry-run] [user@]host [remote-dir] [domain]
#
# What it does: rsync the repo to the host (excluding node_modules/.venv/.git/
# audio/logs, INCLUDING the model folder), then run install-ubuntu.sh there.
set -euo pipefail

say()  { printf '[deploy-ubuntu] %s\n' "$*"; }
die()  { printf '[deploy-ubuntu] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  printf '%s\n' \
    'Usage: bash scripts/deploy-ubuntu.sh [--dry-run] [user@]host [remote-dir] [domain]' \
    '' \
    'Defaults: remote-dir /opt/whale-girl-monorepo; domain empty (self-signed TLS).' \
    'Env: WHALE_SSH_HOST, WHALE_SSH_USER, WHALE_REMOTE_DIR, WHALE_DOMAIN.'
}

DRY=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $arg (try --help)" ;;
    *) ARGS+=("$arg") ;;
  esac
done

HOST_ARG="${ARGS[0]:-${WHALE_SSH_HOST:-}}"
REMOTE_DIR="${ARGS[1]:-${WHALE_REMOTE_DIR:-/opt/whale-girl-monorepo}}"
DOMAIN="${ARGS[2]:-${WHALE_DOMAIN:-}}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST=""
USER_NAME="${WHALE_SSH_USER:-${USER:-}}"
if [ -n "$HOST_ARG" ]; then
  case "$HOST_ARG" in
    *@*) USER_NAME="${HOST_ARG%%@*}"; HOST="${HOST_ARG#*@}" ;;
    *) HOST="$HOST_ARG" ;;
  esac
fi
[ -n "$HOST" ] || die "missing host: pass user@host or set WHALE_SSH_HOST"
[ -n "$USER_NAME" ] || USER_NAME="ubuntu"

command -v rsync >/dev/null 2>&1 || die "rsync not found"
command -v ssh >/dev/null 2>&1 || die "ssh not found"

RSYNC_ARGS=(-az
  --exclude node_modules --exclude .venv --exclude .git
  --exclude audio --exclude logs --exclude run
  "$REPO_ROOT/" "$USER_NAME@$HOST:$REMOTE_DIR/")
REMOTE_CMD="cd '$REMOTE_DIR/whale-girl-server' && sudo bash scripts/install-ubuntu.sh $DOMAIN"

if [ "$DRY" -eq 1 ]; then
  say "would run: rsync ${RSYNC_ARGS[*]}"
  say "would run: ssh -t $USER_NAME@$HOST \"$REMOTE_CMD\""
  exit 0
fi

say "syncing $REPO_ROOT -> $USER_NAME@$HOST:$REMOTE_DIR"
rsync "${RSYNC_ARGS[@]}"
say "installing on the server (sudo may ask for a password)"
ssh -t "$USER_NAME@$HOST" "$REMOTE_CMD"
say "done — open the page URL printed above"
