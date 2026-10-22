# Whale Girl — Folder Structure

    whale-girl-monorepo/
    ├── AGENTS.md             # agent operating rules (spec-driven workflow, gates)
    ├── SESSION-CONTEXT.md    # session continuity file — read FIRST on a new machine
    ├── README.md             # quick start + OBS + troubleshooting (specs are authoritative)
    ├── specs/                # constitution: mission, tech-stack, roadmap, dev-environment
    │   ├── features/         # one folder per roadmap item: requirements/plan/validation
    │   └── history_roadmap.md   # archive of completed items with evidence
    ├── docs/
    │   └── folder-structure.md      # this file
    ├── .cursor/rules/        # editor agent rules (spec compliance, memory discipline)
    ├── .agents/skills/       # agent skills: /spec-plan, /spec-close, /spec-lipsync (M2.2), /spec-commands (M3.1), /spec-expressions (M3.2)
    ├── whale-girl-server/    # Node.js proxy + Python brain (splits to Ubuntu later)
    │   ├── server.js         # express :3000 static + ws :3001 raw-text proxy (+ /audio mount)
    │   ├── control_whale.py  # 30 FPS driver: mock synthesis + TTS speech + v1 commands
    │   ├── scripts/          # probes (ws_probe, ws_role_probe, validate_model, say_probe, cmd_probe) + whale_cmd.py (DSH tool)
    │   ├── audio/            # gitignored TTS speech files (driver writes, server serves)
    │   └── .venv/            # gitignored Python env (websockets + edge-tts pinned)
    └── whale-girl-frontend/  # static OBS-facing page (stays on the Mac)
        ├── index.html        # PixiJS 7 + Live2D cubism4, transparent canvas (+ speech + v1 commands)
        └── model/            # gitignored Live2D assets (whale.model3.json + siblings)
