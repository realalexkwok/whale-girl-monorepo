# Whale Girl — Dev Environment (macOS runbook)

> Owner-approved record (2026-10-19, M1 session). The dev loop below is live and
> verified. The Ubuntu split (M4.2) consumes the "split checklist" at the end.

## Who runs what (the three roles)

| Role | What it is | Runs where (today) | How it starts |
| --- | --- | --- | --- |
| **server** | `server.js` — serves the page + relays frames/commands | Mac (same machine) | `npm start` (or `stack.sh start`) |
| **brain** | `control_whale.py` — computes the face 30×/s, TTS, commands | Mac (same machine) | `stack.sh start` (supervised) |
| **client** | the whale PAGE (PixiJS + Live2D) | a browser or the OBS Browser source | nothing to launch — open http://localhost:3000 (OBS: Browser source with that URL) |

The client side runs **no script and no executable**: it is a URL. The page is
downloaded from the server, renders with the browser's GPU, and connects back over
WebSocket to `ws://localhost:3001?role=web`. The server and the brain are two
programs on the SAME machine today (the "same-machine" pattern, the M4.2 default);
the split deployment only moves the server + brain to Ubuntu and points the page's
`?ws=` at it — the page itself never changes.

## The dev loop (verified at M1.5; one-command path added 2026-10-22)

- One-command (recommended): `bash scripts/stack.sh start` — starts the server AND
  the brain (`control_whale.py`, historically called the "driver"), keeps them alive
  (auto-restart), prints both pids; `stack.sh status | stop | logs`. The brain is a
  SEPARATE program: without it the page freezes on its last frame and commands are
  refused with "the server has no brain connected" (by design — the CLI refuses
  rather than pretending). The driver's own default is mock (canned rehearsal);
  `stack.sh` starts it in live mode unless `WHALE_MODE=mock` is set — live keeps her
  silent unless commanded.
- Manual two-terminal path:
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

## Notifier hub (M5.1 — attach · name · round-finished)

The whale announces a finished agent round: **主人，<会话名>有任务完成啦** (the
name is spoken verbatim).

- The hub starts with the server (`hub.js`) on loopback only:
  `http://127.0.0.1:3200` — `/mcp` (MCP streamable HTTP: whale_attach /
  whale_detach / whale_sessions), `/notify` (lifecycle hooks), `/health`.
  Registry: `whale-girl-server/data/registry.json` (gitignored, 24 h TTL).
- Install the DSH notifier bundle (NO hand-written profile patch): the
  package is `whale-girl-server/notifier` (`dsh.bundle` + `cordis.patch.yml`,
  two rows — the lifecycle hook and an MCP client for the hub). Pick one:
  - DSH Web → Plugins → install the bundle from the absolute path to
    `whale-girl-server/notifier` (installing enables it; restart DSH or let the
    profile recompose);
  - from an agent session (danger-full-access / approval):
    `plugin_manager install_bundle { "target": "<absolute path to whale-girl-server/notifier>" }`;
  - CLI: `dsh plugin --profile <name> add <absolute path>`, then enable the
    bundle in the Plugins page. For a checkout you keep updating, install with
    `link:` rather than `file:` (pnpm COPIES a file: dependency, so a later
    git pull never reaches the profile — the 2026-10-24 web/TUI "stuck" bug):

        cd ~/.dsh/profiles/<name>
        pnpm remove whale-girl-dsh-notifier
        pnpm add "link:/abs/path/to/whale-girl-server/notifier"

    Restart DSH afterwards; neither a restart nor a pull hot-swaps a module that
    is already loaded in a running process.
  The bundle's MCP client registers the hub's tools in every session as
  `mcp__whale__whale_attach`, `mcp__whale__whale_detach`,
  `mcp__whale__whale_sessions`. Alternatively mount the hub per session via
  ACP `session/new` `mcpServers` (unprefixed tool names):

      {"whale-girl": {"url": "http://127.0.0.1:3200/mcp"}}

- Attach — AUTOMATIC since the 2026-10-24 usability revision: the plugin
  auto-attaches every top-level session on `session/created` (name = the DSH
  session title when set — your own rename wins — else the working-directory
  basename — the folded title is read from the session log at attach, so a
  rename made before the process started still counts; a `session/title` event
  re-registers the session; a stale folder name the plugin itself attached is
  upgraded to the title, while a name set with `whale_attach` is never
  overwritten; subagent children skipped), so users never need a session id. The plugin logs `[whale-notifier] auto-attach "<name>" (…, title|folder)`
  to the DSH process log; the hub side of the same decision is the
  `[notifier] attach "<name>"` line in `journalctl -u whale-girl`. Rename explicitly if you like (latest-wins):
  `whale_attach {session_id: "<$DSH_SESSION_ID>", name: "构建会话"}`; mute a
  session with `whale_detach`. `config.autoAttach: false` on the notifier row
  restores explicit-only attach.

- Round-finished hook — the bundle's `whale-notifier` row (in
  `whale-girl-server/notifier/index.mjs`). It subscribes `session/event`
  (turn/end, every TurnEndReason; goal/change suppresses goal auto-continuation
  rounds), `agent/status` (idle fallback, deduped 2 s) and `session/disposed`
  (detaches), posting fire-and-forget to `/notify`. Why a plugin and not an
  external SDK watcher: each DSH session runs in its own process, and the SDK's
  session.event push only covers the runtime an SDK client spawns — verified in
  the harness protocol types 2026-10-24. The bundle is the user-facing
  distribution: no YAML is edited by hand.
- Verify automatically (boots its own server + driver; 20 checks):

      cd whale-girl-server && node scripts/notify_probe.js

- Env knobs: `WHALE_MCP_HOST` (default 127.0.0.1), `WHALE_MCP_PORT`
  (default 3200), `WHALE_REGISTRY_FILE`, `WHALE_SESS_TTL` (seconds, default
  86400), and the plugin's `config.hub`.
- Host note: the hub is loopback-only on the machine that runs the whale
  stack. DSH must run on THAT machine, or reach the hub through a tunnel:
  patterns 2/3 put the stack on the Ubuntu box, so run DSH there too; if DSH
  also runs on the Mac, add `-L 3200:127.0.0.1:3200` to the ssh forward and
  install the bundle on the Mac profile as well (the default hub URL then goes
  through the tunnel). The whale PAGE may live anywhere — a Mac browser/OBS
  reaching the page through the existing 3000/3001 tunnel is simply a web
  client of the box server, fetches /audio through the same tunnel, and plays
  the announcements normally.

## Memory gate (M4.1 — OBS browser source)

- Definition: steady-state EXTRA memory = the ps RSS sum of OBS's CEF helpers
  ("OBS Helper …", Renderer/GPU/utility) with the whale Browser source VISIBLE and
  scripted traffic, minus the same processes with the source HIDDEN and unloaded.
  Read over the last 10 min of each 30-min phase (the page's first-load decay spans
  > 10 min, so the full-phase mean is reported but not gated).
- Gate: **< 180 MB** (owner amendment 2026-10-22, measured 163.5 MB; the original
  2026-10-20 figure was < 100 MB), plus the stability rule: no monotonic growth
  (a leak fails even under the threshold).
- Prerequisites: OBS 32.2 running with the whale Browser source
  (http://localhost:3000/?debug=1); the built-in obs-websocket server enabled
  (Tools → WebSocket Server Settings; localhost :4455 with auth) so the scripts can
  toggle the source; the source property "Shutdown source when not visible" ON —
  scripts/obs_toggle.js shutdown-on-hide sets it through the websocket.
- Run (the stack must be up: npm start + control_whale.py):

      cd whale-girl-server
      node scripts/obs_toggle.js info          # scene/item state (strict: exit 3 if missing)
      node scripts/obs_toggle.js on            # Phase A: page visible
      bash scripts/traffic_mix.sh --minutes 30 --interval 30 --verbose &
      bash scripts/mem_probe.sh --phase a --minutes 30 --label final-a
      node scripts/obs_toggle.js off           # hide → page unloads (Phase B)
      bash scripts/mem_probe.sh --phase b --minutes 30 --label final-b
      bash scripts/mem_probe.sh --compare \
        "$(ls -t logs/mem-*-final-a.csv | head -1)" \
        "$(ls -t logs/mem-*-final-b.csv | head -1)" --steady

- CPU/GPU profile: node scripts/perf_probe.js --seconds 60 --rss-minutes 10 (it
  boots its own server + Chrome + driver — stop the dev stack first; the RSS soak
  reports min/mean/max for the server and driver).
- Gotcha: short A/B windows cannot resolve lever effects (< ~10 MB) because the
  page's RSS decays for ~20 min after every reload — use the full 30-min phases and
  the --steady reading for the gate, and treat 3-min windows as sanity checks only.

## Deployment patterns (M4.2 — shipped 2026-10-23; config only, no code rewrite)

> Origin note: the WS origin guard compares the page's Origin host with the WS
> host, so a split-host setup (the page served from one hostname and ?ws=
> pointing at another) is rejected with 1008. Keep them on the same hostname, or
> make the nginx proxy pass the page's Host (proxy_set_header Host $host).


### Pattern 1 — same machine (DEFAULT for normal users; zero SSH)
The dev loop above IS the deployment: npm start + driver + browser/OBS, all on
localhost. Nothing else to configure.

### Pattern 2 — cloud server via git + install script (no SSH knowledge required)
1. On the server (provider web console or any shell):

       # until M4.2 is merged (and the branch deleted): add -b feature/whale-girl-m42-deployment
       git clone https://github.com/realalexkwok/whale-girl-monorepo.git
       cd whale-girl-monorepo/whale-girl-server
       sudo bash scripts/install-ubuntu.sh <domain>   # --no-domain: self-signed TLS

2. install-ubuntu.sh (shipped, idempotent — re-run after git pull) does: apt deps
   (nodejs >= 18 + npm, python3 >= 3.9, nginx, certbot), npm ci, the venv + pip
   install, two systemd units (whale-girl server — loopback-only unless --allow-lan /
   WHALE_ALLOW_LAN=1 — and whale-girl-brain driver, Restart=always + journald), and
   an nginx TLS site: HTTP -> node :3000 (express static + /audio) and /ws -> node
   :3001 (upgraded, with proxy_set_header Host $host); the ACME challenge is served
   from /var/www/whale-girl-acme (0755) so www-data can read it; certbot ACME with a
   domain, self-signed fallback without one, and the domain is remembered in
   /etc/whale-girl/domain so a re-run without the argument keeps Let's Encrypt TLS.
   `bash scripts/install-ubuntu.sh --check` is the no-root dry-run (validates
   paths/config and renders both units + the site). The Mac browser source then
   points at https://<domain>/?ws=wss://<domain>/ws (?ws= is required — the frontend
   default is ws://localhost:3001). Switching back to self-signed: --no-domain (or
   rm /etc/whale-girl/domain).
3. Optional for operators who already use SSH: scripts/deploy-ubuntu.sh wraps
   rsync + the remote install (--dry-run supported) — a convenience, never a
   requirement.
4. LAN alternative: install with --allow-lan (the server socket is loopback-only by
   default), firewall-allow 3000/tcp + 3001/tcp and use
   http://<server-ip>:3000?ws=ws://<server-ip>:3001.

### Pattern 3 — SSH port forwarding (OPTIONAL advanced mode)
For operators who prefer no open ports: whale-girl-server/scripts/ubuntu-tunnel.sh
runs ssh -N -L 3000:localhost:3000 -L 3001:localhost:3001 user@<server-ip> on the Mac
(--dry-run prints the command and checks the local ports; local 3000/3001 must be
free); the browser source keeps pointing at http://localhost:3000 unchanged. Page +
WS come from the box, so the pattern-2 model upload applies.

### Brain placement in patterns 2 and 3 (corrected 2026-10-23)
The brain runs on the server box — the say-audio contract makes it mandatory for
speech: a say frame carries "/audio/<file>", the browser fetches it from the page
origin, so the audio files must live next to the server. install-ubuntu.sh ships
whale-girl-brain.service (WHALE_MODE=live, WHALE_WS=ws://127.0.0.1:<WS_PORT>?role=python).
Running the driver on the Mac stays supported for dev and motion-only setups
(WHALE_WS=wss://<domain>/ws?role=python through nginx, or ws://localhost:3001?role=python
through the tunnel — a direct ws://<server-ip>:3001 is loopback-blocked by the unit) —
speech is silent in that mode because the audio request 404s at the page origin.
The brain unit uses Restart=always: the driver exits 0 when a newer instance
displaces it (4001), and on-failure would leave the box brain dead.

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
- #6 (2026-10-23, M4.2): in the split patterns the brain runs on the server host —
  say audio is page-relative, so the files must live next to the server;
  whale-girl-brain.service ships with install-ubuntu.sh. Driver-on-Mac remains
  supported for dev/motion-only (speech silent).
- #7 (2026-10-23, M4.2 review): the server unit is loopback-only
  (IPAddressAllow=localhost) — nginx + SSH tunnels reach it, raw :3000/:3001 are not
  exposed; --allow-lan (or WHALE_ALLOW_LAN=1) restores the LAN-direct pattern. The brain
  unit is Restart=always because a displaced driver exits 0. Review round 2: npm is
  installed only when absent (NodeSource's nodejs provides npm and Conflicts: npm); ufw
  runs before certbot; the last nginx-accepted site is kept as .prev.
