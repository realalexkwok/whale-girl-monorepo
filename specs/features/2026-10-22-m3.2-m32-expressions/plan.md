# M3.2 — LLM-Driven Expressions: Emotion Tag -> Preset Routing — Plan

> Confirmed by the owner (2026-10-22) before implementation; the approved
> plan-mode plan is the source of truth here. Status: implemented on
> feature/whale-girl-m32-expressions (review rounds 1–3 fixes applied); the
> owner's manual half is owed at the close (agents never git commit / push —
> owner rule).

## Task groups
0. T1 — spec trio + branch (this folder; feature/whale-girl-m32-expressions from
   main 165ec8d) — created on the owner's confirmation of the round.
1. T2 — driver (whale-girl-server/expr_tags.py new + control_whale.py): the
   shared tag table (defaults + WHALE_EXPR_TAGS JSON merge), the express
   dispatch (tag resolve, unknown -> neutral + 1 Hz log with the tag list,
   cooldown/hysteresis, forward the M3.1 name frame), the idle reset
   (WHALE_EXPR_IDLE), the mode-flip clear + reset frame, and 1 Hz notices.
   Check: py_compile; the driver boots on websockets 15.0.1 / Python 3.9.
2. T3 — frontend (whale-girl-frontend/index.html): the expression branch maps
   `name:""` to `resetExpression()`; `cmdState.exprN` counts applied
   expressions (probe evidence); and the audio-enable fix (any pointer/key
   gesture creates/resumes the AudioContext, so the first say after a refresh
   plays without the pill — the pill remains the OBS fallback). The 0.4.0 hook
   quirk is covered too: setExpression() rejects the preset still tracked as
   currentExpression, so the hooks clear that tracking to let a reset->replay
   (and a cooldown repeat) start again. Check: node --check on the inline
   script.
3. T4 — CLI (whale-girl-server/scripts/whale_cmd.py): the `express` subcommand
   (`express <tag> [text...]`), validating the tag against the shared table
   (exit 2 with the tag list), sending the tag frame; exit codes unchanged.
   Check: CLI smoke — unknown tag exit 2 with the list; valid tag exit 0.
4. T5 — probe (whale-girl-server/scripts/expr_probe.js, new; reuses
   cmd_probe.js's boot machinery): every tag via the CLI / raw ws, asserting
   `cmdState.last` + `exprN`; unknown tag -> reset; the same tag inside the
   cooldown applies once; M3.1 name passthrough; idle reset; mode-flip clear;
   RSS; ports. Check: PASS.
5. T6 — docs: tech-stack.md (v1 expression tag variant + reset), 
   dev-environment.md (whale_express runbook + knobs), README.md (expressions),
   the trio.
6. T7 — verification & close (owner-instructed only): the full automatic half
   (expr_probe + cmd_probe + say_probe + ws_probe + role probe + curl +
   node --check + RSS + ports); the owner's manual pass in OBS; roadmap tick +
   history archive + SESSION-CONTEXT at the close.

## Design details
- Inbound frames (web -> driver, relayed tagged): {"type":"expression",
  "tag":"happy","text":"..."} / the M3.1 {"type":"expression","name":"..."}
  passthrough. Outbound: {"type":"expression","name":"<preset>"} and
  {"type":"expression","name":""} (reset) — byte-compatible with M3.1.
- Table: DEFAULT_TAGS in expr_tags.py; `WHALE_EXPR_TAGS='{"happy":"爱心眼"}'`
  merges over it (invalid JSON -> defaults + a warning).
- State: active tag, last-apply monotonic time, idle deadline; a tag change
  always applies; the same tag re-applies after the cooldown; the idle check is
  a timestamp compare in the existing 1 s log block (no per-frame work).
- Logs: 1 Hz notices for applies, cooldown skips, idle resets and unknown tags
  (the tag list in the unknown-tag message).
- Frontend: `exprN` increments for both an applied preset and a reset; failures
  keep the existing actionable console.error (1 Hz).

## Files
- whale-girl-server/expr_tags.py (new)
- whale-girl-server/control_whale.py
- whale-girl-server/scripts/whale_cmd.py
- whale-girl-server/scripts/expr_probe.js (new)
- whale-girl-frontend/index.html
- specs/tech-stack.md, specs/dev-environment.md, README.md
- specs/features/2026-10-22-m3.2-m32-expressions/{requirements,plan,validation}.md
- NOT touched: package.json, requirements.txt, the model assets, server.js,
  cmd_probe.js / say_probe.js / ws_probe.js (regression only).

## Research findings (verify live during implementation — never assume)
- The model manifest lists 44 expressions with Name fields (verified
  2026-10-22): 脸红, 爱心眼, 星星眼, 情绪花花, 心跳, 开心兴奋, 悲伤, 大哭,
  生气, 晕晕, 流汗, 问号, 感叹号, 阴暗, 调皮, ... — the default table uses
  names from this list.
- The frontend hooks expose playExpression(name) / resetExpression() (M2.1) and
  the M3.1 expression frame path; resetExpression is already used by the M3.1
  debug flow.
- websockets 15.0.1 / Python 3.9.10: the driver compiles with the new module.

## Memory & quality gates
- No new dependencies; no per-frame work (express is one-shot; the idle check
  rides the 1 s log block); budgets unchanged (measure with ps); no per-frame
  logging; node --check on the inline script; existing gates stay green.

## Validation plan
- Automatic: expr_probe per-tag assertions + cooldown + fallback + passthrough +
  idle + mode-flip + RSS; cmd_probe 61/61; say_probe 12/12; ws_probe 20–40 fps;
  role probe close 1008; curl 200; node --check; ports released.
- Manual (owner): DSH emotional lines in OBS; ?debug=1 shows
  `expression: <preset>`; the preset defaults confirmed; an unknown tag is
  rejected by the CLI (exit 2 + the tag list; the driver's raw-frame fallback is
  covered by the probe); after a refresh + one click a say plays without the
  pill.
