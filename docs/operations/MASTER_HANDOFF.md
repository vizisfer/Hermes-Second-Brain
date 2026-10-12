# Master Handoff — Gateway and Sage Voice Deployment

Updated: 2026-10-12 22:00 UTC

## Mission state

Production deployment completed in the authorized execution continuation. Bridge Gateway is live; Sage version `iD6Zy7j6z8BQ` is the active production version in `us-east`. The pre-deployment findings below are retained as historical evidence, not outstanding blockers.

## Verified deployment outcome

- The live Bridge listener and unchanged Caddy upstream both use `172.22.0.1:8787`. The existing Bridge `.env` received only explicit `HOST=172.22.0.1` and `PORT=8787` additions. Original bytes/token and permissions were preserved; deployed-file and environment hashes were read back. No wildcard listener or proxy change was introduced. `hermes-bridge.service` is active/running after its scoped restart.
- Deployed Bridge files: `server.mjs`, `mcp-gateway.mjs`, and `mcp-servers.json`. Deployed Sage files: `src/agent.mjs`, `src/tools/secure-tool-broker.mjs`, `src/tools/mcp-gateway-catalog.mjs`, `src/tools/prayer-times-direct.mjs`, and `src/tools/hermes-task.mjs`. These are the existing repository implementations; no new application source change was needed.
- The reported `prayer-times-direct.mjs:39` defect was output redaction, not malformed source. Actual source has the valid Bearer template, contains no literal redaction marker, passes `node --check`, and passed its 7 focused tests. It was not changed to address a nonexistent defect.
- The focused Gateway/Sage/Twilio suite passed 77/77 tests across 9 explicit test files. Combined with the separate authorization suite, 84/84 focused tests passed. The Master additionally verified `GEMINI_LIVE_VOICE=Kore` reaches the provider's voice option, with `gemini-3.8-live` and no forced language override, without external inference.
- Real production checks passed through both the internal listener and `https://hermes-api.agentsfer.com`: unauthenticated MCP health 401; authenticated health 200; one ready `aladhan` server; catalog exactly `aladhan__timings`, access `read-only`. Existing `/agent/task`, `/prayer-times`, and `/prayer-times/direct-test` retain authenticated validation (400) and unauthenticated denial (401).
- Requests for absent private-document and write tools returned 404 without contacting Hindsight. One real public AlAdhan timings request through the production Sage tool adapter, Secure Tool Broker, HTTPS proxy, and Gateway returned a nonempty prayer-times result in 691 ms. This exercised the deployed host Sage adapter, not a LiveKit voice session.
- LiveKit settings were merged using separate `--secrets GEMINI_LIVE_VOICE=Kore` and `--secrets SAGE_MCP_TOOLS=aladhan__timings` arguments; `--overwrite` was never used. Both names were read back, and all five pre-existing secret names and their update timestamps remained unchanged. Credential values were not retrieved or printed. The CLI's comma-combined argument initially created only the first setting; it was corrected with separate arguments before deploying Sage.
- LiveKit remote build/deploy succeeded. Read-back shows production version `iD6Zy7j6z8BQ`, `Running`, 1/1/1 replicas, and `Available`. A bounded deployment-log tail showed worker startup and registration, with no error/failure/uncaught/syntax-error matches in the captured excerpt. No voice job was generated.
- Caddy configuration, AlAdhan direct implementation, Turkish/English persona, provider factory, AlAdhan allowlist, and Twilio function retained their pre-deployment SHA256 values. Protected local Docker container IDs were unchanged; PostgreSQL and Hindsight remained healthy. No routing, SIP dispatch, Hindsight, database, IAM, Firebase, or Supabase change was made.

## Current rollback readiness

- Reused verified archive: `/home/digisfer/.local/state/agentsfer-release-backups/20261012T213905Z-mcp-gateway-sage-release.tar.gz`, SHA256 `71f67a922b3d8eb8dfe49d040887c1699c2b9f7dcc91a6dac6f78046b1ca8abf`.
- Supplementary secret-free originals for `prayer-times-direct.mjs` and `hermes-task.mjs`, deployment hashes, and environment rollback metadata are under `/home/digisfer/.local/state/agentsfer-release-backups/20261012T213905Z-mcp-gateway-sage-release.supplemental/` (directory 0700; backup/state files 0600). No environment credential backup was created.
- Durable Luna-authored helper: `.../20261012T213905Z-mcp-gateway-sage-release.supplemental/rollout-helper.py` (0700). Its complete apply/rollback flow was exercised in an isolated fixture: original files and exact environment bytes restored; only the three pre-existing absent paths removed. Production rollback was not triggered because no critical regression was observed.
- Host rollback: run `python3 /home/digisfer/.local/state/agentsfer-release-backups/20261012T213905Z-mcp-gateway-sage-release.supplemental/rollout-helper.py --rollback`, then `sudo -n /usr/bin/systemctl restart hermes-bridge.service`. The helper refuses unexpected target/environment drift. It restores the existing archive plus the two supplemental originals, removes only newly introduced Gateway paths, and removes only its exact HOST/PORT additions. Recheck preserved listener and authenticated direct-route behavior after rollback.
- The immediately preceding production version `GNPfUghTFNaU` was read back as `Available` after deployment and is the current cloud rollback target: `lk agent rollback --id CA_hJeW6sWL5S8T --version GNPfUghTFNaU`. Reset voice with merge-only `lk agent update-secrets --id CA_hJeW6sWL5S8T --secrets GEMINI_LIVE_VOICE=Puck --secrets SAGE_MCP_TOOLS=disabled`; `disabled` fails the candidate allowlist gate closed and is ignored by the old agent. Never overwrite the existing credential set. The older recorded `JyUnXxTPmMUQ` was visible before deployment but was not listed in the post-deployment response; do not assume its continued availability.

## Verification limits and Git scope

- No real phone call, LiveKit simulation, private-document request, or audible Kore test was run. Actual cloud credential-value equality and cloud voice-job MCP registration were not independently established. The successful public Gateway/broker request used the unchanged local Bridge token; preserved cloud secret timestamps are continuity evidence, not proof of cloud token equality.
- GPT-6 Luna performed bounded security/implementation/test tasks. `gpt-5.4-mini` and `gpt-5.3-codex-spark` were rejected by the account before running tests; focused QA used supported Luna instead. No Hermes model/profile configuration was changed.
- Approved Git changes are only `services/voice-infrastructure/.env.example` (Kore and public read-only tool opt-in) and this deployment/handoff record. Application implementation remains based on repository commit `8fce8d4d12d3a7b9ec61191ccdfa6ea778451c66`. Final commit/push identity is verified and reported by the Master after publication.

## Historical pre-deployment handoff

At the preceding handoff, deployment had not started: no production source/configuration, service restart, LiveKit deployment, or secret update had occurred. The six completed investigations below were reused rather than repeated.

## Repository

- Repository: `vizisfer/Hermes-Second-Brain`, branch `main`.
- Local HEAD and verified GitHub `main`: `8fce8d4d12d3a7b9ec61191ccdfa6ea778451c66`; the previously published tree had 107 file blobs.
- Working tree before this handoff: `services/voice-infrastructure/.env.example` modified, not committed or pushed. Its non-secret `GEMINI_LIVE_VOICE=Kore` and `SAGE_MCP_TOOLS=aladhan__timings` entries were uncommented. No production change follows from this example-file edit alone.
- This handoff file is also a new, uncommitted repository file. Do not claim either change is pushed.

## Production observations

- Host identity: `vmi3497794`, user `digisfer`.
- `hermes-bridge.service` was active/running (PID 2751725 at the read-only check). `sudo -n -l /usr/bin/systemctl restart hermes-bridge.service` listed the requested restart as permitted. No restart was attempted.
- Bridge `.env` contains `HERMES_BRIDGE_TOKEN`; only its presence and minimum-length validity were checked. Its value was not printed. No `HOST` or `PORT` setting was present in that `.env`; the effective bind may be set elsewhere and was not re-established in this continuation. Before deployment, preserve the actual reverse-proxy-reachable listener explicitly; do not rely on the candidate loopback default or use a wildcard bind.
- LiveKit agent `CA_hJeW6sWL5S8T` (`agentsfer-voice-infrastructure`) was `Sleeping`, version `GNPfUghTFNaU`, region `us-east`. Prior recorded version available for rollback: `JyUnXxTPmMUQ`. No LiveKit deployment or simulation was run.
- LiveKit secret-name listing confirmed `GOOGLE_API_KEY`, `HERMES_GATEWAY_TOKEN`, and `HERMES_GATEWAY_URL`; it did not show `GEMINI_LIVE_VOICE`, `GEMINI_LIVE_LANGUAGE`, `SAGE_MCP_TOOLS`, or `HINDSIGHT_BASE_URL`. Secret values were not retrieved. Matching token continuity is therefore unverified.
- The installed production Gemini Realtime plugin defaults to `Puck` when no voice option is passed. Candidate code already supports `GEMINI_LIVE_VOICE`; Kore is not yet configured in the LiveKit agent.
- Candidate persona retains Turkish/English language matching and a bilingual unknown-language greeting. The live cloud secret list had no explicit `GEMINI_LIVE_LANGUAGE`. Twilio routing/function files were not changed.

## Gateway candidate and safety

- Candidate repository contains the Gateway implementation. Its `mcp-servers.json` enables only `aladhan` with `timings`, marked `read-only`; `local_test` is disabled. No Hindsight server or private Hindsight data is exposed by this candidate config.
- Existing AlAdhan routes and the separate working Second Brain ↔ Hindsight integration must remain untouched.
- Production has the MCP SDK under the sibling Sage `node_modules`; Bridge has no local `node_modules`. The candidate resolves that sibling dependency path.
- Previous production observation: unauthenticated existing Bridge routes returned 401 and `/mcp/health` returned 404. Do not treat that older health observation as current post-deployment verification.

## Backups and rollback

- Historical archives under `/home/digisfer/.local/state/agentsfer-release-backups/20261012T071807Z/` remain gzip-integrity-valid, but a current-tree `tar --compare` returned nonzero for both trees; do not rely on those archives as an exact snapshot of the current files without resolving the mismatch.
- A fresh scoped, secret-free release snapshot was created at `/home/digisfer/.local/state/agentsfer-release-backups/20261012T213905Z-mcp-gateway-sage-release.tar.gz`. Directory mode 0700, archive mode 0600. It covers the pre-deployment Bridge `server.mjs`, Sage `src/agent.mjs`, `src/tools/secure-tool-broker.mjs`, and `src/providers/index.mjs`; records three Gateway target paths that were absent before deployment; archive integrity, SHA256 read-back, and isolated restore comparison passed. It intentionally does not include `.env`, full production data/config, or LiveKit Cloud secret values.
- Bridge rollback can restore the backed-up `server.mjs`, remove only the newly introduced Gateway files/config, restart the unit, then re-check authenticated health and the preserved AlAdhan route.
- Sage rollback target is the prior recorded LiveKit version `JyUnXxTPmMUQ`. If changing the voice through a new LiveKit secret, restore the prior plugin default (`Puck`) on rollback. Add/update secrets only with merge semantics; never use `--overwrite` because existing Gemini and Gateway credentials must be preserved.

## Delegated roles

Six scoped roles were dispatched: Architecture & Integration, MCP Gateway Engineer, Voice Infrastructure Engineer, Security Review, DevOps Deployment, and QA & Testing. All six reports have now arrived:

- Gateway report: production Bridge currently has only `server.mjs` and `aladhan-direct.mjs` among the inspected Gateway files; candidate `mcp-gateway.mjs` and `mcp-servers.json` are not deployed there. Candidate config enables only `aladhan__timings` as read-only and disables `local_test`. The candidate AlAdhan direct route and Sage allowlist module were reported byte-identical to production. Production package declares the MCP SDK in the sibling Sage tree; the active service working directory is the production Bridge directory, not `sage-gateway-work`.
- Voice report: candidate `src/providers/index.mjs` already maps `GEMINI_LIVE_VOICE` to the Gemini `voice` option; production has the same provider path. Turkish/English matching and bilingual fallback are preserved. Candidate Gateway integration is absent from production and needs `SAGE_MCP_TOOLS` plus the existing `HERMES_GATEWAY_TOKEN` and `HERMES_GATEWAY_URL` names; those values were not inspected.
- Architecture report: Gateway is an opt-in Bridge extension; Sage uses the existing Secure Tool Broker and service principal without tenant identity. Existing Sage readiness, Hermes task, and direct prayer tools remain separate; Gateway catalog failure is intended to leave those tools active. Hindsight is a separate integration and is neither replaced nor invoked. No Firebase, Supabase, or new IAM is involved. These are source-level findings, not production runtime verification.
- Security report: candidate manifest has no Hindsight/private-data, write, or destructive tools. It flagged a potentially malformed authorization-header expression at `services/voice-infrastructure/src/tools/prayer-times-direct.mjs:39`. This report was not independently reproduced in this handoff-only continuation; treat it as a deployment blocker until a focused source/test check confirms or resolves it.
- DevOps report: the subagent could not independently access the host over SSH because host-key verification stopped its session. It did not list production/archive mismatch paths or verify rollback. The parent session separately confirmed host identity, active Bridge unit, restart permission listing, and created the fresh scoped file snapshot recorded above.
- QA report: after deployment, minimum checks are active service/version status, authenticated Gateway health, catalog exactly `aladhan__timings`, one safe AlAdhan timings call with sanitized logs, and LiveKit version/status. It advised against simulations. No tests, production calls, or simulations were run by that agent.
- Reports are source/read-only evidence; they do not prove production Gateway behavior, LiveKit token continuity, or a production rollback.

## Historical deployment blockers / next actions (resolved above)

1. Resolve the effective production Bridge bind and port from the live listener/unit without printing environment secrets. Confirm it remains reachable by the existing reverse proxy; explicitly configure the same safe interface before restart.
2. Resolve the Security Review Agent's flagged `prayer-times-direct.mjs:39` authorization-header issue with a narrowly focused source/test check before deploying Sage; do not proceed on an unverified security-critical report.
3. Use the fresh scoped snapshot for the Bridge code rollback. Keep the existing `.env` and its token unchanged.
4. Deploy only the Gateway candidate files/config and the minimal Sage integration files from the repository. Preserve the existing Sage/Bridge authentication and do not add Hindsight, private, write, or destructive tools.
5. Apply `GEMINI_LIVE_VOICE=Kore` and `SAGE_MCP_TOOLS=aladhan__timings` to the LiveKit agent without overwriting its existing secrets. Keep the current `gemini-3.8-live` model, language-matching behavior, bilingual greeting, and Twilio route.
6. After deployment, run focused checks only: Bridge service active; unauthenticated MCP request denied; authenticated Gateway health ready; catalog exactly `aladhan__timings` with read-only access; one safe AlAdhan timings call; Sage deployed version/status and logs; confirm existing secret names remain present. Do not run private Hindsight calls or a real phone call unless separately authorized.
7. If a critical regression appears, restore the Bridge source snapshot and restart the authorized unit, and roll Sage back to the recorded prior LiveKit version; verify both read-backs before reporting recovery.
8. Commit and push the `.env.example` and handoff documentation changes only after the deployment state is accurately recorded; then verify the remote commit and working tree.
