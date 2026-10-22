# M3.2 — LLM-Driven Expressions: Emotion Tag -> Preset Routing — Validation

> Status: IMPLEMENTED on feature/whale-girl-m32-expressions (review round 1
> fixes applied and the automatic half re-run on that tree) — the manual half is
> owed by the owner at the close. Roadmap tick + history archive happen only on
> the owner's close instruction.

## Automatic verification results (measured 2026-10-22, macOS)
All commands ran from /Users/superguo/Projects/whale-girl-monorepo/whale-girl-server.

| Check | Command | Result |
| --- | --- | --- |
| expr_probe (per-tag routing) | node scripts/expr_probe.js | PASS — 21/21 checks (breakdown below) |
| M3.1 command gate | node scripts/cmd_probe.js | PASS — 61/61 checks (regression) |
| M2.2 say regression | node scripts/say_probe.js | PASS — 12/12: 9 words, in-word 54/54 (100%), gap max 0.083, latency mean 15 ms / max 32 ms, decoded 847,872 B / 4.42 s |
| Motion probe | node scripts/ws_probe.js | PASS — 30.0 fps over 2.00 s, 61 frames |
| Role probe | node scripts/ws_role_probe.js | PASS — close 1008 + reason |
| HTTP static host | curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ | 200 PASS |
| Frontend inline JS | node --check (extracted script) | PASS — 38,285 B at /tmp/m32-inline.js |
| Memory budget | ps -axo pid,rss,command \| grep -E 'node server.js\|control_whale.py' | Steady state at 60 s: server 55,136 KB / driver 22,208 KB; probes max server 57,616 KB (expr) / 56,720 KB (cmd), driver max 23,856 KB; the boot transient (61,840 KB at 5 s) decays by ~15 s and is not gated |
| Clean shutdown | lsof after SIGTERM | PASS — ports 3000/3001 released, no stray processes |

### expr_probe.js breakdown (PASS 21/21)
| Check | Measured |
| --- | --- |
| WHALE_EXPR_TAGS override merges | happy -> 爱心眼, proud -> 双手比耶 (offline, env-spawned) |
| CLI express exits 0 | status 0 — `express happy 今天特别开心` |
| happy -> 开心兴奋 (CLI) | cmdState.last="expression: 开心兴奋", exprN=1 |
| CLI rejects an unknown tag | exit 2 with the valid tag list on stderr |
| sad / angry / surprised / confused / love | 悲伤 / 生气 / 感叹号 / 问号 / 爱心眼 (exprN 1 → 6) |
| unknown tag -> neutral reset | exprN 6 → 7 |
| a tagless expression frame resets | exprN 7 → 8 |
| neutral tag -> reset | exprN 9 → 10 |
| same tag inside the cooldown | skipped, exprN stayed 11, the driver logged "within the cooldown, skipped" |
| same tag after the cooldown | applied (exprN 12) |
| M3.1 name passthrough | expression: 脸红 applied (exprN 12 → 13) |
| a name passthrough also idle-resets | exprN 13 → 14 |
| a real mode flip resets the expression | exprN 15 → 16 |
| idle returns the face to neutral | after ~8 s (probe env), exprN 18 → 19 |
| server / driver RSS (every sample) | 57,616 KB / 23,856 KB max |
| ports released | :3000 and :3001 free |

Implementation notes:
- **Hook fix (review round 1)**: pixi-live2d-display 0.4.0's
  `ExpressionManager.setExpression()` returns false when the requested preset is
  still `currentExpression`, and `resetExpression()` does not clear it — so a
  reset followed by the same preset (or a cooldown repeat) silently did nothing.
  `playExpression`/`resetExpression` now clear that tracking first; the probe's
  reset → replay and cooldown checks cover it.
- The frontend accepts any string in an expression frame (`name:""` = reset),
  and `cmdState.exprN` counts applied expressions/resets (the probe evidence).
- The probe runs the driver with `WHALE_EXPR_COOLDOWN=2.5` and
  `WHALE_EXPR_IDLE=8` (the cooldown is longer than the driver's 1 Hz notice
  limiter so a skip is observable); the defaults are 4 s / 30 s.
- The probe captures the driver's stdout (skip notices), asserts the CLI's
  stderr tag list, guards the model manifest (every default preset must exist),
  and samples RSS at boot and after the tag phase.
- The wait before the first CLI command covers the driver's connect announce (a
  CLI command sent before the python writer connects gets a 4002 close).

## Manual verification (owner, first-time-user pass — PENDING)
Preconditions: the README quick start (npm install + the venv) and the DS鲸鱼娘
model dropped into whale-girl-frontend/model/ (node scripts/validate_model.js
passes).

1. Terminal 1 — `cd whale-girl-server && npm start`.
2. Terminal 2 — `cd whale-girl-server && .venv/bin/python control_whale.py`.
3. Browser — `http://localhost:3000/?debug=1`; the whale idles.
4. Still in whale-girl-server, from a DSH session send emotional lines:
   `.venv/bin/python scripts/whale_cmd.py express happy 我今天特别开心`
   — the face shows 开心兴奋; ?debug=1 shows `expression: 开心兴奋`.
   Repeat with sad (悲伤), angry (生气), surprised (感叹号), confused (问号),
   love (爱心眼). An unknown tag (`express banana`) is rejected by the CLI
   (exit 2, the valid tags on stderr) and the face keeps its expression — the
   driver's neutral fallback applies only to raw wire frames (covered by
   expr_probe).
5. Rapid repeats: two `express happy` calls within ~4 s show the face once
   (the cooldown); after ~30 s without commands the face returns to neutral.
6. Audio (the in-pass fix): reload the page, click anywhere on it once, then
   `.venv/bin/python scripts/whale_cmd.py say 你好，我是鲸鱼娘` — the line
   plays without the pill; the pill (bottom-right) is only the fallback when the
   browser blocks audio and no gesture is possible (OBS).
7. OBS — the Browser source shows the same expressions; ?debug=1 reports
   `ws connected` (not 1008).
8. Report any failure with the exact command, the ?debug=1 line and the console
   output.

## Handoff to dependant milestones
- M4.1 owns the OBS browser-source memory re-measure with audio + commands +
  expressions active, and the server RSS headroom at the OBS gate.
- M5.1/M5.2 own reusing whale_express (expression alongside the round-finished
  and progress announcements) and the MCP tool wrapper for the whale_* tools.
