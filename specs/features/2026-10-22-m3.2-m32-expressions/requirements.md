# M3.2 — LLM-Driven Expressions: Emotion Tag -> Preset Routing — Requirements

> Confirmed by the owner (2026-10-22, grouped ask round: requirements / plan /
> validation; answers: hybrid routing table / driver table + CLI + new probe /
> per-tag probe + full gate). Status: implemented on
> feature/whale-girl-m32-expressions (review rounds 1–5 fixes applied); the
> manual half is owed by the owner at the close.

## Scope
- DSH sessions steer the whale's face: the model classifies the text inline and
  calls **whale_express(tag[, text])**; a small driver-side table resolves the
  coarse, stable emotion tag to one of the 44 Live2D expression presets and
  forwards the existing M3.1 expression frame.
- Tags: happy / sad / angry / surprised / confused / love / neutral. Default
  presets (owner picks; candidates from the 44 names): happy -> 开心兴奋,
  sad -> 悲伤, angry -> 生气, surprised -> 感叹号, confused -> 问号,
  love -> 爱心眼, neutral -> reset (the frontend calls resetExpression()).
- CLI strictness: `whale_cmd.py express` validates the tag against the shared
  table and exits 2 WITHOUT sending for an unknown tag (a DSH typo never
  reaches the face); the driver's neutral fallback applies to raw wire frames
  (an MCP wrapper may skip the CLI).
- Audio-enable UX fix (found during the manual pass; decision 4): any pointer /
  key gesture now creates/resumes the AudioContext, so the first say after a
  page refresh plays without the pill; the pill remains the OBS fallback.
- Zero new dependencies; the classifier is the external LLM + a plain data
  table; fully offline after the table.

## Decisions (ask round 2026-10-22, owner)
1. **Hybrid routing table**: the LLM tags inline; the driver table resolves
   tag -> preset with a neutral fallback; the owner approves the preset
   defaults.
2. **Driver table + CLI + new probe**: expr_tags.py (shared data), driver
   express handling, a `whale_cmd.py express` subcommand and
   `scripts/expr_probe.js`.
3. **Per-tag probe + full gate**: every tag asserted end to end, plus the
   existing cmd_probe / say_probe / ws_probe gates.
4. **Audio-enable fix (2026-10-22, in-pass)**: the owner could not find the
   pill after a refresh because the AudioContext is created lazily by the first
   say; any pointer/key gesture now arms it, so a refresh + one click + say
   plays (the pill stays as the OBS fallback). The T3 scope is extended
   accordingly and the manual pass covers it.

## Semantics (binding)
- Inbound `{"type":"expression","tag":"happy","text":"...（optional）"}`
  (a tag variant of the existing expression frame — **no new frame type**): the
  driver resolves the tag and forwards `{"type":"expression","name":"<preset>"}`.
  The M3.1 direct `name` passthrough keeps working; `name:""` means reset.
- Unknown tag: the CLI rejects it (exit 2, valid tag list on stderr, nothing
  sent); an unknown tag that reaches the driver as a raw wire frame -> neutral
  reset + a 1 Hz log listing the valid tags. A frame with neither a tag nor a
  name is treated like an unknown tag (neutral).
- Cooldown (`WHALE_EXPR_COOLDOWN`, default 4 s): the **same** tag within the
  cooldown is skipped; a **different** tag applies immediately (hysteresis on
  repeats only) — chat noise must not flicker the face.
- Idle: no express command for `WHALE_EXPR_IDLE` (default 30 s) -> the reset
  frame.
- A real mode flip clears the expression state and sends the reset frame.
- Priority: say > motion > expression > mock envelope — expressions never touch
  the mouth rule (a say and an expression coexist, e.g. 爱心眼 while
  speaking); commanded motions keep playing.
- Table: `whale-girl-server/expr_tags.py` (data-only, shared by the driver and
  the CLI); `WHALE_EXPR_TAGS` (compact JSON) merges over the defaults, so an
  owner override may add or replace tags — except `neutral`, which always
  resets (a non-empty neutral override is ignored with a warning). Set the
  variable in BOTH the driver and the CLI environment — they load it
  independently, and a tag known to only one side is either rejected by the CLI
  or treated as unknown by the driver.

## Context
- Handoffs honoured (all implemented here):
  - M2.1: "M3.2 owns text/emotion -> expression presets via the same hooks" ->
    the driver forwards the M2.1/M3.1 expression frame to `playExpression`.
  - M3.1: "the expression frame + frontend execution already ship; a
    whale_expression CLI command may be added there" -> the CLI `express`
    subcommand ships here; an MCP wrapper stays optional (M5 may reuse it).
- M3.1 surface reused: `{"type":"expression","name"}` frames,
  `window.whaleModel.playExpression / resetExpression / listExpressions`
  (44 names), `scripts/whale_cmd.py`, `cmd_probe.js` (61 checks) and
  `say_probe.js` (12 checks) as the regression gates.
- Hard constraints (tech-stack.md): no new dependencies; one-shot commands (no
  per-frame work); budgets server <= 60 MB / driver <= 30 MB RSS steady state;
  no per-frame logging.

## Validation criteria (owner answer 3)
- Automatic: expr_probe PASS — every tag resolves and the page applied the
  preset (CDP, `cmdState.last` + an applied counter), unknown tag -> reset,
  the same tag within the cooldown applies once, the M3.1 name passthrough still
  works, idle/mode-flip reset verified, RSS within 60/30 MB, ports released;
  cmd_probe 61/61, say_probe 12/12, ws_probe 20–40 fps, role probe close 1008,
  curl 200, node --check on the inline script.
- Manual (owner, at the close): a DSH session says emotional lines -> OBS shows
  the matching expression; ?debug=1 shows `expression: <preset>`; the default
  preset choices are confirmed; an unknown tag is rejected by the CLI (exit 2 +
  the tag list; the raw-frame neutral fallback is covered by expr_probe); after
  a refresh + one click a say plays without the pill.
