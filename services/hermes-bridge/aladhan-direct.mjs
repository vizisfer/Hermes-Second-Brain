import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const VOICE_ROOT = process.env.VOICE_INFRASTRUCTURE_ROOT || '/home/digisfer/agentsfer/voice-infrastructure';
const voiceRequire = createRequire(resolve(VOICE_ROOT, 'package.json'));
const MCP_SERVER = resolve(VOICE_ROOT, 'src/tools/aladhan-mcp-allowlist.mjs');

export async function getPrayerTimesDirect({ city, country }) {
  const { Client } = voiceRequire('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = voiceRequire('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER],
    env: {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: process.env.HOME || '',
    },
  });
  const client = new Client({ name: 'hermes-bridge-direct-test', version: '1.0.0' });
  const startedAt = performance.now();

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const toolNames = listed.tools.map(tool => tool.name);
    if (toolNames.length !== 1 || toolNames[0] !== 'timings') {
      throw new Error('AlAdhan MCP allowlist mismatch');
    }

    const callStartedAt = performance.now();
    const result = await client.callTool({
      name: 'timings',
      arguments: { city, country },
    });
    const mcpLatencyMs = Number((performance.now() - callStartedAt).toFixed(1));
    if (result.isError) throw new Error('AlAdhan MCP call failed');

    const response = result.content
      ?.filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');
    if (!response) throw new Error('AlAdhan MCP returned no text');

    return {
      response,
      mcpLatencyMs,
      totalLatencyMs: Number((performance.now() - startedAt).toFixed(1)),
    };
  } finally {
    await client.close().catch(() => {});
  }
}
