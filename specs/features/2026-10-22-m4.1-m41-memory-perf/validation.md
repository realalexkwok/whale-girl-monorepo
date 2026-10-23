# M4.1 — Memory/Asset Optimization — Validation

> Status: IMPLEMENTATION COMPLETE + MANUAL PASS PASSED (2026-10-23) — the automatic
> half passes against the amended < 180 MB gate, all nine manual steps passed, and
> the review-fix loop runs next; then /spec-close handles the roadmap tick, the
> history archive and the handoffs.

## Baseline measurement (2026-10-22, OBS 32.2.2, real model, live traffic)

Protocol as planned (2 × 30 min, 10 s samples, warm-up 120 s) with two
implementation refinements: (a) the source is toggled through the built-in
obs-websocket server (localhost, auth, scripts/obs_toggle.js) instead of manual
GUI steps; (b) the gate is read in steady state — the page's first-load decay
spans > 10 min (Phase A fell 331.6 → 181.8 MB), so the last-10-min windows of
both phases are compared as well (the tech-stack steady-state principle).

| Phase | Samples | Mean | Min | Max | Slope | Drift |
| --- | --- | --- | --- | --- | --- | --- |
| A — source visible + traffic (`logs/mem-20261022-171318-baseline-a.csv`) | 168 | 237.9 MB | 181.8 MB | 331.6 MB | −5.21 MB/min | −93.4 MB |
| B — source hidden and unloaded (`logs/mem-20261022-174401-baseline-b.csv`) | 168 | 46.9 MB | 31.3 MB | 84.2 MB | −1.88 MB/min | −34.2 MB |

- Full-phase delta (A − B): **191.0 MB**.
- Steady-state delta (last 10 min: 197.2 − 33.7): **163.5 MB**.
- Stability: no growth — both phases shrink (negative slope); the page is leak-free
  over the 30-min soak.
- End-of-phase breakdown (process: RSS) — A: page renderer 94,224 KB + second CEF
  renderer 15,216 KB + GPU 36,320 KB + utilities 19,632/10,544/19,856 KB = 195,792
  KB; B: GPU 10,240 KB + utilities 6,720/5,600/11,536 KB = 34,096 KB. The page
  renderer alone is ~94 MB — a Chromium page cannot bring the TOTAL CEF delta under
  100 MB.
- Verdict against the gate as written (< 100 MB): **FAIL** — an owner decision is
  pending (amend the gate / keep it with an exemption / redefine the metric /
  measure the structural floor first).

Measurement gotchas found and handled:
- The owner's browser source had "Shutdown source when not visible" OFF: hiding it
  kept the 100 MB page alive (Phase B would have been invalid). Enabling the
  property (shutdown: true) and toggling the source off unloaded it (6 → 4 CEF
  processes, 0 renderers; 201 MB → 107 MB right after, settling to ~34 MB).
- The obs-websocket server (OBS 32.2.2, :4455, auth) was enabled for this
  milestone to automate the phase toggles; the original plugin config is backed up
  next to it and is restored at the close.

## Final soak (2026-10-22, finished tree with the TG3 hardening)

| Phase | Samples | Mean | Min | Max | Slope | Drift |
| --- | --- | --- | --- | --- | --- | --- |
| A — source visible + traffic (`logs/mem-20261022-184843-final-a.csv`) | 168 | 165.6 MB | 130.4 MB | 219.2 MB | −1.53 MB/min | −28.8 MB |
| B — source hidden and unloaded (`logs/mem-20261022-191859-final-b.csv`) | 168 | 38.6 MB | 33.4 MB | 43.4 MB | −0.14 MB/min | −3.0 MB |

- Steady-state delta (last 10 min: 151.5 − 36.7): **114.8 MB → PASS** against the
  amended < 180 MB gate (within the internal target ≤ 160 MB).
- Full-phase delta: 126.9 MB (reported for transparency).
- Stability: no monotonic growth (slope negative in both phases; drift negative) —
  the page is leak-free over the 30-min soak.
- Baseline vs final variance: the baseline ran on a cold OBS start (first CEF load)
  at 163.5 MB steady; the final ran on a warm OBS at 114.8 MB. The amendment used
  the conservative (cold) figure; both are recorded.
- The scene collection now carries `"shutdown": true` on the browser source — the
  source unloads its page when hidden (needed for Phase B and the right default for
  a hidden overlay).
- Environment restored after the measurement: OBS quit, the obs-websocket plugin
  config restored (`server_enabled: false`), ports 3000/3001 free.

## Automatic verification results (all measured — filled at the close)
| Check | Command | Result |
| --- | --- | --- |
| OBS gate (baseline) | bash scripts/mem_probe.sh | **FAIL as written**: full-phase delta 191.0 MB / steady delta 163.5 MB vs the <100 MB gate — owner decision pending (see above) |
| OBS gate (final) | bash scripts/mem_probe.sh --compare ... --steady | **PASS** — steady delta 114.8 MB < 180 MB (amended gate; internal target ≤ 160 MB met); full-phase 126.9 MB |
| Stability (slope + drift) | mem_probe assertions | **PASS** — final A slope −1.53 MB/min, B −0.14; drift −28.8 / −3.0 MB (growth-only rule) |
| CPU/GPU profile | node scripts/perf_probe.js | **PASS** — 60.0 fps over 62 s, frame-time p95 17.4–18.6 ms, JS heap growth 0.31–0.33 MB post-GC (the pre-GC 6.22 MB was garbage, not a leak). Post-fix re-run (2026-10-23): 60 fps, p95 17.4 ms, heap +0.33 MB, server 23/27/46 MB, driver 15/16/17 MB |
| M3.1 gate | node scripts/cmd_probe.js | **PASS 63/63** (30.0 fps stream; server max 48,720 KB, driver max 19,760 KB; ports released; the two new checks are the BubbleGum exit + the motion-leftover guard) |
| M3.2 gate | node scripts/expr_probe.js | **PASS 22/22** (server end 32,960 KB, driver end 16,176 KB; ports released) |
| M2.2 regression | node scripts/say_probe.js (both passes) | **PASS 13/13 + 13/13** — edge: 53/53 in-word, gap max 0.108, latency mean 19 / max 29 ms; say: amplitude max 1.00, loud mean 0.88; both passes inject Ketchup (a mouth-curve motion) during the say and keep 100% lip sync |
| WS probes | node scripts/ws_probe.js / ws_role_probe.js | **PASS** — 30.0 fps over 2.00 s, 61 frames, monotonic f; role probe close 1008 |
| HTTP smoke | curl :3000 | **200** |
| Inline script syntax | node --check on the extracted script | **PASS** — 39,153 B |
| Server/driver RSS (10-min post-traffic soak) | ps RSS multi-sample (perf_probe) | **PASS** — server min 21 / mean 28 / max 46 MB, driver min 13 / mean 14 / max 17 MB over 60 samples (budgets ≤ 60 / ≤ 30 MB) |
| Shutdown | lsof after SIGTERM | **PASS** — ports 3000/3001 free, no stray node/python/OBS CEF processes |

## Lever measurement (A/B windows, 2026-10-22)

Windows are 3-min post-load samples of the same traffic mix (say / motion /
express every 20 s) with the source reloaded before each window. The page's
post-load decay is ~20 min, so within-window noise is ±5–10 MB — the levers are
judged against that noise floor.

| Lever | Control | Lever window | Verdict | Applied? |
| --- | --- | --- | --- | --- |
| resolution cap min(DPR,2) → 1 | 304.9 MB (`logs/mem-20261022-182625-lever-control.csv`) | 313.1 MB (`logs/mem-20261022-183352-lever-resolution.csv`) | no win (noise; OBS CEF runs at DPR 1) | No |
| antialias true → false | 304.9 MB | 308.0 MB (`logs/mem-20261022-183007-lever-antialias.csv`) | no win (noise) — the visual trade-off would buy nothing | No |
| ticker maxFPS 30 | — | not measured | memory-neutral by design; CPU-only lever, changes the render cadence — needs owner consent | No |
| audio retention | — | audit | one decoded utterance at a time (only `src.buffer` holds the AudioBuffer; `lastSay` keeps numbers + a ≤ ~400-float amp array) | No change needed |
| timers/DOM | — | audit | the pill is one reused element; the 8 s abort timer is cleared on every path; `wsTimer` is single and cleared on open (TG3) | No change needed |

**Finding:** no renderer/audio/DOM lever changes the OBS extra memory
measurably — the cost is Chromium's renderer + GPU baseline (~94 MB page
renderer + ~15 MB second renderer + ~26 MB GPU + ~26 MB utilities). The gate as
written cannot pass with an OBS browser source; the amendment decision is with
the owner.
## Manual verification (owner — first-time-user pass)

> Terms: **server** = the Node proxy (`npm start`, ports 3000/3001) — it only
> forwards messages. **brain** = `control_whale.py` (older docs call it the
> "driver") — a SEPARATE Python program that computes the face 30 times per second
> and, in the default mock mode, rehearses canned Chinese lines by itself (that is
> why it "keeps speaking"; `WHALE_MODE=live` silences the canned lines and keeps
> the idle motion). Without the brain the page freezes on its last frame and every
> command is refused with "the server has no brain connected" — that is the safety
> working, not a bug.
>
> One-command start (recommended): `bash scripts/stack.sh start` — starts the server
> AND the brain, keeps them alive (auto-restart), and prints both. `bash
> scripts/stack.sh status` shows which half is alive; `bash scripts/stack.sh stop`
> stops both; `bash scripts/stack.sh logs` follows the log.
> Manual alternative: Terminal 1 = `npm start` (server); Terminal 2 = the brain
> (`.venv/bin/python control_whale.py`) — the whale will start "talking" by itself,
> that is the mock rehearsal, not an error.

1. Start — `cd whale-girl-server && bash scripts/stack.sh start`: expect
   `stack.sh: UP — server :3000, brain pid …`. The stack starts **silent** (live
   mode: idle motion only) — the canned rehearsal lines appear only with
   `WHALE_MODE=mock bash scripts/stack.sh start`. Check with `bash scripts/stack.sh
   status`: both halves listed, the brain with its RSS.
2. Browser check — open http://localhost:3000/?debug=1: the whale girl appears on a
   transparent background, the status line shows `ws connected` and a rising frame
   number, the console has no errors.
3. OBS + traffic — open OBS 32.2, show the Browser source at
   http://localhost:3000, 1920x1080 (it already exists as "浏览器"; after the
   2026-10-22 measurement it is hidden — click the eye icon). Open View → Stats and
   watch 5+ minutes while traffic runs:
   `bash scripts/traffic_mix.sh --minutes 5 --interval 20 --verbose` — the script
   preflights the driver and aborts with the exact reason if it is missing. Expect
   `ok` lines and smooth motion, stable fps. **First say in OBS: click once**
   (right-click the source → Interact → click anywhere) — browsers start audio
   suspended; the mouth is driven by the audio clock, so until that first click
   there is no sound and no lip movement (the "click to enable audio" pill appears
   bottom-right). Also: the **BubbleGum** motion blows a bubble prop
   (`chuipaopao*` curves, 5 s) that covers the mouth — lip sync is only visible while
   it plays; since 2026-10-23 the bubble clears itself when the motion finishes
   (no page refresh needed). Hammer / Selfie / Ketchup also list `ParamMouthOpenY`, but the model
   marks it as the LipSync group, so the speech mouth wins while a line plays
   (verified 2026-10-22 — say_probe now injects Ketchup during a say as a guard).

4. Hide/show — right-click the source → Properties → "Shutdown source when not
   visible" is already ticked; click the eye icon: the whale disappears; click again
   — the page reloads and the whale returns, reconnecting within a second.
5. Scene resize — in the source properties set the size to 1280x720 (or drag the
   source): the whale re-fits to the frame (bottom-center, ~90% height), no clipping.
6. Reconnect — in the terminal running the brain (`control_whale.py`) press Ctrl+C:
   with `stack.sh` the supervisor restarts it within ~3 s; in the manual two-terminal
   setup restart it with `WHALE_MODE=live .venv/bin/python control_whale.py` (live =
   silent; without the env var the canned rehearsal comes back). The page resumes
   within a second.
   Then stop the server (Ctrl+C in Terminal 1, or `bash scripts/stack.sh stop`): the
   page shows `ws disconnected (…), retrying...`; restart it (`bash scripts/stack.sh
   start` or `npm start`) — the page reconnects within the capped backoff (≤ 10 s).
7. Audio — click anywhere on the page once (in OBS: right-click the source →
   Interact → click), then run
   `.venv/bin/python scripts/whale_cmd.py say 你好，我是鲸鱼娘`: the whale speaks
   with matching mouth motion; no "click to enable audio" pill remains.
8. Commands — run `motion Hammer`, `express happy 开心`,
   `pose '{"ParamEyeLOpen":0,"ParamEyeROpen":0}'`, `pose '{}'`, `mode live` /
   `mode mock`: each is visible, and ?debug=1 shows the last command.
9. Memory sanity (optional) — Activity Monitor → OBS shows OBS's **total** memory
   (app + screen capture + the CEF browser processes); the gate measures only the
   browser source's CEF delta (~115-163 MB), so a 289 MB total is expected and is
   not the gate metric. For the delta, use the measurement scripts (mem_probe).

### Owner record — manual pass (2026-10-22 → 2026-10-23) — ALL PASSED
| Step | Result |
| --- | --- |
| 1 Start | PASSED (manual two-terminal path first, then `stack.sh`) |
| 2 Browser | PASSED |
| 3 OBS + traffic | PASSED — first attempt failed (only the server was running, no brain); after the brain started, the stack supervisor + traffic preflight were shipped and the traffic ran clean; lips sync confirmed after the BubbleGum leftover fix (which the owner found here) |
| 4 Hide/show | PASSED — source hides/reloads and the whale returns in ~1 s |
| 5 Scene resize | PASSED — 1280x720 re-fits bottom-center, no clipping |
| 6 Reconnect | PASSED — brain kill/restart resumes in ~1 s; server stop/start reconnects within the ≤ 10 s backoff |
| 7 Audio | PASSED |
| 8 Commands | PASSED (motion / express / pose / pose clear / mode) |
| 9 Memory sanity | Observed 289.1 MB = OBS's total memory (explained above; not the gate metric) |

## Hardening (TG3, implemented 2026-10-22)

- WS reconnect: a pending retry timer is cleared on a successful open (no duplicate
  sockets after a race); on visibilitychange hidden→visible the page re-fits the
  scene and retries immediately if the socket died while hidden (OBS scene switches
  hide/throttle the source — the capped backoff would otherwise cost up to 10 s of
  dead overlay). Diff: 2 hunks / +22 lines in whale-girl-frontend/index.html.
- Scene sizing: `fitModel` already runs on window resize and after the model loads;
  the visibility handler now also re-fits on resume (the viewport can change while
  the page is suspended). No ResizeObserver needed — the window resize event proves
  reliable in OBS CEF.
- Audio pill: audited — one reused element (`pillEl`, created once, display toggled),
  the 8 s abort timer is cleared on both success and failure paths; no accumulation.
- Audio retention: audited — one decoded utterance at a time (only `src.buffer`
  holds the AudioBuffer; `lastSay` keeps numbers + a small amp array).
- Motion leftovers (found by the owner during the manual pass, 2026-10-23): the
  BubbleGum bubble kept covering the mouth after the motion ended until a page
  refresh. Root cause: a commanded motion leaves its own parameter tracks
  (`chuipaopao*`) at their last values; only a mode flip reset poses. Fix: on a
  commanded motion's finish, restore every parameter the driver does not drive to
  its default (driver-owned parameters untouched; one reset per motion end, no
  per-frame cost). Evidence: cmd_probe now plays BubbleGum and asserts the props
  return to their defaults — `left=0 values=[0,1,0,0,0,0,0,0]`; with the reset
  disabled the same check fails with `left=8` (mutation test).
- Say mouth vs motion tracks (verified, 2026-10-23): the model marks
  `ParamMouthOpenY` as its LipSync group, so a motion that lists it (Ketchup) does
  not mask the speech mouth; say_probe injects Ketchup during every say as a
  permanent guard (13 checks, both engine passes).

## Handoff to dependant milestones
- M4.2 owns: nothing new — the deployment surface is unchanged (config only). The
  memory gate protocol itself is documentation, not a deployment dependency.
- M5.1/M5.2 own: nothing new — the new scripts (mem_probe/traffic_mix/obs_toggle/
  perf_probe) are verification tooling, not runtime; `whale_say`/`whale_express`
  stay the announcement seams.
- Owner action: the manual pass above is owed at the close (2026-10-22 or later);
  the roadmap tick + history archive happen in /spec-close.