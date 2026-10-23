#!/usr/bin/env bash
# Whale Girl — optional SSH port-forwarding tunnel (M4.2 pattern 3).
#
# Usage:
#   bash scripts/ubuntu-tunnel.sh [--dry-run] [user@]host
#   WHALE_SSH_HOST=1.2.3.4 WHALE_SSH_USER=ubuntu bash scripts/ubuntu-tunnel.sh
#
# What it does: opens
#   ssh -N -L 3000:localhost:3000 -L 3001:localhost:3001 user@host
# The browser (and OBS) keep pointing at http://localhost:3000 unchanged; the
# page and the WS proxy come from the server box through the tunnel, so the
# origin guard sees localhost on both sides. Leave it running; Ctrl-C closes it.
set -euo pipefail

say()  { printf '[ubuntu-tunnel] %s\n' "$*"; }
die()  { printf '[ubuntu-tunnel] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  printf '%s\n' \
    'Usage: bash scripts/ubuntu-tunnel.sh [--dry-run] [user@]host' \
    '' \
    'Env: WHALE_SSH_HOST (host), WHALE_SSH_USER (user). Local ports 3000/3001' \
    '     must be free; the browser keeps using http://localhost:3000.'
}

DRY=0
HOST_ARG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $arg (try --help)" ;;
    *) HOST_ARG="$arg" ;;
  esac
done

HOST="${WHALE_SSH_HOST:-}"
USER_NAME="${WHALE_SSH_USER:-${USER:-}}"
if [ -n "$HOST_ARG" ]; then
  case "$HOST_ARG" in
    *@*) USER_NAME="${HOST_ARG%%@*}"; HOST="${HOST_ARG#*@}" ;;
    *) HOST="$HOST_ARG" ;;
  esac
fi
[ -n "$HOST" ] || die "missing host: pass user@host or set WHALE_SSH_HOST"
[ -n "$USER_NAME" ] || USER_NAME="ubuntu"

command -v ssh >/dev/null 2>&1 || die "ssh not found (install an SSH client, or use pattern 1/2 instead)"

if [ "$DRY" -eq 0 ]; then
  busy=""
  for p in 3000 3001; do
    if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      busy="$busy $p"
    fi
  done
  [ -z "$busy" ] || die "local port(s)$busy already in use — stop the local stack first (bash scripts/stack.sh stop)"
fi

SSH_ARGS=(-N -o ServerAliveInterval=30 -o ServerAliveCountMax=3
          -L 3000:localhost:3000 -L 3001:localhost:3001
          "$USER_NAME@$HOST")

if [ "$DRY" -eq 1 ]; then
  say "would run: ssh ${SSH_ARGS[*]}"
  exit 0
fi

say "opening the tunnel to $USER_NAME@$HOST (leave it running; Ctrl-C stops it)"
say "browser/OBS: http://localhost:3000  (no ?ws= needed — both ports come through the tunnel)"
exec ssh "${SSH_ARGS[@]}"
