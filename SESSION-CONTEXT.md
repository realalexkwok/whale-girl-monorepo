# Session Context — Whale Girl on the Mac

> Written 2026-10-20 on the Mac (whale-girl-monorepo). This file travels WITH the
> repo — continue any session from it. First action on a new machine/agent: read this
> file, then AGENTS.md, then specs/{mission,tech-stack,roadmap}.md.

## 1. What this session is
- Repo: Whale Girl monorepo. Active project: the Live2D interactive streaming system.
- SDD constitution (adopted 2026-10-20, byterra-monorepo is the reference layout):
  - specs/mission.md, tech-stack.md, roadmap.md, dev-environment.md,
    history_roadmap.md, features/
  - root AGENTS.md — an ask-user-question round grouped on requirements / plan /
    validation is REQUIRED before every write to disk
- Branch rules: feature/whale-girl-<item>; close = merge into main → push → delete
  local branch. Agents never git commit / git push without the owner's instruction.

## 2. State — Milestone 1 CLOSED (verified 2026-10-19)
- Everything for M1 is implemented and verified: server (express :3000 + ws proxy
  :3001), frontend (PixiJS 7.4.3 + cubism4, transparent canvas, placeholder fallback),
  mock driver (30 FPS blink/talk/gaze/sway), probes and docs.
- Evidence: motion probe PASS at 30.0 fps (twice), role rejection 1008, single-writer
  replacement 4001, restart resilience, RSS node 49,984 KB / python 20,816 KB.
  Full detail: specs/history_roadmap.md and
  specs/features/2026-10-19-m1-pipeline-foundation/validation.md.
- The owner's manual half (browser ?debug=1 + OBS) and the real model drop-in remain
  the acceptance steps for M1/M2.1.
- Agent skills installed in .agents/skills/ (2026-10-20): /spec-plan opens the
  grouped planning round for any roadmap item (use "/spec-plan M2.1");
  /spec-close runs the automatic half + bookkeeping at an item's close.

## 3. Owner decisions (binding)
1. M1 stops before the real model/audio/DSH work; the owner switches the session AI
   model to **V4.1-Flash** (2026-10-20) before M2 planning.
2. Spec-driven development + agent conventions (AGENTS.md + specs/) — adopted
   2026-10-20 with byterra-monorepo as the layout reference.
3. The Live2D asset must be a Cubism 4.x-format export (pixi-live2d-display 0.4.0 has
   no Cubism 5-specific support).
4. Low-memory is a hard requirement: no Electron, no heavy UI libraries, budgets in
   tech-stack.md.
5. Production split: server → headless Ubuntu, frontend stays in Mac OBS — config-only
   (M4.2 consumes the dev-environment.md checklist; SSH port forwarding is primary).
6. Combined roadmap (2026-10-20, grouped ask round): M2 模型与口型同步 → M3 DSH 互动
   大脑 → M4 内存压榨与部署; the advisor's danmaku milestone is REJECTED.
7. M2.2 lip-sync audio source: system audio / DSH output loopback; RMS computed
   client-side with the Web Audio API.
8. M4.1 hard gate: OBS browser-source extra memory < 100 MB on the Mac.
9. M4.2 deployment (amended 2026-10-20, owner 1a/2a/3a): same-machine localhost is
   the DEFAULT for normal users; cloud deploys use git pull + install-ubuntu.sh +
   systemd (no SSH knowledge); SSH port forwarding is an OPTIONAL advanced mode.

## 4. In-flight / next
- NOTHING is in flight. Next: after the V4.1-Flash swap, M2.1 planning starts with the
  ask-user-question round (requirements/plan/validation) — the real whale.model3.json
  drop-in, carrying the M1 validation.md handoff. The combined M2–M4 roadmap governs
  the order.

## 5. Environment facts (measured 2026-10-19)
- Node v25.2.0, npm 10.5.2; whale-girl-server/node_modules installed.
- Python 3.9.10; whale-girl-server/.venv with websockets 15.0.1 (newest supporting
  3.9; 16.0 needs 3.10+, 17.x needs 3.11+).
- Ports 3000/3001 free at last check; env knobs PORT, WS_PORT, WHALE_WS.
- CDN URLs pinned in tech-stack.md, all verified 200 on 2026-10-19.

## 6. How to run (quick recap)
    # Terminal 1
    cd whale-girl-server && npm start
    # Terminal 2
    cd whale-girl-server && .venv/bin/python control_whale.py
    # Browser / OBS
    open http://localhost:3000?debug=1
    # OBS Browser source URL: http://localhost:3000 (1920x1080, transparent)
    # Probes
    cd whale-girl-server && node scripts/ws_probe.js && node scripts/ws_role_probe.js

## 7. Git state
- Remote: origin = git@github.com:realalexkwok/whale-girl-monorepo.git (added
  2026-10-20 on the owner's instruction); main tracks origin/main.
- Commits: de0f61b (M1 pipeline + spec-driven development, 25 files) + a follow-up
  commit carrying the 2026-10-20 M4.2 deployment-pattern amendment (owner 1a/2a/3a).
  Working tree clean after both; nothing pending.
