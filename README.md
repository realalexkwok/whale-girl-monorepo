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

One command (recommended) — starts the server AND the driver, keeps both alive:

    cd whale-girl-server
    bash scripts/stack.sh start     # status | stop | logs also work

The whale needs TWO programs: the **server** (`npm start` — it only forwards
messages) and the **brain** (`control_whale.py` — the Python program that computes
the eyes/mouth/head 30 times per second and decides when she breathes and speaks;
older docs call it the "driver"). Without the brain the page freezes on its last
frame and commands are refused with "the server has no brain connected" — that is
the safety working, not a bug. `stack.sh` supervises both and restarts either half
if it exits. The driver's own default is **mock** (the brain rehearses canned
Chinese lines by itself); `stack.sh` starts it in **live** mode — silent unless a
command tells her to speak — and `WHALE_MODE=mock bash scripts/stack.sh start`
brings the rehearsal back.

Manual two-terminal path:

Terminal 1 — server:

    cd whale-girl-server
    npm install
    npm start

Terminal 2 — driver (commands work in both modes; WHALE_MODE=live pauses the mock speech):

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
fallback. In mock mode a random canned Chinese phrase is spoken at most once
per talk burst (the hold window and the in-flight drop may skip one); in live
mode a DSH session supplies the text (see Commands below). A
line plays to its end: the mock never interrupts it, while a newer command line
replaces it (latest-wins). See specs/dev-environment.md for the env knobs and
the say probe.

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
    .venv/bin/python scripts/whale_cmd.py express happy 今天特别开心     # emotion -> preset

WHALE_MODE=mock|live sets the boot mode (default mock). In live mode the mock
talk bursts and canned phrases pause while the idle blink/gaze/sway keep going;
the mouth priority is say > motion-frame mouth > mock envelope (commanded
motions never pause the mock; expressions drive the face and coexist with
speech). `express <tag>` routes a coarse emotion tag
(happy/sad/angry/surprised/confused/love/neutral) through expr_tags.py to a
preset; same-tag repeats inside the cooldown are skipped and the face returns to
neutral after the idle window. Motion names are validated
against the model manifest, so a typo prints the available groups. ?debug=1
shows the mode and the last motion/expression/mode command (the pose overlay is
driver-side and not shown; during a say the line shows the current word).

## AI-agent progress notifier (M5.1)

Attach a DSH session to the whale girl and she announces when a round finishes:
**主人，<会话名>有任务完成啦** (the name is spoken verbatim, never translated).
When the agent asks you a question (`ask_user_question`), she says
**主人，<会话名>有问题需要你回答** instead.

The **hub** starts with the server (no extra command) and listens on loopback only:
`http://127.0.0.1:3200` — `/mcp` (MCP streamable HTTP), `/notify` (lifecycle hooks),
`/health`. It keeps the session registry in memory and in
`whale-girl-server/data/registry.json` (gitignored, 24 h TTL).

    # MCP tools (installed with the bundle; names carry its serverName "whale"):
    mcp__whale__whale_attach    {session_id, name}   # session_id = $DSH_SESSION_ID
    mcp__whale__whale_detach    {session_id}         # announcements stop
    mcp__whale__whale_sessions                       # list attachments

The DSH side ships as an **installable bundle** — no profile YAML is edited by
hand. Install `whale-girl-server/notifier` once (DSH Web → Plugins → install the
absolute path, or `plugin_manager install_bundle`, or `dsh plugin ... add`);
its two rows are the in-process lifecycle hook and an MCP client for the hub.
The hook **auto-attaches every top-level session** — no ids, no tool call — and
speaks its **DSH session title** (the automatic title or the name you gave it
by renaming the session; the working-directory name is the fallback). It posts
fire-and-forget to `/notify` on turn/end, dedupes the agent-idle fallback,
stays silent during goal auto-continuation rounds, and detaches on session
disposal. A pending question speaks its own line (`kind:"question"` on
`/notify`). Rename with `mcp__whale__whale_attach`, mute with
`mcp__whale__whale_detach`; config `autoAttach: false` restores explicit-only
attach. The hub only announces ATTACHED sessions and drops everything
it cannot speak; nothing blocks the agent. A per-session ACP mount
(`{"whale-girl":{"url":"http://127.0.0.1:3200/mcp"}}`) still works and gives the
unprefixed tool names.

Verify the whole path automatically (boots its own server + driver):

    cd whale-girl-server && node scripts/notify_probe.js

## Memory gate (M4.1)

The OBS Browser source has a hard steady-state extra-memory gate: **< 180 MB**
(owner amendment 2026-10-22; measured 163.5 MB — the original < 100 MB figure was
set before the measurement). It is measured as the ps RSS delta of OBS's CEF helper
processes between the source visible + scripted traffic and the source hidden and
unloaded, read over the last 10 minutes of each 30-minute phase, with a
no-monotonic-growth rule so a leak fails even under the threshold. Tools:

    whale-girl-server/scripts/mem_probe.sh    # phase sampler + --compare --steady
    whale-girl-server/scripts/traffic_mix.sh  # scripted say/motion/expression traffic
    whale-girl-server/scripts/obs_toggle.js   # obs-websocket source toggle
    whale-girl-server/scripts/perf_probe.js   # fps / frame-time / heap / RSS profile

See specs/dev-environment.md for the full protocol, prerequisites and gotchas.

## Wire protocol (v0 + v1 commands)

- Python connects to ws://localhost:3001?role=python (one writer at a time;
  a second instance replaces the first).
- Browser and the CLI tool connect to ws://localhost:3001?role=web (many
  allowed); the server relays their command frames to the python writer raw.
  Browser pages are accepted only when the page origin host matches the
  WebSocket host — a best-effort same-origin guard (DNS rebinding and
  non-browser clients are not covered; auth is V3 work).
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
      {"type":"expression","name":"爱心眼"}            (name:"" = reset the face)
      {"type":"expression","tag":"happy","text":"..."}  (M3.2: the driver resolves it)
      {"type":"say","text":"..."}
      {"type":"pose","p":{"ParamEyeBallX":0.8}}     ({} clears the overlay)
      {"type":"mode","mock":true|false}

  The driver executes say (TTS), pose (driver-side overlay, max 32 keys with
  ids matching [A-Za-z0-9_]{1,64}; values arrive inside normal motion frames),
  mode (mock/live flag) and forwards motion/expression to the browser, which
  runs them on the M2.1 hooks. A mode frame is sent on connect/reconnect and on real flips; the
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
  WHALE_CMD_WS overrides the CLI endpoint (needed when WS_PORT is not 3001);
  WHALE_MODEL_MANIFEST points the CLI's motion-name validation at another
  manifest (split deployments).
- Expression knobs: WHALE_EXPR_TAGS (JSON tag -> preset merge; the neutral tag
  always resets, so a non-empty neutral override is ignored with a warning),
  WHALE_EXPR_COOLDOWN (default 4 s), WHALE_EXPR_IDLE (default 30 s).

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
- Whale silent but moving: check the driver log for "say:" lines; any click on
  the page arms the audio (the "click to enable audio" pill, bottom-right, is the
  fallback — click it once, in OBS via Interact). WHALE_ENGINE=say forces the
  macOS fallback engine.
- Page shows `ws disconnected (1008)`: the page's host does not match the
  WebSocket host (origin guard). Serve the page and the WS from the same
  hostname (localhost and 127.0.0.1 are both accepted), or point `?ws=` at the
  same host as the page.
- Deployed page shows the placeholder whale: the model asset is gitignored — copy
  whale-girl-frontend/model/ to the server once (see Deployment below).
- Deployed page or speech broken: check the certificate and the HTTP->HTTPS redirect,
  then `sudo journalctl -u whale-girl -f` and `sudo journalctl -u whale-girl-brain -f`.
- Certificate warning in the browser: the install ran without a domain (self-signed) —
  re-run `sudo bash scripts/install-ubuntu.sh <domain>` with a domain pointing at the box.
- Command has no effect: run the whale_cmd.py examples from whale-girl-server —
  "cannot reach the server" means npm start is not running; "unknown motion
  group" lists the available groups; ?debug=1 shows the last command + mode.

## Deployment for general users (M4.2)

Three patterns, easiest first. Pattern 1 is the default; pattern 2 keeps the stream
running while your Mac sleeps; pattern 3 is for operators who prefer no open ports.

### Pattern 1 — same machine (DEFAULT, zero SSH)
The quick start above IS the deployment: server + brain + browser/OBS on one computer.
Nothing else to configure.

### Pattern 2 — cloud server (no SSH knowledge needed)
On a fresh Ubuntu 24.04 VM, in the provider's web console (until M4.2 is merged to main, add
`-b feature/whale-girl-m42-deployment` to the clone):

    git clone https://github.com/realalexkwok/whale-girl-monorepo.git
    cd whale-girl-monorepo/whale-girl-server
    sudo bash scripts/install-ubuntu.sh whale.example.com   # your domain, A record -> the VM

Open **80/tcp and 443/tcp in the provider firewall** before this step (certbot needs port 80
to validate the domain). `install-ubuntu.sh` installs the system packages (including nodejs
and npm), both systemd units (server + brain), the venv, and an nginx TLS site; certbot
obtains the certificate. It is idempotent — after `git pull`, run it again; it remembers the
domain, so a re-run without the argument keeps Let's Encrypt TLS. Run with `--no-domain`
(or `rm /etc/whale-girl/domain`) to switch back to a self-signed certificate (browsers will
warn; the wss probe rejects it). Then in OBS on the Mac:

    https://whale.example.com/?ws=wss://whale.example.com/ws

**The `?ws=` override is required** in a split: without it the page connects to
`ws://localhost:3001` (the dev default), i.e. the Mac's own localhost, not the server. The
page and the WebSocket must share one hostname (the origin guard rejects a mismatch with
close code 1008); nginx passes the page's Host, so that part is handled.

The brain runs on the server box by design: a speech line's audio file is fetched from the
page origin, so it must live next to the server (`whale-girl-brain.service`). You can stop
that unit and run the driver on the Mac for a motion-only setup — speech would be silent.

The whale model asset is not in git (4.3 MB, licensed). Copy it once — the page shows the
placeholder until then:

    rsync -az whale-girl-frontend/model/ you@whale.example.com:whale-girl-monorepo/whale-girl-frontend/model/

(adjust the remote path to wherever the repo was cloned; the deploy wrapper below copies the
model automatically).

Logs: `sudo journalctl -u whale-girl -f` (server), `sudo journalctl -u whale-girl-brain -f`
(brain). Operators who already use SSH can run
`bash whale-girl-server/scripts/deploy-ubuntu.sh user@host` from the repo root instead of
hand-syncing (rsync + the remote install; optional, never required). LAN alternative:
install with `--allow-lan` (the server socket is loopback-only by default), open
3000/tcp + 3001/tcp, and use `http://<server-ip>:3000?ws=ws://<server-ip>:3001`.

### Pattern 3 — SSH port forwarding (OPTIONAL advanced mode)
The page and the WS proxy stay on localhost through a tunnel; no ports are opened:

    cd whale-girl-server && bash scripts/ubuntu-tunnel.sh ubuntu@whale.example.com

Leave it running (Ctrl-C closes it); the browser source keeps pointing at
http://localhost:3000 with no `?ws=` needed. The brain still runs on the server box (for
speech), and the model upload from pattern 2 applies.

### Security notes
- The server unit binds loopback only (`IPAddressAllow=localhost`): nginx and SSH tunnels
  reach it, but the raw :3000/:3001 sockets are not exposed. `--allow-lan` (or
  `WHALE_ALLOW_LAN=1`) at install time disables that for the LAN-direct pattern.
- Both units run as root (systemd default) — accepted for a home box; use a dedicated
  `User=` if you need stronger isolation.
- The WS origin guard rejects browser origins that do not match the page host (close 1008);
  the CLI and probes send no Origin. There is no auth token yet (V3 work).

### Splitting — configuration only
No runtime code path changes in a split: the `?ws=` override, `PORT`/`WS_PORT`, `WHALE_WS`
and `WHALE_MODE` knobs already exist. The one host dependency is the WebSocket origin
guard — page and WS on the same hostname, nginx passing `proxy_set_header Host $host`.

## Milestones

- [x] M1 骨架与静音渲染: repo skeleton, WS proxy, mock driver, Live2D frontend + placeholder — closed 2026-10-19
- [x] M2 模型与口型同步: real model drop-in + TTS-driven lip sync (explicit words → speech → mouth animates to the words) — M2.1 closed 2026-10-20, M2.2 closed 2026-10-21
- [x] M3 DSH 互动大脑: M3.1 command surface (motion/say/pose/mode/expression, mock behind a flag) — closed 2026-10-22; M3.2 LLM-driven expressions — closed 2026-10-22
- [x] M4 内存压榨与部署: <180MB steady-state OBS extra memory (gate amended 2026-10-22; originally <100MB) + deployment patterns (same-machine / cloud scripts / optional SSH tunnel) — M4.1 closed 2026-10-23, M4.2 closed 2026-10-23
- [ ] M5 AI agent progress notifier: M5.1 session integration (attach/detach + naming + round-finished announcement) — implementation in progress
