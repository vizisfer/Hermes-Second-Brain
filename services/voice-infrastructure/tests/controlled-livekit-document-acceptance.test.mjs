import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentVoiceAcceptance } from './controlled-livekit-document-acceptance.mjs';

const good = () => ({ name: 'hermes_documents_test', isError: false,
  output: JSON.stringify({ ok: true, data: { sources: ['BarketSalahTeklifi.docx'] } }) });
function run({ tool = good(), text = 'Kaynak: BarketSalahTeklifi.docx', voice = true } = {}) {
  const a = createDocumentVoiceAcceptance();
  a.observeToolOutput(tool); a.observeAssistantText(text);
  if (voice) a.observeVoice();
  return a.passed;
}
test('silence fails', () => assert.equal(run({ voice: false }), false));
test('generic assistant text fails', () => assert.equal(run({ text: 'İşte yanıt.' }), false));
test('speech before tool result fails', () => {
  const a = createDocumentVoiceAcceptance();
  a.observeVoice(); a.observeAssistantText('Kaynak: BarketSalahTeklifi.docx'); a.observeToolOutput(good());
  assert.equal(a.passed, false);
});
test('wrong source fails', () => assert.equal(run({ tool: { ...good(), output: JSON.stringify({ ok: true, data: { sources: ['other.docx'] } }) } }), false));
test('denied result fails', () => assert.equal(run({ tool: { ...good(), output: JSON.stringify({ ok: false, error: { code: 'DENIED' } }) } }), false));
test('verified matching source with subsequent voice passes', () => assert.equal(run(), true));
