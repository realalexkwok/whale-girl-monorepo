# Feature 1 — Session integration (attach · name · round-finished)

## Requirements (product view)
1.1 User adds the whale girl to the CURRENT session via MCP or a plugin.
1.2 User sets a display name for the session; the whale speaks it verbatim
    (never translated).
1.3 Removal is supported (and stops all announcements for that session).
1.4 When the session finishes a round, she says: 主人，%会话名%有任务完成啦.
1.5 Compatible with other AI agents where feasible; DSH is the reference
    implementation (it CAN speak Claude-Code-style hooks, see below).

## Attach / detach
- Hub tool whale_attach({session_id, name}) registers
  {agent, sessionId, name} in the whale-girl-server registry;
  whale_detach({session_id}) removes it (registry entry + injected
  instructions snippet, which carries begin/end markers so removal is exact).
- DSH mounting options (verified in harness code):
  (a) per-session MCP mount via ACP session/new mcpServers
      (packages/acp/acp/src/mcp.ts:26-72) — the cleanest "add to THIS
      session" path; (b) global per-profile mcp-client cordis.yml instance
      (packages/mcp/mcp-client/src/index.ts:119-142) — tools appear in every
      session. DSH is MCP-client only; no DSH-side MCP server exists.
- Claude Code: project .mcp.json {"mcpServers":{"whale-girl":{"type":"http",
  "url":"http://127.0.0.1:PORT/mcp"}}} (+ claude mcp add). Codex:
  [mcp_servers.whale-girl] url = "http://127.0.0.1:PORT/mcp" in
  ~/.codex/config.toml. Cursor/Gemini/Copilot: equivalent mcp.json /
  settings.json / mcp-config.json entries (matrix in research report).

## Session naming
- DSH: session.rename (web API :3080 — packages/api/session-controller/
  src/index.ts:430; ACP equivalent) writes a session/title event; list
  metadata exposes "title". whale_attach can set/read it.
- Claude Code: claude --name / /rename; SessionStart hook payload offers
  session_title (and a hook may RETURN sessionTitle).
- Codex: sessions have names (codex queue/archive/delete accept name).
- Cursor/Gemini: no user names — fall back to hook payload IDs
  (conversation_id / GEMINI_SESSION_ID) + DSH-style first-prompt titles.

## Round-finished signal -> speech (compatibility matrix, evidence-cited)
| Agent | Signal | Wiring for the hub |
| --- | --- | --- |
| DSH | "turn/end" event (reason: completed / aborted / blocked / error / max-tokens / interrupted / forked) + "agent/status" idle | (1) SDK stdio session.event push (packages/sdk/server/src/server.ts:103-119) — cleanest external watcher, no polling; (2) in-process Cordis plugin listening "session/event" (core/session/src/index.ts:74); (3) Claude-Code-compatible Stop hook via @deepseek-ai/dsh-hooks-claude-code (experimental/hooks-claude-code/src/index.ts:276-283 — needs a cordis.yml profile patch; NOT in shipped bundles) |
| Claude Code | Stop + SessionEnd hooks (~34 events; Notification: idle_prompt fires ~60s after finish with no input) | hooks command -> POST /notify {agent:"claude", session_id, name} |
| Codex | Stop + SessionEnd + Interrupt hooks (2026 hooks.json) | same POST |
| Cursor | stop / sessionEnd hooks | same POST |
| Gemini | AfterAgent / SessionEnd / Notification hooks | same POST |
| Copilot CLI | NO hooks — degraded mode: the model calls whale_notify itself (MCP tool) | context injection only |

- Hub maps the event to the say command with the exact template
  主人，%会话名%有任务完成啦 (session name substituted from the registry,
  untouched by translation). Paired motion/expression: TBD at N1 planning
  (owner default direction: keep v0 speech-only).

## DSH-specific gold (from harness investigation)
- One process serves GUI :3080, headless, SDK and ACP profiles against the
  SAME session store — the whale can watch any surface.
- turn/end carries TurnEndReason (types.ts:202-233) — the whale could vary
  the line per reason later (完成啦 / 被中断啦 / 出错啦).
- Goal auto-continuation also ends "rounds" (goal-round-driver listens
  agent/status idle) — the whale must distinguish a goal-round finish from a
  user-facing finish (goal/change events) so she doesn't spam.

## Removal edge cases
- Agent process dies while attached: hook session (agent/disposed, SessionEnd)
  also unregisters (or marks stale, TTL cleanup).
- Same session re-attached with a new name: latest-wins, re-speaks nothing.

## Acceptance sketch
1. Attach in a DSH session -> round finishes -> whale speaks the template
   with the session name (heard in OBS).
2. Rename -> next announcement uses the new name.
3. Detach -> announcements stop for that session.
4. (If in scope) same flow through Claude Code / Codex hooks.
