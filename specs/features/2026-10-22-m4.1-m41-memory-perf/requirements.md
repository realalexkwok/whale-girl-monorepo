# M4.1 — Memory/Asset Optimization — Requirements

> Confirmed by the owner (2026-10-22, grouped ask round 1a/2a/3a — all three
> "Recommended" options). Grouped per the SDD ask-round convention.
> Status: PLANNING COMPLETE — implementation intentionally paused so the owner can
> switch the session AI model to V4-Flash; code work starts only on the owner's
> go-ahead (see plan.md stop point).

## Scope
- The hard gate: the OBS browser source's steady-state EXTRA memory < 180 MB on
  the Mac — **amended by the owner on 2026-10-22** after the baseline (the original
  2026-10-20 figure was < 100 MB; the measured baseline is 163.5 MB steady, full
  phase 191.0 MB, and the page renderer alone is ~94 MB), re-measured after every
  change.
- Measurement protocol (the core design): ps-based — the sum of the RSS (KB) of all
  OBS 32.2.2 "OBS Helper" CEF processes (Renderer/GPU/Plugin), Phase A = browser
  source present, Phase B = absent ("Shutdown source when not visible" checked or
  the source removed), sampled every 10 s over 2 × 30-min soak phases (first 2 min
  warm-up, excluded). Scripted say/motion/expression/pose/mode traffic every ~30 s
  in Phase A (driver in live mode). PASS1: steady-state delta (last 10 min of each
  phase; the page's first-load decay spans > 10 min) < 180 MB — the full-phase
  delta is reported as well. PASS2 stability: linear-fit slope ≤ +0.1 MB/min AND
  (last-10-min mean − first-10-min post-warm-up mean) ≤ 5 MB (growth only; a
  shrinking phase is fine).
- Lever audit, one at a time, measure-then-apply: renderer resolution cap
  (min(DPR, 2) → try 1.5 / 1), antialias true → try false, ticker maxFPS 30, Live2D
  cache audit, audio single-utterance retention, timers/DOM reuse. A lever is
  applied ONLY if it measurably reduces RSS without degrading visuals/fps, and only
  after an owner visual OK.
- Hardening: WS reconnect (single-timer invariant, clear pending timer on open,
  visibilitychange hidden→visible retry, capped backoff + jitter), scene sizing
  (fitModel re-runs on OBS source resize; ResizeObserver fallback only if CEF proves
  unreliable), audio pill reuse/cleanup.
- CPU/GPU profile: a Chrome CDP probe (ticker fps, frame-time p95, JS heap over
  60 s) plus the server/driver RSS re-sampling the M2.2 note owes (multi-sample
  post-traffic distribution, min/mean/max).
- All existing gates stay green; server ≤ 60 MB / driver ≤ 30 MB steady-state
  budgets unchanged; no new dependencies.

## Decisions
- Measurement = the CEF RSS delta via ps (owner 1a) — GPU memory is not in RSS; the
  gate is the RSS delta by definition (tech-stack.md wording). The gate is read in
  steady state and its threshold was amended to < 180 MB on 2026-10-22 (owner
  decision after the baseline; tech-stack.md carries the amendment).
- Soak 2 × 30 min; sampling 10 s; the gate reads the last 10 min of each phase
  (the page's first-load transient spans > 10 min — the full-phase delta is reported
  too); traffic every 30 s (owner 1a).
- Hard gate < 180 MB steady state (amended by the owner on 2026-10-22; the original
  2026-10-20 line was < 100 MB), stability = slope ≤ +0.1 MB/min growth AND ≤ 5 MB
  drift (owner 1a/3a).
- Levers applied only where measurement shows benefit + owner visual OK; the CDP
  heap-snapshot diff is diagnosis-on-failure only, NOT a required gate (owner 1a/3a).
  Measured outcome: antialias off +3 MB and resolution 1 +8 MB were within noise — no
  page-level lever reduced the cost (Chromium renderer/GPU baseline dominates), which
  is what drove the 2026-10-22 gate amendment.
- The M2.2 Node-version/flag question is reopened ONLY if the OBS gate or a budget
  fails → tech-stack.md owner amendment (owner 1a).
- Task groups TG1–TG5 (owner 2a); branch feature/whale-girl-m41-memory-perf off main.
- The owner switches the session model to V4-Flash after planning; implementation
  waits for the owner's go-ahead (owner instruction 2026-10-22).

## Context
- OBS 32.2.2 installed at /Applications/OBS.app (verified 2026-10-22; the CEF helper
  process naming is confirmed at the first live ps run before the baseline); Chrome
  155.0.8059.85 available for CDP.
- Current frontend surface (index.html): resolution min(DPR, 2), antialias on,
  autoDensity, backgroundAlpha 0, powerPreference high-performance, resizeTo window,
  motionPreload NONE, fitModel bottom-center ~90% height, capped reconnect backoff +
  jitter (1 s → 10 s), one decoded utterance at a time (only src.buffer holds the
  AudioBuffer; lastSay keeps numbers + a small amp array), pill reuse + gesture
  arming.
- Handoffs honoured (re-read at this planning round): M1 — gate, scene sizing,
  reconnect hardening, CPU/GPU profiling; M2.1 — re-measure with the real model
  (2.1 MB moc3 + ~1.9 MB textures); M2.2 — audio playback active, OBS audio-policy
  hardening, server RSS headroom (29–63 MB noisy across runs) + the Node-flag
  decision; M3.1 — audio + live commands + headroom; M3.2 — audio + commands +
  expressions + headroom.
- Budgets: server ≤ 60 MB / driver ≤ 30 MB RSS steady state (boot transient not
  gated); no per-frame allocations or logging anywhere.

## Validation criteria (from the ask round)
- mem_probe final PASS: gate + stability numbers recorded; per-lever table with
  values + commit ids in validation.md.
- perf_probe PASS: mean fps ≥ 25, frame-time p95 ≤ 40 ms, no heap growth.
- All existing probes green: cmd_probe 61/61, expr_probe 22/22, say_probe 12/12,
  ws_probe 20–40 fps increasing f, ws_role_probe close 1008, curl 200, node --check
  on the inline script, server/driver RSS budgets, ports released.
- Manual (owner, at the close): a real OBS 32.2.2 session on this Mac — smoothness,
  OBS stats fps, Activity Monitor reading, scene resize, kill/restart reconnect,
  audio + commands + expressions active, pill behavior.
