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

    [ Python driver ] -- ws://:3001?role=python --> [ Node server.js ]
    control_whale.py    (30 FPS mock params)       express :3000 (static)
                                                   ws      :3001 (proxy)
    [ OBS Browser source ] <-- http://:3000 -- [ index.html: PixiJS 7 + Live2D ]

## Quick start (macOS, dev)

Terminal 1 — server:

    cd whale-girl-server
    npm install
    npm start

Terminal 2 — mock motion driver:

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

## Wire protocol (v0)

- Python connects to ws://localhost:3001?role=python (one writer at a time;
  a second instance replaces the first).
- Browser connects to ws://localhost:3001?role=web (many allowed).
- Python → server → browser:

      {"type":"motion","f":12345,"p":{"ParamMouthOpenY":0.42,"ParamEyeBallX":-0.1}}

  f = monotonic frame counter; p = raw Live2D parameter values (unclamped —
  some Live2D params are degrees, e.g. body angles).
- Server → python:

      {"type":"web_connected","count":N}

  The driver idles while count is 0 (nobody watching).

## Configuration

- PORT / WS_PORT env vars (defaults 3000 / 3001).
- Frontend WS endpoint: append ?ws=ws://host:port to the page URL.
- Python endpoint: env WHALE_WS (default ws://localhost:3001?role=python).
- WHALE_DEBUG=1 enables per-frame python logging (off by default).

## Troubleshooting

- Port busy: PORT=3002 WS_PORT=3003 npm start, then open
  http://localhost:3002?ws=ws://localhost:3003 (python: WHALE_WS=...).
- Model not moving: open http://localhost:3000?debug=1 and check the status
  line + console; make sure the model was exported for Cubism SDK 4.x.
- CDN blocked: the page falls back to cdnjs for PixiJS; Cubism Core and the
  plugin load from live2d.com / jsdelivr. For fully offline use, vendor the
  three scripts locally (future milestone).
- Python 3.9 note: websockets resolves to 15.x (16+ needs Python 3.10+,
  17+ needs 3.11+). Newer Python recommended long-term: brew install python@3.12.

## Deployment patterns (M4.2)

- Same machine (DEFAULT for normal users): the quick start above IS the
  deployment — server + driver + browser/OBS all on one computer, zero SSH.
- Cloud server, no SSH knowledge: git pull + bash install-ubuntu.sh + systemd
  (ships in M4.2); manual steps runnable through the provider's web console;
  optional deploy.sh wrapper for operators who already use SSH.
- SSH port forwarding (OPTIONAL advanced mode): scripts/ubuntu-tunnel.sh for
  operators who prefer no open ports (ships in M4.2).
- Remaining work is configuration only — no code path assumes localhost.

## Milestones

- [x] M1 骨架与静音渲染: repo skeleton, WS proxy, mock driver, Live2D frontend + placeholder
- [ ] M2 模型与口型同步: real model drop-in + system-audio (loopback) RMS lip sync
- [ ] M3 DSH 互动大脑: AI-driven parameters + expression presets (mock behind a flag)
- [ ] M4 内存压榨与部署: <100MB OBS extra memory + deployment patterns (same-machine / cloud scripts / optional SSH tunnel)
