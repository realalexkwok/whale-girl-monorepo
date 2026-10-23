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

## 2. State — M1 CLOSED (2026-10-19); M2.1 CLOSED (2026-10-20); M2.2 CLOSED (2026-10-21); M3.1 CLOSED (2026-10-22); M3.2 CLOSED (2026-10-22); M4.1 CLOSED (2026-10-23)
- M1: server (express :3000 + ws proxy :3001), frontend (PixiJS 7.4.3 + cubism4,
  transparent canvas, placeholder fallback), mock driver (30 FPS blink/talk/gaze/sway),
  probes and docs. Evidence: motion probe PASS at 30.0 fps (twice), role rejection
  1008, single-writer replacement 4001, restart resilience, RSS node 49,984 KB /
  python 20,816 KB. Full detail: specs/history_roadmap.md and
  specs/features/2026-10-19-m1-pipeline-foundation/validation.md.
- M2.1: real DS鲸鱼娘 model installed at whale-girl-frontend/model/ (gitignored);
  staged load errors, window.whaleModel hooks (FORCE playMotion, resetPose),
  validator script. Evidence: 30.0 fps probe, validator PASS (moc3 v4, 8 motions,
  44 expressions), RSS node 27,968 KB / driver 21,360 KB, single settings fetch,
  0 console errors. Manual half owner-confirmed 2026-10-20. Full detail:
  specs/features/2026-10-20-m2.1-model-integration/validation.md.
- M2.1's manual pass (browser ?debug=1, console hooks, failure path, OBS Browser
  source) also covers the M1 manual acceptance, which was never separately recorded.
- M3.2: LLM-driven expressions — the DSH model tags text inline
  (whale_express), expr_tags.py resolves the tag to a preset, and the driver
  forwards the M3.1 expression frame with cooldown/hysteresis, neutral fallback
  (CLI strict, raw frames neutralized), idle reset, mode-flip reset and the
  WHALE_EXPR_TAGS override (neutral always resets). Frontend hook fix: 0.4.0's
  setExpression rejects the preset still tracked as currentExpression, so the
  hooks clear the tracking (reset -> replay works). Evidence: expr_probe 22/22,
  cmd_probe 61/61, say_probe 12/12, ws 30.1 fps, role 1008, curl 200, inline
  38,285 B, RSS settle 45,248 / 16,672 KB, ports released. Manual half owner-run
  2026-10-22. Full detail: specs/features/2026-10-22-m3.2-m32-expressions/validation.md.
- M4.1: memory/asset optimization + the OBS memory gate — the extra memory is the ps
  RSS delta of OBS's CEF helpers between the source visible + scripted traffic and
  the source hidden and unloaded, read over the last 10 min of each 30-min soak with
  a no-growth rule. The owner amended the gate from < 100 MB to < 180 MB steady
  state on 2026-10-22 (measured baseline 163.5 MB; final 114.8 MB). New tooling:
  mem_probe, traffic_mix, obs_toggle (+ obs_fake), perf_probe, stack.sh; frontend
  reconnect/visibility hardening + the motion-leftover reset (the BubbleGum bubble
  no longer sticks to the mouth); cmd_probe 63/63, say_probe 13/13 x2 (Ketchup
  during every say), expr_probe 22/22, perf 7/7. Evidence: close re-run 2026-10-23 —
  ws 30.0 fps, role 1008, curl 200, inline 41,005 B, RSS 50,896 / 17,056 KB, gate
  PASS 114.8 vs 180; manual pass all nine steps (owner). Review: one reviewer, two
  rounds, final APPROVE. Full detail:
  specs/features/2026-10-22-m4.1-m41-memory-perf/validation.md.
- M3.1: DSH command surface — v1 frames (motion/expression/say/pose/mode) relayed
  as {"relay":...} to the driver, which executes say/pose/mode and forwards
  motion/expression; whale_cmd.py (motion|say|pose|mode) is the DSH tool; the
  say frame gains "src":"mock"|"cmd" (mock never cuts a line, commands keep
  latest-wins, one command queues behind a synthesis). Evidence: cmd_probe
  61/61, say_probe 12/12, ws_probe 30.0 fps, role 1008, curl 200, settled RSS
  54,976 / 22,576 KB, ports released. Full detail:
  specs/features/2026-10-21-m3.1-m31-commands/validation.md.
- M2.2: TTS-driven lip sync — driver edge-tts (zh-CN-XiaoyiNeural, WordBoundary
  timestamps) + macOS say fallback in a short-lived helper (scripts/tts_synth.py,
  45 s timeout), say frames over the existing WS, /audio static mount, frontend
  Web Audio playback + word/amplitude mouth envelope + say priority rule, and
  scripts/say_probe.js. Evidence: say probe PASS 12/12 in both engine passes
  (in-word 100%, latency mean 18 ms / max 32 ms), real headed Chrome pill path
  (suspended -> click -> running), ws_probe 30.0 fps, role probe close 1008,
  RSS node 54,720 KB / driver 22,320 KB, ports released. Manual half
  owner-confirmed 2026-10-21. Full detail:
  specs/features/2026-10-20-m2.2-lipsync/validation.md.
- Agent skills installed in .agents/skills/ (2026-10-20): /spec-plan opens the
  grouped planning round for any roadmap item (use "/spec-plan M2.1");
  /spec-close runs the automatic half + bookkeeping at an item's close;
  /spec-lipsync accelerates M2.2 planning (TTS-driven: edge-tts primary, macOS
  say fallback, word-level envelope + amplitude fallback, browser playback);
  /spec-commands accelerates M3.1 planning (wire-protocol command surface,
  DSH tool surface, Live2D playback semantics, mock-behind-a-flag);
  /spec-expressions accelerates M3.2 planning (text/emotion -> expression
  presets, hybrid routing table, cooldown/priority, zero new deps);
  /spec-perf accelerates M4.1 planning (<180 MB steady-state OBS extra-memory
  measurement protocol, lever audit, leak-soak verification, reconnect hardening).

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
7. M2.2 (replanned 2026-10-20, owner 1a/2/3a/4a): TTS-driven lip sync — explicitly
   specified words are synthesized (edge-tts primary, macOS say fallback) and played
   in the browser via Web Audio; the mouth animates to the words (word-level
   envelope + amplitude fallback). Loopback capture retired.
8. M4.1 hard gate: OBS browser-source steady-state extra memory < 180 MB on the Mac
   (amended 2026-10-22 after the measured baseline; originally < 100 MB).
9. M4.2 deployment (amended 2026-10-20, owner 1a/2a/3a): same-machine localhost is
   the DEFAULT for normal users; cloud deploys use git pull + install-ubuntu.sh +
   systemd (no SSH knowledge); SSH port forwarding is an OPTIONAL advanced mode.
10. M2.1 (2026-10-20): asset = DS鲸鱼娘 (dsh-pet-live2d@3.1.3) under CC BY-NC-SA
    4.0 — personal, non-commercial use, attribution kept; playback hooks are
    frontend-only (wire protocol deferred to M3.1); playMotion uses FORCE priority
    + restart; resetPose() clears leftover motion poses; the validator script is
    the asset gate.
11. M5 (2026-10-21, owner grouped round 1a/2a/3a): the AI-agent progress notifier
    becomes milestone M5 inside V1 — M5.1 session integration + round-finished
    announcement, M5.2 automatic mid-round progress, M5.3 voice commands;
    DSH-first with cross-agent seams ready, registry in whale-girl-server.
    Design drafts: docs/drafts/ai-agent-notifier/.

## 4. In-flight / next
- NOTHING is in flight. M4.1 is fully closed (2026-10-23): merged into main and
  pushed; its local feature branch was deleted. NEXT: M4.2 (deployment for general
  users — install-ubuntu.sh + systemd + nginx TLS + the optional tunnel script;
  same-machine localhost stays the default) via /spec-plan, re-reading the M4.1
  handoff (nothing new is deferred to it — the deployment surface is config only).
- M3.2 is fully closed (2026-10-22): merged into main and pushed; its local
  feature branch was deleted.
- M2.2 is fully closed (2026-10-21): merged into main and pushed; its local
  feature branch was deleted.
- M2.1 is fully closed: merged into main and pushed (2026-10-20); its local
  feature branch was deleted.

## 5. Environment facts (measured 2026-10-19; model added 2026-10-20)
- Node v25.2.0, npm 10.5.2; whale-girl-server/node_modules installed.
- Python 3.9.10; whale-girl-server/.venv with websockets 15.0.1 (newest supporting
  3.9; 16.0 needs 3.10+, 17.x needs 3.11+).
- Ports 3000/3001 free at last check (the close left the stack stopped); env
  knobs PORT, WS_PORT, WHALE_WS, WHALE_MODE, WHALE_CMD_WS,
  WHALE_MODEL_MANIFEST, WHALE_EXPR_TAGS/WHALE_EXPR_COOLDOWN/WHALE_EXPR_IDLE
  (M3.2; WHALE_EXPR_TAGS must be set for both the driver and the CLI).
- Scripts: ws_probe, ws_role_probe, say_probe (M2.2, 13 checks), cmd_probe (M3.1,
  63 checks), expr_probe (M3.2, 22 checks), validate_model; mem_probe, traffic_mix,
  obs_toggle, obs_fake, perf_probe and stack (M4.1); whale_cmd.py (DSH
  motion/say/pose/mode/express), expr_tags.py (tag -> preset table) and
  tts_synth.py (edge-tts helper).
- CDN URLs pinned in tech-stack.md, all verified 200 on 2026-10-19.
- Live2D asset installed at whale-girl-frontend/model/ (4.3 MB, gitignored;
  DS鲸鱼娘, moc3 v4); gate it with node scripts/validate_model.js.
- OBS 32.2.2: the whale Browser source ("浏览器", http://localhost:3000/?debug=1)
  has "Shutdown source when not visible" ON (M4.1 measurement; the page unloads
  when hidden); the obs-websocket plugin config is back to server_enabled:false —
  scripts/obs_toggle.js needs it enabled temporarily for the memory-gate protocol.
- edge-tts 7.3.1 in whale-girl-server/.venv; TTS audio in
  whale-girl-server/audio/ (gitignored, pruned after 1 h);
  scripts/tts_synth.py is the synthesis helper (45 s timeout, JSON words back).

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
- Remote: origin = git@github.com:realalexkwok/whale-girl-monorepo.git; main tracks
  origin/main.
- main carries M1, M2.1, M2.2, M3.1, M3.2 and M4.1. The M4.1 series:
  ac4834f (implementation), 13ab13e (review round 1), 0bfa4a5 (round 2), 4d4c53a
  (close-out) and the close-bookkeeping commit. The ff merge fast-forwarded main and
  the push published it; the local feature/whale-girl-m41-memory-perf branch was
  deleted; working tree clean; on main. The earlier M3.1 (main at 499d75f), M2.2
  (6261a9c) and M3.2 (0326545) histories are preserved in
  specs/history_roadmap.md.
