# Security model and controls

This is an implementation description, not a security certification. Local tests do not establish production network, TLS termination, service identity, or user authorization.

## Trust boundaries and enforced policy

- Public caller input supplies only a configured namespaced tool ID and JSON arguments. It cannot select an executable, URL, filesystem path, environment variable, server, or policy.
- Every route requires the main `HERMES_BRIDGE_TOKEN` (minimum 32 characters), compared in constant time. The token authenticates possession; it is not an end-user identity.
- Tool access is explicit per server and exact per tool. Unknown/discovered-but-unlisted tools are denied. Disabled servers are not spawned.
- `read-only` is callable with the main token. `sensitive-read` is denied and omitted from the default catalog; it requires a separately configured, distinct `MCP_SENSITIVE_READ_TOKEN` (minimum 32 characters), supplied in `X-MCP-Sensitive-Read`. The same token grants all configured sensitive-read tools, so keep its use restricted. `write` and `destructive` are always denied.
- Stdio uses the official SDK without a shell, only a configured absolute executable or `${PROCESS_NODE}`, a restricted child environment, bounded arguments, and startup validation.
- Remote Streamable HTTP requires static HTTPS config, checks all DNS answers against blocked address classes, pins a validated address to the TLS socket, retains hostname/SNI certificate verification, restricts origin, and rejects redirects. Each response body is capped at 1 MiB.
- Inputs/schema, HTTP body, output size, concurrency, rate, connect/tool timeouts, and audit metadata are bounded. Errors do not return stack traces or tool-private error text. Tool calls are not automatically retried; reconnect occurs only before a later distinct request.
- Sage Gateway tools are opt-in, capped at six static IDs, accept only `read-only`, validate supported primitive schemas, and go through the existing Secure Tool Broker with cancellation and output validation.

## Identity limitation

Sage adapters resolve an explicit `service` principal with no `tenantId`; session/room metadata gate the runtime context and bind a short-lived execution, but do not establish user or tenant identity. The Secure Tool Broker distinguishes service and user principals, rejects `tenantId` on service principals, and denies tenant-bound capabilities to them. No trusted end-user identity source is connected, and Bridge bearer tokens identify only service-to-service possession. This permits only the explicitly public, read-only AlAdhan capability; do not expose tenant/private or sensitive-read tools until trusted identity and resource-level authorization are independently verified. Tool results remain untrusted content and must not be treated as policy or instructions.

## Remaining deployment review

The isolated source does not establish production TLS termination, network ACLs/egress, reverse-proxy client identity, secret storage/rotation, file ownership, service account, monitoring, or incident response. These need owner review before any production change. Never log tokens, tool arguments, or sensitive results. Do not weaken auth/allowlists to troubleshoot. Isolated staging checks used disposable credentials; no production deployment, service restart, or production smoke test was performed.
