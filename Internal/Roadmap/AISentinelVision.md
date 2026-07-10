# OneUptime AI — The Reliability Brain (codename: **Sentinel**)

> The product vision for OneUptime's AI agents. This is the **strategy** document — it says where we are going and why we win.
> Build status, phase checklists, safety gates, and sequencing live in [AISentinelExecution.md](./AISentinelExecution.md) — this doc deliberately contains **no** point-in-time status claims.
> Competitive claims last reviewed: **July 2026**. Review quarterly (see Changelog in the execution doc).

---

## 1. The North Star

> **OneUptime becomes the open-source AI SRE that watches everything you own, tells you the root cause before you're paged — with a receipt for every claim — fixes the code, proves the fix held, and makes your software measurably more reliable every single week.**

**The manifesto.** Monitoring told you *something is wrong*. Observability told you *where to look*. The Reliability Brain tells you *why it broke, what to do, and does it* — then closes the loop by turning every incident into a permanent improvement to your software. It never sleeps, it shows its work, it asks before it touches production, and it gets smarter every time it's corrected. It is not a chatbot bolted onto a dashboard. It is a senior on-call engineer that lives inside the one platform that already holds your monitors, logs, metrics, traces, exceptions, incidents, on-call schedules, status page, service catalog, and code repos — and because it's open-source and self-hostable, you can read its mind and run it air-gapped in your own cluster. We are not adding an AI feature. We are flipping OneUptime from *answers when asked* to *watches, decides, and improves on its own*.

---

## 2. Why now / why OneUptime wins

The entire AI-SRE market has converged on one promise — **"root cause before you're paged"** — and as of mid-2026 every serious competitor ships some version of it. The honest read of the field:

- **Datadog Bits AI SRE** went GA in December 2025, natively integrated with Datadog On-Call, mobile, and Case Management, with visible investigation timelines. It owns telemetry — but it is a **closed box you cannot self-host**, priced as a **metered add-on** that triggers "tokenpocalypse" spend-shock, and it has **no status page**: it structurally cannot close the customer-comms loop.
- **incident.io AI SRE** now triages alerts, connects code changes, surfaces similar past incidents, and **auto-drafts status-page updates and postmortems**. It owns incident data and comms — but **federates read-only over your observability**, so its evidence is other vendors' pointers, not owned telemetry.
- **Cleric, Resolve, Traversal** do sophisticated investigation (Cleric even deploys inside your VPC) but **own none of the observability data** — they federate over your Datadog/Grafana/Prometheus, paying a cross-vendor correlation tax on every hop, inheriting each tool's sampling gaps, and burning ~15× the tokens stitching context across silos. And all of them are closed-source.
- **Grafana Assistant Investigations** (GA since late 2025) is the closest "open-source, owns-the-data-plane" rival — but its AI is tethered to Grafana Cloud even for self-hosted stacks, and Grafana owns neither incidents-to-status-page comms nor on-call the way we do end-to-end.
- **Sentry Seer** owns errors and closes into PRs beautifully — today it is genuinely ahead of us on code-fix. But it sees only errors, not full telemetry, on-call, incidents, or customer comms.
- **Atlassian JSM (Rovo Incident Command Center)** is courting the Opsgenie migration cohort with an AI incident hub — incident data and on-call, but no owned observability and no open source.

**OneUptime's advantage is structural, not incremental:**

1. **It owns the entire data plane in ONE tenant-scoped model** — monitors, logs, metrics, traces, exceptions, incidents, alerts, on-call, runbooks, status pages, service catalog, *and linked GitHub/GitLab repos*. No connector cold-start. No correlation-across-vendors tax. Citations are **live deep-links to data we own**, not dead federated pointers. We can follow one unbroken causal chain: *metric spike → anomalous baseline → new exception fingerprint → the trace that threw it → the release that shipped it → the commit → the fix PR → the status-page post → the postmortem → the memory that short-circuits the next recurrence.* No competitor owns every link.

2. **It's open-source, self-hostable, and BYO-LLM** — including keyless local Ollama already wired into `LLMService`. The reasoning trail is auditable; the LLM keys are yours; the whole thing runs air-gapped. That's a structural "**no third-party training on your data**" guarantee the closed vendors cannot make — and a live-on-stage demo (*unplug the network, run full alert-to-RCA on a laptop*) that no named rival can perform. (For cloud tenants using our global provider, the honest version of this guarantee is a documented egress policy — see §6.)

3. **The Investigation Engine is shipped and running.** Sentinel wakes on incident and alert creation, runs a read-only, budgeted, citation-minting investigation over owned telemetry, and posts a branded root-cause analysis to the incident timeline with a live glass-box "watch it think" panel. The head-start thesis proved out: it was built on the existing chat-agent runtime in weeks, not quarters. What remains is hardening it (durability, guardrails), proving it (measurement, evals), and extending it down the causal chain (verify, code-fix, comms). The execution doc tracks exactly where that stands.

The window is now: incumbents gate AI behind Enterprise paywalls or metered add-ons, and **Opsgenie's forced EOL (April 5, 2027 — data must migrate or be lost)** is pushing teams to re-evaluate on-call platforms *right now*; migrating teams pick their destination 6–18 months ahead, and the incumbent counter-move (JSM + Rovo) is already courting them. An open-source, AI-native alternative that bundles monitoring + on-call + AI-SRE is a clean, time-boxed displacement wedge — **if we pace to it** (dated GTM milestones live in the execution doc).

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

It is **one runtime that swallows both of the original half-agents** — the reactive chat copilot and the narrow legacy code-fixer — not a third bolt-on. The runtime reuses the platform's existing assets (the ReAct agent loop, the metered LLM gateway, the durable run *record*, the graduated-permission primitive, the curated toolbox, server-minted citations, the context builders, the metric baselines, the topology graph, the git plumbing); the full reuse/build/kill inventory with per-item status lives in the execution doc.

### The two genuinely new primitives

- **A durable, checkpointed run substrate** — replace detached fire-and-forget promises (which orphan on pod restart) with a **claimable AIRun queue with atomic claim**, so long, unattended, restart-safe investigations become possible. The CAS + checkpoint pattern already exists in the chat approval-resume path; the work is generalizing it, not inventing it.
- **Memory + a topology graph** — the "improve over time" engine, sequenced honestly:
  1. **First-party topology graph from data we already own.** The graph itself (service dependency edges derived from `Span` parent/child relationships + `TelemetryEntity` co-occurrence + service-catalog ownership) is **built and running as a product feature** — the open work is wiring Sentinel to consume it, which turns correlation into causation and gives blast-radius awareness.
  2. **Episodic case memory** — every resolved investigation persisted as a retrievable case (root cause + citations + the runbook/PR that fixed it). A retrieval-only first cut (shared-monitor/label recurrence lookup) already ships inside investigations; the persisted case store is the open build.
  3. **pgvector RAG + temporal (valid_at/invalid_at) knowledge graph** — the net-new build, deferred but real, over postmortems/runbooks/service descriptions. Ships only with the memory-safety spec in §6.

---

## 4. The agent capabilities

Across the full lifecycle: **Detect → Correlate → Investigate → Remediate → Communicate → Verify → Learn.** (Status per capability lives in the execution doc; this list is the destination.)

1. **Proactive, pre-incident detection (*left of boom*).** Static thresholds miss slow regressions. Sentinel diffs live metrics against their per-hour-of-week baseline band and **opens a cited incident before the alert even trips** — triggered off the existing anomaly monitors, never a second uncoordinated anomaly cron.

2. **Wake-on-signal autonomous investigation (headline).** The instant an incident/alert fires, an investigation run assembles context, runs the read-only tool loop, and posts a **cited root-cause hypothesis into the incident timeline + Slack in 1–3 minutes** — before the on-call engineer has finished reading the page.

3. **Glass-box parallel hypotheses.** An orchestrator spawns isolated sub-runs (deploy- / dependency- / resource- / data-caused), each labeled **VALIDATED / INVALIDATED / INCONCLUSIVE** by a **deterministic, server-verifiable check**, never free-form LLM judgment. Rendered as a HypothesisBoard + CausalChain widget.

4. **Deterministic deploy correlation + one-click rollback.** Correlate `ExceptionInstance.release` to the exact deploy and offer **rollback of *that specific release*** — deterministic, not LLM-guessed.

5. **Alert-storm collapse.** The on-call opens their phone to **ONE card: "47 alerts, 1 root cause."** Rule-based grouping plus AI root-cause grouping.

6. **Confidence-gated escalation — "nobody gets woken at 3am."** Because OneUptime **owns on-call schedules**, when RCA confidence is high and blast-radius low, the Brain can **delay the 3am page**, page the specific **service owner**, or hand a warm, diagnosed incident to the morning shift. This is the riskiest capability in the roadmap and ships only under the page-suppression safety contract in §6 — suppression is a *delay with a dead-man's switch*, never a cancel.

7. **Full incident-command action belt.** ~10 mutating tools that are **thin wrappers over already-RBAC-tested service methods** — paging, runbooks, incident state/severity, monitor status, status-page updates, postmortem drafting — gated by permission modes and (before any broad autonomy) the policy gateway.

8. **Auto code-fix PR.** After RCA pins root cause, an **in-house `LLMService` coding sub-agent** reads surrounding logs/traces/spans, writes the fix *plus a regression test built from the real production error*, runs a **build/test/lint verify loop until green**, and opens a reviewable PR on GitHub *or* GitLab. **The biggest genuine engineering lift** — the per-repo CI sandbox is the hidden cost, and it gets its own design spike before any code. (Sentry Seer is ahead of us here today; our differentiation is fixes grounded in *full* telemetry, not error-only context.)

9. **Auto customer-comms.** Because OneUptime **owns the status page + subscribers**, the same run drafts the customer-facing announcement, queued for one-click human-approved publish. incident.io can draft comms too — but not from the same owned telemetry that produced the cited RCA. *Telemetry-grounded comms* is the defensible claim.

10. **Active verification — using our own probes as hands.** The Brain **re-runs the exact synthetic monitor/probe that failed** to confirm recovery in seconds, then watches SLO/error-budget + recurrence. No passive competitor can do this.

11. **Learn — runbook-authoring flywheel + human-correction memory.** After a successful remediation, the Brain **drafts a versioned Runbook** (gated by human review). Every human correction (edited status update, rejected hypothesis, fixed PR) is captured as durable memory — under the memory-safety rules in §6.

12. **On-call copilot + ambient scribe.** Interactive approval cards in Slack/Teams; rolling "catch-up" summaries; automated shift-handoff briefings.

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

Trust is the entire game — hallucinated overconfidence is the **#1 documented abandonment driver (>30% quit)**. We win it structurally. These are **commitments with gates, not descriptions of the present**: each one is tracked in the execution doc's Safety Gates table, which states honestly what is in force today, what interim mitigation covers the gap, and which phase each gate blocks.

**Core commitments:**

- **Show your work, always.** Citations minted server-side *only from executed tool calls*; fabricated `[C#]` markers are stripped. Hypothesis labels are earned by deterministic checks, never free-form LLM assertion.
- **Graduated autonomy, earned per problem-type.** ReadOnly → AskForApproval → AutoRun. Before AutoRun becomes anything more than an explicit per-conversation human choice, closed-loop accuracy scoring must exist and the problem-type must cross its threshold. **We will not expand autonomy ahead of measurement** — and where early shipping has outrun this principle, the Safety Gates table says so and names the compensating control.
- **Reversible by design.** Mutations that can carry an undo will ship one, with counterfactual dry-run previews before approval. Mutations that are *not* meaningfully undoable (a page that already fired, a status update that already emailed subscribers) will be labeled as irreversible in the approval UI rather than pretending otherwise.
- **A policy gateway before broad autonomy.** Per-action risk tier, per-team RBAC, blast-radius limits, a **circuit breaker that halts on a remediation storm**, capability-scoped tokens per sub-agent. Until it exists, mutations stay behind RBAC + per-conversation permission modes and autonomous runs stay read-only.
- **Autonomous agents see a hard allowlist** — the curated read-only toolbox, never the full MCP tool surface.
- **Full audit trail** — `AIRun` / `AIRunEvent` / `LlmLog` + per-run **egress manifest** (to be extended from chat to all autonomous runs) + `gen_ai.*` OTel spans. The audit trail itself gets a lifecycle: retention limits and access tiering on stored prompts/responses, because an audit log of incident data is itself sensitive data.
- **Honest uncertainty as an action** — when telemetry is insufficient, the Brain **refuses** and auto-opens an instrumentation-gap ticket.
- **Eval harness dogfooding our own spans** — a golden-incident corpus built from real resolved incidents (target ≥50), offline replay driven by recorded run trails, scored on top-hypothesis precision, citation-grounding rate, tool-selection accuracy, and inconclusive-recall. Passing thresholds per risk tier is the graduation gate for autonomy.

**Threat model (what we defend against, not just what we promise):**

- **Adversarial telemetry / prompt injection.** All telemetry content — logs, traces, exception messages, spans — is attacker-writable and is treated as **adversarial by default**. Tool results are framed as untrusted data, and, critically, **no control-flow decision (confidence, quiet mode, hypothesis labels, page delay) may be derived from the model's free-form prose**, because injected content can steer prose. Control signals must be structured and server-verified (constrained classification calls, deterministic checks over cited evidence). Agent-authored markdown is sanitized before it reaches feeds, Slack, or subscriber-facing surfaces.
- **Page-suppression safety contract.** Suppression is a **delay, never a cancel**: a dead-man's switch pages the original policy after N minutes unless a human acknowledges the diagnosis. Per-service, admin-owned opt-in; the enabling admin owns the residual risk and we publish suppression precision. Every suppression is a first-class auditable event feeding a mandatory review queue. Suppression precision requirements are strictly higher than the general RCA accuracy target — an 80%-accurate RCA is nowhere near good enough to silence a page.
- **Data egress & PII.** The serializer-level redaction (tokens, secrets, credential patterns) is the egress baseline and extends to context builders and memory, not just tool results. Cloud tenants on the global LLM provider get a documented egress posture (which provider, subprocessor/DPA terms); self-host/BYO-LLM remains the zero-third-party-egress option. Redaction-bypass tests are part of the eval harness.
- **Failure semantics, stated per capability.** Notification and paging paths **fail open** (an agent error never suppresses a page). Mutations and customer comms **fail closed** (never act on error). Verification failures report "unverified", never "verified". Failed or orphaned investigations are visibly surfaced, so absence-of-RCA is distinguishable from "nothing found". Provider fallback and bounded retry are defined, not improvised.
- **Memory safety.** Any persisted memory (episodic cases, corrections, flywheel-drafted runbooks, vector stores) gets per-tenant isolation enforced at the storage layer, provenance + human-review gates on writes, quarantine/expiry for suspect entries, and retrieved memory is framed as untrusted context in prompts. A community runbook registry additionally requires signing and review before anything reaches an execution surface.

---

## 7. Differentiation

*As of July 2026 — reviewed quarterly; competitive claims in this table must carry a review date to be trusted.*

| Capability | **OneUptime Sentinel** | Datadog Bits AI SRE | Grafana Assistant | Cleric / Resolve / Traversal | incident.io AI | Sentry Seer |
|---|---|---|---|---|---|---|
| Owns full data plane (logs+metrics+traces+incidents+on-call+status+repos, one model) | ✅ **Wins** | ⚠️ Telemetry, no status page | ⚠️ Telemetry, partial IRM | ❌ Federate read-only | ❌ Incident data only | ❌ Errors only |
| Wake-on-alert RCA | ✅ (ours on owned data) | ✅ GA | ✅ | ✅ | ✅ | ⚠️ Error-triggered |
| Live deep-link citations (owned log line/span) | ✅ **Wins** | ⚠️ Timelines, closed box | ⚠️ | ❌ Federated pointers rot | ⚠️ | ⚠️ |
| Telemetry-grounded customer comms (status update drafted from the same owned telemetry as the cited RCA) | ✅ **Wins** | ❌ No status page | ❌ | ❌ | ⚠️ Drafts comms, federated evidence | ❌ |
| Active verify — re-run the failed probe | ✅ **Only us** | ❌ Passive | ❌ | ❌ Passive | ❌ | ❌ |
| Runs fully air-gapped w/ local LLM | ✅ **Only us** | ❌ | ❌ Cloud-tethered AI | ❌ | ❌ | ❌ |
| Self-hosted deployment available | ✅ | ❌ | ⚠️ Stack yes, AI via cloud | ⚠️ Cleric in-VPC, closed source | ❌ | ⚠️ Self-hosted Sentry, Seer cloud |
| Open-source & inspectable audit trail (egress manifest) | ✅ **Only us** | ❌ | ⚠️ OSS stack, closed AI | ❌ | ❌ | ⚠️ |
| Code-fix PRs with regression tests | 🔜 (full-telemetry-grounded — catch-up-then-differentiate) | ⚠️ Bolt-on | ❌ | ❌ | ⚠️ Code links | ✅ Ahead today |
| Public accuracy scorecard | ✅ **Wins** (once measured — see execution doc) | ❌ | ❌ | ⚠️ Internal eval only | ⚠️ | ❌ |
| Reliability-debt → permanent-fix backlog | ✅ **Only us** | ❌ | ❌ | ❌ | ❌ | ❌ |
| Confidence-gated page delay (with dead-man's switch) | ✅ **Only us** | ❌ | ❌ | ❌ | ⚠️ | ❌ |
| Pricing | ✅ Free AI on self-host w/ own key; metered w/ quota on cloud | ❌ Metered add-on | ⚠️ Cloud-gated | ❌ Enterprise-only | ❌ Pro/Enterprise-gated | ⚠️ Add-on |

---

## 8. The bumper-sticker

> ## **OneUptime: the open-source AI SRE that finds the root cause before you're paged, fixes the code, proves the fix held — and makes your software more reliable every week. Self-hosted. Auditable. Yours.**

**The three metrics that prove it's working** (instrumentation for all three is scheduled work — the execution doc tracks it; no public number ships before its plumbing exists):

1. **MTTR reduction** — median time-to-root-cause and time-to-resolve, before vs after Sentinel, compared across investigated vs non-investigated cohorts (target: RCA posted in 1–3 min; 30–60% MTTR cut).
2. **Published RCA accuracy** — top-hypothesis precision, graded against documented postmortems and human confirm/reject verdicts, shown openly (target: 80%+, with the misses visible).
3. **Reliability debt burned down** — recurring-incident classes eliminated and permanent-fix PRs merged per month.

---

*Execution status, phase exit criteria, safety gates, deviations, and the GTM calendar: [AISentinelExecution.md](./AISentinelExecution.md).*
