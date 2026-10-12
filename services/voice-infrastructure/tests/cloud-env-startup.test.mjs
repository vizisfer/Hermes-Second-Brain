import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('injected Gemini credentials skip Hermes CLI/profile access at module startup', () => {
  const marker = 'not-a-real-credential-test-marker';
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(path.join(projectRoot, 'src/agent.mjs'))})`,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: '/nonexistent-cloud-home',
      VOICE_PROVIDER: 'gemini',
      GOOGLE_API_KEY: marker,
      HERMES_BIN: '/nonexistent-hermes-cli',
    },
  });

  assert.equal(result.status, 0, `module startup failed without credential output (exit ${result.status})`);
  assert.equal(result.stdout.includes(marker), false);
  assert.equal(result.stderr.includes(marker), false);
});