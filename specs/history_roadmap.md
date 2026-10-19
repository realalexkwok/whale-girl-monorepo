# Whale Girl — Roadmap History (archive)

> Verbatim archive of completed items (created 2026-10-20, mirroring the byterra
> convention). The active roadmap keeps one-line ticks with close dates; full detail,
> evidence and handoffs live here. Deferred work from M1 is re-listed in the M2 item
> lines and in features/2026-10-19-m1-pipeline-foundation/validation.md.

## M1.1 monorepo scaffold
- Created whale-girl-server/ (package.json: express ^4.22.3, ws ^8.22.0, scripts.start,
  engines node ≥18) and whale-girl-frontend/ (index.html, model/README.md).
- Root .gitignore (node_modules, .venv, __pycache__, .DS_Store, model assets except the
  README) and README.md (quick start, OBS setup, troubleshooting, split notes).
- Git repo was already initialized; no commit performed (owner-commit rule).
- Evidence: npm install clean (69 packages); file tree verified.

## M1.2 server.js static host and ws proxy
- express static serving of ../whale-girl-frontend (maxAge 0 for dev freshness) on
  PORT 3000; WebSocketServer on WS_PORT 3001 (maxPayload 64 KB).
- Role routing by query param: web (Set, many), python (single writer; replacement
  closes the old socket with 4001 "replaced by a newer instance"), unknown → 1008.
- Raw-text passthrough (no JSON.parse), 8 KB frame cap, 256 KB per-client
  backpressure skip, 30 s ping/pong keepalive, aggregate logging every 5 s.
- Evidence (2026-10-19): curl :3000 → 200; ws_role_probe → close 1008 with reason;
  single-writer test: second python instance connected, first printed "replaced by a
  newer instance; exiting." and exited cleanly; server survived driver kill/restart.
- Handoffs: none.

## M1.3 index.html pixijs and live2d frontend
- One static file, vanilla JS: Cubism Core → PixiJS 7.4.3 (jsdelivr, cdnjs onerror
  fallback) → pixi-live2d-display 0.4.0 cubism4 bundle, all deferred, order preserved.
- PIXI.Application with backgroundAlpha 0, resizeTo window, antialias, autoDensity,
  resolution capped at min(devicePixelRatio, 2), powerPreference high-performance.
- Live2DModel.from(model/whale.model3.json, { autoInteract: false, motionPreload:
  'NONE' }); failure → PIXI.Graphics placeholder whale + one console.error (never a
  blank OBS source). Fit pipeline: anchor (0.5, 1), bottom-center, ~90% height / ≤60%
  width, recomputed on resize.
- WebSocket ws://localhost:3001?role=web with ?ws= override, capped exponential
  backoff + jitter, per-parameter cache applied on model-ready via
  coreModel.setParameterValueById; hot path avoids closures/spreads; ?debug=1 status
  line (off by default).
- Evidence: inline script passed node --check; page served 200; model URL correctly
  404s when absent (placeholder path exercised by the user at acceptance).
- Handoffs: M2.1 owns the real-model drop-in path (placeholder becomes the failure
  path); M4.2 owns the ?ws= remote endpoint.

## M1.4 control_whale.py mock motion driver
- asyncio + websockets (modern API), drift-corrected 30 FPS loop, idles while the
  server reports zero web clients, exponential reconnect (1→10 s, jitter), exits
  without retry on close code 4001.
- Zero per-frame allocations: pre-allocated frame dict mutated in place, compact
  json.dumps separators. Blink state machine (cosine-eased, 2.5–5.5 s random
  intervals), talk-burst envelope × multi-sine mouth, sine+jitter gaze, body sway.
- Evidence: websockets 15.0.1 installed (Python 3.9-compatible ceiling verified via
  PyPI requires_python); probe measured 30.0 fps over 2 s (61 frames); RSS 20,816 KB.
- Handoffs: M3.1 owns replacing mock synthesis with real AI-driven commands (mock mode
  stays behind a flag); M2.2 owns real audio-driven mouth values.

## M1.5 end-to-end verification and docs
- Full pipeline run twice (fresh start and after driver restart): probe PASS both
  times at 30.0 fps with in-range parameter values and a monotonic frame counter.
- RSS snapshot while streaming: node server.js 49,984 KB, driver 20,816 KB — within
  the tech-stack budgets. Ports released after shutdown, no stray processes.
- scripts/ws_probe.js + scripts/ws_role_probe.js committed as reusable smoke tests.
- README finalized (quick start, OBS, troubleshooting, split notes); stop condition
  honored: Milestone 2 work deferred for the owner's V4.1-Flash session-model swap.
- Handoffs: see features/2026-10-19-m1-pipeline-foundation/validation.md "Handoff to
  dependant milestones" — M2.1 (model), M2.2 (audio), M3.1 (DSH),
  M4.1 (memory/OBS), M4.2 (split).
