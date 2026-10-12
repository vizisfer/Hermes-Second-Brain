import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

const root = process.env.VOICE_INFRASTRUCTURE_ROOT || resolve(import.meta.dirname, '../voice-infrastructure');
const require = createRequire(resolve(root, 'package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const NAME = /^(?!.*__)[a-z][a-z0-9_-]{0,39}$/;
const ACCESS = new Set(['read-only', 'sensitive-read', 'write', 'destructive']);
const KEYS = new Set(['enabled', 'transport', 'access', 'allowedTools', 'command', 'args', 'cwd', 'env', 'url', 'authEnv']);
const MAX_OUTPUT = 16_384;
const MAX_CONCURRENCY = 8;

export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => k !== 'mcpServers') || !raw.mcpServers || typeof raw.mcpServers !== 'object' || Array.isArray(raw.mcpServers)) throw new Error('invalid_config');
  const entries = Object.entries(raw.mcpServers);
  if (entries.length > 16) throw new Error('invalid_config');
  for (const [name, cfg] of entries) {
    if (!NAME.test(name) || !cfg || typeof cfg !== 'object' || Array.isArray(cfg) || Object.keys(cfg).some(k => !KEYS.has(k))) throw new Error('invalid_config');
    if (typeof cfg.enabled !== 'boolean' || !ACCESS.has(cfg.access) || !Array.isArray(cfg.allowedTools) || cfg.allowedTools.length > 64 || cfg.allowedTools.some(t => typeof t !== 'string' || !NAME.test(t)) || new Set(cfg.allowedTools).size !== cfg.allowedTools.length) throw new Error('invalid_config');
    if (cfg.transport === 'stdio') {
      if ('url' in cfg || 'authEnv' in cfg || typeof cfg.command !== 'string' || (!isAbsolute(cfg.command) && cfg.command !== '${PROCESS_NODE}') || !Array.isArray(cfg.args) || cfg.args.length > 64 || cfg.args.some(a => typeof a !== 'string' || a.length > 512)) throw new Error('invalid_config');
      if (cfg.cwd !== undefined && (typeof cfg.cwd !== 'string' || !isAbsolute(cfg.cwd))) throw new Error('invalid_config');
      if (cfg.env !== undefined && (!cfg.env || typeof cfg.env !== 'object' || Array.isArray(cfg.env) || Object.keys(cfg.env).length > 32 || Object.keys(cfg.env).some(k => !/^[A-Z_][A-Z0-9_]*$/.test(k) || typeof cfg.env[k] !== 'string' || cfg.env[k].length > 4_096))) throw new Error('invalid_config');
    } else if (cfg.transport === 'streamable-http') {
      if (typeof cfg.url !== 'string' || cfg.url.length > 2_048) throw new Error('invalid_config');
      let url;
      try { url = new URL(cfg.url); } catch { throw new Error('invalid_config'); }
      if (['command', 'args', 'cwd', 'env'].some(key => key in cfg) || cfg.url.length > 2_048 || url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (cfg.authEnv !== undefined && (typeof cfg.authEnv !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(cfg.authEnv)))) throw new Error('invalid_config');
    } else throw new Error('invalid_config');
  }
  return raw.mcpServers;
}

export async function loadMcpConfig(path = process.env.MCP_CONFIG_PATH || resolve(import.meta.dirname, 'mcp-servers.json')) {
  try { const parsed = JSON.parse(await readFile(path, 'utf8')); validateConfig(parsed); return parsed; } catch { throw new Error('invalid_config'); }
}
function expand(value, env) { return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_m, key) => {
  if (key === 'PROCESS_NODE') return process.execPath;
  if (key === 'VOICE_ROOT') return resolve(import.meta.dirname, '../voice-infrastructure');
  if (key === 'BRIDGE_ROOT') return import.meta.dirname;
  if (typeof env[key] !== 'string') throw new Error('missing_environment');
  return env[key];
}); }
function publicIp(address) {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    const value = (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
    const inCidr = (base, bits) => (value >>> (32 - bits)) === (base >>> (32 - bits));
    const blocked = [[0, 8], [10, 8], [100 << 24 | 64 << 16, 10], [127, 8], [169 << 24 | 254 << 16, 16], [172 << 24 | 16 << 16, 12], [192 << 24, 24], [192 << 24 | 0 << 16 | 2 << 8, 24], [192 << 24 | 88 << 16 | 99 << 8, 24], [192 << 24 | 168 << 16, 16], [198 << 24 | 18 << 16, 15], [198 << 24 | 51 << 16 | 100 << 8, 24], [203 << 24 | 0 << 16 | 113 << 8, 24], [224 << 24, 4], [240 << 24, 4]];
    return !blocked.some(([base, bits]) => inCidr(base >>> 0, bits));
  }
  const ip = address.toLowerCase();
  if (ip.includes('%') || ip.includes('.')) return false;
  const sections = ip.split('::');
  if (sections.length > 2) return false;
  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : [];
  const groups = sections.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return false;
  const first = Number.parseInt(groups[0], 16);
  const second = Number.parseInt(groups[1], 16);
  if (first < 0x2000 || first > 0x3fff) return false;
  if ((first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) || first === 0x2002 || (first === 0x3fff && second <= 0x0fff)) return false;
  return true;
}
async function checkRemote(url, resolveHost = lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('unsafe_destination');
  const records = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolveHost(host, { all: true, verbatim: true }).catch(() => []);
  if (!records.length || records.some(({ address }) => !publicIp(address))) throw new Error('unsafe_destination');
  return records;
}

export function createPinnedRemoteFetch(originUrl, { resolveHost = lookup, requestImpl = httpsRequest, maxResponseBytes = 1_048_576 } = {}) {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) throw new Error('invalid_response_limit');
  return async (input, init = {}) => {
    const target = new URL(input);
    if (target.origin !== originUrl.origin || target.protocol !== 'https:' || init.redirect === 'follow') throw new Error('unsafe_destination');
    const records = await checkRemote(target, resolveHost);
    const address = records[0];
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    return await new Promise((resolve, reject) => {
      const host = target.hostname.replace(/^\[|\]$/g, '');
      const req = requestImpl({
        hostname: host,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: init.method || 'GET',
        headers,
        agent: false,
        signal: init.signal,
        servername: isIP(host) ? undefined : host,
        rejectUnauthorized: true,
        lookup: (_hostname, options, callback) => {
          if (options?.all) callback(null, [{ address: address.address, family: address.family || isIP(address.address) }]);
          else callback(null, address.address, address.family || isIP(address.address));
        },
      }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume();
          reject(new Error('remote_redirect_denied'));
          return;
        }
        const responseHeaders = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        let body;
        if (![204, 205, 304].includes(response.statusCode)) {
          let receivedBytes = 0;
          body = Readable.toWeb(response).pipeThrough(new TransformStream({
            transform(chunk, controller) {
              receivedBytes += chunk.byteLength;
              if (receivedBytes > maxResponseBytes) { controller.error(new Error('remote_response_too_large')); return; }
              controller.enqueue(chunk);
            },
          }));
        }
        resolve(new Response(body, { status: response.statusCode, statusText: response.statusMessage, headers: responseHeaders }));
      });
      req.once('error', reject);
      if (init.body !== undefined && init.body !== null) {
        if (typeof init.body !== 'string' && !Buffer.isBuffer(init.body) && !(init.body instanceof Uint8Array)) { req.destroy(new Error('unsupported_request_body')); return; }
        req.write(init.body);
      }
      req.end();
    });
  };
}
function transportFor(cfg, env) {
  if (cfg.transport === 'stdio') {
    const childEnv = { PATH: '/usr/bin:/bin', HOME: env.HOME || '', LOGNAME: '', SHELL: '', TERM: '', USER: '' };
    for (const [key, value] of Object.entries(cfg.env || {})) childEnv[key] = expand(value, env);
    const command = expand(cfg.command, env);
    const allowedCommands = new Set([process.execPath, ...(env.MCP_ALLOWED_EXECUTABLES || '').split(':').filter(Boolean)]);
    if (!isAbsolute(command) || !allowedCommands.has(command)) throw new Error('executable_not_allowed');
    return new StdioClientTransport({ command, args: cfg.args.map(arg => expand(arg, env)), cwd: cfg.cwd, env: childEnv, stderr: 'ignore' });
  }
  const headers = {};
  if (cfg.authEnv) { if (typeof env[cfg.authEnv] !== 'string' || !env[cfg.authEnv]) throw new Error('missing_environment'); headers.authorization = `Bearer ${env[cfg.authEnv]}`; }
  const url = new URL(cfg.url);
  return new StreamableHTTPClientTransport(url, { requestInit: { headers }, fetch: createPinnedRemoteFetch(url) });
}

function validateArguments(schema, value) {
  if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set(Object.keys(schema.properties));
  if (Object.keys(value).some(key => !allowed.has(key)) || (schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
  for (const [key, rule] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(value, key)) continue;
    const item = value[key];
    if (rule.type === 'string' && (typeof item !== 'string' || (rule.minLength !== undefined && item.length < rule.minLength) || (rule.maxLength !== undefined && item.length > rule.maxLength) || (rule.enum && !rule.enum.includes(item)))) return false;
    if (rule.type === 'number' && (typeof item !== 'number' || !Number.isFinite(item) || (rule.minimum !== undefined && item < rule.minimum) || (rule.maximum !== undefined && item > rule.maximum))) return false;
    if (rule.type === 'integer' && (!Number.isInteger(item) || (rule.minimum !== undefined && item < rule.minimum) || (rule.maximum !== undefined && item > rule.maximum))) return false;
    if (rule.type === 'boolean' && typeof item !== 'boolean') return false;
    if (rule.enum && !rule.enum.includes(item)) return false;
  }
  return true;
}

function supportsInputSchema(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return false;
  const schemaKeys = new Set(['type', 'properties', 'required', 'additionalProperties', 'title', 'description', '$schema']);
  if (Object.keys(schema).some(key => !schemaKeys.has(key)) || (schema.additionalProperties !== undefined && schema.additionalProperties !== false)) return false;
  if (['title', 'description'].some(key => schema[key] !== undefined && (typeof schema[key] !== 'string' || schema[key].length > 300))) return false;
  const fields = Object.entries(schema.properties);
  if (fields.length > 20 || (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length > fields.length || new Set(schema.required).size !== schema.required.length || schema.required.some(key => !Object.hasOwn(schema.properties, key))))) return false;
  return fields.every(([key, rule]) => {
    if (!NAME.test(key) || !rule || typeof rule !== 'object' || Array.isArray(rule) || !['string', 'number', 'integer', 'boolean'].includes(rule.type)) return false;
    if (['title', 'description'].some(name => rule[name] !== undefined && (typeof rule[name] !== 'string' || rule[name].length > 300))) return false;
    const permitted = new Set(['type', 'description', 'title', ...(rule.type === 'string' ? ['minLength', 'maxLength', 'enum'] : ['minimum', 'maximum'])]);
    if (Object.keys(rule).some(name => !permitted.has(name))) return false;
    if (rule.type === 'string') {
      if (rule.enum !== undefined && (!Array.isArray(rule.enum) || rule.enum.length > 32 || rule.enum.some(item => typeof item !== 'string'))) return false;
      if (rule.maxLength !== undefined && (!Number.isInteger(rule.maxLength) || rule.maxLength > 4_000 || rule.maxLength < 0)) return false;
      if (rule.minLength !== undefined && (!Number.isInteger(rule.minLength) || rule.minLength < 0 || rule.minLength > (rule.maxLength ?? 4_000))) return false;
    }
    if (['number', 'integer'].includes(rule.type)) {
      if (rule.minimum !== undefined && !Number.isFinite(rule.minimum)) return false;
      if (rule.maximum !== undefined && !Number.isFinite(rule.maximum)) return false;
      if (rule.minimum !== undefined && rule.maximum !== undefined && rule.minimum > rule.maximum) return false;
    }
    return true;
  });
}

export class McpGateway {
  #servers = new Map(); #tools = new Map(); #connecting = new Map(); #closed = false; #inFlight = 0;
  constructor(config, { env = process.env, audit = async () => {} } = {}) { this.config = validateConfig(config); this.env = env; this.audit = audit; }
  async #ensureConnected(serverName, cfg) {
    const existing = this.#connecting.get(serverName);
    if (existing) return existing;
    const connection = (async () => {
      let client;
      let retryable = true;
      try {
        if (this.#closed || !cfg?.enabled) return false;
        if (cfg.transport === 'streamable-http') await checkRemote(new URL(cfg.url));
        client = new Client({ name: `agentsfer-sage-${serverName}`, version: '1.0.0' });
        client.onclose = () => {
          const active = this.#servers.get(serverName);
          if (active?.client === client) { active.status = 'unavailable'; active.retryable = true; }
        };
        this.#servers.set(serverName, { client, cfg, status: 'connecting', retryable: true });
        await client.connect(transportFor(cfg, this.env), { timeout: 5_000 });
        const result = await client.listTools(undefined, { timeout: 5_000 });
        const discovered = new Map(result.tools.map(tool => [tool.name, tool]));
        if (discovered.size !== result.tools.length || cfg.allowedTools.some(name => !discovered.has(name))) { retryable = false; throw new Error('manifest_mismatch'); }
        const registrations = [];
        for (const name of cfg.allowedTools) {
          const id = `${serverName}__${name}`; const item = discovered.get(name);
          if ((this.#tools.has(id) && this.#tools.get(id).server !== serverName) || !supportsInputSchema(item.inputSchema) || JSON.stringify(item.inputSchema).length > 8_192) { retryable = false; throw new Error('invalid_tool'); }
          registrations.push({ id, server: serverName, name, access: cfg.access, description: String(item.description || item.title || 'Configured MCP tool').slice(0, 300), inputSchema: item.inputSchema });
        }
        this.#servers.set(serverName, { client, cfg, status: 'ready', retryable: false });
        for (const tool of registrations) this.#tools.set(tool.id, tool);
        return true;
      } catch {
        await client?.close().catch(() => {});
        for (const [id, tool] of this.#tools) if (tool.server === serverName) this.#tools.delete(id);
        this.#servers.set(serverName, { cfg, status: 'unavailable', retryable });
        return false;
      }
    })();
    this.#connecting.set(serverName, connection);
    try { return await connection; } finally { this.#connecting.delete(serverName); }
  }
  async start() {
    try {
      for (const [serverName, cfg] of Object.entries(this.config)) {
        if (!cfg.enabled) continue;
        await this.#ensureConnected(serverName, cfg);
      }
      return this;
    } catch { await this.close(); throw new Error('mcp_startup_failed'); }
  }
  listTools({ includeSensitive = false } = {}) { return [...this.#tools.values()].filter(tool => includeSensitive || tool.access !== 'sensitive-read').map(({ id, description, inputSchema, access }) => ({ id, description, inputSchema, access })); }
  health() { const unavailable = [...this.#servers.values()].some(entry => entry.status === 'unavailable'); return { status: this.#closed ? 'closed' : unavailable ? 'degraded' : 'ready', servers: [...this.#servers].map(([name, entry]) => ({ name, status: entry.status })), toolCount: this.#tools.size }; }
  async call(id, args, { signal, timeoutMs = 10_000, allowSensitiveRead = false } = {}) {
    const tool = this.#tools.get(id);
    if (!tool) return { status: 404, body: { error: 'tool_not_found' } };
    if (tool.access === 'write' || tool.access === 'destructive' || (tool.access === 'sensitive-read' && !allowSensitiveRead)) return { status: 403, body: { error: 'tool_not_authorized' } };
    if (!args || typeof args !== 'object' || Array.isArray(args) || Buffer.byteLength(JSON.stringify(args)) > 8_192 || !validateArguments(tool.inputSchema, args)) return { status: 400, body: { error: 'invalid_arguments' } };
    if (signal?.aborted) return { status: 499, body: { error: 'cancelled' } };
    if (this.#inFlight >= MAX_CONCURRENCY) return { status: 429, body: { error: 'busy' } };
    this.#inFlight++; const start = Date.now(); const controller = new AbortController(); const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true }); const timeout = Math.max(1, Math.min(timeoutMs, 30_000)); const timer = setTimeout(() => controller.abort(), timeout);
    try {
      let server = this.#servers.get(tool.server);
      if (server?.status !== 'ready') {
        if (server?.retryable === false || !(await this.#ensureConnected(tool.server, this.config[tool.server]))) return { status: 503, body: { error: 'server_unavailable' } };
        server = this.#servers.get(tool.server);
      }
      if (server.cfg.transport === 'streamable-http') await checkRemote(new URL(server.cfg.url));
      await this.audit({ tool: id, outcome: 'started' });
      let result;
      try { result = await server.client.callTool({ name: tool.name, arguments: args }, undefined, { timeout, signal: controller.signal, maxTotalTimeout: timeout }); }
      catch (error) { if (!controller.signal.aborted) { server.status = 'unavailable'; server.retryable = true; } throw error; }
      if (result.isError) throw new Error('tool_failed');
      const body = { content: (result.content || []).filter(x => x.type === 'text').map(x => String(x.text).slice(0, 4_000)).slice(0, 8) };
      if (Buffer.byteLength(JSON.stringify(body)) > MAX_OUTPUT) throw new Error('invalid_output');
      await this.audit({ tool: id, outcome: 'success', durationMs: Date.now() - start }); return { status: 200, body };
    } catch {
      const cancelled = Boolean(signal?.aborted); const timedOut = controller.signal.aborted && !cancelled; const outcome = cancelled ? 'cancelled' : timedOut ? 'timeout' : 'failed';
      await this.audit({ tool: id, outcome, durationMs: Date.now() - start }).catch(() => {});
      return { status: cancelled ? 499 : timedOut ? 504 : 502, body: { error: outcome === 'failed' ? 'tool_failed' : outcome } };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); this.#inFlight--; }
  }
  async close() { if (this.#closed) return; this.#closed = true; await Promise.allSettled([...this.#servers.values()].filter(entry => entry.client).map(({ client }) => client.close())); this.#servers.clear(); this.#tools.clear(); }
}
