# M3.1 — DSH Interaction: AI-Driven Command Surface — Requirements

> Confirmed by the owner (2026-10-21, grouped ask round: requirements / plan /
> validation; answers: full skill default / symmetric WS relay + driver
> executor / cmd_probe.js + full gate). Status: planning complete —
> implementation in progress on feature/whale-girl-m31-commands.

## Scope
- Real DSH sessions drive the whale through a wire-protocol **v1 command
  surface**, replacing mock talk synthesis; mock mode stays behind a flag
  (WHALE_MODE=mock|live, default mock).
- Frame family: motion / expression / say (unchanged) / pose / mode.
  Expression **transport + execution** ships here; the text/emotion → preset
  selection stays in M3.2 (owner decision).
- Ingress: the server relays web→python text frames **raw** (it never parses
  JSON); the driver executes commands and forwards motion/expression frames
  to the frontend through its existing python connection; the frontend
  executes them on the M2.1 playback hooks. No new process, no new transport.
- Native CLI tool whale-girl-server/scripts/whale_cmd.py with the DSH tool
  surface: whale_motion(group,index), whale_say(text) (reuses M2.2),
  whale_pose(p), whale_mode(mock) — snake_case whale_* names per
  mcp-builder conventions, mapped to the CLI subcommands (whale_motion →
  motion, whale_say → say, whale_pose → pose, whale_mode → mode); actionable
  errors (unknown group → the motion group list in the error text).
- Probe whale-girl-server/scripts/cmd_probe.js: every v1 frame type end to
  end (CDP-style), say byte-compatibility, mock-pause both ways, RSS.

## Decisions (ask round 2026-10-21, owner)
1. Requirements bundle — **full skill default**: motion + pose + mode +
   expression transport + say unchanged; native CLI with the whale_*
   surface; documented MCP tool names (no MCP server wrapper in M3.1).
2. Plan — **symmetric WS relay + driver executor**: server.js gains one raw
   relay branch (web → python); the driver owns say synthesis, the pose
   overlay and the mode flag; the frontend only executes motion/expression/
   mode frames.
3. Validation — **cmd_probe.js + full gate** (automatic) + the owner's
   manual pass from a real DSH session in OBS.
4. Fix round 2026-10-21 (owner answer "A"): a mock (canned) line must never
   interrupt a playing line — say frames gain an additive
   "src":"mock"|"cmd" field, the driver suppresses canned triggers until a
   line ends and queues one commanded say behind an in-flight synthesis, and
   the frontend ignores src:"mock" while a line plays; a commanded say keeps
   latest-wins. The manual pose step now uses the eyes-closed parameter
   (ParamEyeBallX was too subtle to judge).

## Semantics (binding)
- Priority ladder: **say > motion > mock envelope**. The existing frontend
  rule (a live say skips the motion-frame ParamMouthOpenY) is unchanged.
- playMotion uses FORCE priority + restart (M2.1 precedent); resetPose() runs
  on a mode switch.
- pose = **driver-side overlay**: each pose command replaces the overlay,
  {} clears it; the values win in synth() until cleared or a mode flip; pose
  frames are never sent to web — the overridden values arrive inside normal
  motion frames (the frontend needs no new path).
- mode: WHALE_MODE=mock|live (default mock) + a runtime mode frame. Live
  mode pauses mock talk bursts + canned phrases and zeroes the mock mouth;
  idle blink/gaze/sway keep streaming. On a flip the driver clears the pose
  overlay and emits {"type":"mode","mock":true|false} to web; the frontend
  calls resetPose() and shows the mode in ?debug=1. WHALE_SAY_TEXT keeps
  working in both modes (say_probe depends on it).
- say while a synthesis is in flight → the newest commanded say is queued
  (one slot) behind it; a mock say in that window is dropped with a log. TTS
  failures still fall back edge-tts → macOS say → no frame (mock keeps the
  mouth in mock mode; silent in live mode).
- DSH flow: a DSH session tool (native CLI here; MCP surface documented by
  name) sends a v1 frame to WS :3001 as ?role=web → the server relays it
  raw → the driver executes/forwards → the frontend hooks. No new port.

## Context
- Handoffs honoured (all **implemented**, none replanned/cancelled):
  - M1: "replacing mock synthesis with real AI-driven parameter commands;
    mock mode stays behind a flag" → the mode flag + command executor.
  - M2.1: "wire-protocol commands that trigger the M2.1 playback hooks from
    real AI" → motion/expression frames → window.whaleModel hooks.
  - M2.2: "real DSH text → say commands — the canned-phrase picker and
    WHALE_SAY_TEXT are the seam" → whale_say(text) reuses send_say; the
    canned picker pauses in live mode; WHALE_SAY_TEXT is unchanged.
- Hard constraints (tech-stack.md): the server keeps raw-text passthrough
  (never JSON.parses); no new dependencies (the CLI uses the venv's
  websockets, the probe the pinned ws); no per-frame allocations — commands
  are one-shot events, unlike the 30 FPS stream; budgets server ≤ 60 MB /
  driver ≤ 30 MB RSS; no per-frame logging.
- Trust model: localhost/V1 — any web client can command the whale. Accepted
  and documented; V3 owns WebSocket auth.
- The model manifest (whale-girl-frontend/model/whale.model3.json, gitignored)
  is the CLI's validation source; in a split deployment it may be absent →
  the CLI warns and sends anyway.

## Validation criteria (owner answer 3)
- Automatic: cmd_probe.js PASS — motion executes (frontend cmdState ok),
  expression executes, the outbound say frame is byte-compatible with
  M2.2 (schema + playback active), the pose value is held inside motion
  frames and cleared by {}, mode live → no say frames for ≥ 10 s with the
  mode frame observed, mode mock restores the canned speech; ws_probe
  20–40 fps; role probe close 1008; curl :3000 200; node --check on the
  inline script; RSS server ≤ 60 MB / driver ≤ 30 MB with commands active;
  ports released after shutdown.
- Manual (owner, at the close): from a DSH session (Web or TUI) run
  `whale_cmd.py motion Hammer`, `whale_cmd.py say 你好，我是鲸鱼娘`,
  `whale_cmd.py pose '{"ParamEyeBallX":0.8}'`, `whale_cmd.py mode live`
  (mock talking stops), `whale_cmd.py mode mock` (resumes); ?debug=1 shows
  the last command + mode; OBS reflects every step.
