# Internal roadmaps

| Doc | What it is | Update cadence |
|---|---|---|
| [AISentinelVision.md](./AISentinelVision.md) | Strategy: north star, capabilities, trust commitments, competitive positioning for the Sentinel AI SRE | Quarterly review (competitive claims are date-stamped) |
| [AISentinelExecution.md](./AISentinelExecution.md) | Living tracker: per-item build status with code entry points, safety gates, phase checklists with exit criteria, GTM calendar, deviations log | **With every PR that changes AI/Sentinel behavior** |
| [CodeFixSandboxDesign.md](./CodeFixSandboxDesign.md) | Design: the two-tier code-fix verification & sandbox plan (B4) — Tier 0 metered in-house agent, Tier 1 customer-CI verify, Tier 2 ephemeral sandbox | Frozen once implemented; revisit at Tier 2 |

Convention: if you change behavior under `Common/Server/Utils/AI/` (or `AIAgent/`), update the status row in the execution doc in the same PR. Stale status is worse than no status.

*(`AISentinelReliabilityBrain.md` was split into these two documents in July 2026 — the vision half had not drifted, the execution half was stale on arrival.)*
