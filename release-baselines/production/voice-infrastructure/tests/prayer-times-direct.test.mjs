import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPrayerTimesDirectTool } from '../src/tools/prayer-times-direct.mjs';
import { createHermesPrivateTestTool } from '../src/tools/hermes-task.mjs';

const token = 'test-token-not-a-real-credential';
const env = { HERMES_GATEWAY_TOKEN: token, HERMES_GATEWAY_URL: 'https://bridge.example/agent/task' };
const ctx = { session: { room: { name: 'test-room' } }, update: async () => {} };
const validInput = { city: 'İstanbul', country: 'Türkiye' };
const directPayload = { response: 'Prayer times: Fajr 05:00', mcpLatencyMs: 100, totalLatencyMs: 200 };

test('direct prayer tool is enabled only with HTTPS bridge and existing Bearer token', () => {
  assert.equal(createPrayerTimesDirectTool({ env: {} }), undefined);
  assert.equal(createPrayerTimesDirectTool({ env: { ...env, HERMES_GATEWAY_URL: 'http://bridge.example/agent/task' } }), undefined);
  const tool = createPrayerTimesDirectTool({ env });
  assert.equal(tool.type, 'function');
  assert.equal(typeof tool.execute, 'function');
});

test('direct prayer tool uses the authenticated test endpoint through the Secure Tool Broker', async () => {
  let request;
  const events = [];
  const originalInfo = console.info;
  console.info = (line) => events.push(JSON.parse(line));
  try {
    const tool = createPrayerTimesDirectTool({
      env,
      room: { name: 'test-room' },
      fetchImpl: async (url, options) => {
        request = { url: String(url), options };
        return { ok: true, json: async () => directPayload };
      },
    });
    const result = await tool.execute(validInput, { ctx, abortSignal: new AbortController().signal });
    assert.deepEqual(result, { ok: true, data: { response: directPayload.response } });
    assert.equal(request.url, 'https://bridge.example/prayer-times/direct-test');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(request.options.body), validInput);
    assert.deepEqual(events.map(({ outcome, phase }) => [outcome, phase]), [['started', 'start'], ['success', 'complete']]);
    assert.doesNotMatch(JSON.stringify(events), /İstanbul|Türkiye|Fajr|token/);
  } finally {
    console.info = originalInfo;
  }
});

test('strict location validation rejects extra fields before contacting Bridge', async () => {
  let calls = 0;
  const tool = createPrayerTimesDirectTool({ env, fetchImpl: async () => { calls++; return { ok: true, json: async () => directPayload }; } });
  const result = await tool.execute({ ...validInput, transcript: 'private caller text' }, { ctx, abortSignal: new AbortController().signal });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_INPUT');
  assert.equal(calls, 0);
});

test('Bridge failures and invalid output stay sanitized', async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 401 }),
    async () => ({ ok: true, json: async () => ({ ...directPayload, unexpected: 'secret' }) }),
  ]) {
    const tool = createPrayerTimesDirectTool({ env, fetchImpl });
    const result = await tool.execute(validInput, { ctx, abortSignal: new AbortController().signal });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret|401/);
  }
});

test('Hermes task remains available for complex requests and keeps its existing endpoint', async () => {
  let request;
  const hermes = createHermesPrivateTestTool({
    env,
    room: { name: 'test-room' },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, json: async () => ({ response: 'Complex task handled by Hermes.' }) };
    },
  });
  assert.equal(hermes.type, 'function');
  assert.equal(typeof hermes.execute, 'function');
  const result = await hermes.execute({ task: 'hijri', language: 'tr' }, { ctx, abortSignal: new AbortController().signal });
  assert.deepEqual(result, { ok: true, data: { response: 'Complex task handled by Hermes.' } });
  assert.equal(request.url, 'https://bridge.example/agent/task');
  assert.equal(request.options.headers.authorization, `Bearer ${token}`);
  assert.match(JSON.parse(request.options.body).task, /Turkish/);
});

test('Sage registers both tools and routes simple prayer-time requests directly', async () => {
  const agent = await readFile(new URL('../src/agent.mjs', import.meta.url), 'utf8');
  const persona = await readFile(new URL('../src/persona.mjs', import.meta.url), 'utf8');
  assert.match(agent, /createPrayerTimesDirectTool\(\{ env: process\.env/);
  assert.match(agent, /tools\.prayer_times_direct = prayerTimesDirectTool/);
  assert.match(agent, /tools\.hermes_task = hermesTaskTool/);
  assert.match(persona, /simple request for today’s prayer times.*prayer_times_direct/s);
  assert.match(persona, /Use hermes_task for complex requests/);
});
