# M2.1 — Real Live2D Model Integration — Validation

> Planning complete 2026-10-20; implementation paused for the owner's
> V4.1-Flash session-model swap. The results tables below are filled at the
> close (automatic half by the agent, manual half by the owner).

## Automatic verification results (run at the close)
| Check | Command | Result |
| --- | --- | --- |
| Frontend inline JS | node --check (extracted script) | PENDING |
| Asset validation, present | node scripts/validate_model.js | PENDING (expect PASS + size + moc3 v4) |
| Asset validation, absent | node scripts/validate_model.js with model/ emptied | PENDING (expect exit 1 + actionable per-file list) |
| Model URL, present | curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/model/whale.model3.json | PENDING (expect 200) |
| Model URL, absent | same, model/ emptied | PENDING (expect 404) |
| Motion probe | node scripts/ws_probe.js | PENDING (expect PASS, 20–40 fps, monotonic f) |
| Role probe | node scripts/ws_role_probe.js | PENDING (expect close 1008) |
| Memory budget | ps -axo pid,rss,command | grep -E 'node server.js|control_whale.py' | PENDING (server ≤ 60 MB / driver ≤ 30 MB) |
| Clean shutdown | lsof ports after SIGTERM | PENDING |

## Manual verification (owner, at the close)
1. http://localhost:3000?debug=1 with the real model: DS鲸鱼娘 visible on a
   transparent background, blinks/talks/gazes at ~30 fps (driver running); the
   status line shows the model name + motion/expression counts.
2. Playback hooks via the console: playMotion('Hammer') and
   playExpression('爱心眼') visibly play/apply; playMotion('BubbleGum') called
   while Hammer plays interrupts it (returns true); stopMotion() stops the
   active motion (the idle motion resumes by design); playMotion('Idle') then
   restarts idle (returns true); resetPose() clears leftover motion poses;
   resetExpression() restores the default face.
3. Failure path: temporarily move model/ away → placeholder whale + exactly
   ONE console error; restore → the whale returns on refresh.
4. OBS Browser source (1920×1080, http://localhost:3000): with and without the
   model — transparent, no flicker, no crash.

## Handoff to dependant milestones
- M2.2 owns: loopback-captured RMS → ParamMouthOpenY (the model's LipSync
  group already exists); the mock talk envelope stays the no-audio fallback.
- M3.1 owns: wire-protocol commands that trigger the M2.1 playback hooks from
  real AI (the frontend API now exists; the protocol change was deferred).
- M3.2 owns: text/emotion → expression presets via the same hooks.
- M4.1 owns: the <100 MB OBS browser-source gate re-measured with the real
  model (2.1 MB moc3 + ~1.9 MB textures add real GPU/memory load).
- Owner action at this stop point: switch the session AI model to V4.1-Flash
  before implementation begins (recorded in roadmap.md and
  SESSION-CONTEXT.md).
