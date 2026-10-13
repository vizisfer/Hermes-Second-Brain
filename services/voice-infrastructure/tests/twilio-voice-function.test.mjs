import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
const require = createRequire(import.meta.url);

const functionSource = await readFile(new URL('../functions/voice.js', import.meta.url), 'utf8');

function loadHandler() {
  const module = { exports: {} };
  class VoiceResponse {
    constructor() { this.operations = []; }
    say(text) { this.operations.push(['say', text]); }
    dial() {
      return {
        sip: (attributes, uri) => this.operations.push(['sip', attributes, uri]),
      };
    }
    toString() {
      const body = this.operations.map(([kind, attributes, uri]) => kind === 'sip'
        ? `<Dial><Sip username="${escapeXml(attributes.username)}" password="${escapeXml(attributes.password)}">${escapeXml(uri)}</Sip></Dial>`
        : `<Say>${escapeXml(attributes)}</Say>`).join('');
      return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
    }
  }
  vm.runInNewContext(functionSource, {
    exports: module.exports,
    Twilio: { twiml: { VoiceResponse } },
    encodeURIComponent,
    require,
    Buffer,
    Date,
  });
  return module.exports.handler;
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

test('valid E.164 To builds exactly the secure LiveKit SIP destination', async () => {
  const handler = loadHandler();
  const context = { LIVEKIT_SIP_USERNAME: 'test-user', LIVEKIT_SIP_PASSWORD: 'test-pass' };
  const validTo = '+' + '1'.repeat(11);
  const event = { To: validTo, From: 'caller-sensitive', CallerName: 'untrusted' };
  let err;
  let twiml;
  handler(context, event, (error, response) => { err = error; twiml = String(response); });
  assert.equal(err, null);
  assert.equal(twiml,
    `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Sip username="test-user" password="test-pass">sip:${validTo}@4mrqk60h9ww.sip.livekit.cloud;transport=tcp</Sip></Dial></Response>`);
  assert.equal(twiml.includes(event.From), false);
  assert.equal(twiml.includes(event.CallerName), false);
  assert.match(twiml, /<Sip username="test-user" password="test-pass">sip:\+[1-9]\d{1,14}@4mrqk60h9ww\.sip\.livekit\.cloud;transport=tcp<\/Sip>/);
});

test('invalid and missing To fail closed and never include credentials', async (t) => {
  const handler = loadHandler();
  const credentials = { LIVEKIT_SIP_USERNAME: 'secret-user', LIVEKIT_SIP_PASSWORD: 'secret-pass' };
  for (const to of [undefined, '', '14155552671', '+0123', '+123abc', '+1234567890123456']) {
    await t.test(`rejects ${String(to)}`, () => {
      let err;
      let twiml;
      handler(credentials, { To: to }, (error, response) => { err = error; twiml = String(response); });
      assert.equal(err, null);
      assert.match(twiml, /<Response><Say>/);
      assert.doesNotMatch(twiml, /<Dial>|<Sip>/);
      assert.doesNotMatch(twiml, /secret-user|secret-pass/);
    });
  }
});

test('missing SIP credentials fail closed without revealing configured values', () => {
  const handler = loadHandler();
  for (const context of [
    { LIVEKIT_SIP_USERNAME: '', LIVEKIT_SIP_PASSWORD: 'secret-pass' },
    { LIVEKIT_SIP_USERNAME: 'secret-user' },
  ]) {
    let twiml;
    handler(context, { To: '+14155552671' }, (_error, response) => { twiml = String(response); });
    assert.doesNotMatch(twiml, /<Dial>|<Sip>|secret-user|secret-pass/);
  }
});

test('only an exact allowlisted caller receives the short-lived signed test-call SIP header', () => {
  const handler = loadHandler();
  const caller = '+14155550123';
  const to = '+' + '1'.repeat(11);
  const key = 'test-key-value-that-is-at-least-thirty-two-bytes';
  const context = { LIVEKIT_SIP_USERNAME: 'test-user', LIVEKIT_SIP_PASSWORD: 'test-pass',
    HINDSIGHT_PHONE_TEST_KEY: key, HINDSIGHT_TEST_CALLER_E164: caller, HINDSIGHT_TEST_TO_E164: to };
  const event = { To: to, From: caller, CallSid: 'CA' + 'a'.repeat(32) };
  let twiml;
  handler(context, event, (_error, response) => { twiml = String(response); });
  assert.match(twiml, /x-agentsfer-hindsight-test=/);
  const token = decodeURIComponent(twiml.match(/x-agentsfer-hindsight-test=([^<]+)/)[1]);
  const [sid, from, called, expiresAt, mac] = token.split('~');
  assert.equal(sid, event.CallSid);
  assert.equal(from, caller);
  assert.equal(called, to);
  assert.ok(Number(expiresAt) > Date.now() && Number(expiresAt) <= Date.now() + 90_000);
  const expected = createHmac('sha256', key).update(`${sid}|${from}|${called}|${expiresAt}`).digest('base64url');
  assert.equal(mac, expected);
  assert.ok(twiml.length < 1000);
});

test('wrong caller, destination, missing call SID, or missing key keep the existing SIP route grant-free', () => {
  const handler = loadHandler();
  const caller = '+14155550123';
  const to = '+' + '1'.repeat(11);
  const context = { LIVEKIT_SIP_USERNAME: 'test-user', LIVEKIT_SIP_PASSWORD: 'test-pass',
    HINDSIGHT_PHONE_TEST_KEY: 'test-key-value-that-is-at-least-thirty-two-bytes',
    HINDSIGHT_TEST_CALLER_E164: caller, HINDSIGHT_TEST_TO_E164: to };
  for (const event of [
    { To: to, From: '+14155550999', CallSid: 'CA' + 'b'.repeat(32) },
    { To: '+' + '2'.repeat(11), From: caller, CallSid: 'CA' + 'c'.repeat(32) },
    { To: to, From: caller },
  ]) {
    let twiml;
    handler(context, event, (_error, response) => { twiml = String(response); });
    assert.match(twiml, /<Dial><Sip/);
    assert.doesNotMatch(twiml, /x-agentsfer-hindsight-test=/);
  }
  let noKeyOutput;
  handler({ LIVEKIT_SIP_USERNAME: 'test-user', LIVEKIT_SIP_PASSWORD: 'test-pass', HINDSIGHT_TEST_CALLER_E164: caller,
    HINDSIGHT_TEST_TO_E164: to }, { To: to, From: caller, CallSid: 'CA' + 'd'.repeat(32) }, (_error, response) => { noKeyOutput = String(response); });
  assert.doesNotMatch(noKeyOutput, /x-agentsfer-hindsight-test=/);
});
