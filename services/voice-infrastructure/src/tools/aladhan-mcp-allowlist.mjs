import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export const ALADHAN_ALLOWED_TOOLS = Object.freeze(['timings']);
const server = new McpServer({ name: 'agentsfer-aladhan-readonly-allowlist', version: '1.0.0' });
const inputSchema = { city: z.string().trim().min(1).max(100), country: z.string().trim().min(1).max(100) };
server.registerTool('timings', {
  title: 'Prayer timings', description: 'Read daily prayer timings from Aladhan for the caller-provided city and country.',
  inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
}, async ({ city, country }) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../../node_modules/prayer-times-mcp/dist/index.js', import.meta.url).pathname], env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '' } });
  const client = new Client({ name: 'agentsfer-aladhan-allowlist-proxy', version: '1.0.0' });
  try {
    await client.connect(transport);
    const available = await client.listTools();
    const upstreamNames = available.tools.map((tool) => tool.name).sort();
    if (upstreamNames.join(',') !== 'hijri_date,month_calendar,timings') throw new Error('upstream tool manifest mismatch');
    if (!ALADHAN_ALLOWED_TOOLS.includes('timings')) throw new Error('tool not allowlisted');
    return await client.callTool({ name: 'timings', arguments: { city, country } });
  } catch {
    return { isError: true, content: [{ type: 'text', text: 'Aladhan prayer timing lookup failed.' }] };
  } finally {
    await client.close().catch(() => {});
  }
});
await server.connect(new StdioServerTransport());
