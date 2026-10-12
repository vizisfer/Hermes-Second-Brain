# Second Brain Document Manager

A Python standard-library UI/API that forwards PDF, DOCX, TXT, and Markdown uploads to a configured Hindsight file-retain API. It does not parse files itself or create a parallel ingestion pipeline. Hindsight remains the source of truth for processing and chunks; a local SQLite job store holds only manager metadata and is runtime data excluded from Git.

## Configuration and safety

Copy `config.example.json` to local `config.json` and replace the placeholder bank ID for an isolated deployment. Environment overrides are `DOCUMENT_MANAGER_CONFIG`, `DOCUMENT_MANAGER_HOST`, `DOCUMENT_MANAGER_PORT`, `DOCUMENT_MANAGER_DB`, `DOCUMENT_MANAGER_MAX_BYTES`, `HINDSIGHT_URL`, and `HINDSIGHT_BANK_ID`. The UI bootstraps a per-process HttpOnly, SameSite=Strict session cookie; API reads require that cookie, and POST operations additionally require an exact same-origin `Origin`. Keep the bind address at `127.0.0.1` and do not expose it publicly. This browser protection does not replace network isolation. The sample targets loopback Hindsight and is not a production credential/config bundle.

## Run from this monorepo

```sh
cd apps
./document-manager/start.sh
```

Open the loopback UI and health route on port 8765. For remote access, use an SSH tunnel rather than changing the bind address. Runtime data/logs are created beneath the ignored `apps/data/document-manager/` path.

## Focused test

```sh
cd apps
python3 -m unittest discover -s document-manager -p 'test_*.py' -v
```

The app uses only the Python standard library and the configured Hindsight HTTP API. No database or user-document data is stored in this repository.
