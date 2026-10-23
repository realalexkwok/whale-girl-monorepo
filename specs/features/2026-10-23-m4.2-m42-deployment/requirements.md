# M4.2 — Deployment for General Users — Requirements

> Confirmed 2026-10-23 through the /spec-plan grouped round (requirements / plan /
> validation). The round was issued twice and received no answers inside the windows, so
> the Recommended (constitution-implied) options were baked into the plan and the owner
> approved that plan as a whole. Status: implementation — see plan.md and validation.md.

## Scope
- Three deployment patterns, exactly as specs/roadmap.md writes them (2026-10-20 owner
  amendment, 1a/2a/3a):
  1. **Same machine — DEFAULT for normal users, zero SSH.** The dev loop itself: server +
     brain + browser/OBS on one computer. Nothing to configure.
  2. **Cloud server — no SSH knowledge required.** git clone over https + one idempotent
     `install-ubuntu.sh` (apt deps, npm ci, venv + pip, systemd unit, nginx TLS site with
     the WS upgraded at /ws) + an optional `deploy-ubuntu.sh` wrapper for operators who
     already use SSH. Manual steps run through the provider's web console.
  3. **SSH port forwarding — OPTIONAL advanced mode.** `ubuntu-tunnel.sh` runs the
     `ssh -N -L` pair; the browser keeps pointing at http://localhost:3000.
- Frontend `?ws=` remote endpoint: configuration only, no code rewrite — the mechanism
  already exists in index.html (M1 handoff satisfied by existing code).
- Brain placement: in the split patterns the brain runs on the server host (see decision 2 —
  the say-audio contract forces it); `whale-girl-brain.service` ships with the installer.
  Running the driver on the Mac stays documented for dev/motion-only (speech silent).
- TLS: certbot ACME with a real domain on the first pass; IP-only self-signed is a
  documented fallback, not the gate path.
- Target distro: **Ubuntu 24.04 LTS**.
- No runtime code paths change. New files: three deployment scripts, docs updates, this
  spec trio; plus `WS_URL`/`WS_ORIGIN`/`WS_EXPECT` knobs in ws_probe.js (verification
  tooling only).

## Decisions
1. Three patterns as the roadmap writes them; config-only runtime.
2. **Brain placement — implementation correction 2026-10-23.** The brain runs on the
   same host as the server by default: a say frame carries a page-relative
   `/audio/<file>` URL that the browser fetches from the page origin, so the audio files
   must live next to the server. install-ubuntu.sh therefore ships a second unit
   (`whale-girl-brain`, `WHALE_MODE=live`). Running the driver on the Mac stays supported
   for dev and motion-only setups, documented with the silent-speech caveat. (The approved
   plan said driver-on-Mac default; this is the forced correction — owner sign-off owed,
   recorded in validation.md.)
3. certbot ACME (domain) first; the self-signed IP fallback is documented with its
   browser-warning caveat.
4. `deploy-ubuntu.sh` is an optional rsync convenience, never a requirement.
5. Ubuntu 24.04 LTS target: distro nodejs 18.19 (≥ 18) and python3 3.12 (≥ 3.9);
   websockets 15.x supports 3.9–3.13. Older releases fail with an actionable message
   (NodeSource is out of scope).
6. `install-ubuntu.sh` is idempotent and re-runnable after `git pull`; it has a
   `--check` dry-run that validates configuration without root and without mutations.
7. nginx must `proxy_set_header Host $host` on the WS location — the origin guard compares
   the page origin host with the WS request Host — and the page + WS must share one hostname.
8. nginx proxies HTTP to node :3000 (express static + the /audio mount) and /ws to :3001;
   one source of truth for the page, nginx only terminates TLS.
9. Server-side system packages (nginx, certbot, python3-certbot-nginx, python3-venv,
   python3-pip, ufw, nodejs + npm, lsof) are recorded in specs/tech-stack.md; they are not
   runtime JS/Python dependencies. (Stock Ubuntu 24.04 `nodejs` does not pull npm.)
10. No secrets in scripts (git over https; certbot registered without an email).
11. systemd units: the server uses Restart=on-failure; the brain uses Restart=always (a
    displaced driver exits 0 on 4001 — on-failure would leave the box brain dead). The
    server unit is loopback-only (`IPAddressAllow=localhost`) unless `WHALE_ALLOW_LAN=1`;
    journald logs (`journalctl -u whale-girl` / `-u whale-girl-brain`); a failed unit prints
    the journal pointer.
12. Model-asset note: whale-girl-frontend/model/ is gitignored (4.3 MB), so a git-only
    cloud deploy serves the placeholder until the folder is uploaded once;
    deploy-ubuntu.sh (rsync) brings it automatically. Documented in the README.
13. Review round 1 (2026-10-23) corrections: apt installs npm; the ACME webroot is
    /var/www/whale-girl-acme (0755) because www-data cannot read a repo under a 750 home;
    the domain is remembered in /etc/whale-girl/domain (a re-run without the argument keeps
    Let's Encrypt TLS); nginx -t runs before enable/start and restores the previous site on
    failure; deploy-ubuntu.sh defaults to a home-relative remote dir and quotes the domain;
    ws_probe gains WS_ORIGIN / WS_EXPECT=reject for the origin-guard check. Round 2:
    npm is apt-installed only when absent (NodeSource's nodejs provides npm and Conflicts:
    npm); ufw allows 80/443 before certbot; the last nginx-accepted site is kept as .prev;
    the domain is persisted whenever the cert exists; `--allow-lan` / `--no-domain` flags
    (sudo-safe; the env var may not survive sudo).

## Context
- Budgets unchanged: server ≤ 60 MB / driver ≤ 30 MB RSS (measured on the Mac; one RSS
  snapshot on the Ubuntu host is information, not a gate).
- Handoffs: M1 validation ("M4.2 owns the ?ws= remote endpoint") is satisfied by existing
  code; M4.1 validation ("M4.2 owns nothing new — the deployment surface is unchanged,
  config only") re-read and honoured — no new work implied.
- Gate (roadmap wording): a fresh Ubuntu VM reaches the streaming state in ≤ 10 minutes
  following only the README and the shipped scripts, with zero SSH/port-forwarding knowledge.
- Working tree at planning: SESSION-CONTEXT.md + docs/folder-structure.md modified (the
  spec-deploy skill mention) and .agents/skills/spec-deploy/SKILL.md untracked; they ride
  along on the M4.2 branch and are committed only with the owner's instruction.
- Implementation correction (2026-10-23): the approved plan defaulted the brain to the
  Mac. While wiring the installer, the say-audio path proved the brain must share a host
  with the server for speech (index.html `fetch(msg.audio)` resolves the page-relative URL
  against the page origin). The default moved to the box and `whale-girl-brain.service`
  ships; owner sign-off is owed at review.
- Owner-commit rule: agents never commit/push without the owner's instruction.

## Validation criteria (from the ask round)
Automatic half (Mac):
- `bash -n` on all three scripts; `install-ubuntu.sh --check` passes without root;
  `deploy-ubuntu.sh --dry-run` and `ubuntu-tunnel.sh --dry-run` print the exact commands.
- The existing gates stay green: ws_probe PASS (20–40 fps, monotonic f), ws_role_probe close
  1008, cmd_probe 63/63, say_probe 13/13, expr_probe 22/22, curl 200, `node --check` on the
  inline frontend script, RSS snapshot within budgets, ports released after stop.
- ws_probe's new `WS_URL` env works and the default URL is unchanged (regression).

Gate/manual half:
- Fresh Ubuntu 24.04 VM, provider web console only: clone → install → enable → `curl`
  https 200 → ws_probe PASS via the public wss:// URL → (optional) model upload renders the
  whale. Recorded wall time ≤ 10 minutes; certificate valid; idempotent re-run passes.
- Pattern acceptance: P1 = the unchanged dev loop (already green; not re-run); P2 = the gate;
  P3 = tunnel smoke (browser stays at http://localhost:3000; the box brain drives it).
