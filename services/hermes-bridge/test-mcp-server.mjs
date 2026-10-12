import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve(import.meta.dirname, '../voice-infrastructure/package.json'));
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const server = new McpServer({ name: 'agentsfer-safe-test-server', version: '1.0.0' });
server.registerTool('echo', { description: 'Return supplied non-sensitive test text.', inputSchema: { message: z.string().min(1).max(256) } }, async ({ message }) => ({ content: [{ type: 'text', text: message }] }));
server.registerTool('current_test_status', { description: 'Return local test-server status.', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'local-test-server-ready' }] }));
server.registerTool('wait', { description: 'Wait for bounded local timeout/cancellation tests.', inputSchema: { milliseconds: z.number().int().min(1).max(5_000) } }, async ({ milliseconds }, { signal }) => {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true });
  });
  return { content: [{ type: 'text', text: 'wait-complete' }] };
});
server.registerTool('failure', { description: 'Return a sanitized MCP tool failure for tests.', inputSchema: {} }, async () => ({ isError: true, content: [{ type: 'text', text: 'private failure detail' }] }));
server.registerTool('crash', { description: 'Terminate this local test MCP process.', inputSchema: {} }, async () => { process.exit(17); });
server.registerTool('unsupported_array', { description: 'Expose a schema outside the Gateway primitive subset.', inputSchema: { values: z.array(z.string()) } }, async () => ({ content: [{ type: 'text', text: 'not-callable' }] }));
await server.connect(new StdioServerTransport());
