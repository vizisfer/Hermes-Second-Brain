import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { createSecureToolBroker, createLiveKitToolAdapter } from '../src/tools/secure-tool-broker.mjs';

const runContext = Object.freeze({ session: 'opaque-run-context' });
const principal = Object.freeze({ id: 'server-principal', tenantId: 'tenant-a', scopes: ['lookup'], source: 'server', expiresAt: Date.now() + 60_000, sessionBinding: 'verified-session' });
const inputSchema = z.object({ key: z.string().min(1) }).strict();
const outputSchema = z.object({ value: z.string() }).strict();
const registry = (adapter = async ({ input }) => ({ value: input.key }), tenantId = 'tenant-a') => [{ name: 'lookup', description: 'Look up a key', inputSchema, outputSchema, requiredScopes: ['lookup'], timeoutMs: 500, tenantId, adapter }];
const defaultAuthorize = async ({ args, capability, principal: p, tenant, signal }) => {
  assert.equal(args.key, 'safe'); assert.equal(capability, 'lookup'); assert.equal(p.id, principal.id); assert.equal(tenant, 'tenant-a'); assert.ok(signal instanceof AbortSignal); return true;
};
const base = (overrides = {}) => createSecureToolBroker({ registry: registry(), resolvePrincipal: async ({ runContext: context }) => { assert.equal(context, runContext); return principal; }, authorize: defaultAuthorize, audit: async () => {}, ...overrides });
const options = { runContext };

test('valid model input cannot influence the resolver fixed trusted principal', async () => {
  let resolverCalls = 0;
  const broker = base({ resolvePrincipal: async ({ runContext: context }) => { resolverCalls++; assert.equal(context, runContext); return principal; } });
  assert.deepEqual(await broker.execute('lookup', { key: 'safe' }, options), { ok: true, data: { value: 'safe' } });
  assert.equal(resolverCalls, 1);
});

test('invalid extra model fields are rejected before resolver', async () => {
  let resolverCalls = 0;
  const broker = base({ resolvePrincipal: async () => { resolverCalls++; return principal; } });
  const result = await broker.execute('lookup', { key: 'safe', principal: { id: 'attacker' }, tenantId: 'tenant-b', role: 'admin' }, options);
  assert.equal(result.error.code, 'INVALID_INPUT'); assert.equal(resolverCalls, 0);
});

test('missing trusted resolver denies by default', async () => {
  const broker = base({ resolvePrincipal: undefined });
  assert.equal((await broker.execute('lookup', { key: 'safe' }, options)).error.code, 'UNAUTHORIZED');
});

test('tenant mismatch and expiry are denied deterministically', async () => {
  const tenantBroker = base({ registry: registry(undefined, 'tenant-b') });
  assert.equal((await tenantBroker.execute('lookup', { key: 'safe' }, options)).error.code, 'DENIED');
  const expired = base({ resolvePrincipal: async () => ({ ...principal, expiresAt: 0 }) }); assert.equal((await expired.execute('lookup', { key: 'safe' }, options)).error.code, 'UNAUTHORIZED');
});

test('LiveKit adapter is a real FunctionTool and maps opts.ctx and abortSignal', async () => {
  const broker = base(); const adapted = createLiveKitToolAdapter({ broker, capability: 'lookup' });
  assert.equal(adapted.type, 'function'); assert.equal(adapted.description, 'Look up a key'); assert.ok(adapted.parameters); assert.equal(typeof adapted.execute, 'function');
  assert.deepEqual(await adapted.execute({ key: 'safe' }, { ctx: runContext, toolCallId: 'call-1', abortSignal: new AbortController().signal }), { ok: true, data: { value: 'safe' } });
  assert.equal((await adapted.execute({ key: 'safe', extra: 1 }, { ctx: runContext, abortSignal: new AbortController().signal })).error.code, 'INVALID_INPUT');
  let observed;
  const wrapped = createLiveKitToolAdapter({ capability: 'lookup', broker: { has: (n) => broker.has(n), definition: (n) => broker.definition(n), execute: async (_n, _a, opts) => { observed = opts; return { ok: true, data: { value: 'safe' } }; } } });
  const controller = new AbortController();
  await wrapped.execute({ key: 'safe' }, { ctx: runContext, toolCallId: 'call-2', abortSignal: controller.signal });
  assert.equal(observed.runContext, runContext); assert.equal(observed.signal, controller.signal);
});

test('caller abort reaches adapter signal and returns CANCELLED', async () => {
  let adapterSignal;
  const broker = base({ registry: registry(({ signal }) => { adapterSignal = signal; return new Promise(() => {}); }) });
  const controller = new AbortController(); const pending = broker.execute('lookup', { key: 'safe' }, { ...options, signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve)); controller.abort();
  assert.equal((await pending).error.code, 'CANCELLED'); assert.equal(adapterSignal.aborted, true);
});

test('LiveKit adapter emits a non-blocking progress update before running a long tool', async () => {
  const calls = [];
  const broker = { has: () => true, definition: () => ({ name: 'lookup', description: 'Look up a key', inputSchema }), execute: async (_name, _args, options) => { calls.push(['execute', options]); return { ok: true, data: { value: 'safe' } }; } };
  const adapted = createLiveKitToolAdapter({ broker, capability: 'lookup', onStart: async (ctx) => { calls.push(['update', ctx]); await ctx.update('Checking that now.'); } });
  const ctx = { update: async () => {} };
  const controller = new AbortController();
  await adapted.execute({ key: 'safe' }, { ctx, abortSignal: controller.signal });
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[1][0], 'execute');
  assert.equal(calls[1][1].signal, controller.signal);
});

test('ACL timeout aborts its signal and denies', async () => {
  let authorizationSignal;
  const broker = base({ authorizationTimeoutMs: 15, authorize: ({ signal }) => { authorizationSignal = signal; return new Promise(() => {}); } });
  assert.equal((await broker.execute('lookup', { key: 'safe' }, options)).error.code, 'DENIED'); assert.equal(authorizationSignal.aborted, true);
});

test('pre-execution audit failure prevents adapter execution', async () => {
  let adapterRan = false;
  const broker = base({ registry: registry(async () => { adapterRan = true; return { value: 'safe' }; }), audit: async () => { throw new Error('audit unavailable'); } });
  assert.equal((await broker.execute('lookup', { key: 'safe' }, options)).error.code, 'AUDIT_UNAVAILABLE'); assert.equal(adapterRan, false);
});

test('normalized input and adapter output are validated strictly', async () => {
  const broker = base({ registry: registry(async () => ({ value: 'safe', extra: 'reject' })) });
  assert.equal((await broker.execute('lookup', { key: 'safe', extra: true }, options)).error.code, 'INVALID_INPUT');
  assert.equal((await broker.execute('lookup', { key: 'safe' }, options)).error.code, 'INVALID_OUTPUT');
});
