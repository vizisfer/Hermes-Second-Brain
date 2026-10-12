# Deployment Status and Recovery Record

Recorded: 2026-10-12 UTC.

## Production baseline

- `hermes-bridge.service` is active/running. Its source directory has no Git metadata. Caddy HTTPS routes to the existing host listener; detailed host topology is retained in the host-private manifest.
- Latest unauthenticated HTTPS probes: Gateway `GET /mcp/health` returned 404; existing POST routes `/agent/task`, `/prayer-times`, and `/prayer-times/direct-test` returned 401. No production request with a valid credential was performed.
- LiveKit agent `agentsfer-voice-infrastructure` (`CA_hJeW6sWL5S8T`): latest read-only `lk agent status --json` observation on 2026-10-12 showed current version `GNPfUghTFNaU`, region `us-east`, status `Sleeping`. No new deployment was made.
- The production Bridge environment contains `HERMES_BRIDGE_TOKEN` and satisfies the candidate's minimum-length check; its value was not printed. LiveKit secret-name listing confirmed `HERMES_GATEWAY_TOKEN` and `HERMES_GATEWAY_URL`; values were not read or changed. This does not prove the values match or that an authenticated end-to-end request succeeds.

## Verified backups

Created outside deployment paths before any production changes. Exact archive paths are retained in the host-private manifest.

Backup directory mode is `0700`; archives are mode `0600`. Archives include source/config (including local environment files) while excluding `.git`, `node_modules`, `.venv`, caches, logs, coverage, dist, and build output. Both passed `gzip -t`; `tar -d` verified each archive against its source tree. Secret values were not displayed. Do not place archives in Git or copy them into deployment directories.

## Candidate checks

- After Sage service/user principal hardening and room-context compatibility tests, the full Sage candidate suite passed 73/73. The latest explicit-Gateway-URL guard passed the focused catalog suite 5/5; the full Sage suite was not repeated. Bridge `test/http-api.test.mjs` passed 2/2, including loopback-default behavior. Document Manager tests passed 9/9, covering session-cookie, same-origin, and non-loopback Host denials. Hermes plugin tests remain 9/9.
- Isolated candidate Bridge process: startup/health succeeded; unauthenticated request returned 401; authenticated health returned 200/ready; tool catalog contained only `aladhan__timings`; an unlisted upstream tool returned 404; the read-only AlAdhan invocation returned 200 with content; process cleanup succeeded; captured logs did not contain the disposable test token. This smoke preceded the Sage identity hardening and latest explicit-URL guard. The Sage full suite passed after identity hardening, and focused catalog tests passed after the URL guard; the combined smoke was not repeated.
- `docker compose ... config --quiet` with the revised safe `.env.example` and the backup/restore scripts' `bash -n` check passed. No containers, databases, or user files were started/read/changed.
- Final local redacted heuristic secret scan covered 107 text files and found 0 matches. Dedicated `gitleaks`, `trufflehog`, `detect-secrets`, and `secretlint` executables are absent; this is not equivalent to those tools. Static added-line scan's four credential-assignment matches were reviewed as test/mock/XML-template fixtures, not live credentials. `.env`, `.env.example`, `livekit.toml`, and Hermes temp-file ignore behavior were checked.
- Authenticated GitHub checks on 2026-10-12 verified account `vizisfer`, repository default branch `main`, push permission, size 0 KB, and zero remote branch refs before the import. Repo-local author identity matches the authenticated account's GitHub noreply identity. No commit or push has occurred yet.
- Local import has 107 staged paths and zero forbidden sensitive/generated paths. Twilio/Gemini named source files, provider implementation, Twilio function, provider-related agent lines, and env-variable names match the production baseline. `git diff --cached --check` reports four inherited blank lines at EOF in mirrored source files; these were preserved.
- Read-only deployment preflight confirmed the existing explicit Bridge bind matches its active service socket, the sibling Sage dependency path resolves, and the LiveKit secret names exist. No secret values were displayed. The session lacks non-interactive sudo and Polkit authorization to restart the system unit.
- Independent review findings were addressed in the candidate: Bridge's unset-host fallback is loopback; Sage's Gateway URL must be explicitly configured, with no live production URL default; the shared request wrapper rejects redirects (now asserted by tests); and Document Manager browser API calls use a per-process HttpOnly/SameSite cookie plus strict loopback Host/same-origin checks. The previous reviewer concern about redirect handling was a false positive: `requestJson` already sets `redirect: 'error'` for both catalog and call requests.

## Deployment gate

**NOT DEPLOYED.** The staged import is awaiting a complete independent per-path review and commit/push/read-back. Production deployment is blocked because this session cannot restart `hermes-bridge.service`, so it cannot meet the automatic rollback requirement; the systemd unit file is not directly readable. Functional Bridge↔LiveKit token continuity, authenticated production Gateway/AlAdhan checks, and complete TLS/network review remain unverified. The Sage service principal has no tenant and tenant-bound capabilities are denied; only public read-only AlAdhan timings are allowlisted. Production services/configuration remain unchanged.

Rollback targets are recorded in the host-private manifest. Bridge and Sage archives are integrity-verified. A disposable file-level rollback simulation restored the archived Bridge source, preserved a synthetic current `.env` and unrelated file, and removed the two Gateway-only files. Production service-manager rollback was not tested because restart authorization is unavailable. Previous LiveKit version was `JyUnXxTPmMUQ`; current observed version is `GNPfUghTFNaU`.

No production service, environment, Caddy, DNS, firewall, Twilio, Gemini, or LiveKit state was changed. No real phone call or LiveKit simulation was run. Use target-specific, verified platform commands only; never infer a restart/deploy command from this record.
