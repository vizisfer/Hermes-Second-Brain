# PostgreSQL backup and isolated test restore

Run `scripts/backup-postgres.sh [OUTPUT_DIR]`. The script uses the explicitly
named `agentsfer-second-brain` Compose project and `compose.yaml`, reads the
configured database name inside its `postgres` service, and runs `pg_dump`
inside the container; no host PostgreSQL port, host client, or secret shell
variables are required. It writes a uniquely named UTC-timestamped
custom-format dump under `backups/` by default, uses mode 0600, and refuses to
replace an existing artifact. Protect backups as sensitive data.

Before restore, provision a **new, empty, disposable `restore_test_*` database
inside this dedicated Compose project's PostgreSQL service**. Set only
`PGRESTORE_TEST_DATABASE` to that database name and run
`scripts/restore-postgres-test.sh backups/<dump-file>`. The script targets the
explicit Compose project and service, streams the archive to `pg_restore`, and
never creates, drops, cleans, or overwrites a database. Do not point it at a
database containing needed data. The target must be empty. On failure, inspect
the isolated target; never auto-clean it. These scripts do not verify
application-level compatibility or local state outside PostgreSQL.
