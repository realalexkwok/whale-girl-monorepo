# Whale Girl — AI Agent Progress Notifier / Assistant (DRAFT)

> Date: 2026-10-21 · Status: PROMOTED to roadmap milestone M5 (owner grouped
> round 1a/2a/3a) — items M5.1 / M5.2 / M5.3 in specs/roadmap.md. These drafts
> remain the design source; per-item feature spec trios land when each item is
> planned.

## Product framing
Turn the whale girl from a passive avatar into a proactive AI-agent progress
assistant:

- ATTEND — attach her to an agent session (DSH reference; Claude Code / Codex
  compatible where feasible); the session has a display name she speaks.
- ANNOUNCE — when a round finishes she says: 主人，%会话名%有任务完成啦.
- REPORT — while the user waits for a round to finish, she speaks short
  Chinese progress lines the session emits automatically.
- LISTEN — three voice commands: 有什么会话还在跑？ / 有什么会话未处理？
  (DSH-only) / 停止会话%名字%.

## Architecture — one hub, three surfaces
whale-girl-server grows into the notifier hub (single process, 127.0.0.1):

    [ agents: DSH / Claude Code / Codex / Cursor / Gemini ]
        |  hooks (lifecycle)         |  MCP tools (model-facing)
        v                            v
    [ whale-girl-server hub ]  REST /notify  +  MCP /mcp (streamable HTTP)
        |  session registry {agent, sessionId, name, state, lastFinishedAt}
        v
    [ whale frontend ]  say pipeline (M2.2, DONE) + playMotion/playExpression
                       (M2.1, DONE)  <-  OBS
        ^
    [ voice listener (host process) ]  -> command router -> registry + agent
        control APIs

- One streamable-HTTP MCP server is the right shape: all five researched
  agents register remote-HTTP MCP servers with nearly identical config;
  stdio-per-agent would fork N isolated whale processes with no shared state.
  Bind 127.0.0.1 and validate Origin (MCP 2025-11-25 transport spec).
- Lifecycle hooks POST fire-and-forget to the hub REST endpoint (hook time
  budgets are tight: Claude SessionEnd ~1.5s, Codex Interrupt 1-3s — never
  block).

## Existing foundations (verified in this repo)
- say command end-to-end (M2.2 branch feature/whale-girl-m22-lipsync,
  commit 8a68d2f): edge-tts (zh-CN-XiaoyiNeural) / macOS say fallback,
  /audio serving, browser Web Audio playback, word-envelope mouth, autoplay
  pill. The announcement template is exactly what say already speaks.
- window.whaleModel: playMotion / playExpression / resetPose /
  listMotions / listExpressions (M2.1, DS whale girl, 8 motions / 44
  expressions, model ships voice.json).
- Node hub on :3000/:3001 — natural host for the registry + MCP server.

## Prior art (borrow, don't reinvent)
- tuchg/Lucarne — cross-agent remote control/notifications (Codex/Pi/Grok/CC)
- wyattjoh/claude-code-notification — CC desktop-notification hook
- ChanMeng666/echook — audio notification hooks for CC/Cursor/Codex
- Cactusinhand/mcp_server_notify — "task done" MCP notify server
- devizor/macOS-Notification-MCP — native macOS notifications/TTS MCP tools
- QZYH123/OrbCue — desktop cue showing working/waiting session counts

## Research inputs (subagent reports, 2026-10-21)
- Agent ecosystem: MCP registration + hooks + context injection + external
  control + session naming matrix for Claude Code / Codex CLI / Cursor /
  Gemini CLI / Copilot CLI (full matrix in 01-feature1).
- DSH internals (/Users/superguo/Projects/deepseek-harness, read-only):
  event-sourced session log; turn/end + agent/status idle = round finished;
  ranked integration points in 01/02/03 below.
- Voice input: OBS browser sources block the mic (CEF no getUserMedia
  permission handler) -> recognition MUST run in a host process; Web Speech
  API also blocked in mainland China. MVP: sherpa-onnx KWS (offline,
  ~60-120MB) — details in 03-feature3.

## Decisions (owner, 2026-10-21 — all defaults)
1. SCOPE: DSH-first milestone; cross-agent seams (shared MCP hub + hook POST
   endpoint) are built in but verified with Claude Code / Codex later.
2. ATTACH MECHANISM: per-session MCP mount + lifecycle hooks; a DSH Cordis
   plugin is an optional enhancement, not v0.
3. VOICE MVP: sherpa-onnx KWS (offline, ~60-120 MB); the zero-dep
   SFSpeechRecognizer spike is optional, not required.
4. 停止会话X SLOT: digit enumeration 一…十 (KWS-friendly); free-form names
   are a later upgrade (ASR + grammar).
5. REGISTRY: lives in whale-girl-server (single source of truth); agent APIs
   are only called for control (list/cancel), not as the registry.
