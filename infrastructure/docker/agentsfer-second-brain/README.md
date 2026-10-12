# Agentsfer Second Brain Compose deployment

This directory contains the existing digest-pinned PostgreSQL/pgvector and Hindsight Compose definition, safe environment template, database bootstrap SQL, and scoped backup/restore scripts. All credential values are supplied through an ignored local `.env`; the example contains placeholders only. PostgreSQL has no host port, and Hindsight is loopback-bound by Compose. No Hindsight database, bank content, memory vault, user document, or backup is included in Git.

The Hindsight image is upstream; this repository does not vendor its source. Keep the configured release digest pinned and review upgrades separately.

## Local configuration and validation

```sh
cp .env.example .env
# Set unique random database credentials in the private .env file.
docker compose --project-name agentsfer-second-brain -f compose.yaml config --quiet
```

The project currently uses a model-backed Hindsight provider in its live deployment. Do not run retain/recall, recreate containers, or trigger billable inference from this source-only checkout. Existing production data and environment files are not tracked.

## Backup tools

`scripts/backup-postgres.sh` makes a timestamped, mode-0600 custom-format dump. `scripts/restore-postgres-test.sh` restores only into an explicitly provisioned empty disposable `restore_test_*` database; it never creates, drops, or cleans a database. Read `scripts/README.md` before use. These scripts have not been run against a database from this monorepo checkout.
