# Operations runbook (candidate)

This candidate runbook is supplemented by a host-private deployment manifest. On 2026-10-12, the Bridge systemd service was observed active as a host Node.js process behind Caddy HTTPS routing. Gateway paths were absent in production. No start/restart/deploy command was run; production service files, environment, and exact network addresses are intentionally not published in this repository. Use only verified platform lifecycle commands.

## Runtime contract

- The candidate `HOST` defaults to `127.0.0.1`; `PORT` defaults to `8787`. Production was observed bound to a specific private address, which is intentionally omitted here; deployment must explicitly set and verify that address. Never use a wildcard bind.
- `HERMES_BRIDGE_TOKEN` is required and must be at least 32 characters.
- Optional `MCP_SENSITIVE_READ_TOKEN` must be distinct and at least 32 characters. Without it, sensitive-read tools stay hidden and denied.
- `MCP_CONFIG_PATH` chooses the strict JSON config; default is `mcp-servers.json` beside `mcp-gateway.mjs`.
- Config is read at startup only. SIGINT/SIGTERM closes MCP clients and the HTTP listener.

## Read-only checks

At discovery and recheck, production `GET /mcp/health` returned 404; the Gateway is not deployed there. Existing POST routes rejected unauthenticated requests with 401. After release gates and isolated authenticated staging pass, the Gateway may use authenticated `GET /mcp/health` and `GET /mcp/tools`; these are diagnostics, not proof of caller identity or production health. Never put token values in shell history, logs, tickets, or chat. `/mcp/tools` omits sensitive-read metadata unless the second header is valid. Do not expose internal server details to unauthenticated callers.

A safe isolated verification sequence is:

1. Confirm the expected enabled server statuses and exact namespaced allowlist.
2. Confirm unauthenticated requests receive 401; normal token can list/call approved read-only tools only.
3. Confirm sensitive metadata/calls are denied without the separate sensitive token and permitted only with it, if configured.
4. Confirm write/destructive remain denied, unknown names and invalid args fail, timeout/cancellation work, and output stays within limits.
5. Disable a test server in config, validate and restart only the isolated process; confirm it is not spawned or listed.

Use focused local Node tests in `test/`; run full suites only when source changes justify them. Do not call production routes with credentials or launch LiveKit/Twilio simulations as routine operational checks.

## Failure and escalation

An unavailable server does not crash the Gateway. Inspect only sanitized status and non-secret diagnostics; config/manifest/schema failures fail closed. Later calls may reconnect to an unavailable server but the failed call is never replayed. If the cause is not clear, disable that server in trusted config and use the approved platform owner procedure. Do not rotate or copy production secrets as a debugging shortcut.
