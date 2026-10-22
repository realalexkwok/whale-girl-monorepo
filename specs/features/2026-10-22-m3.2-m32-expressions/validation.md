# M3.2 — LLM-Driven Expressions: Emotion Tag -> Preset Routing — Validation

> Status: IMPLEMENTED on feature/whale-girl-m32-expressions — **automatic half
> PASS (2026-10-22, expr_probe 18/18 + the M3.1/M2.2 regressions)**; the manual
> half is owed by the owner at the close. Roadmap tick + history archive happen
> only on the owner's close instruction.

## Automatic verification results (measured 2026-10-22, macOS)
All commands ran from /Users/superguo/Projects/whale-girl-monorepo/whale-girl-server.

| Check | Command | Result |
| --- | --- | --- |
| expr_probe (per-tag routing) | node scripts/expr_probe.js | PASS — 18/18 checks (breakdown below) |
| M3.1 command gate | node scripts/cmd_probe.js | PASS — 61/61 checks (regression) |
| M2.2 say regression | node scripts/say_probe.js | PASS — 12/12: 9 words, in-word 52/52 (100%), gap max 0.083, latency mean 17 ms / max 36 ms, decoded 847,872 B / 4.42 s |
| Motion probe | node scripts/ws_probe.js | PASS — 30.0 fps over 2.00 s, 61 frames |
| Role probe | node scripts/ws_role_probe.js | PASS — close 1008 + reason |
| HTTP static host | curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ | 200 PASS |
| Frontend inline JS | node --check (extracted script) | PASS — 36,927 B at /tmp/m32-inline.js |
| Memory budget | ps -axo pid,rss,command \| grep -E 'node server.js\|control_whale.py' | Settled stack 57,696 KB / 24,352 KB; probes max server 52,752 KB (expr) / 49,856 KB (cmd), driver max 24,352 KB — within the steady-state 60/30 MB budgets |
| Clean shutdown | lsof after SIGTERM | PASS — ports 3000/3001 released, no stray processes |

### expr_probe.js breakdown (PASS 18/18)
| Check | Measured |
| --- | --- |
| CLI express exits 0 | status 0 — `express happy 今天特别开心` |
| happy -> 开心兴奋 (CLI) | cmdState.last="expression: 开心兴奋", exprN=1 |
| CLI rejects an unknown tag | exit 2 with the valid tag list |
| sad / angry / surprised / confused / love | 悲伤 / 生气 / 感叹号 / 问号 / 爱心眼 (exprN 1 → 6) |
| unknown tag -> neutral reset | exprN 6 → 7 |
| neutral tag -> reset | exprN 8 → 9 |
| same tag inside the cooldown | skipped (exprN stayed 10) |
| same tag after the cooldown | applied (exprN 11) |
| M3.1 name passthrough | expression: 脸红 applied (exprN 12) |
| a real mode flip resets the expression | exprN 13 → 14 |
| idle returns the face to neutral | after ~6 s (probe env), exprN 16 → 17 |
| server / driver RSS | 52,752 KB / 18,288 KB |
| ports released | :3000 and :3001 free |

Implementation notes:
- The frontend accepts any string in an expression frame (`name:""` = reset),
  and `cmdState.exprN` counts applied expressions/resets (the probe evidence).
- The probe runs the driver with `WHALE_EXPR_COOLDOWN=1` and
  `WHALE_EXPR_IDLE=6` so the timing checks are fast; the defaults are 4 s / 30 s.
- The wait before the first CLI command covers the driver's connect announce (a
  CLI command sent before the python writer connects gets a 4002 close).

## Manual verification (owner, first-time-user pass — PENDING)
Preconditions: the README quick start (npm install + the venv) and the DS鲸鱼娘
model dropped into whale-girl-frontend/model/ (node scripts/validate_model.js
passes).

1. Terminal 1 — `cd whale-girl-server && npm start`.
2. Terminal 2 — `cd whale-girl-server && .venv/bin/python control_whale.py`.
3. Browser — `http://localhost:3000/?debug=1`; the whale idles.
4. From a DSH session, send emotional lines with the new tool:
   `whale-girl-server/.venv/bin/python whale-girl-server/scripts/whale_cmd.py express happy 我今天特别开心`
   — the face shows 开心兴奋; ?debug=1 shows `expression: 开心兴奋`.
   Repeat with sad (悲伤), angry (生气), surprised (感叹号), confused (问号),
   love (爱心眼); an unknown tag (`express banana`) shows neutral and the CLI
   lists the valid tags.
5. Rapid repeats: two `express happy` calls within ~4 s show the face once
   (the cooldown); after ~30 s without commands the face returns to neutral.
6. OBS — the Browser source shows the same expressions; ?debug=1 reports
   `ws connected` (not 1008).
7. Report any failure with the exact command, the ?debug=1 line and the console
   output.

## Handoff to dependant milestones
- M4.1 owns the OBS browser-source memory re-measure with audio + commands +
  expressions active, and the server RSS headroom at the OBS gate.
- M5.1/M5.2 own reusing whale_express (expression alongside the round-finished
  and progress announcements) and the MCP tool wrapper for the whale_* tools.
