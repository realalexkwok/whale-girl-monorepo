# M5.1 Session Integration — Validation

> Criteria answered 2026-10-24 (recommended defaults). Results are filled in
> at implementation; the automatic half runs on the Mac stack, the manual half
> is a real DSH session. Results tables are empty until the implementation
> round.

## Success criteria
1. notify_probe (whale-girl-server/scripts/notify_probe.js) — ALL checks
   green (attach/detach/rename/latest-wins/TTL/per-reason/verbatim-name/
   goal-suppression/session-dispose/unattached-ignored + the plugin fixture
   state machine incl. AUTO-ATTACH on session/created with cwd naming, the
   subagent skip and config.autoAttach=false), hub accept latency < 100 ms,
   end-to-end announce latency
   reported (mean/max, includes TTS synthesis; the measured 842 ms is under
   the 1 s intent), node + driver RSS within 60/30 MB, ports released; prints
   its check count.
2. Existing gates stay green: ws_probe PASS 20–40 fps monotonic f,
   ws_role_probe close 1008, cmd_probe 63/63, say_probe 13/13, expr_probe
   22/22, curl :3000 -> 200, inline frontend node --check.
3. Manual half (owner): with the notifier bundle installed (Plugins page /
   plugin_manager / dsh plugin add) in a real DSH session (Web or TUI) running
   on the SAME host as the whale stack (the Ubuntu box in the deployed setup;
   the page/OBS on the Mac hears it through the existing 3000/3001 tunnel), or
   on the Mac with -L 3200 in the tunnel — call mcp__whale__whale_attach (or
   whale_attach via an ACP mount) with session_id = $DSH_SESSION_ID, a round
   finishes -> the whale speaks 主人，%会话名%有任务完成啦 in OBS; rename ->
   the NEXT announcement uses the new name; detach -> silence.

## Automatic results (fill at implementation)

| # | Check | Result |
| --- | --- | --- |
| 1 | notify_probe full suite (21 checks) | PASS 21/21 (2026-10-24) |
| 2 | hub accept latency (gate < 100 ms) + end-to-end mean/max | PASS 3 ms; end-to-end n=8 mean 496 ms max 541 ms (TTS included; 1 s intent met) |
| 3 | server RSS w/ hub (budget 60 MB) | 53.7 MB probe / 51,536 KB stack (sync 2026-10-24) |
| 4 | driver RSS (budget 30 MB) | 19.4 MB probe / 16,864 KB stack |
| 5 | ws_probe | PASS 30.0 fps, 61 frames over 2.00 s |
| 6 | ws_role_probe 1008 | PASS close 1008 |
| 7 | cmd_probe 63/63 | PASS 63 checks |
| 8 | say_probe 13/13 | PASS 13 checks (edge-tts) |
| 9 | expr_probe 22/22 | PASS 22 checks |
| 10 | curl :3000 -> 200 | PASS 200 |
| 11 | node --check (server, hub, plugin import, probe, inline 40,947 B) | PASS |
| 12 | ports released after probes | PASS 3000/3001/3200 (+ probe TTL port) |

## Manual results (owner — fill at close)

| Step | Action | Result |
| --- | --- | --- |
| 1 | Attach a real DSH session (ACP mount + whale_attach) | (pending) |
| 2 | Round finishes -> whale speaks the template with the session name (OBS) | (pending) |
| 3 | Rename -> next announcement uses the new name | (pending) |
| 4 | Detach -> announcements stop for that session | (pending) |
| 5 | No announcement during a goal auto-continuation round | (pending) |

## Handoff to dependant milestones
- M5.2 owns: context/instruction injection (CLAUDE.md / AGENTS.md / GEMINI.md
  / .cursor rules / DSH profile) and the marker-delimited snippet-removal
  machinery (M5.1 detach removes only the registry entry); the whale_progress
  MCP tool; the speech policy (cooldown, priority, session name untranslated).
- M5.3 owns: voice commands — it consumes the hub registry (list/query by
  state and lastFinishedAt) and session.cancel control; M5.1 must therefore
  keep the registry queryable (whale_sessions) and record lastFinishedAt.
- M5.4 owns: the context-menu 最近通知 notification history — its cap and
  retention policy; M5.1/M5.2 must LOG each spoken announcement/progress line
  to the hub notification log (bounded ring buffer in the registry JSON or a
  sibling file) so M5.4 only adds the UI.
- Cross-agent hook verification (Claude Code / Codex / Cursor / Gemini /
  Copilot configs) is deferred per the owner's DSH-first decision — the
  shared /notify contract ships in M5.1; hook-side smoke tests are owed
  whenever the owner opts in.
- Reason-specific announcement lines (完成啦 / 被中断啦 / 出错啦 per
  TurnEndReason) are deferred — M5.1 speaks the fixed template.
