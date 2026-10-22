# M3.1 — DSH Interaction: AI-Driven Command Surface — Validation

> Status: IMPLEMENTED on feature/whale-girl-m31-commands — **automatic half
> PASS (2026-10-22, 60/60 command checks + the M2.2 regression)**; the manual
> half is owed by the owner at the close. Roadmap tick + history archive happen
> only on the owner's close instruction.

## Automatic verification results (measured 2026-10-22, macOS)
All commands ran from /Users/superguo/Projects/whale-girl-monorepo/whale-girl-server.

| Check | Command | Result |
| --- | --- | --- |
| cmd_probe (v1 frame types end to end) | node scripts/cmd_probe.js | PASS — 60/60 checks (breakdown below), incl. the review-round checks |
| Say schema regression | node scripts/say_probe.js | PASS — 12/12: 9 words, in-word 53/53 (100%), gap max 0.108, latency mean 17 ms / max 31 ms, decoded 847,872 B / 4.42 s |
| CLI validation paths | whale_cmd.py motion Nope / no server | PASS — unknown group exits 2 with the 8 groups listed; connection refused exits 1 with an actionable message |
| Motion probe | node scripts/ws_probe.js | PASS — 30.0 fps over 2.00 s, 61 frames |
| Role probe | node scripts/ws_role_probe.js | PASS — close 1008 + reason |
| HTTP static host | curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ | 200 PASS |
| Frontend inline JS | node --check (extracted script) | PASS — 35,955 B at /tmp/m31-inline.js |
| Memory budget | ps -axo pid,rss,command \| grep -E 'node server.js\|control_whale.py' | Steady-state gate: every probe sample fits — server 49,296 / 51,872 / 47,936 / 49,168 KB (max 51,872), driver 15,664 / 20,272 / 18,240 / 16,976 KB (max 20,272). The boot transient is recorded, not gated: 61,296 KB ~1 s after spawn (informational record), settling to 48,320 KB at t=60 s on a quiet stack — the ≤ 60 MB budget is a steady-state budget, and M4.1 owns the OBS-gate re-measure with audio active |
| Clean shutdown | lsof after SIGTERM | PASS — ports 3000/3001 released (stray processes were checked separately during the smoke runs) |

### cmd_probe.js breakdown (PASS 60/60; a few records are folded into one row)
| Check | Measured |
| --- | --- |
| (boot RSS is printed, not gated) | the server's startup transient is logged as a probe line, not counted as a check |
| command without a driver is refused | close code 4002 |
| foreign origin is rejected | close code 1008 |
| live boot: mock speech paused | 0 say frames in 10 s (WHALE_MODE=live) |
| CLI motion exits 0 | status 0 — sent {"type":"motion","group":"Idle"} (the manifest's first group) |
| CLI rejects an unknown group | exit 2 |
| CLI rejects an out-of-range index | exit 2 |
| CLI rejects an over-long group | exit 2 |
| motion index forwarded | cmdState.last="motion: Idle/0" |
| CLI reports an unreachable server | exit 1 |
| CLI pose applied and cleared | pose exits 0, ParamBrowLY held then gone |
| CLI rejects an over-long say | exit 2 (301 chars) |
| CLI rejects an oversized pose | exit 2 (33 keys) |
| CLI mode exits 0 | mode live (idempotent) exit 0 |
| CLI mode flip produces a mode frame | {"mock":true} via the CLI |
| CLI mode flip restores live | {"mock":false} via the CLI |
| CLI reports a rejected role | exit 1 (server 1008) |
| CLI exits 1 with no driver | exit 1 (4002 path) |
| motion applied on the frontend | cmdState.last="motion: Idle", ok=true (after the hook resolved) |
| expression applied | cmdState.last="expression: 脸红" (the manifest's first expression), ok=true |
| pose overlay held | ParamEyeBallX=0.900 in motion frames (commanded 0.9) |
| pose {} clears | ParamEyeBallX=0.571 (mock gaze resumes) |
| mode mock flip | mode frame {"mock":true}, cmdState.mode="mock" |
| canned speech resumes | /audio/say-<id>.mp3, words=4 |
| mode live flip | mode frame {"mock":false}, cmdState.mode="live" |
| say command frame | /audio/say-<id>.mp3, words=4 — schema == M2.2 |
| say audio served | HTTP 200, content-type audio/mpeg |
| page played the commanded say | engine=edge-tts, decoded 442,368 B, 2.30 s |
| CLI say produces a cmd say frame | new src:"cmd" frame from whale_cmd.py say |
| a bad motion reports ok=false | cmdState.ok=false, console lists the motions |
| a bad expression reports ok=false | cmdState.ok=false, console lists the expressions |
| loopback alias is allowed | origin 127.0.0.1 → open (same machine) |
| motion works in mock mode | cmdState.last="motion: Idle" while the mock talks |
| two rapid commands both send | the one-slot queue: two cmd frames, in order, distinct audio |
| the queued command plays last | the page ends on the second commanded line (latest) |
| say frames carry src | canned src="mock", commanded src="cmd" |
| mock never cuts a commanded line | in mock mode, sampled 1 s into the line: active=true, audio = the commanded file |
| commanded line plays to its end | after the line: last say is still the commanded file |
| pose clears non-synthesized keys | ParamBrowLY present while held, absent from the frames after {} |
| pose {} restores the model default | ParamBrowLY=0 (default 0) via coreModel |
| pose replaces the previous overlay | ParamBrowRY dropped when the next pose omits it |
| idempotent mode keeps a held pose | no mode frame, ParamBrowLY=1 stays |
| a real flip clears the pose | ParamBrowLY gone after the live→mock flip |
| mock say after a live flip is ignored | injected src:"mock" — active=false, no new start |
| a mock say decoding during the live flip does not start | delay-forced race: starts unchanged (no playback start) |
| command flood is rate-capped | dropped 1 → 52 after a 150-frame burst |
| frontend ignores a mock say while a line plays | injected src:"mock" — the page kept the commanded audio |
| driver hold suppresses mock lines | 0 mock frames after the commanded frame |
| bad pose frames are rejected | non-finite / 400-digit / long-key / 33-key poses left the frames clean |
| malformed frames are ignored safely | 11 bad frames (invalid JSON, non-object, non-finite, huge int, long key, 33 keys, CJK keys, > 8 KB multibyte, spoofed web_connected, deep nesting); the expression applied and 36 motion frames still flowed |
| live flip stops a playing canned line | active=false |
| live flip silences canned speech | 0 say frames in 10 s after the flip |
| page joining after the driver | a NEW document (timeOrigin changed) has cmdState.mode="live" |
| observed motion frame under the 8 KB cap | max observed 312 bytes (larger frames are dropped first) |
| malformed frames: stream continued | 36 motion frames while the bad frames arrived |
| motion stream | 30.0 fps over 2.00 s |
| server / driver RSS (every sample) | server 56,336 / 56,800 / 55,120 / 55,728 KB; driver 22,272 / 23,568 / 24,000 / 20,512 KB |
| ports released | :3000 and :3001 free |

Representative driver log lines from the smoke run (copied here — /tmp is
ephemeral):

    [whale-girl] connected: ws://localhost:3001?role=python
    [whale-girl] driver: 30 fps, web clients: 2, mode: mock
    [whale-girl] say: say-<id>.mp3 (5 words, edge-tts, mock)
    [whale-girl] mode: live

The server log shows the aggregate line "http=:3000 ws=:3001 web=N python=1
relayed=N cmds=N dropped=N".

## Manual verification (owner, first-time-user pass — PENDING)
Preconditions: the README quick start (npm install + the venv from
requirements.txt) and the DS鲸鱼娘 model dropped into whale-girl-frontend/model/
(`node scripts/validate_model.js` passes) — without the model the placeholder
renders and motion/expression commands cannot be judged.

### Already verified, do NOT re-run
| Item | What it covered | Verified by |
| --- | --- | --- |
| cmd_probe, 60 checks | every v1 frame type, say schema + one-slot queue, pose-key clearing/replacement, mock/live flips, page-after-driver mode (new document), malformed safety, flood cap, CLI say/mode paths, error paths, loopback alias, every-sample steady-state RSS | agent, 2026-10-22 |
| say_probe, 12 checks | M2.2 speech regression (word timeline, latency, amplitude-free) | agent, 2026-10-22 |
| ws_probe / role probe / curl / node --check | 30.0 fps, close 1008, 200, inline JS syntax (35,955 B) | agent, 2026-10-22 |

1. Terminal 1 — `cd whale-girl-server && npm start` (the log starts with
   `serving … on http://localhost:3000` and `websocket proxy on
   ws://localhost:3001`; the aggregate `http=… ws=… web=…` line appears after
   the driver connects).
2. Terminal 2 — `cd whale-girl-server && .venv/bin/python control_whale.py`
   (log shows `driver: 30 fps … mode: mock`).
3. Browser — open `http://localhost:3000/?debug=1`; the DS鲸鱼娘 idles.
4. From a DSH session (Web or TUI), still in whale-girl-server, send each
   command and watch the browser:
   - `.venv/bin/python scripts/whale_cmd.py motion Hammer` — the hammer motion
     plays; ?debug=1 shows `cmd motion: Hammer`; an unknown group
     (`motion Nope`) prints the 8 groups and exits 2.
   - `.venv/bin/python scripts/whale_cmd.py say 你好，我是鲸鱼娘` — the whale
     speaks with lip sync; the mock is muted while the line plays (canned lines
     never cut it; a new command still may). Send a second say right after: the
     newest line replaces the first (latest-wins), and no line is cut by the mock.
   - `.venv/bin/python scripts/whale_cmd.py pose '{"ParamEyeLOpen":0,"ParamEyeROpen":0}'` —
     the eyes stay shut while held (an unmistakable check; ParamEyeBallX is too
     subtle to judge); `pose '{}'` reopens them. `pose '{"ParamAngleZ":15}'`
     (head tilt) is an alternative.
   - `.venv/bin/python scripts/whale_cmd.py mode live` — the mock mouth/talk
     bursts stop (idle blink/gaze/sway continue); `mode mock` resumes the
     canned speech.
5. OBS — the Browser source shows the same behavior and hears the speech. With
   ?debug=1 in the OBS page (Interact), the status line must read `ws connected`
   (not `ws disconnected (1008)`) and the mode must match the browser tab.
6. Report any failure with the exact command, the ?debug=1 line and the
   console output.

## Handoff to dependant milestones
- M3.2 owns: text/emotion → expression presets via the expression frame +
  frontend execution shipped here; a whale_expression CLI command and the
  MCP tool wrapper may be added there.
- M4.1 owns: the OBS browser-source memory re-measure with audio + live
  commands active, and the server RSS headroom at the OBS gate.
- M5.1/M5.2 own: whale_say as the announcement seam (session naming +
  round-finished / progress text) — the whale_* tool surface is reusable.
