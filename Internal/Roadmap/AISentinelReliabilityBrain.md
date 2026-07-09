# OneUptime AI — The Reliability Brain (codename: **Sentinel**)

> The definitive product vision for overhauling OneUptime's AI agents.
> Status: **Phase 0–1 in active development.** Read it, then let's go build it.

---

## 1. The North Star

> **OneUptime becomes the open-source AI SRE that watches everything you own, tells you the root cause before you're paged — with a receipt for every claim — fixes the code, proves the fix held, and makes your software measurably more reliable every single week.**

**The manifesto.** Monitoring told you *something is wrong*. Observability told you *where to look*. The Reliability Brain tells you *why it broke, what to do, and does it* — then closes the loop by turning every incident into a permanent improvement to your software. It never sleeps, it shows its work, it asks before it touches production, and it gets smarter every time it's corrected. It is not a chatbot bolted onto a dashboard. It is a senior on-call engineer that lives inside the one platform that already holds your monitors, logs, metrics, traces, exceptions, incidents, on-call schedules, status page, service catalog, and code repos — and because it's open-source and self-hostable, you can read its mind and run it air-gapped in your own cluster. We are not adding an AI feature. We are flipping OneUptime from *answers when asked* to *watches, decides, and improves on its own*.

---

## 2. Why now / why OneUptime wins

The entire AI-SRE market has converged on one promise — **"root cause before you're paged"** — but every serious competitor is fighting with one hand tied behind their back:

- **Cleric, Resolve, Traversal, incident.io** do sophisticated investigation but **own none of the observability data**. They federate read-only over your Datadog/Grafana/Prometheus, paying a cross-vendor correlation tax on every hop, inheriting each tool's sampling gaps, and burning ~15× the tokens stitching context across silos. Their citations are federated pointers that can rot.
- **Datadog Bits** owns telemetry but **bolts code-fix on**, keeps its AI closed, and prices it as a metered add-on that triggers "tokenpocalypse" spend-shock. It has **no status page** — it structurally cannot close the customer-comms loop.
- **Sentry Seer** owns errors and closes into PRs beautifully — but sees only errors, not full telemetry, on-call, or incidents.
- **Every one of them is a closed box** you cannot audit and cannot run in-network.

**OneUptime's advantage is structural, not incremental:**

1. **It owns the entire data plane in ONE tenant-scoped model** — monitors, logs, metrics, traces, exceptions, incidents, alerts, on-call, runbooks, status pages, service catalog, *and linked GitHub/GitLab repos*. No connector cold-start. No correlation-across-vendors tax. Citations are **live deep-links to data we own**, not dead federated pointers. We can follow one unbroken causal chain: *metric spike → anomalous baseline → new exception fingerprint → the trace that threw it → the release that shipped it → the commit → the fix PR → the status-page post → the postmortem → the memory that short-circuits the next recurrence.* No competitor owns every link.

2. **It's open-source, self-hostable, and BYO-LLM** — including keyless local Ollama already wired into `LLMService`. The reasoning trail is auditable; the LLM keys are yours; the whole thing runs air-gapped. That's a structural "**no third-party training on your data**" guarantee Datadog and Sentry cannot make — and a live-on-stage demo (*unplug the network, run full alert-to-RCA on a laptop*) that is **literally impossible for every named rival.**

3. **The engine is already 80% built and dormant.** `AIRunType.Investigation` is a defined enum with **zero implementation**. `ChatAgentRunner` is a production-grade ReAct loop — budgets, heartbeats, server-minted citations, inline widgets, egress manifest, pause/resume approvals — that today only ever runs `AIRunType.Chat`. The single highest-leverage move in the codebase is giving that runner a non-conversational entrypoint and a wake-on-alert trigger. **We reach "root cause before you're paged" in weeks, not quarters.**

The window is now: incumbents gate AI behind Enterprise paywalls, and **Opsgenie's forced EOL (data must migrate by April 2027)** is pushing teams to re-evaluate. An open-source, AI-native alternative that bundles monitoring + on-call + AI-SRE is a clean, time-boxed displacement wedge.

---

## 3. The core concept: the Reliability Brain

The Reliability Brain is a single **always-on agent runtime** that runs one loop over the data OneUptime already owns:

```
   ┌─────────── WATCH ───────────┐
   │  sensors fire on signal      │
   ▼                              │
HYPOTHESIZE → INVESTIGATE → ACT → VERIFY → LEARN
   │  parallel,   grounded,  gated,  prove   memory +
   │  glass-box   cited      by RBAC it held  runbooks
   └──────────────── improves every incident ┘
```

It is **one runtime that swallows both of today's disconnected half-agents** — the reactive chat copilot and the narrow legacy code-fixer — not a third bolt-on.

### How it reuses what already ships (the 80% head start)

| Existing asset | Role in the Brain |
|---|---|
| `ChatAgentRunner` (ReAct loop, budgets, heartbeats, citations, widgets, egress manifest, pause/resume) | The per-agent engine. Add a **non-conversational entrypoint** + investigation prompt. No rewrite. |
| `ObservabilityAssistant` (headless, read-only, cited agent loop for Slack/Teams) | The exact non-conversational entrypoint to build the Investigation Engine on. |
| `AIService.executeWithLogging` + `LLMService` (7 providers, prompt-cache aware, gen_ai OTel spans) | The single metered gateway. Extend with model routing + streaming. |
| `AIRun / AIRunEvent / AIConversation` + `TimeoutStuckRuns` sweeper | Durable run lifecycle + the glass-box reasoning trail. |
| `AIChatPermissionMode` (ReadOnly / AskForApproval / AutoRun) + `ToolApprovalCard` + resume flow | The graduated-autonomy primitive. |
| `AIToolbox` (curated tools) + MCP `ToolGenerator` (~155 model tools) | The tool belt — unified behind one `ObservabilityTool` interface (with a **hard allowlist** for autonomous agents, see §6). |
| Server-minted `AIChatCitation` + `WidgetBuilder` + `stripFabricatedCitationMarkers` | The grounded-answer trust layer, reused for investigation reports. |
| `IncidentAIContextBuilder`, `AlertAIContextBuilder`, `RecentChangesTool` | Zero-new-code context assembly. |
| `MetricBaselineHourly` + `MetricBaselineService` (getBaseline, getBandSeries, sigmaForSensitivity) | Anomaly substrate — **already computed**, already used by anomaly monitors. |
| Legacy `RepositoryManager` / `PullRequestCreator` / `WorkspaceManager` | Git plumbing for the code-fix loop — reuse; kill the OpenCode shell-out. |

### The two genuinely new primitives

- **A durable, checkpointed run substrate** — replace detached `runTurn().catch()` promises (which orphan on pod restart) with a **claimable AIRun queue with atomic claim** (fixing the legacy `get-pending-task` double-processing race), so long, unattended, restart-safe investigations become possible.
- **Memory + a topology graph** — the "improve over time" engine, sequenced honestly:
  1. **First-party topology graph, day-one, from data we already own.** Derive the service dependency graph from `Span` parent/child edges + `TelemetryEntity` relationships + service-catalog ownership. Gives **blast-radius** and turns correlation into causation *now*.
  2. **Episodic case memory** — every resolved investigation persisted as a retrievable case (root cause + citations + the runbook/PR that fixed it). Recurrence short-circuit via similarity lookup — buildable *before* the full graph.
  3. **pgvector RAG + temporal (valid_at/invalid_at) knowledge graph** — the net-new build, deferred but real, over postmortems/runbooks/service descriptions.

---

## 4. The agent capabilities — before / after

Across the full lifecycle: **Detect → Correlate → Investigate → Remediate → Communicate → Verify → Learn.**

1. **Proactive, pre-incident detection (*left of boom*).** *Before:* static thresholds miss slow regressions; `MetricBaselineHourly` is computed but never drives a proactive investigation. *After:* a scheduled sweep diffs live metrics against their per-hour-of-week band and **opens a cited incident before the alert even trips**.

2. **Wake-on-signal autonomous investigation (headline).** *Before:* 100% of AI runs are human-typed `Chat`. *After:* the instant an incident/alert fires, an `AIRunType.Investigation` run assembles context via `IncidentAIContextBuilder`, runs the tool loop, and posts a **cited root-cause hypothesis into the incident timeline + Slack in 1–3 minutes**.

3. **Glass-box parallel hypotheses.** An orchestrator spawns isolated sub-runs (deploy- / dependency- / resource- / data-caused), each labeled **VALIDATED / INVALIDATED / INCONCLUSIVE** by a **deterministic, server-verifiable check**, never free-form LLM judgment. Rendered as a HypothesisBoard + CausalChain widget.

4. **Deterministic deploy correlation + one-click rollback.** Correlate `ExceptionInstance.release` to the exact deploy and offer **rollback of *that specific release*** — deterministic, not LLM-guessed.

5. **Alert-storm collapse.** The on-call opens their phone to **ONE card: "47 alerts, 1 root cause."** Rule-based grouping plus AI root-cause grouping.

6. **Confidence-gated escalation — "nobody gets woken at 3am."** Because OneUptime **owns on-call schedules**, when RCA confidence is high and blast-radius low, the Brain can **suppress the 3am page**, page the specific **service owner**, or hand a warm, diagnosed incident to the morning shift.

7. **Full incident-command action belt.** ~10 new tools that are **thin wrappers over already-RBAC-tested service methods** — `page_on_call`, `run_runbook`, `set_incident_state/severity`, `change_monitor_status`, `post_status_update`, `draft_postmortem`.

8. **Auto code-fix PR — evolving legacy FixException.** After RCA pins root cause, an **in-house `LLMService` coding sub-agent** reads surrounding logs/traces/spans, writes the fix *plus a regression test built from the real production error*, runs a **build/test/lint verify loop until green**, and opens a reviewable PR on GitHub *or* GitLab. **The biggest genuine engineering lift** — a per-repo CI sandbox is the hidden cost.

9. **Auto customer-comms — the move no observability vendor can make.** Because OneUptime **owns the status page + subscribers**, the same run drafts the customer-facing announcement, queued for one-click human-approved publish.

10. **Active verification — using our own probes as hands.** The Brain **re-runs the exact synthetic monitor/probe that failed** to confirm recovery in seconds, then watches SLO/error-budget + recurrence.

11. **Learn — runbook-authoring flywheel + human-correction memory.** After a successful remediation, the Brain **drafts a versioned Runbook** (gated by human review). Every human correction (edited status update, rejected hypothesis, fixed PR) is captured as durable memory.

12. **On-call copilot + ambient scribe.** Interactive Block Kit approval cards; rolling "catch-up" summaries; automated shift-handoff briefings.

13. **Reliability-debt & cost report — "improve your software over time" made literal.** *"These 5 auto-remediations fired 200× this month → here are the permanent fixes, ranked by toil-hours saved"* — a CFO/eng-leader ROI artifact no observability competitor produces.

---

## 5. The wow moments

**🏆 Flagship — the 60–90-second "holy grail" demo:** On stage, a presenter triggers a checkout error storm. The audience watches the **Investigation panel narrate live** — "Ranking exceptions ✓", "Reading trace ✓ 0.4s", "Checking recent changes ✓ deploy #4821" — and within a minute a **cited hypothesis** plus a **draft rollback** appears, *before anyone touched a dashboard.*

1. **3am, nobody paged yet** — a Slack message that isn't an alert, it's a *diagnosis* with tap-to-approve buttons.
2. **Click a citation, land on the proof** — every claim deep-links to the exact log line / trace span / metric spike.
3. **The air-gapped mic-drop** — unplug the network, run full alert-to-RCA on a laptop with local Ollama.
4. **"47 alerts, 1 root cause."**
5. **The status page writes itself.**
6. **"I've seen this before"** — a recurrence resolves in seconds.
7. **Go to bed red, wake up to a merge-ready PR** with a regression test built from the real failure.
8. **The honesty receipt** — a public **Agent Accuracy scorecard**.
9. **The Friday digest.**
10. **Sentinel watching Sentinel** — a public live dashboard of OneUptime's own production agent's accuracy/cost/traces.

---

## 6. Trust, safety & control

Trust is the entire game — hallucinated overconfidence is the **#1 documented abandonment driver (>30% quit)**. We win it structurally:

- **Show your work, always.** Citations minted server-side *only from executed tool calls*; fabricated `[C#]` markers are stripped. Hypothesis labels earned by deterministic checks, never free-form LLM assertion.
- **Graduated autonomy, earned per problem-type.** ReadOnly → AskForApproval → AutoRun, and a type only graduates once **closed-loop accuracy scoring** crosses a threshold. **Autonomy never precedes measurement.**
- **Reversible by design.** Every mutation ships with a paired **one-click Undo**; counterfactual dry-run previews before approval.
- **The policy gateway ships before any mutation.** Per-action risk tier, per-team RBAC, blast-radius limits, a **circuit breaker that halts on a remediation storm**, capability-scoped tokens per sub-agent.
- **Autonomous agents see a hard allowlist, not all 155 MCP tools.**
- **Full audit trail** — `AIRun / AIRunEvent / LlmLog` + per-run **egress manifest** + `gen_ai.*` OTel spans.
- **Honest uncertainty as an action** — when telemetry is insufficient, the Brain **refuses** and auto-opens an instrumentation-gap ticket.
- **Eval harness dogfooding our own spans** — golden incidents, hallucination + tool-selection scoring, offline run replay.

---

## 7. Architecture & what to build vs reuse vs kill

**REUSE (the 80% head start):** `ChatAgentRunner`, `ObservabilityAssistant`, `AIService`/`LLMService`, `AIRun`/`AIRunEvent`/`AIConversation`, `AIChatPermissionMode` + approval flow, `AIToolbox` + `ObservabilityTool` interface, citation minting + `WidgetBuilder`, all `AIContextBuilder`s, `MetricBaselineService`, the MCP `ToolGenerator`, and the legacy `RepositoryManager`/`PullRequestCreator`/`WorkspaceManager` git plumbing.

**BUILD (net-new, sequenced):**
1. Non-conversational `InvestigationRunner` entrypoint + investigation system prompt.
2. Sensor/trigger layer — incident/alert create hooks + a scheduled anomaly/SLA-risk sweep. **Trigger off existing anomaly monitors — don't build a second uncoordinated anomaly cron.**
3. **Durable claimable AIRun queue with atomic claim** (fix the `get-pending-task` race *first*) + checkpoint/resume; async long-running-tool contract.
4. First-party **topology graph** from spans → episodic case memory → pgvector RAG (deferred).
5. **SSE token streaming** through `LLMService`/`AIService` — a real refactor, load-bearing for the demo.
6. Policy gateway + graduated-autonomy scoring + eval harness.
7. Code-fix **CI sandbox + verify loop** (the largest hidden infra lift).

**KILL / ABSORB — the legacy AIAgent FixException service.** Retire the standalone worker. **Keep** its git/PR/workspace plumbing folded into a `code_fix` tool inside the unified runtime. **Replace** the OpenCode CLI shell-out with in-house `LLMService` tool-calling. **Fix** the atomic-claim race. **Generalize** beyond GitHub (honor `CodeRepository.repositoryHostedAt`). No big-bang cutover.

**Concurrency & cost guardrails (mandatory before autonomy):** dedicated autonomous-run pool + **per-feature budgets** + a storm circuit-breaker. Multi-agent fan-out (~15× tokens) needs planner/synthesizer model routing + prompt caching.

---

## 8. Phased roadmap

**Phase 0 — Action belt + reframe (2–4 weeks, high wow / low risk).** Ship the ~10 mutating tools wrapping already-RBAC-tested service methods, entirely inside today's chat surface. Reframe the copilot as **"Sentinel."**

**Phase 1 — The Investigation Engine (the missing half). ← IN PROGRESS.** Non-conversational entrypoint on `ChatAgentRunner`/`ObservabilityAssistant` + investigation prompt + incident/alert trigger → cited RCA in the incident timeline + Slack. Ship the **BYO-LLM / local-Ollama / air-gapped** GTM story and the `baseline_anomaly` tool.
*Wow:* **"root cause before you're paged."**

**Phase 2 — Trust UX + proactive detection.** Token streaming; the **HypothesisBoard + CausalChain widgets** with deterministic labels; the narrated living timeline; **confidence-gated quiet mode**; reversible Undo + counterfactual preview; the **pre-incident predictive sweep**; alert-storm collapse.

**Phase 3 — Durability, active verify, close the code loop.** Durable checkpointed queue with atomic claim; **active verification** re-running failed probes; deterministic release rollback; the code-fix verify loop + regression tests + GitLab support; auto-postmortem on resolve; the **weekly "made your software better" digest.**

**Phase 4 — Memory + multi-agent + graduated autonomy.** Topology graph → episodic memory → pgvector RAG; recurrence short-circuit; orchestrator-worker parallel hypotheses; **runbook-authoring flywheel** + human-correction memory; per-problem-type accuracy scoring gating AutoRun; the **public Agent Accuracy scorecard.**

**Moonshot — the Reliability flywheel.** The **reliability-debt backlog** converting recurring firefights into ranked permanent PRs; a **community, AI-code-reviewed Runbook/Skill registry**; "Sentinel watching Sentinel" public accuracy dashboard; enterprise packaging (SOC2, air-gapped, SSO, per-team RBAC/audit).

---

## 9. Differentiation

| Capability | **OneUptime Sentinel** | Datadog Bits AI | Cleric / Resolve / Traversal | incident.io AI |
|---|---|---|---|---|
| Owns full data plane (logs+metrics+traces+incidents+on-call+status+repos, one model) | ✅ **Wins** | ⚠️ Telemetry only, no status page | ❌ Federate read-only | ❌ Incident data only |
| Wake-on-alert RCA | ✅ (ours on owned data) | ✅ | ✅ | ✅ |
| Live deep-link citations (owned log line/span) | ✅ **Wins** | ⚠️ Opaque verdicts | ❌ Federated pointers rot | ⚠️ |
| Close customer-comms loop (draft status-page update) | ✅ **Only us** | ❌ No status page | ❌ | ⚠️ Comms, no observability |
| Active verify — re-run failed probe | ✅ **Only us** | ❌ Passive | ❌ Passive | ❌ |
| Air-gapped / self-hosted / BYO-LLM | ✅ **Only us** | ❌ Closed SaaS | ❌ Closed SaaS | ❌ Closed SaaS |
| Open-source & inspectable audit trail (egress manifest) | ✅ **Only us** | ❌ | ❌ | ❌ |
| Public accuracy scorecard | ✅ **Wins** | ❌ | ❌ | ⚠️ Internal eval only |
| Reliability-debt → permanent-fix backlog | ✅ **Only us** | ❌ | ❌ | ❌ |
| Confidence-gated page suppression | ✅ **Only us** | ❌ | ❌ | ⚠️ |
| Pricing | ✅ Free AI on self-host w/ own key | ❌ Metered add-on | ❌ Enterprise-only | ❌ Pro/Enterprise-gated |

---

## 10. The bumper-sticker

> ## **OneUptime: the open-source AI SRE that finds the root cause before you're paged, fixes the code, proves the fix held — and makes your software more reliable every week. Self-hosted. Auditable. Yours.**

**The three metrics that prove it's working:**

1. **MTTR reduction** — median time-to-root-cause and time-to-resolve, before vs after Sentinel (target: RCA posted in 1–3 min; 30–60% MTTR cut).
2. **Published RCA accuracy** — top-hypothesis precision, self-graded against documented postmortems, shown openly (target: 80%+, with the misses visible).
3. **Reliability debt burned down** — recurring-incident classes eliminated and permanent-fix PRs merged per month.

*Ship Phase 0–1 first. They're 80% built and dormant in the repo. The rest is how we win the category.*

---

## Appendix — Phase 1 build notes (Investigation Engine)

Phase 1 delivers **wake-on-incident autonomous investigation**:

- **Trigger:** when an incident is created (and the project has opted in), enqueue an `AIRunType.Investigation` run.
- **Runner:** a non-conversational investigation entrypoint that builds incident context (`IncidentAIContextBuilder`) and runs the existing read-only, tool-grounded, cited agent loop (`ObservabilityAssistant`) with an investigation persona and a larger budget.
- **Substrate:** the `AIRun` / `AIRunEvent` rows record the run lifecycle (Running → Completed/Error) and a glass-box event trail.
- **Output:** the cited root-cause analysis is posted back to the incident as an internal note + incident feed item, and (when the incident posts to workspace channels) to Slack/Teams.
- **Safety:** ReadOnly permission mode — the investigation can never mutate anything. Gated per-project by an opt-in flag and by AI/LLM-provider availability.
