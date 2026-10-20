# M1 — Pipeline Foundation — Validation

> CLOSED 2026-10-19. Automatic half executed by the agent on the Mac; the manual half
> (browser + OBS with and without the model) is the owner's acceptance step.

## Automatic verification results (all measured)
| Check | Command | Result |
| --- | --- | --- |
| HTTP static host | curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ | 200 PASS |
| Model-absent path | curl :3000/model/whale.model3.json | 404 (placeholder path, expected) |
| Motion probe | node scripts/ws_probe.js | PASS — 30.0 fps over 2.00 s, 61 frames, monotonic f, in-range params |
| Motion probe (after driver restart) | node scripts/ws_probe.js | PASS — 30.0 fps over 1.97 s, 60 frames |
| Unknown-role rejection | node scripts/ws_role_probe.js | PASS — close code 1008 + reason |
| Single-writer policy | second .venv/bin/python control_whale.py | PASS — first instance "replaced by a newer instance; exiting." (4001) |
| Driver restart resilience | kill driver job, restart | PASS — reconnected, 29→30 fps, server unaffected |
| Frontend inline JS | node --check (extracted script) | PASS — syntax OK |
| Memory budget | ps RSS while streaming | node server.js 49,984 KB / driver 20,816 KB — within budgets |
| Clean shutdown | lsof after SIGTERM | PASS — ports released, no stray processes |

## Manual verification (owner)
1. open http://localhost:3000?debug=1 — placeholder whale visible on a transparent
   background; status line shows "ws connected" and a rising frame counter; console
   shows exactly ONE model-not-loaded error.
2. OBS: add Browser source (URL http://localhost:3000, 1920x1080) — transparent
   overlay, placeholder visible, no flicker while the driver is killed/restarted.
3. Drop a Cubism 4.x whale.model3.json (+ siblings) into model/, refresh — the whale
   replaces the placeholder and blinks/talks/gazes at 30 fps.

## Handoff to dependant milestones
- M2.1 (real model integration) owns: the drop-in asset path, Cubism 4.x export
  validation with actionable errors, motion/expression playback hooks — the M1
  placeholder becomes the failure path.
- M2.2 (TTS-driven lip sync) owns: replacing the mock talk envelope with
  synthesized-speech-driven mouth animation — edge-tts (macOS say fallback) word
  timeline drives ParamMouthOpenY (word-level envelope + amplitude fallback).
- M3.1 (DSH interaction) owns: replacing mock synthesis with real AI-driven parameter
  commands; mock mode stays behind a flag.
- M4.2 (Ubuntu split) owns: headless server deployment + SSH port forwarding + env
  config + the frontend ?ws= remote endpoint (the mechanism already exists, config
  only).
- M4.1 (memory/OBS polish) owns: the <100MB browser-source gate, scene sizing,
  reconnect hardening, CPU/GPU profiling on target streaming hardware.
- Owner action at this close: switch the session AI model to V4.1-Flash before M2
  planning begins (recorded in roadmap.md and SESSION-CONTEXT.md).
