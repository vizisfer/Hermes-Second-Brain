import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLogger } from '@livekit/agents';
import { createRealtimeModel } from '../src/providers/index.mjs';
import { AGENTSFER_PERSONA, AGENTSFER_GREETING, greetingInstructions, interruptionPolicy } from '../src/persona.mjs';
import { createHermesReadinessTool, isAdminIdentityAllowed } from '../src/tools/hermes-readiness.mjs';

initializeLogger({ pretty: false, level: 'silent' });

test('greeting is short and branded; shared policy requires immediate interruption response', () => {
  assert.match(AGENTSFER_GREETING, /Sage/i);
  assert.match(greetingInstructions(), /hello/i);
  assert.match(AGENTSFER_GREETING, /merhaba/i);
  assert.ok(AGENTSFER_GREETING.length < 80);
  assert.match(greetingInstructions(), /Turkish and English opener/);
  assert.match(interruptionPolicy(), /stop audio output immediately and listen/);
  assert.match(AGENTSFER_PERSONA, /stop audio output immediately and listen/);
});

test('Gemini provider uses the shared persona and does not force Turkish-only speech language', async () => {
  const model = createRealtimeModel({ VOICE_PROVIDER: 'gemini', GOOGLE_API_KEY: 'unit-test-only' });
  assert.equal(model._options.instructions, AGENTSFER_PERSONA);
  assert.equal(model._options.language, undefined);
  await model.close();
});

test('default provider creates the verified Gemini Live adapter', async () => {
  const model = createRealtimeModel({ VOICE_PROVIDER: 'gemini', GOOGLE_API_KEY: 'unit-test-only' });
  assert.equal(model.model, 'gemini-3.8-live');
  assert.equal(model.provider, 'Gemini');
  await model.close();
});

test('provider selection fails closed for unconfigured providers', () => {
  assert.throws(
    () => createRealtimeModel({ VOICE_PROVIDER: 'openai', GOOGLE_API_KEY: 'unit-test-only' }),
    /adapter yapılandırılmadı/,
  );
});

test('Gemini adapter requires a configured key without exposing it', () => {
  assert.throws(() => createRealtimeModel({ VOICE_PROVIDER: 'gemini' }), /GOOGLE_API_KEY yapılandırılmamış/);
});

test('Hermes status tool is disabled unless an allowlisted operator is present', () => {
  const env = {
    HERMES_STATUS_TOOL: 'true',
    VOICE_ADMIN_IDENTITIES: 'operator-1,operator-2',
  };
  assert.equal(isAdminIdentityAllowed(env, 'caller-1'), false);
  assert.equal(createHermesReadinessTool({ env, participantIdentity: 'caller-1' }), undefined);
  assert.equal(isAdminIdentityAllowed(env, 'operator-1'), true);
  assert.ok(createHermesReadinessTool({ env, participantIdentity: 'operator-1' }));
  assert.equal(createHermesReadinessTool({ env: {}, participantIdentity: 'operator-1' }), undefined);
});
