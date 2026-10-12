import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createPinnedRemoteFetch, McpGateway, validateConfig } from '../mcp-gateway.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const serverFile = resolve(import.meta.dirname, '../test-mcp-server.mjs');
const local = { enabled: true, transport: 'stdio', access: 'read-only', command: process.execPath, args: [serverFile], allowedTools: ['echo', 'current_test_status', 'wait', 'failure', 'crash'], env: { PATH: '/usr/bin:/bin' } };

test('configuration rejects unsafe transports, executable paths, duplicate and malformed policy', () => {
  for (const config of [
    { mcpServers: { bad: { ...local, command: 'node' } } },
    { mcpServers: { bad: { ...local, allowedTools: ['echo', 'echo'] } } },
    { mcpServers: { bad: { ...local, transport: 'sse' } } },
    { mcpServers: { bad: { ...local, unexpected: true } } },
    { mcpServers: { bad: { ...local, url: 'https://example.com/mcp' } } },
    { mcpServers: { bad: { enabled: true, transport: 'streamable-http', access: 'read-only', url: 'https://example.com/mcp', allowedTools: ['echo'], command: process.execPath, args: [] } } },
    { mcpServers: { bad: { ...local, args: Array(65).fill('bounded') } } },
    { mcpServers: { bad: { ...local, transport: 'streamable-http', url: 'http://127.0.0.1/mcp' } } },
  ]) assert.throws(() => validateConfig(config), /invalid_config/);
});

test('disabled MCP servers are not spawned or registered', async () => {
  const gateway = await new McpGateway({ mcpServers: { local_test: { ...local, enabled: false } } }).start();
  assert.deepEqual(gateway.health(), { status: 'ready', servers: [], toolCount: 0 });
  assert.deepEqual(gateway.listTools(), []);
  await gateway.close();
});

test('local MCP is discovered, namespaced, allowlisted and executes validated calls', async () => {
  const events = [];
  const gateway = await new McpGateway({ mcpServers: { local_test: local } }, { audit: async event => events.push(event) }).start();
  try {
    assert.deepEqual(gateway.listTools().map(tool => tool.id), ['local_test__echo', 'local_test__current_test_status', 'local_test__wait', 'local_test__failure', 'local_test__crash']);
    assert.deepEqual(await gateway.call('unconfigured__tool', {}), { status: 404, body: { error: 'tool_not_found' } });
    assert.deepEqual(await gateway.call('local_test__echo', { message: 'safe local check' }), { status: 200, body: { content: ['safe local check'] } });
    assert.deepEqual(await gateway.call('local_test__echo', { message: '' }), { status: 400, body: { error: 'invalid_arguments' } });
    assert.deepEqual(await gateway.call('local_test__echo', { message: 'ok', extra: true }), { status: 400, body: { error: 'invalid_arguments' } });
    assert.deepEqual(await gateway.call('local_test__current_test_status', {}), { status: 200, body: { content: ['local-test-server-ready'] } });
    assert.deepEqual(await gateway.call('local_test__failure', {}), { status: 502, body: { error: 'tool_failed' } });
    const timed = await gateway.call('local_test__wait', { milliseconds: 250 }, { timeoutMs: 30 });
    assert.equal(timed.status, 504);
    const controller = new AbortController();
    const pending = gateway.call('local_test__wait', { milliseconds: 1_000 }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    assert.equal((await pending).status, 499);
    assert.equal((await gateway.call('local_test__wait', { milliseconds: 50 })).status, 200);
    const pendingConcurrent = Array.from({ length: 8 }, () => gateway.call('local_test__wait', { milliseconds: 180 }));
    assert.equal((await gateway.call('local_test__wait', { milliseconds: 10 })).status, 429);
    const concurrent = await Promise.all(pendingConcurrent);
    assert.ok(concurrent.every(result => result.status === 200));
    assert.equal((await gateway.call('local_test__crash', {})).status, 502);
    assert.deepEqual(gateway.health().servers, [{ name: 'local_test', status: 'unavailable' }]);
    assert.deepEqual(await gateway.call('local_test__echo', { message: 'reconnected on new request' }), { status: 200, body: { content: ['reconnected on new request'] } });
    assert.deepEqual(gateway.health().servers, [{ name: 'local_test', status: 'ready' }]);
    assert.deepEqual(events.map(event => event.outcome).slice(0, 6), ['started', 'success', 'started', 'success', 'started', 'failed']);
    assert.doesNotMatch(JSON.stringify(events), /safe local check|Bearer|token/);
  } finally { await gateway.close(); }
});

test('write and destructive tools remain denied even when configured', async () => {
  for (const access of ['write', 'destructive']) {
    const gateway = await new McpGateway({ mcpServers: { local_test: { ...local, access, allowedTools: ['echo'] } } }).start();
    try { assert.equal((await gateway.call('local_test__echo', { message: 'never called' })).status, 403); }
    finally { await gateway.close(); }
  }
});

test('sensitive-read tools require a separate grant and stay out of the default catalog', async () => {
  const gateway = await new McpGateway({ mcpServers: { local_test: { ...local, access: 'sensitive-read', allowedTools: ['echo'] } } }).start();
  try {
    assert.deepEqual(gateway.listTools(), []);
    assert.deepEqual(gateway.listTools({ includeSensitive: true }).map(tool => tool.id), ['local_test__echo']);
    assert.equal((await gateway.call('local_test__echo', { message: 'sensitive' })).status, 403);
    assert.equal((await gateway.call('local_test__echo', { message: 'authorized' }, { allowSensitiveRead: true })).status, 200);
  } finally { await gateway.close(); }
});

test('a server with an unknown configured tool is isolated and exposes no tools', async () => {
  const gateway = await new McpGateway({ mcpServers: { local_test: { ...local, allowedTools: ['not_real'] } } }).start();
  assert.deepEqual(gateway.health().servers, [{ name: 'local_test', status: 'unavailable' }]);
  assert.deepEqual(gateway.listTools(), []);
  assert.equal((await gateway.call('local_test__not_real', {})).status, 404);
  await gateway.close();
});

test('tools with unsupported JSON schema shapes are rejected at discovery', async () => {
  const gateway = await new McpGateway({ mcpServers: { local_test: { ...local, allowedTools: ['unsupported_array'] } } }).start();
  assert.deepEqual(gateway.health().servers, [{ name: 'local_test', status: 'unavailable' }]);
  assert.deepEqual(gateway.listTools(), []);
  await gateway.close();
});

test('stdio executables are restricted and remote MCP targets reject loopback/private destinations', async () => {
  const executable = await new McpGateway({ mcpServers: { local_test: { ...local, command: '/bin/false' } } }).start();
  assert.deepEqual(executable.health().servers, [{ name: 'local_test', status: 'unavailable' }]);
  await executable.close();
  const remote = await new McpGateway({ mcpServers: { remote: { enabled: true, transport: 'streamable-http', access: 'read-only', url: 'https://127.0.0.1/mcp', allowedTools: ['echo'] } } }).start();
  assert.deepEqual(remote.health().servers, [{ name: 'remote', status: 'unavailable' }]);
  assert.deepEqual(remote.listTools(), []);
  await remote.close();
});

test('remote Streamable HTTP pins the TLS socket to the validated public DNS answer', async () => {
  let requestOptions;
  const fetchPinned = createPinnedRemoteFetch(new URL('https://mcp.example/mcp'), {
    resolveHost: async host => { assert.equal(host, 'mcp.example'); return [{ address: '93.184.216.34', family: 4 }]; },
    requestImpl: (options, onResponse) => {
      requestOptions = options;
      const request = new EventEmitter();
      request.write = body => { assert.equal(body, '{}'); };
      request.end = () => { const response = new PassThrough(); response.statusCode = 200; response.statusMessage = 'OK'; response.rawHeaders = ['content-type', 'application/json']; onResponse(response); response.end('{}'); };
      return request;
    },
  });
  const response = await fetchPinned('https://mcp.example/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(await response.text(), '{}');
  assert.equal(requestOptions.hostname, 'mcp.example');
  assert.equal(requestOptions.servername, 'mcp.example');
  assert.equal(requestOptions.agent, false);
  assert.equal(requestOptions.lookup('mcp.example', {}, (_error, address) => assert.equal(address, '93.184.216.34')), undefined);
  assert.equal(requestOptions.rejectUnauthorized, true);
});

test('remote Streamable HTTP rejects non-global IPv6 and special-purpose IPv4 answers', async () => {
  for (const address of ['2001:0:0:1::1', '2001:2::1', '2001:20::1', '2001:db8::1', '2002:c000:201::1', '3fff::1', '5f00::1', 'fc00::1', 'fe80::1', 'ff02::1', '::1', '192.88.99.1']) {
    const fetchPinned = createPinnedRemoteFetch(new URL('https://mcp.example/mcp'), {
      resolveHost: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
      requestImpl: () => assert.fail(`request must not be made to ${address}`),
    });
    await assert.rejects(fetchPinned('https://mcp.example/mcp'), /unsafe_destination/);
  }
  let requestOptions;
  const globalIpv6 = createPinnedRemoteFetch(new URL('https://mcp.example/mcp'), {
    resolveHost: async () => [{ address: '2606:4700:4700::1111', family: 6 }],
    requestImpl: (options, onResponse) => {
      requestOptions = options;
      const request = new EventEmitter(); request.write = () => {};
      request.end = () => { const response = new PassThrough(); response.statusCode = 204; response.statusMessage = 'No Content'; response.rawHeaders = []; onResponse(response); response.end(); };
      return request;
    },
  });
  assert.equal((await globalIpv6('https://mcp.example/mcp')).status, 204);
  assert.equal(requestOptions.lookup('mcp.example', {}, (_error, address) => assert.equal(address, '2606:4700:4700::1111')), undefined);
});

test('remote Streamable HTTP rejects redirects without following their Location', async () => {
  let requests = 0;
  const fetchPinned = createPinnedRemoteFetch(new URL('https://mcp.example/mcp'), {
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl: (_options, onResponse) => {
      requests++;
      const request = new EventEmitter(); request.write = () => {};
      request.end = () => { const response = new PassThrough(); response.statusCode = 302; response.statusMessage = 'Found'; response.rawHeaders = ['location', 'https://127.0.0.1/admin']; onResponse(response); response.end(); };
      return request;
    },
  });
  await assert.rejects(fetchPinned('https://mcp.example/mcp'), /remote_redirect_denied/);
  assert.equal(requests, 1);
});

test('remote Streamable HTTP rejects responses above the configured byte limit', async () => {
  const fetchPinned = createPinnedRemoteFetch(new URL('https://mcp.example/mcp'), {
    maxResponseBytes: 4,
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl: (_options, onResponse) => {
      const request = new EventEmitter(); request.write = () => {};
      request.end = () => { const response = new PassThrough(); response.statusCode = 200; response.statusMessage = 'OK'; response.rawHeaders = []; onResponse(response); response.end('12345'); };
      return request;
    },
  });
  const response = await fetchPinned('https://mcp.example/mcp');
  await assert.rejects(response.text(), /remote_response_too_large/);
});
