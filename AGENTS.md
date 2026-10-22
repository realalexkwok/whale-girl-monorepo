# AGENTS.md

## Part A — System Prompt Context
You are an expert full-stack developer and architect operating in the Whale Girl
monorepo — a low-memory Live2D interactive streaming system.
ACTIVE PROJECT (this branch): **Whale Girl** (V1 M1–M5; M1, M2.1, M2.2 closed;
M3.1 implemented on its feature branch — manual half pending at the close;
M3.2–M5 pending).
Before writing any code, read the project constitution files first:
specs/mission.md, tech-stack.md, roadmap.md, dev-environment.md.
Before every write to disk, an ask-user-question round covering requirements
(scope/decisions/context), plan (task groups), and validation (success criteria)
must be answered by the user.

## Part B — Project Constitution (active project)
- **Core Mission:** specs/mission.md — goals, audiences, principles.
- **Current Goals:** specs/roadmap.md — strict item order; V1 (M1 closed +
  M2–M5) is the commitment, V2/V3 are directional vision.
- **Roadmap history:** specs/history_roadmap.md — the archive of completed
  items (M1.1–M1.5) with measured evidence; the active roadmap keeps one-line ticks
  with close dates and links into the archive.
- **Tech Boundaries:** specs/tech-stack.md — approved libraries, pinned
  versions, memory budgets, owner decision amendments.
- **Dev runbook:** specs/dev-environment.md — the verified macOS loop and
  the deployment patterns (same-machine / cloud scripts / optional SSH tunnel).
- **Feature specs:** specs/features/YYYY-MM-DD-<item>/ with
  requirements.md, plan.md, validation.md (see specs/features/README.md for the rules).

## Part C — Operational Instructions

### Branch rules
- main holds the latest merged state of the active project.
- One git branch per roadmap item (or small item group), named
  feature/whale-girl-<item>; never stack a new branch on a finished feature branch.
- Closing a feature branch: merge into main, push, then delete the local branch —
  merges/pushes only on the owner's approval (owner-commit rule).
- Roadmap order is authoritative; do not skip or reorder items without owner approval.

### Feature workflow (spec-driven)
- Before writing anything for a feature: ask the user via ask-user-question, grouped
  on requirements (scope/decisions/context), plan (task groups), and validation
  (success criteria). Write the feature spec trio FIRST, code SECOND.
- At the close: tick the roadmap item (one line, close date), archive full detail in
  history_roadmap.md, and complete the validation.md handoff list.

### Run & test (working recipes, verified 2026-10-19)
- Server: cd whale-girl-server && npm start (env: PORT, WS_PORT).
- Driver: cd whale-girl-server && .venv/bin/python control_whale.py (env: WHALE_WS,
  WHALE_DEBUG=1 for per-frame logs).
- Probes: node scripts/ws_probe.js (expect PASS, 20–40 fps, monotonic f) and
  node scripts/ws_role_probe.js (expect close 1008).
- M3.1 gate: node scripts/cmd_probe.js (v1 command frames end to end, malformed
  safety, say byte-compat — prints its check count) and node scripts/say_probe.js
  (M2.2 regression). DSH commands: scripts/whale_cmd.py motion|say|pose|mode
  (venv python); WHALE_MODE=mock|live selects the boot mode.
- Smoke: curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ → 200.
- Ports: lsof -nP -iTCP:3000 -iTCP:3001 -sTCP:LISTEN (both must be free before start).
- Memory: ps -axo pid,rss,command | grep -E 'node server.js|control_whale.py'.
- Python deps live ONLY in whale-girl-server/.venv (gitignored); recreate with
  python3 -m venv .venv && .venv/bin/pip install -U pip &&
  .venv/bin/pip install -r requirements.txt. Never install into system Python.

### Memory discipline (hard requirement — macOS OOM prevention)
- Budgets (tech-stack.md): server ≤ 60 MB RSS, driver ≤ 30 MB RSS at 30 FPS —
  steady state (after warm-up; the boot transient is not part of the gate);
  re-check with the ps command above at every feature close.
- No per-frame allocations in the hot paths (driver frame dict is pre-allocated and
  mutated in place; frontend message handler avoids closures/spreads; server never
  JSON.parses frames).
- No per-frame logging; aggregate logs only (server 5 s, driver 1 s).
- No Electron, no heavy UI libraries, no new dependencies outside tech-stack.md.

### Quality gates
- Frontend: node --check on the inline script (extract between the bare <script>
  tags); CDN URLs must stay the pinned, verified versions from tech-stack.md.
- The M3.1 gate (scripts/cmd_probe.js) and the M2.2 regression
  (scripts/say_probe.js) must stay green; the M3.1 probe needs the DS model
  installed (it reads the manifest and fails actionably otherwise).
- Python: it must run clean on the pinned websockets (15.x on Python 3.9) — test the
  installed version, not an assumption.
- Every probe/verification report names ABSOLUTE paths and measured numbers.

### Verification (two-sided; BOTH halves required before merge)
1. Automatic — the agent runs the probes/smoke checks above and reports results.
2. Manual — the user exercises the page in a browser (?debug=1) and in OBS.
- A manual pass is written for a FIRST-TIME user and for every round: self-contained
  steps, controls named exactly as they appear on screen, only the items still
  unverified (already-green items go into a short "already verified, do NOT re-run"
  table).

### Commits
- Never commit unless (a) the user explicitly tells you to, or (b) the validation for
  the current item has passed AND the user has been asked.
- Owner working rule: agents must NOT git commit / git push; leave changes uncommitted
  in the working tree for owner review.

### Spec compliance
- Never add dependencies outside specs/tech-stack.md.
- Never change behavior without updating the constitution or the feature spec first.
- README.md and docs/ describe the system; the specs are authoritative.

### Deferred-work handoff (nothing gets silently dropped)
- When an item deliberately leaves work to later milestones, its validation.md MUST
  end with a "Handoff to dependant milestones" list: what was deferred, why, and
  exactly which roadmap item owns it.
- The dependant item's planning round MUST re-read that handoff and explicitly
  implement, replan, or cancel each entry — never drop it silently.

### Session continuity
- SESSION-CONTEXT.md travels with the repo: on any new machine/agent session, read it
  FIRST, then this file, then specs/{mission,tech-stack,roadmap}.md.
- Update SESSION-CONTEXT.md at every milestone close (state, in-flight items,
  environment facts).
