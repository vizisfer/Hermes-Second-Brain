import test from 'node:test';
import assert from 'node:assert/strict';
import { createHindsightPhoneTool, readPhoneTestGrant } from '../src/tools/hindsight-phone-test.mjs';

const env = { HERMES_GATEWAY_URL: 'https://hermes.example/agent/task', HERMES_GATEWAY_TOKEN: 'test-only-gateway-token-not-production' };
const grant = 'CA' + 'a'.repeat(32) + '~+14155550123~+14155550100~1999999999999~' + 'a'.repeat(43);
const participant = { identity: 'sip-test-peer', attributes: { 'sip.phoneNumber': '+14155550123' } };

 test('reads the signed grant only from LiveKit remote SIP headers', async () => {
  let rpc;
  const ctx = { room: { localParticipant: { performRpc: async args => { rpc = args; return JSON.stringify({ headers: { 'X-Agentsfer-Hindsight-Test': grant } }); } } } };
  assert.equal(await readPhoneTestGrant(ctx, participant), grant);
  assert.equal(rpc.destinationIdentity, participant.identity);
  assert.equal(rpc.method, 'lk.sip.GetRemoteHeaders');
  assert.equal(rpc.payload, '{}');
});

test('non-SIP participants, absent RPC, missing header, and malformed response do not get the private tool grant', async () => {
  let calls = 0;
  const ctx = { room: { localParticipant: { performRpc: async () => { calls++; return JSON.stringify({ headers: {} }); } } } };
  assert.equal(await readPhoneTestGrant(ctx, { identity: 'browser-peer', attributes: {} }), undefined);
  assert.equal(await readPhoneTestGrant({}, participant), undefined);
  assert.equal(await readPhoneTestGrant(ctx, participant), undefined);
  assert.equal(calls, 1);
});

test('private phone retrieval is source-grounded, single-use, and uses the existing Bridge HTTPS API', async () => {
  let request; let calls = 0; let suppressed = 0;
  const tool = createHindsightPhoneTool({ env, roomSid: 'RM_test', participantIdentity: participant.identity, grant,
    fetchImpl: async (url, options) => { request = { url: String(url), options }; calls++; return new Response(JSON.stringify({ response: 'Verified Turkish answer.', sources: ['notes.pdf'], timingsMs: { hermes: 10 } })); } });
  assert.ok(tool);
  const result = await tool.execute({ question: 'Soruma kaynaklarda yanıt var mı?' }, { ctx: { disallowInterruptions: () => { suppressed++; } } });
  assert.deepEqual(result, { ok: true, data: { response: 'Verified Turkish answer.', sources: ['notes.pdf'], timingsMs: { hermes: 10 } } });
  assert.equal(request.url, 'https://hermes.example/agent/documents-phone');
  assert.equal(request.options.headers.authorization, `Bearer ${env.HERMES_GATEWAY_TOKEN}`);
  assert.equal(request.options.headers['x-agentsfer-hindsight-test-call'], undefined);
  assert.equal(request.options.headers['x-agentsfer-hindsight-test'], grant);
  assert.deepEqual(JSON.parse(request.options.body), { question: 'Soruma kaynaklarda yanıt var mı?', roomSid: 'RM_test', participantIdentity: participant.identity });
  assert.equal(suppressed, 1);
  assert.equal((await tool.execute({ question: 'second query' }, {})).ok, false);
  assert.equal(calls, 1);
});

test('missing grant, invalid configuration, wrong schema, and cancellation never call Bridge', async () => {
  assert.equal(createHindsightPhoneTool({ env, roomSid: 'RM_test', participantIdentity: participant.identity }), undefined);
  assert.equal(createHindsightPhoneTool({ env: { ...env, HERMES_GATEWAY_URL: 'http://unsafe.example' }, roomSid: 'RM_test', participantIdentity: participant.identity, grant }), undefined);
  let calls = 0;
  const tool = createHindsightPhoneTool({ env, roomSid: 'RM_test', participantIdentity: participant.identity, grant,
    fetchImpl: async () => { calls++; throw new Error('not expected'); } });
  assert.equal((await tool.execute({ question: 'x', unexpected: true }, {})).ok, false);
  const controller = new AbortController(); controller.abort();
  assert.equal((await tool.execute({ question: 'already cancelled' }, { abortSignal: controller.signal })).ok, false);
  assert.equal(calls, 0);
});
