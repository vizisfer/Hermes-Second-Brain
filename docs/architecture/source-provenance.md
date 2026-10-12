# Source Provenance and Import Record

Date: 2026-10-12 (UTC)

## GitHub destination

- Remote: `https://github.com/vizisfer/Hermes-Second-Brain.git`
- Repository visibility: public.
- Default branch: `main`.
- Authenticated GitHub checks on 2026-10-12 verified account `vizisfer`, repository default branch `main`, `permissions.push=true`, size 0 KB, and no remote branches/refs before the initial import. No existing remote content was overwritten.
- The repository-local Git author identity was set from the authenticated account using its GitHub noreply address. At this provenance-record update, the 107-path import was staged locally; commit and push had not yet occurred.

## Imported source

| Monorepo path | Source | Provenance |
|---|---|---|
| `release-baselines/production/hermes-bridge/` | Existing production Bridge snapshot | Source directory had no Git metadata. Environment files are excluded from Git and preserved only in the host-private archive. |
| `release-baselines/production/voice-infrastructure/` | Existing production Sage snapshot | Source directory had no Git metadata. Environment files, dependency trees, and generated files (including the transient `.hermes-tmp.*` file) are excluded; private source/config recovery archive retains the production copy. |
| `services/hermes-bridge/` | Isolated Gateway Bridge candidate worktree | Source HEAD `02727463a595282413b0e02714506ff97d91939b` with pre-existing tracked/untracked changes. Candidate source, config, tests, and docs imported; local dependencies and Git metadata excluded. |
| `services/voice-infrastructure/` | Isolated Sage Gateway candidate worktree | Source HEAD `55f21dfd51b613457282c31367c23c38302d12ae` with pre-existing changes. Gateway source, tests, and safe config templates imported; dependencies and Git metadata excluded. Service credentials use the existing deployment configuration; `SAGE_MCP_TOOLS` remains opt-in. |
| `apps/document-manager/` | Existing Second Brain document manager | Local-only UI/API source, tests, docs, and sanitized config example. Live config, uploaded documents, job DB, logs, and caches excluded. |
| `integrations/hermes-plugin/` | Existing Hindsight memory-provider plugin | Source, tests, and generic example config only. Runtime profile/state and secrets excluded. |
| `infrastructure/docker/agentsfer-second-brain/` | Existing Second Brain deployment artifacts | Compose, PostgreSQL initialization, backup/restore scripts, and generic documentation only. Persistent data, backups, `.env`, and memory content excluded. Hindsight source is upstream, not vendored. |

## Production baseline and release candidate distinction

The production source snapshots are not Git revisions; they are preserved as files under `release-baselines/production/` and have a separate protected, timestamped backup archive recorded in `deployment-status.md`. The release candidate under `services/` comes from the Gateway development worktrees and is not production-deployed. Never merge these directories by overwriting a baseline; review diffs and promote a tagged release through staging.

## Existing deployed versions at discovery

- Read-only LiveKit check on 2026-10-12: current/active version `GNPfUghTFNaU` (Available; deployed `2026-10-12T04:36:05Z`); previous version `JyUnXxTPmMUQ` (Available). The agent identifier is retained only in the private host manifest.
- Hindsight 0.10.3 and PostgreSQL/pgvector 0.8.7 are digest-pinned in the existing Compose file. Their persistent data is deliberately not part of this repository.
- The Bridge's active source had no Git commit/revision. Host-specific service and recovery details remain in the host-private deployment manifest.

Exact host paths, service identifiers, and backup locations are retained only in the private host manifest, not this public repository. This file records provenance; it is not a claim that production is ready for deployment.
