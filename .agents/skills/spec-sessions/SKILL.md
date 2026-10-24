---
name: spec-sessions
description: Plan the Whale Girl M5.1 session-integration item — per-session MCP attach/detach with session naming and the round-finished announcement (turn/end -> say 主人，%会话名%有任务完成啦), the cross-agent lifecycle-hook matrix (DSH SDK/Cordis/Stop-hook; Claude Code Stop/SessionEnd; Codex), the hub registry design, and fixture-driven verification. Use when planning M5.1, session integration, agent lifecycle notifications, attach/detach, or the notifier hub.
---

# Spec-Driven Session-Integration Planning (Whale Girl, M5.1)

This skill ACCELERATES /spec-plan for M5.1. The design research is ALREADY
done and lives in docs/drafts/ai-agent-notifier/ (00-overview + 01-feature1) —
this skill turns it into the grouped ask round and the plan constraints.
(DSH command usage — Web and TUI — is supported; no investigation needed.)

## 1. Read first
- specs/roadmap.md (M5.1 line), specs/tech-stack.md, specs/dev-environment.md
- docs/drafts/ai-agent-notifier/00-overview.md + 01-feature1-session-integration.md
  — the per-agent compatibility matrix, hook wiring, prior art, and the owner
  decisions recorded 2026-10-21 (DSH-first, per-session MCP + lifecycle hooks,
  registry in whale-girl-server, cross-agent seams verified later)
- Handoffs: re-read M4.x validation.md handoffs that name M5
- Current surface: say pipeline (M2.2), v1 command frames (M3.1), expression
  routing (M3.2), frontend window.whaleModel; whale-girl-server is the hub
  host (express + ws already in place)

## 2. Ask-round additions (fold into the /spec-plan questions)
- ATTACH MECHANISM (owner default already decided — confirm, don't re-ask the
  architecture): hub MCP tools whale_attach({session_id,name}) /
  whale_detach({session_id}); DSH mounts the hub per-session via ACP
  session/new mcpServers or a cordis.yml mcp-client instance; Claude Code
  .mcp.json / Codex config.toml equivalents for the later cross-agent pass.
- ROUND-FINISHED SIGNAL -> speech (the matrix in draft 01 is authoritative):
  DSH turn/end (TurnEndReason) + agent/status idle via the SDK session.event
  push (cleanest watcher), the Cordis plugin, or the Stop-hook bridge;
  Claude Code Stop/SessionEnd hooks POST /notify; Codex Stop/SessionEnd.
  Confirm which DSH wiring ships in M5.1 (SDK watcher recommended).
- NAMING: DSH session.rename (web/ACP); Claude Code --name / /rename /
  sessionTitle; Codex names; registry latest-wins; the whale speaks the name
  VERBATIM (never translated).
- ANNOUNCEMENT: the exact template 主人，%会话名%有任务完成啦 through the
  existing say pipeline; paired motion/expression is TBD at planning (owner
  default direction: speech-only v0).
- REMOVAL: whale_detach unregisters and removes injected instruction snippets
  (marker-delimited); agent-disposed / SessionEnd cleanup + stale-entry TTL.

## 3. Hard constraints (enforce in the plan, do not ask)
- Registry lives in whale-girl-server (single source of truth; in-memory +
  a small JSON file — the externalized-state pattern of
  mcp-subconductor / agent-memory-mcp, minus their complexity)
- REST /notify is fire-and-forget (hook time budgets: Claude Code ~1.5 s,
  Codex Interrupt 1-3 s — never block)
- One streamable-HTTP MCP endpoint on 127.0.0.1 with Origin validation
  (MCP 2025-11-25 spec); decide hand-rolled JSON-RPC vs a tiny SDK in the
  ask round
- Memory budgets unchanged; registry growth bounded by the TTL
- Existing gates stay green: ws_probe, ws_role_probe, cmd_probe, say_probe,
  expr_probe

## 4. Verification design (automatic + manual)
- AUTOMATIC (DSH fixtures): feed synthetic lifecycle events (turn/end with
  each TurnEndReason, agent/status idle) through the watcher -> hub -> say;
  assert the announcement frame carries the registry name; attach / detach /
  rename / duplicate-attach / stale-TTL cases; measured end-to-end latency;
  all existing probes green
- MANUAL: a real DSH session (Web or TUI) attaches -> a round finishes -> OBS
  speaks 主人，%会话名%有任务完成啦; rename -> the next announcement uses
  the new name; detach -> silence
- LATER (per the owner's DSH-first decision): Claude Code / Codex cross-agent
  smoke

## 5. Output
- Augmented ask round -> /spec-plan scaffold:
  specs/features/<date>-m51-session-integration/{requirements,plan,validation}.md
- validation.md criteria must include: per-reason fixture PASS, naming
  verbatim check, detach silence, TTL cleanup, latency + RSS measured.
