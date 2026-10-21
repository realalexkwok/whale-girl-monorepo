# Whale Girl — Roadmap

> **Status: M1 complete (2026-10-19); M2.1 closed (2026-10-20); M2.2 closed (2026-10-21).** V1 (M1–M5) is the
> commitment; V2/V3 are directional vision. Order is strict — execute items
> top-to-bottom; no skipping or reordering without owner approval. One branch per item
> (or small item group). Completed-item detail lives in
> [history_roadmap.md](history_roadmap.md).
>
> Session-model note: the session AI model was switched to **V4.1-Flash** after the
> M1 close (2026-10-20); M2 work continues on it.

## Branches
- main holds the merged state of the active project.
- Feature branches are named feature/whale-girl-<item> (e.g.
  feature/whale-girl-m2-model-integration); never stack a new branch on a finished
  feature branch.
- Closing a feature branch: merge into main, push, then delete the local branch.
- Merges/pushes follow the owner-commit rule (agents never git commit / git push
  without the owner's explicit instruction).

## Done — M1: pipeline foundation (complete 2026-10-19)
- [x] M1.1 monorepo scaffold: package structure, .gitignore, README — closed 2026-10-19; [detail](history_roadmap.md#m11-monorepo-scaffold)
- [x] M1.2 server.js: static host :3000 + WebSocket proxy :3001 (role routing, raw passthrough, heartbeat keepalive, single-python-writer) — closed 2026-10-19; [detail](history_roadmap.md#m12-serverjs-static-host-and-ws-proxy)
- [x] M1.3 index.html: PixiJS 7.4.3 + cubism4 bundle, transparent canvas, placeholder fallback, auto-reconnect WS client — closed 2026-10-19; [detail](history_roadmap.md#m13-indexhtml-pixijs-and-live2d-frontend)
- [x] M1.4 control_whale.py: 30 FPS drift-corrected mock driver (blink/talk/gaze/sway, zero-alloc loop) — closed 2026-10-19; [detail](history_roadmap.md#m14-control_whalepy-mock-motion-driver)
- [x] M1.5 end-to-end verification + run docs — closed 2026-10-19; [detail](history_roadmap.md#m15-end-to-end-verification-and-docs)

## V1 (commitment: M1 closed + M2–M5 pending)

> **Replan 2026-10-20 (owner decision, advisor comparison + grouped ask round).**
> The roadmap was restructured by merging the advisor's milestone plan (minus the
> danmaku milestone, explicitly rejected) with this repo's item-level discipline:
> M2 = 模型与口型同步 (model + TTS lip sync), M3 = DSH 互动大脑 (replaces danmaku),
> M4 = 内存压榨与部署 (<100MB OBS gate + SSH tunnel). Remapping from the pre-replan
> draft: old M2.3 → M3.1, old M2.4 → M4.2, old M2.5 → M4.1, the V2 "LLM-driven
> expressions" line → M3.2. Pre-replan draft IDs are retired and never reused.
>
> **Amendment 2026-10-21 (owner, grouped round 1a/2a/3a):** the AI-agent progress
> notifier (design drafts: ../docs/drafts/ai-agent-notifier/) becomes milestone
> **M5 inside V1** — DSH-first with cross-agent seams ready, registry in
> whale-girl-server.

### M2 — 模型与口型同步 (model + lip sync)
- [x] M2.1 real Live2D model integration: DS whale girl drop-in, asset validation + clear load errors, playback hooks — closed 2026-10-20; [detail](history_roadmap.md#m21-real-live2d-model-integration)
- [x] M2.2 TTS-driven lip sync (2026-10-20 replan, owner 1a/2/3a/4a): edge-tts (Xiaoyi) + macOS say fallback word-timeline mouth, say protocol, Web Audio playback in the browser — closed 2026-10-21; [detail](history_roadmap.md#m22-tts-driven-lip-sync)

### M3 — DSH 互动大脑 (interaction)
- [ ] M3.1 DSH interaction: real AI-driven parameter commands replacing mock
      synthesis (mock mode stays behind a flag)
- [ ] M3.2 LLM-driven expressions: text/emotion → expression presets (moved from the
      V2 vision list at the 2026-10-20 replan)

### M4 — 内存压榨与部署 (memory squeeze + deployment)
- [ ] M4.1 memory/asset optimization: browser-source extra memory < 100 MB on the Mac
      (hard gate, re-measured after every change), scene sizing, reconnect hardening,
      CPU/GPU profile on target streaming hardware (absorbs the pre-replan M2.5)
- [ ] M4.2 deployment for general users (2026-10-20 amendment, owner 1a/2a/3a):
      pattern 1 same-machine — the dev loop as-is, zero SSH (DEFAULT for normal
      users); pattern 2 cloud server — git pull + install-ubuntu.sh + systemd +
      nginx TLS snippet (manual steps via the provider's web console; optional
      deploy.sh wrapper for operators who already use SSH); pattern 3 SSH port
      forwarding — OPTIONAL advanced mode (scripts/ubuntu-tunnel.sh). Frontend ?ws=
      override — config only, no code rewrite
- [ ] M4.2 validation gate: a fresh Ubuntu VM reaches the streaming state in ≤10 min
      following only the README and the shipped scripts — no SSH or port-forwarding
      knowledge required

### M5 — AI agent progress notifier (DSH-first; drafts: ../docs/drafts/ai-agent-notifier/)
- [ ] M5.1 session integration: per-session MCP attach/detach + session naming +
      round-finished announcement — turn/end → say 主人，%会话名%有任务完成啦;
      cross-agent hook seams (Claude Code / Codex) designed, verified later
- [ ] M5.2 automatic mid-round progress: whale_progress MCP tool + context
      injection (CLAUDE.md / AGENTS.md / GEMINI.md / .cursor rules / DSH profile)
      + speech policy (cooldown, priority, session name untranslated)
- [ ] M5.3 voice commands: sherpa-onnx KWS host-process listener —
      有什么会话还在跑？ / 有什么会话未处理？ (DSH-only, sorted by last
      finished time) / 停止会话一…十 → session.cancel; reply templates in
      ../docs/drafts/ai-agent-notifier/03-feature3-voice-commands.md
- [ ] M5.4 context-menu notification history: right-clicking the whale girl
      page opens a context menu whose 最近通知 item lists the recent
      notifications (round-finished announcements + progress lines the whale
      has spoken; newest first, capped); fed by the hub notification log that
      M5.1/M5.2 write — cap/retention policy decided at its planning round

## V2 — Directional vision (P1; replanned after V1 exits)
- multi-model support (model hot-swap at runtime)
- scene system (backgrounds, props, camera framing presets)
- lightweight web control panel for the streamer (no framework bloat)

## V3 — Directional vision (P2)
- proxy hardening: auth token for the WebSocket, TLS termination
- multi-agent backend (separate brain processes per concern)
- metrics/monitoring (frame rate, latency, RSS over time)
