# Whale Girl — Mission

> Active project: the **Whale Girl Live2D interactive streaming system**.
> Constitution files: mission.md, tech-stack.md, roadmap.md in this directory.

## What this project is
A low-memory Live2D interactive streaming system. A transparent, OBS-captured PixiJS
canvas renders a Live2D "Whale Girl" avatar whose facial parameters are driven in real
time by a Python "brain" (mock data today; DSH/AI interaction in M3), proxied through a
tiny Node.js WebSocket relay. Development runs entirely on macOS; production splits the
server to a headless Ubuntu box while the frontend stays inside OBS on the Mac.

## What it is not
- Not an Electron / bundled desktop app — the frontend is ONE static HTML file rendered
  in an OBS Browser source.
- Not a heavy Python UI — the driver is a headless asyncio script with zero GUI deps.
- Not a video/audio processing pipeline — OBS owns capture and encoding; this system
  only animates the avatar.
- Not a game engine (no Unity/Unreal/Godot) and not a server-rendered web framework.

## The experience (target, V1)
1. OBS adds a transparent Browser source; the whale girl stands in the stream overlay.
2. Natural idle motion: blinking, gaze drift, breathing sway, occasional talking —
   already live via the M1 mock driver.
3. (M2) TTS-driven lip sync: the whale girl speaks explicitly specified words —
   synthesized speech plays on stream while her mouth animates to the words — plus
   motion/expression playback on the real Live2D model.
4. (M3) DSH interaction: the AI loop decides parameters and expressions, the
   pipeline renders them.
5. (M5) The whale girl attends agent sessions: she announces finished rounds
   (主人，%会话名%有任务完成啦), reports mid-round progress in short Chinese
   lines, and answers voice commands.
6. The streamer runs everything from two terminals on the Mac; later the server half
   moves to Ubuntu with config-only changes (no code paths assume localhost).

## Audiences
- The streamer (owner) — primary operator during development.
- Stream viewers — the eventual consumers, through the OBS output.
- AI agents working in this repo — the specs are their constitution (see AGENTS.md).

## Principles
- **Spec-driven:** this specs/ directory is the constitution; behavior
  changes start here, never in code first.
- **Low memory first:** every process has a measured RSS budget (tech-stack.md); no
  Electron, no heavy UI libraries, no per-frame allocations, no per-frame logging.
- **Splittable by design:** nothing assumes localhost — ports and endpoints are
  env/query configurable so the server can move to Ubuntu without code changes.
- **Human-in-the-loop:** before every write to disk, an ask-user-question round
  covering requirements (scope/decisions/context), plan (task groups), and validation
  (success criteria) must be answered by the user.
- **Two-sided verification:** every verification has an automatic half (agent probes/
  tests) AND a manual half (the user checks the browser/OBS); every report names
  absolute paths and measured numbers (fps, RSS, exit codes).
- **Owner commits:** agents must NOT git commit / git push; the owner reviews and
  commits when instructed.
- **Minimal surface:** V1 (M1–M5) is the commitment; V2/V3 are directional vision,
  not promises. No speculative features.
