#!/usr/bin/env bash
# whale-girl-server/scripts/stack.sh — start/stop/status for the local stack.
#
# Why this exists: the whale has TWO programs. The server (node server.js) only
# relays frames; the BRAIN (control_whale.py — historically called the "driver")
# computes the face 30 times per second and, in mock mode, rehearses canned lines.
# If the brain is not running, the page freezes and every command is refused with
# "the server has no brain connected". This script starts both, keeps them alive
# (auto-restart after a crash), and makes their state visible.
#
# Usage:
#   scripts/stack.sh start        # start server + brain, wait until both respond
#   scripts/stack.sh stop         # stop both (and the supervisor)
#   scripts/stack.sh status       # pids, ports, brain presence, last log lines
#   scripts/stack.sh logs         # tail -f the stack log
#
# Env: PORT (default 3000), WS_PORT (default 3001), WHALE_MODE (default live —
# silent: idle motion only; WHALE_MODE=mock brings back the canned rehearsal lines).
# Exit codes: 0 ok, 1 already running / not running, 2 failed to start.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$SERVER_DIR/run"
PID_FILE="$RUN_DIR/stack.pid"
SERVER_PID_FILE="$RUN_DIR/server.pid"
DRIVER_PID_FILE="$RUN_DIR/driver.pid"
LOG_FILE="$RUN_DIR/stack.log"
PORT="${PORT:-3000}"
WS_PORT="${WS_PORT:-3001}"
WS_URL="${WHALE_WS:-ws://localhost:$WS_PORT?role=python}"
CMD_URL="${WHALE_CMD_WS:-ws://localhost:$WS_PORT?role=web}"
export PORT WS_PORT WHALE_WS="$WS_URL" WHALE_CMD_WS="$CMD_URL"
STATE="${WHALE_MODE:-live}"   # silent by default; WHALE_MODE=mock re-enables the rehearsal
# Export it: the supervisor re-launches itself, and control_whale.py defaults to
# MOCK when WHALE_MODE is absent — without this the "silent by default" promise
# is false and the whale starts rehearsing canned lines.
export WHALE_MODE="$STATE"

mkdir -p "$RUN_DIR"
PORTS_FILE="$RUN_DIR/ports"

# A RUNNING stack's ports are authoritative for status/stop (it may have been
# started with PORT/WS_PORT overrides); start/supervise keep the caller's env.
if [ -f "$PORTS_FILE" ] && [ "${1:-}" != "start" ] && [ "${1:-}" != "supervise" ]; then
  read -r PORT WS_PORT < "$PORTS_FILE" || true
  WS_URL="ws://localhost:$WS_PORT?role=python"
  CMD_URL="ws://localhost:$WS_PORT?role=web"
  export PORT WS_PORT WHALE_WS="$WS_URL" WHALE_CMD_WS="$CMD_URL"
fi

port_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

supervisor_alive() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

pid_of() { [ -f "$1" ] && cat "$1" 2>/dev/null || true; }

driver_pid() {
  local p cand
  p="$(pid_of "$DRIVER_PID_FILE")"
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null && echo "$p" && return
  # pgrep -f also matches shell/wrapper cmdlines that merely mention the script:
  # pick the process whose executable is actually Python.
  for cand in $(pgrep -f "control_whale.py" 2>/dev/null); do
    case "$(ps -p "$cand" -o comm= 2>/dev/null)" in
      *Python*) echo "$cand"; return ;;
    esac
  done
}

run_server() {
  cd "$SERVER_DIR" || exit 1
  while :; do
    node server.js &
    echo $! > "$SERVER_PID_FILE"
    wait $!
    echo "[stack] server exited ($?) — restarting in 2 s"
    sleep 2
  done
}

run_driver() {
  cd "$SERVER_DIR" || exit 1
  while :; do
    ./.venv/bin/python control_whale.py &
    echo $! > "$DRIVER_PID_FILE"
    wait $!
    echo "[stack] driver exited ($?) — restarting in 3 s"
    sleep 3
  done
}

supervise() {
  run_server & S_LOOP=$!
  run_driver & D_LOOP=$!
  trap 'kill "$S_LOOP" "$D_LOOP" 2>/dev/null; kill "$(pid_of "$SERVER_PID_FILE")" "$(pid_of "$DRIVER_PID_FILE")" 2>/dev/null; exit 0' TERM INT
  echo "[stack] supervising server :$PORT + driver (mode $STATE)"
  wait
}

case "${1:-}" in
  start)
    if supervisor_alive; then
      echo "stack.sh: already running (supervisor pid $(cat "$PID_FILE")) — use status/stop" >&2
      exit 1
    fi
    if port_busy "$PORT" || port_busy "$WS_PORT"; then
      echo "stack.sh: port $PORT or $WS_PORT is already in use — stop the other process first" >&2
      echo "  (hint: lsof -nP -iTCP:$PORT -iTCP:$WS_PORT -sTCP:LISTEN)" >&2
      exit 1
    fi
    [ -x "$SERVER_DIR/.venv/bin/python" ] || {
      echo "stack.sh: $SERVER_DIR/.venv/bin/python missing — provision the venv (see specs/dev-environment.md)" >&2
      exit 2
    }
    : > "$LOG_FILE"
    nohup bash "$0" supervise >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    printf '%s %s\n' "$PORT" "$WS_PORT" > "$PORTS_FILE"
    echo "stack.sh: starting server :$PORT + driver (mode $STATE); log $LOG_FILE"
    for _ in $(seq 1 40); do
      curl -s -o /dev/null "http://localhost:$PORT/" && break
      sleep 0.5
    done
    curl -s -o /dev/null "http://localhost:$PORT/" || { echo "stack.sh: server did not answer on :$PORT" >&2; exit 2; }
    for _ in $(seq 1 20); do
      [ -n "$(driver_pid)" ] && break
      sleep 0.5
    done
    DP="$(driver_pid)"
    if [ -n "$DP" ]; then
      echo "stack.sh: UP — server :$PORT, brain pid $DP. Page: http://localhost:$PORT/?debug=1"
      exit 0
    fi
    echo "stack.sh: server is up but the driver did not appear — check $LOG_FILE" >&2
    exit 2
    ;;
  stop)
    if ! supervisor_alive; then
      echo "stack.sh: no supervisor running (pid file missing/stale)" >&2
      if port_busy "$PORT" || port_busy "$WS_PORT"; then
        echo "  ports still in use — those processes were started elsewhere (Ctrl+C their terminals)" >&2
      fi
      rm -f "$PID_FILE" "$PORTS_FILE"
      exit 1
    fi
    pid="$(cat "$PID_FILE")"
    kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -KILL "$pid" 2>/dev/null
    rm -f "$PID_FILE" "$PORTS_FILE" "$SERVER_PID_FILE" "$DRIVER_PID_FILE"
    for _ in $(seq 1 20); do
      port_busy "$PORT" || port_busy "$WS_PORT" || break
      sleep 0.5
    done
    if port_busy "$PORT" || port_busy "$WS_PORT"; then
      echo "stack.sh: stopped the supervisor but ports are still busy — inspect with lsof" >&2
      exit 1
    fi
    echo "stack.sh: DOWN — ports $PORT/$WS_PORT free"
    exit 0
    ;;
  status)
    if supervisor_alive; then echo "stack.sh: supervisor pid $(cat "$PID_FILE")"; else echo "stack.sh: supervisor not running"; fi
    echo "  server :$PORT  $(port_busy "$PORT" && echo LISTENING || echo closed)"
    echo "  ws     :$WS_PORT $(port_busy "$WS_PORT" && echo LISTENING || echo closed)"
    DP="$(driver_pid)"
    if [ -n "$DP" ]; then
      RSS="$(ps -p "$DP" -o rss= 2>/dev/null | awk '{printf "%.1f MB", $1/1024}')"
      echo "  brain         pid $DP (control_whale.py, ${RSS:-RSS n/a})"
    else
      echo "  brain         NOT RUNNING (control_whale.py) — commands will be refused; run: scripts/stack.sh start"
    fi
    if [ -f "$LOG_FILE" ]; then echo "  last log:"; tail -6 "$LOG_FILE" | sed 's/^/    /'; fi
    exit 0
    ;;
  logs)
    [ -f "$LOG_FILE" ] || { echo "stack.sh: no log yet ($LOG_FILE)" >&2; exit 1; }
    tail -f "$LOG_FILE"
    ;;
  supervise)
    supervise
    ;;
  *)
    awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
    exit 2
    ;;
esac
