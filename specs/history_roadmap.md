# Whale Girl — Roadmap History (archive)

> Verbatim archive of completed items (created 2026-10-20, mirroring the byterra
> convention). The active roadmap keeps one-line ticks with close dates; full detail,
> evidence and handoffs live here. Deferred work from M1 is re-listed in the M2 item
> lines and in features/2026-10-19-m1-pipeline-foundation/validation.md; M2.1's
> handoffs live in features/2026-10-20-m2.1-model-integration/validation.md.

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
  stays behind a flag); M2.2 owns real audio-driven mouth values (replanned
  2026-10-20: TTS-driven — edge-tts primary, macOS say fallback).

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

## M2.1 real Live2D model integration
- Closed 2026-10-20. The real DS鲸鱼娘 (DeepSeek whale girl) model is installed at
  whale-girl-frontend/model/ (dsh-pet-live2d@3.1.3, CC BY-NC-SA 4.0; attribution
  上善无形 / ZipZipPipe / 氵六青; settings file renamed to whale.model3.json,
  FileReferences untouched; gitignored, 4.3 MB).
- index.html: staged load errors (404 / invalid JSON / Version > 4 / loader),
  window.whaleModel hooks (FORCE playMotion + restart, playExpression, stopMotion,
  resetPose, listMotions/listExpressions), status line shows the model + counts,
  single settings fetch (parsed JSON passed to Live2DModel.from with an explicit
  url), failure-only HEAD diagnostics naming missing files and reporting
  network-level failures as an incomplete check. Fixed a latent M1 bug: fitModel
  set anchor on a PIXI.Container (no anchor), which aborted boot before the model
  load and WS connect.
- whale-girl-server/scripts/validate_model.js (new, zero-dep): settings parse,
  Version <= 4, every FileReferences path, moc3 header <= v4, referenced size,
  empty-Motions rejection, actionable per-file errors.
- Evidence (2026-10-20): ws_probe PASS at 30.0 fps over 2.00 s (61 frames);
  ws_role_probe close 1008; curl :3000 → 200, model → 200 (404 when renamed away);
  validator PASS (moc3 v4, 2.02 MB, 8 motions, 44 expressions, 3.95 MB);
  RSS node server.js 27,968 KB / driver 21,360 KB (budgets 60/30 MB); node --check
  PASS; ports released after shutdown. Chrome CDP: 1 settings fetch, 0 console
  errors, hooks verified (FORCE switch, Idle restart, resetPose 84 → 0),
  missing/blocked diagnostics verified. Manual half (browser ?debug=1, console
  hooks, failure path, OBS browser source) owner-confirmed 2026-10-20.
- Commits on feature/whale-girl-m2-model-integration: 1b0ed94 (feature),
  bcaebe6, 0d9db46, 2c84f26, e691b22 (reviewer polish).
- Handoffs: M2.2 owns TTS-driven mouth animation — edge-tts (macOS say fallback)
  word timeline → ParamMouthOpenY (replanned 2026-10-20, owner 1a/2/3a/4a);
  M3.1 owns wire-protocol trigger commands for the hooks; M3.2 owns text/emotion
  → expression presets; M4.1 owns the <100 MB OBS gate re-measured with the real
  model.

## M2.2 TTS-driven lip sync
- Closed 2026-10-21. The brain speaks explicitly specified words: the driver
  synthesizes speech with edge-tts (free Microsoft neural voice
  zh-CN-XiaoyiNeural, WordBoundary word timestamps) and falls back to macOS
  "say" (.m4a, no timestamps) on failure. Audio is written to
  whale-girl-server/audio/ (gitignored, pruned after 1 h) and served by the
  server at /audio/; the browser plays it via Web Audio (AudioBufferSourceNode
  -> destination, so OBS captures it) and animates ParamMouthOpenY from the word
  timeline (attack 20 ms / release 120 ms) or from an amplitude envelope (RMS per
  50 ms, linearly normalized) when the words list is empty. A say command wins
  over the mock mouth; the mock talk envelope remains the no-say fallback. New
  wire command (specced 2026-10-20): {"type":"say","audio":"/audio/<id>.mp3",
  "words":[[t0,t1,"word"],...]}.
- edge-tts runs in a short-lived helper process (whale-girl-server/scripts/
  tts_synth.py, one JSON line back with the words timeline) so the long-running
  driver stays under its 30 MB RSS budget: an owner manual run caught 32,160 KB
  with in-process imports; the driver now measures 15.7-23 MB across the probe
  passes. The helper is wrapped in a 45 s asyncio.wait_for — a hung synthesis is
  killed and the macOS say fallback fires.
- Frontend speech module: latest-wins playback guarded by a generation counter
  (a newer say wins even if an older decode resolves later); lazy AudioContext
  resumed by the user's first gesture; a small auto-hiding "click to enable
  audio" pill when the autoplay policy suspends the context; window.whaleSpeech
  console/probe hooks; ?debug=1 shows "say: <word> | mouth <value> | <engine>";
  zero per-frame allocations (one envelope number + a preallocated probe ring).
- Evidence (2026-10-20/21): say_probe.js (headless Chrome CDP, deterministic via
  WHALE_SAY_TEXT) PASS 12/12 in both engine passes — edge-tts (Xiaoyi): 9 words,
  in-word 54/54 (100%) >= 0.4, gap max 0.079 <= 0.15, word-onset latency
  mean 18 ms / max 32 ms, decoded 847,872 B / 4.42 s; say fallback: 0 words,
  mouth max 0.99, loud-window mean 0.87, decoded 759,116 B / 3.95 s. Real headed
  Chrome 155 via CDP :9222 (owner-authorized): suspended -> pill click ->
  running, in-word 53/53, latency 17/27 ms, audio audibly played. Close re-run:
  ws_probe 30.0 fps over 2.00 s (61 frames), role probe close 1008, curl 200,
  node --check PASS (27,153 B inline script), RSS node 54,720 KB / driver
  22,320 KB, ports released.
- Review rounds (2026-10-21): edge-tts child timeout + say fallback; say
  generation guard; ws_probe ignores say frames; server RSS headroom recorded as
  noisy (29-63 MB across runs, page-cache/GC dependent; M4.1 owns the
  OBS-gate multi-sample re-measure); latency recorded as a spread (mean ~13-21 ms
  / max 27-62 ms across runs, single samples are not a bound).
- Commits on feature/whale-girl-m22-lipsync: 8a68d2f (feature), d684afa (review
  round), 9c6cd93 + d3a1523 (doc corrections). Spec trio:
  specs/features/2026-10-20-m2.2-lipsync/.
- Manual half owner-confirmed 2026-10-21: browser speech + mouth match,
  WHALE_ENGINE=say fallback, mock-envelope fallback between utterances, OBS
  Browser source audio + pill via Interact.
- Handoffs: M3.1 owns real DSH text -> say commands (the canned-phrase picker and
  WHALE_SAY_TEXT are the seam; the frontend say path is text-agnostic); M4.1 owns
  the OBS browser-source memory re-measure with audio playback active, OBS
  audio-policy hardening, and the server RSS headroom at the OBS gate.

## M3.1 DSH command surface
- Closed 2026-10-22. Real DSH sessions drive the whale through a v1 command
  surface: the server relays web-role command frames to the python writer tagged
  as {"relay":"<frame>"} (string concatenation — still no JSON.parse), the driver
  executes say (TTS) / pose (driver-side overlay) / mode (mock|live flag) and
  forwards motion/expression frames, and the frontend runs them on the M2.1
  hooks. New frames: {"type":"motion","group","index"},
  {"type":"expression","name"}, {"type":"say","text"}, {"type":"pose","p":{...}}
  (ids [A-Za-z0-9_]{1,64}, <=32 keys, finite, escaped-frame-size guarded),
  {"type":"mode","mock":bool} (sent on connect / web_connected and on real
  flips). The say frame keeps the M2.2 shape plus an additive "src":"mock"|"cmd":
  canned lines never cut a playing line, a commanded line still does
  (latest-wins), and one commanded say queues behind an in-flight synthesis.
- Native tool: whale-girl-server/scripts/whale_cmd.py (motion|say|pose|mode;
  manifest-validated motion names; exit 0 sent / 1 unreachable or no driver
  (4002) / 2 validation). Gate: whale-girl-server/scripts/cmd_probe.js — 61
  checks (every frame type, CLI paths, 4002/1008, flood cap, malformed frames,
  say queue, decode-time live race, page-after-driver mode, every-sample
  steady-state RSS). say_probe.js remains the M2.2 regression.
- Relay hardening: 100 commands per fixed 1 s window counted before decoding,
  the 8 KB byte cap rejected before toString, the 256 KB python-buffer drop, a
  4002 close when no writer is connected, a best-effort same-origin guard (1008;
  loopback aliases 127.0.0.1 / [::1] / 0.0.0.0 accepted). The first mode
  announcement does not reset the pose; an idempotent mode command is a no-op.
- Evidence (close re-run 2026-10-22): cmd_probe PASS 61/61 (max motion frame 311
  B; flood dropped 1 -> 52; decode race starts unchanged; the reloaded page
  learned the live mode; RSS server max 47,936 KB / driver max 20,048 KB),
  say_probe PASS 12/12 (54/54 in-word, gap max 0.108, latency 15/35 ms),
  ws_probe 30.0 fps (60 frames), role probe close 1008, curl 200, settled stack
  54,976 / 22,576 KB, ports released, no strays, inline script 36,361 B.
- Review rounds: ten independent subagent reviews plus the owner's review round
  surfaced ~150 findings (BLOCKERs: stale pose-overlay keys; a pose frame-size
  overflow) — all fixed. Commits on feature/whale-girl-m31-commands: 953f184
  (feature), 0945472, a672daf, 0533c5d, c5db3c1, 22238a7, 0e19dce, 89be70e,
  57a44f6, 21cf0b6, 1c94f66, e1028cd, 42d7727 (say_probe hermetic endpoints;
  WHALE_SAY_TEXT one-shot per process). Spec trio:
  specs/features/2026-10-21-m3.1-m31-commands/.
- Handoffs: M3.2 owns text/emotion -> expression presets plus an optional
  whale_expression CLI / MCP wrapper; M4.1 owns the OBS browser-source memory
  re-measure with audio and live commands active and the server RSS headroom at
  the OBS gate (the steady-state interpretation is recorded in tech-stack.md);
  M5.1/M5.2 own whale_say as the announcement seam.

## M3.2 LLM-driven expressions
- Closed 2026-10-22. DSH sessions steer the face through whale_express(tag[, text]):
  the model classifies inline, the driver resolves a coarse tag to a Live2D preset
  via expr_tags.py and forwards the existing M3.1 {"type":"expression","name":...}
  frame. Inbound {"type":"expression","tag":"happy","text":"..."} is a variant of
  the M3.1 frame (no new frame type); name:"" is the reset. Tags + defaults:
  happy -> 开心兴奋, sad -> 悲伤, angry -> 生气, surprised -> 感叹号,
  confused -> 问号, love -> 爱心眼, neutral -> reset.
- Semantics: a tag change applies immediately; the SAME tag within
  WHALE_EXPR_COOLDOWN (default 4 s) is skipped (skips still refresh the idle
  deadline); no express command for WHALE_EXPR_IDLE (default 30 s) resets the
  face; a real mode flip clears the expression and resets. The CLI is the strict
  ingress (exit 2 + the tag list, nothing sent); raw unknown/tagless/overlong tags
  reaching the driver fall back to neutral with a 1 Hz log. WHALE_EXPR_TAGS (JSON)
  merges over the defaults; neutral always resets. Expressions drive the face
  (ParamMouthForm) and coexist with speech; the mouth ladder is unchanged.
- Frontend: name:"" -> resetExpression(); cmdState.exprN counts applied
  expressions/resets. Hook fix: pixi-live2d-display 0.4.0's
  ExpressionManager.setExpression() returns false for the preset still tracked as
  currentExpression and resetExpression() does not clear it, so the hooks clear
  currentExpression/reserveExpressionIndex first (reset -> replay and cooldown
  repeats work).
- Evidence (close re-run 2026-10-22 on 89eeff7): expr_probe 22/22 (every tag, CLI
  list, cooldown with the driver skip log, tagless/overlong neutral, name
  passthrough, idle + mode-flip resets, WHALE_EXPR_TAGS merge incl. the neutral
  exception, manifest guard, ports), cmd_probe 61/61, say_probe 12/12 (53/53
  in-word, gap 0.108, 21/32 ms), ws_probe 30.1 fps (61 frames), role probe 1008,
  curl 200, inline script 38,285 B, RSS 60 s settle 45,248 / 16,672 KB (budget
  evidence; the probe's end sample is a post-flow smoke check), ports released.
  Manual half: the owner exercised the pass (all six tags, CLI rejection,
  cooldown, idle, audio after reload + click, OBS connected).
- Review rounds: eight independent reviewer passes (one persistent reviewer);
  every finding fixed, the final pass reported no remaining findings. Notable
  fixes: the CLI/driver unknown-tag contract, the 0.4.0 reset->replay bug, idle
  refresh on skips/name passthroughs, tagless/overlong neutral, the neutral
  override contract, probe evidence (manifest guard, override merge, skip-log
  assertion, RSS policy) and doc/status consistency. Commits on
  feature/whale-girl-m32-expressions: 880584d (feature), ef4f26d + ff3060f
  (round 1), 4acd951 + 75a1a01 (round 2), dbaec7a (round 3), 8950101 (round 4),
  e61af13 (round 5), 1123a37 (round 6), 89eeff7 (round 7 status sync), plus the
  close commit. Spec trio: specs/features/2026-10-22-m3.2-m32-expressions/.
- Handoffs: M4.1 owns the OBS browser-source memory re-measure with audio +
  commands + expressions active (server RSS headroom at the OBS gate); M5.1/M5.2
  own reusing whale_express alongside the announcements and the MCP tool wrapper
  for the whale_* tools.
