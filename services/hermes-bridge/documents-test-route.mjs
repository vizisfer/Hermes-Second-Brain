import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { consumeCapability } from './test-session-capability.mjs';
const execFileAsync = promisify(execFile);
const HERMES = '/home/digisfer/.local/bin/hermes';
const HERMES_SOURCE = '/home/digisfer/.hermes/hermes-agent';
const PROFILE = '/home/digisfer/.hermes/profiles/agentsfer-second-brain';
const SAFE_ERROR = 'document_test_denied';

async function loadKey(file) {
  if (typeof file !== 'string' || !isAbsolute(file)) throw new Error(SAFE_ERROR);
  const info = await lstat(file);
  if (!info.isFile() || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error(SAFE_ERROR);
  const key = await readFile(file);
  if (key.length !== 32) throw new Error(SAFE_ERROR);
  return key;
}
export async function runHermesDocuments(question, { signal, requestId, runnerPath = resolve(import.meta.dirname, 'hermes-documents-runner.py') } = {}) {
  const { stdout } = await execFileAsync(HERMES, ['--print-runtime-command'], { timeout: 5_000, maxBuffer: 32_000 });
  const runtime = JSON.parse(stdout);
  if (!Array.isArray(runtime) || typeof runtime[0] !== 'string' || !isAbsolute(runtime[0])) throw new Error('hermes_failed');
  // Installation-bound interpreter plus the installed PM bootstrap, not a guessed venv.
  const bootstrap = `import sys, os, runpy; os.environ.pop('PYTHONPATH',None); os.environ.pop('PYTHONHOME',None); sys.path.insert(0,${JSON.stringify(HERMES_SOURCE)}); import hermes_bootstrap; runpy.run_path(sys.argv[1], run_name='__main__')`;
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) { reject(new Error('cancelled')); return; }
    const env = { HOME: process.env.HOME || '/home/digisfer', PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8',
      HERMES_HOME: PROFILE, HERMES_PROFILE: 'agentsfer-second-brain',
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) };
    const child = spawn(runtime[0], ['-I', '-c', bootstrap, runnerPath], { env, cwd: PROFILE, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let settled = false;
    const started = performance.now();
    const diagnostic = phase => console.info(JSON.stringify({ event: 'document_test_hermes', requestId, phase, durationMs: Math.round(performance.now() - started) }));
    diagnostic('spawned');
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolveResult(result);
    };
    const abort = () => { diagnostic('abort'); kill(); finish(new Error('cancelled')); };
    const timer = setTimeout(() => { diagnostic('deadline'); kill(); finish(new Error('hermes_timeout')); }, 55_000);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', data => { output += data.toString(); if (Buffer.byteLength(output) > 32_000) { kill(); finish(new Error('hermes_failed')); } });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => finish(new Error('hermes_failed')));
    child.on('close', code => {
      diagnostic('exit');
      try {
        if (code !== 0) {
          try {
            const failure = JSON.parse(output);
            if (['input','imports','config','runtime','mcp_discovery','agent_init','tool_boundary','conversation','verified_evidence'].includes(failure.stage)) {
              console.warn(JSON.stringify({ event: 'document_test_runner', outcome: 'failed', stage: failure.stage }));
            }
          } catch {}
          throw new Error('hermes_failed');
        }
        const result = JSON.parse(output);
        if (Object.keys(result).some(k => !['response', 'sources', 'timingsMs'].includes(k)) || typeof result.response !== 'string'
          || !result.response.trim() || result.response.length > 4000 || !Array.isArray(result.sources) || result.sources.length < 1
          || result.sources.length > 8 || !result.sources.every(s => typeof s === 'string' && s.length > 0 && s.length <= 200)) throw new Error('hermes_failed');
        finish(null, result);
      } catch { finish(new Error('hermes_failed')); }
    });
    child.stdin.end(JSON.stringify({ question }));
  });
}

export function createDocumentTestHandler({ keyFile, replayDir, run = runHermesDocuments, keyLoader = loadKey } = {}) {
  let busy = false;
  return async ({ payload, capability, signal, requestId } = {}) => {
    if (!keyFile || !replayDir) return { status: 403, body: { error: SAFE_ERROR } };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'participantIdentity,question,roomSid'
      || typeof payload.question !== 'string' || !payload.question.trim() || payload.question.length > 500) return { status: 400, body: { error: 'invalid_request' } };
    if (busy) return { status: 429, body: { error: 'busy' } };
    busy = true;
    const started = performance.now();
    try {
      const key = await keyLoader(keyFile);
      await consumeCapability({ key, token: capability, ...payload, replayDir });
      if (signal?.aborted) throw new Error('cancelled');
      const result = await run(payload.question, { signal, requestId });
      console.info(JSON.stringify({ event: 'document_test_bridge', requestId, outcome: 'success', sourceCount: result.sources.length, timingsMs: result.timingsMs }));
      return { status: 200, body: { ...result, timingsMs: { ...result.timingsMs, bridge: Math.round(performance.now() - started) } } };
    } catch (error) {
      const unauthorized = error?.message === 'unauthorized' || error?.message === SAFE_ERROR;
      return { status: unauthorized ? 403 : 502, body: { error: unauthorized ? SAFE_ERROR : 'hermes_documents_failed' } };
    } finally { busy = false; }
  };
}
