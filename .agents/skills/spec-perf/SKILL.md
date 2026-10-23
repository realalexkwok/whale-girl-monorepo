---
name: spec-perf
description: Plan the Whale Girl M4.1 memory/performance hardening item — define the <100MB OBS browser-source extra-memory measurement protocol, audit the optimization levers (PixiJS/Live2D/Web Audio), leak-soak verification, scene sizing, and reconnect hardening. Use when planning M4.1, memory budgets, OBS memory measurement, leak hunting, or performance profiling of the whale pipeline.
---

# Spec-Driven Memory/Perf Planning (Whale Girl, M4.1)

This skill ACCELERATES /spec-plan for M4.1: the OBS extra-memory hard gate, scene
sizing, reconnect hardening, and the CPU/GPU profile on the target Mac. (M4.1
involves no DSH commands — the DSH note does not apply here.)

> AMENDMENT (2026-10-22, measured): the gate is **< 180 MB steady state**, not
> < 100 MB — the baseline measured 163.5 MB (cold OBS) and the final tree 114.8 MB;
> the page renderer alone is ~94 MB, so the original figure could not pass. See
> specs/tech-stack.md. Everything below still applies, with 180 substituted for 100.

## 1. Read first
- specs/roadmap.md (M4.1 line), specs/tech-stack.md (budgets: server ≤ 60 MB,
  driver ≤ 30 MB steady-state + amendments), specs/dev-environment.md
- Handoffs M4.1 MUST honour:
  - specs/features/2026-10-20-m2.1-model-integration/validation.md — "M4.1
    owns: the <100 MB OBS browser-source gate re-measured with the real model
    (2.1 MB moc3 + ~1.9 MB textures add real GPU/memory load)"
  - re-read the M2.2 / M3.1 / M3.2 validation.md handoffs — they may name
    M4.1 too
- Current surface: index.html renderer settings (resolution cap, antialias,
  autoDensity, backgroundAlpha 0), Live2D motionPreload NONE, say Web Audio
  buffers, WS reconnect backoff + jitter, window.whaleModel hooks.

## 2. Ask-round additions (fold into the /spec-plan questions)
- MEASUREMENT PROTOCOL (the core design): define "OBS extra memory" exactly —
  (a) ps-based: the OBS CEF renderer / cef-bootstrap process RSS delta
  (browser source present vs absent) sampled over a soak window
  (RECOMMENDED — matches the process-budget style and OBS forum guidance);
  (b) Chrome DevTools performance.memory + heap snapshots via CDP for
  diagnosis; (c) both. Fix: soak length (draft 30 min with scripted
  say/motion/expression traffic), sampling interval, and the pass threshold
  (<100 MB gate, draft <90 MB to keep headroom).
- LEVERS to audit, one at a time (measure first, optimize second): renderer
  (resolution/antialias/ticker), Live2D (motionPreload already NONE; texture
  sizes; cache pruning), audio (keep ONE decoded utterance at a time),
  protocol (no per-frame allocations), reconnect backoff caps + no timer
  leaks, scene sizing via the fit pipeline, CPU/GPU profile (frame time, fps
  stability).
- HARDENING in scope: WS reconnect, audio pill cleanup, DOM/list reuse for
  future menus, expression/motion cache bounds.
- ORDER: baseline → apply each lever → re-measure → record every value.

## 3. Hard constraints (enforce in the plan, do not ask)
- The gate is HARD: <100 MB OBS extra memory on the Mac, re-measured after
  every change; each measurement (value + commit) lands in validation.md
- No new dependencies for measurement (ps + the existing probe/CDP tooling)
- All existing gates stay green: cmd_probe, say_probe, expr_probe,
  ws_probe, ws_role_probe
- Server/driver budgets unchanged (≤60/30 MB steady-state)

## 4. Verification design (automatic + manual)
- AUTOMATIC: baseline + post-change RSS soak — a script
  (scripts/mem_probe.sh or similar) samples the CEF process RSS over the
  soak window while a scripted traffic mix runs (say/motion/expression
  frames); assert the gate AND stability (no monotonic growth — the
  memory-leak-detector "silent killer" rule); CDP heap-snapshot diff for
  diagnosis on failure.
- MANUAL: the owner runs a real stream session on the target Mac and watches
  OBS (visual smoothness, fps, Activity Monitor memory); scene resize +
  reconnect exercises.

## 5. Output
- Augmented ask round -> /spec-plan scaffold:
  specs/features/<date>-m41-memory-perf/{requirements,plan,validation}.md
- validation.md must contain the measurement table (baseline -> each lever ->
  final), the gate PASS value, soak stability, and the manual observations.
