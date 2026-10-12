# Repository Security Rules

## Never commit

- `.env`, live API keys, bearer tokens, passwords, provider credentials, auth caches, private/SSH keys, or production secret-bearing local config.
- Hindsight/PostgreSQL data, memory vaults, user documents/uploads, local job databases, test dumps, or backups.
- Node/Python dependency trees, runtime logs, caches, or build output.

The root `.gitignore` excludes these classes and allows only reviewed `.env.example` templates. `config.json` is local-only; use reviewed examples with placeholders. Do not rely on ignore rules alone: inspect staged paths and run the secret scan before every commit.

## Gateway production policy

- Only the explicit public AlAdhan read-only tool `aladhan__timings` is intended for initial exposure.
- Private, account-specific, tenant-specific, sensitive-read, write, destructive, and arbitrary MCP execution remain disabled.
- Gateway calls require the existing Bridge Bearer authentication and exact server-side allowlist. Sage uses an explicit service principal with no `tenantId`; session binding and room names are not end-user identity. The broker denies tenant-bound capabilities to service principals. Do not use this candidate for private-data authorization.
- Preserve existing `HERMES_BRIDGE_TOKEN` and LiveKit `HERMES_GATEWAY_TOKEN`/`HERMES_GATEWAY_URL`; never print or rotate them as part of this import.

## Secret scanning

Before staging/committing, verify `.env` and user data paths are absent from `git status`, inspect `git diff --cached --name-only`, and run available high-confidence scanners. Report only rule/path/line metadata for any finding; never echo matched values. Treat test-fixture token strings as synthetic only after confirming they are hard-coded placeholders and not production credentials.
