import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPhoneDocumentsHandler } from '../phone-documents-route.mjs';

const key = 'synthetic-phone-test-key-at-least-32-bytes-long';
const allowedCaller = '+14155550123';
const allowedTo = '+14155550100';
const callSid = 'CA' + 'a'.repeat(32);
const payload = { roomSid: 'RM_phone_test', participantIdentity: 'sip-test-peer', question: 'What is in the company document?' };
function grant({ sid = callSid, from = allowedCaller, to = allowedTo, exp = Date.now() + 90_000 } = {}) {
  const expires = String(exp);
  const signed = `${sid}|${from}|${to}|${expires}`;
  const mac = createHmac('sha256', key).update(signed).digest('base64url');
  return `${sid}~${from}~${to}~${expires}~${mac}`;
}

async function tempDir() { return mkdtemp(join(tmpdir(), 'hindsight-phone-test-')); }

test('authorized one-use Twilio test call reaches existing Hermes retrieval runner and preserves sources', async () => {
  const replayDir = await tempDir(); let called = 0;
  try {
    const handler = createPhoneDocumentsHandler({ env: { HINDSIGHT_PHONE_TEST_KEY: key, HINDSIGHT_TEST_CALLER_E164: allowedCaller,
      HINDSIGHT_TEST_TO_E164: allowedTo, HINDSIGHT_PHONE_TEST_REPLAY_DIR: replayDir },
      run: async question => { called++; assert.equal(question, payload.question); return { response: 'Verified answer.', sources: ['company.pdf'], timingsMs: { hermes: 10 } }; } });
    const result = await handler({ payload, grant: grant() });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.sources, ['company.pdf']);
    assert.equal(called, 1);
    assert.equal((await handler({ payload, grant: grant() })).status, 403);
    assert.equal(called, 1);
  } finally { await rm(replayDir, { recursive: true, force: true }); }
});

test('missing, invalid, expired, wrong caller/destination and malformed request fail closed', async () => {
  const replayDir = await tempDir(); let called = 0;
  try {
    const handler = createPhoneDocumentsHandler({ env: { HINDSIGHT_PHONE_TEST_KEY: key, HINDSIGHT_TEST_CALLER_E164: allowedCaller,
      HINDSIGHT_TEST_TO_E164: allowedTo, HINDSIGHT_PHONE_TEST_REPLAY_DIR: replayDir }, run: async () => { called++; throw new Error('should_not_run'); } });
    const cases = [undefined, 'tampered', grant({ exp: Date.now() - 1 }), grant({ from: '+14155550999' }), grant({ to: '+14155550200' })];
    for (const value of cases) assert.equal((await handler({ payload, grant: value })).status, 403);
    assert.equal((await handler({ payload: { ...payload, extra: true }, grant: grant() })).status, 400);
    assert.equal(called, 0);
    const disabled = createPhoneDocumentsHandler({ env: {}, replayDir, run: async () => { called++; } });
    assert.equal((await disabled({ payload, grant: grant() })).status, 403);
  } finally { await rm(replayDir, { recursive: true, force: true }); }
});

test('invalid runner output fails closed after grant consumption', async () => {
  const replayDir = await tempDir();
  try {
    const handler = createPhoneDocumentsHandler({ env: { HINDSIGHT_PHONE_TEST_KEY: key, HINDSIGHT_TEST_CALLER_E164: allowedCaller,
      HINDSIGHT_TEST_TO_E164: allowedTo, HINDSIGHT_PHONE_TEST_REPLAY_DIR: replayDir }, run: async () => ({ response: 'Answer without source', sources: [] }) });
    assert.equal((await handler({ payload, grant: grant() })).status, 502);
    assert.equal((await handler({ payload, grant: grant() })).status, 403);
  } finally { await rm(replayDir, { recursive: true, force: true }); }
});
