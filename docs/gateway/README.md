# Agentsfer Sage — Universal MCP Gateway

This documents the isolated Gateway release candidate, not a deployed Gateway or production approval. It implements an official-SDK registry for multiple stdio and Streamable HTTP MCP servers, with the existing Secure Tool Broker in Sage. `write` and `destructive` calls always fail closed. Production proxy/network and service boundaries were inspected read-only; caller identity and a real remote MCP provider path remain unverified.

## Runtime and HTTP contract

`server.mjs` reads `HOST` (default `127.0.0.1`), `PORT` (default `8787`), `HERMES_BRIDGE_TOKEN` (required, at least 32 characters), and `MCP_CONFIG_PATH` (default adjacent `mcp-servers.json`). Config is loaded and validated at startup; no hot reload is implemented. Gateway startup precedes HTTP listen. SIGINT/SIGTERM closes MCP clients and the HTTP server.

All accepted routes require exact `Authorization: Bearer <HERMES_BRIDGE_TOKEN>`; equal-length tokens are compared with `timingSafeEqual`. Unknown path/method combinations return 404.

| Route | Contract |
|---|---|
| `GET /mcp/health` | `200` `{status, servers:[{name,status}], toolCount}` |
| `GET /mcp/tools` | `200` `{tools:[{id,description,inputSchema,access}]}`; sensitive-read tools are hidden unless separately authorized |
| `POST /mcp/call` | JSON `{ "tool": "server__tool", "arguments": {...} }`; calls configured tool only |

Gateway request body limit is 8,192 bytes; legacy Bridge routes retain 2,048 bytes. MCP API rate limit is 60 requests/minute per observed socket address. Errors include 400 invalid request/arguments, 401 unauthorized, 403 policy denied, 404 unknown tool, 413 too large, 429 busy, 499 cancelled, 502 tool failure, and 504 timeout. Call timeout defaults to 10 seconds, clamped to 1–30 seconds; concurrency is capped at 8. Normalized tool output is limited to 16,384 bytes; remote Streamable HTTP response body to 1 MiB per response.

Existing authenticated POST routes `/prayer-times`, `/agent/task`, and `/prayer-times/direct-test` remain in `server.mjs`.

## JSON configuration

Top level accepts only `mcpServers`, up to 16 entries. Server/tool names are bounded lowercase identifiers and `__` is reserved for `server__tool`. Each entry accepts only these fields:

- Common: `enabled` (boolean), `transport` (`stdio` or `streamable-http`), `access` (`read-only`, `sensitive-read`, `write`, `destructive`), `allowedTools` (unique array of at most 64 valid names).
- `stdio`: executable must be `process.execPath` (also selectable as `${PROCESS_NODE}`) or an exact absolute path in the Bridge process `MCP_ALLOWED_EXECUTABLES` colon-separated allowlist; no shell. At most 64 arguments (512 characters each); at most 32 explicit environment entries (4,096 characters each), with documented placeholders.
- `streamable-http`: fixed HTTPS URL up to 2,048 characters; no userinfo, query, or fragment. Optional `authEnv` references a server-side environment variable. DNS addresses are checked and a selected public address is pinned to the TLS connection; hostname/SNI verification remains enabled; redirects and origin changes are rejected.

Unknown keys and invalid configurations fail as `invalid_config`. Enabled-server connection/discovery/manifest errors make that server unavailable and expose no tools. Unsupported or unbounded input schemas fail closed. The checked-in config enables `aladhan` with `timings` and disables `local_test` with `echo` and `current_test_status`.

Config string expansion applies to command, args and stdio env values:

- `${PROCESS_NODE}`: current executable (`process.execPath`); also the sole permitted non-absolute `command`.
- `${VOICE_ROOT}`: `../voice-infrastructure` relative to the gateway module directory.
- `${BRIDGE_ROOT}`: gateway module directory.
- `${ENV_NAME}`: process environment value; missing/non-string values fail with `missing_environment`.

`cwd` itself is not expanded. Stdio uses the MCP SDK transport without a shell and a minimal base child environment (`PATH=/usr/bin:/bin` plus selected identity variables and configured `env`). HTTP auth is fetched from the named process environment variable and is not returned through gateway APIs.

## Sage integration boundary

Intended path: Sage voice tool → existing Secure Tool Broker → authenticated Bridge `/mcp/tools` and `/mcp/call` → Gateway → MCP server. Keep the Broker responsible for Sage-side schemas, principal/session binding, authorization, deadline/cancellation, output validation and mandatory audit. Bridge Bearer authentication does not establish the voice caller's authorization.

Sage implements opt-in configuration using `SAGE_MCP_TOOLS`, `HERMES_GATEWAY_URL`, and `HERMES_GATEWAY_TOKEN`; the catalog is capped at six statically selected `read-only` tools and calls go through Secure Tool Broker. `HERMES_GATEWAY_URL` must be explicitly set in the approved environment; no production endpoint is hard-coded. Use a reserved `.invalid` hostname in examples and tests. Sage uses an explicit service principal with no tenant; the broker denies tenant-bound capabilities to it, and room names are not identity. Do not expose tenant/private or sensitive tools without a verified user identity and resource-level authorization.

## Transport and security limitations

Supported client transports: stdio and Streamable HTTP; legacy SSE is unsupported. `read-only` calls require the main Bearer token. `sensitive-read` is denied/hidden by default and requires a distinct `MCP_SENSITIVE_READ_TOKEN` (at least 32 characters) in `X-MCP-Sensitive-Read`. `write` and `destructive` are denied even when configured. Access labels do not prove harmlessness.

For remote HTTP, DNS answers are checked for blocked/private ranges, a selected public address is pinned in the HTTPS request's DNS lookup, and origin changes/redirects are rejected. TLS hostname/SNI certificate checks are left at Node's secure defaults. Unit tests verify pinning mechanics with an injected request stub; no real remote MCP provider or production egress path was exercised. Deployment network policy and TLS termination remain unverified.

## Test evidence

Focused and full-suite evidence is summarized in `../operations/PROGRESS.md` and `../operations/deployment-status.md`; `benchmark.md` contains bounded historical latency samples. Local tests are not production deployment or smoke evidence.

See [OPERATIONS.md](OPERATIONS.md), [DEPLOYMENT.md](DEPLOYMENT.md), [ROLLBACK.md](ROLLBACK.md), [SECURITY.md](SECURITY.md), and [ADDING-MCP-SERVER.md](ADDING-MCP-SERVER.md).