# Whale Girl — Feature Specs

One folder per roadmap item (or small item group), named YYYY-MM-DD-<item-id>-<slug>,
containing exactly three files:

- requirements.md — the user's requirements grouped into scope / decisions / context.
  Each group is confirmed with the user via an ask-user-question round BEFORE the plan
  is written.
- plan.md — task groups, design decisions, files to touch. Also confirmed via the same
  ask-user-question round before any code is written.
- validation.md — success criteria + the automatic and manual verification results
  (absolute paths, measured numbers). MUST end with a "Handoff to dependant
  milestones" list whenever work is deliberately deferred: what was deferred, why,
  and exactly which roadmap item owns it. The dependant item's planning round MUST
  re-read that handoff and explicitly implement, replan, or cancel each entry —
  nothing gets silently dropped.

Workflow (per AGENTS.md):
1. Ask the user (grouped: requirements, plan, validation) — never write before the
   answers arrive.
2. Implement on a branch named feature/whale-girl-<item>.
3. Run the automatic half of verification, then the owner runs the manual half.
4. Tick the roadmap item (one line, close date) and archive full detail in
   history_roadmap.md at the close commit — only on the owner's instruction.
