# Whale Girl — Live2D interactive streaming system

Low-memory Live2D pipeline for streaming: a Python "brain" drives Live2D
parameters through a tiny Node.js proxy into a PixiJS browser frontend that
OBS captures as a transparent overlay.

## Spec-driven development
This repo is spec-driven and agent-operated. The constitution lives in
specs/ (mission.md, tech-stack.md, roadmap.md, dev-environment.md,
history_roadmap.md, features/) and the agent rules in AGENTS.md — agents read
those first, ask you one grouped question round (requirements / plan / validation)
before every write to disk, and never commit without your instruction.
SESSION-CONTEXT.md carries the cross-session state; docs/folder-structure.md maps
the tree. Reference layout: the byterra-monorepo.

## Architecture

    [ DSH session ] --- whale_cmd.py ---> ws://:3001?role=web ---+
                                                                 v
    [ Python driver ] -- ws://:3001?role=python --> [ Node server.js ]
    control_whale.py   (mock params + TTS + commands)   express :3000 (static)
                                                        ws      :3001 (proxy)
    [ OBS Browser source ] <-- http://:3000 -- [ index.html: PixiJS 7 + Live2D ]

## Quick start (macOS, dev)

Terminal 1 — server:

    cd whale-girl-server
    npm install
    npm start

Terminal 2 — driver (mock mode by default; WHALE_MODE=live takes commands):

    cd whale-girl-server
    python3 -m venv .venv
    .venv/bin/pip install -U pip
    .venv/bin/pip install -r requirements.txt
    .venv/bin/python control_whale.py

Browser:

    open http://localhost:3000        (add ?debug=1 for the status line)

OBS:

    Sources → + → Browser
    URL:          http://localhost:3000
    Width/Height: 1920x1080 (or your canvas size)
    The page is already transparent; no custom CSS needed.

## Adding the real model

Drop your Cubism 4.x export into whale-girl-frontend/model/ so that
whale.model3.json sits next to its .moc3, textures, physics and motions
(see whale-girl-frontend/model/README.md), then refresh the browser source.
Until then the frontend shows a placeholder whale — by design, and OBS-safe.

## Speech (M2.2 TTS lip sync)

The driver can speak explicitly specified words: edge-tts synthesizes the
speech (neural voice + word timestamps) with macOS "say" as the automatic
fallback, writes the audio to whale-girl-server/audio/ (gitignored) and sends
a say frame; the browser plays it via Web Audio (OBS captures it) and animates
the mouth from the words, while the mock talk envelope remains the no-audio
fallback. In mock mode a random canned Chinese phrase is spoken at each talk
burst; in live mode a DSH session supplies the text (see Commands below). A
line plays to its end: canned mock lines never interrupt a playing line, while
an explicit command say still does (latest-wins). See specs/dev-environment.md
for the env knobs and the say probe.

## Commands (M3.1 DSH interaction)

The whale takes commands from a DSH session. The native tool is
whale-girl-server/scripts/whale_cmd.py (run it with the venv python):

    cd whale-girl-server
    .venv/bin/python scripts/whale_cmd.py motion Hammer                  # play a motion
    .venv/bin/python scripts/whale_cmd.py say 你好，我是鲸鱼娘             # speak (TTS + lip sync)
    .venv/bin/python scripts/whale_cmd.py pose '{"ParamEyeLOpen":0,"ParamEyeROpen":0}'  # hold params (eyes shut)
    .venv/bin/python scripts/whale_cmd.py pose '{}'                      # release
    .venv/bin/python scripts/whale_cmd.py mode live                      # pause mock synthesis
    .venv/bin/python scripts/whale_cmd.py mode mock                      # resume

WHALE_MODE=mock|live sets the boot mode (default mock). In live mode the mock
talk bursts and canned phrases pause while the idle blink/gaze/sway keep going;
say > motion > mock envelope is the priority ladder. Motion names are validated
against the model manifest, so a typo prints the available groups. ?debug=1
shows the mode and the last motion/expression/mode command (the pose overlay is
driver-side and not shown; during a say the line shows the current word).

## Wire protocol (v0 + v1 commands)

- Python connects to ws://localhost:3001?role=python (one writer at a time;
  a second instance replaces the first).
- Browser and the CLI tool connect to ws://localhost:3001?role=web (many
  allowed); the server relays their command frames to the python writer raw.
  Browser pages are accepted only when the page origin host matches the
  WebSocket host, so a visited website cannot command the whale.
- Python → server → browser:

      {"type":"motion","f":12345,"p":{"ParamMouthOpenY":0.42,"ParamEyeBallX":-0.1}}

  f = monotonic frame counter; p = raw Live2D parameter values (unclamped —
  some Live2D params are degrees, e.g. body angles).
- Python → server → browser (M2.2):

      {"type":"say","audio":"/audio/say-123.mp3","words":[[0.1,0.56,"你好"],...],"src":"cmd"}

  The browser plays the audio via Web Audio and drives ParamMouthOpenY from the
  word timeline; an empty words list (macOS say fallback) uses an amplitude
  envelope of the decoded audio instead. "src":"mock" marks the canned mock
  line; "cmd" is a whale_cmd.py line or the WHALE_SAY_TEXT test trigger. A mock
  line never interrupts a playing line, a commanded one does (latest-wins).
- Server → python:

      {"type":"web_connected","count":N}

  The driver idles while count is 0 (nobody watching).

- v1 command frames (M3.1) — browser/CLI → server → python, relayed RAW (the
  server never parses frames):

      {"type":"motion","group":"Hammer","index":0}
      {"type":"expression","name":"爱心眼"}
      {"type":"say","text":"..."}
      {"type":"pose","p":{"ParamEyeBallX":0.8}}     ({} clears the overlay)
      {"type":"mode","mock":true|false}

  The driver executes say (TTS), pose (driver-side overlay, max 32 keys with
  ids ≤ 64 chars; values arrive inside normal motion frames), mode (mock/live
  flag) and forwards motion/expression to the browser, which runs them on the
  M2.1 hooks. A mode frame is sent on connect/reconnect and on real flips; the
  frontend resets the pose only when the mode actually changes. A pose {} also
  restores the dropped parameters to their defaults in the model.

## Configuration

- PORT / WS_PORT env vars (defaults 3000 / 3001).
- Frontend WS endpoint: append ?ws=ws://host:port to the page URL.
- Python endpoint: env WHALE_WS (default ws://localhost:3001?role=python).
- WHALE_DEBUG=1 enables per-frame python logging (off by default).
- TTS knobs: WHALE_VOICE, WHALE_SAY_VOICE, WHALE_ENGINE=say, WHALE_SAY_TEXT
  (see specs/dev-environment.md).
- WHALE_MODE=mock|live (default mock): commands work in both modes, live only
  pauses the mock talk bursts/canned speech; a mode command flips it at runtime.
  WHALE_CMD_WS overrides the CLI endpoint (WS_PORT is not 3001).

## Troubleshooting

- Port busy: PORT=3002 WS_PORT=3003 npm start, then open
  http://localhost:3002?ws=ws://localhost:3003 (python: WHALE_WS=...;
  CLI: WHALE_CMD_WS=ws://localhost:3003?role=web).
- Model not moving: open http://localhost:3000?debug=1 and check the status
  line + console; make sure the model was exported for Cubism SDK 4.x.
- CDN blocked: the page falls back to cdnjs for PixiJS; Cubism Core and the
  plugin load from live2d.com / jsdelivr. For fully offline use, vendor the
  three scripts locally (future milestone).
- Python 3.9 note: websockets resolves to 15.x (16+ needs Python 3.10+,
  17+ needs 3.11+). Newer Python recommended long-term: brew install python@3.12.
- Whale silent but moving: check the driver log for "say:" lines; if the page
  shows a "click to enable audio" pill, click it once (OBS Interact).
  WHALE_ENGINE=say forces the macOS fallback engine.
- Command has no effect: run the whale_cmd.py examples from whale-girl-server —
  "cannot reach the server" means npm start is not running; "unknown motion
  group" lists the available groups; ?debug=1 shows the last command + mode.

## Deployment patterns (M4.2)

- Same machine (DEFAULT for normal users): the quick start above IS the
  deployment — server + driver + browser/OBS all on one computer, zero SSH.
- Cloud server, no SSH knowledge: git pull + bash install-ubuntu.sh + systemd
  (ships in M4.2); manual steps runnable through the provider's web console;
  optional deploy.sh wrapper for operators who already use SSH.
- SSH port forwarding (OPTIONAL advanced mode): scripts/ubuntu-tunnel.sh for
  operators who prefer no open ports (ships in M4.2).
- Remaining work is configuration only — the one host dependency is the
  WebSocket origin guard (the page host must match the WS host; the nginx proxy
  must pass `proxy_set_header Host $host`).

## Milestones

- [x] M1 骨架与静音渲染: repo skeleton, WS proxy, mock driver, Live2D frontend + placeholder — closed 2026-10-19
- [x] M2 模型与口型同步: real model drop-in + TTS-driven lip sync (explicit words → speech → mouth animates to the words) — M2.1 closed 2026-10-20, M2.2 closed 2026-10-21
- [ ] M3 DSH 互动大脑: M3.1 command surface implemented (motion/say/pose/mode/expression, mock behind a flag); M3.2 expression presets pending
- [ ] M4 内存压榨与部署: <100MB OBS extra memory + deployment patterns (same-machine / cloud scripts / optional SSH tunnel)
