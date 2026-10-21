# Feature 2 — Automatic mid-round progress reporting

## Requirements (product view)
2.1 While a round is running (user waiting for the LLM), the whale reports
    progress automatically.
2.2 The agent gets a CALLABLE TOOL to emit intermediate progress as short
    Chinese sentences; the session name is preserved untranslated.
2.3 Context/prompt injection makes the session call the tool automatically
    (no user prompting per round).

## The tool (model-facing)
- MCP tool whale_progress({text}) on the hub (v0: text only, matching the
  "short Chinese sentences" requirement; optional percent/label fields later).
- Hub forwards to the whale frontend via the existing say command
  (M2.2 pipeline: edge-tts zh-CN / say fallback, Web Audio playback, lip
  sync). Progress lines are one-off utterances — zero impact on the 30 FPS
  motion stream.
- Speech policy: cooldown between spoken lines (draft: >= 5-8 s), priority
  below announcements (Feature 1) and above ambient idle talk; queue drops
  oldest on overflow. Session name embedded by the hub, never regenerated or
  translated.

## Context injection — how the session learns to call the tool
| Agent | Injection mechanism (evidence from research) |
| --- | --- |
| DSH | MCP tool description is visible once mounted (per-session via ACP or global cordis.yml mcp-client); PLUS a profile prompt patch or a Cordis plugin appending the instruction on agent/created — "每当完成一个较大的子任务，就调用 whale_progress 用一句简短的中文报告进度（会话名保持原样）" |
| Claude Code | CLAUDE.md / .claude/CLAUDE.md; dynamic variant: SessionStart hook output additionalContext (hooks doc) |
| Codex | AGENTS.md chain (~/.codex/AGENTS.md + repo AGENTS.md, 32KiB budget) |
| Cursor | .cursor/rules/*.mdc with alwaysApply frontmatter |
| Gemini | GEMINI.md |
| Copilot CLI | copilot-instructions.md / AGENTS.md |

Injection snippet (shared, agent-agnostic wording):
    进度报告工具可用：whale_progress。
    每当你开始或完成一个明显的子任务（如开始写代码、运行测试、读取文件、
    完成一个修改）时，调用 whale_progress 报告一句简短的中文进度，
    例如 "正在写登录页" 或 "测试跑完了"。会话名不要翻译。

## Event-driven backup (works even if the model ignores the instruction)
- DSH: agent/assistant-stream chunks + tool/call / tool/result events
  (SDK session.event or web session.follow) -> the hub can synthesize
  heuristic lines ("正在调用工具…", "正在写文件…"). Lower quality than
  model-emitted lines — mark as stretch, not v0.
- Claude Code: PostToolUse hook (tool names in payload) -> generic lines.
- Cursor/Gemini: afterTool/AfterTool equivalents.

## DSH specifics
- Mid-round visibility is first-class: assistant-stream chunk frames,
  tool events, agent/status transitions — all available on the SDK
  session.event push (no polling).
- Model-facing notifier tools already exist in DSH (todo_write,
  ask_user_question) — whale_progress sits naturally beside them.
- Goal continuation rounds also produce turns; progress lines should not
  fire per goal-round unless the user is waiting (registry knows the
  "running" state).

## Acceptance sketch
1. A long DSH turn emits >= 2 spoken progress lines with no user asking.
2. Lines are Chinese, short, and keep the session name unchanged.
3. Cooldown holds (no line spam) during a 3-minute turn.
4. (If in scope) same via Claude Code CLAUDE.md + hook-verified.

## Decisions & TBD
- DECIDED (owner 2026-10-21): progress tool + context injection are the v0
  path; registry in whale-girl-server; DSH-first.
- TBD at N2 planning: heuristic event-driven backup in v0 or stretch;
  cooldown constants + queue size; motion pairing.
