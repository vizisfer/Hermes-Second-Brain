# Production Infrastructure Discovery

Discovery/recheck date: 2026-10-12 UTC. Read-only inspection only; this release did not modify production services, files, network rules, secrets, DNS, Caddy, Twilio, Gemini, or LiveKit state.

## Verified topology

- The Hermes Bridge runs as user `digisfer` under a host-managed systemd service and was `active/running` during the latest check. Its application source is not a Git repository. The service listens on the existing host-side Docker gateway interface at TCP port 8787; the private address is not published here.
- Caddy runs in Docker and terminates public HTTPS for the existing Bridge API hostname. Its existing host bindings are TCP 80/443 and UDP 443; it reaches the Bridge through the host-side Docker network gateway. No Gateway-specific public port or route was added.
- Caddy is attached to the existing `proxy` network; the Bridge is a host process. Sage's existing LiveKit worker uses its pre-existing `sage_default` and proxy network arrangement. This release did not alter Docker networks or container definitions.
- The Bridge requires its existing Bearer token. The production environment file's ownership/mode were inspected without reading its values. The candidate uses the same Bridge token variable name; actual Bridge↔LiveKit credential equality was not verified.
- Unauthenticated HTTPS probes returned `401` on the existing POST API routes and `404` for the Gateway health route. This confirms the existing auth boundary and that the Gateway route is not deployed; it does not prove behavior with a valid production credential.

## Runtime and version observations

- The Bridge service's configured Node executable and interactive `node` are distinct. Interactive Node reported `v26.8.1`; the service runtime's exact Node version was not independently confirmed.
- LiveKit CLI read-only status reported the existing `agentsfer-voice-infrastructure` deployment on version `GNPfUghTFNaU`, version state `Available`, deployment state `Sleeping` and enabled. The previous listed version was `JyUnXxTPmMUQ` (`Available`). No deploy or simulation was run.
- Candidate Bridge depends on the pinned MCP SDK in the sibling Sage dependency tree; the monorepo local install/test confirms this layout in the isolated checkout only, not in production.

## Boundaries and open verification

- Existing Caddy and service configuration was inspected through read-only system interfaces. Sensitive configuration values, local environment contents, private paths, and network addresses are excluded from this public document; their protected discovery/backup metadata is retained in the host-private mode-0600 deployment manifest.
- Production route/TLS reachability and unauthenticated rejection were checked. Production authenticated Gateway execution, upstream remote-MCP egress policy, actual token continuity, recovery restore, and service rollback remain unverified.
- Gateway source currently enables one public read-only MCP tool: `aladhan__timings`. No private, tenant-specific, sensitive-read, write, destructive, or arbitrary MCP tools are approved for the initial release.
- No trusted end-user/tenant identity source has been connected to Sage. This is a future prerequisite for private-data tools, not a blocker for the explicitly public AlAdhan tool.

## Current conclusion

The production Bridge and LiveKit deployment were not changed. The candidate has passed isolated local startup, authentication/allowlist checks, and one public read-only AlAdhan invocation using disposable credentials. Production deployment remains blocked until repository publication, production credential continuity, and an operationally verified rollback path are established. See `deployment-status.md`, `PROGRESS.md`, and the candidate runbooks under `../gateway/`.
