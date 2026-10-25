/**
 * Whale Girl — M5.1 DSH notifier bundle entry (in-process lifecycle hook).
 *
 * WHY A PLUGIN: DSH runs each interactive session in its own process/runtime;
 * the SDK's session.event push only covers sessions inside the runtime an SDK
 * client spawns, so an external SDK watcher cannot see a TUI/Web round. The
 * documented extension point is an in-process Cordis plugin — this file. It is
 * shipped inside an installable bundle (package.json dsh.bundle +
 * cordis.patch.yml) so users never edit a profile patch by hand.
 *
 * BEHAVIOUR: subscribes session/event + agent/status + session/disposed and
 * POSTs fire-and-forget to the hub's /notify. Round finished = turn/end (every
 * TurnEndReason); agent idle is a fallback deduped by 2 s; goal auto-continuation
 * rounds are suppressed. Every callback is contained: a failure here must never
 * disturb the agent session.
 *
 * AUTO-ATTACH (2026-10-24): on session/created the plugin registers a top-level
 * session with the hub itself (MCP whale_attach over /mcp), so users never deal
 * with session ids or tool calls. Name = basename(header.cwd) else "会话";
 * subagent children are skipped. config.autoAttach:false restores explicit-only
 * attach; whale_attach renames and whale_detach mutes as before.
 */

export const name = 'whale-notifier';

const DEFAULT_HUB_URL = 'http://127.0.0.1:3200';
const IDLE_DEDUPE_MS = 2_000;
const POST_TIMEOUT_MS = 1_000;
const LOG_INTERVAL_MS = 60_000;
const MAX_SESSIONS = 512;

function defaultPost(payload, hubUrl) {
  return fetch(hubUrl + '/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  }).catch(() => {});
}

// Auto-attach goes through the hub's MCP endpoint (tools/call whale_attach), so
// the hub needs no extra endpoint and the registry stays the single source of
// truth. Fire-and-forget: a down hub must never delay a session.
function defaultAttach(payload, hubUrl) {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'whale_attach', arguments: payload },
  };
  return fetch(hubUrl + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  }).catch(() => {});
}

// Auto-attach must not overwrite a name the user set by hand. The plugin asks
// the hub which sessions are known first (MCP whale_sessions) and attaches only
// an unknown session; a failed lookup falls back to attaching.
function defaultQuery(hubUrl) {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'whale_sessions', arguments: {} },
  };
  return fetch(hubUrl + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  }).then((res) => res.json()).then((body) => {
    const text = body && body.result && body.result.content && body.result.content[0]
      && body.result.content[0].text;
    const parsed = text ? JSON.parse(text) : null;
    return Array.isArray(parsed && parsed.sessions) ? parsed.sessions : null;
  }).catch(() => null);
}

/** Default spoken name for an auto-attached session: its working-directory basename. */
const DEFAULT_NAME = '会话';
function defaultName(header) {
  const cwd = header && typeof header.cwd === 'string' ? header.cwd : '';
  const base = cwd ? cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '';
  return (base || '会话').slice(0, 100);
}

/**
 * Pure state machine behind the plugin, exported for the fixture probe.
 * @param {{hubUrl?: string, post?: Function, log?: Function, now?: Function}} options
 */
export function createNotifier(options = {}) {
  const hubUrl = options.hubUrl || DEFAULT_HUB_URL;
  const post = typeof options.post === 'function' ? options.post : defaultPost;
  const attach = typeof options.attach === 'function' ? options.attach : defaultAttach;
  const query = typeof options.query === 'function' ? options.query : defaultQuery;
  const autoAttach = options.autoAttach !== false; // default ON: no ids for users
  const nameFor = typeof options.nameFor === 'function' ? options.nameFor : defaultName;
  // Current DSH session title (a fold of the session log, so it also covers a
  // rename made before this process started) — the user's name for the session.
  const titleOf = typeof options.titleOf === 'function' ? options.titleOf : () => '';
  const log = typeof options.log === 'function' ? options.log : () => {};
  const sessions = new Map(); // sessionId -> {lastTurnEndAt, goalActive}
  let lastErrorLogAt = 0;

  function stateFor(sessionId) {
    let state = sessions.get(sessionId);
    if (state) return state;
    if (sessions.size >= MAX_SESSIONS) sessions.clear(); // bounded: a pathological runtime must not grow memory
    state = { lastTurnEndAt: 0, goalActive: false, title: '' };
    sessions.set(sessionId, state);
    return state;
  }

  function send(sessionId, reason, now) {
    const payload = { agent: 'dsh', session_id: sessionId, reason: reason || 'completed', ts: now };
    try {
      post(payload, hubUrl).catch((err) => {
        if (now - lastErrorLogAt < LOG_INTERVAL_MS) return;
        lastErrorLogAt = now;
        log('whale-notifier: hub unreachable (' + (err && err.message ? err.message : String(err)) + ')');
      });
    } catch (err) {
      // post() throwing synchronously must not reach the agent loop either.
    }
  }

  /**
   * Register a freshly created top-level session. Called by apply() from
   * session/created; returns true when an attach request was sent.
   */
  function handleSessionCreated(session) {
    if (!autoAttach || !session || session.id === undefined) return false;
    const header = session.header;
    if (header && (header.parentSession !== undefined || header.origin === 'subagent'
      || (typeof header.delegationDepth === 'number' && header.delegationDepth > 0))) {
      return false; // subagent children announce every delegate round — skip them
    }
    const sessionId = String(session.id);
    let title = '';
    try {
      title = String(titleOf(session) || '').trim().slice(0, 100);
    } catch (err) {
      title = '';
    }
    const name = title || nameFor(header);
    const state = stateFor(sessionId);
    state.title = title;
    const payload = { agent: 'dsh', session_id: sessionId, name };
    const attachNow = () => {
      try {
        attach(payload, hubUrl).catch(() => {});
        log('auto-attach "' + name + '" (session ' + sessionId + ', ' + (title ? 'title' : 'folder') + ')');
      } catch (err) {
        // contained
      }
    };
    if (title) {
      // The session title is the user's name for it (history included), so it
      // is authoritative: re-register even when the hub already knows the id.
      attachNow();
      return true;
    }
    try {
      query(hubUrl).then((known) => {
        // Keep a manual rename: an already-registered untitled session is left alone.
        if (Array.isArray(known) && known.some((entry) => entry && entry.sessionId === sessionId)) return;
        attachNow();
      }, attachNow).catch(attachNow);
    } catch (err) {
      attachNow();
    }
    return true;
  }

  /**
   * The DSH session title (an automatic title or the user's rename) wins over
   * the folder name: the whale should speak the name the user sees and renamed.
   * Latest-wins in the hub; identical titles are not re-sent.
   */
  function handleSessionTitle(sessionId, title, header) {
    if (!autoAttach || typeof title !== 'string') return false;
    if (header && (header.parentSession !== undefined || header.origin === 'subagent'
      || (typeof header.delegationDepth === 'number' && header.delegationDepth > 0))) {
      return false;
    }
    const name = title.trim().slice(0, 100);
    if (!name) return false;
    const state = stateFor(sessionId);
    if (state.title === name) return false;
    state.title = name;
    try {
      attach({ agent: 'dsh', session_id: sessionId, name }, hubUrl).catch(() => {});
      log('renamed "' + name + '" (session ' + sessionId + ', session title)');
    } catch (err) {
      // contained
    }
    return true;
  }

  function handleSessionEvent(sessionId, event, now = Date.now()) {
    if (!event || typeof event !== 'object') return false;
    const state = stateFor(sessionId);
    if (event.type === 'goal/change') {
      const change = event.data;
      // A goal is auto-continuing while it exists with phase 'active'; every
      // round the round-driver starts is not a user-facing finish.
      state.goalActive = Boolean(change && change.operation !== 'clear' && change.goal && change.goal.phase === 'active');
      return false;
    }
    if (event.type === 'turn/end') {
      state.lastTurnEndAt = now;
      if (state.goalActive) return false;
      const reason = event.data && event.data.reason && event.data.reason.kind;
      send(sessionId, reason, now);
      return true;
    }
    return false;
  }

  function handleAgentStatus(sessionId, status, now = Date.now()) {
    if (status !== 'idle') return false;
    const state = stateFor(sessionId);
    if (now - state.lastTurnEndAt <= IDLE_DEDUPE_MS) return false;
    if (state.goalActive) return false;
    send(sessionId, 'idle', now);
    return true;
  }

  function handleSessionDisposed(sessionId, now = Date.now()) {
    // Post unconditionally: a session that was never seen here may still be
    // attached in the hub (the hub ignores unknown ids, so this is safe and
    // idempotent), and a known session must clean up its registry entry.
    sessions.delete(sessionId);
    try {
      post({ agent: 'dsh', session_id: sessionId, event: 'session_end', ts: now }, hubUrl).catch(() => {});
    } catch (err) {
      // contained
    }
    return true;
  }

  return {
    handleSessionCreated, handleSessionTitle, handleSessionEvent, handleAgentStatus,
    handleSessionDisposed, sessions,
  };
}

export function apply(ctx, config = {}) {
  const notifier = createNotifier({
    hubUrl: config && config.hub ? config.hub : DEFAULT_HUB_URL,
    autoAttach: !(config && config.autoAttach === false),
    // The folded title covers titles written before this process started (the
    // session/title event alone would miss them: seed events are not replayed).
    titleOf: (session) => {
      try {
        const service = ctx.get('sessionTitle');
        const snapshot = service && typeof service.get === 'function' ? service.get(session) : undefined;
        return snapshot && typeof snapshot.title === 'string' ? snapshot.title : '';
      } catch (err) {
        return '';
      }
    },
    log: (message) => {
      try {
        if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info('[whale-notifier] ' + message);
      } catch (err) {
        // contained
      }
    },
  });
  const contained = (fn) => {
    try { fn(); } catch (err) { /* a notifier failure must never disturb the session */ }
  };
  ctx.on('session/created', (session) => {
    contained(() => notifier.handleSessionCreated(session));
  });
  ctx.on('session/event', (session, event) => {
    contained(() => {
      const sessionId = String(session.id);
      if (event && event.type === 'session/title') {
        notifier.handleSessionTitle(sessionId, event.data && event.data.title, session.header);
        return;
      }
      notifier.handleSessionEvent(sessionId, event);
    });
  });
  ctx.on('agent/status', (payload) => {
    contained(() => {
      if (!payload || !payload.agent || !payload.agent.session) return;
      notifier.handleAgentStatus(String(payload.agent.session.id), payload.status);
    });
  });
  ctx.on('session/disposed', (session) => {
    contained(() => { if (session && session.id !== undefined) notifier.handleSessionDisposed(String(session.id)); });
  });
}
