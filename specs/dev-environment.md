# Whale Girl — Dev Environment (macOS runbook)

> Owner-approved record (2026-10-19, M1 session). The dev loop below is live and
> verified. The Ubuntu split (M4.2) consumes the "split checklist" at the end.

## The dev loop (verified at M1.5)
- Terminal 1 — server:

      cd whale-girl-server && npm install && npm start

- Terminal 2 — mock driver (venv already provisioned):

      cd whale-girl-server && .venv/bin/python control_whale.py

- Browser: open http://localhost:3000 (append ?debug=1 for the status line).
- OBS: Sources → + → Browser; URL http://localhost:3000; size 1920x1080; the page is
  transparent already (backgroundAlpha 0) — no custom CSS needed.
- Probes (automatic half):

      node scripts/ws_probe.js        # expect PASS: 20–40 fps, increasing frame counter
      node scripts/ws_role_probe.js   # expect close code 1008

- Smoke checks:

      curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/   # 200
      lsof -nP -iTCP:3000 -iTCP:3001 -sTCP:LISTEN                     # port conflicts
      ps -axo pid,rss,command | grep -E 'node server.js|control_whale.py'   # RSS budget

## Environment facts (measured 2026-10-19)
- Node v25.2.0, npm 10.5.2 (whale-girl-server/node_modules installed, express 4.x + ws 8.x).
- Python 3.9.10 (macOS system framework build); whale-girl-server/.venv contains
  websockets 15.0.1 — the newest release supporting 3.9 (16.0 needs 3.10+, 17.x needs
  3.11+). Long-term: brew install python@3.12, then recreate the venv.
- Ports 3000 (HTTP) / 3001 (WS), env-overridable: PORT, WS_PORT, WHALE_WS.
- CDN access is required by the frontend (PixiJS jsdelivr + cdnjs fallback, Cubism Core
  from live2d.com, plugin from jsdelivr) — all URLs pinned in tech-stack.md and verified
  200 on 2026-10-19. Offline vendoring is a later milestone.

## Model assets
- whale-girl-frontend/model/whale.model3.json + siblings (moc3, textures, physics,
  motions, expressions) — Cubism 4.x export; see whale-girl-frontend/model/README.md.
- The folder is gitignored (large, licensed); only its README is tracked.
- No asset → the frontend renders the placeholder whale and logs ONE console error.

## TTS lip sync (M2.2)
- The driver speaks explicitly specified words: edge-tts (free Microsoft neural
  voices + word timestamps) is the primary engine; macOS "say" is the automatic
  fallback when edge-tts fails (no timestamps → the frontend uses an amplitude
  envelope of the decoded audio instead of the word timeline).
- New pip dep: edge-tts==7.3.1 (installed in whale-girl-server/.venv; reinstall
  with .venv/bin/pip install -r requirements.txt).
- Speech files: whale-girl-server/audio/ (gitignored; the driver prunes files
  older than 1 h) served by the server at /audio/<file>.
- edge-tts runs in a short-lived helper process (scripts/tts_synth.py) so the
  long-running driver stays under its 30 MB RSS budget.
- Env knobs:

      WHALE_VOICE        edge-tts voice              (default zh-CN-XiaoyiNeural)
      WHALE_SAY_VOICE    macOS say voice fallback    (default Tingting)
      WHALE_ENGINE=say   force the fallback engine   (probe / manual test)
      WHALE_SAY_TEXT     speak this text once at startup, then keep the mock cadence

- In mock mode the driver speaks a random canned Chinese phrase at most once
  per talk burst (the hold window and the in-flight drop may skip a burst, and
  it never plays over a line); a DSH session supplies real text via
  whale_cmd.py say (M3.1). A say
  frame wins over the mock mouth (priority rule); without a say the mock talk
  envelope animates as before.
- Verify (each pass boots server + Chrome + driver itself — stop the running
  server first):

      cd whale-girl-server
      node scripts/say_probe.js              # edge-tts pass
      node scripts/say_probe.js --engine=say # macOS say / amplitude pass

- OBS: the Browser source plays the page audio through OBS. Any click on the
  page arms the audio (the AudioContext is created/resumed inside the gesture),
  so a refresh + one click + a say plays without the pill. If autoplay still
  blocks it (e.g. OBS with no interaction), a small "click to enable audio" pill
  appears bottom-right — click it once via OBS Interact; it hides when audio
  runs.

## DSH command surface (M3.1)
- A DSH session (Web or TUI) calls the native tool
  whale-girl-server/scripts/whale_cmd.py with the venv python:

      cd whale-girl-server
      .venv/bin/python scripts/whale_cmd.py motion Hammer [index]
      .venv/bin/python scripts/whale_cmd.py say 你好，我是鲸鱼娘
      .venv/bin/python scripts/whale_cmd.py pose '{"ParamEyeLOpen":0,"ParamEyeROpen":0}'
      .venv/bin/python scripts/whale_cmd.py mode live|mock

- The tool connects to ws://localhost:3001?role=web (env WHALE_CMD_WS), sends one
  frame, waits briefly for a 4002 "no writer" close, then exits. The server
  relays it raw to the driver; the driver executes say/pose/mode and forwards
  motion/expression to the browser (M2.1 hooks).
- Motion groups are validated against whale-girl-frontend/model/whale.model3.json
  (env WHALE_MODEL_MANIFEST; absent in a split deployment → warn + send anyway).
  The tool names a DSH/MCP wrapper uses map to the subcommands: whale_motion →
  motion, whale_say → say, whale_pose → pose, whale_mode → mode,
  whale_express → express (M3.2).
  Exit codes: 0 sent (not acknowledged — the server may drop the frame on its
  python-buffer cap), 1 server unreachable OR reachable with no driver (4002),
  2 validation error.
- Expressions (M3.2): the model classifies the text inline and calls
  `scripts/whale_cmd.py express <tag> [text...]` with happy / sad / angry /
  surprised / confused / love / neutral; the driver maps the tag through
  expr_tags.py (WHALE_EXPR_TAGS JSON override; neutral always resets — a
  non-empty neutral override is ignored with a warning) to a preset. The CLI validates
  the tag first (exit 2 + the tag list); a raw unknown tag reaching the driver
  falls back to neutral. Set WHALE_EXPR_TAGS in BOTH the driver and the CLI
  environment. Same-tag repeats inside WHALE_EXPR_COOLDOWN (default 4 s) are
  skipped; with no express command for WHALE_EXPR_IDLE (default 30 s) the face
  returns to neutral.
- Mock vs live: WHALE_MODE=mock (default) keeps the canned talk bursts; live
  pauses them and hands the mouth to explicit commands. Commands work in both
  modes; a mode command flips at runtime (an idempotent one does nothing) and a
  real flip clears the pose overlay. ?debug=1 shows the mode and the last
  motion/expression/mode command (say and pose do not set it).
- Limits: the CLI pre-checks its own frame at 8 KB (exit 2); the server drops
  web frames over 8 KB; the driver enforces semantic caps — say text ≤ 300
  chars, pose ≤ 32 keys with ids matching [A-Za-z0-9_]{1,64} and finite numbers,
  motion group ≤ 128 chars, index ≤ 9999 — and logs rejects at most once a
  second.
  With no driver connected the server closes the command socket with 4002 and
  whale_cmd.py exits 1 ("no brain connected").
- Verify (each pass boots server + Chrome + driver itself — stop the running
  server first):

      cd whale-girl-server
      node scripts/cmd_probe.js     # every frame type + malformed safety (prints its count)
      node scripts/expr_probe.js    # M3.2 per-tag expression routing

## Deployment patterns (M4.2 consumes this — config only, no code rewrite)

> Origin note: the WS origin guard compares the page's Origin host with the WS
> host, so a split-host setup (the page served from one hostname and ?ws=
> pointing at another) is rejected with 1008. Keep them on the same hostname, or
> make the nginx proxy pass the page's Host (proxy_set_header Host $host).


### Pattern 1 — same machine (DEFAULT for normal users; zero SSH)
The dev loop above IS the deployment: npm start + driver + browser/OBS, all on
localhost. Nothing else to configure.

### Pattern 2 — cloud server via git + install script (no SSH knowledge required)
1. On the server (provider web console or any shell):

       git clone https://github.com/realalexkwok/whale-girl-monorepo.git
       cd whale-girl-monorepo/whale-girl-server && bash install-ubuntu.sh
       sudo systemctl enable --now whale-girl

2. install-ubuntu.sh (ships in M4.2) does: apt deps (nodejs ≥18, python3 ≥3.9),
   npm install, the venv + pip install, a systemd unit, and an nginx TLS snippet
   serving the frontend at https://<server>/ with the WS upgraded at /ws; the Mac
   browser source then points at https://<server>/?ws=wss://<server>/ws.
3. Optional for operators who already use SSH: scripts/deploy-ubuntu.sh wraps
   scp/rsync + remote commands — a convenience, never a requirement.
4. LAN alternative: firewall-allow 3000/tcp + 3001/tcp and use
   http://<server-ip>:3000?ws=ws://<server-ip>:3001.

### Pattern 3 — SSH port forwarding (OPTIONAL advanced mode)
For operators who prefer no open ports: scripts/ubuntu-tunnel.sh (ships in M4.2)
runs ssh -N -L 3000:localhost:3000 -L 3001:localhost:3001 user@<server-ip> on the
Mac; the browser source keeps pointing at http://localhost:3000 unchanged.

### Driver placement in patterns 2 and 3
WHALE_WS=ws://<server-ip>:3001?role=python (direct/TLS) or
WHALE_WS=ws://localhost:3001?role=python (through the tunnel); the driver may keep
running on the Mac or move to Ubuntu — both work by design.

## Decision log
- #1 (2026-10-19): two processes on two ports (express :3000, ws :3001) instead of one
  upgraded server — simpler separation for the later split.
- #2 (2026-10-19): raw-text proxy passthrough — the server never parses frames.
- #3 (2026-10-19): venv inside whale-girl-server/.venv (gitignored) rather than
  system-site pip — reproducible and split-ready.
- #4 (2026-10-20, amended same day): SSH port forwarding is an OPTIONAL advanced
  mode, not a requirement — the general-user baselines are same-machine localhost
  and a scripted/manual cloud deploy (no SSH knowledge).
- #5 (2026-10-20, replanned): lip sync is TTS-DRIVEN — explicit text is synthesized
  by edge-tts (word timestamps; macOS say fallback) and the frontend plays the
  audio via Web Audio while driving the mouth from the word timeline; no loopback
  device involved.
