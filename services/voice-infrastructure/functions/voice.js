// Twilio Serverless Function: protected inbound voice route to LiveKit SIP.
const { createHmac } = require('crypto');
const E164 = /^\+[1-9]\d{7,14}$/;
const CALL_SID = /^CA[a-fA-F0-9]{32}$/;
const PHONE_TEST_HEADER = 'x-agentsfer-hindsight-test';

function createPhoneTestGrant(context, event) {
  const key = context && context.HINDSIGHT_PHONE_TEST_KEY;
  const caller = event && event.From;
  const allowedCaller = context && context.HINDSIGHT_TEST_CALLER_E164;
  const allowedTo = context && context.HINDSIGHT_TEST_TO_E164;
  const to = event && event.To;
  const callSid = event && event.CallSid;
  if (typeof key !== 'string' || Buffer.byteLength(key) < 32 || typeof caller !== 'string'
    || caller !== allowedCaller || !E164.test(caller) || to !== allowedTo || !E164.test(to || '')
    || typeof callSid !== 'string' || !CALL_SID.test(callSid)) return undefined;
  const expiresAt = String(Date.now() + 90_000);
  const signed = `${callSid}|${caller}|${to}|${expiresAt}`;
  const mac = createHmac('sha256', key).update(signed, 'utf8').digest('base64url');
  return `${callSid}~${caller}~${to}~${expiresAt}~${mac}`;
}

exports.handler = function handler(context, event, callback) {
  const response = new Twilio.twiml.VoiceResponse();
  const to = event && event.To;
  const username = context && context.LIVEKIT_SIP_USERNAME;
  const password = context && context.LIVEKIT_SIP_PASSWORD;

  // Accept only canonical international E.164 numbers; never use caller-supplied
  // values other than the validated destination in the outbound SIP URI.
  if (typeof to !== 'string' || !/^\+[1-9]\d{1,14}$/.test(to) ||
      typeof username !== 'string' || !username ||
      typeof password !== 'string' || !password) {
    response.say('Unable to complete this call.');
    return callback(null, response);
  }

  // Twilio's supported <Sip> authentication attributes keep the SIP URI itself
  // standards-compliant; credentials are provided from encrypted env vars.
  let sipUri = `sip:${to}@4mrqk60h9ww.sip.livekit.cloud;transport=tcp`;
  const grant = createPhoneTestGrant(context, event);
  if (grant) {
    const candidate = `${sipUri}?${PHONE_TEST_HEADER}=${encodeURIComponent(grant)}`;
    // Twilio requires SIP URIs shorter than 255 characters; if any unexpected
    // event value exceeds that bound, preserve the call but withhold the grant.
    if (Buffer.byteLength(candidate) < 255) sipUri = candidate;
  }
  response.dial().sip({ username, password }, sipUri);
  return callback(null, response);
};
