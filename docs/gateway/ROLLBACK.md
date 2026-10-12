# Rollback procedure (file restore simulated; service rollback not executed)

Timestamped production Bridge and Sage source/config archives were created outside deployment paths and passed archive-integrity and source-tree comparison checks. A disposable rollback simulation restored Bridge source files from the archive while preserving a synthetic current `.env` and an unrelated file, and removed only the Gateway candidate files. This verifies file recovery only: production service stop/restart and health rollback were not exercised. The systemd unit file is not directly readable in this session, and both non-interactive sudo and the Polkit unit-management authorization check denied restart access. Do not deploy until a privileged, target-specific recovery path is available and verified. Exact archive locations remain in the host-private manifest; environment values are not in Git or public docs.

## Preparation before any release

- Record the previous code artifact and matching `mcp-servers.json` revision, service config revision, and secret *names* only.
- Confirm the previous version can use the existing Bridge and Sage layouts and preserves `/agent/task`, `/prayer-times`, and `/prayer-times/direct-test`.
- Keep recovery access to secret values in the approved secret manager; do not export or include them in a rollback note.
- Agree on rollback trigger, operator, platform controls, and a safe, authorized read-back. If recovery is untested or unknown, do not release.

## Revert sequence

1. Stop rollout or route traffic away using the platform owner's verified control.
2. Restore the previous code and its matching config together; do not combine incompatible revisions.
3. Restore service environment through the approved secret manager without changing or printing secret values.
4. Apply the platform-specific recovery procedure and inspect sanitized process/status output.
5. Verify authentication is enforced and only owner-expected MCP tools are visible; verify existing endpoints only through authorized safe checks.
6. Record version identifiers, time/operator, sanitized status, and remaining impact. Leave the reverted version active pending diagnosis.

If credential exposure is suspected, rollback alone is insufficient: follow the approved rotate/revoke and incident process. Never disable authentication or widen allowlists to restore service. This document has not been exercised against production.
