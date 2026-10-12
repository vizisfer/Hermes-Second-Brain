import test from 'node:test';
import assert from 'node:assert/strict';
import { createHermesPrivateTestTool, hermesTaskInputSchema } from '../src/tools/hermes-task.mjs';

const token = 'test-token-not-a-real-credential';
const roomName = 'test-room';
const env = { HERMES_GATEWAY_URL: 'https://hermes-api.agentsfer.com/agent/task', HERMES_GATEWAY_TOKEN: token };
const taskInput = { task: 'prayer_times', language: 'tr', city: 'İstanbul', country: 'Türkiye' };
const ctxFor = (name = roomName, update = async () => {}) => ({ session: { room: { name } }, update });
const successResponse = { ok: true, json: async () => ({ response: 'Namaz vakitleri hazır.' }) };

function makeTool(overrides = {}, fetchImpl = async () => successResponse, timeoutMs = 30_000) {
  return createHermesPrivateTestTool({ env: { ...env, ...overrides }, room: { name: roomName }, fetchImpl, timeoutMs });
}

test('strict task schema accepts supported requests and rejects unbounded or extra data', () => {
  assert.equal(hermesTaskInputSchema.safeParse(taskInput).success, true);
  assert.equal(hermesTaskInputSchema.safeParse({ task: 'shell', language: 'en' }).success, false);
  assert.equal(hermesTaskInputSchema.safeParse({ ...taskInput, transcript: 'caller text' }).success, false);
  assert.equal(hermesTaskInputSchema.safeParse({ ...taskInput, city: 'x'.repeat(101) }).success, false);
});

test('Hermes task remains enabled only when its authenticated HTTPS endpoint is configured', () => {
  assert.equal(createHermesPrivateTestTool({ env: {}, room: { name: roomName } }), undefined);
  const tool = makeTool();
  assert.equal(tool.type, 'function');
  assert.equal(typeof tool.execute, 'function');
});

test('Hermes task preserves the room-context gate without using it as principal identity', async () => {
  let calls = 0;
  const tool = createHermesPrivateTestTool({ env, fetchImpl: async () => { calls++; return successResponse; } });
  const result = await tool.execute(taskInput, { ctx: { session: {}, update: async () => {} }, abortSignal: new AbortController().signal });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
  assert.equal(calls, 0);
});

test('Hermes task rejects an insecure endpoint without contacting it', async () => {
  let called = false;
  const tool = makeTool({ HERMES_GATEWAY_URL: 'http://insecure.example/task' }, async () => { called = true; return successResponse; });
  const result = await tool.execute(taskInput, { ctx: ctxFor(), abortSignal: new AbortController().signal });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TOOL_FAILED');
  assert.equal(called, false);
});

test('complex task calls the existing authenticated Hermes endpoint and returns only validated text', async () => {
  let request;
  const audit = [];
  const updates = [];
  const originalInfo = console.info;
  console.info = (line) => audit.push(JSON.parse(line));
  try {
    const tool = makeTool({}, async (url, options) => {
      request = { url: String(url), options };
      return successResponse;
    });
    const result = await tool.execute(taskInput, {
      ctx: ctxFor(roomName, async (text) => updates.push(text)),
      abortSignal: new AbortController().signal,
    });
    assert.deepEqual(result, { ok: true, data: { response: 'Namaz vakitleri hazır.' } });
    assert.equal(request.url, env.HERMES_GATEWAY_URL);
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.authorization, `Bearer ${token}`);
    const payload = JSON.parse(request.options.body);
    assert.match(payload.task, /AlAdhan MCP/);
    assert.match(payload.task, /Turkish/);
    assert.deepEqual(updates, ['İsteği kontrol ediyorum; biraz sürebilir.']);
    assert.deepEqual(audit.map(({ outcome, phase }) => [outcome, phase]), [['started', 'start'], ['success', 'complete']]);
    assert.doesNotMatch(JSON.stringify(audit), /İstanbul|Türkiye|Namaz|token/);
  } finally {
    console.info = originalInfo;
  }
});

test('pre-aborted Hermes task never calls the Gateway', async () => {
  let calls = 0;
  const tool = makeTool({}, async () => { calls++; return successResponse; });
  const controller = new AbortController();
  controller.abort();
  const result = await tool.execute(taskInput, { ctx: ctxFor(), abortSignal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CANCELLED');
  assert.equal(calls, 0);
});

test('Gateway errors and malformed responses remain sanitized', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 401 }),
    async () => ({ ok: true, json: async () => ({ response: '', secret: 'do-not-return' }) }),
  ]) {
    const result = await makeTool({}, fetchImpl).execute(taskInput, { ctx: ctxFor(), abortSignal: new AbortController().signal });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /401|secret|do-not-return/);
  }
});

test('Gateway timeout and caller cancellation abort the request', async () => {
  let timeoutSignal;
  const hangingFetch = (_url, { signal }) => {
    timeoutSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };
  const timed = await makeTool({}, hangingFetch, 15).execute(taskInput, { ctx: ctxFor(), abortSignal: new AbortController().signal });
  assert.equal(timed.error.code, 'TIMEOUT');
  assert.equal(timeoutSignal.aborted, true);

  let callerSignal;
  const controller = new AbortController();
  const pending = makeTool({}, (_url, { signal }) => {
    callerSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }).execute(taskInput, { ctx: ctxFor(), abortSignal: controller.signal });
  setImmediate(() => controller.abort());
  const cancelled = await pending;
  assert.equal(cancelled.error.code, 'CANCELLED');
  assert.equal(callerSignal.aborted, true);
});
