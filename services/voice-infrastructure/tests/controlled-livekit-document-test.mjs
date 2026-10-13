// Operator-only controlled room test. No public capability issuer, no SIP/Twilio changes.
import { randomUUID } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { issueCapability } from '../../hermes-bridge/test-session-capability.mjs';
const require = createRequire(resolve(import.meta.dirname, '../package.json'));
const { AccessToken, AgentDispatchClient, RoomServiceClient } = require('livekit-server-sdk');
const { AgentSession: pb } = require('@livekit/protocol');
import { createDocumentVoiceAcceptance } from './controlled-livekit-document-acceptance.mjs';
const { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource, dispose } = require('@livekit/rtc-node');
const question = 'Barket teklifinde Economy paketinin aylık fiyatı ve vergisi nedir?';
const keyFile = process.env.DOCUMENTS_TEST_CAPABILITY_KEY_FILE;
const info = await stat(keyFile);
if (!info.isFile() || (info.mode & 0o077) || info.uid !== process.getuid()) throw new Error('operator_key_unavailable');
const key = await readFile(keyFile);
const rtcURL = process.env.LIVEKIT_URL;
const apiURL = rtcURL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
const service = new RoomServiceClient(apiURL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const dispatcher = new AgentDispatchClient(apiURL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const roomName = `agentsfer-doc-test-${randomUUID()}`;
const identity = `operator-test-${randomUUID()}`;
const room = new Room();
const phases = {}; const started = performance.now();
let audioFrames = 0; let afterQuestionFrames = 0; let voicedAnswerFrames = 0; let questionSent = false; let firstAnswerAudioMs;
let assistantTextSeen = false; let sourceMentioned = false; let feeMentioned = false; let taxMentioned = false; let turkishResponse = false;
const readers = []; let source; let track;
const greetingPcm = []; let greetingSample;
const eventKinds = new Map();
const lifecycle = [];
let greetingCompleted = false;
let questionRecognized = false;
const acceptance = createDocumentVoiceAcceptance();
let cancelledToolCallCount = 0;
const deadline = Date.now() + 105_000;
const waitFor = async predicate => { while (!predicate()) { if (Date.now() >= deadline) throw new Error('controlled_test_timeout'); await delay(100); } };
room.registerTextStreamHandler('lk.transcription', async (reader, sender) => {
  await reader.readAll();
});
// Current SDK forwards session events as protobuf byte streams. Decode only
// finished assistant text in memory; never store or print room transcripts.
room.registerByteStreamHandler('lk.agent.session', async reader => {
  const chunks = await reader.readAll();
  const message = pb.AgentSessionMessage.fromBinary(Buffer.concat(chunks.map(c => Buffer.from(c))));
  const event = message.message.case === 'event' ? message.message.value.event : undefined;
  if (event?.case) eventKinds.set(event.case, (eventKinds.get(event.case) || 0) + 1);
  if (event?.case === 'userInputTranscribed' && event.value.isFinal) questionRecognized = /Barket|belge|Economy|paket/i.test(event.value.transcript || '');
  if (event?.case === 'functionToolsStarted') lifecycle.push({ event: event.case, elapsedMs: Math.round(performance.now() - started), count: event.value.functionCalls.length });
  if (event?.case === 'functionToolsExecuted') {
    for (const output of event.value.functionCallOutputs) acceptance.observeToolOutput(output);
    lifecycle.push({ event: event.case, elapsedMs: Math.round(performance.now() - started), count: event.value.functionCallOutputs.length, failed: event.value.functionCallOutputs.some(o => o.isError) });
  }
  if (event?.case === 'toolExecutionUpdated') {
    const update = event.value.update;
    const terminal = update.case === 'ended' ? update.value : undefined;
    if (terminal && pb.ToolCallStatus[terminal.status] === 'CANCELLED') cancelledToolCallCount++;
    lifecycle.push({ event: event.case, phase: update.case,
      status: terminal ? pb.ToolCallStatus[terminal.status] : undefined, elapsedMs: Math.round(performance.now() - started) });
  }
  if (event?.case === 'overlappingSpeech') lifecycle.push({ event: event.case, elapsedMs: Math.round(performance.now() - started), interrupted: Boolean(event.value.isInterruption) });
  if (event?.case !== 'conversationItemAdded') return;
  const item = event.value.item?.item;
  if (item?.case !== 'message' || item.value.role !== pb.ChatRole.ASSISTANT) return;
  if (!questionSent) { greetingCompleted = true; return; }
  const text = item.value.content.filter(c => c.payload.case === 'text').map(c => c.payload.value).join(' ');
  if (text) {
    assistantTextSeen = true;
    acceptance.observeAssistantText(text);
    sourceMentioned ||= /Barket|Salah|teklif/i.test(text);
    feeMentioned ||= /200|iki yüz|iki\s*yuz/i.test(text);
    taxMentioned ||= /HST|vergi/i.test(text);
    turkishResponse ||= /aylık|ücret|paket|teklif|vergi/i.test(text);
  }
  if (item.value.interrupted) lifecycle.push({ event: 'assistantMessageInterrupted', elapsedMs: Math.round(performance.now() - started), interrupted: true });
});
room.on(RoomEvent.TrackSubscribed, (remoteTrack) => {
  if (remoteTrack.kind !== TrackKind.KIND_AUDIO) return;
  const reader = new AudioStream(remoteTrack, 24000, 1).getReader(); readers.push(reader);
  (async () => { try { for (;;) { const frame = await reader.read(); if (frame.done) break; audioFrames++;
    if (!questionSent && process.env.CONTROLLED_GREETING_WAV_FILE) greetingPcm.push(Buffer.from(new Uint8Array(frame.value.data.buffer, frame.value.data.byteOffset, frame.value.data.byteLength)));
    if (questionSent) {
      afterQuestionFrames++;
      if (phases.questionEndedMs !== undefined && frame.value.data.some(sample => Math.abs(sample) > 500)) {
        voicedAnswerFrames++;
        acceptance.observeVoice();
        if (firstAnswerAudioMs === undefined) firstAnswerAudioMs = Math.round(performance.now() - started);
      }
    } } } catch {} })();
});
let created;
try {
  created = await service.createRoom({ name: roomName, emptyTimeout: 120, maxParticipants: 2 });
  const readBackRooms = await service.listRooms([roomName]);
  if (readBackRooms.length !== 1 || readBackRooms[0].sid !== created.sid) throw new Error('room_readback_failed');
  phases.roomCreatedMs = Math.round(performance.now() - started);
  const join = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, ttl: '3m' });
  join.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
  await room.connect(rtcURL, await join.toJwt(), { autoSubscribe: true });
  phases.peerConnectedMs = Math.round(performance.now() - started);
  const capability = issueCapability({ key, roomSid: created.sid, participantIdentity: identity, question });
  const dispatch = await dispatcher.createDispatch(roomName, process.env.CONTROLLED_TEST_AGENT_NAME || 'agentsfer-voice-infrastructure', {
    metadata: JSON.stringify({ documentTest: { capability, question, participantIdentity: identity } }),
  });
  if (!(await dispatcher.listDispatch(roomName)).some(d => d.id === dispatch.id)) throw new Error('dispatch_readback_failed');
  phases.dispatchCreatedMs = Math.round(performance.now() - started);
  await waitFor(() => [...room.remoteParticipants.values()].some(p => ['listening','speaking'].includes(p.attributes?.['lk.agent.state'])));
  phases.agentReadyMs = Math.round(performance.now() - started);
  // Let the normal greeting finish; never alter the real audio architecture.
  await waitFor(() => greetingCompleted && [...room.remoteParticipants.values()].some(p => p.attributes?.['lk.agent.state'] === 'listening'));
  source = new AudioSource(24000, 1);
  track = LocalAudioTrack.createAudioTrack('controlled-question', source);
  const opts = new TrackPublishOptions(); opts.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(track, opts);
  const pcm = await readFile(process.env.CONTROLLED_TEST_AUDIO_FILE);
  phases.questionStartedMs = Math.round(performance.now() - started);
  questionSent = true;
  const samplePath = process.env.CONTROLLED_GREETING_WAV_FILE;
  if (samplePath && greetingPcm.length) {
    const scratch = resolve('/home/digisfer/.hermes/profiles/second-brain-master/cache/scratch') + '/';
    const target = resolve(samplePath);
    if (!target.startsWith(scratch)) throw new Error('greeting_sample_path_outside_active_scratch');
    const pcmBytes = Buffer.concat(greetingPcm); const wav = Buffer.alloc(44 + pcmBytes.length);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcmBytes.length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcmBytes.length, 40); pcmBytes.copy(wav, 44);
    const handle = await open(target, 'wx', 0o600); try { await handle.writeFile(wav); } finally { await handle.close(); }
    let squareSum = 0; let peak = 0;
    for (let i = 0; i + 1 < pcmBytes.length; i += 2) { const sample = pcmBytes.readInt16LE(i); squareSum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
    greetingSample = { path: target, durationMs: Math.round(pcmBytes.length / 48), rms: Math.round(Math.sqrt(squareSum / Math.max(1, pcmBytes.length / 2))), peak };
  }
  greetingPcm.length = 0;
  for (let offset = 0; offset < pcm.length; offset += 960) {
    const chunk = pcm.subarray(offset, Math.min(offset + 960, pcm.length));
    const data = new Int16Array(chunk.length / 2);
    for (let i = 0; i < data.length; i++) data[i] = chunk.readInt16LE(i * 2);
    await source.captureFrame(new AudioFrame(data, 24000, 1, data.length));
  }
  await source.waitForPlayout(); phases.questionEndedMs = Math.round(performance.now() - started);
  // Silence permits Gemini's unchanged realtime endpointing to finish the turn.
  for (let i = 0; i < 75; i++) await source.captureFrame(new AudioFrame(new Int16Array(480), 24000, 1, 480));
  await source.waitForPlayout();
  await waitFor(() => acceptance.passed && voicedAnswerFrames > 0);
  phases.completedMs = Math.round(performance.now() - started);
  console.log(JSON.stringify({ event: 'controlled_livekit_voice_test', roomSid: created.sid,
    voiceAudioReceived: voicedAnswerFrames > 0, assistantTextSeen, documentAcceptancePassed: acceptance.passed,
    sourceMentioned, feeMentioned, taxMentioned, turkishResponse,
    audioFrames, voicedAnswerFrames, firstAnswerAudioMs, greetingSample, phases, lifecycle }));
} catch (error) { console.error(JSON.stringify({ event: 'controlled_livekit_voice_test', outcome: 'failed', phases,
  audioFrames, afterQuestionFrames, eventKinds: Object.fromEntries(eventKinds), lifecycle,
  greetingCompleted, questionRecognized,
  assistantTextSeen, documentAcceptancePassed: acceptance.passed,
  cancelledToolCallCount, greetingSample,
  reason: error?.message === 'controlled_test_timeout' ? 'timeout' : 'test_failed' })); process.exitCode = 1; }
finally {
  for (const reader of readers) { try { await reader.cancel(); } catch {} }
  try { await track?.close(); } catch {}
  try { await source?.close(); } catch {}
  try { await room.disconnect(); } catch {}
  if (created) { try {
    await service.deleteRoom(roomName);
    if ((await service.listRooms([roomName])).length !== 0) throw new Error('cleanup_readback_failed');
    console.log('controlled_test_room_deletion_readback_verified');
  } catch { console.error('controlled_test_room_cleanup_failed'); process.exitCode = 1; } }
  await dispose();
}
