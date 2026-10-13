const EXPECTED_SOURCE = 'BarketSalahTeklifi.docx';

export function createDocumentVoiceAcceptance() {
  let verifiedResult = false;
  let matchingAssistant = false;
  let postResultVoice = false;
  return {
    observeToolOutput(output) {
      if (verifiedResult || output?.name !== 'hermes_documents_test' || output?.isError !== false) return;
      let value;
      try { value = JSON.parse(output.output); } catch { return; }
      verifiedResult = value?.ok === true && Array.isArray(value?.data?.sources)
        && value.data.sources.some(source => source === EXPECTED_SOURCE);
    },
    observeAssistantText(text) {
      if (verifiedResult && typeof text === 'string' && text.includes(EXPECTED_SOURCE)) matchingAssistant = true;
    },
    observeVoice() {
      if (verifiedResult) postResultVoice = true;
    },
    get passed() { return verifiedResult && matchingAssistant && postResultVoice; },
  };
}
