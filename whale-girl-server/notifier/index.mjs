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

/**
 * Pure state machine behind the plugin, exported for the fixture probe.
 * @param {{hubUrl?: string, post?: Function, log?: Function, now?: Function}} options
 */
export function createNotifier(options = {}) {
  const hubUrl = options.hubUrl || DEFAULT_HUB_URL;
  const post = typeof options.post === 'function' ? options.post : defaultPost;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const sessions = new Map(); // sessionId -> {lastTurnEndAt, goalActive}
  let lastErrorLogAt = 0;

  function stateFor(sessionId) {
    let state = sessions.get(sessionId);
    if (state) return state;
    if (sessions.size >= MAX_SESSIONS) sessions.clear(); // bounded: a pathological runtime must not grow memory
    state = { lastTurnEndAt: 0, goalActive: false };
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

  return { handleSessionEvent, handleAgentStatus, handleSessionDisposed, sessions };
}

export function apply(ctx, config = {}) {
  const notifier = createNotifier({
    hubUrl: config && config.hub ? config.hub : DEFAULT_HUB_URL,
  });
  const contained = (fn) => {
    try { fn(); } catch (err) { /* a notifier failure must never disturb the session */ }
  };
  ctx.on('session/event', (session, event) => {
    contained(() => notifier.handleSessionEvent(String(session.id), event));
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
