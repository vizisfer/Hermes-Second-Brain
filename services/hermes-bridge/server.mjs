import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { getPrayerTimesDirect } from './aladhan-direct.mjs';
import { McpGateway, loadMcpConfig } from './mcp-gateway.mjs';
import { createDocumentTestHandler } from './documents-test-route.mjs';

const documentTest = createDocumentTestHandler({
  keyFile: process.env.DOCUMENTS_TEST_CAPABILITY_KEY_FILE,
  replayDir: process.env.DOCUMENTS_TEST_REPLAY_DIR,
});

const portText = process.env.PORT?.trim();
const PORT = portText ? Number(portText) : 8787;
const HOST = process.env.HOST?.trim() || '127.0.0.1';
const TOKEN = process.env.HERMES_BRIDGE_TOKEN;
const SENSITIVE_READ_TOKEN = process.env.MCP_SENSITIVE_READ_TOKEN;

if ((portText && !/^\d{1,5}$/.test(portText)) || !Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error('invalid_port');
  process.exit(1);
}
let normalizedHost = HOST;
if (isIP(HOST) === 6) {
  try { normalizedHost = new URL(`http://[${HOST}]/`).hostname; } catch { normalizedHost = ''; }
}
if ((HOST !== 'localhost' && isIP(HOST) === 0) || HOST === '0.0.0.0' || normalizedHost === '[::]') {
  console.error('invalid_host');
  process.exit(1);
}

if (!TOKEN || TOKEN.length < 32) {
  console.error('HERMES_BRIDGE_TOKEN must be at least 32 characters');
  process.exit(1);
}
if (SENSITIVE_READ_TOKEN && (SENSITIVE_READ_TOKEN.length < 32 || SENSITIVE_READ_TOKEN === TOKEN)) {
  console.error('MCP_SENSITIVE_READ_TOKEN must be distinct and at least 32 characters');
  process.exit(1);
}

const mcpGateway = await new McpGateway(await loadMcpConfig(), {
  audit: async ({ tool, outcome, durationMs }) => {
    console.info(JSON.stringify({ event: 'mcp_tool', tool, outcome, ...(durationMs === undefined ? {} : { durationMs }) }));
  },
}).start();

const mcpRate = new Map();
function mcpRateLimited(req) {
  const now = Date.now();
  const key = req.socket.remoteAddress || 'unknown';
  if (mcpRate.size > 2048) {
    for (const [address, window] of mcpRate) if (now - window.startedAt >= 60_000) mcpRate.delete(address);
    if (mcpRate.size > 2048 && !mcpRate.has(key)) return true;
  }
  let window = mcpRate.get(key);
  if (!window || now - window.startedAt >= 60_000) { window = { startedAt: now, count: 0 }; mcpRate.set(key, window); }
  window.count++;
  return window.count > 60;
}

function authorized(req) {
  const provided = req.headers.authorization;
  const expected = `Bearer ${TOKEN}`;

  if (!provided || Buffer.byteLength(provided) !== Buffer.byteLength(expected)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function authorizedSensitiveRead(req) {
  const provided = req.headers['x-mcp-sensitive-read'];
  if (!SENSITIVE_READ_TOKEN || typeof provided !== 'string' || Buffer.byteLength(provided) !== Buffer.byteLength(SENSITIVE_READ_TOKEN)) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(SENSITIVE_READ_TOKEN));
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const mcpRoute = ['/mcp/health', '/mcp/tools', '/mcp/call'].includes(req.url);
  const privateRoute = req.url === '/agent/documents-test';
  if ((!mcpRoute && (req.method !== 'POST' || !['/prayer-times', '/agent/task', '/prayer-times/direct-test', '/agent/documents-test'].includes(req.url)))
    || (mcpRoute && !((req.method === 'GET' && req.url !== '/mcp/call') || (req.method === 'POST' && req.url === '/mcp/call')))) {
    res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  if ((mcpRoute || privateRoute) && mcpRateLimited(req)) {
    res.writeHead(429).end(JSON.stringify({ error: 'rate_limited' }));
    return;
  }

  if (!authorized(req)) {
    res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  try {
    let body = '';
    let bodyBytes = 0;
    for await (const chunk of req) {
      bodyBytes += chunk.length;
      const text = chunk.toString();
      if (bodyBytes > 8192 || (!mcpRoute && body.length + text.length > 2048)) {
        res.writeHead(413).end(JSON.stringify({ error: 'too_large' }));
        return;
      }
      body += text;
    }

    const payload = req.method === 'GET' ? {} : JSON.parse(body);

    if (privateRoute) {
      const suppliedId = req.headers['x-document-test-request-id'];
      const requestId = typeof suppliedId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId) ? suppliedId : randomUUID();
      const started = performance.now();
      const log = (phase, status) => console.info(JSON.stringify({ event: 'document_test_request', requestId, phase, ...(status === undefined ? {} : { status }), durationMs: Math.round(performance.now() - started) }));
      log('received');
      const controller = new AbortController();
      const onAborted = () => { log('request_aborted'); if (!controller.signal.aborted) controller.abort(); };
      const onClosed = () => { log('response_closed'); if (!res.writableEnded && !controller.signal.aborted) controller.abort(); };
      req.once('aborted', onAborted);
      res.once('close', onClosed);
      const result = await documentTest({ payload, capability: req.headers['x-document-test-capability'], signal: controller.signal, requestId });
      req.removeListener('aborted', onAborted); res.removeListener('close', onClosed);
      if (!res.destroyed) res.writeHead(result.status).end(JSON.stringify(result.body));
      log('finished', result.status);
      return;
    }

    if (req.url === '/mcp/health' && req.method === 'GET') {
      res.writeHead(200).end(JSON.stringify(mcpGateway.health()));
      return;
    }

    if (req.url === '/mcp/tools' && req.method === 'GET') {
      res.writeHead(200).end(JSON.stringify({ tools: mcpGateway.listTools({ includeSensitive: authorizedSensitiveRead(req) }) }));
      return;
    }

    if (req.url === '/mcp/call') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).some(key => !['tool', 'arguments'].includes(key))
        || typeof payload.tool !== 'string' || !payload.arguments || typeof payload.arguments !== 'object' || Array.isArray(payload.arguments)) {
        res.writeHead(400).end(JSON.stringify({ error: 'invalid_request' }));
        return;
      }
      const controller = new AbortController();
      const cancelIfDisconnected = () => { if (!res.writableEnded) controller.abort(); };
      req.once('aborted', cancelIfDisconnected);
      res.once('close', cancelIfDisconnected);
      const result = await mcpGateway.call(payload.tool, payload.arguments, { signal: controller.signal, allowSensitiveRead: authorizedSensitiveRead(req) });
      req.removeListener('aborted', cancelIfDisconnected);
      res.removeListener('close', cancelIfDisconnected);
      if (res.destroyed) return;
      res.writeHead(result.status).end(JSON.stringify(result.body));
      return;
    }

    if (req.url === '/prayer-times/direct-test') {
      const { city, country } = payload;
      if (
        typeof city !== 'string' ||
        typeof country !== 'string' ||
        !/^[\p{L}\p{M} .'-]{1,80}$/u.test(city) ||
        !/^[\p{L}\p{M} .'-]{1,80}$/u.test(country)
      ) {
        res.writeHead(400).end(JSON.stringify({ error: 'invalid_location' }));
        return;
      }

      try {
        const result = await getPrayerTimesDirect({ city, country });
        res.writeHead(200).end(JSON.stringify(result));
      } catch {
        res.writeHead(502).end(JSON.stringify({ error: 'aladhan_mcp_failed' }));
      }
      return;
    }

    if (req.url === '/agent/task') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'task')) {
        res.writeHead(400).end(JSON.stringify({ error: 'invalid_task' }));
        return;
      }
      const { task } = payload;

      if (typeof task !== 'string' || task.trim().length === 0 || task.length > 1000) {
        res.writeHead(400).end(JSON.stringify({ error: 'invalid_task' }));
        return;
      }

      const child = spawn(
        '/home/digisfer/.local/bin/hermes',
        [
          '-p', 'voice-infrastructure-bot',
          '-t', 'aladhan-readonly',
          'chat',
          '--query', task,
          '--oneshot',
          '--max-turns', '5',
        ],
        {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let output = '';
      let finished = false;

      const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);

      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (output.length > 20000) child.kill('SIGKILL');
      });

      child.stderr.resume();

      child.on('error', () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (!res.headersSent) {
          res.writeHead(502).end(JSON.stringify({ error: 'hermes_failed' }));
        }
      });

      child.on('close', code => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);

        if (code !== 0) {
          res.writeHead(502).end(JSON.stringify({ error: 'hermes_failed' }));
          return;
        }

        res.writeHead(200).end(JSON.stringify({ response: output.slice(-12000) }));
      });
      return;
    }

    const { city, country } = payload;

    if (
      typeof city !== 'string' ||
      typeof country !== 'string' ||
      !/^[\p{L}\p{M} .'-]{1,80}$/u.test(city) ||
      !/^[\p{L}\p{M} .'-]{1,80}$/u.test(country)
    ) {
      res.writeHead(400).end(JSON.stringify({ error: 'invalid_location' }));
      return;
    }

    const child = spawn(
      '/home/digisfer/.local/bin/hermes',
      [
        '-p', 'voice-infrastructure-bot',
        '-t', 'aladhan-readonly',
        'chat',
        '--query',
        `Use AlAdhan MCP to get today's prayer times for ${city}, ${country}.`,
        '--oneshot',
        '--max-turns', '5',
      ],
      {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let output = '';
    let finished = false;

    const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);

    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.length > 20000) child.kill('SIGKILL');
    });

    child.stderr.resume();

    child.on('error', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (!res.headersSent) {
        res.writeHead(502).end(JSON.stringify({ error: 'hermes_failed' }));
      }
    });

    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);

      if (code !== 0) {
        res.writeHead(502).end(JSON.stringify({ error: 'hermes_failed' }));
        return;
      }

      res.writeHead(200).end(JSON.stringify({ response: output.slice(-12000) }));
    });

  } catch {
    if (!res.headersSent) {
      res.writeHead(400).end(JSON.stringify({ error: 'invalid_request' }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Hermes Bridge listening on ${HOST}:${server.address().port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await mcpGateway.close();
    server.close(() => process.exit(0));
  });
}
