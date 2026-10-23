# M4.2 — Deployment for General Users — Plan

> Approved 2026-10-23 (the grouped round's Recommended options). Status: implementation —
> see validation.md for the evidence.

## Task groups
1. **Spec trio + branch** — this folder + `feature/whale-girl-m42-deployment`.
   Check: trio exists; `git status` shows only new files.
2. **whale-girl-server/scripts/install-ubuntu.sh** — idempotent Ubuntu 24.04 installer:
   preflight (root, OS, repo layout) → apt deps (incl. nodejs, and npm only when absent) →
   `npm ci` → venv + pip → systemd units (server + brain) → **ufw (before certbot)** →
   nginx site → TLS (certbot ACME with a domain, self-signed fallback without) →
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
6. **ws_probe.js knobs** — `WS_URL` (endpoint override), `WS_ORIGIN` (Origin header) and
   `WS_EXPECT=reject` (expect close 1008); the default endpoint is unchanged.
   Checks: default probe PASS; explicit `WS_URL` PASS; matching Origin PASS; mismatched
   Origin -> close 1008 PASS.
7. **Verification** — automatic half on the Mac (script syntax, --check/--dry-run, the full
   probe set, RSS, ports); the ≤10-minute gate runbook and the manual pass written into
   validation.md first-time-user style; measured numbers recorded with absolute paths.

## Design details

### install-ubuntu.sh
- Invocation: `sudo bash install-ubuntu.sh <domain>` (positional domain wins; `WHALE_DOMAIN`
  env accepted), `sudo bash install-ubuntu.sh --no-domain` (self-signed fallback / forget
  the remembered domain), `--allow-lan` (LAN-direct), `bash install-ubuntu.sh --check`
  (dry-run, no root).
- Repo paths resolve from the script location (`scripts/../..` = monorepo root); the unit
  and site templates embed absolute paths, so the repo may live anywhere.
- Phases with `set -euo pipefail` + `die()`/actionable messages: (0) preflight — EUID 0,
  Ubuntu 24.04 assert, repo layout, optional `--check`; (1) apt: nginx, certbot,
  python3-certbot-nginx, python3-venv, python3-pip, ufw, nodejs + npm; verify node ≥ 18,
  npm present / python3 ≥ 3.9;
  (2) `npm ci` in whale-girl-server; (3) venv (created only when missing) + pip install;
  (4) systemd units `whale-girl.service` (WorkingDirectory=<repo>/whale-girl-server,
  ExecStart=<resolved node> server.js, PORT/WS_PORT env, loopback-only via
  IPAddressAllow=localhost unless --allow-lan / WHALE_ALLOW_LAN=1, Restart=on-failure) and
  `whale-girl-brain.service` (`<repo>/whale-girl-server/.venv/bin/python control_whale.py`,
  `WHALE_MODE=live`, `WHALE_WS=ws://127.0.0.1:<WS_PORT>?role=python` — the brain shares the
  host because say audio is page-relative, Restart=always since a displaced driver exits 0),
  both journald → daemon-reload → enable → restart; (5) nginx: `conf.d/whale-girl-ws-upgrade.conf` (map
  upgrade) + `sites-available/whale-girl` (80 → node :3000, /ws → node :3001 with
  Upgrade/Connection headers + `proxy_set_header Host $host`; TLS mode adds a 443 block
  and an 80 redirect that still serves `/.well-known/acme-challenge/`); the ACME webroot is
  /var/www/whale-girl-acme (0755); certbot `certonly --webroot -w <acme> -d <domain>` only
  when the cert is absent, and the domain is written to /etc/whale-girl/domain; default-site
  cleanup; `nginx -t` runs BEFORE enable/start and restores the last accepted site on
  failure, then reload; the firewall step (`ufw allow 'Nginx Full'` when ufw is active) runs
  BEFORE this phase, so an already-active firewall has 80/443 open for certbot; (6) final
  printout: page URL, Mac browser-source URL with the required ?ws=, brain journal pointer,
  network mode.
- Idempotency: apt/systemctl/pip are naturally idempotent; unit + site files are rewritten
  from templates on every run (deterministic content — the TLS block is derived from the
  cert's presence, so a re-run cannot wipe certbot's config); certbot is skipped when the
  cert directory exists; a re-run also refreshes npm/pip deps and restarts both units (the
  README's "re-run after git pull" procedure). A remembered domain keeps Let's Encrypt TLS.
- `--check`: repo layout + resolved paths + the domain argument (or the remembered one) + rendered unit/site printed;
  missing apt/systemctl/nginx degrade to warnings (so it runs on the Mac); exit 0/1.
- No secrets: https clone, certbot `--register-unsafely-without-email`.

### ubuntu-tunnel.sh
- `bash ubuntu-tunnel.sh [--dry-run] [user@]host` (`WHALE_SSH_HOST`/`WHALE_SSH_USER`
  fallbacks); preflights ssh + local ports 3000/3001 in BOTH modes (a busy port is a warning
  in --dry-run, fatal otherwise); `-o ExitOnForwardFailure=yes`; prints the unchanged
  http://localhost:3000 URL; `--dry-run` prints the exact command.

### deploy-ubuntu.sh
- `bash deploy-ubuntu.sh [--dry-run] [user@]host [remote-dir] [domain]`; rsync -az with
  excludes (node_modules, .venv, .git, audio, logs) — the model folder IS included, which
  is the point for SSH users; then the remote `sudo bash scripts/install-ubuntu.sh <domain>`.
  The remote dir defaults to `whale-girl-monorepo` relative to the SSH user's home (a stock
  box's /opt is root-owned); the domain is validated and printf-%q-quoted before it reaches
  the remote root shell; the copy has no .git, so updates re-run the wrapper.
- Documented as a convenience; pattern 2 works without it.

### Docs
- README: rewrite the "Deployment patterns (M4.2)" section into a first-time-user section —
  P1 (nothing to do), P2 console walkthrough with exact commands, the model-upload step,
  ?ws= usage, driver placement, troubleshooting rows (1008 origin guard, certificate,
  journalctl).
- specs/dev-environment.md: "shipped by M4.2 (2026-10-23)" + script paths + decision log
  entries; keep the pattern text as the contract.
- specs/tech-stack.md: server-side system packages (allowed, non-runtime) + the
  box-brain default + Ubuntu 24.04 target + the ws_probe knobs.
- AGENTS.md: M4.2 gate recipes (install-ubuntu.sh --check, the ≤10-min runbook pointer).

## Files
- whale-girl-server/scripts/install-ubuntu.sh, ubuntu-tunnel.sh, deploy-ubuntu.sh
- whale-girl-server/scripts/ws_probe.js (WS_URL/WS_ORIGIN/WS_EXPECT knobs)
- README.md, specs/dev-environment.md, specs/tech-stack.md, AGENTS.md
- specs/features/2026-10-23-m4.2-m42-deployment/{requirements,plan,validation}.md

## Deviation vs. the approved plan (2026-10-23)
- The approved plan defaulted the brain to the Mac. The say-audio path (index.html
  `fetch(msg.audio)`, a page-relative URL fetched from the page origin) makes that default
  speech-broken in the split, so the brain now ships as `whale-girl-brain.service` on the
  box and the docs make that the default. The Mac placement stays documented for dev and
  motion-only setups. Owner sign-off is owed at review.

## Review rounds 1–4 fixes (2026-10-23)
- MAJOR 1: apt installs npm (+ preflight and --check).
- MAJOR 2: ACME webroot /var/www/whale-girl-acme (0755) instead of the repo path.
- MAJOR 3: README/validation now state that ?ws=wss://<domain>/ws is REQUIRED (the frontend
  default is ws://localhost:3001).
- MAJOR 4: the server unit is loopback-only (IPAddressAllow=localhost) unless
  WHALE_ALLOW_LAN=1; nginx + tunnels keep working; the brain unit stays unrestricted (TTS).
- MINOR 5: root services documented as accepted risk (README security notes).
- MINOR 6: deploy wrapper defaults to a home-relative dir, validates/quotes the domain, and
  the docs invoke it with bash.
- MINOR 7: tunnel preflights ports in both modes + ExitOnForwardFailure=yes.
- MINOR 8: gate recipes pass a host.
- MINOR 9: validation notes the branch pre-merge (clone -b) for the runbook.
- MINOR 10: README firewall prerequisite + cd-correct tunnel path; plan --check wording fixed.
- MINOR 11: remembered domain (/etc/whale-girl/domain) + self-signed expiry check;
  idempotency wording corrected.
- MINOR 12: trio scope/plan/roadmap text corrected to the shipped truth.
- MINOR 13: nginx -t before enable/start, restore on failure.
- MINOR 14: ws_probe WS_ORIGIN/WS_EXPECT=reject; origin-guard evidence recorded in
  validation.md.
- Also fixed from the review's evidence: the brain unit is Restart=always (a displaced driver
  exits 0; on-failure left the box brain dead).

### Round 2
- npm is appended to the apt list only when `command -v npm` is absent (NodeSource's nodejs
  Provides/Conflicts: npm; the distro npm package is unsatisfiable there).
- `apply_site` keeps the last nginx-accepted site as `whale-girl.prev` and restores it on
  failure (accurate message when no previous site exists).
- The domain is persisted whenever the certificate exists (not only after a new request).
- The firewall step runs before nginx/certbot; the runbook clone block uses `-b` pre-merge;
  the origin-guard gate checks `wss://<domain>/ws` with `WS_ORIGIN` through nginx.
- `--allow-lan` and `--no-domain` flags (sudo-safe; the env var may not survive sudo).

### Round 3
- The apt array actually expands (`"${pkgs[@]}"`; the literal placeholder is gone).
- `--no-domain` forgets the domain right after the root check (install mode only), so an
  earlier phase failure cannot leave it remembered.
- Usage and the final update line no longer claim a remembered domain when there is none.

### Round 4
- APPROVE. The only note was plan ordering/notes (fixed: ufw step reordered, flags named).
- Real run (18:22): the systemd readiness check polled once after `sleep 2` and sampled the
  ~2 s window in which a leftover manual brain displaced the unit's brain (4001, clean
  exit) before `Restart=always` brought it back; the check now polls both units for up to
  20 s.

## Constraints
- No new runtime dependencies; no per-frame work; budgets unchanged (server ≤ 60 MB,
  driver ≤ 30 MB RSS).
- Config only: server.js, index.html, control_whale.py untouched.
- nginx/certbot are server-host system packages (tech-stack.md), not app dependencies.

## Automatic verification commands
```
bash -n whale-girl-server/scripts/{install-ubuntu.sh,ubuntu-tunnel.sh,deploy-ubuntu.sh}
bash whale-girl-server/scripts/install-ubuntu.sh --check
bash whale-girl-server/scripts/deploy-ubuntu.sh --dry-run ubuntu@203.0.113.9
bash whale-girl-server/scripts/ubuntu-tunnel.sh --dry-run ubuntu@203.0.113.9
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
