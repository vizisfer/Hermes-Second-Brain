# Gateway configuration design and implemented contract

Configuration is JSON (not YAML) in the Bridge process-local file, selected by `MCP_CONFIG_PATH`; default is `mcp-servers.json` adjacent to `mcp-gateway.mjs`. The root object has exactly one key, `mcpServers`. At most 16 server entries are accepted. Each server entry has strict keys:

- `enabled`: required boolean; disabled entries are never connected.
- `transport`: `stdio` or `streamable-http` only.
- `access`: required explicit `read-only`, `sensitive-read`, `write`, or `destructive` classification. Read-only uses the main Bearer token; sensitive-read requires a separate `MCP_SENSITIVE_READ_TOKEN` and is hidden by default; write/destructive are always denied. Sage dynamic voice catalog only admits read-only.
- `allowedTools`: required unique tool-name array (maximum 64). No wildcard. Only exact discovered names are registered. Unknown names mark that server unavailable; no tool is exposed.
- Stdio-only: `command` (absolute executable or exact `${PROCESS_NODE}`), up to 64 `args` strings (each ≤512 characters), optional absolute `cwd`, and optional `env` object (up to 32 explicit key/value entries, each value ≤4,096 characters; `${ENV_VAR}` references resolve at launch). Transport-specific fields from HTTP are rejected.
- Streamable HTTP-only: static HTTPS `url` (≤2,048 characters; no credentials, query, or fragment) and optional `authEnv` naming an environment variable whose value is sent as a Bearer credential to that upstream. Stdio-specific fields are rejected.

Namespaced identifiers are exactly `${serverName}__${toolName}`. Names/server tool IDs are bounded lowercase identifiers; duplicates and malformed names are rejected. Stdio arguments support `${PROCESS_NODE}`, `${VOICE_ROOT}`, `${BRIDGE_ROOT}`, and `${ENV_VAR}` substitution; these are trusted configuration substitutions, never caller-controlled. `${PROCESS_NODE}` resolves to `process.execPath`. Stdio uses `shell:false` via the official SDK, restricted PATH/HOME and cleared LOGNAME/SHELL/TERM/USER; executable launch is restricted to the exact `process.execPath` or exact paths in the Bridge process `MCP_ALLOWED_EXECUTABLES` colon-separated allowlist.

Enabled servers are connected/discovered at Bridge startup with SDK client timeouts. An individual unavailable/malformed server is isolated and reports only safe status; it does not publish tools or prevent other MCP servers from working. Configuration structure errors prevent startup. Tool call argument types support bounded object schemas with primitive string, number, integer, and boolean properties, required fields, numeric/string bounds and string enums; unsupported keywords/shapes fail closed. Calls reject additional arguments, cap request args at 8 KiB, normalized output at 16 KiB, remote HTTP response streams at 1 MiB, concurrency at 8 and timeout at 30 seconds. A failed call is never replayed; a subsequent call can reconnect first.

The shipped example config enables only verified AlAdhan `timings`; local harmless `local_test` is disabled by default. A new entry requires config plus an operator-approved executable allowlist entry where applicable, but no Gateway core changes for supported schemas.

Remote HTTPS validates DNS answers and pins the chosen public address to the HTTPS socket while retaining hostname/SNI verification; redirects and cross-origin URLs are rejected. Pinning and response-cap mechanics have local stubbed tests; no real remote provider or production egress path has been exercised. Production deployment/network controls remain unverified.
