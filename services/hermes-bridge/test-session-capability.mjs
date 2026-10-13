import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const MAX_TTL_MS = 120_000;
const MAX_TOKEN_LENGTH = 4096;
const CLAIM_KEYS = Object.freeze([
  'version',
  'tenant',
  'bank',
  'scope',
  'audience',
  'roomSid',
  'participantIdentity',
  'questionHash',
  'iat',
  'exp',
  'nonce',
]);
const UNAUTHORIZED = 'unauthorized';

function unauthorized() {
  return new Error(UNAUTHORIZED);
}

function requireKey(key, fail = false) {
  if (!Buffer.isBuffer(key) || key.length < 32) {
    throw fail ? unauthorized() : new TypeError('key must be a Buffer of at least 32 bytes');
  }
}

function validateContext({ roomSid, participantIdentity, question }, fail = false) {
  const validBoundedString = (value, max) =>
    typeof value === 'string' && value.length > 0 && value.length <= max;
  if (!validBoundedString(roomSid, 128)
      || !validBoundedString(participantIdentity, 128)
      || typeof question !== 'string'
      || question.trim().length === 0
      || question.length > 500) {
    throw fail ? unauthorized() : new TypeError('invalid capability context');
  }
}

function validateNow(now, fail = false) {
  if (!Number.isSafeInteger(now)) {
    throw fail ? unauthorized() : new TypeError('now must be a safe integer');
  }
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function encodeBase64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function decodeCanonicalBase64url(value) {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw unauthorized();
  }
  const decoded = Buffer.from(value, 'base64url');
  if (encodeBase64url(decoded) !== value) throw unauthorized();
  return decoded;
}

function sign(key, payloadPart) {
  return createHmac('sha256', key).update(payloadPart, 'ascii').digest();
}

export function issueCapability({
  key,
  roomSid,
  participantIdentity,
  question,
  now = Date.now(),
  ttlMs = MAX_TTL_MS,
}) {
  requireKey(key);
  validateContext({ roomSid, participantIdentity, question });
  validateNow(now);
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS
      || !Number.isSafeInteger(now + ttlMs)) {
    throw new TypeError('invalid capability lifetime');
  }

  const claims = {
    version: 1,
    tenant: 'agentsfer',
    bank: 'agentsfer-second-brain',
    scope: 'documents:read',
    audience: 'hermes-documents-test',
    roomSid,
    participantIdentity,
    questionHash: sha256Hex(question),
    iat: now,
    exp: now + ttlMs,
    nonce: randomUUID(),
  };
  const payloadPart = encodeBase64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  return `${payloadPart}.${encodeBase64url(sign(key, payloadPart))}`;
}

function validateClaims(claims, { roomSid, participantIdentity, question, now }) {
  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) throw unauthorized();
  const keys = Object.keys(claims);
  if (keys.length !== CLAIM_KEYS.length || CLAIM_KEYS.some((key) => !Object.hasOwn(claims, key))) {
    throw unauthorized();
  }
  if (claims.version !== 1
      || claims.tenant !== 'agentsfer'
      || claims.bank !== 'agentsfer-second-brain'
      || claims.scope !== 'documents:read'
      || claims.audience !== 'hermes-documents-test'
      || typeof claims.roomSid !== 'string'
      || claims.roomSid.length === 0
      || claims.roomSid.length > 128
      || typeof claims.participantIdentity !== 'string'
      || claims.participantIdentity.length === 0
      || claims.participantIdentity.length > 128
      || typeof claims.questionHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(claims.questionHash)
      || !Number.isSafeInteger(claims.iat)
      || !Number.isSafeInteger(claims.exp)
      || claims.iat > now
      || claims.exp <= now
      || claims.exp <= claims.iat
      || claims.exp - claims.iat > MAX_TTL_MS
      || typeof claims.nonce !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(claims.nonce)
      || claims.roomSid !== roomSid
      || claims.participantIdentity !== participantIdentity
      || claims.questionHash !== sha256Hex(question)) {
    throw unauthorized();
  }
  return claims;
}

export function verifyCapability({
  key,
  token,
  roomSid,
  participantIdentity,
  question,
  now = Date.now(),
}) {
  try {
    requireKey(key, true);
    validateContext({ roomSid, participantIdentity, question }, true);
    validateNow(now, true);
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw unauthorized();
    }
    const parts = token.split('.');
    if (parts.length !== 2) throw unauthorized();

    // Validate and check the signature over the exact encoded payload before decoding claims.
    const suppliedSignature = decodeCanonicalBase64url(parts[1]);
    if (suppliedSignature.length !== 32) throw unauthorized();
    const expectedSignature = sign(key, parts[0]);
    if (!timingSafeEqual(suppliedSignature, expectedSignature)) throw unauthorized();

    const payloadBytes = decodeCanonicalBase64url(parts[0]);
    const claims = JSON.parse(payloadBytes.toString('utf8'));
    return validateClaims(claims, { roomSid, participantIdentity, question, now });
  } catch {
    throw unauthorized();
  }
}

export async function consumeCapability({
  key,
  token,
  roomSid,
  participantIdentity,
  question,
  replayDir,
  now = Date.now(),
}) {
  const claims = verifyCapability({ key, token, roomSid, participantIdentity, question, now });
  try {
    if (typeof replayDir !== 'string' || replayDir.length === 0) throw new Error('invalid replay directory');
    await mkdir(replayDir, { recursive: true, mode: 0o700 });
    await writeFile(`${replayDir}/${claims.nonce}`, '', { flag: 'wx', mode: 0o600 });
    return claims;
  } catch {
    throw unauthorized();
  }
}
