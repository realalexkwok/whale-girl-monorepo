# M4.2 — Deployment for General Users — Plan

> Approved 2026-10-23 (the grouped round's Recommended options). Status: implementation —
> see validation.md for the evidence.

## Task groups
1. **Spec trio + branch** — this folder + `feature/whale-girl-m42-deployment`.
   Check: trio exists; `git status` shows only new files.
2. **whale-girl-server/scripts/install-ubuntu.sh** — idempotent Ubuntu 24.04 installer:
   preflight (root, OS, repo layout) → apt deps → `npm ci` → venv + pip → systemd units
   (server + brain) → nginx site → TLS (certbot ACME with a domain, self-signed fallback
   without) → ufw →
   final URL printout. `--check` dry-run (no root, no mutations).
   Checks: `bash -n`; `--check` on the Mac; the fresh-VM gate; re-run idempotency.
3. **whale-girl-server/scripts/ubuntu-tunnel.sh** — the optional `ssh -N -L` pair with
   `--dry-run` and local-port preflight.
   Checks: `bash -n`; `--dry-run` output; owner smoke (P3).
4. **whale-girl-server/scripts/deploy-ubuntu.sh** — optional rsync + remote-install wrapper
   for SSH users, with `--dry-run`.
   Checks: `bash -n`; `--dry-run` output.
5. **Docs** — README "Deploy for general users" (P1/P2/P3, ?ws=, driver placement, model
   upload, troubleshooting); specs/dev-environment.md (patterns consumed, script paths,
   decision log); specs/tech-stack.md (server-side system packages + the placement/TLS
   decisions); AGENTS.md (M4.2 gate recipes).
   Check: diff limited to docs + scripts + trio; runtime files untouched.
6. **ws_probe.js WS_URL knob** — one line (`process.env.WS_URL || 'ws://localhost:3001?role=web'`)
   plus a comment; default unchanged.
   Checks: default probe PASS; explicit `WS_URL` PASS.
7. **Verification** — automatic half on the Mac (script syntax, --check/--dry-run, the full
   probe set, RSS, ports); the ≤10-minute gate runbook and the manual pass written into
   validation.md first-time-user style; measured numbers recorded with absolute paths.

## Design details

### install-ubuntu.sh
- Invocation: `sudo bash install-ubuntu.sh <domain>` (positional domain wins; `WHALE_DOMAIN`
  env accepted), `sudo bash install-ubuntu.sh` (no domain → self-signed fallback),
  `bash install-ubuntu.sh --check` (dry-run, no root).
- Repo paths resolve from the script location (`scripts/../..` = monorepo root); the unit
  and site templates embed absolute paths, so the repo may live anywhere.
- Phases with `set -euo pipefail` + `die()`/actionable messages: (0) preflight — EUID 0,
  Ubuntu 24.04 assert, repo layout, optional `--check`; (1) apt: nginx, certbot,
  python3-certbot-nginx, python3-venv, python3-pip, ufw; verify node ≥ 18 / python3 ≥ 3.9;
  (2) `npm ci` in whale-girl-server; (3) venv (created only when missing) + pip install;
  (4) systemd units `whale-girl.service` (WorkingDirectory=<repo>/whale-girl-server,
  ExecStart=<resolved node> server.js, PORT/WS_PORT env) and `whale-girl-brain.service`
  (`<repo>/whale-girl-server/.venv/bin/python control_whale.py`, `WHALE_MODE=live`,
  `WHALE_WS=ws://127.0.0.1:<WS_PORT>?role=python` — the brain shares the host because say
  audio is page-relative), both Restart=on-failure + journald →
  daemon-reload → enable → restart; (5) nginx: `conf.d/whale-girl-ws-upgrade.conf` (map
  upgrade) + `sites-available/whale-girl` (80 → node :3000, /ws → node :3001 with
  Upgrade/Connection headers + `proxy_set_header Host $host`; TLS mode adds a 443 block
  and an 80 redirect that still serves `/.well-known/acme-challenge/`); certbot
  `certonly --webroot -w <frontend> -d <domain>` only when the cert is absent; default-site
  cleanup; `nginx -t` + reload; ufw `allow 'Nginx Full'` only when ufw is active; (6)
  final printout: https URL, Mac browser-source URL, driver command, journal pointer.
- Idempotency: apt/systemctl/pip are naturally idempotent; unit + site files are written
  from templates on every run (deterministic content — the TLS block is derived from the
  cert's presence, so a re-run cannot wipe certbot's config); certbot is skipped when the
  cert directory exists; `systemctl restart` is the only visible action on a re-run.
- `--check`: repo layout + resolved paths + domain resolution + rendered unit/site printed;
  missing apt/systemctl/nginx degrade to warnings (so it runs on the Mac); exit 0/1.
- No secrets: https clone, certbot `--register-unsafely-without-email`.

### ubuntu-tunnel.sh
- `bash ubuntu-tunnel.sh [--dry-run] [user@]host` (`WHALE_SSH_HOST`/`WHALE_SSH_USER`
  fallbacks); preflights ssh + local ports 3000/3001; prints the unchanged
  http://localhost:3000 URL and the driver line; `--dry-run` prints the exact command.

### deploy-ubuntu.sh
- `bash deploy-ubuntu.sh [--dry-run] [user@]host [remote-dir] [domain]`; rsync -az with
  excludes (node_modules, .venv, .git, audio, logs) — the model folder IS included, which
  is the point for SSH users; then the remote `sudo bash scripts/install-ubuntu.sh <domain>`.
- Documented as a convenience; pattern 2 works without it.

### Docs
- README: rewrite the "Deployment patterns (M4.2)" section into a first-time-user section —
  P1 (nothing to do), P2 console walkthrough with exact commands, the model-upload step,
  ?ws= usage, driver placement, troubleshooting rows (1008 origin guard, certificate,
  journalctl).
- specs/dev-environment.md: "shipped by M4.2 (2026-10-23)" + script paths + decision log
  entries; keep the pattern text as the contract.
- specs/tech-stack.md: server-side system packages (allowed, non-runtime) + the
  driver-on-Mac default + Ubuntu 24.04 target + the ws_probe WS_URL knob.
- AGENTS.md: M4.2 gate recipes (install-ubuntu.sh --check, the ≤10-min runbook pointer).

## Files
- whale-girl-server/scripts/install-ubuntu.sh, ubuntu-tunnel.sh, deploy-ubuntu.sh
- whale-girl-server/scripts/ws_probe.js (one line + comment)
- README.md, specs/dev-environment.md, specs/tech-stack.md, AGENTS.md
- specs/features/2026-10-23-m4.2-m42-deployment/{requirements,plan,validation}.md

## Deviation vs. the approved plan (2026-10-23)
- The approved plan defaulted the brain to the Mac. The say-audio path (index.html
  `fetch(msg.audio)`, a page-relative URL fetched from the page origin) makes that default
  speech-broken in the split, so the brain now ships as `whale-girl-brain.service` on the
  box and the docs make that the default. The Mac placement stays documented for dev and
  motion-only setups. Owner sign-off is owed at review.

## Constraints
- No new runtime dependencies; no per-frame work; budgets unchanged (server ≤ 60 MB,
  driver ≤ 30 MB RSS).
- Config only: server.js, index.html, control_whale.py untouched.
- nginx/certbot are server-host system packages (tech-stack.md), not app dependencies.

## Automatic verification commands
```
bash -n whale-girl-server/scripts/{install-ubuntu.sh,ubuntu-tunnel.sh,deploy-ubuntu.sh}
bash whale-girl-server/scripts/install-ubuntu.sh --check
bash whale-girl-server/scripts/deploy-ubuntu.sh --dry-run
bash whale-girl-server/scripts/ubuntu-tunnel.sh --dry-run example.com
bash whale-girl-server/scripts/stack.sh start
node whale-girl-server/scripts/ws_probe.js
WS_URL='ws://localhost:3001?role=web' node whale-girl-server/scripts/ws_probe.js
node whale-girl-server/scripts/ws_role_probe.js
node whale-girl-server/scripts/cmd_probe.js
node whale-girl-server/scripts/say_probe.js
node whale-girl-server/scripts/expr_probe.js
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/
ps -axo pid,rss,command | grep -E 'node server.js|control_whale.py'
bash whale-girl-server/scripts/stack.sh stop
lsof -nP -iTCP:3000 -iTCP:3001 -sTCP:LISTEN
```
