# whale-girl-dsh-notifier (M5.1)

The Whale Girl's DeepSeek Harness integration: attach an agent session to the
whale girl and she announces every finished round with
**主人，<会话名>有任务完成啦** (the name is spoken verbatim).

This folder is a **DSH bundle package**: installing it adds two plugin rows —
the in-process lifecycle hook and an MCP client for the whale-girl hub — so no
profile YAML is edited by hand.

## Install (pick one)

- **Web Plugins page**: DSH Web → Plugins → install bundle → absolute path to
  this folder:
  `/Users/superguo/Projects/whale-girl-monorepo/whale-girl-server/notifier`
  (installing a bundle enables it by default; restart DSH or let the profile
  recompose).
- **From an agent session** (needs danger-full-access / approval):
  `plugin_manager install_bundle { "target": "<absolute path to this folder>" }`
- **CLI** (pnpm add; enable the bundle afterwards in the Plugins page):
  `dsh plugin --profile <name> add <absolute path to this folder>`

**Use `link:`, not `file:`, for a checkout you keep updating.** pnpm *copies* a
`file:` dependency at install time, so `git pull` never reaches the profile and
DSH keeps loading the old plugin code (this bit us on 2026-10-24). A `link:`
dependency is a symlink into the repo, so later pulls apply on the next DSH
start:

    cd ~/.dsh/profiles/<name>
    pnpm remove whale-girl-dsh-notifier
    pnpm add "link:$HOME/Projects/whale-girl-monorepo/whale-girl-server/notifier"

After the install, restart DSH so the profile composes the bundle (a module
that is already loaded is not hot-swapped).

The hub itself is the whale-girl server (`whale-girl-server/hub.js`): it starts
with `npm start` / `stack.sh start` on loopback `http://127.0.0.1:3200`
(env `WHALE_MCP_PORT`). The MCP tools appear in every session as
`mcp__whale__whale_attach`, `mcp__whale__whale_detach` and
`mcp__whale__whale_sessions`.

## Use — nothing to do per session

1. Start the whale stack (`cd whale-girl-server && bash scripts/stack.sh start`).
2. Start or resume a DSH session. The plugin **auto-attaches it** (no ids, no
   tool call) with the name of its working directory, e.g. `whale-girl-monorepo`.
3. Every time that session finishes a round the whale says
   `主人，whale-girl-monorepo有任务完成啦`.
   Rename with `whale_attach(session_id = $DSH_SESSION_ID, name = "构建会话")`
   (the plugin never overwrites it); mute that session with `whale_detach`.
   Subagent child sessions are skipped; `config.autoAttach: false` restores the
   explicit-attach-only mode.

Goal auto-continuation rounds are suppressed (no spam), the agent-idle fallback
is deduped, a disposed session detaches automatically, and an entry nobody has
touched for 24 h expires.

## Configuration

The bundle row passes `hub: http://127.0.0.1:3200`. To point at another hub,
override the row in your profile patch (the bundle's defaults stay intact):

    - id: whale-notifier
      config:
        hub: 'http://127.0.0.1:3999'

`serverName` (/profile-wide MCP tools) is `whale`; per-session mounting via
ACP `session/new mcpServers {"whale-girl":{"url":"http://127.0.0.1:3200/mcp"}}`
remains available and gives the unprefixed names `whale_attach` etc.

## Where DSH and the whale stack run

The hub is loopback-only on the machine that runs the whale stack. DSH must run
on that same machine, or reach the hub through an ssh forward.

- Same machine (pattern 1): nothing else to do.
- Whale stack on the Ubuntu box, DSH also on the box (the usual split
  deployment): install the bundle on the box's DSH profiles. The page on the
  Mac keeps using the existing `ssh -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001`
  tunnel — it is a web client of the box server and fetches the speech audio
  through the same tunnel, so OBS/browser on the Mac hears the announcement.
- DSH also running on the Mac: add `-L 3200:127.0.0.1:3200` to the tunnel and
  install the bundle on the Mac profile too; the default hub URL then reaches
  the box's hub through the tunnel.
