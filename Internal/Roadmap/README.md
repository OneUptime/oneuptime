# Internal roadmaps

| Doc | What it is | Update cadence |
|---|---|---|
| [EmailExperience.md](./EmailExperience.md) | Implemented email noise controls, delivery-time preferences, and recommendations for grouping, summaries, and measurement | When an email experience improvement ships or customer volume data changes priorities |
| [CodeFixSandboxDesign.md](./CodeFixSandboxDesign.md) | Design: the two-tier code-fix verification & sandbox plan (B4) — Tier 0 metered in-house agent, Tier 1 customer-CI verify, Tier 2 ephemeral sandbox | Frozen once implemented; revisit at Tier 2 |
| [CodeFixHarnessAudit.md](./CodeFixHarnessAudit.md) | Audit: end-to-end review of the clone → agent → verify → commit → push → PR harness. What was fixed, what is deliberately left (server-side token scoping and run binding, PR dedup, handler duplication), and where the tests are | When a "Not fixed here" item ships, or the harness changes shape |
| [NetworkObservability.md](./NetworkObservability.md) | Roadmap: shipped network-monitoring baseline + the remaining epics (NCM, IPAM, wireless, forecasting, sFlow/IPFIX, topology history, flap detection, maintenance/status-page relations, sensor tables, flow retention) with design sketches, sizes, and open questions | When an epic starts (spin its section into a design doc) or the shipped baseline changes |
| [OnCallNotificationReadiness.md](./OnCallNotificationReadiness.md) | Plan: why on-call responders with no notification rules/methods silently miss pages, and the four phases to fix it — page fallback + severity backfill, a shared `OnCallReadinessService`, admin visibility/editing of another user's rules, and prevention guards | When a phase ships; Phase 1 (fallback) is the load-bearing one |
