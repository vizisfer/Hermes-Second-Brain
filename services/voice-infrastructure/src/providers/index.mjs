import * as google from '@livekit/agents-plugin-google';
import { AGENTSFER_PERSONA } from '../persona.mjs';

const DEFAULT_MODEL = 'gemini-3.8-live';

/**
 * Sağlayıcı adapter sınırı: LiveKit Agent yalnızca bu fabrikadan RealtimeModel alır.
 * Yeni sağlayıcı eklenirken telephony ve Hermes katmanları değiştirilmez.
 */
export function createRealtimeModel(env = process.env) {
  const provider = (env.VOICE_PROVIDER || 'gemini').trim().toLowerCase();

  if (provider !== 'gemini') {
    throw new Error(`VOICE_PROVIDER '${provider}' için adapter yapılandırılmadı.`);
  }
  if (!env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY yapılandırılmamış.');
  }

  const options = {
    apiKey: env.GOOGLE_API_KEY,
    model: env.GEMINI_LIVE_MODEL || DEFAULT_MODEL,
    ...(env.GEMINI_LIVE_LANGUAGE ? { language: env.GEMINI_LIVE_LANGUAGE } : {}),
    instructions: AGENTSFER_PERSONA,
  };

  if (env.GEMINI_LIVE_VOICE) options.voice = env.GEMINI_LIVE_VOICE;

  return new google.realtime.RealtimeModel(options);
}

export const defaultGeminiLiveModel = DEFAULT_MODEL;
