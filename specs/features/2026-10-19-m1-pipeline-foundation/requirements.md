# M1 — Pipeline Foundation — Requirements

> Confirmed by the owner (2026-10-19). Grouped per the SDD ask-round convention.
> Status: CLOSED 2026-10-19 — see validation.md for evidence.

## Scope
- Monorepo layout: whale-girl-server/ (package.json, server.js, control_whale.py) and
  whale-girl-frontend/ (index.html, model/ placeholder).
- Server: express static hosting of the frontend on HTTP :3000; WebSocket proxy on
  :3001 accepting parameters from Python and forwarding them to frontend clients.
- Frontend: HTML5 canvas with transparent background (backgroundAlpha 0); PixiJS +
  pixi-live2d-display loaded from cdnjs/jsdelivr; load model/whale.model3.json with
  error handling/placeholders when the asset is missing; WebSocket to
  ws://localhost:3001?role=web; apply parameters via
  coreModel.setParameterValueById(id, value).
- Python: async script (websockets + asyncio) connecting to
  ws://localhost:3001?role=python; 30 FPS loop sending mock natural blinking and mouth
  movement (ParamMouthOpenY, ParamEyeBallX).
- Stop after Milestone 1 — the owner switches the session AI model to V4.1-Flash
  before Milestone 2.

## Decisions
- PixiJS v7 (7.4.3), NOT v8 — pixi-live2d-display 0.4.0 (latest stable) does not
  support v8 (research verified against npm dist-tags and the shipped bundle).
- Cubism 4 bundle (cubism4.min.js) + official Cubism Core URL — supports Cubism
  2.1/3/4 models; the model asset must be a Cubism 4.x export.
- Server relays frames as raw text without parsing (memory discipline); roles via
  ?role= query param; single Python writer.
- websockets pinned >=13,<16 because the Mac's Python 3.9.10 cannot run 16+ (PyPI
  requires_python verified); modern asyncio client API.

## Context
- Everything runs on macOS during development; must split later (server → headless
  Ubuntu, frontend stays in Mac OBS) with config-only changes.
- Hard constraints: clean, production-ready, highly performant code; minimize memory
  allocations to prevent macOS OOM; no Electron, no heavy Python UI libraries.
- Local toolchain: Node v25.2.0, npm 10.5.2, Python 3.9.10 (websockets not yet
  installed), git repo already initialized, ports 3000/3001 free.

## Validation criteria (from the ask round)
- npm install clean; npm start serves the frontend (curl 200).
- WS probe as role=web receives ~30 FPS motion frames with a monotonic frame counter
  while control_whale.py runs.
- With model/ empty the page shows the whale placeholder on a transparent background;
  console shows exactly one clear error.
- Python kill/restart: server stays healthy, web client unaffected, reconnect within
  backoff; a second python instance replaces the first with a clear reason.
- No per-frame logs anywhere; server and driver RSS stay flat (budgets in
  tech-stack.md).
