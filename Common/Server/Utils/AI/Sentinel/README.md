# Sentinel — autonomous investigation engine

Wake-on-signal AI SRE: when an incident or alert is created (and the project has opted in), Sentinel runs a read-only, budgeted, citation-minting investigation over the project's own telemetry and posts a root-cause analysis to the subject's feed, with a glass-box `AIRun`/`AIRunEvent` trail behind a live dashboard panel.

- `SentinelInvestigationEngine.ts` — shared run lifecycle, budgets, persona, quiet-mode confidence gate
- `IncidentInvestigationRunner.ts` / `AlertInvestigationRunner.ts` — per-subject context assembly + result posting
- `IncidentPostmortemRunner.ts` — auto-draft postmortem when an incident resolves
- `SentinelMemory.ts` — recurrence context from past resolved incidents (retrieval-only v1)

**Roadmap & status:** [Internal/Roadmap/AISentinelExecution.md](../../../../../Internal/Roadmap/AISentinelExecution.md) (tracker — update it in the same PR when you change behavior here) and [Internal/Roadmap/AISentinelVision.md](../../../../../Internal/Roadmap/AISentinelVision.md) (strategy).
