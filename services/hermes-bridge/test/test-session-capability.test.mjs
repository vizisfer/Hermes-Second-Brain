import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  consumeCapability,
  issueCapability,
  verifyCapability,
} from '../test-session-capability.mjs';

const TMP_ROOT = process.env.TMPDIR;
assert.ok(typeof TMP_ROOT === 'string' && TMP_ROOT.length > 0, 'TMPDIR must be configured for scratch-only tests');
const context = Object.freeze({
  roomSid: 'RM_test-room-1',
  participantIdentity: 'test-participant',
  question: 'What is in the authorized test document?',
});

function newKey() {
  return randomBytes(32);
}

function unauthorized(fn) {
  assert.throws(fn, (error) => error instanceof Error && error.message === 'unauthorized');
}

async function withScratch(t, callback) {
  const dir = await mkdtemp(join(TMP_ROOT, 'session-capability-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  return callback(dir);
}

function signFixture(key, overrides = {}, extras = {}) {
  const now = 1_700_000_000_000;
  const claims = {
    version: 1,
    tenant: 'agentsfer',
    bank: 'agentsfer-second-brain',
    scope: 'documents:read',
    audience: 'hermes-documents-test',
    roomSid: context.roomSid,
    participantIdentity: context.participantIdentity,
    questionHash: createHmac('sha256', Buffer.alloc(0)).update('').digest('hex'),
    iat: now,
    exp: now + 60_000,
    nonce: '01234567-89ab-4cde-8fab-0123456789ab',
    ...overrides,
  };
  const { createHash } = awaitlessCrypto;
  claims.questionHash = overrides.questionHash ?? createHash('sha256').update(context.question, 'utf8').digest('hex');
  Object.assign(claims, extras);
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', key).update(payload, 'ascii').digest('base64url');
  return `${payload}.${signature}`;
}

// Imported separately to keep fixture signing explicit and independent from module internals.
import { createHash } from 'node:crypto';
const awaitlessCrypto = { createHash };

const testNow = 1_700_000_000_000;

test('issues and verifies a short-lived capability with fixed claims', () => {
  const key = newKey();
  const token = issueCapability({ key, ...context, now: testNow });
  assert.equal(typeof token, 'string');
  assert.ok(token.length <= 4096);
  const claims = verifyCapability({ key, token, ...context, now: testNow });
  assert.equal(claims.version, 1);
  assert.equal(claims.tenant, 'agentsfer');
  assert.equal(claims.bank, 'agentsfer-second-brain');
  assert.equal(claims.scope, 'documents:read');
  assert.equal(claims.audience, 'hermes-documents-test');
  assert.equal(claims.iat, testNow);
  assert.equal(claims.exp, testNow + 120_000);
  assert.match(claims.nonce, /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('rejects missing, malformed, noncanonical, oversized, and tampered tokens generically', () => {
  const key = newKey();
  const token = issueCapability({ key, ...context, now: testNow });
  for (const candidate of [undefined, '', 'not-a-token', `${token}.extra`, `${token}=`, 'A'.repeat(4097)]) {
    unauthorized(() => verifyCapability({ key, token: candidate, ...context, now: testNow }));
  }
  const [payload, signature] = token.split('.');
  const tamperedSignature = `${payload}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
  unauthorized(() => verifyCapability({ key, token: tamperedSignature, ...context, now: testNow }));
});

test('rejects expired, future-issued, and malformed signed claims', () => {
  const key = newKey();
  const expired = issueCapability({ key, ...context, now: testNow - 2000, ttlMs: 1000 });
  unauthorized(() => verifyCapability({ key, token: expired, ...context, now: testNow }));

  unauthorized(() => verifyCapability({
    key,
    token: signFixture(key, { iat: testNow + 1, exp: testNow + 1000 }),
    ...context,
    now: testNow,
  }));
  unauthorized(() => verifyCapability({
    key,
    token: signFixture(key, { exp: testNow + 120_001 }),
    ...context,
    now: testNow,
  }));
  unauthorized(() => verifyCapability({
    key,
    token: signFixture(key, {}, { unexpected: true }),
    ...context,
    now: testNow,
  }));
  unauthorized(() => verifyCapability({
    key,
    token: signFixture(key, { nonce: 'not-a-uuid' }),
    ...context,
    now: testNow,
  }));
});

test('rejects wrong room, participant, and exact question', () => {
  const key = newKey();
  const token = issueCapability({ key, ...context, now: testNow });
  unauthorized(() => verifyCapability({ key, token, ...context, roomSid: 'RM_other', now: testNow }));
  unauthorized(() => verifyCapability({ key, token, ...context, participantIdentity: 'other', now: testNow }));
  unauthorized(() => verifyCapability({ key, token, ...context, question: `${context.question} `, now: testNow }));
});

test('rejects signed adversarial tenant, bank, scope, and audience claims', () => {
  const key = newKey();
  const badClaims = [
    { tenant: 'other' },
    { bank: 'other-bank' },
    { scope: 'documents:write' },
    { audience: 'public' },
  ];
  for (const overrides of badClaims) {
    unauthorized(() => verifyCapability({ key, token: signFixture(key, overrides), ...context, now: testNow }));
  }
});

test('rejects invalid keys, TTLs, and issuance context', () => {
  for (const key of [undefined, 'x'.repeat(32), Buffer.alloc(31)]) {
    assert.throws(() => issueCapability({ key, ...context, now: testNow }), TypeError);
  }
  const key = newKey();
  for (const ttlMs of [0, -1, 120_001, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => issueCapability({ key, ...context, now: testNow, ttlMs }), TypeError);
  }
  for (const bad of [
    { roomSid: '' },
    { roomSid: 'r'.repeat(129) },
    { participantIdentity: '' },
    { participantIdentity: 'p'.repeat(129) },
    { question: '  ' },
    { question: 'q'.repeat(501) },
  ]) {
    assert.throws(() => issueCapability({ key, ...context, ...bad, now: testNow }), TypeError);
  }
});

test('consumes once and persists replay rejection across calls', async (t) => {
  const key = newKey();
  const token = issueCapability({ key, ...context, now: testNow });
  await withScratch(t, async (dir) => {
    const claims = await consumeCapability({ key, token, ...context, replayDir: dir, now: testNow });
    assert.equal(claims.nonce.length, 36);
    await assert.rejects(
      consumeCapability({ key, token, ...context, replayDir: dir, now: testNow }),
      (error) => error instanceof Error && error.message === 'unauthorized',
    );
  });
});

test('concurrent consumption allows exactly one caller', async (t) => {
  const key = newKey();
  const token = issueCapability({ key, ...context, now: testNow });
  await withScratch(t, async (dir) => {
    const outcomes = await Promise.allSettled([
      consumeCapability({ key, token, ...context, replayDir: dir, now: testNow }),
      consumeCapability({ key, token, ...context, replayDir: dir, now: testNow }),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((result) => result.status === 'rejected' && result.reason.message === 'unauthorized').length, 1);
  });
});

test('fails closed when replay storage cannot be created or written', async (t) => {
  const key = newKey();
  const token = issueCapability({ key, ...context, now: testNow });
  await withScratch(t, async (dir) => {
    const notDirectory = join(dir, 'file');
    await writeFile(notDirectory, '');
    await assert.rejects(
      consumeCapability({ key, token, ...context, replayDir: notDirectory, now: testNow }),
      (error) => error instanceof Error && error.message === 'unauthorized',
    );
  });
  await assert.rejects(
    consumeCapability({ key, token, ...context, replayDir: '', now: testNow }),
    (error) => error instanceof Error && error.message === 'unauthorized',
  );
});
