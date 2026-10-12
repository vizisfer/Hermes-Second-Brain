import process from 'node:process';
import { GoogleGenAI, Modality } from '@google/genai';

const envPath = `${process.env.HOME}/.hermes/profiles/voice-infrastructure-bot/.env`;
process.loadEnvFile(envPath);

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('Gemini Live check blocked: GOOGLE_API_KEY is not configured.');
  process.exit(2);
}

const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
const timeoutMs = 25_000;
let session;
let openedResolve;
let openedReject;
const opened = new Promise((resolve, reject) => {
  openedResolve = resolve;
  openedReject = reject;
});
const timer = setTimeout(() => openedReject(new Error('timeout')), timeoutMs);

try {
  const ai = new GoogleGenAI({ apiKey });
  session = await ai.live.connect({
    model,
    config: { responseModalities: [Modality.AUDIO] },
    callbacks: {
      onopen: () => openedResolve(),
      onmessage: () => {},
      onerror: () => openedReject(new Error('websocket_error')),
      onclose: () => openedReject(new Error('closed_before_open')),
    },
  });
  await opened;
  console.log(`Gemini Live handshake: success (model=${model}; no prompt/audio sent)`);
} catch (error) {
  const reason = error?.message === 'timeout' ? 'timeout' :
    error?.message === 'websocket_error' ? 'websocket_error' :
    error?.message === 'closed_before_open' ? 'closed_before_open' : 'connection_rejected';
  console.error(`Gemini Live handshake: failed (${reason}); secret values withheld.`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  try { session?.close(); } catch {}
}
