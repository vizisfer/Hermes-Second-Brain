import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpGatewayTools } from '../src/tools/mcp-gateway-catalog.mjs';

const token = 'a-placeholder-local-test-token-not-a-secret';
const env = { HERMES_GATEWAY_TOKEN: token, HERMES_GATEWAY_URL: 'https://bridge.example/agent/task', SAGE_MCP_TOOLS: 'local_test__echo' };
const metadata = { id: 'local_test__echo', description: 'Echo a test message', access: 'read-only', inputSchema: { type: 'object', properties: { message: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['message'] } };
const ctx = { session: { room: { name: 'test-room' } }, update: async () => {} };
const signal = new AbortController().signal;

test('dynamic MCP catalog is opt-in and rejects absent credentials or invalid names', async () => {
  assert.deepEqual(await createMcpGatewayTools({ env: {} }), {});
  assert.deepEqual(await createMcpGatewayTools({ env: { ...env, SAGE_MCP_TOOLS: 'not valid' } }), {});
});

test('Gateway tools fail closed when the explicit Gateway URL is unset', async () => {
  let requests = 0;
  const tools = await createMcpGatewayTools({
    env: { ...env, HERMES_GATEWAY_URL: '' },
    fetchImpl: async () => { requests++; return { ok: true, text: async () => JSON.stringify({ tools: [metadata] }) }; },
  });
  assert.deepEqual(tools, {});
  assert.equal(requests, 0);
});

test('only explicitly configured read-only catalog tools are registered and securely routed', async () => {
  const requests = []; const audit = []; const originalInfo = console.info;
  console.info = line => audit.push(JSON.parse(line));
  try {
    const tools = await createMcpGatewayTools({ env, room: { name: 'test-room' }, fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (options.method === 'GET') return { ok: true, text: async () => JSON.stringify({ tools: [metadata] }) };
      return { ok: true, text: async () => JSON.stringify({ content: ['local echo result'] }) };
    } });
    const tool = tools.local_test__echo;
    assert.equal(tool.type, 'function');
    assert.equal(tool.parameters.safeParse({ message: 'hi' }).success, true);
    assert.equal(tool.parameters.safeParse({ message: '', extra: true }).success, false);
    const result = await tool.execute({ message: 'hello' }, { ctx, abortSignal: signal });
    assert.deepEqual(result, { ok: true, data: { response: 'local echo result' } });
    assert.deepEqual(requests.map(request => request.url), ['https://bridge.example/mcp/tools', 'https://bridge.example/mcp/call']);
    assert.equal(requests[0].options.redirect, 'error');
    assert.equal(requests[1].options.redirect, 'error');
    assert.equal(requests[1].options.headers.authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(requests[1].options.body), { tool: 'local_test__echo', arguments: { message: 'hello' } });
    assert.deepEqual(audit.map(({ outcome, phase }) => [outcome, phase]), [['started', 'start'], ['success', 'complete']]);
    assert.doesNotMatch(JSON.stringify(audit), /hello|result|token/);
  } finally { console.info = originalInfo; }
});

test('MCP tools retain the room-context gate without treating it as tenant identity', async () => {
  const methods = [];
  const tools = await createMcpGatewayTools({ env, fetchImpl: async (_url, options) => {
    methods.push(options.method);
    return options.method === 'GET'
      ? { ok: true, text: async () => JSON.stringify({ tools: [metadata] }) }
      : { ok: true, text: async () => JSON.stringify({ content: ['unexpected'] }) };
  } });
  const result = await tools.local_test__echo.execute({ message: 'safe' }, { ctx: { session: {}, update: async () => {} }, abortSignal: signal });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
  assert.deepEqual(methods, ['GET']);
});

test('unlisted, write, incompatible-schema and malformed-result tools fail closed', async () => {
  for (const catalog of [
    { tools: [{ ...metadata, access: 'sensitive-read' }] },
    { tools: [{ ...metadata, access: 'write' }] },
    { tools: [{ ...metadata, inputSchema: { type: 'object', properties: { message: { type: 'object' } } } }] },
    { tools: [metadata, metadata] },
  ]) {
    const tools = await createMcpGatewayTools({ env, fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(catalog) }) });
    assert.deepEqual(tools, {});
  }
  const tool = (await createMcpGatewayTools({ env, fetchImpl: async (_url, options) => options.method === 'GET' ? ({ ok: true, text: async () => JSON.stringify({ tools: [metadata] }) }) : ({ ok: true, text: async () => JSON.stringify({ leak: 'not accepted' }) }) })).local_test__echo;
  const result = await tool.execute({ message: 'safe' }, { ctx, abortSignal: signal });
  assert.equal(result.ok, false);
});
