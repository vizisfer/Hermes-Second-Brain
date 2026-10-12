# P7 — bounded local latency benchmark

Run date: 2026-10-12. Environment: isolated development snapshots, Node v26.8.1. All calls used the same read-only `aladhan__timings` request (`Istanbul`, `Türkiye`) through the existing AlAdhan MCP. Three samples per path, sequential; Gateway was already started and maintained one MCP client connection. No production endpoint/service was queried.

| Path | Samples (ms) | Median (ms) | Notes |
|---|---:|---:|---|
| Existing direct MCP helper (`getPrayerTimesDirect`) | 788.9, 763.9, 787.4 | 787.4 | Creates and closes a new SDK stdio client per request, matching the existing direct endpoint pattern. |
| Universal Gateway warm call | 479.4, 442.0, 460.9 | 460.9 | Reuses its configured MCP client; excludes Gateway/server startup. |
| Hermes CLI + LLM + MCP | Not measured | Not measured | Owner supplied an approximate ~17 s historical figure; no LLM call was made in this task. |

Observed: 3/3 successful samples on each measured path. The warm Gateway median was 326.5 ms below the measured direct helper median in this small sample. These numbers are not a load test, percentile estimate, or statistically reliable production forecast; network/upstream variance applies.

The earlier owner-provided ~1 s direct figure is consistent in scale with this isolated 0.76–0.79 s sample set, but was not independently measured here. No latency conclusion is drawn for the Hermes path. No LiveKit simulation, production smoke test, Twilio call, or extra LLM inference was run.

Resource limits are bounded in code: maximum 16 configured servers, 8 concurrent calls, 8 KiB call arguments, 16 KiB normalized response, and a 30 s tool deadline. Peak RSS, long-duration connection stability, throughput under load, and remote HTTP provider latency were not measured. Stdio persistent clients and safe reconnect-on-next-request are implemented; tool invocations are never automatically replayed.

Reproduce from the isolated Bridge copy with installed sibling Sage dependencies and `VOICE_INFRASTRUCTURE_ROOT` set to the isolated Sage path. The measured execution output is recorded in the session's tool results; no timing values were synthesized.
