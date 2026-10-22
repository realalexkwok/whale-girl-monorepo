---
name: spec-commands
description: Plan the Whale Girl M3.1 AI-driven command surface — wire-protocol commands (motion / say / pose / mode) from the DSH brain replacing mock synthesis, the DSH tool surface, Live2D playback semantics, priority rules, and mock-behind-a-flag. Use when planning M3.1, AI-driven parameter/motion commands, wire-protocol extensions, or the DSH interaction layer.
---

# Spec-Driven Command-Surface Planning (Whale Girl, M3.1)

This skill ACCELERATES /spec-plan for M3.1. Run /spec-plan for the trio
scaffold and workflow rules; this skill supplies the M3.1 content.
(DSH command usage — Web and TUI — is already supported and needs no
investigation; only the command DESIGN is planned here.)

Status: IMPLEMENTED 2026-10-22 (automatic half green; owner manual half
pending) — the shipped design is recorded below so a future item (M3.2, M5)
works from reality, not from the pre-implementation draft:
specs/features/2026-10-21-m3.1-m31-commands/ and specs/tech-stack.md
("Wire protocol v1").

## 1. Read first
- specs/roadmap.md (M3.1 / M3.2 lines), specs/tech-stack.md (wire protocol
  v0, memory budgets), specs/dev-environment.md
- Handoffs M3.1 MUST honour:
  - specs/features/2026-10-20-m2.1-model-integration/validation.md —
    "M3.1 owns: wire-protocol commands that trigger the M2.1 playback hooks
    from real AI (the frontend API now exists; the protocol change was
    deferred)"
  - specs/history_roadmap.md M2.1 archive (same wording)
- M2.2 precedent: the say frame ({"type":"say","audio","words"}) — M3.1
  GENERALIZES this frame family; the say path stays byte-compatible.
- Frontend hooks (M2.1): window.whaleModel.playMotion(group,index) (FORCE
  priority + restart), playExpression(name), resetPose(), listMotions(),
  listExpressions() — 8 motions / 44 expressions on the DS whale girl.

## 2. Ask-round additions (fold into the /spec-plan questions)
- PROTOCOL: v1 command frames — {"type":"motion","group","index"} /
  {"type":"expression","name"} / {"type":"say","text"} /
  {"type":"pose","p":{...}} (driver-side overlay; {} clears; max 32 keys,
  finite numbers) / {"type":"mode","mock":true|false}; the server tags
  web-role frames as {"relay":"<frame>"} before relaying them to the python
  writer (string concatenation, still no parsing). Outbound: the v0 motion
  frame, the M2.2 say frame (unchanged shape + additive "src":"mock"|"cmd"),
  forwarded motion/expression, and a mode frame on connect + real flips.
  Expressions are M3.2's vehicle — M3.1 ships transport + execution
- TOOL SURFACE (what a DSH session calls): whale_motion(group,index),
  whale_say(text) (reuses M2.2), whale_pose(p), whale_mode(mock) —
  snake_case whale_* prefix per mcp-builder conventions, implemented by
  whale-girl-server/scripts/whale_cmd.py subcommands motion / say / pose /
  mode; actionable errors (unknown group/index -> the manifest group list)
- SEMANTICS: priority ladder say > motion > mock envelope; playMotion FORCE
  + restart (M2.1 precedent); resetPose() on mode switch; no double-driving
- MOCK FLAG: WHALE_MODE=mock is the default today; the mode frame flips at
  runtime; mock synthesis pauses while live commands drive the mouth
- DSH FLOW (shipped): a DSH session tool (native CLI here; MCP surface by
  name) connects ?role=web -> the server relays the frame tagged
  {"relay":...} to the python writer -> the driver executes say (TTS) / pose
  (overlay) / mode (flag) and forwards motion/expression -> the frontend runs
  them on the M2.1 hooks (no new process, no new transport)

## 3. Hard constraints (enforce in the plan, do not ask)
- The server keeps raw-text passthrough (never JSON.parses frames); new
  frame types are the endpoints' business
- No new frontend dependencies — commands reuse the M2.1 hook API as-is
- No per-frame allocations: commands are one-shot (unlike the 30 FPS mock
  stream); the frame handler stays lean
- Memory budgets unchanged; a live-command session must not change the
  driver RSS profile (measure it)

## 4. Verification design (automatic + manual)
- AUTOMATIC: a new probe (scripts/cmd_probe.js) sends each new frame type to
  a connected web client and asserts the frontend applied it (via
  window.whaleModel state / console hooks, CDP-style like the M2.1 checks);
  ws_probe + role probe stay green; RSS snapshot within budget
- MANUAL: the owner triggers commands from a DSH session (Web or TUI) and
  watches the whale play the motion / speak / flip mock mode in OBS;
  ?debug=1 shows the mode and the last motion/expression/mode command (say and
  pose do not set it)

## 5. Output
- Augmented ask round -> /spec-plan scaffold:
  specs/features/2026-10-21-m3.1-m31-commands/{requirements,plan,validation}.md
  (the scaffold lowercases the item id, hence "m3.1")
- validation.md criteria must include: per-frame-type probe PASS, say
  byte-compatibility, RSS within budget, and the mock-flag flip verified.
