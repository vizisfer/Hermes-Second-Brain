import { llm } from '@livekit/agents';
import { z } from 'zod';

// Service and user principals are distinct. A session or room name is never a
// user/tenant identity; tenant-scoped capabilities require a verified user principal.
const registrySchema = z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), description: z.string().min(1), inputSchema: z.custom((v) => v && typeof v.safeParse === 'function'), outputSchema: z.custom((v) => v && typeof v.safeParse === 'function'), requiredScopes: z.array(z.string().min(1)), timeoutMs: z.number().int().min(1).max(30_000), adapter: z.function(), tenantId: z.string().optional() }).strict();
const principalFields = { id: z.string().min(1), scopes: z.array(z.string().min(1)), source: z.string().min(1), expiresAt: z.number().finite(), sessionBinding: z.string().min(1) };
const principalSchema = z.discriminatedUnion('identityType', [
  z.object({ ...principalFields, identityType: z.literal('user'), tenantId: z.string().min(1) }).strict(),
  z.object({ ...principalFields, identityType: z.literal('service') }).strict(),
]);
const safe = { UNAUTHORIZED: 'İşlem yetkilendirilemedi.', DENIED: 'İşlem yetkilendirilemedi.', NOT_FOUND: 'İstenen işlem bulunamadı.', INVALID_INPUT: 'İstek biçimi geçersiz.', INVALID_OUTPUT: 'İşlem sonucu doğrulanamadı.', TIMEOUT: 'İşlem zaman aşımına uğradı.', CANCELLED: 'İşlem iptal edildi.', TOOL_FAILED: 'İşlem tamamlanamadı.', AUDIT_UNAVAILABLE: 'Güvenlik denetimi kullanılamıyor.', OUTCOME_UNCERTAIN: 'İşlem sonucu doğrulanamadı; uzlaştırma gerekiyor.' };
function race(promiseOrFactory, ms, controller, externalSignal, timeoutCode = 'TIMEOUT') {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => { if (timer !== undefined) clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); };
    const finish = (fn, value) => { if (settled) return; settled = true; cleanup(); fn(value); };
    const abort = () => { controller.abort(); finish(reject, Object.assign(new Error('cancelled'), { code: 'CANCELLED' })); };
    timer = setTimeout(() => { controller.abort(); finish(reject, Object.assign(new Error('deadline'), { code: timeoutCode })); }, ms);
    if (externalSignal?.aborted) { abort(); return; }
    externalSignal?.addEventListener('abort', abort, { once: true });
    // Attach both handlers immediately; late rejection after timeout is consumed.
    let promise;
    try { promise = typeof promiseOrFactory === 'function' ? promiseOrFactory() : promiseOrFactory; }
    catch (error) { finish(reject, error); return; }
    Promise.resolve(promise).then((v) => finish(resolve, v), (e) => finish(reject, e));
  });
}
export function createSecureToolBroker({ registry = [], resolvePrincipal, authorize, authorizationTimeoutMs = 1_000, resolverTimeoutMs = 1_000, audit, offlineOnly = false } = {}) {
  const entries = new Map();
  for (const raw of registry) {
    const parsed = registrySchema.safeParse(raw);
    if (!parsed.success || entries.has(raw?.name)) throw new TypeError('Invalid or duplicate tool registration');
    entries.set(parsed.data.name, Object.freeze({ ...parsed.data, adapter: raw.adapter, requiredScopes: Object.freeze([...parsed.data.requiredScopes]), inputSchema: raw.inputSchema, outputSchema: raw.outputSchema }));
  }
  const safeAudit = async (tool, outcome, phase) => {
    if (typeof audit !== 'function') throw new Error('audit unavailable');
    await audit(Object.freeze({ event: 'tool_execution', tool, outcome, phase, timestamp: new Date().toISOString() }));
  };
  const fail = (code) => ({ ok: false, error: { code, message: safe[code] || safe.TOOL_FAILED } });
  const auditCompletion = async (tool, outcome) => { try { await safeAudit(tool, outcome, 'complete'); return true; } catch { return false; } };
  return Object.freeze({
    async execute(name, modelInput, { runContext, signal } = {}) {
      const spec = entries.get(name);
      if (!spec) return fail('NOT_FOUND');
      const parsedInput = spec.inputSchema.safeParse(modelInput);
      if (!parsedInput.success) return fail('INVALID_INPUT');
      if (typeof resolvePrincipal !== 'function' || typeof authorize !== 'function') return fail('UNAUTHORIZED');
      if (signal?.aborted) return fail('CANCELLED');
      const resolverController = new AbortController();
      let principal;
      try {
        const resolved = await race(() => resolvePrincipal(Object.freeze({ runContext, signal: resolverController.signal })), resolverTimeoutMs, resolverController, signal);
        principal = principalSchema.parse(resolved);
        if (principal.expiresAt <= Date.now()) return fail('UNAUTHORIZED');
      } catch (error) { return fail(error?.code === 'CANCELLED' ? 'CANCELLED' : error?.code === 'TIMEOUT' ? 'TIMEOUT' : 'UNAUTHORIZED'); }
      const tenant = principal.identityType === 'user' ? principal.tenantId : undefined;
      if ((spec.tenantId && (principal.identityType !== 'user' || tenant !== spec.tenantId)) || spec.requiredScopes.some((s) => !principal.scopes.includes(s))) return fail('DENIED');
      const aclController = new AbortController();
      try {
        const allowed = await race(() => authorize(Object.freeze({ args: parsedInput.data, capability: spec.name, principal, tenant, signal: aclController.signal })), authorizationTimeoutMs, aclController, signal, 'DENIED');
        if (allowed !== true) return fail('DENIED');
      } catch (error) { return fail(error?.code === 'CANCELLED' ? 'CANCELLED' : 'DENIED'); }
      if (signal?.aborted) return fail('CANCELLED');
      if (spec.adapter.mockOnly === true && !offlineOnly) return fail('DENIED');
      try { await safeAudit(spec.name, 'started', 'start'); } catch { return fail('AUDIT_UNAVAILABLE'); }
      const controller = new AbortController();
      try {
        const output = await race(() => spec.adapter({ input: parsedInput.data, principal, tenant, signal: controller.signal }), spec.timeoutMs, controller, signal);
        const parsedOutput = spec.outputSchema.safeParse(output);
        if (!parsedOutput.success) return (await auditCompletion(spec.name, 'invalid_output')) ? fail('INVALID_OUTPUT') : fail('OUTCOME_UNCERTAIN');
        if (!(await auditCompletion(spec.name, 'success'))) return fail('OUTCOME_UNCERTAIN');
        return { ok: true, data: parsedOutput.data };
      } catch (error) {
        const code = error?.code === 'TIMEOUT' || error?.code === 'CANCELLED' ? error.code : 'TOOL_FAILED';
        if (!(await auditCompletion(spec.name, code.toLowerCase()))) return fail('OUTCOME_UNCERTAIN');
        return fail(code);
      }
    },
    has(name) { return entries.has(name); },
    definition(name) { const s = entries.get(name); return s && Object.freeze({ name: s.name, description: s.description, inputSchema: s.inputSchema }); },
    capabilities() { return [...entries.keys()]; },
  });
}
export function createMockAdapter(handler) {
  if (typeof handler !== 'function') throw new TypeError('Mock handler must be a function');
  const adapter = (context) => handler(context); Object.defineProperty(adapter, 'mockOnly', { value: true }); return adapter;
}
export function createLiveKitToolAdapter({ broker, capability, onStart } = {}) {
  if (!broker || !broker.has(capability)) return undefined;
  const def = broker.definition(capability);
  return llm.tool({ description: def.description, parameters: def.inputSchema, execute: async (args, opts = {}) => {
    if (onStart) await onStart(opts.ctx);
    return broker.execute(capability, args, { runContext: opts.ctx, signal: opts.abortSignal });
  } });
}
