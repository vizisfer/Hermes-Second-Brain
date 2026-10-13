import { randomUUID } from 'node:crypto';
import { runHermesDocuments } from './documents-test-route.mjs';
import { consumePhoneTestGrant } from './phone-test-grant.mjs';

const SAFE_ERROR = 'phone_document_test_denied';
const E164 = /^\+[1-9]\d{7,14}$/;

export function createPhoneDocumentsHandler({ env = process.env, replayDir = env.HINDSIGHT_PHONE_TEST_REPLAY_DIR, run = runHermesDocuments } = {}) {
  const key = env.HINDSIGHT_PHONE_TEST_KEY;
  const allowedCaller = env.HINDSIGHT_TEST_CALLER_E164;
  const allowedTo = env.HINDSIGHT_TEST_TO_E164;
  const enabled = typeof key === 'string' && Buffer.byteLength(key) >= 32 && E164.test(allowedCaller || '')
    && E164.test(allowedTo || '') && typeof replayDir === 'string' && replayDir.length > 0;
  let busy = false;
  return async ({ payload, grant, signal, requestId = randomUUID() } = {}) => {
    if (!enabled) return { status: 403, body: { error: SAFE_ERROR } };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'participantIdentity,question,roomSid'
      || typeof payload.question !== 'string' || !payload.question.trim() || payload.question.length > 500
      || typeof payload.roomSid !== 'string' || !payload.roomSid.trim() || payload.roomSid.length > 128
      || typeof payload.participantIdentity !== 'string' || !payload.participantIdentity.trim() || payload.participantIdentity.length > 128) {
      return { status: 400, body: { error: 'invalid_request' } };
    }
    if (busy) return { status: 429, body: { error: 'busy' } };
    busy = true;
    try {
      await consumePhoneTestGrant({ token: grant, key, allowedCaller, allowedTo, replayDir });
      if (signal?.aborted) throw new Error('cancelled');
      const result = await run(payload.question, { signal, requestId });
      if (!result || typeof result.response !== 'string' || !result.response.trim()
        || !Array.isArray(result.sources) || result.sources.length < 1 || result.sources.length > 8
        || !result.sources.every(source => typeof source === 'string' && source.length > 0 && source.length <= 200)) {
        throw new Error('invalid_result');
      }
      console.info(JSON.stringify({ event: 'phone_document_test', requestId, outcome: 'success', sourceCount: result.sources.length }));
      return { status: 200, body: result };
    } catch (error) {
      const denied = error?.message === 'unauthorized';
      console.info(JSON.stringify({ event: 'phone_document_test', requestId, outcome: denied ? 'denied' : 'failed' }));
      return { status: denied ? 403 : 502, body: { error: denied ? SAFE_ERROR : 'hermes_documents_failed' } };
    } finally { busy = false; }
  };
}
