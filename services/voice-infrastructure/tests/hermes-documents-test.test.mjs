import test from 'node:test';
import assert from 'node:assert/strict';
import { createHermesDocumentsTestTool, parseDocumentTestMetadata, documentTestInputSchema } from '../src/tools/hermes-documents-test.mjs';
const env = { HERMES_GATEWAY_URL: 'https://gateway.example/agent/task', HERMES_GATEWAY_TOKEN: 'synthetic-test-not-production-token' };
const grant = { capability: 'synthetic-test-capability', question: 'Operator approved synthetic question', participantIdentity: 'test-peer' };
const room = () => ({ remoteParticipants: new Map([['test-peer', { identity: 'test-peer', sid: 'PA_test' }]]) });
test('ordinary callers have no document tool; metadata and model input are strict', () => {
  assert.equal(createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test' }), undefined);
  for (const value of ['', '{', JSON.stringify({ documentTest: { ...grant, bank: 'other' } }), JSON.stringify({ simulationContext: true })]) assert.equal(parseDocumentTestMetadata(value), undefined);
  assert.deepEqual(parseDocumentTestMetadata(JSON.stringify({ documentTest: grant })), grant);
  assert.equal(documentTestInputSchema.safeParse({ question: 'caller injected query' }).success, false);
});
test('timeoutMs is bounded at factory time without exposing invalid values', () => {
  for (const timeoutMs of [0, -1, 60_001, 1.5, NaN, Infinity, '10', null]) {
    assert.equal(createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant, timeoutMs }), undefined);
  }
  assert.ok(createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant, timeoutMs: 1 }));
  assert.ok(createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant, timeoutMs: 60_000 }));
  assert.ok(createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant }));
});
test('signed question, capability and session come from server context, never model arguments; no replay', async () => {
  let request; let calls = 0;
  const tool = createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant,
    fetchImpl: async (url, opts) => { calls++; request = { url: String(url), opts }; return new Response(JSON.stringify({ response: 'Sentetik yanıt.', sources: ['test.txt'], timingsMs: { hermes: 1, bridge: 2 } })); } });
  const result = await tool.execute({}, {});
  assert.equal(result.ok, true); assert.equal(request.url, 'https://gateway.example/agent/documents-test');
  assert.deepEqual(JSON.parse(request.opts.body), { question: grant.question, roomSid: 'RM_test', participantIdentity: 'test-peer' });
  assert.equal(request.opts.headers['x-document-test-capability'], grant.capability);
  assert.equal((await tool.execute({}, {})).ok, false); assert.equal(calls, 1);
});
test('wrong peer, multiple peers, cancellation, insecure URL and model credential injection never contact Bridge', async () => {
  const badRoom = room(); badRoom.remoteParticipants.get('test-peer').identity = 'untrusted';
  const multipleRoom = room(); multipleRoom.remoteParticipants.set('other', { identity: 'other', sid: 'PA_other' });
  for (const overrides of [{ room: badRoom }, { room: multipleRoom }, { env: { ...env, HERMES_GATEWAY_URL: 'http://unsafe.example' } }, { input: { capability: 'model value' } }, { cancelled: true }]) {
    let calls = 0;
    const tool = createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant, ...overrides,
      fetchImpl: async () => { calls++; throw new Error('must not call'); } });
    const controller = new AbortController(); if (overrides.cancelled) controller.abort();
    assert.equal((await tool.execute(overrides.input || {}, { abortSignal: controller.signal })).ok, false); assert.equal(calls, 0);
  }
});
test('Bridge denial and malformed response fail closed without returning private errors', async () => {
  for (const response of [new Response('private error details', { status: 403 }), new Response(JSON.stringify({ response: 'no verified sources' }))]) {
    const tool = createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant, fetchImpl: async () => response });
    const result = await tool.execute({}, {}); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /private error|verified sources/);
  }
});

for (const scenario of ['external abort', 'local deadline']) {
  test(`pending fetch ${scenario} remains denied, single-use and safely diagnosed`, async () => {
    const sensitive = ['synthetic-capability', 'synthetic-question', 'synthetic-peer', 'synthetic-error-reason'];
    const logs = [];
    const originalInfo = console.info;
    console.info = (...args) => logs.push(args.join(' '));
    let calls = 0;
    let request;
    try {
      const tool = createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant,
        timeoutMs: scenario === 'local deadline' ? 10 : 60_000,
        fetchImpl: (_url, options) => {
          calls++;
          request = options;
          return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
            const error = new Error(sensitive[3]); error.name = 'AbortError'; reject(error);
          }, { once: true }));
        } });
      const parent = new AbortController();
      const pending = tool.execute({}, { abortSignal: parent.signal });
      if (scenario === 'external abort') parent.abort();
      const result = await pending;
      assert.deepEqual(result, { ok: false, error: { code: 'DENIED', message: 'Belge testi yetkilendirilemedi.' } });
      assert.equal(calls, 1);
      assert.equal(request.signal.aborted, true);
      assert.match(request.headers['x-document-test-request-id'], /^[0-9a-f-]{36}$/i);
      assert.equal((await tool.execute({}, {})).ok, false);
      assert.equal(calls, 1);
      const events = logs.map((line) => JSON.parse(line));
      const failure = events.find((event) => event.phase === 'request_failed');
      assert.equal(failure.abortOrigin, scenario === 'external abort' ? 'sdk_abort' : 'local_deadline');
      assert.equal(failure.parentSignalAborted, scenario === 'external abort');
      assert.equal(failure.deadlineFired, scenario === 'local deadline');
      assert.equal(events.every((event) => event.requestId === request.headers['x-document-test-request-id']), true);
      for (const value of sensitive) assert.equal(logs.join('\n').includes(value), false);
    } finally { console.info = originalInfo; }
  });
}

for (const firstSource of ['sdk_abort', 'local_deadline']) {
 test(`cancellation diagnostics retain first observed origin (${firstSource})`, async () => {
   const logs = []; const originalInfo = console.info; console.info = (...args) => logs.push(args.join(' '));
   const parent = new AbortController();
   try {
     const tool = createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant, timeoutMs: 10,
       fetchImpl: (_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => {
         setTimeout(() => reject(new DOMException('synthetic abort', 'AbortError')), 30);
       }, { once: true })) });
     const pending = tool.execute({}, { abortSignal: parent.signal });
     if (firstSource === 'sdk_abort') parent.abort();
     else { await new Promise((resolve) => setTimeout(resolve, 15)); parent.abort(); }
     assert.equal((await pending).ok, false);
     const failure = logs.map((line) => JSON.parse(line)).find((event) => event.phase === 'request_failed');
     assert.equal(failure.abortOrigin, firstSource);
   } finally { console.info = originalInfo; }
 });
}

test('only approved single-use speech suppresses audio interruption; explicit abort still cancels', async () => {
  let disallowed = 0; let calls = 0;
  const ctx = { disallowInterruptions: () => { disallowed++; } };
  const tool = createHermesDocumentsTestTool({ env, room: room(), roomSid: 'RM_test', grant,
    fetchImpl: (_url, options) => {
      calls++; assert.equal(disallowed, 1);
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
        reject(new DOMException('synthetic explicit cancellation', 'AbortError'));
      }, { once: true }));
    } });
  assert.equal((await tool.execute({ question: 'model supplied' }, { ctx })).ok, false);
  assert.equal(disallowed, 0); assert.equal(calls, 0);
  const parent = new AbortController();
  const pending = tool.execute({}, { ctx, abortSignal: parent.signal }); parent.abort();
  assert.equal((await pending).ok, false);
  assert.equal((await tool.execute({}, { ctx })).ok, false);
  assert.equal(disallowed, 1); assert.equal(calls, 1);
});
