# Controlled document voice release — 2026-10-13

Status: CONTROLLED LOCAL/CLOUD VOICE PASSED; REAL-PHONE ACCEPTANCE BLOCKED.

This is a partial integration release, not completion of the Phone → Twilio/SIP acceptance. Earlier operations notes are historical. Pre-existing `MASTER_HANDOFF.md` and `sondurummcpgateway.md` edits were preserved and are not part of this release publication.

## Verified release

- Existing agent ID: `CA_hJeW6sWL5S8T`; production version: `8PR5bBsREzcm`, region `us-east`. Post-test read-back: `Running`, 1/1/1, version `Available`.
- Immediately preceding rollback version: `iD6Zy7j6z8BQ`, read back `Available` after release. Re-read availability before any future rollback.
- Deployed Sage changes are only `src/agent.mjs` and `src/tools/hermes-documents-test.mjs`. Cloud secrets were not updated; names and timestamps are unchanged. Local credential-containing file bytes matched the preflight hash. Secret values were not retrieved or published.
- Necessary Bridge change: only the read-per-request `hermes-documents-runner.py`; no Bridge restart. Its deployed SHA-256 is `3ea6a57f7a9a6c811d71ae73b12eb353b1b03c380cc85233b71d18a53a536d6a`.
- Bridge remains active, PID 123808, listener `172.22.0.1:8787`. No proxy, Twilio, SIP dispatch, PostgreSQL, Hindsight service, provider/model or unrelated setting change was made.
- Existing dedicated Hermes profile, local stdio MCP and `http://127.0.0.1:8888` / `agentsfer-second-brain` bank remain the retrieval path. No new store or memory write was used. Memory hooks, transcript persistence, background review and native/foreign tool execution remain disabled for the voice delegate. No Hindsight provider was enabled on either master profile.

## Evidence and measured results

The operator-controlled tests used actual question PCM and actual received Sage audio. Assistant/tool protobuf events were examined in memory; private transcripts and answer audio were not persisted. This is not a real phone call or human voice-timbre audition.

| Check | Actual result |
|---|---|
| Local strict financial/source/audio acceptance | PASS; two matching literal source quotes; 2103 voiced answer frames |
| Cloud strict financial/source/audio acceptance | PASS; two matching literal source quotes; 3440 voiced answer frames |
| Exact source | `BarketSalahTeklifi.docx`, matching document identity and original-text quote validation |
| Quote relevance | Recurring fee and tax from the same passage; distinct fixed monthly total; setup/yearly tax was not substituted |
| Spoken assistant evidence | Fee, tax, Turkish response and exact source name verified, plus post-tool voiced samples |
| Local question end → sourced first audio | 14591 ms |
| Cloud question end → sourced first audio | 16025 ms |
| Cloud private HTTP/tool | HTTP 200; 13428 ms |
| Hermes phase inside cloud request | 7237 ms |
| Actual cloud provider settings | Gemini / `gemini-3.8-live` / `Kore`; language override null |
| One-use authorization | Consumed marker count 16 → 17; previous replay-denial evidence retained |
| Owned room cleanup | Exact-room deletion read-back PASS; temporary local workers stopped |
| Public regressions | Unauthenticated health/private 401; authenticated health 200; missing capability 403; public profile injection 400; absent private MCP tool 404 |
| Public catalog | Exactly `aladhan__timings`, read-only |
| Real AlAdhan regression | Deployed host Sage adapter/broker → HTTPS Gateway → live AlAdhan; nonempty, 709 ms. Session context was explicitly synthetic, not a spoken/cloud AlAdhan test |

Private financial amounts/quotes are intentionally not reproduced in this publication. The local evidence contains only safe verification flags, timings and source identifiers.

## Fixes and review

- Correlated diagnosis established SDK `audio_activity` speech interruption before HTTP headers, not a local deadline or proven Twilio/DNS fault. Only the authorized document tool's current speech uses `RunContext.disallowInterruptions`; forced cancellation, disconnection and the bounded deadline remain.
- Existing Hindsight recall now requests bounded native source chunks. Explicit chunk-to-document edges, ambiguity rejection and registry-owned source labels are retained.
- The model selects bounded backend-owned `quote_id` values. The runner resolves a unique matching document/quote reference, then applies the existing literal-source validator. It does not accept model-retyped quote prose or relax grounding.
- Existing focused passing tests were reused. Change-specific checks included the tool abort/deadline regression, native-chunk provenance/bounds, two new quote-option tests and four new pure Python quote-reference tests. Offline fixtures are not live evidence.
- Independent GPT-6 Luna Medium reviewed the integrated candidate and subsequent exact deltas. Final 19-path security gate is PASS; manifests and hashes were checked. A signing-key leak finding was independently withdrawn after actual source dataflow showed only the signed one-use capability, never the HMAC key, is sent to the protected Bridge.
- A preflight caught an intervening optional greeting PCM byte-view fix. That user edit was preserved and independently reviewed. An initial shell chain incorrectly continued to a host code copy after the preflight failure; the owned copy was immediately rolled back and read back. No cloud deployment occurred in that failed preflight. The final rollout used checked subprocesses, then exact version/hash/secret-metadata read-back.

## Rollback and resume

Code-only Sage rollback, without changing Kore or any secret:

    lk agent rollback --id CA_hJeW6sWL5S8T --version iD6Zy7j6z8BQ
    python3 /home/digisfer/second-brain/scripts/voice-test-release.py rollback-voice

The scoped helper refuses unexpected target drift. Do not apply the old Puck/secret-reset instructions from an earlier release to this code-only rollback.

Latest runner-only rollback, without a restart or environment edit:

    python3 /home/digisfer/second-brain/coordination/voice-completion-20261013/runner-code-release.py rollback runner-release-state-v3.json

The older blanket Bridge helper intentionally refuses the newer runner drift. Preserve all backups, signer/replay files and canonical adapter references; never regenerate the signer key or clean untracked files indiscriminately.

Safe evidence directory: `/home/digisfer/second-brain/coordination/voice-completion-20261013/`. Key artifacts: `cloud-quote-voice-acceptance.json`, `quote-reference-voice-acceptance.json`, `sage-release-preflight.json`, `sage-release-readback.json`, `post-deploy-public-regression.json`, `final-review-manifest-v4.json`, `final-security-review-v4.md`, `final-security-review-v5.md`, `phone-boundary-check.json`. Publication/remote commit read-back is recorded separately in the mission result.

## Genuine external blocker

The existing phone handler has no document grant issuer/handoff; Sage reads the grant only from privileged job metadata, and the local issuer currently controls test-room dispatch only. Caller ID, room/SIP identity and simulation flags are not authorization. No real phone call was attempted, ordinary callers were not authorized, and phone latency or audible Kore identity was not claimed.

Required operator/user action: establish and verify an existing trustworthy grant issuance/handoff bound to an approved real test caller/session, or explicitly authorize that narrowly scoped handoff separately; then approve one controlled real-phone action. No new public/private auth architecture, routing change or arbitrary outbound contact call is implied. REAL-PHONE sourced answer, Kore audition and end-to-end phone latency remain pending.
