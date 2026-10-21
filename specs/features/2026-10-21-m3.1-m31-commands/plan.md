# M3.1 — DSH Interaction: AI-Driven Command Surface — Plan

> Confirmed by the owner (2026-10-21) before implementation; the approved
> plan-mode plan is the source of truth here. Status: implementation in
> progress on feature/whale-girl-m31-commands (agents never git commit /
> push — owner rule).

## Task groups
0. Spec trio + branch (this folder; branch feature/whale-girl-m31-commands
   from main 9eb69f7) — created on the owner's confirmation of the round.
1. T2 — server relay (whale-girl-server/server.js): in the web role's
   message handler, relay text frames ≤ MAX_FRAME_BYTES to pythonClient
   raw (never JSON.parsed); binary/oversized → framesDropped; add
   cmdsRelayed to the aggregate 5 s log line. Check: node --check,
   ws_role_probe close 1008, ws_probe PASS.
2. T3 — driver executor (whale-girl-server/control_whale.py):
   WHALE_MODE (mock default; live when "live"), a pre-allocated
   POSE_OVERRIDES dict, command handling inside read_events —
   motion/expression validated + forwarded, say → trigger_say, pose
   replaces the overlay ({} clears), mode flips + emits a mode frame +
   clears the overlay; synth() applies the overlay after its base values
   and zeroes the mock mouth in live mode; canned phrases gated on mode;
   a say-busy drop is logged; the 1 s log line includes the mode.
   Check: say_probe still PASS (WHALE_SAY_TEXT path untouched), RSS
   driver ≤ 30 MB.
3. T4 — frontend (whale-girl-frontend/index.html): ws.onmessage branches
   for motion{group}/expression{name}/mode{mock}; playMotion /
   playExpression through window.whaleModel; a failure (false/reject) →
   one console.error including listMotions()/listExpressions(), never
   crash; cmdState {last, ok, mode} exposed on whaleModel (probe hook);
   the mode handler calls resetPose(); ?debug=1 shows mode + last
   command. Check: node --check on the extracted inline script.
4. T5 — CLI (whale-girl-server/scripts/whale_cmd.py, new): subcommands
   motion / say / pose / mode; motion groups validated against
   FileReferences.Motions of the local manifest (WHALE_MODEL_MANIFEST
   override; missing manifest → warn + send); connects ?role=web
   (WHALE_CMD_WS override) and sends one compact frame; exit 0 sent /
   1 connection error / 2 validation error. Check: CLI smoke (valid
   motion 0; unknown group 2 + the group list; connection refused 1).
5. T6 — probe (whale-girl-server/scripts/cmd_probe.js, new): zero new
   deps (ws + Chrome CDP, same machinery as say_probe.js); boots server
   + driver (WHALE_MODE=live) + headless Chrome (unique user-data-dir,
   free debug port); a role=web control client sends the commands;
   asserts motion/expression/say/pose/mode per the criteria; RSS + port
   release. Check: PASS.
6. T7 — docs: tech-stack.md (wire protocol v1, both directions, the
   no-parse invariant, the localhost trust note), dev-environment.md
   (DSH command runbook + WHALE_MODE), README.md (interaction section),
   docs/folder-structure.md (the two new scripts).
7. T8 — verification & close (owner-instructed only): full automatic half
   (cmd_probe + ws_probe + role probe + say_probe regression + curl +
   node --check + RSS + ports); first-time-user manual pass in
   validation.md; roadmap tick + history archive + SESSION-CONTEXT; close
   commit → merge into main → push → delete the local branch.

## Design details
- Wire protocol v1 (both directions; roles and frame caps unchanged):
  - web → server → python (commands): {"type":"motion","group":"<g>",
    "index":n}, {"type":"expression","name":"<n>"}, {"type":"say",
    "text":"..."}, {"type":"pose","p":{...}}, {"type":"mode",
    "mock":true|false}. The server only relays; the driver validates.
  - python → server → web (frames): the v0 motion frame unchanged; the
    M2.2 say frame unchanged (byte-compatible); {"type":"motion",
    "group":"<g>","index":n} and {"type":"expression","name":"<n>"}
    forwarded from commands; {"type":"mode","mock":bool} on a flip.
- Driver state: MODE (mock|live), POSE_OVERRIDES (dict). Command frames
  are handled in read_events (rare events, outside the 30 FPS loop);
  forwarding reuses the same ws.send path the say task already uses.
- Frontend: the v1 branches run before the v0 motion-frame branch (v0
  frames carry p, not group); the say branch is untouched; the handler
  records cmdState and, on failure, logs one actionable console.error.
- Error surface: unknown groups are caught CLI-side (manifest) with the
  group list; the frontend catches playback failures (playMotion false/
  reject) with listMotions() output. The pipeline never crashes on a bad
  command (malformed frames are ignored).

## Research findings (verify live during implementation — never assume)
- pixi-live2d-display 0.4.0: model.motion() returns Promise<boolean> (true
  when the motion started) and model.expression() likewise — verified in
  M2.1; the probe asserts cmdState.ok (the hook's resolved value) rather
  than internal manager state.
- websockets 15.0.1 asyncio: the say task already calls ws.send while the
  30 FPS loop sends; forwarding motion/expression frames from read_events
  reuses the same concurrent-send path (one write per frame, no interleave
  within a frame).
- The model manifest whale-girl-frontend/model/whale.model3.json (5,601 B,
  gitignored) lists FileReferences.Motions with 8 groups — the CLI's
  validation source; it is absent in a split deployment → warn + send.

## Files
- whale-girl-server/server.js, whale-girl-server/control_whale.py
- whale-girl-server/scripts/whale_cmd.py (new)
- whale-girl-server/scripts/cmd_probe.js (new)
- whale-girl-frontend/index.html
- specs/tech-stack.md, specs/dev-environment.md, README.md,
  docs/folder-structure.md
- specs/features/2026-10-21-m3.1-m31-commands/{requirements,plan,
  validation}.md (this trio)
- NOT touched: package.json, requirements.txt, the model assets,
  ws_probe.js / ws_role_probe.js, say_probe.js (regression only).

## Memory & quality gates
- No new dependencies (CLI: the venv's websockets; probe: the pinned ws).
- Budgets server ≤ 60 MB / driver ≤ 30 MB RSS; commands are event-driven,
  so the driver's per-frame cost is unchanged; the pose overlay mutates a
  pre-allocated dict in synth(); no per-frame logging; node --check on the
  inline script; CDN pins untouched.
- The say path must stay byte-compatible: say_probe.js is re-run as a
  regression, not modified.

## Implementation notes (2026-10-21, fix round)
- The owner's manual half surfaced two issues: (1) the pose test used
  ParamEyeBallX, too subtle to judge — the manual step now holds the eyes shut
  (ParamEyeLOpen/ROpen = 0; ParamAngleZ = 15 as an alternative, both exist in
  the 247-parameter model); (2) canned mock lines cut playing speech at a
  frantic pace (the driver's "busy" check covered synthesis only, not
  playback, and the frontend was latest-wins for every say).
- Fix (owner answer "A"): say frames carry an additive "src":"mock"|"cmd"; the
  driver holds mock triggers until the line ends (SAY_HOLD_UNTIL = words end +
  0.3 s, estimated for the macOS-say fallback) and queues a commanded say
  behind an in-flight synthesis (one slot); the frontend ignores src:"mock"
  while a line plays. Commanded says keep latest-wins.
- Verification after the fix: cmd_probe 18/18 (new: src fields, mock never
  cuts a commanded line), say_probe 12/12, ws_probe 30.0 fps, role probe 1008,
  curl 200, node --check 31,122 B, ports released.

## Validation plan
- Automatic: cmd_probe.js per-frame-type assertions, say byte-compat,
  mock pause both ways, RSS snapshot with commands active; ws_probe
  20–40 fps; ws_role_probe close 1008; curl :3000 200; node --check;
  ports released.
- Manual (owner): a real DSH session (Web or TUI) sends each command; OBS
  shows the motion, the speech, the held pose and the mode flip; ?debug=1
  shows the last command + mode.
