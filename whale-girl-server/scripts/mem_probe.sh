#!/usr/bin/env bash
# whale-girl-server/scripts/mem_probe.sh — M4.1 TG1 memory gate sampler
#
# Measures the OBS browser source's EXTRA memory as the RSS delta of OBS's CEF
# helper processes ("OBS Helper …") between two soak phases:
#
#   phase a — the whale Browser source is VISIBLE (traffic running)
#   phase b — the source is HIDDEN or REMOVED ("Shutdown source when not visible"
#             checked, or the source deleted from the scene)
#
# Each phase samples ps every --interval seconds and writes a CSV under
# whale-girl-server/logs/ (gitignored). --compare scores the configured gate
# (default < 180 MB — tech-stack amendment 2026-10-22) and the
# stability rule (slope ≤ +0.1 MB/min over the phase, ≤ 5 MB first/last-window
# drift), so a leaking page fails even when its absolute RSS is small.
#
# Usage:
#   scripts/mem_probe.sh --list                                   # what ps matches
#   scripts/mem_probe.sh --phase a --minutes 30 --label baseline   # soak Phase A
#   scripts/mem_probe.sh --phase b --minutes 30 --label baseline   # soak Phase B
#   scripts/mem_probe.sh --compare logs/a.csv logs/b.csv           # gate + stability
#   scripts/mem_probe.sh --compare a.csv b.csv --no-gate           # lever A/B window
#
# Options:
#   --phase a|b     sampling phase (default a)
#   --minutes N     phase length in minutes (default 30)
#   --interval S    sampling interval in seconds (default 10)
#   --warmup S      excluded warm-up seconds per phase (default 120)
#   --drift S       stability window at each end in seconds (default 600)
#   --label NAME    CSV filename tag (default phase name)
#   --out DIR       output directory (default <server>/logs)
#   --caffeinate    keep the Mac awake for the phase (caffeinate -i)
#   --gate MB       gate threshold (default 180 — tech-stack amendment 2026-10-22)
#   --target MB     internal target, reported only (default 160)
# Exit codes:
#   0 PASS/completed, 1 argument or data error, 2 OBS not running (Phase A),
#   3 Phase B invalid (an OBS renderer stayed alive), 4 gate/stability FAIL.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$SERVER_DIR/logs"
PHASE="a"
MINUTES=30
INTERVAL=10
WARMUP=120
DRIFT=600
LABEL=""
GATE_MB=180
TARGET_MB=160
CAFFEINATE=0
MODE=""
COMPARE_A=""
COMPARE_B=""
NO_GATE=0
STEADY=0
LIST_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --phase) PHASE="$2"; shift 2 ;;
    --minutes) MINUTES="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --warmup) WARMUP="$2"; shift 2 ;;
    --drift) DRIFT="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --gate) GATE_MB="$2"; shift 2 ;;
    --target) TARGET_MB="$2"; shift 2 ;;
    --caffeinate) CAFFEINATE=1; shift ;;
    --compare) MODE="compare"; COMPARE_A="$2"; COMPARE_B="$3"; shift 3 ;;
    --no-gate) NO_GATE=1; shift ;;
    --steady) STEADY=1; shift ;;
    --list) LIST_ONLY=1; shift ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    *) echo "mem_probe: unknown argument: $1" >&2; exit 1 ;;
  esac
done

case "$PHASE" in a|b) ;; *) echo "mem_probe: --phase must be a or b" >&2; exit 1 ;; esac
if ! awk -v m="$MINUTES" 'BEGIN { exit !(m > 0) }'; then echo "mem_probe: --minutes must be > 0" >&2; exit 1; fi
if ! [ "$INTERVAL" -gt 0 ] 2>/dev/null; then echo "mem_probe: --interval must be > 0" >&2; exit 1; fi
TOTAL_SEC=$(awk -v m="$MINUTES" 'BEGIN { printf "%d", m * 60 + 0.5 }')
[ -n "$LABEL" ] || LABEL="phase-$PHASE"
[ -n "$MODE" ] || MODE="sample"

# One ps pass → "n renderer gpu plugin rss_kb detail"
sample_once() {
  ps -axo pid=,rss=,comm= | awk '
    BEGIN { IGNORECASE = 1 }
    /OBS Helper/ {
      name = $3
      for (i = 4; i <= NF; i++) name = name " " $i
      n++
      sum += $2 + 0
      detail = detail (detail == "" ? "" : ";") $1 ":" $2 ":" name
      if (name ~ /Renderer/) rend++
      else if (name ~ /GPU/) gpu++
      else if (name ~ /Plugin/) plug++
    }
    END { printf "%d %d %d %d %d %s\n", n, rend, gpu, plug, sum, detail }
  '
}

if [ "$LIST_ONLY" = 1 ]; then
  read -r N REND GPU PLUG SUM DETAIL <<< "$(sample_once)"
  echo "mem_probe: matching 'OBS Helper' processes: $N (renderer $REND, gpu $GPU, plugin $PLUG)"
  echo "mem_probe: total RSS ${SUM} KB"
  [ -n "$DETAIL" ] && echo "$DETAIL" | tr ';' '\n' | sed 's/^/  /'
  [ "$N" = 0 ] && echo "mem_probe: OBS is not running (or no browser source is alive)."
  exit 0
fi

# Stats over one CSV: "n mean_kb min_kb max_kb slope_mb_per_min drift_mb first_n last_n"
compute_stats() {
  local csv="$1" warm="$2" drift="$3"
  awk -F, -v warm="$warm" -v drift="$drift" '
    NR > 1 {
      e = $2 + 0; r = $7 + 0;
      el = e;
      if (e >= warm) {
        n++; t[n] = e; v[n] = r; s += r;
        if (n == 1 || r < mn) mn = r;
        if (n == 1 || r > mx) mx = r;
      }
    }
    END {
      if (n < 2) { print "0 0 0 0 0 0 0 0"; exit }
      mean = s / n;
      st = 0; sv = 0; stt = 0; stv = 0;
      for (i = 1; i <= n; i++) { st += t[i]; sv += v[i]; stt += t[i] * t[i]; stv += t[i] * v[i]; }
      den = n * stt - st * st;
      slope = (den == 0) ? 0 : (n * stv - st * sv) / den;
      slope_mb_min = slope * 60 / 1024;
      fw = 0; fs = 0; lw = 0; ls = 0;
      for (i = 1; i <= n; i++) {
        if (t[i] < warm + drift) { fw++; fs += v[i]; }
        if (t[i] >= el - drift) { lw++; ls += v[i]; }
      }
      drift_mb = (fw > 0 && lw > 0) ? ((ls / lw) - (fs / fw)) / 1024 : 0;
      printf "%d %.0f %.0f %.0f %.3f %.2f %d %d\n", n, mean, mn, mx, slope_mb_min, drift_mb, fw, lw;
    }
  ' "$csv"
}

fm_mb() { awk -v kb="$1" 'BEGIN { printf "%.1f", kb / 1024 }'; }

# Mean RSS over the last $2 seconds of a CSV: "mean_kb n"
settled_mean() {
  local csv="$1" drift="$2"
  awk -F, -v drift="$drift" '
    NR > 1 { e = $2 + 0; r = $7 + 0; last = e; E[NR] = e; R[NR] = r }
    END {
      for (i = 2; i <= NR; i++) if (E[i] >= last - drift) { n++; s += R[i] }
      if (n > 0) printf "%.0f %d\n", s / n, n
    }
  ' "$csv"
}

run_compare() {
  local a="$1" b="$2"
  if [ ! -f "$a" ] || [ ! -f "$b" ]; then
    echo "mem_probe: CSV missing ($a or $b)" >&2; exit 1
  fi
  read -r NA MEAN_A MIN_A MAX_A SLOPE_A DRIFT_A FW_A LW_A <<< "$(compute_stats "$a" "$WARMUP" "$DRIFT")"
  read -r NB MEAN_B MIN_B MAX_B SLOPE_B DRIFT_B FW_B LW_B <<< "$(compute_stats "$b" "$WARMUP" "$DRIFT")"
  if [ "$NA" = 0 ] || [ "$NB" = 0 ]; then
    echo "mem_probe: not enough samples after warm-up (A=$NA B=$NB)" >&2; exit 1
  fi
  local mean_a_mb mean_b_mb delta_mb mean_a_kb mean_b_kb
  mean_a_kb="$MEAN_A"
  mean_b_kb="$MEAN_B"
  if [ "$STEADY" = 1 ]; then
    # Steady state = the last --drift seconds of each phase: the page's first-load
    # transient spans > 10 min, and tech-stack.md gates steady state, not boot.
    read -r mean_a_kb NA <<< "$(settled_mean "$a" "$DRIFT")"
    read -r mean_b_kb NB <<< "$(settled_mean "$b" "$DRIFT")"
    if [ -z "$mean_a_kb" ] || [ -z "$mean_b_kb" ]; then
      echo "mem_probe: no settled samples in the last ${DRIFT}s of a phase" >&2; exit 1
    fi
  fi
  mean_a_mb="$(fm_mb "$mean_a_kb")"
  mean_b_mb="$(fm_mb "$mean_b_kb")"
  delta_mb="$(awk -v a="$mean_a_kb" -v b="$mean_b_kb" 'BEGIN { printf "%.1f", (a - b) / 1024 }')"
  echo ""
  echo "  phase A ($a)"
  echo "    samples $NA  mean ${mean_a_mb} MB  full-window min $(fm_mb "$MIN_A")  max $(fm_mb "$MAX_A") MB"
  echo "  phase B ($b)"
  echo "    samples $NB  mean ${mean_b_mb} MB  full-window min $(fm_mb "$MIN_B")  max $(fm_mb "$MAX_B") MB"
  echo ""
  local scope_tag=""
  [ "$STEADY" = 1 ] && scope_tag=" [steady: last ${DRIFT}s of each phase]"
  if [ "$NO_GATE" = 1 ]; then
    echo "  delta (A - B): ${delta_mb} MB   [--no-gate: lever A/B comparison]${scope_tag}"
  else
    echo "  delta (A - B): ${delta_mb} MB   gate < ${GATE_MB} MB (target ≤ ${TARGET_MB} MB)${scope_tag}"
  fi
  echo "  stability A: slope ${SLOPE_A} MB/min (limit ≤ 0.1), drift ${DRIFT_A} MB (limit ≤ 5; windows ${DRIFT}s, samples ${FW_A}/${LW_A})"
  echo "  stability B: slope ${SLOPE_B} MB/min (limit ≤ 0.1), drift ${DRIFT_B} MB (limit ≤ 5; windows ${DRIFT}s, samples ${FW_B}/${LW_B})"
  local gate_ok=1 stab_ok=1
  if [ "$NO_GATE" = 0 ]; then
    awk -v d="$delta_mb" -v g="$GATE_MB" 'BEGIN { exit !(d < g) }' || gate_ok=0
  fi
  awk -v s="$SLOPE_A" 'BEGIN { exit !(s <= 0.1) }' || stab_ok=0
  awk -v d="$DRIFT_A" 'BEGIN { exit !(d <= 5) }' || stab_ok=0
  # Phase B must be stable too: a growing baseline would shrink the delta and let
  # a leaking page pass the gate on the subtraction alone.
  awk -v s="$SLOPE_B" 'BEGIN { exit !(s <= 0.1) }' || stab_ok=0
  awk -v d="$DRIFT_B" 'BEGIN { exit !(d <= 5) }' || stab_ok=0
  if [ "$gate_ok" = 1 ] && [ "$stab_ok" = 1 ]; then
    echo "  RESULT: PASS"
    [ "$NO_GATE" = 0 ] && awk -v d="$delta_mb" -v t="$TARGET_MB" 'BEGIN { exit !(d <= t) }' \
      && echo "  note: within the internal target (≤ ${TARGET_MB} MB)"
    exit 0
  fi
  [ "$gate_ok" = 0 ] && echo "  FAIL: gate — delta ${delta_mb} MB is not < ${GATE_MB} MB"
  [ "$stab_ok" = 0 ] && echo "  FAIL: stability — slope/drift above the limits (a leak, not just size)"
  echo "  RESULT: FAIL"
  exit 4
}

if [ "$MODE" = "compare" ]; then
  run_compare "$COMPARE_A" "$COMPARE_B"
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
CSV="$OUT_DIR/mem-${STAMP}-${LABEL}.csv"
printf 'epoch,elapsed,n,renderer,gpu,plugin,rss_kb,detail\n' > "$CSV"

CAFF_PID=""
cleanup() {
  [ -n "$CAFF_PID" ] && kill "$CAFF_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT INT TERM

if [ "$CAFFEINATE" = 1 ]; then
  caffeinate -i -w $$ >/dev/null 2>&1 &
  CAFF_PID=$!
fi

if [ "$PHASE" = "a" ]; then
  echo "mem_probe: Phase A — keep the whale Browser source VISIBLE in OBS"
  echo "  source: http://localhost:3000 (1920x1080, transparent); traffic should be running"
  echo "  sampling every ${INTERVAL}s for ${MINUTES} min → $CSV"
else
  echo "mem_probe: Phase B — HIDE (or delete) the whale Browser source in OBS"
  echo "  enable 'Shutdown source when not visible' in the source properties (or remove it)"
  echo "  the 'OBS Helper (Renderer)' process must disappear; sampling every ${INTERVAL}s for ${MINUTES} min → $CSV"
fi

START=$(date +%s)
WARNED_B=0
SAMPLES=0
B_INVALID=0

while :; do
  NOW=$(date +%s)
  EL=$((NOW - START))
  [ "$EL" -gt "$TOTAL_SEC" ] && break
  read -r N REND GPU PLUG SUM DETAIL <<< "$(sample_once)"

  if [ "$PHASE" = "a" ] && [ "$N" = 0 ] && [ "$SAMPLES" = 0 ]; then
    echo "mem_probe: no 'OBS Helper' process found — is OBS 32.2 running with the Browser source added?" >&2
    echo "  add: OBS → Sources → + → Browser → http://localhost:3000 (1920x1080), then re-run." >&2
    rm -f "$CSV"
    exit 2
  fi
  if [ "$PHASE" = "b" ] && [ "$REND" -gt 0 ] && [ "$WARNED_B" = 0 ]; then
    WARNED_B=1
    echo "mem_probe: warning — an OBS renderer is still alive; Phase B is only valid with" >&2
    echo "  'Shutdown source when not visible' checked (or the source removed)." >&2
  fi
  [ "$PHASE" = "b" ] && [ "$REND" -gt 0 ] && [ "$EL" -gt 30 ] && B_INVALID=1

  printf '%s,%s,%s,%s,%s,%s,%s,"%s"\n' "$NOW" "$EL" "$N" "$REND" "$GPU" "$PLUG" "$SUM" "$DETAIL" >> "$CSV"
  SAMPLES=$((SAMPLES + 1))

  NEXT=$((NOW + INTERVAL))
  SLEEP=$((NEXT - $(date +%s)))
  [ "$SLEEP" -gt 0 ] && sleep "$SLEEP"
done

read -r N MEAN MN MX SLOPE DRIFTV FW LW <<< "$(compute_stats "$CSV" "$WARMUP" "$DRIFT")"
if [ "$N" = 0 ]; then
  echo "mem_probe: no samples after warm-up (${WARMUP}s) — phase too short?" >&2
  exit 1
fi
echo ""
echo "  $CSV"
echo "  samples ${N} (warm-up ${WARMUP}s excluded)  mean $(fm_mb "$MEAN") MB  min $(fm_mb "$MN")  max $(fm_mb "$MX") MB"
echo "  slope ${SLOPE} MB/min (limit ≤ 0.1)   drift ${DRIFTV} MB (limit ≤ 5; windows ${DRIFT}s, samples ${FW}/${LW})"
if [ "$PHASE" = "b" ] && [ "$B_INVALID" = 1 ]; then
  echo "  INVALID: an OBS renderer stayed alive in Phase B — hide the source with" >&2
  echo "  'Shutdown source when not visible' checked, or delete the source, then re-run." >&2
  exit 3
fi
echo "  done — collect the other phase, then: scripts/mem_probe.sh --compare <A.csv> <B.csv>"
exit 0
