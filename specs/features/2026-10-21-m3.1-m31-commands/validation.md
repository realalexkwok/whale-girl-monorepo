# M3.1 — DSH Interaction: AI-Driven Command Surface — Validation

> Status: IMPLEMENTED on feature/whale-girl-m31-commands — **automatic half
> PASS (2026-10-21)**; the manual half is owed by the owner at the close.
> Roadmap tick + history archive happen only on the owner's close instruction.

## Automatic verification results (measured 2026-10-21, macOS)
All commands ran from /Users/superguo/Projects/whale-girl-monorepo/whale-girl-server.

| Check | Command | Result |
| --- | --- | --- |
| cmd_probe (v1 frame types end to end) | node scripts/cmd_probe.js | PASS — 18/18 checks (breakdown below), incl. the fix-round checks |
| Say byte-compatibility regression | node scripts/say_probe.js | PASS — 12/12: 9 words, in-word 52/52 (100%), gap max 0.079, latency mean 17 ms / max 35 ms, decoded 847,872 B / 4.42 s |
| CLI validation paths | whale_cmd.py motion Nope / no server | PASS — unknown group exits 2 with the 8 groups listed; connection refused exits 1 with an actionable message |
| Motion probe | node scripts/ws_probe.js | PASS — 30.0 fps over 2.00 s, 61 frames |
| Role probe | node scripts/ws_role_probe.js | PASS — close 1008 + reason |
| HTTP static host | curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ | 200 PASS |
| Frontend inline JS | node --check (extracted script) | PASS — 31,122 B at /tmp/m31-inline.js |
| Memory budget | ps -axo pid,rss,command \| grep -E 'node server.js\|control_whale.py' | PASS in the probe runs — cmd_probe 48,384 / 20,160 KB; say_probe 51,984 / 20,800 KB. The restarted standalone stack measured 62,336 / 28,960 KB — the server's noisy end (29–63 MB observed across runs; M4.1 owns the OBS-gate multi-sample re-measure), driver within 30 MB |
| Clean shutdown | lsof after SIGTERM | PASS — ports 3000/3001 released, no stray processes |

### cmd_probe.js breakdown (PASS 18/18)
| Check | Measured |
| --- | --- |
| live boot: mock speech paused | 0 say frames in 10 s (WHALE_MODE=live) |
| CLI motion exits 0 | status 0 — sent {"type":"motion","group":"Hammer"} |
| motion applied on the frontend | cmdState.last="motion: Hammer", ok=true |
| expression applied | cmdState.last="expression: 爱心眼", ok=true |
| pose overlay held | ParamEyeBallX=0.900 in motion frames (commanded 0.9) |
| pose {} clears | ParamEyeBallX=0.571 (mock gaze resumes) |
| mode mock flip | mode frame {"mock":true}, cmdState.mode="mock" |
| canned speech resumes | /audio/say-<id>.mp3, words=4 |
| mode live flip | mode frame {"mock":false}, cmdState.mode="live" |
| say command frame | /audio/say-<id>.mp3, words=4 — schema == M2.2 |
| say audio served | HTTP 200, content-type audio/mpeg |
| page played the commanded say | engine=edge-tts, decoded 442,368 B, 2.30 s |
| say frames carry src | canned src="mock", commanded src="cmd" |
| mock never cuts a commanded line | in mock mode, 2.1 s into the line the page still plays the commanded audio (no cut) |
| motion stream | 30.0 fps over 2.00 s |
| server / driver RSS | 30,784 KB / 17,952 KB |
| ports released | :3000 and :3001 free |

Implementation logs from the smoke run: /tmp/m31-server.log, /tmp/m31-driver.log
(the driver log shows the new per-second line "driver: 30 fps, web clients: N,
mode: mock" and the say lines).

## Manual verification (owner, first-time-user pass — PENDING)
1. Terminal 1 — `cd whale-girl-server && npm start` (log shows `http=:3000
   ws=:3001`).
2. Terminal 2 — `cd whale-girl-server && .venv/bin/python control_whale.py`
   (log shows `driver: 30 fps … mode: mock`).
3. Browser — open `http://localhost:3000/?debug=1`; the DS鲸鱼娘 idles.
4. From a DSH session (Web or TUI), still in whale-girl-server, send each
   command and watch the browser:
   - `.venv/bin/python scripts/whale_cmd.py motion Hammer` — the hammer motion
     plays; ?debug=1 shows `cmd motion: Hammer`; an unknown group
     (`motion Nope`) prints the 8 groups and exits 2.
   - `.venv/bin/python scripts/whale_cmd.py say 你好，我是鲸鱼娘` — the whale
     speaks with lip sync; the line plays to its end even while the mock keeps
     talking (canned lines never cut it; a new command still may).
   - `.venv/bin/python scripts/whale_cmd.py pose '{"ParamEyeLOpen":0,"ParamEyeROpen":0}'` —
     the eyes stay shut while held (an unmistakable check; ParamEyeBallX is too
     subtle to judge); `pose '{}'` reopens them. `pose '{"ParamAngleZ":15}'`
     (head tilt) is an alternative.
   - `.venv/bin/python scripts/whale_cmd.py mode live` — the mock mouth/talk
     bursts stop (idle blink/gaze/sway continue); `mode mock` resumes the
     canned speech.
5. OBS — the Browser source shows the same behavior and hears the speech.
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
