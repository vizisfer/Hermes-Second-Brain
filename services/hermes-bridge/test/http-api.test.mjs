import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createMcpGatewayTools } from '../../voice-infrastructure/src/tools/mcp-gateway-catalog.mjs';

const root = resolve(import.meta.dirname, '..');
const token = 'isolated-test-token-not-a-production-secret-123456';
const sensitiveToken = 'isolated-sensitive-read-token-for-tests-987654';

test('authenticated MCP HTTP routes work and existing Bridge routes remain reachable', { timeout: 15_000 }, async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), 'sage-bridge-test-'));
  const configPath = resolve(scratch, 'mcp.json');
  const localTest = { enabled: true, transport: 'stdio', access: 'read-only', command: process.execPath, args: [resolve(root, 'test-mcp-server.mjs')], allowedTools: ['echo', 'wait'], env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME || '' } };
  const config = { mcpServers: { local_test: localTest, sensitive_test: { ...localTest, access: 'sensitive-read', allowedTools: ['echo'] } } };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const child = spawn(process.execPath, [resolve(root, 'server.mjs')], { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '', HOST: '127.0.0.1', PORT: '0', HERMES_BRIDGE_TOKEN: token, MCP_SENSITIVE_READ_TOKEN: sensitiveToken, MCP_CONFIG_PATH: configPath } });
  let output = ''; let address;
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge startup timeout: ${output}`)), 8_000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/Hermes Bridge listening on 127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); address = `http://127.0.0.1:${match[1]}`; resolveReady(); }
    });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('exit', code => reject(new Error(`bridge exited ${code}: ${output}`)));
  });
  try {
    await ready;
    assert.equal((await fetch(`${address}/mcp/health`)).status, 401);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const sensitiveHeaders = { ...headers, 'x-mcp-sensitive-read': sensitiveToken };
    const health = await fetch(`${address}/mcp/health`, { headers });
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).servers, [{ name: 'local_test', status: 'ready' }, { name: 'sensitive_test', status: 'ready' }]);
    const tools = await fetch(`${address}/mcp/tools`, { headers });
    assert.deepEqual((await tools.json()).tools.map(tool => tool.id), ['local_test__echo', 'local_test__wait']);
    const privilegedTools = await fetch(`${address}/mcp/tools`, { headers: sensitiveHeaders });
    assert.deepEqual((await privilegedTools.json()).tools.map(tool => tool.id), ['local_test__echo', 'local_test__wait', 'sensitive_test__echo']);
    const sensitiveDenied = await fetch(`${address}/mcp/call`, { method: 'POST', headers, body: JSON.stringify({ tool: 'sensitive_test__echo', arguments: { message: 'denied' } }) });
    assert.equal(sensitiveDenied.status, 403);
    const sensitiveAllowed = await fetch(`${address}/mcp/call`, { method: 'POST', headers: sensitiveHeaders, body: JSON.stringify({ tool: 'sensitive_test__echo', arguments: { message: 'separately authorized' } }) });
    assert.equal(sensitiveAllowed.status, 200);
    const called = await fetch(`${address}/mcp/call`, { method: 'POST', headers, body: JSON.stringify({ tool: 'local_test__echo', arguments: { message: 'http local test' } }) });
    assert.equal(called.status, 200);
    assert.deepEqual(await called.json(), { content: ['http local test'] });
    const sageTools = await createMcpGatewayTools({
      env: { HERMES_GATEWAY_TOKEN: token, HERMES_GATEWAY_URL: 'https://gateway.test/agent/task', SAGE_MCP_TOOLS: 'local_test__echo' },
      room: { name: 'test-room' },
      fetchImpl: (url, options) => fetch(`${address}${new URL(url).pathname}`, options),
    });
    const sageResult = await sageTools.local_test__echo.execute({ message: 'Sage through secure broker' }, { ctx: { session: { room: { name: 'test-room' } }, update: async () => {} }, abortSignal: new AbortController().signal });
    assert.deepEqual(sageResult, { ok: true, data: { response: 'Sage through secure broker' } });
    const abort = new AbortController();
    const pending = fetch(`${address}/mcp/call`, { method: 'POST', headers, body: JSON.stringify({ tool: 'local_test__wait', arguments: { milliseconds: 1_000 } }), signal: abort.signal });
    setTimeout(() => abort.abort(), 30);
    await assert.rejects(pending, { name: 'AbortError' });
    const denied = await fetch(`${address}/mcp/call`, { method: 'POST', headers, body: JSON.stringify({ tool: 'other__echo', arguments: { message: 'x' } }) });
    assert.equal(denied.status, 404);
    for (const route of ['/agent/task', '/prayer-times', '/prayer-times/direct-test']) {
      const oldRoute = await fetch(`${address}${route}`, { method: 'POST', headers, body: '{}' });
      assert.equal(oldRoute.status, 400, `${route} must retain its existing validation route`);
    }
    const invalidAuthHeaders = { authorization: 'Bearer deliberately-invalid-test-value', 'content-type': 'application/json' };
    const rateLimitStatuses = await Promise.all(Array.from({ length: 60 }, () => fetch(`${address}/mcp/health`, { headers: invalidAuthHeaders }).then(response => response.status)));
    assert.ok(rateLimitStatuses.includes(401));
    assert.ok(rateLimitStatuses.includes(429));
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolveExit => { if (child.exitCode !== null) resolveExit(); else child.once('exit', resolveExit); });
    await rm(scratch, { recursive: true, force: true });
  }
});

test('bridge rejects invalid port and wildcard bind configuration', { timeout: 15_000 }, async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), 'sage-bridge-invalid-bind-test-'));
  const configPath = resolve(scratch, 'mcp.json');
  await writeFile(configPath, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
  try {
    for (const item of [
      { env: { PORT: '70000' }, expected: /invalid_port/ },
      { env: { PORT: '8787', HOST: '0.0.0.0' }, expected: /invalid_host/ },
      { env: { PORT: '8787', HOST: '::' }, expected: /invalid_host/ },
    ]) {
      const child = spawn(process.execPath, [resolve(root, 'server.mjs')], {
        cwd: root,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '', HERMES_BRIDGE_TOKEN: token, MCP_CONFIG_PATH: configPath, ...item.env },
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk.toString(); });
      child.stderr.on('data', chunk => { output += chunk.toString(); });
      const code = await new Promise(resolveExit => child.once('exit', resolveExit));
      assert.equal(code, 1, output);
      assert.match(output, item.expected);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('bridge binds to loopback when HOST is unset', { timeout: 15_000 }, async () => {
  const scratch = await mkdtemp(resolve(tmpdir(), 'sage-bridge-default-host-test-'));
  const configPath = resolve(scratch, 'mcp.json');
  await writeFile(configPath, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
  const child = spawn(process.execPath, [resolve(root, 'server.mjs')], {
    cwd: root,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '', PORT: '0', HERMES_BRIDGE_TOKEN: token, MCP_CONFIG_PATH: configPath },
  });
  let output = ''; let address;
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge startup timeout: ${output}`)), 8_000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/Hermes Bridge listening on 127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); address = `http://127.0.0.1:${match[1]}`; resolveReady(); }
    });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('exit', code => reject(new Error(`bridge exited ${code}: ${output}`)));
  });
  try {
    await ready;
    assert.equal((await fetch(`${address}/mcp/health`)).status, 401);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolveExit => { if (child.exitCode !== null) resolveExit(); else child.once('exit', resolveExit); });
    await rm(scratch, { recursive: true, force: true });
  }
});
