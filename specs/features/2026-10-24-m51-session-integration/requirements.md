# M5.1 Session Integration — Requirements

> Status: planning round answered 2026-10-24 (owner; all three groups chose the
> recommended defaults). Design source: docs/drafts/ai-agent-notifier/00-overview.md
> and 01-feature1-session-integration.md (promoted to milestone M5 on 2026-10-21).

## Scope
- Build the M5.1 slice of the notifier hub INSIDE whale-girl-server: a session
  registry, the attach/detach MCP tools, a fire-and-forget REST /notify endpoint,
  and an in-process DSH hook plugin that turns round-finished signals into speech.
- When a watched DSH session finishes a round, the whale says the fixed template
  主人，%会话名%有任务完成啦 through the EXISTING say pipeline (M2.2 speech +
  M3.1 command relay) — no new speech machinery.
- Attach / detach / rename a session from within the DSH session itself via MCP
  tools; removal stops all announcements for that session.
- Cross-agent seams (Claude Code / Codex / Cursor / Gemini / Copilot hooks) are
  SHIPPED as the same REST /notify contract but are VERIFIED later (owner
  DSH-first decision 2026-10-21). DSH is the reference implementation in M5.1.
- Speech-only v0: no paired motion/expression with the announcement.

## Decisions (owner-confirmed 2026-10-24, recommended defaults)
1. DSH wiring = in-process Cordis plugin (CHANGED 2026-10-24 during
   implementation; the planning default was an SDK stdio watcher). Finding,
   verified in the harness source: DSH runs each interactive session in its own
   process/runtime, and the SDK's session.event push covers only the sessions
   inside the runtime an SDK client spawns (protocol types.ts: "every session in
   the runtime"), so an external watcher can never see a TUI/Web round. The
   documented extension point is a Cordis plugin, shipped as an INSTALLABLE
   DSH BUNDLE (owner feedback 2026-10-24: a source/config patch would not be
   accepted by users): whale-girl-server/notifier/ is a package with
   "dsh": {"bundle": {"patch": "./cordis.patch.yml"}} whose patch inserts two
   rows — index.mjs (the hook: session/event, agent/status, session/disposed ->
   POST /notify) and @deepseek-ai/dsh-mcp-client (the hub as a profile-wide MCP
   server, so every session gets mcp__whale__whale_attach/detach/sessions).
   Users install it from the Plugins page, the plugin_manager tool, or
   `dsh plugin ... add <path>`; no YAML editing. The install path was verified
   against the harness plugin-manager code 2026-10-24. The SDK watcher and the
   experimental Stop-hook bridge remain future options, not v0.
2. MCP transport = hand-rolled JSON-RPC 2.0 over streamable HTTP (MCP
   2025-11-25 shape: initialize / notifications/initialized / tools/list /
   tools/call, with the POST response as SSE or plain JSON). ZERO new npm/pip
   dependencies — tech-stack discipline.
3. Announcement = the template with the session name substituted VERBATIM
   (never translated, never interpreted — no format-string semantics for %).
4. Context/instruction injection is owned by M5.2 — M5.1's whale_detach removes
   ONLY the registry entry; the marker-delimited snippet-removal machinery is
   designed and shipped with M5.2's injection.
5. Registry = single source of truth in whale-girl-server: an in-memory Map +
   a small JSON file (whale-girl-server/data/registry.json, NEW + gitignored),
   the externalized-state pattern, minus the complexity of the prior-art
   servers. Entries: {agent, sessionId, name, lastFinishedAt, updatedAt}.
   Stale-entry TTL (default 24 h) with sweep-on-access + a periodic timer.
6. Endpoint placement = ONE new loopback-only HTTP listener
   (WHALE_MCP_HOST default 127.0.0.1, WHALE_MCP_PORT default 3200) inside the
   existing node process serving BOTH /mcp (streamable HTTP) and /notify
   (REST POST). The express :3000 page server is untouched; RSS budget
   unchanged (server <= 60 MB steady state).
7. /notify is fire-and-forget: 202 immediately, never block (hook time budgets
   are ~1.5 s for Claude Code / 1–3 s for Codex). Only ATTACHED sessions
   announce; unknown sessions are ignored (anti-spam gate).
8. Announcements ride the existing say relay: the hub builds the exact v1 say
   frame text and hands it to server.js's relay — the M2.2/M3.1 pipeline,
   priorities, 300-char cap and latest-wins queueing are reused unchanged.
9. Round-finished detection: turn/end (every TurnEndReason) is the trigger;
   agent/status idle is a fallback trigger deduped by a 2 s window; goal
   auto-continuation rounds are SUPPRESSED (goal/change events tracked per
   session) so she does not spam during goal loops.
10. Session names: <= 100 chars, non-empty (attach rejects otherwise).
11. The say frame gains an ADDITIVE "text" field carrying the spoken words
    (M5.1, 2026-10-24): the notifier probe verifies the announcement text without
    decoding audio, and the M5.4 notification history will reuse it. The frontend
    ignores unknown fields; the M2.2 shape (audio/words/src) is unchanged.

## Context
- Handoff re-read (mandatory): M4.1 and M4.2 validation.md handoffs state
  "M5.1/M5.2 own nothing new" — confirmed; nothing to implement or re-plan.
- Existing foundations: say end-to-end (edge-tts zh-CN-XiaoyiNeural / macOS say
  fallback, /audio serving, Web Audio playback, word envelope), v1 command
  frames (web -> server relay {"relay":...} -> python driver), window.whaleModel
  hooks, express + ws hub on :3000/:3001.
- DSH surface (verified in the harness repo 2026-10-21): one session store
  behind GUI :3080 / headless / SDK / ACP; per-session MCP mount via ACP
  session/new mcpServers (packages/acp/acp/src/mcp.ts:26-72); session.rename
  writes session/title (packages/api/session-controller/src/index.ts:430);
  turn/end carries TurnEndReason (types.ts:202-233).
- DSH SDK runtime binary for the watcher:
  /Users/superguo/Projects/deepseek-harness/dist-exe/deepseek-harness-sdk-runtime-macos-arm64
  (env knob WHALE_DSH_SDK_BIN; the path is NOT committed).
- Prior art consulted: Lucarne, claude-code-notification, echook,
  mcp_server_notify, OrbCue (design reference only, nothing copied).
