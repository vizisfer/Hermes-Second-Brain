# Security model

## Boundaries

- HTTP callers authenticate using Bridge Bearer token. This proves possession of that token only; it does not authorize a Sage principal or voice session.
- Operator-owned `mcp-servers.json` controls endpoints/commands, enablement, access class, and tool allowlists. Callers supply only namespaced tool ID and arguments.
- MCP server output and metadata are untrusted. Names/descriptions/schema validation do not prove a tool is safe.
- Any Sage voice integration must route through Secure Tool Broker for principal/session binding, authorization, audit, validation, cancellation, and deadlines. Sage currently resolves only a typed service principal without a tenant; no end-user identity verifier is connected. Room names are never treated as identity.

## Enforced behavior

All accepted paths require the main exact Bearer token. Sensitive-read additionally requires a separate `MCP_SENSITIVE_READ_TOKEN` in `X-MCP-Sensitive-Read`; its catalog entries are hidden otherwise. Gateway config is strict. Only explicitly listed tools are registered. JSON arguments are constrained by the supported discovered primitive schemas; callers cannot supply command, URL, env, access policy, or timeout. Calls are capped at 8 concurrent and 1–30 seconds (10-second default); arguments at 8 KiB; normalized output at 16 KiB; remote HTTP response streams at 1 MiB. Write/destructive are denied regardless of configuration.

Remote HTTP accepts static HTTPS URLs and optional env-backed Bearer auth. It rejects redirects/origin changes, checks resolved DNS answers for blocked ranges, pins the selected public address in the HTTPS connection, and retains Node's hostname/SNI TLS validation. This mechanism has stubbed unit coverage, not real remote-provider or production egress testing.

## Operation policy

Do not expose Gateway on a network or send production traffic without separately reviewed deployment and security approval. Verify actual TLS termination, network ACLs/egress, secret storage/rotation, service identity, and operational recovery; this snapshot does not define them. Local test success is not a readiness certificate. The current service principal has no tenant and cannot execute tenant-bound capabilities; do not expose private data without a verified user identity and resource-level policy.