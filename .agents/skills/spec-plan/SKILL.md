---
name: spec-plan
description: Plan the next Whale Girl roadmap item, spec-driven. Use when planning a roadmap item, opening the grouped ask-user-question round (requirements / plan / validation), or scaffolding the specs/features trio — e.g. "/spec-plan M2.1" or "plan M4.2". Implements AGENTS.md Part C feature workflow.
---

# Spec-Driven Roadmap-Item Planning (Whale Girl)

Plan ONE roadmap item in this monorepo before any code is written. This skill
implements AGENTS.md Part C ("Feature workflow") end to end.

## Step 1 — Read the constitution (always first)
- specs/roadmap.md, specs/mission.md, specs/tech-stack.md, specs/dev-environment.md
- specs/features/README.md (trio rules), SESSION-CONTEXT.md (owner decisions)

## Step 2 — Select the item (strict order)
- Take the FIRST unchecked item in specs/roadmap.md, top to bottom. Never skip or
  reorder without owner approval.
- Collect its handoffs: search specs/features/*/validation.md and
  specs/history_roadmap.md for entries that name this item ("owns:"). Every handoff
  entry MUST be explicitly implemented, replanned, or cancelled in the plan.

## Step 3 — Grouped ask round (MANDATORY before any write)
Ask the user with ask-user-question, exactly three questions:
1. requirements — scope / decisions / context for the item
2. plan — task groups (what gets built, which files)
3. validation — success criteria (automatic + manual halves)
Put a "(Recommended)" option first wherever the constitution already implies a
default. Do NOT write any file until all three are answered.

## Step 4 — Scaffold the spec trio
- Run scripts/scaffold_item.sh (bundled with this skill):
      bash .agents/skills/spec-plan/scaffold_item.sh M2.1 m21-model-integration
- Folder: specs/features/YYYY-MM-DD-<item-id>-<slug>/
- Files: requirements.md (grouped per the answers), plan.md (task groups -> files,
  memory budgets, verification commands), validation.md (criteria + empty results
  tables + a "Handoff to dependant milestones" heading).
- House style: the closed M1 trio at
  specs/features/2026-10-19-m1-pipeline-foundation/ is the template.
- Branch: propose feature/whale-girl-<item-id>-<slug>; create it only after the
  owner confirms.

## Step 5 — Plan-content quality gates
- Every task group names the files it touches AND the automatic check it must pass
  (probes, node --check, ps RSS, curl — see AGENTS.md "Run & test").
- Memory discipline: no new dependencies outside specs/tech-stack.md; budgets
  server <= 60 MB / driver <= 30 MB RSS; no per-frame allocations or logging.
- Research findings must cite sources with versions verified live (never assume).

## Step 6 — Report and stop
- Summarize: item, folder created, branch proposal, what the next turn will
  implement, and that the owner's manual half of verification is owed at the close.
- Do NOT start implementation in the same session without the owner's go-ahead.
