# Current architecture (isolated implementation)

This describes the current isolated code candidate, not a verified deployed process. See [README](README.md) for the full route/config contract.

- `server.mjs` uses Node HTTP, binds `HOST` (candidate default `127.0.0.1`) and `PORT` (default `8787`), and requires `HERMES_BRIDGE_TOKEN` of at least 32 characters. Production was observed on a specific private address; deployment must explicitly set and verify that address. `MCP_CONFIG_PATH` optionally overrides adjacent `mcp-servers.json`.
- Authenticated Gateway routes are `GET /mcp/health`, `GET /mcp/tools`, and `POST /mcp/call`; all accepted routes use exact Bearer auth. Gateway body cap is 8192 bytes; legacy POST route body cap remains 2048 bytes.
- `mcp-gateway.mjs` validates strict JSON config, connects enabled MCP servers, discovers tools, registers only configured names, validates arguments against discovered schemas, and namespaces IDs `server__tool`.
- `stdio` and `streamable-http` transports are implemented. Read-only tools use the main Bearer token; sensitive-read metadata/calls require a distinct sensitive-read token; write/destructive always fail closed. `mcp-servers.json` enables AlAdhan `timings` and leaves the local test server disabled.
- Sage has an opt-in catalog configured by `SAGE_MCP_TOOLS`, `HERMES_GATEWAY_URL`, and `HERMES_GATEWAY_TOKEN`; all calls route through the existing Secure Tool Broker. Sage supplies an explicit service principal without a tenant; session objects are bound per call but do not establish human/tenant identity. Tenant-bound capabilities are denied to service principals.
- Remote HTTP checks DNS addresses, pins a selected public address to the TLS connection, rejects redirects/origin changes, and caps each response stream at 1 MiB. Pinning is unit-tested with a stub; real remote-provider and production egress/TLS behavior remain unverified.

Legacy routes `/agent/task`, `/prayer-times`, and `/prayer-times/direct-test` remain. Production deployment, restart, smoke tests, LiveKit simulations, and Twilio calls were not performed.