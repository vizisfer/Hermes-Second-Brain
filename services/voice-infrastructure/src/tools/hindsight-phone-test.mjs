import { llm } from '@livekit/agents';
import { z } from 'zod';

const SIP_GRANT_HEADER = 'x-agentsfer-hindsight-test';
const inputSchema = z.object({ question: z.string().trim().min(1).max(500) }).strict();
const outputSchema = z.object({ response: z.string().trim().min(1).max(4000), sources: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
  timingsMs: z.object({ hermes: z.number().int().nonnegative(), bridge: z.number().int().nonnegative().optional() }).strict().optional() }).strict();

export async function readPhoneTestGrant(ctx, participant, { timeoutMs = 1200 } = {}) {
  if (!participant || typeof participant.identity !== 'string' || !participant.identity
    || typeof participant.attributes?.['sip.phoneNumber'] !== 'string' || !ctx?.room?.localParticipant?.performRpc) return undefined;
  let timer;
  try {
    const response = await Promise.race([
      ctx.room.localParticipant.performRpc({ destinationIdentity: participant.identity, method: 'lk.sip.GetRemoteHeaders', payload: '{}' }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('sip_header_timeout')), timeoutMs); }),
    ]);
    const parsed = JSON.parse(typeof response === 'string' ? response : '');
    const headers = parsed?.headers;
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
    const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === SIP_GRANT_HEADER);
    const value = entry?.[1];
    return typeof value === 'string' && value.length <= 256 && /^[A-Za-z0-9+~_-]+$/.test(value) ? value : undefined;
  } catch { return undefined; }
  finally { clearTimeout(timer); }
}

export function createHindsightPhoneTool({ env = process.env, roomSid, participantIdentity, grant, fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  if (typeof grant !== 'string' || !grant || grant.length > 256 || typeof roomSid !== 'string' || !roomSid
    || typeof participantIdentity !== 'string' || !participantIdentity
    || typeof env.HERMES_GATEWAY_URL !== 'string' || typeof env.HERMES_GATEWAY_TOKEN !== 'string' || !env.HERMES_GATEWAY_TOKEN) return undefined;
  let endpoint;
  try {
    const base = new URL(env.HERMES_GATEWAY_URL);
    if (base.protocol !== 'https:' || base.username || base.password) return undefined;
    endpoint = new URL('/agent/documents-phone', base.origin);
  } catch { return undefined; }
  let used = false;
  return llm.tool({
    description: 'Search the company Hindsight memories and documents for the caller’s current question. Available only on the operator-authorized test phone call. Answer from returned evidence, mention source filenames when present, and do not invent missing information.',
    parameters: inputSchema,
    execute: async (input, { abortSignal, ctx } = {}) => {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success || used || abortSignal?.aborted) return { ok: false, error: { code: 'DENIED', message: 'Bilgi araması yetkilendirilemedi.' } };
      used = true;
      ctx?.disallowInterruptions();
      const controller = new AbortController();
      const abort = () => controller.abort();
      abortSignal?.addEventListener('abort', abort, { once: true });
      let timer;
      try {
        const response = await Promise.race([
          fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { authorization: `Bearer ${env.HERMES_GATEWAY_TOKEN}`, 'content-type': 'application/json', [SIP_GRANT_HEADER]: grant },
            body: JSON.stringify({ question: parsed.data.question, roomSid, participantIdentity }) }),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')); }, timeoutMs); }),
        ]);
        if (!response.ok || Number(response.headers?.get('content-length')) > 16_000) throw new Error('phone_retrieval_failed');
        const text = await response.text();
        if (Buffer.byteLength(text) > 16_000) throw new Error('phone_retrieval_failed');
        const result = outputSchema.safeParse(JSON.parse(text));
        if (!result.success) throw new Error('phone_retrieval_failed');
        return { ok: true, data: result.data };
      } catch {
        return { ok: false, error: { code: 'TOOL_FAILED', message: 'Bilgi araması tamamlanamadı.' } };
      } finally { clearTimeout(timer); controller.abort(); abortSignal?.removeEventListener('abort', abort); }
    },
  });
}
