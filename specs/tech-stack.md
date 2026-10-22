# Whale Girl — Tech Stack

## Language & toolchain
- **Node ≥ 18** (local v25.2.0) for the server; plain CommonJS, no bundler, no
  TypeScript on the server (keep it dependency-minimal).
- **Python ≥ 3.9** (local 3.9.10) for the driver; asyncio only, no threads, no numpy/
  scipy, no GUI libraries. Venv lives at whale-girl-server/.venv (gitignored).
- Package managers: **npm only** for whale-girl-server (never mix npm/pnpm);
  **pip + venv** for Python. Dependencies are pinned in package.json /
  requirements.txt and may not be added outside this file.

## Server side (whale-girl-server/)
- express ^4.22.3 (the v4 line, NOT v5 — battle-tested static serving) on PORT
  (default 3000), env-overridable.
- ws ^8.22.0 for the WebSocket proxy on WS_PORT (default 3001), env-overridable.
- Proxy design (verified 2026-10-19): the server relays Python payloads to web clients
  as RAW TEXT — it never JSON.parses, so per-frame CPU/allocation churn is near zero.
  8 KB soft frame cap, 64 KB ws maxPayload, 256 KB per-client backpressure skip,
  30 s ping/pong keepalive, single-python-writer (replacement close code 4001),
  unknown roles close 1008.
- Measured budget (2026-10-19): ~50 MB RSS while streaming (steady state; the
  ~60 MB boot transient decays within a minute and is not part of the gate).

## Frontend (whale-girl-frontend/index.html)
- ONE static HTML file, vanilla JS, no build step, no framework.
- **PixiJS 7.4.3** UMD (NOT v8 — pixi-live2d-display does not support v8):
  - primary: https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js (200 OK verified)
  - fallback: https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.4.3/pixi.min.js (onerror swap)
- **Live2D Cubism Core** (official URL, 200 OK verified):
  https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js
- **pixi-live2d-display 0.4.0** (latest stable; final release) cubism4 bundle:
  https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js
  - supports Cubism 2.1/3/4 models; the Cubism framework is bundled inside.
  - loading: Live2DModel.from(url, { autoInteract: false, motionPreload: 'NONE' })
  - parameter control: model.internalModel.coreModel.setParameterValueById(id, value);
    the pose-clear path also uses getParameterIndex(id) and
    getParameterDefaultValue(index) (both guarded, try/catch) to restore defaults
  - ticker: the UMD bundle auto-uses window.PIXI.Ticker.shared; we additionally call
    Live2DModel.registerTicker(PIXI.Ticker) explicitly (guarded).
- Renderer: backgroundAlpha 0 (transparent OBS overlay), resizeTo window, antialias,
  autoDensity, resolution capped at min(devicePixelRatio, 2) to bound GPU memory on
  retina, powerPreference high-performance.
- Model asset: whale-girl-frontend/model/whale.model3.json — a **Cubism 4.x-format
  export** (owner decision 2026-10-19; Cubism 5-only assets must be re-exported for
  4.x). Missing/invalid assets render the built-in placeholder; the page never crashes.
- No Electron, no React/Vite, no WebGL libraries beyond PixiJS.

## Python driver (whale-girl-server/control_whale.py)
- **websockets >=13,<16** (installed 15.0.1) — the upper bound exists because 16.0
  needs Python ≥ 3.10 and 17.x needs ≥ 3.11, and the Mac runs 3.9.10 (verified against
  PyPI requires_python 2026-10-19). Modern asyncio API:
  from websockets.asyncio.client import connect.
- 30 FPS drift-corrected loop (asyncio.sleep of the frame remainder; resync instead of
  spin when behind); idles while the server reports zero web clients.
- Zero per-frame allocations: one pre-allocated frame dict mutated in place, compact
  json.dumps separators. Measured budget (2026-10-19): ~21 MB RSS at 30 FPS.
- Motion synthesis (mock): cosine-eased blink state machine (ParamEyeLOpen/ROpen),
  talk-burst envelope × multi-sine mix (ParamMouthOpenY), sine+jitter gaze
  (ParamEyeBallX/Y), subtle sway (ParamAngleX/Y/Z). Raw Live2D values are sent
  unclamped — some Live2D params are degrees; correctness is the sender's job.

## Wire protocol (v0 — frozen until a spec change)
- python → server → web:
      {"type":"motion","f":12345,"p":{"ParamMouthOpenY":0.42,"ParamEyeBallX":-0.1}}
  f = monotonic frame counter; p = raw Live2D parameter values.
- server → python: {"type":"web_connected","count":N}
- web → server: {"type":"hello"} (accepted, ignored).
- python → server → web (M2.2): {"type":"say","audio":"/audio/<id>.mp3",
  "words":[[t0,t1,"word"],...]} — the frontend plays the audio via Web Audio and
  animates the mouth from the word timeline; the server serves the audio file.
- Roles via query param: ?role=web (many) / ?role=python (single writer).

## Wire protocol v1 (M3.1 command surface — additive; v0 frames unchanged)
- web → server → python (commands, relayed RAW and tagged as
  {"relay":"<frame text>"} by string concatenation — the server still never
  parses JSON): {"type":"motion","group":"<MotionGroup>","index":0} /
  {"type":"expression","name":"<ExpressionName>"} /
  {"type":"say","text":"<words>"} /
  {"type":"pose","p":{"ParamEyeBallX":0.8}} ({} clears the overlay) /
  {"type":"mode","mock":true|false}.
- python → server → web: the v0 motion frame and the M2.2 say frame (shape
  unchanged, plus an additive "src":"mock"|"cmd" field — fix 2026-10-21);
  motion/expression command frames forwarded for execution; a
  {"type":"mode","mock":bool} frame on connect and on every web_connected
  (re-announce, so a page that joins later learns the mode), plus a frame on a
  real flip. Pose overrides are applied driver-side and ride inside the normal
  motion frames.
- Speech ownership: a say owns the line until it ends — the driver suppresses
  canned triggers while a say plays (hold = words end + 0.3 s, estimated for
  the macOS-say fallback) and queues one commanded say behind an in-flight
  synthesis; the frontend ignores src:"mock" while a line plays, so the mock
  never interrupts a playing line while a commanded say keeps latest-wins.
- Commands vs server events: the {"relay":...} tag is the only command path;
  web_connected is accepted only top-level from the server, so no web client
  can stop the 30 FPS stream by spoofing the count. Malformed frames
  (non-finite numbers, huge ints, deep nesting, oversized poses) are rejected —
  with a rate-limited log where actionable — and never kill the command reader.
- Pose: max 32 keys, key ids must match [A-Za-z0-9_]{1,64} (ASCII keeps the
  json escaping bounded), finite numbers only; a pose whose escaped motion frame
  would exceed the 8 KB cap is rejected; a new pose replaces the overlay and
  every key the overlay no longer sets is deleted from the frame dict (no stale
  parameters, no unbounded frame growth). {} clears; the frontend restores
  dropped keys to their default values.
- Say: text ≤ 300 chars; the serialized say frame is size-checked (8 KB) before
  send, so an oversized line is logged and dropped instead of silently lost.
- Mode: a mode frame is emitted on driver connect and on every web_connected
  (re-announce); only a real flip changes the mode, clears the pose overlay and
  echoes the frame — an idempotent mode command does not clear a held pose.
- Relay hardening: the command relay is capped at 100 commands per fixed 1 s
  window (up to ~200 can pass across a boundary) and drops when the python
  writer's buffer exceeds 256 KB; with no python writer connected the
  server closes the sender with 4002 and whale_cmd.py exits 1 with a message.
- Browser-origin guard: a page whose Origin host differs from the WebSocket host
  is closed with 1008 — a best-effort same-origin guard (loopback aliases are
  treated as one host; DNS rebinding and non-browser clients that omit Origin are
  not covered, and auth remains V3 work). Non-browser clients (CLI/probes) are
  unaffected.
- Driver semantics: WHALE_MODE=mock|live (default mock). Live pauses the mock
  talk bursts + canned phrases and zeroes the mock mouth; idle blink/gaze/sway
  continue; a mode flip clears the pose overlay and the frontend resets poses.
  Mouth priority ladder: a live say > the motion-frame ParamMouthOpenY > the
  mock envelope. Commanded Live2D motions are body animations: they do not
  pause the mock speech or the say mouth.
- Roles and caps are unchanged (single python writer, many web clients, 8 KB
  soft frame cap / 64 KB maxPayload, raw passthrough).
- Trust: any web client can send commands — acceptable for localhost/V1;
  WebSocket auth is V3 work.

## Dev environment
- macOS: two terminals (npm start; .venv/bin/python control_whale.py) + browser
  http://localhost:3000 (?debug=1 shows the status line) + OBS Browser source.
- Env knobs: PORT, WS_PORT, WHALE_WS (python endpoint), WHALE_DEBUG=1 (per-frame
  driver logs, off by default), WHALE_MODE=mock|live (default mock),
  WHALE_CMD_WS (CLI endpoint), WHALE_MODEL_MANIFEST (CLI motion-name validation),
  ?ws=ws://host:port (frontend endpoint override — for the Ubuntu split the nginx
  proxy must also pass the page Host, see dev-environment.md).
- See dev-environment.md for the full runbook and the deployment patterns (M4.2).

## Testing & verification (two-sided)
- Automatic half (agent): node scripts/ws_probe.js (expect PASS, 20–40 fps, increasing
  f), node scripts/ws_role_probe.js (expect close 1008), node scripts/cmd_probe.js
  (the M3.1 gate: v1 frames end to end, say byte-compat, malformed safety, multi-
  sample RSS — it prints its check count), node scripts/say_probe.js (the M2.2
  regression), curl smoke of :3000, node --check on the inline frontend script,
  ps RSS snapshot, port-release check.
- Manual half (owner): browser check at http://localhost:3000?debug=1, then OBS
  Browser source — with and without the real model in place.
- Reports must name absolute artifact paths and measured numbers.

## Owner decision amendments
- 2026-10-19: frontend pins PixiJS v7 + pixi-live2d-display 0.4.0 (v8 unsupported);
  the Live2D asset must be a Cubism 4.x export.
- 2026-10-19: raw-text passthrough proxy (no server-side JSON parsing) as the
  low-memory choice; protocol validation belongs to the endpoints.
- 2026-10-19: M1 scope stops before the real model/audio/DSH work.
- 2026-10-20: the session AI model switches to V4.1-Flash at the M1 close.
- 2026-10-20: spec-driven development adopted (AGENTS.md + specs/) with the
  ask-user-question-before-writes rule; the byterra-monorepo layout is the reference.
- 2026-10-20: combined roadmap adopted (advisor comparison + grouped ask round):
  M2 模型与口型同步, M3 DSH 互动大脑, M4 内存压榨与部署; the danmaku (blivedm)
  milestone is explicitly rejected.
- 2026-10-20 (replanned same day, owner 1a/2/3a/4a): M2.2 is TTS-DRIVEN — the
  words are explicitly specified; edge-tts (free Microsoft neural voices,
  word-boundary timestamps) synthesizes the speech, with macOS "say" as the
  fallback engine; the browser plays the audio via Web Audio and drives the mouth
  from the word timeline (word-level envelope + amplitude fallback). New pip dep:
  edge-tts (justified: timestamps + free voices). The loopback-device capture
  approach is RETIRED.
- 2026-10-20: M4.1 hard gate = the OBS browser source's EXTRA memory < 100 MB on the
  Mac, re-measured after every change; the per-process budgets stay in force.
- 2026-10-20 (amended same day, owner 1a/2a/3a): M4.2 connectivity — SSH port
  forwarding is an OPTIONAL advanced mode, never a requirement. The general-user
  baselines are: (1) same-machine localhost (default), (2) cloud server via git pull
  + install-ubuntu.sh + systemd + nginx TLS (no SSH knowledge needed); direct TCP
  remains a documented option.
- 2026-10-22 (M3.1 review rounds; recorded here for the owner's confirmation at
  the close): the server/driver RSS budgets are steady-state budgets — the
  ~60 MB server boot transient decays within a minute and is not part of the
  gate. M3.1 also adds the relay hardening recorded in the v1 protocol section
  (100 commands per fixed 1 s window, a 4002 close when no python writer is
  connected, a best-effort same-origin guard, and the pose id grammar +
  frame-size guard) — see requirements.md decision 4.
