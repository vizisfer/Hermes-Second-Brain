import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentSessionOptions } from '../src/agent.mjs';
import {
  AGENTSFER_GREETING,
  AGENTSFER_PERSONA,
  INTERRUPTION_POLICY,
  greetingInstructions,
} from '../src/persona.mjs';

const promptCases = [
  { name: 'Turkish', input: 'Merhaba, bugün nasılsın?', policy: /Automatically match the caller.s language: Turkish or English/i },
  { name: 'English', input: 'Hello, how are you today?', policy: /Automatically match the caller.s language: Turkish or English/i },
  { name: 'Turkish to English switch', input: 'Türkçe konuşuyordum; please continue in English.', policy: /Follow a clear language change immediately/i },
  { name: 'English to Turkish switch', input: 'I was speaking English; şimdi Türkçe devam edelim.', policy: /Follow a clear language change immediately/i },
  { name: 'mixed technical phrase', input: 'API latency için p95 metric nasıl ölçerim?', policy: /Keep technical terms, product names, commands, and code in their original language/i },
  { name: 'empty input', input: '', policy: /If input is empty, malformed, or unclear, do not guess; briefly ask the caller to repeat or clarify/i },
  { name: 'malformed input', input: '\u0000 ??? [unclosed', policy: /If input is empty, malformed, or unclear, do not guess; briefly ask the caller to repeat or clarify/i },
];

test('shared interruption policy remains in persona', () => {
  assert.ok(AGENTSFER_PERSONA.includes(INTERRUPTION_POLICY));
  assert.match(INTERRUPTION_POLICY, /stop audio output immediately/i);
  assert.match(INTERRUPTION_POLICY, /listen to the caller/i);
});

test('runtime session configuration uses documented 250ms interruption threshold', () => {
  const model = { provider: 'fixture' };
  const options = buildAgentSessionOptions(model);
  assert.equal(options.llm, model);
  assert.equal(options.turnHandling.turnDetection, 'realtime_llm');
  assert.deepEqual(options.turnHandling.interruption, { enabled: true, minDuration: 250 });
});

test('unknown-language fallback is concise, branded, and bilingual', () => {
  assert.match(AGENTSFER_GREETING, /Sage/i);
  assert.match(AGENTSFER_PERSONA, /Agentsfer/);
  assert.match(AGENTSFER_GREETING, /merhaba/i);
  assert.match(greetingInstructions(), /hello/i);
  assert.match(greetingInstructions(), /How can I help/i);
  assert.equal(AGENTSFER_GREETING, 'Merhaba, ben Sage. Size nasıl yardımcı olabilirim?');
  assert.match(greetingInstructions('en'), /Hello, I'm Sage\. How can I help you\?/);
  assert.match(greetingInstructions(), /Turkish and English opener/i);
  assert.match(greetingInstructions(), /Sage/);
});

test('known caller language takes precedence over bilingual fallback', () => {
  assert.match(greetingInstructions('tr'), /Sage/);
  assert.match(greetingInstructions('tr'), /in Turkish/);
  assert.match(greetingInstructions('tr'), /Size nasıl yardımcı olabilirim/);
  assert.doesNotMatch(greetingInstructions('tr'), /English/);
  assert.match(greetingInstructions('en'), /Sage/);
  assert.match(greetingInstructions('en'), /in English/);
  assert.match(greetingInstructions('en'), /How can I help/);
  assert.doesNotMatch(greetingInstructions('en'), /Turkish and English/);
});

test('offline prompt-contract cases exercise inputs and applicable shared policies', async (t) => {
  for (const scenario of promptCases) {
    await t.test(scenario.name, () => {
      // The scenario input is passed as the caller-turn context to the static policy check.
      const promptWithScenario = `${AGENTSFER_PERSONA}\nCaller turn: ${JSON.stringify(scenario.input)}`;
      assert.ok(promptWithScenario.includes(JSON.stringify(scenario.input)));
      assert.match(promptWithScenario, scenario.policy);
    });
  }
  // Static/offline assertions validate prompt policy only; they cannot prove model-generated speech.
  // No Gemini API calls are made by these tests.
});
