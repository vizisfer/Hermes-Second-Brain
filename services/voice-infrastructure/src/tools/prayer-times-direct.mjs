import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { createSecureToolBroker, createLiveKitToolAdapter } from './secure-tool-broker.mjs';

const CAPABILITY = 'prayer_times_direct';
const LOCATION_PATTERN = /^[\p{L}\p{M} .'-]{1,80}$/u;
const inputSchema = z.object({
  city: z.string().trim().regex(LOCATION_PATTERN),
  country: z.string().trim().regex(LOCATION_PATTERN),
}).strict();
const outputSchema = z.object({ response: z.string().trim().min(1).max(4000) }).strict();
const directPayloadSchema = z.object({
  response: z.string().trim().min(1).max(4000),
  mcpLatencyMs: z.number().finite().nonnegative(),
  totalLatencyMs: z.number().finite().nonnegative(),
}).strict();

function endpointFromEnv(env) {
  const base = new URL(env.HERMES_GATEWAY_URL || 'https://hermes-api.agentsfer.com/agent/task');
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('bridge_not_configured');
  base.pathname = '/prayer-times/direct-test';
  base.search = '';
  base.hash = '';
  return base;
}

async function runDirectPrayer({ input, env, signal, fetchImpl, timeoutMs }) {
  if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
  if (typeof env.HERMES_GATEWAY_TOKEN !== 'string' || env.HERMES_GATEWAY_TOKEN.length === 0) throw new Error('bridge_not_configured');
  const endpoint = endpointFromEnv(env);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await Promise.race([
      fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.HERMES_GATEWAY_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ city: input.city, country: input.country }),
        signal: controller.signal,
      }),
      delay(timeoutMs, undefined, { signal: controller.signal }).then(() => {
        throw Object.assign(new Error('deadline'), { code: 'TIMEOUT' });
      }),
    ]);
    if (!response.ok) throw new Error('bridge_failed');
    const parsed = directPayloadSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('invalid_result');
    return { response: parsed.data.response };
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
    if (error?.code === 'TIMEOUT') throw error;
    throw new Error('bridge_failed');
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', abort);
  }
}

/** Register the direct, read-only AlAdhan path through the existing broker. */
export function createPrayerTimesDirectTool({ env = process.env, room, fetchImpl = fetch, timeoutMs = 6_000 } = {}) {
  if (typeof env.HERMES_GATEWAY_TOKEN !== 'string' || env.HERMES_GATEWAY_TOKEN.length === 0) return undefined;
  try { endpointFromEnv(env); } catch { return undefined; }
  const boundedTimeoutMs = Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 30_000 ? timeoutMs : 6_000;
  const sessions = new WeakMap();
  const registry = [{
    name: CAPABILITY,
    description: 'Get today’s prayer times directly from the read-only AlAdhan timings MCP for a specific city and country. Use this for simple daily prayer-time requests; ask the caller for both city and country if either is missing. Present the result in the caller’s current language.',
    inputSchema,
    outputSchema,
    requiredScopes: [],
    timeoutMs: boundedTimeoutMs + 500,
    adapter: ({ input, signal }) => runDirectPrayer({ input, env, signal, fetchImpl, timeoutMs: boundedTimeoutMs }),
  }];
  const broker = createSecureToolBroker({
    registry,
    resolvePrincipal: async ({ runContext }) => {
      const session = runContext?.session;
      const roomScope = session?.room?.name || room?.name;
      // Preserve the runtime room-context gate without treating it as identity.
      if (!session || typeof roomScope !== 'string' || !roomScope.trim()) throw new Error('session unavailable');
      let binding = sessions.get(session);
      if (!binding) { binding = randomUUID(); sessions.set(session, binding); }
      return {
        identityType: 'service',
        id: 'sage-voice-service',
        scopes: [],
        source: 'sage-livekit-agent',
        expiresAt: Date.now() + 12_000,
        sessionBinding: `voice-session-${binding}`,
      };
    },
    authorize: async ({ capability, signal }) => capability === CAPABILITY && !signal.aborted,
    audit: async ({ event, tool, outcome, phase, timestamp }) => {
      if (event !== 'tool_execution' || tool !== CAPABILITY
        || !['started', 'success', 'tool_failed', 'timeout', 'cancelled', 'invalid_output'].includes(outcome)
        || !['start', 'complete'].includes(phase) || !Number.isFinite(Date.parse(timestamp))) {
        throw new Error('audit metadata invalid');
      }
      console.info(JSON.stringify({ event, tool, outcome, phase, timestamp }));
    },
  });
  return createLiveKitToolAdapter({
    broker,
    capability: CAPABILITY,
    onStart: (ctx) => ctx.update('Namaz vakitlerine bakıyorum.'),
  });
}
