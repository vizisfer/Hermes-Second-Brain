import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { llm } from '@livekit/agents';

const execFileAsync = promisify(execFile);

function allowedAdminIdentities(env) {
  return new Set((env.VOICE_ADMIN_IDENTITIES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
}

/**
 * Yalnızca izin listesindeki LiveKit katılımcılarına salt-okunur Hermes profil
 * özeti sunar. Telefon/transcript içeriğini Hermes'e aktarmayan sabit bir CLI çağrısıdır.
 */
export function createHermesReadinessTool({ env = process.env, participantIdentity }) {
  if (env.HERMES_STATUS_TOOL !== 'true') return undefined;
  if (!participantIdentity || !allowedAdminIdentities(env).has(participantIdentity)) {
    return undefined;
  }

  const profile = env.HERMES_PROFILE || 'voice-infrastructure-bot';
  const hermesBin = env.HERMES_BIN || path.join(os.homedir(), '.local', 'bin', 'hermes');

  return llm.tool({
    description: 'Yalnızca yetkili operatör Voice Infrastructure Bot durumunu sorarsa, Hermes profilinin salt-okunur yapılandırma durumunu denetle.',
    parameters: z.object({}),
    execute: async () => {
      const safeEnv = {
        HOME: os.homedir(),
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        LANG: process.env.LANG || 'C.UTF-8',
      };
      if (process.env.HERMES_HOME) safeEnv.HERMES_HOME = process.env.HERMES_HOME;

      try {
        const { stdout } = await execFileAsync(
          hermesBin,
          ['profile', 'show', profile],
          { env: safeEnv, timeout: 5_000, maxBuffer: 8_192, windowsHide: true },
        );
        const gateway = stdout.match(/^Gateway:\s*(.+)$/m)?.[1]?.trim() || 'unknown';
        const envConfigured = /^\.env:\s*exists$/m.test(stdout);
        const modelProvider = stdout.match(/^Model:\s*.+\(([^)]+)\)$/m)?.[1]?.trim() || 'unknown';
        return { profileConfigured: true, gateway, envConfigured, modelProvider };
      } catch {
        return { profileConfigured: false, gateway: 'unknown', envConfigured: false, modelProvider: 'unknown' };
      }
    },
  });
}

export function isAdminIdentityAllowed(env, participantIdentity) {
  return Boolean(participantIdentity && allowedAdminIdentities(env).has(participantIdentity));
}
