# Deployment sequence (not executed)

This remains a candidate checklist, not a runnable platform recipe. The existing service, reverse-proxy route, Docker networks, listeners, and LiveKit version were inspected read-only. Gateway routes are absent in production, production sources have no Git revisions, and no staging run with production credentials has been performed. Isolated staging with disposable credentials passed; timestamped production source backups were created and integrity-checked, with exact locations kept in the host-private deployment manifest. No production configuration was changed.

## Release gates

1. Review `SECURITY.md` and the supported Node/MCP SDK versions against the actual deployment host. Bridge imports the pinned MCP SDK from the sibling voice-infrastructure dependency tree; verify this layout and runtime path in staging.
2. Assign an owner-reviewed `mcp-servers.json`; preserve existing AlAdhan `timings` and do not enable `local_test` outside isolated tests. Confirm exact tools from actual manifests. Never copy secrets into config or source.
3. Provision `HERMES_BRIDGE_TOKEN` using the existing approved secret mechanism. Provision `MCP_SENSITIVE_READ_TOKEN` only if a reviewed need exists, separately from the main token. Never use Sage voice for sensitive-read, write, or destructive tools under this candidate.
4. Verify code/config ownership, service user, child-process permissions, `VOICE_INFRASTRUCTURE_ROOT` sibling path, network egress, remote HTTPS destination policies, TLS validation, reverse-proxy routes, bind interface, and rate-limit behavior with the platform owner. The `.env.example` loopback bind is local-only; production must explicitly preserve its existing reverse-proxy-reachable interface and verify the candidate's effective bind against the live socket before restart. Do not use a wildcard bind or rely on the code fallback. No production exposure is inferred by this repository.
5. Stage the exact monorepo artifact on an isolated listener/environment. Validate `/mcp/health`, `/mcp/tools`, authentication/authorization denials, safe MCP calls, existing route compatibility, cancellation, shutdown, and logs.
6. Verify the backup/recovery pair and production secret continuity. Source archives passed integrity/read-back checks and an isolated file-restore/rollback simulation passed while preserving a synthetic `.env` and unrelated file. A real service-manager restart/rollback has not been exercised; authenticated token continuity remains unverified.

## Controlled rollout order

Once the listed blockers are resolved: build a release artifact from reviewed changes, preserve and verify rollback, deploy to isolated staging using verified platform commands, pass focused authorization and AlAdhan checks, then deploy only the exact Bridge/Sage release and read back health. The latest read-only observation on 2026-10-12 found LiveKit version `GNPfUghTFNaU` in `Sleeping` state; Bridge service was active. Do not change Twilio, Gemini Live, existing voice settings, or production secrets as part of this Gateway release.

No deployment, service restart, public route addition, or authenticated production Gateway validation was performed. Unauthenticated existing-route checks returned 401; Gateway route checks returned 404. See `../operations/deployment-status.md` and `../operations/production-infrastructure.md` for sanitized status; exact recovery metadata remains in the host-private manifest.
