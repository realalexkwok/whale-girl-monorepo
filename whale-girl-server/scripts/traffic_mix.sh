#!/usr/bin/env bash
# whale-girl-server/scripts/traffic_mix.sh — M4.1 TG1 scripted soak traffic
#
# Cycles say / motion / express (tags + neutral) / pose through scripts/whale_cmd.py
# every --interval seconds, and flips the driver mode once mid-phase (live → mock →
# live) so the memory soak exercises the real M3 surface. Every command is logged
# with its exit code; a failure is logged and the mix keeps going (the soak must
# survive a transient TTS error).
#
# Usage:
#   scripts/traffic_mix.sh [--minutes 30] [--interval 30] [--verbose]
#   WHALE_TTS_TEXT="..." scripts/traffic_mix.sh      # override the say line
# Options: --minutes N (default 30), --interval S (default 30), --verbose (log
# every ok).
# Exit codes: 0 completed, 1 bad argument or missing venv/CLI, 2 driver not
# connected (no brain — commands would be refused).
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PY="$SERVER_DIR/.venv/bin/python"
CLI="$SERVER_DIR/scripts/whale_cmd.py"
MINUTES=30
INTERVAL=30
VERBOSE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --minutes) MINUTES="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --verbose) VERBOSE=1; shift ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    *) echo "traffic_mix: unknown argument: $1" >&2; exit 1 ;;
  esac
done
if ! awk -v m="$MINUTES" 'BEGIN { exit !(m > 0) }'; then echo "traffic_mix: --minutes must be > 0" >&2; exit 1; fi
if ! [ "$INTERVAL" -gt 0 ] 2>/dev/null; then echo "traffic_mix: --interval must be > 0" >&2; exit 1; fi
[ -x "$PY" ] || { echo "traffic_mix: $PY missing — provision the venv (see dev-environment.md)" >&2; exit 1; }
[ -f "$CLI" ] || { echo "traffic_mix: $CLI missing" >&2; exit 1; }

# Preflight: without the driver (control_whale.py) every command is refused by
# design ("the server has no brain connected"). Fail once, clearly, instead of
# logging a refusal per tick; a driver that is still connecting gets ~8 s.
PREFLIGHT_OUT=""
for _ in 1 2 3 4; do
  PREFLIGHT_OUT="$("$PY" "$CLI" pose '{}' 2>&1)" && break
  sleep 2
done
if ! "$PY" "$CLI" pose '{}' >/dev/null 2>&1; then
  echo "traffic_mix: preflight failed — ${PREFLIGHT_OUT}" >&2
  echo "  the whale needs the driver (control_whale.py) running next to the server:" >&2
  echo "    bash scripts/stack.sh start          # starts BOTH and keeps them alive" >&2
  echo "    (or terminal 2: cd whale-girl-server && .venv/bin/python control_whale.py)" >&2
  exit 2
fi

SAY_TEXT="${WHALE_TTS_TEXT:-大家好，我是鲸鱼娘，今天的测试开始了}"
MOTIONS=(Hammer Idle BubbleGum SprayWater OpenCase Selfie)
TAGS=(happy sad angry surprised confused love)
TOTAL=$(awk -v m="$MINUTES" 'BEGIN { printf "%d", m * 60 + 0.5 }')
SENT=0
OK=0
FAIL1=0
FAIL2=0
FAILOTHER=0
STREAK1=0
WARNED=0
I=0
MODE_STATE=""
FLIPPED=0
START=$(date +%s)

run_cmd() {
  local desc="$1"; shift
  local out code
  out="$("$PY" "$CLI" "$@" 2>&1)"
  code=$?
  SENT=$((SENT + 1))
  if [ "$code" = 0 ]; then
    OK=$((OK + 1))
    STREAK1=0
    [ "$VERBOSE" = 1 ] && printf '[traffic] t=%3ds %-28s ok\n' "$EL" "$desc"
  else
    case "$code" in
      1) FAIL1=$((FAIL1 + 1)); STREAK1=$((STREAK1 + 1)) ;;
      2) FAIL2=$((FAIL2 + 1)); STREAK1=0 ;;
      *) FAILOTHER=$((FAILOTHER + 1)); STREAK1=0 ;;
    esac
    printf '[traffic] t=%3ds %-28s exit=%d %s\n' "$EL" "$desc" "$code" "$(printf '%s' "$out" | tail -n 1)"
    if [ "$STREAK1" -ge 3 ] && [ "$WARNED" = 0 ]; then
      WARNED=1
      echo "[traffic] warning: 3 consecutive exit=1 (no driver / server down?) — is 'npm start' + control_whale.py running?"
    fi
  fi
}

echo "traffic_mix: ${MINUTES} min, every ${INTERVAL}s → say / motion / express / pose (+ one mode flip)"
echo "traffic_mix: CLI $CLI"

EL=0
while :; do
  NOW=$(date +%s)
  EL=$((NOW - START))
  [ "$EL" -ge "$TOTAL" ] && break

  if [ -z "$MODE_STATE" ]; then
    run_cmd "mode live" mode live
    MODE_STATE="live"
  fi
  if [ "$MODE_STATE" = "live" ] && [ "$FLIPPED" = 0 ] && [ "$EL" -ge $((TOTAL / 2)) ]; then
    run_cmd "mode mock (mid-phase flip)" mode mock
    MODE_STATE="mock"
    FLIPPED=1
  fi
  if [ "$MODE_STATE" = "mock" ] && [ "$EL" -ge $((TOTAL / 2 + 2 * INTERVAL)) ]; then
    run_cmd "mode live (restore)" mode live
    MODE_STATE="live"
  fi

  case $((I % 5)) in
    0) run_cmd "say" say "$SAY_TEXT" ;;
    1) G="${MOTIONS[$(( (I / 5) % ${#MOTIONS[@]} ))]}"
       run_cmd "motion $G" motion "$G" ;;
    2) if [ $((I % 35)) -eq 2 ]; then
         run_cmd "express neutral" express neutral
       else
         T="${TAGS[$(( (I / 5) % ${#TAGS[@]} ))]}"
         run_cmd "express $T" express "$T" "测试情绪"
       fi ;;
    3) run_cmd "pose eyes" pose '{"ParamEyeLOpen":0.35,"ParamEyeROpen":0.35}' ;;
    4) run_cmd "pose clear" pose '{}' ;;
  esac
  I=$((I + 1))

  NEXT=$((START + EL + INTERVAL))
  SLEEP=$((NEXT - $(date +%s)))
  [ "$SLEEP" -gt 0 ] && sleep "$SLEEP"
done

run_cmd "mode live (final restore)" mode live
echo ""
echo "traffic_mix: done — sent ${SENT}, ok ${OK}, no-driver(1) ${FAIL1}, validation(2) ${FAIL2}, other ${FAILOTHER}"
exit 0
