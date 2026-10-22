---
name: spec-expressions
description: Plan the Whale Girl M3.2 LLM-driven expression layer — map text/emotion to Live2D expression presets via the M3.1 expression transport (whale_express tool), with a routing-table design (LLM-tagged emotions -> preset), cooldown/priority rules, and zero new dependencies. Use when planning M3.2, emotion detection, expression presets, or avatar emotion mapping.
---

# Spec-Driven Expression-Mapping Planning (Whale Girl, M3.2)

This skill ACCELERATES /spec-plan for M3.2. The transport + execution already
ship in M3.1 (expression frames + hooks); M3.2 adds the MAPPING brain.
(DSH command usage — Web and TUI — is supported; no investigation needed.)

## 1. Read first
- specs/roadmap.md (M3.2 line), specs/tech-stack.md, specs/dev-environment.md
- Handoffs M3.2 MUST honour:
  - specs/features/2026-10-20-m2.1-model-integration/validation.md —
    "M3.2 owns: text/emotion → expression presets via the same hooks"
  - specs/history_roadmap.md M2.1 archive (same wording)
  - M3.1's validation.md handoff (re-read it — it may name M3.2)
- M3.1 surface (implemented on its branch): {"type":"expression","name"}
  frames, scripts/whale_cmd.py motion|say|pose|mode, WHALE_MODE=mock|live,
  scripts/cmd_probe.js + scripts/say_probe.js gates; frontend
  window.whaleModel.playExpression(name) / listExpressions() — 44
  expressions on the DS whale girl.

## 2. Ask-round additions (fold into the /spec-plan questions)
- MAPPING ARCHITECTURE — recommended default: HYBRID routing table.
  (a) Pure LLM: the DSH model picks the expression NAME directly from
      listExpressions() — zero new code, but names are model-specific and
      drift between sessions;
  (b) Deterministic lexicon: positive/negative/neutral polarity -> presets,
      no LLM, weakest nuance;
  (c) HYBRID (recommended): the model emits a coarse emotion tag
      (happy / sad / angry / surprised / confused / neutral / ...) and a
      small driver-side table resolves tag -> expression preset with a
      fallback chain — tags stay stable across models, zero new deps, fully
      offline after the table (the routing pattern of the
      user-emotion-detection skill).
- TOOL: whale_express(text) — the DSH tool the model calls; the driver maps
  the tag and sends the expression frame. Unknown tag -> neutral + a
  suggestion list (actionable error, mcp-builder style).
- SEMANTICS: priority ladder say > motion > expression > mock envelope;
  cooldown (draft 3-5 s) + hysteresis so chat does not flicker expressions;
  neutral / resetPose on idle and on mode flip.
- PRESETS: the planning round proposes tag -> expression candidates from the
  44 names (listExpressions()); the OWNER picks the defaults.
- CLASSIFICATION is done inline by the external LLM (DSH) — the
  analyzing-text-sentiment skill demonstrates classification without any ML
  dependency; the whale pipeline stays dependency-free.

## 3. Hard constraints (enforce in the plan, do not ask)
- Zero new dependencies: the classifier is the external LLM + a plain data
  table; no local NLP models
- Reuse the M3.1 expression frame byte-compatibly; no new frame types unless
  unavoidable
- One-shot commands only (no per-frame work); memory/CPU budgets unchanged —
  measure with ps
- Domain prior art: Open-LLM-VTuber (LLM -> emotion -> Live2D expression
  engine) — same pipeline shape; ours is transport-lighter (reuses M3.1).

## 4. Verification design (automatic + manual)
- AUTOMATIC: a probe (scripts/expr_probe.js or a cmd_probe extension) sends
  each tag and asserts the resolved expression played (frontend hooks /
  CDP); unknown-tag fallback; cooldown honored; say/motion priority
  untouched; RSS within budget; existing gates stay green
- MANUAL: a DSH session says something emotional -> the whale shows the
  matching expression in OBS; ?debug=1 shows tag -> expression; the owner
  confirms the default preset choices look right

## 5. Output
- Augmented ask round -> /spec-plan scaffold:
  specs/features/<date>-m32-expressions/{requirements,plan,validation}.md
- validation.md criteria must include: per-tag probe PASS, fallback +
  cooldown verified, byte-compat with M3.1, RSS within budget, preset
  defaults owner-approved.
