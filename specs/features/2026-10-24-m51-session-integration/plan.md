# M5.1 Session Integration — Plan

> Branch: feature/whale-girl-m51-session-integration. Answered ask round
> 2026-10-24 (requirements / plan / validation — recommended defaults).
> Implementation starts AFTER the owner's model switch (V4.1-Flash).

## Design shape (one hub, no new processes in the stack)
- whale-girl-server/hub.js — NEW module required by server.js: registry +
  /notify + /mcp on a loopback-only listener; announcements injected into the
  EXISTING relay path (server.js exposes a relay function to hub.js).
- notifier/ — NEW installable DSH bundle package (CHANGED 2026-10-24 from the
  planned SDK watcher, see requirements decision 1): package.json with
  "dsh": {"bundle": {"patch": "./cordis.patch.yml"}}, index.mjs (the in-process
  hook: session/event + agent/status + session/disposed -> filter -> POST
  /notify, contained and allocation-light) and cordis.patch.yml (two insert
  rows: whale-notifier and @deepseek-ai/dsh-mcp-client for the hub). Installed
  through the Plugins page / plugin_manager / `dsh plugin add` — no hand-edited
  profile YAML.
- No new npm/pip dependencies. Env knobs (all optional):
  WHALE_MCP_HOST=127.0.0.1, WHALE_MCP_PORT=3200,
  WHALE_REGISTRY_FILE=whale-girl-server/data/registry.json, WHALE_SESS_TTL=24h,
  WHALE_DSH_SDK_BIN (watcher only).

## Task groups

### Group A — hub module + server wiring
Files: whale-girl-server/hub.js (new), whale-girl-server/server.js (small edit),
.gitignore (+= whale-girl-server/data/).
- Registry: Map<sessionId, {agent, sessionId, name, lastFinishedAt, updatedAt}>
  loaded from the JSON file at boot (corrupt/missing -> empty + one warning
  line), saved atomically (tmp + rename) on every change. TTL: entries with
  updatedAt older than WHALE_SESS_TTL are dropped on access AND by a 5-minute
  sweep timer; updatedAt bumps on attach/rename/announce.
- REST POST /notify: accept JSON {agent, session_id, reason?, ts?} <= 8 KB;
  respond 202 at once. Lookup session_id: miss or expired -> 200 ignored (no
  announcement, never attach implicitly). Hit -> set lastFinishedAt, bump
  updatedAt, build text = "主人，" + name + "有任务完成啦" and hand the v1 say
  frame {"type":"say","text":<text>} to server.js's command relay (string
  concatenation, the same rate-capped path whale_cmd.py uses). No python
  writer -> accepted but unspeakable (mirrors the 4002 "no brain" philosophy:
  one 1 Hz log line, no crash). Hub-level safety: <= 10 announcements/min
  globally (rate-limited log otherwise).
- MCP streamable HTTP /mcp (JSON-RPC 2.0, hand-rolled): initialize (returns
  protocolVersion + capabilities tools listChanged:false), tools/list,
  tools/call with tools
  - whale_attach {session_id: string, name: string} -> registers or renames
    (latest-wins; no announcement on rename); validates session_id non-empty
    <= 256 chars and name non-empty <= 100 chars (error -32602 otherwise);
    returns {ok, entry}.
  - whale_detach {session_id: string} -> removes the entry; returns {ok,
    removed: bool}.
  - whale_sessions {} -> list of entries (for the manual pass).
  Accept POST JSON and GET with Accept: text/event-stream (SSE) minimally —
  the POST JSON path is what DSH's MCP client uses; implement POST-only with
  proper Content-Type checks, document it.
- Origin guard (best-effort, mirrors the WS guard): requests with an Origin
  header whose host is not a loopback host (127.0.0.1/::1/localhost) are
  rejected 403. Requests without Origin (CLIs, DSH's client) pass.
- server.js wiring: require('./hub.js') and call hub.start({relay, log}) —
  relay = the existing relayToPython entry point; nothing in the hot path
  changes (no per-frame work, no JSON parsing of frames added).
Checks: node --check server.js hub.js; curl initialize + tools/list + a
tools/call attach round-trip on 127.0.0.1:3200; notify_probe group C.

### Group B — DSH hook bundle (in-process plugin, installable)
Files: whale-girl-server/notifier/{package.json,index.mjs,cordis.patch.yml,
README.md} (new).
- An installable DSH bundle: package.json declares "dsh": {"bundle": {"patch":
  "./cordis.patch.yml"}} and the patch inserts TWO rows — index.mjs (the hook;
  exports name, apply(ctx, config) and the pure createNotifier() used by
  fixtures) and @deepseek-ai/dsh-mcp-client pointed at the hub (profile-wide
  tools mcp__whale__whale_*). Users install it via the Plugins page,
  plugin_manager install_bundle, or `dsh plugin --profile <name> add <path>`;
  no YAML is edited by hand. No harness imports, no dependencies.
- AUTO-ATTACH (2026-10-24 usability revision): on session/created the plugin
  registers the session itself by calling the hub's MCP whale_attach (JSON-RPC
  over /mcp — no new hub endpoint, so only the plugin file changes), with
  name = basename(header.cwd) fallback "会话"; it skips sessions whose header
  carries parentSession / origin "subagent" / delegationDepth. A
  session/title event re-registers the session with the title, so a DSH rename
  (or the automatic title) is the spoken name and wins over the folder name.
  config.autoAttach (default true) disables it; whale_attach still renames and
  whale_detach mutes.
- Per-session state: lastTurnEndAt (ms), goalActive (from goal/change events).
- Trigger rules:
  - turn/end (reason completed | aborted | blocked | error | max-tokens |
    interrupted | forked | any other): trigger.
  - agent/status idle: fallback trigger ONLY if no turn/end for that session
    within the last 2 s (dedupe window).
  - goal/change: phase 'active' sets goalActive and SUPPRESSES turn/end/idle
    announcements for that session (no spam during goal auto-continuation); a
    complete/blocked/paused/cleared goal lets the next round end announce.
  - session/disposed posts {event:"session_end"} so the hub drops the entry.
- A trigger POSTs /notify {agent:"dsh", session_id, reason} with a 1 s
  AbortSignal to 127.0.0.1:WHALE_MCP_PORT (config.hub overrides); failures are
  logged at <= 1/min and every callback is try/caught so the notifier can never
  disturb the agent session.
Checks: node --check + dynamic import; the fixture state machine is exercised
by notify_probe (group C).

### Group C — fixture probe
File: whale-girl-server/scripts/notify_probe.js (new).
- Boots its own server + python driver (the cmd_probe/say_probe pattern:
  child processes on env-chosen ports, stopped at the end, ports verified
  released), opens one role=web WS client to capture say frames, and drives
  the hub over HTTP (MCP calls + /notify). The plugin state machine is
  imported directly (createNotifier with a fake post) and fed synthetic
  session/event fixtures; the announcement text is read from the additive
  say "text" field.
- Check list (prints the count like cmd_probe):
  1. initialize + tools/list expose the three tools.
  2. whale_attach registers; whale_sessions shows the entry.
  3. duplicate attach with a new name -> latest-wins (name updated, one entry).
  4. /notify for the attached session -> exactly one say frame within the
     latency gate carrying the verbatim name (template 主人，<name>有任务完成啦).
  5. rename -> next /notify speaks the NEW name verbatim.
  6. name with special characters (e.g. "构建%1号", "a'b\"c") round-trips
     verbatim.
  7. /notify for an UNATTACHED session -> no say frame.
  8. whale_detach -> /notify for it -> silence (no say frame).
  9. attach with empty/oversized name -> JSON-RPC -32602 error; no entry.
  10. stale TTL: inject an entry with updatedAt older than TTL (probe uses a
      tiny WHALE_SESS_TTL for its own boot) -> swept, /notify ignored.
  11. per-reason: for EACH TurnEndReason a /notify produces exactly one say
      frame (dedupe/rate-cap sanity).
  12. goal-active suppression is a watcher-side rule -> verified by feeding
      the watcher --fixture stream (goal/change active + turn/end -> no POST;
      goal cleared + turn/end -> POST).
  13. agent-disposed fixture -> watcher POSTs detach-equivalent /notify with
      removed flag (or hub detach call) -> entry gone.
  14. latency: /notify send -> say frame on the web client, mean of N rounds
      < 1000 ms (gate), max reported.
  15. RSS: node server (with hub) and python driver within 60 MB / 30 MB
      budgets after warm-up.
  16. ports released after shutdown; exit code 0 only when all checks pass.
- Report absolute paths + measured numbers (AGENTS.md reporting rule).

### Group D — docs & amendments
Files: specs/tech-stack.md, specs/dev-environment.md, README.md, .gitignore
(part of group A).
- tech-stack.md: M5.1 amendment section — hub module, hand-rolled JSON-RPC
  2.0 streamable HTTP on the loopback listener (no new deps), /notify
  fire-and-forget contract, registry + TTL, the five env knobs, name cap,
  announcement template, speech-only v0, cross-agent seams shipped/verified
  later.
- dev-environment.md: M5.1 runbook — start stack; start
  node scripts/notify_watch.js; mount the hub into a DSH session via ACP
  session/new mcpServers {"whale-girl":{"url":"http://127.0.0.1:3200/mcp"}};
  call whale_attach; what happens on round end; detach. Note the split
  limitation (MCP/notify are loopback-only on the hub host — cross-machine
  notify is out of M5.1 scope; P1 same-machine is the verified pattern).
- README.md: short "AI-agent progress notifier (M5.1)" section with the
  three-line usage.

### Group E — regression gates (all must stay green)
ws_probe (PASS 20–40 fps, monotonic f), ws_role_probe (close 1008),
cmd_probe (63/63), say_probe (13/13), expr_probe (22/22), curl :3000 -> 200,
node --check on the inline frontend script, RSS snapshot, port-release check.

## Memory discipline
- Hub is in the existing node process: no new listeners on the frame path, no
  per-frame allocations, registry writes only on lifecycle events (not per
  frame). Server steady-state RSS <= 60 MB unchanged; driver <= 30 MB.
- The watcher is a separate, tiny process (fixture-measured, reported, no
  budget assigned beyond "small"; it is not in the whale stack's budget).

## Edge cases / failure modes (handled in code + documented)
- Port 3200 busy: warning + hub disabled for that boot (page serving
  unaffected); env-overridable.
- /notify with no python writer: 202 accepted, unspeakable, 1 Hz log.
- Rapid round-fins: say latest-wins queueing (existing M3.1 semantics) + the
  10/min hub cap.
- Registry JSON corrupt: start empty + one warning.
- Agent died without SessionEnd: stale-TTL sweep removes it.
- Split deployment: MCP/notify are loopback-only on the hub host; a DSH
  session on another machine cannot notify (documented; P1 is the verified
  pattern).
- % in names is literal (substitution happens on a JSON-built string, no
  format interpreter).
