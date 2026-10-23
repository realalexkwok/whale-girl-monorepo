# M4.1 — Memory/Asset Optimization — Plan

> Confirmed by the owner (2026-10-22, grouped ask round) before implementation.
> Status: IMPLEMENTED (2026-10-22) — TG1–TG5 done; the gate was amended to
> < 180 MB steady state by the owner after the baseline (the < 100 MB figure could
> not pass: Chromium's renderer/GPU baseline dominates and page-level levers were
> measured memory-neutral). The close ritual (/spec-close) is pending.

## Task groups

### TG1 — Measurement protocol + baseline
- NEW scripts/mem_probe.sh: sampler — ps -axo pid,rss,comm, match "OBS Helper",
  sum RSS, 10 s cadence, CSV + summary under whale-girl-server/logs/ (gitignored),
  phase instructions for the owner's OBS toggle, warm-up exclusion, stability math
  (slope ≤ +0.1 MB/min, ≤ 5 MB drift).
- NEW scripts/traffic_mix.sh: every ~30 s cycles say / motion / express (tags +
  neutral) / pose / one mid-phase mode flip via .venv/bin/python
  scripts/whale_cmd.py; logs exit codes (1/2 logged, not fatal).
- EDIT .gitignore: whale-girl-server/logs/.
- Baseline run: 2 × 30 min with owner OBS cooperation (add the source; toggle with
  "Shutdown source when not visible" checked at the phase boundary). Record numbers.
- Checks: sampler exits actionably when OBS is absent / no Renderer matched / a
  Renderer survives Phase B; baseline numbers recorded; no probe regressions.

### TG2 — Lever audit (measure-then-apply, one at a time)
- EDIT index.html with 5-min A/B windows per candidate: resolution cap 1.5 and 1;
  antialias off; PIXI.Ticker.shared.maxFPS = 30; Live2D plugin cache audit (expect
  no lever); audio single-utterance retention (fix lastSay.amp retention if found,
  keep window.whaleSpeech.probeStats valid); timer/DOM reuse audit.
- Apply only on measured benefit + owner visual OK; record value + commit id per
  lever; full 2 × 30-min soak only at baseline and final.
- Checks: say_probe stays 12/12 after any audio change; ws_probe fps ≥ 25 after any
  ticker/resolution change; node --check; A/B numbers recorded in validation.md.

### TG3 — Hardening + late fixes (EDIT index.html)
- WS reconnect: assert single-timer invariant; clear any pending wsTimer on open; on
  visibilitychange hidden→visible with a closed socket, retry immediately (OBS scene
  switches hide the source).
- Scene sizing: verify fitModel re-runs on OBS source resize; add a ResizeObserver
  fallback only if CEF proves unreliable; re-fit after model load.
- Audio pill: one reused element, hides on running, no accumulation; OBS Interact
  flow documented.
- Checks: kill/restart driver and server exercises; all probes green; node --check.

### TG4 — CPU/GPU profile
- NEW scripts/perf_probe.js: reuse the say_probe CDP pattern (boot server + Chrome
  :9222 + driver); the ticker sampler + heap reads are INJECTED via CDP
  (refinement at implementation 2026-10-22: no window.whalePerf hook in
  index.html — the production path stays untouched); 60 s sample of ticker FPS /
  frame delta / performance.memory.usedJSHeapSize; asserts mean fps ≥ 25,
  frame-time p95 ≤ 40 ms, no heap growth; prints the table.
- Server/driver RSS re-sampling per the M2.2 note: multi-sample over 10 min
  post-traffic, min/mean/max recorded; Node-version/flag change ONLY on gate/budget
  failure → tech-stack.md owner amendment.
- Checks: perf_probe PASS; RSS distribution recorded; budgets asserted.

### TG5 — Spec trio + docs + validation
- This trio (requirements/plan/validation); validation.md filled at the close:
  lever table, soak PASS values, stability numbers, handoff list.
- EDIT README.md + AGENTS.md (Part A status + run recipes) + specs/dev-environment.md
  (measurement protocol, mem_probe/perf_probe recipes); specs/tech-stack.md only via
  owner amendment if a decision changes (Node version/flags, resolution cap default,
  maxFPS).
- Checks: doc commands copy-paste-clean; roadmap tick + history archive at the close.

## Research/grounding notes (all verified live)
- OBS 32.2.2 installed at /Applications/OBS.app (defaults read, 2026-10-22); Chrome
  155.0.8059.85 for CDP; CEF helper process naming ("OBS Helper …") confirmed at the
  first live ps run before the baseline: 5–6 processes (2 Renderer + GPU + 2–3
  utility), ~305–320 MB summed with the page loaded.
- Measurement automation (refinement 2026-10-22): the owner's OBS scene ("场景")
  already carries the whale Browser source ("浏览器", url ?debug=1); the soak
  toggles it through the built-in obs-websocket server (localhost :4455, auth) via
  NEW scripts/obs_toggle.js, so Phase A/B needs no manual GUI toggling. The
  websocket server was enabled for the milestone (config backup kept) and is
  reverted at the close.
- Existing recipes reused: say_probe CDP boot pattern; whale_cmd.py traffic; ps RSS
  discipline from AGENTS.md.

## Files
- NEW whale-girl-server/scripts/{mem_probe.sh, traffic_mix.sh, perf_probe.js}
- EDIT whale-girl-frontend/index.html (levers + hardening + whalePerf hook)
- EDIT .gitignore (logs/), README.md, AGENTS.md, specs/dev-environment.md,
  specs/tech-stack.md (amendment-only)
- This trio: specs/features/2026-10-22-m4.1-m41-memory-perf/

## Memory discipline
- Budgets unchanged: server ≤ 60 MB / driver ≤ 30 MB steady state; OBS gate
  < 180 MB steady state (amended 2026-10-22; originally 100/90); no new
  dependencies; no per-frame allocations or logging; verification tooling only.

## Stop point
Implementation begins only after the owner switches the session model to V4-Flash
and gives the go-ahead. The scaffolded trio + the feature/whale-girl-m41-memory-perf
branch are the hand-off artifacts.
