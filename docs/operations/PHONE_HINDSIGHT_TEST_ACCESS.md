# Hindsight retrieval for an operator-approved phone test

This opt-in uses the existing Twilio → LiveKit → Sage → Hermes Bridge → Hindsight path. It does not change production routing, deploy code, or restart services.

## Gate and flow

1. Twilio Function adds `x-agentsfer-hindsight-test` to the SIP INVITE only when `From` exactly matches `HINDSIGHT_TEST_CALLER_E164`, `To` exactly matches `HINDSIGHT_TEST_TO_E164`, and the shared key is configured.
2. LiveKit Sage reads the SIP header through `lk.sip.GetRemoteHeaders`. The Hindsight tool is registered only when that header is present; browser/non-SIP sessions do not get it.
3. Sage sends one caller question and the signed grant over the existing authenticated HTTPS Bridge connection.
4. Bridge verifies the HMAC, caller, called number, expiry, and one-use `CallSid`, then invokes the existing Hermes documents runner and Hindsight recall MCP. Missing or invalid setup fails closed.

The grant expires after 90 seconds and is consumed once per call. It permits one document/memory retrieval per call. Public MCP catalog and `/agent/task` remain unchanged.

## Operator configuration (do not commit values)

- Generate a random shared key of at least 32 bytes and place the same value in the Twilio Function environment and Bridge secret environment as `HINDSIGHT_PHONE_TEST_KEY`.
- Set `HINDSIGHT_TEST_CALLER_E164` to the operator-controlled test caller number and `HINDSIGHT_TEST_TO_E164` to a dedicated test destination number. Both must be exact E.164 values and match on Twilio and Bridge.
- Set `HINDSIGHT_PHONE_TEST_REPLAY_DIR` to an absolute, persistent directory writable only by the Bridge service user (directory mode `0700`; marker files `0600`).
- Keep the feature disabled until those values are provisioned and reviewed. Never set the test destination to a public production DID unless that exposure is separately accepted.
- The allowlist relies on Twilio's `From` value and is not cryptographic proof of the caller's identity. Use only an operator-controlled test number and test destination; do not treat this MVP as customer authorization or enable it for general callers.

## Verification and release gates

Run only focused tests:

```sh
node --test services/hermes-bridge/test/phone-documents-route.test.mjs
node --test services/voice-infrastructure/tests/hindsight-phone-test.test.mjs services/voice-infrastructure/tests/twilio-voice-function.test.mjs
```

A unit or controlled LiveKit test is not a real phone acceptance. A real Twilio call requires the operator to provision the test values, deploy the Twilio Function and reviewed Sage/Bridge code, and approve the specific test call. Production deployment, secret changes, Twilio routing changes, and service restarts require separate approval.
