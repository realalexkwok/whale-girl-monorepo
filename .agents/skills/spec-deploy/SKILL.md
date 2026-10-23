---
name: spec-deploy
description: Plan the Whale Girl M4.2 deployment item — the three patterns for general users (same-machine default; cloud via git pull + install-ubuntu.sh + systemd + nginx TLS with no SSH knowledge; optional SSH tunnel), the idempotent script taxonomy, and the fresh-Ubuntu-VM <=10-min validation gate. Use when planning M4.2, Ubuntu deployment, systemd/nginx setup, deployment scripts, or the SSH tunnel option.
---

# Spec-Driven Deployment Planning (Whale Girl, M4.2)

This skill ACCELERATES /spec-plan for M4.2. (No DSH commands are involved —
the DSH note does not apply to this item.)

## 1. Read first
- specs/roadmap.md (M4.2 patterns + gate wording), specs/tech-stack.md,
  specs/dev-environment.md (deployment patterns section, decision log #4/#5)
- Handoffs M4.2 MUST honour:
  - M1 validation.md — "M4.2 owns: headless server deployment + SSH port
    forwarding + env config + the frontend ?ws= remote endpoint (the
    mechanism already exists, config only)"
  - re-read M4.1's validation.md handoff (it may name M4.2)
- Current surface: scripts/stack.sh supervision, PORT / WS_PORT / WHALE_WS
  env knobs, ?ws= frontend override, ports 3000/3001.

## 2. Ask-round additions (fold into the /spec-plan questions)
- PATTERN SCOPE (roadmap commitment — confirm, don't invent): pattern 1
  same-machine default (zero SSH); pattern 2 cloud via git pull +
  install-ubuntu.sh + systemd + nginx TLS (no SSH knowledge; manual steps
  through the provider console; optional deploy.sh for operators who use
  SSH); pattern 3 SSH tunnel optional (ubuntu-tunnel.sh).
- SCRIPT TAXONOMY (the patchwork-os deploy file set is the pattern):
  install-ubuntu.sh — IDEMPOTENT, re-runnable after git pull (apt deps,
  npm install, venv + pip, systemd unit install + enable, nginx site +
  certbot); deploy.sh — optional scp/rsync wrapper; ubuntu-tunnel.sh — the
  ssh -N -L pair. Every script must be idempotent and fail with actionable
  messages.
- NGINX + TLS: reverse proxy serving the frontend with the WebSocket
  upgraded at /ws (map $http_upgrade $connection_upgrade; certbot ACME;
  TLS 1.2/1.3 — the KohakuTerrarium-style snippet); decide domain vs
  IP-only for the first pass.
- GATE DESIGN: the fresh-Ubuntu-VM <=10-min runbook — a scripted checklist
  (fresh VM -> clone/install -> curl 200 -> ws_probe PASS -> measured wall
  time) that passes from ONLY the README + shipped scripts, with zero SSH
  knowledge required.
- DRIVER PLACEMENT: driver on the Mac vs on Ubuntu (both work via
  WHALE_WS) — decide the documented default.

## 3. Hard constraints (enforce in the plan, do not ask)
- Config-only: no code paths change for the split (the ?ws= override and env
  knobs already exist)
- No new runtime dependencies; nginx/certbot are server-side system packages
  recorded in tech-stack.md at planning
- Server/driver budgets unchanged on the Ubuntu host (measure once there)
- systemd Restart=on-failure; logs via journalctl; no secrets in scripts

## 4. Verification design (automatic + manual)
- AUTOMATIC (macOS side): bash -n on every script; a --check dry-run mode
  validating paths/config without root; the existing probes stay green
  (nothing in the pipeline changes)
- GATE: the owner (or a fresh-VM fixture) runs the <=10-min runbook end to
  end — record wall time, curl 200, ws_probe PASS over the public URL,
  HTTPS cert valid; all three patterns get an acceptance check
- Both halves recorded with measured numbers in validation.md

## 5. Output
- Augmented ask round -> /spec-plan scaffold:
  specs/features/<date>-m42-deployment/{requirements,plan,validation}.md
- validation.md must contain the runbook walkthrough with the measured time
  and the three-pattern acceptance checks.
