# Hermes ↔ Hindsight Memory Provider

This directory contains the existing profile-scoped Hermes `MemoryProvider` adapter, installer, and unit tests. It supports a separate Hermes profile and Hindsight deployment/bank per tenant. A bank identifier is routing metadata, not authorization; do not use a shared multi-tenant API or infer identity from a bank name.

## Configuration

Use a profile-local configuration with a trusted company identifier, dedicated bank ID, loopback/private API endpoint, bounded recall budget, and timeout. Configure `HINDSIGHT_API_KEY` only through the profile's approved secret store when required. Keep credentials, live company configuration, profile data, and retained memories outside this repository.

`company-config.example.yaml` is a placeholder template. Replace placeholders only in a private profile config; do not commit it after population.

## Behavior

- Recall is bounded and returned as plain supporting text so Hermes core sanitization can fence it safely.
- Retention is limited to explicit durable-memory cues and includes provenance.
- Asynchronous retain uses deterministic operation IDs for idempotency.
- Failure degrades safely; logs must not include credentials, memory text, or response bodies.
- The adapter exposes no delete operation and has no cross-bank fallback.

## Tests

Run focused adapter tests from the repository root:

```sh
PYTHONPATH="$PWD/integrations/hermes-plugin:$HOME/.hermes/hermes-agent" \
  python3 -m unittest discover -s integrations/hermes-plugin/hindsight/tests -v
```

Do not use production memory banks for tests. Use a disposable isolated test bank and synthetic facts when a live integration check is explicitly scheduled.
