import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const MAX_TTL_MS = 120_000;
const CALL_SID = /^CA[a-fA-F0-9]{32}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

function deny() { throw new Error('unauthorized'); }

export function verifyPhoneTestGrant({ token, key, allowedCaller, allowedTo, now = Date.now() } = {}) {
  try {
    if (typeof token !== 'string' || token.length > 256 || typeof key !== 'string' || Buffer.byteLength(key) < 32
      || !E164.test(allowedCaller || '') || !E164.test(allowedTo || '') || !Number.isSafeInteger(now)) deny();
    const parts = token.split('~');
    if (parts.length !== 5) deny();
    const [callSid, from, to, expText, suppliedMac] = parts;
    if (!CALL_SID.test(callSid) || !E164.test(from) || !E164.test(to) || from !== allowedCaller || to !== allowedTo
      || !/^\d{13}$/.test(expText) || !/^[A-Za-z0-9_-]{43}$/.test(suppliedMac)) deny();
    const expiresAt = Number(expText);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt - now > MAX_TTL_MS) deny();
    const signed = `${callSid}|${from}|${to}|${expText}`;
    const expectedMac = createHmac('sha256', key).update(signed, 'utf8').digest('base64url');
    const supplied = Buffer.from(suppliedMac, 'ascii');
    const expected = Buffer.from(expectedMac, 'ascii');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) deny();
    return Object.freeze({ callSid, from, to, expiresAt, scope: 'documents:read' });
  } catch { throw new Error('unauthorized'); }
}

export async function consumePhoneTestGrant({ token, key, allowedCaller, allowedTo, replayDir, now = Date.now() } = {}) {
  const claims = verifyPhoneTestGrant({ token, key, allowedCaller, allowedTo, now });
  try {
    if (typeof replayDir !== 'string' || !isAbsolute(replayDir)) deny();
    await mkdir(replayDir, { recursive: true, mode: 0o700 });
    const marker = createHash('sha256').update(claims.callSid, 'utf8').digest('hex');
    await writeFile(resolve(replayDir, marker), '', { flag: 'wx', mode: 0o600 });
    return claims;
  } catch { throw new Error('unauthorized'); }
}
