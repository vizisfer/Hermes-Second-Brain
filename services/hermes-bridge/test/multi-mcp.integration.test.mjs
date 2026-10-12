import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { McpGateway, validateConfig } from '../mcp-gateway.mjs';

test('AlAdhan and a harmless local MCP share one namespaced Gateway', { timeout: 20_000 }, async () => {
  const path = resolve(import.meta.dirname, '../mcp-servers.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  config.mcpServers.local_test.enabled = true;
  validateConfig(config);
  const gateway = await new McpGateway(config).start();
  try {
    const ids = gateway.listTools().map(tool => tool.id).sort();
    assert.deepEqual(ids, ['aladhan__timings', 'local_test__current_test_status', 'local_test__echo'].sort(), JSON.stringify(gateway.health()));
    assert.deepEqual(await gateway.call('local_test__echo', { message: 'same gateway' }), { status: 200, body: { content: ['same gateway'] } });
    const started = performance.now();
    const aladhan = await gateway.call('aladhan__timings', { city: 'Istanbul', country: 'Türkiye' }, { timeoutMs: 12_000 });
    const elapsedMs = Number((performance.now() - started).toFixed(1));
    assert.equal(aladhan.status, 200, `AlAdhan tool failed with ${JSON.stringify(aladhan.body)}`);
    assert.ok(aladhan.body.content.length > 0);
    console.info(JSON.stringify({ event: 'local_multi_mcp_integration', tool: 'aladhan__timings', elapsedMs, outcome: 'success' }));
  } finally { await gateway.close(); }
});
