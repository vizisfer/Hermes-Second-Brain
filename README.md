# Agentsfer Hermes Second Brain

Version-controlled monorepo for the existing Agentsfer Second Brain deployment and the Sage Universal MCP Gateway release candidate.

## Components

- `apps/document-manager/` — existing localhost-only document manager UI/API. It forwards uploads to Hindsight's file-retain API; no user document or job database is included.
- `services/hermes-bridge/` — Gateway release candidate integrated with the legacy Hermes Bridge routes. The production baseline is preserved separately in `release-baselines/production/hermes-bridge/`.
- `services/voice-infrastructure/` — Sage Voice release candidate with the opt-in MCP catalog and existing Secure Tool Broker. The production baseline is preserved separately in `release-baselines/production/voice-infrastructure/`.
- `integrations/hermes-plugin/` — existing per-profile Hermes ↔ Hindsight memory-provider plugin.
- `infrastructure/docker/agentsfer-second-brain/` — existing pinned Compose deployment, PostgreSQL init SQL, and backup/restore scripts. Hindsight is an upstream pinned image; its source and memory data are not vendored.
- `docs/gateway/` — Gateway design, test, security, deployment, and production-discovery records.

The `services/voice-infrastructure` directory name preserves the Gateway's existing sibling-path contract with `services/hermes-bridge`; no broad application refactor was performed.

## Safety

Production source snapshots are unversioned baselines recorded at import time. Gateway files are a separate release candidate from the isolated development worktrees. Nothing in this repository is a deployment instruction until the release gates in `docs/operations/deployment-status.md` are satisfied.

Secrets, `.env` files (except reviewed `.env.example` templates), local configuration, database files, Hindsight memory-vault data, user documents, backups, logs, generated dependencies, and build artifacts are excluded by `.gitignore`. Do not add production secrets or user memory/document data.

## Targeted validation

From `services/hermes-bridge/`:

```sh
node --test --test-timeout=30000 test/*.test.mjs
```

From `services/voice-infrastructure/`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test -- --test-timeout=30000
```

For the Second Brain UI and Hermes plugin, use their component READMEs for focused checks. Do not run deployment scripts against production as part of routine tests.

## Provenance and current release state

See `docs/architecture/source-provenance.md`, `docs/security/repository-security.md`, and `docs/operations/deployment-status.md`. Do not describe a local commit as published until GitHub confirms the remote read-back.
