import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { createSecureToolBroker, createLiveKitToolAdapter } from './secure-tool-broker.mjs';

export const hermesTaskInputSchema = z.object({
  task: z.enum(['prayer_times', 'next_prayer', 'qibla', 'hijri', 'methods']),
  language: z.enum(['tr', 'en']),
  city: z.string().trim().min(1).max(100).optional(),
  country: z.string().trim().min(1).max(100).optional(),
}).strict();
export const hermesTaskOutputSchema = z.object({ response: z.string().min(1).max(4000) }).strict();
const CAPABILITY = 'hermes_task';
const SAFE_RESPONSE = 'İstek şu anda tamamlanamadı.';
const SAFE_FAILURE = Object.freeze({ ok: false, error: { code: 'TOOL_FAILED', message: SAFE_RESPONSE } });

async function runHermesTask({ task, env, signal, fetchImpl = fetch, timeoutMs = 30_000 }) {
  if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
  if (typeof env.HERMES_GATEWAY_TOKEN !== 'string' || env.HERMES_GATEWAY_TOKEN.length === 0) throw new Error('gateway_not_configured');
  const endpoint = new URL(env.HERMES_GATEWAY_URL || 'https://hermes-api.agentsfer.com/agent/task');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('gateway_not_configured');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await Promise.race([
      fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.HERMES_GATEWAY_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ task: buildGatewayTask(task) }),
        signal: controller.signal,
      }),
      delay(timeoutMs, undefined, { signal: controller.signal }).then(() => { throw Object.assign(new Error('deadline'), { code: 'TIMEOUT' }); }),
    ]);
    if (!response.ok) throw new Error('gateway_failed');
    const payload = await response.json();
    const parsed = hermesTaskOutputSchema.safeParse(payload);
    if (!parsed.success) throw new Error('invalid_result');
    return parsed.data;
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
    if (error?.code === 'TIMEOUT') throw error;
    throw new Error('gateway_failed');
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', abort);
  }
}

function buildGatewayTask(task) {
  const labels = { prayer_times: 'Prayer times', next_prayer: 'Next prayer', qibla: 'Qibla direction', hijri: 'Current Hijri date', methods: 'Available prayer calculation methods' };
  const location = task.city && task.country ? ` for ${task.city}, ${task.country}` : '';
  const language = task.language === 'tr' ? 'Turkish' : 'English';
  return `Use only the configured read-only AlAdhan MCP to provide ${labels[task.task]}${location}. Reply concisely in ${language}.`;
}

/** Enabled only when the existing server-side Secure Tool Broker is configured. */
export function createHermesPrivateTestTool({ env = process.env, room, fetchImpl, timeoutMs = 30_000 } = {}) {
  const verifiedRoomName = room?.name;
  const enabled = typeof env.HERMES_GATEWAY_TOKEN === 'string' && env.HERMES_GATEWAY_TOKEN.length > 0
    && typeof env.HERMES_GATEWAY_URL === 'string' && env.HERMES_GATEWAY_URL.length > 0;
  if (!enabled) return undefined;
  const boundedTimeoutMs = Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 30_000 ? timeoutMs : 30_000;
  const sessions = new WeakMap();
  const registry = [{ name: CAPABILITY, description: 'Use the private, read-only AlAdhan MCP connection for prayer times, next prayer, Qibla, Hijri conversion, or calculation methods. Ask for city and country if missing; never guess prayer data.', inputSchema: hermesTaskInputSchema, outputSchema: hermesTaskOutputSchema, requiredScopes: [], timeoutMs: Math.min(30_000, boundedTimeoutMs + 500),
    adapter: ({ input, signal }) => runHermesTask({ task: input, env, signal, fetchImpl, timeoutMs: boundedTimeoutMs }) }];
  const broker = createSecureToolBroker({ registry,
    resolvePrincipal: async ({ runContext }) => {
      const session = runContext?.session;
      const currentRoomName = session?.room?.name || verifiedRoomName;
      if (!session || !currentRoomName) throw new Error('room verification failed');
      let binding = sessions.get(session);
      if (!binding) { binding = randomUUID(); sessions.set(session, binding); }
      return { id: 'voice-service', tenantId: 'agentsfer-voice', scopes: [], source: 'server-session', expiresAt: Date.now() + 12_000, sessionBinding: `voice-session-${binding}` };
    },
    authorize: async ({ capability, signal }) => capability === CAPABILITY && !signal.aborted,
    audit: async ({ event, tool, outcome, phase, timestamp }) => {
      const allowed = new Set(['tool_execution']);
      if (!allowed.has(event) || tool !== CAPABILITY || !['started', 'success', 'tool_failed', 'timeout', 'cancelled', 'invalid_output'].includes(outcome) || !['start', 'complete'].includes(phase) || !Number.isFinite(Date.parse(timestamp))) throw new Error('audit metadata invalid');
      // Explicit allowlist only; caller/task/result/room/credentials are never recorded.
      console.info(JSON.stringify({ event, tool, outcome, phase, timestamp }));
    },
  });
  return createLiveKitToolAdapter({
    broker,
    capability: CAPABILITY,
    onStart: (ctx) => ctx.update('İsteği kontrol ediyorum; biraz sürebilir.'),
  });
}
export function safeHermesTaskError() { return SAFE_FAILURE; }
export { SAFE_RESPONSE };
