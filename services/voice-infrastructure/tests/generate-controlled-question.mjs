// Generate only the synthetic operator's test question with existing Gemini Live.
import { GoogleGenAI, Modality } from '@google/genai';
import { writeFile } from 'node:fs/promises';
process.loadEnvFile('/home/digisfer/.hermes/profiles/voice-infrastructure-bot/.env');
const question = 'Barket teklifinde Economy paketinin aylık fiyatı ve vergisi nedir?';
const frames = []; let session; let done;
const finished = new Promise((resolve, reject) => { done = { resolve, reject }; });
const timer = setTimeout(() => done.reject(new Error('audio_question_timeout')), 30_000);
try {
  session = await new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY }).live.connect({
    model: 'gemini-3.8-live', config: { responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      systemInstruction: 'Read only the exact Turkish sentence supplied by the user, once. Do not answer its question or add any other words.' },
    callbacks: { onmessage: message => {
      for (const part of message.serverContent?.modelTurn?.parts || []) if (part.inlineData?.data) frames.push(Buffer.from(part.inlineData.data, 'base64'));
      if (message.serverContent?.turnComplete) done.resolve();
    }, onerror: () => done.reject(new Error('audio_question_failed')) },
  });
  session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: question }] }], turnComplete: true });
  await finished;
  const pcm = Buffer.concat(frames);
  if (pcm.length < 24000) throw new Error('audio_question_empty');
  await writeFile('/home/digisfer/.hermes/profiles/second-brain-master/cache/scratch/controlled-document-question.pcm', pcm, { mode: 0o600 });
  console.log(JSON.stringify({ event: 'synthetic_question_audio', bytes: pcm.length, sampleRate: 24000, channels: 1 }));
} catch { console.error('synthetic_question_audio_failed'); process.exitCode = 1; }
finally { clearTimeout(timer); try { session?.close(); } catch {} }
