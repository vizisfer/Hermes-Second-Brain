import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { getPrayerTimesDirect } from './aladhan-direct.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '172.22.0.1';
const TOKEN = process.env.HERMES_BRIDGE_TOKEN;

if (!TOKEN || TOKEN.length < 32) {
  console.error('HERMES_BRIDGE_TOKEN must be at least 32 characters');
  process.exit(1);
}

function authorized(req) {
  const provided = req.headers.authorization;
  const expected = `Bearer ${TOKEN}`;

  if (!provided || Buffer.byteLength(provided) !== Buffer.byteLength(expected)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST' || !['/prayer-times', '/agent/task', '/prayer-times/direct-test'].includes(req.url)) {
    res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  if (!authorized(req)) {
    res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2048) {
        res.writeHead(413).end(JSON.stringify({ error: 'too_large' }));
        return;
      }
    }

    const payload = JSON.parse(body);

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
