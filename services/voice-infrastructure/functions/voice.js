// Twilio Serverless Function: protected inbound voice route to LiveKit SIP.
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
  response.dial().sip(
    { username, password },
    `sip:${to}@4mrqk60h9ww.sip.livekit.cloud;transport=tcp`,
  );
  return callback(null, response);
};
