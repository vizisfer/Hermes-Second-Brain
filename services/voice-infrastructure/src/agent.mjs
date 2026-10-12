import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, cli, defineAgent, ServerOptions, voice } from '@livekit/agents';
import { createRealtimeModel } from './providers/index.mjs';
import { AGENTSFER_PERSONA, greetingInstructions } from './persona.mjs';
import { createHermesReadinessTool } from './tools/hermes-readiness.mjs';
import { createHermesPrivateTestTool } from './tools/hermes-task.mjs';
import { createPrayerTimesDirectTool } from './tools/prayer-times-direct.mjs';
import { createMcpGatewayTools } from './tools/mcp-gateway-catalog.mjs';

export function buildAgentSessionOptions(llm) {
  return {
    llm,
    turnHandling: {
      turnDetection: 'realtime_llm',
      interruption: { enabled: true, minDuration: 250 },
    },
  };
}

// Cloud deployments inject provider credentials directly; do not touch Hermes
// CLI/profile files when the selected provider is already configured.
function hasInjectedProviderCredentials(env) {
  const provider = (env.VOICE_PROVIDER || 'gemini').trim().toLowerCase();
  if (provider === 'gemini') return Boolean(env.GOOGLE_API_KEY || env.GEMINI_API_KEY);
  if (provider === 'openai') return Boolean(env.OPENAI_API_KEY);
  return false;
}

if (!hasInjectedProviderCredentials(process.env)) {
  const profile = process.env.HERMES_PROFILE || 'voice-infrastructure-bot';
  const hermesBin = process.env.HERMES_BIN || path.join(os.homedir(), '.local', 'bin', 'hermes');
  const pathEnv = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
  const hermesEnv = { HOME: os.homedir(), PATH: pathEnv, LANG: process.env.LANG || 'C.UTF-8' };
  if (process.env.HERMES_HOME) hermesEnv.HERMES_HOME = process.env.HERMES_HOME;

  // Local development retains the Hermes profile .env flow.
  let envFile;
  try {
    envFile = execFileSync(hermesBin, ['-p', profile, 'config', 'env-path'], {
      encoding: 'utf8',
      env: hermesEnv,
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('Hermes profilinin .env yolu salt-okunur CLI ile çözümlenemedi.');
  }
  if (!path.isAbsolute(envFile)) throw new Error('Hermes .env yolu mutlak değil; başlatma durduruldu.');
  process.loadEnvFile(envFile);
}

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);

    const participant = [...ctx.room.remoteParticipants.values()][0];
    const readinessTool = createHermesReadinessTool({
      env: process.env,
      participantIdentity: participant?.identity,
    });
    const tools = readinessTool ? { hermes_readiness_status: readinessTool } : {};
    const hermesTaskTool = createHermesPrivateTestTool({ env: process.env, room: { name: ctx.job?.room?.name || ctx.room?.name } });
    if (hermesTaskTool) tools.hermes_task = hermesTaskTool;
    const prayerTimesDirectTool = createPrayerTimesDirectTool({ env: process.env, room: { name: ctx.job?.room?.name || ctx.room?.name } });
    if (prayerTimesDirectTool) tools.prayer_times_direct = prayerTimesDirectTool;
    Object.assign(tools, await createMcpGatewayTools({ env: process.env, room: { name: ctx.job?.room?.name || ctx.room?.name } }));

    const realtimeModel = createRealtimeModel(process.env);
    const session = new voice.AgentSession(buildAgentSessionOptions(realtimeModel));

    session.on('error', (event) => {
      const errorType = event?.error?.constructor?.name || 'UnknownError';
      console.error(`Voice session error (${errorType}); details withheld.`);
    });

    await session.start({
      agent: new voice.Agent({ instructions: AGENTSFER_PERSONA, tools }),
      room: ctx.room,
      record: false,
    });
    console.info(`Voice session ready provider=${realtimeModel.provider} model=${realtimeModel.model} recording=off`);

    if (process.env.VOICE_AUTO_GREETING !== 'false') {
      session.generateReply({
        instructions: greetingInstructions(),
        inputModality: 'text',
        allowInterruptions: true,
      });
    }
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: process.env.LIVEKIT_AGENT_NAME || 'agentsfer-voice-infrastructure',
  }));
}
