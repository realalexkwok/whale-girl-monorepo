# M4.2 — Deployment for General Users — Validation

> Status: implementation complete 2026-10-23; review round 1 fixed (4 major + 10 minor —
> see "Review round 1" below). The manual/gate half (the ≤10-minute fresh-Ubuntu runbook
> below, plus the P3 tunnel smoke) is the owner's acceptance step.

## Success criteria (from the ask round)
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
  P3 = tunnel smoke (browser stays at http://localhost:3000; the brain keeps running on the
  box — a Mac driver is the motion-only alternative).

## Automatic verification results (2026-10-23)

Run order note: ws_probe / ws_role_probe connect to a running stack
(`bash scripts/stack.sh start`), while cmd_probe / say_probe / expr_probe boot their
own server and REFUSE a busy port 3000 — stop the stack before running them.

| Check | Command | Result |
| --- | --- | --- |
| Script syntax | `bash -n whale-girl-server/scripts/{install-ubuntu,ubuntu-tunnel,deploy-ubuntu}.sh` | PASS (all three) |
| Installer dry-run (no root) | `bash whale-girl-server/scripts/install-ubuntu.sh --check` | EXIT 0 — paths resolved; node v25.2.0, npm 10.5.2, python3 3.9.10; ACME webroot /var/www/whale-girl-acme; loopback-only server unit + brain unit rendered; nginx site rendered; apt/systemctl/nginx/certbot/ufw warnings are the expected macOS-only ones |
| Tunnel dry-run | `bash whale-girl-server/scripts/ubuntu-tunnel.sh --dry-run ubuntu@203.0.113.9` | EXIT 0 — warns when local 3000/3001 are busy (a warning in --dry-run), then prints `ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 3000:localhost:3000 -L 3001:localhost:3001 ubuntu@203.0.113.9` |
| Tunnel missing host | `bash whale-girl-server/scripts/ubuntu-tunnel.sh </dev/null` | EXIT 1 — actionable "missing host" message |
| Deploy dry-run | `bash whale-girl-server/scripts/deploy-ubuntu.sh --dry-run ubuntu@203.0.113.9` | EXIT 0 — rsync to the home-relative default `whale-girl-monorepo/` (model included; node_modules/.venv/.git/audio/logs excluded) + the remote install command |
| Motion probe (default URL) | `node whale-girl-server/scripts/ws_probe.js` (stack up) | PASS — 30.0 fps over 2.00 s, 61 frames, monotonic f |
| Motion probe (WS_URL knob) | `WS_URL='ws://localhost:3001?role=web' node scripts/ws_probe.js` | PASS — 30.0 fps, 61 frames (default unchanged) |
| Role rejection | `node whale-girl-server/scripts/ws_role_probe.js` | PASS — close code 1008 with the unknown-role reason |
| M3.1 gate | `node whale-girl-server/scripts/cmd_probe.js` | PASS 63/63 — server RSS samples max 30,000 KB; driver max 17,152 KB (budgets 60/30 MB) |
| M2.2 regression | `node whale-girl-server/scripts/say_probe.js` | PASS 13/13 — in-word mouth 53/53 (100%), gap max 0.083, word-onset latency mean 15 ms / max 32 ms; server 31,728 KB, driver 15,936 KB |
| M3.2 gate | `node whale-girl-server/scripts/expr_probe.js` | PASS 22/22 |
| HTTP smoke | `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` | 200 |
| Inline frontend syntax | extract lines 59–1048 of index.html → `node --check` | PASS — 41,002 B (index.html untouched by M4.2) |
| Stack RSS (live stack) | `ps -axo pid,rss,command \| grep -E 'node server.js\|control_whale.py'` | node server.js 50,256 KB; brain 16,656 KB (budgets 60/30 MB) |
| Port release | `lsof -nP -iTCP:3000 -iTCP:3001 -sTCP:LISTEN` after `stack.sh stop` and after each self-contained probe | free every time |

Runtime code paths untouched (config-only claim): `git status` shows no change to
server.js, index.html or control_whale.py; the only JS touched is the ws_probe tooling knob.

## The ≤10-minute fresh-Ubuntu gate (first-time-user runbook)

Run this on a brand-new Ubuntu 24.04 VM. The only tools you need are a web browser and the
provider's web console (the "Terminal" / "Console" button on the VM page) — no SSH client,
no port forwarding.

1. **Open the provider console** and log into the new VM (the console usually drops you in
   as root or a sudo user).
2. **Clone the repo** (~1 min). Until M4.2 is merged to main, clone the feature branch
   (`git clone -b feature/whale-girl-m42-deployment ...`); after the close, `main` contains
   the scripts and the plain clone below is correct:

       git clone https://github.com/realalexkwok/whale-girl-monorepo.git
       cd whale-girl-monorepo

3. **Point your domain at the VM** (before the install, so certbot can validate): create an
   A record for the domain you will use (e.g. `whale.example.com`) → the VM's public IP.
   Ports 80 and 443 must be open in the provider firewall (the default for a fresh VM).
4. **Install** (one command; idempotent — safe to re-run after `git pull`; the domain is
   remembered in `/etc/whale-girl/domain`, so a later re-run without the argument keeps
   Let's Encrypt TLS):

       cd whale-girl-server
       sudo bash scripts/install-ubuntu.sh whale.example.com

5. **Start it at boot** (the installer already enabled both units; this is the
   idempotent check):

       sudo systemctl enable --now whale-girl whale-girl-brain
       sudo systemctl status whale-girl whale-girl-brain --no-pager

6. **Check the page from the VM**:

       curl -s -o /dev/null -w '%{http_code}\n' https://whale.example.com/

   Expect `200`.
7. **(Optional) put the whale model on the server** — the model folder is gitignored, so a
   git-only deploy shows the placeholder. From any machine that has the 4.3 MB folder
   (adjust the remote path to wherever the repo was cloned):

       rsync -az whale-girl-frontend/model/ user@whale.example.com:whale-girl-monorepo/whale-girl-frontend/model/

   (or drag the folder in through the provider's file manager). The placeholder becomes the
   whale after a refresh.
8. **From the Mac, verify the stream** — the page and the WS must share the hostname:

       cd whale-girl-server
       WS_URL='wss://whale.example.com/ws?role=web' node scripts/ws_probe.js

   Expect `PASS` (~30 fps, monotonic f). Also verify the origin guard THROUGH NGINX (the
   deployment path, not just the raw port):

       WS_URL='wss://whale.example.com/ws?role=web' WS_ORIGIN='https://whale.example.com' node scripts/ws_probe.js                # PASS
       WS_URL='wss://whale.example.com/ws?role=web' WS_ORIGIN='https://evil.example' WS_EXPECT=reject node scripts/ws_probe.js   # close 1008
9. **Point the browser/OBS at it** — in OBS, edit the whale Browser source:

       https://whale.example.com/?ws=wss://whale.example.com/ws

   **The `?ws=` override is required**: without it the page connects to `ws://localhost:3001`
   (the dev default), not the server. The whale renders, blinks and animates. The brain
   already runs on the box (`systemctl status whale-girl-brain`) — it must, because say
   frames carry page-relative `/audio/<file>` URLs. Motion-only alternative: stop the
   brain unit and run the driver on the Mac
   (`WHALE_WS='wss://whale.example.com/ws?role=python' .venv/bin/python control_whale.py`)
   — speech would be silent.

10. **Idempotency check** — re-run step 4; it must complete with no errors and the page must
    stay green (`curl` 200 again).

Record the wall-clock time from step 2 through step 6 (and step 8). The gate passes when it
is **≤ 10 minutes** and every check above is green. Logs: `sudo journalctl -u whale-girl -f`.

**Without a domain (fallback):** `sudo bash scripts/install-ubuntu.sh` generates a
self-signed certificate; browsers/OBS will warn and the `wss` probe will reject the
certificate (the ws client validates the chain) — document it, do not use it for the gate.
**LAN alternative:** install with `WHALE_ALLOW_LAN=1` (the server socket is loopback-only
by default), firewall-allow 3000/tcp + 3001/tcp and use
`http://<server-ip>:3000?ws=ws://<server-ip>:3001` (direct TCP, no nginx).

## P3 tunnel smoke (owner, optional advanced mode)
1. Dry-run first: `cd whale-girl-server && bash scripts/ubuntu-tunnel.sh --dry-run
   ubuntu@whale.example.com` — it prints the exact `ssh -N -L` command and checks the
   local ports.
2. Run it for real from the Mac and leave it open. The page and the WS proxy come from the
   box through the tunnel (the box must already be installed by pattern 2).
3. Browser: `http://localhost:3000/?debug=1` — the page loads from the box, the status line
   shows `ws connected` and the frame counter rises; OBS's existing localhost Browser source
   keeps working unchanged.
4. The brain keeps running on the box (`sudo journalctl -u whale-girl-brain -f` shows the
   30 FPS driver); a Mac driver is not needed (and would make speech silent).
5. Ctrl-C closes the tunnel; the page reconnects when the tunnel is reopened.

## Remote smoke on the real Ubuntu host (2026-10-23, superguo-SQM2270)
Deployed by the agent over SSH (rsync + remote commands); the owner then ran
`sudo bash scripts/install-ubuntu.sh` (no domain -> self-signed TLS):
- Host: `superguo-SQM2270`, Ubuntu 24.04.4 LTS, node v22.23.2, python3 3.12.3; repo at
  `/home/superguo/Projects/whale-girl-monorepo/` (5.2 MB, model included).
- systemd (16:53 snapshot): `whale-girl.service` + `whale-girl-brain.service` + `nginx` all
  **active and enabled**; node on :3000/:3001, nginx on :80/:443 (self-signed
  `/etc/ssl/whale-girl/selfsigned.crt`, site `whale-girl`, `server_name _`). The brain unit
  later died (17:13) — see the displacement bullet below.
- Remote-side `ws_probe`: **PASS 30.0 fps, 61 frames**; `/model/whale.model3.json` **200**
  over http and https; `/` **200**.
- Speech end-to-end on the box: edge-tts synthesized two commanded lines
  (`say-...-3788.mp3`, 4 words; `say-...-3399.mp3`, 6 words), `/audio` served **200**
  (17,280 B). The second line was commanded FROM THE MAC through the forwarded WS
  (`WHALE_CMD_WS=ws://localhost:3001?role=web`) -> Mac -> tunnel -> box -> brain works.
- Mac through the user's `ssh -f -N -L 3000/3001` tunnels: `localhost:3000` **200**;
  `WS_URL=ws://localhost:3001` -> **PASS 30.2 fps, 60 frames**. (An earlier check showed
  000 because those tunnels were not up yet; re-checked once they were.)
- RSS (ps) under systemd: node **67,552 KB** (~66 MB -- above the 60 MB Mac-measured
  budget; Linux/node-22 delta, reported as a finding), brain **27,592 KB** (within 30 MB).
  systemd cgroup accounting reports 18.4M / 16.9M.
- Not recorded: the <=10-min wall-clock gate time (the owner ran the install interactively)
  and a domain/certbot certificate (no domain was given; the self-signed fallback ran).
- 2026-10-23 ~17:14: a stray newer python writer connected as role=python through the WS,
  displaced the systemd brain (close 4001) and the unit stayed dead — `Restart=on-failure`
  does not revive a clean exit. Fixed to `Restart=always` (review round 1). Until the fixed
  installer is re-run on the box, a temporary user-level brain keeps the page animated
  (`nohup .venv/bin/python control_whale.py`, WHALE_MODE=live).

## Review round 1 (2026-10-23, independent reviewer)
Verdict: FIX REQUIRED (4 major, 10 minor); all fixed in the follow-up commit.

| Finding | Fix |
| --- | --- |
| MAJOR 1: stock Ubuntu npm missing -> `npm ci` dies | apt installs `npm`; preflight + `--check` |
| MAJOR 2: ACME webroot unreadable by www-data (repo under a 750 home) | webroot /var/www/whale-girl-acme (0755) for nginx + certbot |
| MAJOR 3: docs claimed `?ws=` is optional (frontend defaults to ws://localhost:3001) | docs now state `?ws=wss://<domain>/ws` is REQUIRED |
| MAJOR 4: raw :3000/:3001 exposed; role=python needs no Origin | server unit loopback-only (`IPAddressAllow=localhost`), `WHALE_ALLOW_LAN=1` opt-out; brain unit unrestricted for TTS |
| MINOR 5: units run as root | documented as accepted risk (README security notes) |
| MINOR 6: deploy wrapper default /opt + unquoted domain + 100644 | home-relative default, validated + %q-quoted domain, docs use `bash` |
| MINOR 7: tunnel --dry-run skipped the port preflight; no ExitOnForwardFailure | preflight in both modes (warning in dry-run); option added |
| MINOR 8: gate recipe omitted the host | recipes pass `ubuntu@203.0.113.9` |
| MINOR 9: main lacks the scripts pre-merge | runbook names the feature branch (clone -b) |
| MINOR 10: docs paths/firewall/--check wording | README firewall line + `cd whale-girl-server`; plan wording fixed |
| MINOR 11: re-run without the domain downgraded TLS; self-signed never renewed | remembered domain (/etc/whale-girl/domain); openssl -checkend expiry check |
| MINOR 12: trio/roadmap stale text | scope bullet, final-printout bullet, roadmap name fixed |
| MINOR 13: nginx started before `nginx -t` | `-t` first; previous site restored on failure |
| MINOR 14: origin guard never exercised by the probe | `WS_ORIGIN` + `WS_EXPECT=reject`; evidence below |
| NEW (review host evidence): the brain stayed dead after a stray writer displaced it (Restart=on-failure, driver exits 0) | brain unit Restart=always |

Re-checks after the fixes (2026-10-23, all green):
- `bash -n` on the three scripts; `install-ubuntu.sh --check` exit 0 — node v25.2.0, npm 10.5.2,
  ACME webroot /var/www/whale-girl-acme, loopback-only server unit rendered.
- `ubuntu-tunnel.sh --dry-run` — warns about the busy local ports (the owner's tunnel was up),
  then prints the ssh command with `ExitOnForwardFailure=yes`; `deploy-ubuntu.sh --dry-run`
  prints the rsync + the remote install (domain validated/quoted; invalid domain exits 1).
- Origin guard through the tunnel (the raw WS port, Host=localhost): no Origin ->
  **PASS 30.4 fps**; matching Origin (`http://localhost:3000`) -> **PASS 29.9 fps**;
  mismatched Origin (`http://evil.example`) -> **close 1008, PASS (expected rejection)**.
  The nginx/domain path is checked in the gate runbook (step 8, `wss://<domain>/ws` with
  `WS_ORIGIN`) — it needs a trusted certificate, so it runs with the domain gate.

## Review round 2 (2026-10-23)
Verdict: FIX REQUIRED (1 major, 9 minor); all fixed in the follow-up commit.

| Finding | Fix |
| --- | --- |
| MAJOR 1: apt `npm` is unsatisfiable on a NodeSource host (`nodejs` Provides/Conflicts: npm) | npm is added to the apt list only when `command -v npm` is absent; the box keeps its bundled npm |
| MINOR 2: apply_site did not really restore a fresh install's site | the last nginx-accepted site is kept as `whale-girl.prev`; a failure restores it, or removes the site with an accurate message |
| MINOR 3: the domain was persisted only after a new certbot request | persisted whenever DOMAIN is set and the cert exists |
| MINOR 4: the runbook block still cloned main | the block names `-b feature/whale-girl-m42-deployment` until the merge |
| MINOR 5: "no domain -> self-signed" is false once remembered | `--no-domain` (and `rm /etc/whale-girl/domain`) documented and implemented |
| MINOR 6: ufw ran after certbot | the firewall step now runs before nginx/certbot |
| MINOR 7: origin evidence was tunnel-only | noted as the tunnel path; the gate now also checks `wss://` through nginx with `WS_ORIGIN` |
| MINOR 8: trio described a one-line ws_probe and a Mac brain | requirements/plan wording updated |
| MINOR 9: stale table/runbook rows | refreshed (tunnel/--check/deploy rows, 80+443, P3 cd, 16:53 snapshot, AGENTS host) |
| MINOR 10: `WHALE_ALLOW_LAN` through sudo was unreliable | `--allow-lan` flag added and documented |

Re-checks after round 2 (2026-10-23):
- `bash -n` + `--check` exit 0; `--check --allow-lan` renders the server unit WITHOUT the IP
  restriction; `--check --no-domain` reports `(source: --no-domain)`.
- NodeSource apt simulation on the box: the installer's package list WITHOUT npm resolves
  (`0 upgraded, 0 newly installed ...`); `apt-get install -s npm` alone is unsatisfiable
  (`node-ms: Depends: nodejs:any` -> "Unable to correct problems") — the guard is required.
- Still owed: a full re-run of the fixed installer on the box (sudo) and the domain gate.

## Already verified, do NOT re-run
| Item | Evidence |
| --- | --- |
| P1 same-machine dev loop | the M4.1 close re-run (2026-10-23) and the automatic half above |
| The pipeline probes (ws/role/cmd/say/expr) | the automatic half table above, this session |
| install-ubuntu.sh syntax + --check | the automatic half table above |

## Pattern acceptance checks
| Pattern | Acceptance | Result |
| --- | --- | --- |
| P1 same machine (DEFAULT) | the unchanged dev loop — already verified by the M4.1 close re-run; not re-run here | PASS by prior evidence |
| P2 cloud server (gate) | partial: the systemd install ran on a real Ubuntu 24.04 host (units enabled, https 200 self-signed, speech verified); the ≤10-min fresh-VM timing + a domain/certbot certificate remain owed | owner: partial |
| P3 SSH tunnel (optional) | PASS — the owner's `ssh -f -N -L 3000/3001` forwards gave localhost:3000 200 + `ws_probe` PASS 30.2 fps, with the box brain driving it (2026-10-23) | owner: PASS |

## Implementation corrections (owner sign-off owed)
- **2026-10-23 — brain placement.** The approved plan defaulted the brain to the Mac
  ("driver stays on the Mac; no second systemd unit"). While writing the installer, the
  say path in index.html (`fetch(msg.audio)` — a page-relative URL resolved against the
  page origin) proved the audio files must live on the host that serves the page; with the
  brain on the Mac, every speech line 404s. The correction ships
  `whale-girl-brain.service` (WHALE_MODE=live) and documents the box as the default, while
  keeping driver-on-the-Mac supported for dev and motion-only setups. Sign-off is owed at
  the owner's review.

## Handoff to dependant milestones
- M5.1/M5.2 own nothing new from M4.2 (the notifier runs in the same stack; the deployment
  scripts are host-level, not runtime).
- Deferred inside M4.2 (recorded; no later milestone owns them — revisit only with owner
  consent): a WebSocket auth token (V3 vision: proxy hardening), metrics/monitoring of the
  Ubuntu host (V3), IP-only TLS beyond the self-signed fallback (no plan), hosting the
  gitignored model asset (documented upload step only).
- The committed model assets stay out of git by design; the owner keeps the local copy.
