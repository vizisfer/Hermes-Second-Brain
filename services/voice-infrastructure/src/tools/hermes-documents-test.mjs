import { llm } from '@livekit/agents';
import { z } from 'zod';


const grantSchema = z.object({ capability: z.string().min(1).max(4096), question: z.string().min(1).max(500), participantIdentity: z.string().min(1).max(128) }).strict();
const resultSchema = z.object({ response: z.string().min(1).max(4000), sources: z.array(z.string().min(1).max(200)).min(1).max(8),
  timingsMs: z.object({ hermes: z.number().int().nonnegative(), bridge: z.number().int().nonnegative() }).strict() }).strict();
export const documentTestInputSchema = z.object({}).strict();
export function parseDocumentTestMetadata(metadata) {
  try {
    if (typeof metadata !== 'string' || Buffer.byteLength(metadata) > 8192) return undefined;
    const parsed = z.object({ documentTest: grantSchema }).strict().safeParse(JSON.parse(metadata));
    return parsed.success ? Object.freeze(parsed.data.documentTest) : undefined;
  } catch { return undefined; }
}

// This client never asserts a user principal. The Bridge verifies and atomically
// consumes the operator's signed, session/question-bound capability before Hermes.
export function createHermesDocumentsTestTool({ env = process.env, room, roomSid, grant, fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  const parsed = grantSchema.safeParse(grant);
  if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000
    || !parsed.success || typeof roomSid !== 'string' || !roomSid || !room
    || !env.HERMES_GATEWAY_URL || !env.HERMES_GATEWAY_TOKEN) return undefined;
  const binding = Object.freeze({ ...parsed.data });
  let used = false;
  const denied = () => ({ ok: false, error: { code: 'DENIED', message: 'Belge testi yetkilendirilemedi.' } });
  return llm.tool({
    description: 'Delegate the single operator-approved document test to Hermes. Available only in a controlled test session. It takes no question, identity or credentials from the model. Read the verified short answer and its sources in Turkish; do not invent missing facts.',
    parameters: documentTestInputSchema,
    execute: async (input, { abortSignal, ctx } = {}) => {
      if (!documentTestInputSchema.safeParse(input).success || used || abortSignal?.aborted) return denied();
      const participants = [...(room.remoteParticipants?.values() || [])];
      if (participants.length !== 1 || participants[0].identity !== binding.participantIdentity || !participants[0].sid) return denied();
      let endpoint;
      try {
        const configured = new URL(env.HERMES_GATEWAY_URL);
        if (configured.protocol !== 'https:' || configured.username || configured.password) return denied();
        endpoint = new URL('/agent/documents-test', configured.origin);
      } catch { return denied(); }
      used = true; // Fail closed on acknowledgement loss; no automatic retry.
      // A one-use read must not be interrupted by audio activity while Hermes
      // is answering. Scope this to the current controlled speech, not the
      // session: explicit cancellation/disconnection and our deadline remain.
      ctx?.disallowInterruptions();
      const started = performance.now();
      const requestId = crypto.randomUUID();
      const controller = new AbortController();
      let deadlineFired = false;
      let sdkSignalAborted = false;
      let firstAbortOrigin;
      const emit = (phase, fields = {}) => console.info(JSON.stringify({ event: 'document_test', requestId, phase, elapsedMs: Math.round(performance.now() - started), ...fields }));
      const abort = () => {
        firstAbortOrigin ??= 'sdk_abort';
        sdkSignalAborted = true;
        const speech = ctx?.speechHandle;
        emit('sdk_abort_observed', { speechInterrupted: speech?.interrupted === true,
          interruptionSource: ['audio_activity','user_turn','programmatic'].includes(speech?._interruptSource) ? speech._interruptSource : 'unknown' });
        controller.abort();
      };

      const timer = setTimeout(() => { firstAbortOrigin ??= 'local_deadline'; deadlineFired = true; controller.abort(); }, timeoutMs);
      abortSignal?.addEventListener('abort', abort, { once: true });
      try {
        emit('fetch_started', { parentSignalAborted: abortSignal?.aborted === true, deadlineFired });
        const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error',
          headers: { authorization: `Bearer ${env.HERMES_GATEWAY_TOKEN}`, 'content-type': 'application/json', 'x-document-test-capability': binding.capability, 'x-document-test-request-id': requestId },
          body: JSON.stringify({ question: binding.question, roomSid, participantIdentity: binding.participantIdentity }), signal: controller.signal });
        emit('response_headers', { status: response.status, parentSignalAborted: abortSignal?.aborted === true, deadlineFired });
        if (!response.ok || Number(response.headers?.get('content-length')) > 16_000) {
          emit('denied', { status: response.status });
          return denied();
        }
        const text = await response.text();
        emit('response_body_done', { status: response.status, parentSignalAborted: abortSignal?.aborted === true, deadlineFired });
        if (Buffer.byteLength(text) > 16_000) return denied();
        const result = resultSchema.safeParse(JSON.parse(text));
        if (!result.success) {
          emit('invalid_result', { status: response.status });
          return denied();
        }
        // Capabilities, document text, identities and room names never enter logs.
        emit('success', { status: response.status });
        return { ok: true, data: result.data };
      } catch (error) {
        const abortOrigin = firstAbortOrigin || (error?.name === 'AbortError' ? 'transport_abort' : 'transport_error');
        const safeCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ABORT_ERR']);
        const code = error?.cause?.code || error?.code;
        emit('request_failed', { abortOrigin, parentSignalAborted: abortSignal?.aborted === true, deadlineFired,
          transportCode: safeCodes.has(code) ? code : 'withheld', errorName: ['AbortError','TypeError','TimeoutError'].includes(error?.name) ? error.name : 'withheld' });
        return denied();
      }
      finally {
        clearTimeout(timer); abortSignal?.removeEventListener('abort', abort); controller.abort();

      }
    },
  });
}
