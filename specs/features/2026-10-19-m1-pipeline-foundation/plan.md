# M1 — Pipeline Foundation — Plan

> Confirmed by the owner (2026-10-19) before implementation. Status: CLOSED — all
> groups implemented as planned (see validation.md).

## Task groups
1. Root files: .gitignore (model assets + toolchains excluded), README.md (quick
   start, OBS, troubleshooting, split notes).
2. whale-girl-server/package.json (express ^4.22.3, ws ^8.22.0, start script) + npm
   install + server.js (role routing, raw passthrough, caps, heartbeat, graceful
   shutdown, EADDRINUSE messaging).
3. whale-girl-frontend/index.html (CDN script chain with cdnjs fallback, transparent
   PIXI.Application, model load + placeholder, fit pipeline, auto-reconnect WS client,
   parameter cache) + model/README.md (Cubism 4 asset requirements).
4. requirements.txt + control_whale.py (asyncio driver, drift-corrected 30 FPS,
   zero-alloc frame dict, blink/talk/gaze/sway synthesis, reconnect/backoff, idles
   with no viewers) + .venv provisioning (pip upgraded first).
5. End-to-end verification: start server + driver as background jobs; node ws probes
   (motion rate, unknown-role rejection); driver restart; single-writer replacement;
   RSS snapshot; clean shutdown; README finalization.

## Research findings baked into the plan (all verified live)
- pixi.js@7.4.3/dist/pixi.min.js = 200 (the dist/browser path is v8-only and 404s);
  cdnjs mirror also 200.
- pixi-live2d-display@0.4.0/dist/cubism4.min.js = 200; official Cubism Core URL = 200.
- Shipped-bundle inspection confirmed: setParameterValueById present, and the UMD
  bundle auto-uses window.PIXI.Ticker.shared (registerTicker still called explicitly).
- API confirmed from upstream usage (issue #144):
  model.internalModel.coreModel.setParameterValueById(id, value).
- websockets version ceiling for Python 3.9: 15.x (16.0 needs 3.10+, 17.x needs 3.11+).

## Files
- .gitignore, README.md
- whale-girl-server/{package.json, server.js, requirements.txt, control_whale.py,
  scripts/ws_probe.js, scripts/ws_role_probe.js}
- whale-girl-frontend/{index.html, model/README.md}
