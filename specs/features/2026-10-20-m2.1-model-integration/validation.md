# M2.1 — Real Live2D Model Integration — Validation

> CLOSED 2026-10-20. Automatic half executed by the agent on the Mac; the manual
> half (browser + OBS) was confirmed by the owner. Model asset:
> /Users/superguo/Projects/whale-girl-monorepo/whale-girl-frontend/model/
> (DS鲸鱼娘 from dsh-pet-live2d@3.1.3, CC BY-NC-SA 4.0).

## Automatic verification results (measured 2026-10-20)
| Check | Command | Result |
| --- | --- | --- |
| HTTP static host | curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ | 200 PASS |
| Model settings served | curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/model/whale.model3.json | 200 PASS |
| Model settings absent | same URL with whale.model3.json renamed away | 404 PASS (restored → 200) |
| Asset validation, present | node scripts/validate_model.js | PASS — Version 3, moc3 v4 (2.02 MB), 8 motions, 44 expressions, 3.95 MB referenced |
| Asset validation, no settings | node scripts/validate_model.js /tmp/close-empty | exit 1 — "missing whale.model3.json" (actionable) |
| Asset validation, empty Motions | node scripts/validate_model.js /tmp/close-empty-motions | exit 1 — "FileReferences.Motions is empty" |
| Motion probe | node scripts/ws_probe.js | PASS — 30.0 fps over 2.00 s, 61 frames, monotonic f |
| Role probe | node scripts/ws_role_probe.js | PASS — close 1008 + reason |
| Frontend inline JS | node --check (extracted script) | PASS |
| Memory budget | ps -axo pid,rss,command \| grep -E 'node server.js\|control_whale.py' | node server.js 27,968 KB / driver 21,360 KB — within 60/30 MB |
| Clean shutdown | lsof after SIGTERM | PASS — ports 3000/3001 released, no stray processes |

## Frontend behaviour verified in a browser engine (Chrome CDP, 2026-10-20)
| Check | Measured result |
| --- | --- |
| Model load | status line: "model: whale.model3.json — 8 motion groups, 44 expressions"; window.whaleModel present |
| Single settings fetch | exactly 1 request for /model/whale.model3.json per load |
| Playback hooks | playMotion('Hammer') → true; playMotion('BubbleGum') while Hammer plays → true (FORCE interrupt); playExpression('爱心眼') → true |
| stopMotion / Idle restart | stopMotion() → idle resumes (state Idle/0/p1); playMotion('Idle') → true |
| resetPose | parameters off-default 84 → 0 immediately after resetPose() |
| Missing sibling (404) | renamed texture_01.png → "missing file(s): textures/texture_01.png" |
| Network-level failure | blocked texture request → "Asset check incomplete: 1 request(s) failed at the network level" |
| Healthy-load console | 0 new console errors |

## Manual verification (owner, first-time-user pass — PASSED 2026-10-20)
1. Server: terminal → `cd whale-girl-server` → `npm start` — the log shows
   `http=:3000 ws=:3001`.
2. Driver: second terminal → `cd whale-girl-server` →
   `.venv/bin/python control_whale.py` — the log shows `driver: 30 fps`.
3. Browser: open `http://localhost:3000/?debug=1` — the DS鲸鱼娘 is visible
   bottom-center on a transparent background, blinking/talking/gazing at ~30 fps;
   the status line shows
   `model: whale.model3.json — 8 motion groups, 44 expressions | ws connected, frame N`.
4. Console (DevTools ⌥⌘I → Console): `whaleModel.listMotions()` → 8 groups;
   `whaleModel.playMotion('Hammer')` → true and the hammer plays; while it runs
   `whaleModel.playMotion('BubbleGum')` → true (interrupts);
   `whaleModel.playExpression('爱心眼')` → true; `whaleModel.resetExpression()`
   restores the face; `whaleModel.resetPose()` clears leftover motion poses.
5. Failure path: rename `whale-girl-frontend/model/whale.model3.json` to `.bak` and refresh — placeholder
   whale + exactly ONE console error; rename back and refresh — the model returns.
6. OBS: Sources → + → Browser → URL `http://localhost:3000`, Width 1920,
   Height 1080 — transparent overlay, no flicker, no crash, both with and without
   the model.

Owner confirmation: all six steps passed (2026-10-20).

### Already verified, do NOT re-run
| Item | What it covered | Verified by |
| --- | --- | --- |
| Inline script syntax | node --check on the extracted script | agent, 2026-10-20 |
| Asset validation (present / no settings / empty Motions) | validator exit codes and actionable messages | agent, 2026-10-20 |
| HTTP checks | page 200, model 200, model 404 when absent | agent, 2026-10-20 |
| WS probes | 30.0 fps monotonically increasing f, close 1008 | agent, 2026-10-20 |
| Memory + shutdown | RSS within budgets, ports released | agent, 2026-10-20 |
| Loader behaviour | single fetch, staged errors, per-file diagnostics | agent (Chrome CDP), 2026-10-20 |
| Hook semantics | FORCE switching, Idle restart, resetPose | agent (Chrome CDP), 2026-10-20 |

## Handoff to dependant milestones
- M2.2 owns: TTS-driven mouth animation — edge-tts (macOS say fallback) word
  timeline drives ParamMouthOpenY (the model's LipSync group already exists);
  the mock talk envelope stays the no-audio fallback. (Replanned 2026-10-20,
  owner 1a/2/3a/4a: the loopback-RMS draft is retired.)
- M3.1 owns: wire-protocol commands that trigger the M2.1 playback hooks from real
  AI (the frontend API now exists; the protocol change was deferred).
- M3.2 owns: text/emotion → expression presets via the same hooks.
- M4.1 owns: the <100 MB OBS browser-source gate re-measured with the real model
  (2.1 MB moc3 + ~1.9 MB textures add real GPU/memory load).
