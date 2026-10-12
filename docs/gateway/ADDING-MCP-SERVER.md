# Adding an MCP server

This procedure describes configuration for the isolated candidate. Review provider provenance, executable/endpoint ownership, returned data, every tool's actual side effects, and update policy first. MCP descriptions and names do not prove safety. Add only exact approved tool names.

## Example: read-only remote catalog

Add a server entry to the trusted `mcp-servers.json` file (valid illustrative tool name; replace only after checking the server's actual tool manifest):

```json
{
  "mcpServers": {
    "public_catalog": {
      "enabled": true,
      "transport": "streamable-http",
      "access": "read-only",
      "url": "https://catalog.example.invalid/mcp",
      "authEnv": "MCP_PUBLIC_CATALOG_TOKEN",
      "allowedTools": ["list_public_items"]
    }
  }
}
```

`example.invalid` is a reserved documentation domain and is not a working endpoint. The token name is a variable reference only; put no credential in JSON. If the server does not require auth, omit `authEnv`. Remote URLs must be HTTPS and publicly routable; private, loopback, link-local, and reserved DNS results are rejected. The resolved address is pinned to the TLS connection. Redirects and origin changes are rejected.

For stdio, use `process.execPath` (or exactly `${PROCESS_NODE}`) or a reviewed absolute executable path explicitly listed in the Bridge process `MCP_ALLOWED_EXECUTABLES` allowlist; configure reviewed `args` and a minimal explicit `env`. The process is launched without a shell. Keep scripts and configuration writable only by the service owner. Do not pass caller/model-controlled strings as commands, paths, environment variables, or URLs.

## Review and enable sequence

1. Confirm the server actually advertises each named tool and inspect its schema. Do not invent names.
2. Choose `read-only` only after reviewing implementation and downstream effects. Use `sensitive-read` only when its separate token access is deliberately provisioned. `write`/`destructive` remain blocked regardless of configuration.
3. Add an exact allowlist, initially `enabled: false`; validate config in an isolated environment. Unknown keys, duplicate names, unsupported schemas, missing configured tools, or unsafe transport fail closed.
4. Enable only in a controlled non-production environment. Verify namespaced discovery and valid/invalid arguments, authorization denial, timeout/cancellation, output bounds, and safe shutdown.
5. For Sage, separately add at most six approved `read-only` IDs to `SAGE_MCP_TOOLS`; verify `HERMES_GATEWAY_URL` points to the intended HTTPS environment and make the existing `HERMES_GATEWAY_TOKEN` available through the approved secret manager. No Gateway core change is expected for schemas supported by both the MCP gateway and Sage adapter.
6. To disable, set `enabled` false and restart only through an independently approved service procedure. Configuration is read at startup; there is no hot reload.

See [SECURITY.md](SECURITY.md) for the service-vs-user identity boundary and [OPERATIONS.md](OPERATIONS.md) for diagnostics. No sensitive external account should be used for routine validation.
