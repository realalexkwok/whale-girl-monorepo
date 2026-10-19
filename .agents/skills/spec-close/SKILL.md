---
name: spec-close
description: Close a Whale Girl roadmap item after implementation — run the automatic verification half, write the first-time-user manual pass, complete the handoff list, tick the roadmap and archive detail in history_roadmap.md. Use when an item's implementation is done and needs closing/validation.
---

# Spec-Driven Roadmap-Item Close (Whale Girl)

Use when an item's implementation is finished. Implements AGENTS.md Part C
(verification, handoffs, bookkeeping) and the commit rule.

## Step 1 — Automatic half (run it, record it)
- node scripts/ws_probe.js (expect 20–40 fps, monotonic f)
- node scripts/ws_role_probe.js (expect close 1008)
- curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/  (expect 200)
- node --check on the inline frontend script
- ps RSS snapshot vs the tech-stack budgets; ports released after shutdown
- Write EVERY result into the feature's validation.md with absolute paths and
  measured numbers.

## Step 2 — Manual pass (first-time user, only unverified steps)
- Self-contained steps; controls named exactly as they appear on screen.
- Already-green items go into an "already verified, do NOT re-run" table
  (item, what it covered, who/what verified it).

## Step 3 — Handoff completeness
- validation.md MUST end with "Handoff to dependant milestones": what was
  deferred, why, and exactly which roadmap item owns it. Nothing silently dropped.

## Step 4 — Bookkeeping
- Tick the roadmap item (one line, close date, detail link into
  history_roadmap.md).
- Archive full detail in specs/history_roadmap.md under a matching ## heading
  (linkable slug, no em-dashes).
- Update SESSION-CONTEXT.md (state, environment facts, owner decisions).

## Step 5 — Commit
- Never git commit / push without the owner's explicit instruction.
