# Sentinel — Execution Tracker

> The **living** companion to [AISentinelVision.md](./AISentinelVision.md). Vision says why; this doc says what is built, what is next, and what gates what.
> **Rule:** any PR that changes behavior under `Common/Server/Utils/AI/` (or the legacy `AIAgent/`) must update the relevant status row and, if it re-sequences work, add a line to the Deviations log. Stale status is worse than no status.
> Status last verified against the codebase: **2026-07-11**.

---

## 1. Status snapshot

Legend: ✅ Shipped · 🟡 Partial · ❌ Not started · 🔪 To be removed/absorbed

### Phase 0 — Action belt (chat surface)

| Item | Status | Code entry point |
|---|---|---|
| Mutating action-belt tools (9 shipped): `create/acknowledge/resolve_incident`, `acknowledge/resolve_alert`, `page_on_call_policy`, `run_runbook`, `post_incident_status_update`, `change_incident_severity` | ✅ | `Common/Server/Utils/AI/Toolbox/Index.ts` (registration + `isMutationTool` gate), `SentinelActionTools.ts`, `IncidentWriteTools.ts`, `AlertWriteTools.ts` |
| Permission-mode gating of mutations (ReadOnly / AskForApproval / AutoRun) + approval/resume flow | ✅ | `Common/Types/AI/AIChatPermissionMode.ts`, `Common/Server/Utils/AI/Chat/ChatAgentRunner.ts` |
| `change_monitor_status` tool | ❌ | — |
| `draft_postmortem` chat tool (auto-postmortem-on-resolve shipped separately, see Phase 3 pull-forwards) | ❌ | — |
| Generic `set_incident_state` (ack/resolve shipped; arbitrary state transitions not) | ❌ | — |

### Phase 1 — Investigation Engine

| Item | Status | Code entry point |
|---|---|---|
| Shared investigation engine: `AIRun(Investigation)` lifecycle, ordered `AIRunEvent` glass-box trail, budgets (8 LLM calls / 12 tool calls / 150s / 2000 output tokens), heartbeats, branded cited output | ✅ | `Common/Server/Utils/AI/Sentinel/SentinelInvestigationEngine.ts` |
| Wake-on-incident trigger — since 2026-07-10 records durable intent (Queued AIRun) via `SentinelInvestigationQueue` before any expensive work; pod restarts can no longer orphan an investigation (D2 closed) | ✅ | `Common/Server/Services/IncidentService.ts` (`onCreateSuccess`) → `Sentinel/IncidentInvestigationRunner.ts` → `Sentinel/InvestigationQueue.ts` |
| Wake-on-alert trigger — same durable-queue path, after the severity/dedupe gates | ✅ | `Common/Server/Services/AlertService.ts` (`onCreateSuccess`) → `Sentinel/AlertInvestigationRunner.ts` → `Sentinel/InvestigationQueue.ts` |
| Read-only enforcement for autonomous runs (hardcoded ReadOnly mode; curated toolbox only, MCP tools never wired in) | ✅ | `Common/Server/Utils/AI/Chat/ObservabilityAssistant.ts` |
| Per-project opt-in: `enableAi` + `enableAutomaticIncidentInvestigation` + `enableAutomaticAlertInvestigation` (two flags, both default **false**) + LLM-provider check | ✅ | `Common/Models/DatabaseModels/Project.ts`, `SentinelInvestigationEngine.isEnabledForProject()` |
| AI settings pages (incidents, alerts) | ✅ | `App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings.tsx`, `.../Alerts/Settings/AlertAISettings.tsx` |
| Investigation read API (incident + alert) + live "watch it think" panel (2.5s polling), shared across both subjects; failed runs show `errorMessage` detail | ✅ | `Common/Server/API/AIInvestigationAPI.ts`, `App/FeatureSet/Dashboard/src/Components/Sentinel/InvestigationPanel.tsx` |
| Quiet mode v1 — deterministic inconclusive detection suppresses the workspace ping (pulled forward from Phase 2; regex-over-prose, must be replaced — see Safety gate G6) | 🟡 | `SentinelInvestigationEngine.ts` (`INCONCLUSIVE_RE`) |
| `baseline_anomaly` read tool — judges a metric's 15-min average against its hour-of-week baseline band (mean ± σ·stddev via `sigmaForSensitivity`); explicit "insufficient baseline data" on cold start; band-chart widget gives `getBandSeries`/`getCoverage` their first callers; investigation persona references it | ✅ | `Common/Server/Utils/AI/Toolbox/MetricTools.ts` (`BaselineAnomalyTool`), tests in `BaselineAnomalyTool.test.ts` |
| Alert-side investigation API endpoint + dashboard panel | ✅ | `POST /ai-investigation/alert` in `AIInvestigationAPI.ts`; shared `Sentinel/InvestigationPanel.tsx` mounted on the alert view *(shipped as a single POST mirroring the incident route — the checklist's "GET/POST" wording was inaccurate)* |
| Alert severity/rate gating — severity floor (explicit per-project minimum via `Project.alertInvestigationMinimumSeverityId`, default = top two tiers) + 30-min per-monitor dedupe window (`AIRun.monitorId`) | ✅ | `AlertInvestigationRunner.shouldInvestigateAlert`, settings UI in `AlertAISettings.tsx`, tests in `SentinelAlertGating.test.ts` |
| RCA also written as incident internal note (bot-authored, created with `ignoreHooks` + `isOwnerNotified` so the quiet-mode-gated RootCause feed item stays the single notification source — no duplicate announcement, no owner page) | ✅ | `Sentinel/IncidentInvestigationRunner.ts` (postAnalysis) |
| **Cost guardrails — Phase 1 exit blockers, see §3** — storm dedupe ✅ (30-min per-monitor window), per-project concurrency cap ✅ (3 concurrent), daily autonomous token budget ✅ (`Project.aiDailyAutonomousTokenLimit`, quiet-skip at run start + hard backstop in `executeWithLogging`, `LlmLogStatus.BudgetExceeded`); kill switch = the default-false opt-in flags (stops new runs; does not abort in-flight) | ✅ | `AlertInvestigationRunner.ts`, `SentinelInvestigationEngine.ts`, `AIService.getAutonomousDailyBudgetStatus`, `LlmLogService.getTotalTokensUsedSince` |

### Pulled forward from later phases (first cuts shipped early)

| Item | Original phase | Status | Code entry point |
|---|---|---|---|
| Auto-postmortem on incident resolve (never overwrites an existing note) | 3 | ✅ | `Common/Server/Utils/AI/Sentinel/IncidentPostmortemRunner.ts`, triggered from `Common/Server/Services/IncidentStateTimelineService.ts` (~line 564) |
| Episodic recurrence memory v1 — retrieval-only, monitor/label overlap over resolved incidents' `rootCause`; no persisted case store, incident-only | 4 | 🟡 | `Common/Server/Utils/AI/Sentinel/SentinelMemory.ts` |

### Platform substrate (relevant existing assets)

| Item | Status | Code entry point |
|---|---|---|
| LLM gateway: multi-provider (incl. keyless local Ollama), metered via `LlmLog` (feature, tokens, cost, billing) | ✅ | `Common/Server/Utils/LLM/LLMService.ts`, `Common/Server/Services/AIService.ts` |
| Prompt caching (Anthropic `cache_control`; OpenAI/Azure `cached_tokens` accounting) — **contrary to the original roadmap, this is done**; `cachedInputTokens`/`cacheCreationTokens` persisted to `LlmLog` since 2026-07-10 and shown in the AI Logs table | ✅ | `Common/Server/Utils/LLM/LLMService.ts` (~654 and ~247), `AIService.executeWithLogging`, `LlmLogsTable.tsx` |
| Token streaming (SSE) | ❌ | `LLMService.ts` hardcodes `stream: false` (~818) |
| Planner/synthesizer model routing | ❌ | one provider/model per call via `LlmProviderService` |
| Stale-run sweeper: since 2026-07-10 REQUEUES heartbeat-stale investigation runs while retry attempts remain (marks Stale only when out of attempts); chat runs marked Stale as before | ✅ | `App/FeatureSet/Workers/Jobs/AIChat/TimeoutStuckRuns.ts` → `SentinelInvestigationQueue.requeueOrMarkStale` |
| Durable claimable AIRun queue + checkpoint/resume — shipped 2026-07-10 (DB-claim on AIRun rows: `Queued` status, `attemptCount`, CAS claims, inline kick + every-minute poller `ProcessQueuedInvestigations`, 30-min TTL, G9 retry policy: transient requeues / permanent finalizes) | ✅ | `Common/Server/Utils/AI/Sentinel/InvestigationQueue.ts`, tests in `SentinelInvestigationQueue.test.ts` |
| Topology graph (product feature): `TelemetryEntityRelationship` model, `DependsOn` edges from span parent/child every 10 min, co-occurrence edges, read-only UI | ✅ | `Common/Models/DatabaseModels/TelemetryEntityRelationship.ts`, `App/FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies.ts` |
| Topology graph consumed by Sentinel (blast radius, causation ordering) — `get_service_dependencies` read tool with entity-key→name resolution; the investigation persona directs the model to check upstream causes / downstream blast radius | ✅ | `Common/Server/Utils/AI/Toolbox/TopologyTools.ts`, tests in `TopologyTool.test.ts` |
| Metric baselines: `MetricBaselineHourly` + `getBaseline`/`sigmaForSensitivity` consumed by anomaly monitors; `getBandSeries`/`getCoverage` currently caller-less | ✅ | `Common/Server/Services/MetricBaselineService.ts`, `Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria.ts` |
| Egress redaction of tool results (JWTs, bearer/AWS/git tokens, credential patterns) | ✅ | `Common/Server/Utils/AI/Toolbox/Serializer.ts` |
| Per-run egress manifest | 🟡 chat only | `ChatAgentRunner.ts`; autonomous Sentinel runs record `AIRunEvent`s but no manifest |
| MTTR raw metrics (TimeToAcknowledge/TimeToResolve per incident) — no `aiInvestigated` dimension, no time-to-RCA metric | 🟡 | `Common/Server/Services/IncidentService.ts` (~2971), `Common/Types/Incident/IncidentMetricType.ts` |

### Legacy AIAgent (FixException) — 🔪 to be absorbed

| Item | Status | Code entry point |
|---|---|---|
| Standalone worker still fully deployed (compose, Helm, KEDA) with OpenCode CLI shell-out | 🔪 running in prod | `AIAgent/`, `docker-compose.base.yml`, `HelmChart/Public/oneuptime/templates/ai-agent.yaml` |
| `get-pending-task` double-processing race — fixed via atomic Scheduled→InProgress claim (status-guarded `updateOneBy`, bounded retry over next candidates; CAS pattern generalized from `ChatAgentRunner.ts`). Worker's follow-up InProgress update kept as a no-op refresh for rolling-upgrade compat with pre-claim servers | ✅ | `AIAgentTaskService.claimNextScheduledTask`, `Common/Server/API/AIAgentTaskAPI.ts` (`get-pending-task`), tests in `Common/Tests/Server/Services/AIAgentTaskServiceClaim.test.ts` |
| Git/PR/workspace plumbing to keep (fold into future `code_fix` tool; GitHub-only today, generalize via `CodeRepository.repositoryHostedAt`) | ✅ exists | `AIAgent/Utils/PullRequestCreator.ts` and related |

---

## 2. Safety gates

The vision doc's §6 commitments, tracked honestly. **None of the first four are met today** — mutations shipped ahead of them under interim mitigations. Each gate names what it blocks: that work does not ship until the gate is green.

| # | Gate (vision §6 commitment) | Status | Interim mitigation in force | Blocks |
|---|---|---|---|---|
| G1 | Policy gateway (risk tiers, blast-radius limits, remediation-storm circuit breaker, capability-scoped tokens) | ❌ NOT MET | Tool-level `requiredPermissions` RBAC; per-conversation permission modes; per-turn budgets; 45s tool timeout; autonomous runs hardcoded ReadOnly | Any autonomous mutation; any default-on AutoRun; Phase 3 remediation features |
| G2 | Undo / counterfactual dry-run per mutation | ❌ NOT MET | AskForApproval mode shows the tool call before execution | Phase 2 exit; marketing any "reversible by design" claim |
| G3 | Accuracy-scored autonomy graduation (eval harness + thresholds) | ❌ NOT MET | AutoRun is a manual, per-conversation, human choice — never a default | Any autonomy expansion; public accuracy scorecard; page-delay pilot |
| G4 | Cost guardrails: per-project concurrent-investigation cap, per-feature budget **enforcement**, storm dedupe, project kill-switch | ✅ MET (2026-07-10) | Storm dedupe (30-min per-monitor window), concurrency cap (3/project), severity floor, and daily autonomous token budget (quiet-skip at run start, fail-closed backstop in `executeWithLogging`) all enforced. Residuals, tracked honestly: budget is one per-project autonomous pool (not per-feature); no default limit ships until Q4 sets plan quotas — so **cloud default-on still waits on Q4**; kill switches = opt-in flags or daily limit 0 (both stop new runs; neither aborts in-flight ones) | ~~Phase 1 closeout~~ satisfied for closeout; default-on anywhere still needs Q4 quota defaults |
| G5 | Egress manifest on all autonomous runs + documented cloud egress/DPA posture + redaction beyond tool results | 🟡 PARTIAL | `Serializer.ts` redaction on tool results; manifest on chat runs; self-host/BYO-LLM = zero third-party egress | SOC2/enterprise packaging; "no training on your data" claim for cloud tenants |
| G6 | No control-flow from free-form prose (structured, server-verified confidence signals) | ❌ NOT MET | Quiet mode uses `INCONCLUSIVE_RE` regex over model prose — forgeable by prompt injection via telemetry; today it only gates a workspace ping (fail direction: louder, not silent) | Page-delay (§4.6); hypothesis VALIDATED/INVALIDATED labels; any decision more consequential than a ping |
| G7 | Page-suppression safety contract (delay-never-cancel, dead-man's switch, per-service opt-in, suppression-precision reporting, mandatory review queue) | ❌ NOT MET (feature not built) | Feature does not exist; do not build without this contract | All of §4.6 |
| G8 | Audit-trail lifecycle: configurable `LlmLog` retention + restrict prompt/response preview reads to admin-tier; same review for `AIRunEvent` payloads | 🟡 PARTIAL | Since 2026-07-10 NO path stores prompt/response previews: chat/investigations already opted out, and the five one-shot endpoints + auto-postmortem now do too (their prompts embed content with narrower ACLs than LlmLog). Retention remains hard-coded 3-day on cloud / indefinite self-host — the configurable, access-tiered lifecycle is still open | Enterprise/SOC2 packaging |
| G9 | Failure semantics per capability (pages fail open; mutations/comms fail closed; verification fails to "unverified"; failures visibly surfaced) | 🟡 PARTIAL | Investigation failures mark the AIRun `Error` and log; since 2026-07-10 the investigation panel (incident + alert) shows the run's `errorMessage` detail on failure; still nothing posted to the feed or workspace | Phase 3 verify/rollback; §4.9 comms |
| G10 | Memory safety (tenant isolation at storage layer, provenance + review on writes, quarantine/expiry, retrieved-memory-as-untrusted) | 🟡 N/A today (memory v1 is read-only, project-scoped, stores nothing) | `SentinelMemory.ts` scopes by `projectId`, no writes | Phase 4 persisted cases, pgvector RAG, correction memory, runbook registry |

---

## 3. Phases (re-baselined 2026-07-10)

Ordering changed from the original roadmap — rationale in the Deviations log. Each item is a checkbox with a binary definition of done; a phase exits only when its checklist and its named gates are green.

### Phase 1 closeout — finish and harden what shipped ← **CURRENT**

- [x] `baseline_anomaly` read-only tool registered in the Toolbox and exercised in a Sentinel run (wraps `MetricBaselineService.getBaseline`/`sigmaForSensitivity`; also gives `getBandSeries`/`getCoverage` their first callers) *(shipped 2026-07-10; "exercised in a Sentinel run" pending the production dogfood — the persona now instructs the model to use it)*
- [x] `POST /ai-investigation/alert` + alert-side investigation panel merged *(shipped 2026-07-10; panel generalized to `Sentinel/InvestigationPanel.tsx`, failed runs now surface `errorMessage` detail on both subjects — the panel half of the Phase 2 G9 item)*
- [x] Alert severity/rate gating: investigations only for alerts meeting a per-project severity floor, with a per-monitor/episode dedupe window *(shipped 2026-07-10: default floor = top two tiers, per-project override, 30-min per-monitor window — Q2 answered)*
- [x] **G4 cost guardrails (exit blocker):** at most one active investigation per monitor/episode per window; per-project concurrent-investigation cap; per-feature daily token/cost budget enforced in `AIService.executeWithLogging`; project-level autonomous-runs kill switch *(shipped 2026-07-10 — budget is one per-project pool over the autonomous features rather than per-feature (split when more autonomous features exist); default = no limit until Q4 sets plan quotas; kill switch = the default-false opt-in flags, which stop new runs but do not abort in-flight ones)*
- [x] RCA posted as incident internal note in addition to the feed item (or the Appendix claim formally dropped — decide, don't drift) *(decided + shipped 2026-07-10: note is bot-authored with no duplicate announcement; alert-side note parity is an optional follow-on, not claimed)*
- [x] Persist `cachedInputTokens` to `LlmLog` for cache-hit visibility *(shipped 2026-07-10: `cachedInputTokens` + `cacheCreationTokens` columns, written in `AIService.executeWithLogging`, cached count shown in the AI Logs table)*
- [x] **Standalone patch, ships independently:** atomic-claim CAS fix for `get-pending-task` in `Common/Server/API/AIAgentTaskAPI.ts` *(shipped 2026-07-10: `AIAgentTaskService.claimNextScheduledTask`)*
- [x] Docs page (`Docs/Content/en/...`): opt-in flags, quiet mode, budgets, BYO-LLM/Ollama setup — the shipped flagship currently has **zero** user docs *(shipped 2026-07-10: `en/ai/sentinel.md` covering enablement, quiet mode, all five cost controls, trust guarantees, and the auto-postmortem; nav entry + cross-link from the LLM Providers page; English-only day one — locale fallback covers the other languages until translated)*
- [ ] Measured exit: median trigger→RCA-posted < 3 min over ≥20 real investigations on our own production project

### Phase 2 — Durability, measurement, trust UX

**Hard rule: the durable queue lands before any new autonomous trigger (predictive sweep, storm collapse, anything).**

- [x] Durable claimable AIRun queue: atomic claim, checkpoint/resume, restart-safe; replace the detached triggers in `IncidentService.onCreateSuccess` / `AlertService.onCreateSuccess`; generalize the CAS + `pausedState` pattern from the chat approval-resume path; retry policy for transient failures (G9) *(shipped 2026-07-10 as `SentinelInvestigationQueue` — Q1 decided: DB-claim on AIRun rows (new `Queued` status + `attemptCount`), enqueue-before-work + inline kick + every-minute poller + requeue-on-stale + 30-min queue TTL. Checkpointing is at attempt granularity (re-run from top — safe, runs are read-only); mid-run message-level checkpointing deferred until something needs it. D2 residual closed.)*
- [ ] Measurement plumbing (feeds vision §8 metrics and G3): human verdict field on `AIRun` (confirmed/edited/rejected) captured via one-click control on the investigation panel; on-resolve grading job comparing the top hypothesis to `Incident.rootCause`/postmortem; `time-to-rca` incident metric; `aiInvestigated` dimension on incident metrics; internal before/after MTTR report
- [ ] Eval harness bootstrap (G3): golden-incident corpus from real resolved incidents (≥50), offline replay from recorded `AIRunEvent` trails, scored on top-hypothesis precision / citation-grounding / tool-selection / inconclusive-recall
- [ ] Replace `INCONCLUSIVE_RE` with a structured, server-verified confidence signal (G6) — constrained classification call or deterministic checks over cited evidence
- [ ] Minimal policy gateway v1 (G1): per-tool risk tiers + mutation-rate circuit breaker
- [ ] Undo + dry-run for undoable mutations; irreversible-action labeling for the rest (G2)
- [x] Topology consumption (pulled from Phase 4 — graph is already built): `get_service_dependencies` read tool + blast-radius/dependency context injected into investigations *(shipped 2026-07-10; context is PULLED on demand — the persona directs the model to the tool — rather than pushed into every context summary: zero token cost when topology is irrelevant to the signal. Revisit push-injection if graded runs show the model under-uses it)*
- [ ] Event-level push (SSE or long-poll over `AIRunEvent`s) to kill the 2.5s panel poll — **token-level streaming deferred** until after the queue, so the transport is designed once against the claimed-run model (the original "load-bearing for the demo" claim is obsolete: the shipped panel already narrates)
- [ ] HypothesisBoard + CausalChain widgets with deterministically-earned labels (G6 applies)
- [ ] `LlmLog` retention + preview-access tiering; ~~`storeContentPreviews: false` on postmortem/one-shot endpoints~~ *(preview half shipped 2026-07-10 — all five one-shot endpoints + the auto-postmortem path now set it false; retention/access-tiering still open)* (G8)
- [ ] Egress manifest extended to autonomous runs (G5)
- [ ] Surface failure *detail* for failed/stale investigations — ~~errorMessage/stale reason in the panel~~ *(panel half shipped 2026-07-10 with the alert-panel work)* plus a quiet feed marker (G9) — feed marker still open
- [ ] Remaining Phase 0 tools: `change_monitor_status`, `draft_postmortem`, generic `set_incident_state`
- [ ] Activation: discovery banner on incident view for projects with `enableAi=true` but investigation flags off; changelog + blog post

### Phase 3 — Proactive detection, active verify, legacy absorption

- [ ] Pre-incident detection as **anomaly-monitor-triggered investigation enrichment** — existing anomaly monitors fire, Sentinel investigates proactively; explicitly NOT a second anomaly cron (original BUILD note stands); gated on the queue + circuit breaker
- [ ] Alert-storm collapse ("47 alerts, 1 root cause") — rule-based grouping + AI root-cause grouping, on the queue
- [ ] Active verification: re-run the exact failed probe/synthetic monitor on demand; report "verified recovered" / "unverified" only (G9)
- [ ] Deterministic deploy correlation + one-click rollback of the identified release
- [ ] Confidence-gated page **delay** pilot — only under the G7 contract, only after G3/G6 are green, opt-in per service
- [ ] Auto-postmortem hardening (shipped early): move onto the durable queue; human-review affordance
- [ ] **KILL/ABSORB milestone for legacy AIAgent:** freeze new legacy-handler development now; cut the TelemetryException enqueue over to the unified runtime when `code_fix` ships; remove compose/Helm/KEDA wiring; until absorbed, the legacy agent is explicitly exempt from the §6 trust claims and marketed accordingly
- [ ] Weekly "made your software better" digest

### Code-fix track (split out — runs parallel to Phases 3–4; the largest lift in the roadmap)

- [ ] **Design spike first, before any code:** per-repo CI sandbox — isolation model, resource limits, secrets handling, air-gapped behavior, multi-tenant cost
- [ ] In-house `LLMService` coding sub-agent replaces the OpenCode CLI shell-out; reuse `RepositoryManager`/`PullRequestCreator`/`WorkspaceManager` plumbing
- [ ] Regression test generated from the real production error; build/test/lint verify loop until green
- [ ] GitLab support (honor `CodeRepository.repositoryHostedAt`)

### Phase 4 — Memory, multi-agent, graduated autonomy

- [ ] Persisted episodic case store (root cause + citations + fix linkage) + similarity retrieval; recurrence short-circuit — under G10
- [ ] pgvector RAG + temporal knowledge graph over postmortems/runbooks/service descriptions — under G10
- [ ] Human-correction memory (edited updates, rejected hypotheses, fixed PRs) — provenance + review gates (G10)
- [ ] Orchestrator-worker parallel hypotheses (needs planner/synthesizer model routing; ~15× token fan-out needs G4 budgets)
- [ ] Runbook-authoring flywheel (human-review gated)
- [ ] Per-problem-type accuracy scoring gates AutoRun (G3 green); public Agent Accuracy scorecard
- [ ] Moonshot lane: reliability-debt backlog, community runbook/skill registry (signing + review, G10), "Sentinel watching Sentinel" public dashboard, enterprise packaging (SOC2, air-gapped, SSO, per-team RBAC/audit — needs G5/G8)

---

## 4. GTM lane (dated — paced to the Opsgenie wedge)

Opsgenie EOL is **April 5, 2027**; migrating teams choose destinations 6–18 months ahead, i.e. **through late 2026**. JSM+Rovo and incident.io are actively courting this cohort.

| Target | Deliverable |
|---|---|
| Q3 2026 | Sentinel user docs + changelog/blog for the shipped investigation engine (currently dark: flags default off, zero docs) |
| Q3 2026 | BYO-LLM / local-Ollama / air-gapped story published; demo asset for the flagship "watch it think" panel |
| Q4 2026 | **Opsgenie importer** (schedules, escalation policies, routing rules) — post-EOL data is deleted, so the importer must exist while there is still data to import |
| Q4 2026 | Rewrite the Opsgenie compare page around the AI-SRE story ("migrate to an on-call platform that diagnoses before it pages") — today it does not mention Sentinel (`Home/Utils/ProductCompare.ts`) |
| Q4 2026 | Phase 2 measurement plumbing live on our own production project → first internal MTTR/accuracy numbers |
| Q1 2027 | Alert-storm collapse + quiet mode hardened — the on-call displacement story is credible before the EOL deadline |
| Before any public number | The claim's instrumentation exists (no "30–60% MTTR cut" marketing before cohort attribution ships) |

### Packaging (decision needed — Open question Q4)

- Cloud: autonomous investigations consume metered tokens (`$0.02/1K` per `Home/Utils/Pricing.ts` today, with auto-recharge) — wake-on-every-alert on metered tokens is structurally the "tokenpocalypse" we attack Datadog for. Recommendation: **included monthly investigation quota per plan + BYO-key as the unlimited escape hatch**; per-feature spend caps (G4) are a prerequisite for any default-on.
- Self-host: free AI with your own key — unchanged, and the headline.
- AutoRun tier placement: Enterprise, and only behind G3.

---

## 5. Non-goals

- **MCP `ToolGenerator` tools (~155) will not be exposed to autonomous agents.** Autonomous runs see the curated read-only toolbox, period. (The original "unified behind one `ObservabilityTool` interface" framing is retired — isolation is the feature, not a gap.)
- **No big-bang cutover of the legacy AIAgent.** Absorption per the Phase 3 milestone; the standalone worker keeps running (with the race fixed) until `code_fix` replaces it.
- **No second anomaly-detection scheduler.** Proactive detection triggers off existing anomaly monitors.
- **No public accuracy/MTTR marketing claims before their instrumentation exists.**
- **No page cancellation, ever.** The most Sentinel may do is delay-with-dead-man's-switch (G7).

## 6. Open questions

| # | Question | Owner | Blocks |
|---|---|---|---|
| Q1 | ~~Queue technology~~ **Answered 2026-07-10:** DB-claim pattern on `AIRun` rows. The AIRun row was already the source of truth (status/heartbeat/sweeper existed), the CAS pattern was proven twice (chat resume, AIAgent task claim), it adds no Redis dependency, and it works air-gapped. BullMQ remains available if fan-out throughput ever demands it | eng | ~~Phase 2~~ resolved |
| Q2 | ~~Alert investigation gating defaults~~ **Answered 2026-07-10:** severity floor defaults to the top two tiers (per-project override via Alert AI settings); per-monitor dedupe window = 30 min (constant, configurable later if asked for) | product+eng | ~~Phase 1 closeout~~ resolved |
| Q3 | Structured confidence signal design: second constrained LLM call vs deterministic evidence-count checks (or both)? | eng | G6, Phase 2 |
| Q4 | Cloud packaging: investigation quota sizes per plan; what happens at quota (pause vs degrade to on-demand)? | product | GTM, default-on |
| Q5 | Default-on criterion for new projects: which measured precision bar over how many graded runs? | product | activation |
| Q6 | `LlmLog` retention: should the hard-coded 3-day cloud delete become a configurable default that also covers self-host (which has none)? Which roles may read prompt previews? | eng+security | G8 |
| Q7 | Code-fix sandbox: build on existing Workflow/Worker infra vs dedicated runner pool vs external CI triggers? | eng | Code-fix track |

## 7. Deviations log

| Date | Deviation | Rationale / residual |
|---|---|---|
| 2026-07 | **D1:** Auto-postmortem (Phase 3) and recurrence memory v1 (Phase 4) shipped before Phase 2 | Thin slices on existing substrate ("no-new-storage cut"); residuals — durability (queue) and persisted case store — remain in their original phases |
| 2026-07 | **D2:** Investigations shipped pre-queue as inline detached promises | Accepted orphan-on-restart risk for the additive read-only feature; mitigated only by the 12-min Stale sweep (marks, never resumes). Queue is now the first Phase 2 item and blocks all new autonomous triggers |
| 2026-07 | **D3:** Phase 0 mutations shipped before the policy gateway, undo, and accuracy scoring — violating the original §6 invariants as written | §6 rewritten from present-tense invariants to gated commitments; Safety Gates table (§2) now tracks each gate honestly with its interim mitigation |
| 2026-07 | **D4:** Quiet mode v1 (Phase 2 item) shipped early as a prose-regex | Acceptable while it only gates a workspace ping and fails loud; G6 blocks anything more consequential |
| 2026-07 | **D5:** Roadmap restructured: original `AISentinelReliabilityBrain.md` split into Vision + this tracker | The single doc's execution claims were stale at merge time ("zero implementation" shipped in the same commit); vision content had not drifted at all |

## 8. Changelog

- **2026-07-10** — G8 preview half: `storeContentPreviews: false` on all five one-shot endpoints and the auto-postmortem path. **Also fixed a metering bypass:** `IncidentService.generatePostmortemFromAI` called `LLMService.getCompletion` directly — auto-postmortems were unmetered, unbilled, and invisible to LlmLog; they now route through `AIService.executeWithLogging`.
- **2026-07-10** — Shipped `get_service_dependencies` (topology consumption, Phase 2 item pulled from Phase 4) — see the checked item in §3.
- **2026-07-11** — Queue hardened after adversarial review: (1) claims/transitions now use `AIRunService.attemptStatusTransition` — a single conditional UPDATE — because `updateOneBy` is SELECT-then-save and cannot implement a CAS; (2) the claim also guards on expected `attemptCount`, so attempts can never exceed the max; (3) transient/permanent failure classification is by message (LLMService wraps transient provider errors in `BadDataException` too); (4) `postAnalysis` only fires when the executor WINS the Completed transition (no duplicate RCA if the sweeper falsely requeued a slow run) and heartbeats now touch on every step; (5) the poller claims sequentially but executes detached, keeping the tick inside its job timeout.
- **2026-07-10** — **Phase 2 opened: shipped the durable investigation queue** (`SentinelInvestigationQueue`, Q1 → DB-claim on AIRun rows). Triggers record Queued intent before any expensive work; CAS claims with `attemptCount`; inline kick keeps the 1–3 min latency; every-minute poller drains orphans and expires >30-min queue waits; stale sweeper requeues instead of marking Stale while attempts remain; G9 retry policy (transient requeues, permanent finalizes). D2 residual closed; panel shows the Queued state.
- **2026-07-10** — Shipped the Sentinel user docs page (`/docs/ai/sentinel`): the flagship is no longer dark. Phase 1 checklist is now complete except the measured exit (≥20 production investigations), which starts when the flags go on for our own project. Q3 GTM docs deliverable met.
- **2026-07-10** — Shipped the `baseline_anomaly` read tool: hour-of-week baseline band verdicts (mean ± σ·stddev), cold-start-aware, with an expected-range band chart (first callers for `getBandSeries`/`getCoverage`); the investigation persona now points the model at it.
- **2026-07-10** — RCA now also posted as a bot-authored incident internal note, created with `ignoreHooks` + `isOwnerNotified: true` so the RootCause feed item (quiet-mode gated) stays the single notification source; review caught and reverted an earlier user-less-notes-don't-announce rule that would have silenced SLA note reminders. Also: a daily token limit of 0 now pauses autonomous runs (spend kill-switch) instead of meaning "unlimited".
- **2026-07-10** — Shipped G4 daily budget enforcement: `Project.aiDailyAutonomousTokenLimit` (UTC day, autonomous features only), quiet-skip before run creation, fail-closed backstop in `AIService.executeWithLogging` with `LlmLogStatus.BudgetExceeded`; settings on both AI settings pages. G4 marked MET with residuals noted.
- **2026-07-10** — Shipped alert investigation gating (severity floor defaulting to top two tiers with per-project override; 30-min per-monitor dedupe window via new `AIRun.monitorId`) and the per-project concurrency cap (3) in the shared engine — G4 now partial; Q2 resolved.
- **2026-07-10** — Shipped the alert-side investigation API (`POST /ai-investigation/alert`) + panel; generalized the incident panel into the shared `Sentinel/InvestigationPanel.tsx`; failed investigations now show `errorMessage` detail in the panel (panel half of the Phase 2 G9 surfacing item). Also persisted `cachedInputTokens`/`cacheCreationTokens` to `LlmLog` with AI Logs table visibility.
- **2026-07-10** — Shipped the standalone atomic-claim CAS fix for the legacy `get-pending-task` double-processing race (`AIAgentTaskService.claimNextScheduledTask`); checked off the Phase 1 item and updated the legacy AIAgent table.
- **2026-07-10** — Initial split from `AISentinelReliabilityBrain.md`. Re-baselined all statuses against the tree; added Safety Gates, re-sequenced queue before trigger expansion, pulled topology consumption into Phase 2, split the code-fix track, added GTM lane/packaging, refreshed competitive table (Bits AI GA, incident.io comms, Grafana, Seer, JSM Rovo), corrected the Appendix-era claims (trigger is inline not enqueued; feed-item-only output; two opt-in flags).
