# OneUptime AI Roadmap: The Closed Incident Loop

> Internal doc. June 2026. Companions: [CurrentState.md](./CurrentState.md) (codebase assessment) · [MarketLandscape.md](./MarketLandscape.md) (competitive research).
>
> How this was produced: a 14-agent discovery sweep over the codebase and market, four independently-designed roadmap candidates (developer-wow-first, SRE-workflow-first, platform/trust-first, open-source-GTM-first), a three-perspective review panel (founder, staff engineer, skeptical SRE buyer), and a synthesis. Every "builds on" code citation below has been verified against the repo.

---

## 1. Thesis

OneUptime is the only platform — open-source or proprietary — that owns every station of the incident loop: monitors, alerts, on-call escalation, incidents, status pages, the full OpenTelemetry signal set (logs, traces, metrics, exceptions, profiles), and a live GitHub App connection to the customer's code. Sentry has errors and code but no pager. Datadog has telemetry and an investigator but no on-call ownership and no post-deploy verification. incident.io has the pager and Slack but rents everyone else's telemetry. The SRE-agent startups (Resolve, Traversal, Cleric) rent everything and take six weeks of sales-gated onboarding.

The AI overhaul is therefore not a chatbot and not a PR vending machine bolted onto exceptions. It is making the loop itself autonomous: **detect → investigate → fix → verify → learn**, with the on-call engineer holding the approval button and the telemetry holding the receipts. The promises are concrete and timed:

- Alert fires → the investigation is already done when the engineer opens Slack.
- Incident declared → a cited, click-to-verify hypothesis in the incident channel within 2 minutes.
- Incident resolved → the postmortem is drafted.
- Fix merged → OneUptime's own telemetry verifies the error actually stopped, and the receipt is commented on the PR.
- Incident class recurs → a prevention PR appears.

That fourth step — **observability-verified fixes** — is the loop no competitor closes. Sentry Seer stops at the draft PR. Datadog Bits stops at CI green. OneUptime can close it because it *is* the observability system.

We reuse what is verifiably solid: the AIAgent microservice skeleton (polling loop in `AIAgent/Jobs/ProcessScheduledTasks.ts`, KEDA autoscaling via the `get-pending-task-count` endpoint, `TaskHandlerRegistry`, `WorkspaceManager` isolation, `TaskLogger`, the `TimeoutStuckTasks`/`UpdateConnectionStatus` workers), the LLM provider abstraction with metering and billing (`LlmProvider`, `LlmLog`, `AIService`, `AIBillingService`), GitHub App auth (`Common/Server/API/GitHubAPI.ts`, `Common/Server/Utils/CodeRepository/GitHub/GitHub.ts`), exception fingerprinting and entity-key correlation in the ClickHouse telemetry layer, the AI context builders (`IncidentAIContextBuilder` plus its Alert/ScheduledMaintenance siblings), Slack/Teams workspace plumbing (`WorkspaceNotificationRuleService`), the workflow engine, and the MCP server. We rebuild what is broken: triggering (manual-only → telemetry-gated automatic), context (a bare stack trace → a full evidence brief), and trust (fire-and-forget unverified PRs → a verification state machine with an autonomy ladder).

Openness is the product, not the license: BYO-LLM-key in OSS forever as a written covenant, transparent cost-plus hosted credits, 10-minute self-serve setup, and a public reproducible benchmark — because the one claim nobody in this market can contest is **"the open-source AI SRE that fixes your code, not just your dashboards — and proves the fix worked in production."**

---

## 2. Key Decisions

Decisions made during the design process, recorded here because they are binding for the rest of the document.

1. **Anchor on the incident loop, with a dual-lane Day-1.** The SRE-workflow spine (the incident loop) anchors the roadmap because it derives from OneUptime's structurally uncopyable advantage. But net-new HN signups have no incident history to replay, so the Day-1 experience is **dual-lane** (Section 3): Incident Replay for teams with history, First Fifteen Minutes for net-new projects. One investigation engine underneath, running in live or historical mode.

2. **Sandboxing ships in Phase 0, before any auto-triggering.** Today's agent runs in a bare `os.tmpdir()` workspace with path checks only (`AIAgent/Utils/WorkspaceManager.ts`). Enabling automatic repo-cloning agent runs before sandboxing would be an indefensible exposure window. Sandboxed execution with egress controls is a Phase 0 item.

3. **No auto-merge rung exists at any autonomy level, ever.** The ladder tops out at auto-flip-to-ready-for-review for narrow, earned, individually-enabled fix classes. Merging is always a human action behind the customer's own branch protection. (Unanimous panel ruling.)

4. **No fabricated confidence percentages.** A "87% confidence" badge from a v1 heuristic is false calibration. The phasing: Phase 1 ships *qualitative* fixability labels ("Fixable" / "Uncertain" / "Not enough signal") with the score inputs always visible (occurrences, recency, escaped flag, repo-path match); Phase 1 outcomes (merges, reverts, closures, verifications) become the calibration data; Phase 2 graduates to numeric tiers only where that calibration supports them, and those tiers gate the auto-trigger GA.

5. **Postmortem generation already exists — the work is smaller than assumed.** `IncidentAIContextBuilder` is already wired into `IncidentAPI.ts:213` and `:326` (postmortem and note generation), user-triggered. The Phase 0 item is only the **on-resolve auto-trigger** plus surfacing. Likewise "no baselines exist" is an overstatement: `Common/Models/AnalyticsModels/MetricBaselineHourly.ts` exists; the gap is anomaly/trend *APIs* on top of it, not greenfield rollups.

6. **Public launch lands after production verification ships, not before.** Pricing page, BYO-key covenant, and quiet availability ship early (those are trust artifacts, not claims); the benchmark harness is built in Phase 1 as our internal eval suite; the **"Show HN" launch with the published benchmark lands the moment post-deploy verification is live** (target: month 6–7, mid-Phase 2). We never market a loop we haven't closed.

7. **The Day-1 PR must not run through the un-overhauled fix engine.** The replay wow cannot tease a PR generated by the old bare-stack-trace prompt. A **Fix Engine v1.5** ships inside Phase 1 — evidence-brief prompts, Claude Agent SDK backend, reproduce-test-where-feasible, draft-only PRs with receipts — while the full state machine (CI watch, deploy watch) completes in Phase 2. Relatedly: the live hypothesis-streaming investigation view cannot be produced by the single-shot `OpenCodeAgent` CLI; the Investigation Engine is a separate new orchestrator (single LLM loop over deterministic tools), not a retrofit of the code-fix harness.

8. **Verified naming details:** the dormant enum value is `FixPerformanceIssues` (`Common/Types/Service/CodeRepositoryImprovementAction.ts`). The GitHub webhook stub does handle installation deletion; the precise gap is no push/pull_request/check_run processing — the stub's own comment at `GitHubAPI.ts:584-587` says "Future: Handle push, pull_request, check_run events."

---

## 3. The Day-1 Wow: Two Lanes, One Engine

Onboarding routes on one deterministic check: does this project have resolved incidents with retained telemetry in the incident window? If yes → Lane A. If no → Lane B. Both lanes end in the same artifact: a **Fix Report** — a single shareable page composing the finding, the live investigation transcript, the cited evidence, the draft PR, and (later) the production verification, with a rich Slack unfurl. The Fix Report is the unit of wow, of sharing, and of trust.

**The screenshot test, adopted as a feature gate:** if a feature can't produce an artifact a developer would screenshot and post to their team channel ("look what it found"), it gets cut or demoted. What gets shared in this category (per the market research): DeepWiki's URL-swap instant wiki, CodeRabbit's first-PR-reviewed-in-minutes, incident.io's "Root cause was bang on" Slack report. The common shape: **a finished, verifiable artifact made from the user's own data, produced before they asked for anything.** Not a chat window. Not an empty dashboard with a sparkle icon.

### Lane A — Incident Replay: "Here's what I would have told you at 3:12 AM"

For existing OneUptime users and migrating teams. No repo connection required; read-only.

**Minute 0–2 — One toggle.** The user opens the consolidated Settings → AI hub (replacing today's fragmented AI Agents / Bring Your Own LLM / AI Credits / AI Logs pages — a documented UX gap). One screen: pick an LLM (the existing `LlmProvider` BYO-key flow — Anthropic, OpenAI, Ollama, etc. — or hosted credits via `AIBillingService` with the published price sheet), and flip "Investigate alerts and incidents automatically." The same screen shows the privacy contract: *"OneUptime AI never acts without approval. Here is exactly what data is sent to your LLM."*

**Minute 2–3 — It finds your worst night.** The system queries `Incident` + `IncidentStateTimeline` for recently resolved incidents, ranks by time-to-resolve, and offers: *"Your incident 'Checkout API returning 500s' took 3h 41m to resolve. Want to see what I would have found?"* One click: Replay.

**Minute 3–7 — The investigation, live-streamed.** Split screen. Left: the agent's reasoning streaming in real time. Right: every tool call — *"Querying error spans for `checkout-api`, 02:40–03:40… 1,204 error spans, 96% share one exception fingerprint… Pulling logs for those traces via traceId… first-seen 02:38… `service.version` flipped 1.4.1 → 1.4.2 at 02:31."* Each step is a real query against the existing `TraceAggregationService`, `LogAggregationService`, `ExceptionAggregationService`, and the fingerprint store — deterministic answers, LLM planning. Every claim carries a citation chip that opens the raw log lines, trace, or exception group in under 30 seconds.

**Minute 7–8 — The verdict, side-by-side.** The result posts to the team's existing Slack channel via `WorkspaceNotificationRuleService`: root-cause hypothesis, numbered evidence links, the suspect change, and the line: *"Time from alert to this conclusion: 94 seconds. Your team's actual time-to-mitigate: 3h 41m."* If the incident has a human-written `postmortemNote`, the replay renders them side-by-side. When the AI's conclusion matches what the team painfully discovered at 4am, trust is instant.

**Minute 8–10 — The fix teaser, and arming.** If a `CodeRepository` is connected, one click queues a fix task carrying the full evidence brief — through the Phase-1 fix engine (draft PR, receipts, reproducing test where feasible), never the legacy bare-prompt path. Closing screen: *"I'm now watching your alerts. Next time one fires, the investigation will be waiting."* The next real page delivers the permanent wow: the engineer opens Slack and the cited hypothesis is already there.

*Replay risk control:* replays run privately first; if the engine's conclusion is inconclusive or contradicts the postmortem, the UI says so honestly and offers the next-best incident — candor is the brand.

### Lane B — The First Fifteen Minutes (net-new projects)

For the HN signup with an OTel exporter and zero incident history.

**Minute 0–2 — Connect telemetry.** Signup (cloud) or `docker compose up` (self-host). One screen: OTLP endpoint + token, copy-paste snippets. The promise: *"Send us telemetry. We'll find something worth your time in minutes — or tell you honestly that we didn't."*

**Minute 2–5 — First Look findings, unprompted.** As data lands, a First Look scanner sweeps the existing `TelemetryException` Postgres rollups (fingerprint, occurrence count, firstSeen/lastSeen, escaped flag) and ClickHouse spans/logs — no 48-hour baseline wait. It surfaces 3–7 ranked finding cards: exception clusters by occurrence × recency × blast radius (via `entityKeys`), slowest endpoints, error-rate by route. Every card cites raw evidence one click away. Nothing was configured; nothing was asked.

**Minute 5–7 — The fixability label.** The top cluster carries a qualitative badge — "Fixable" — with the scoring inputs visible (412 occurrences this week, escaped, clear in-app frames, service↔repo linkable). No invented percentages. CTA: *"Connect your repo and I'll open a draft PR. You review everything; I never merge."* One click runs the existing GitHub App OAuth flow (`GitHubAPI.ts`, already scoped to `contents:write`, `pull_requests:write`, `metadata:read`).

**Minute 7–12 — The live investigation and the failing test.** A fix run starts in the live Run view: streamed reasoning, visible tool calls, hypotheses raised and crossed out. The hinge moment: the agent writes a **failing test reproducing the exception** from the real stack trace and span attributes, runs it in the sandbox — red. It just proved the bug exists before touching a fix. Then the diff, then the project's suite green.

**Minute 12–15 — The draft PR with receipts, and the share.** A draft PR opens (the `draft?: boolean` option already exists in `AIAgent/Utils/PullRequestCreator.ts:18`; it merely defaults to false today at line 63). The body is a verification receipt: root-cause narrative, evidence links, failing-then-passing test output, the egress summary ("stack trace + 3 normalized log lines sent to *your* Anthropic key"), the cost ("$0.91, 312k tokens"), and the standing promise: *"After you merge and deploy, OneUptime will watch fingerprint a3f9… and comment here when production confirms the error stopped."* A Slack message lands with the Fix Report link, which unfurls beautifully. That unfurl is the growth loop.

**Empty/thin-data path:** a Fire Drill button (synthetic failure on any monitor) and a Replay Mode against the OpenTelemetry Demo, so nobody ever sees a dead dashboard. If nothing is confidently fixable, the screen says exactly that, plus what is being watched — the designed honest outcome, not a fallback.

**Days 2–4 — the wow that retains (both lanes).** The user merges. PR-state sync sees the merge, correlates the next deploy marker, watches the fingerprint, and 72 hours later comments on the PR and updates the Fix Report: *"Verified in production: 0 occurrences since deploy 2.14.3 (was 1,247/week)."* Or honestly: *"Error recurring; reopening with new evidence."* No competitor closes this loop.

*Surfaces note:* Slack is the narrative example throughout; Microsoft Teams ships at parity in Phase 1 using the existing `WorkspaceNotificationRuleService` + Teams plumbing, and every Slack-thread interaction has a dashboard equivalent for teams on neither.

---

## 4. Product Pillars

### Pillar 1 — The Evidence Engine (deterministic substrate)

The moat against generic Claude+MCP is pre-LLM machinery a raw agent must expensively rediscover on every run.

- **Evidence bundle / Case File:** one typed, server-side composition API — "give me the evidence bundle for fingerprint X / incident Y" — composing the existing signal-specific services (`LogAggregationService`, `TraceAggregationService`, `ExceptionAggregationService`, `MetricAggregationService`, `ProfileAggregationService` including its existing diff-flamegraphs) along the linkages the schema already supports: exception → `ExceptionInstance` occurrences → traceIds → span trees → logs in those traces → metrics for affected entityKeys → profile diff across the suspect window → deploy events → linked incidents. This is composition, not new storage, and it powers every AI surface.
- **Deploy markers and change correlation:** a new `DeploymentEvent` model + REST ingest + CLI/GitHub Action emitter + processing of GitHub deployment/push webhooks (implementing the stub at `GitHubAPI.ts:584`), plus auto-derivation from `service.version` transitions already stored on `ExceptionInstance.release`. "What changed right before this?" becomes deterministic — the single highest-leverage missing telemetry primitive.
- **Incident–telemetry linkage:** junction models tying `Incident`/`Alert` to fingerprints, traceIds, deploy events, and time-windowed entityKeys, populated from monitor criteria and alert metadata at creation. This is the schema gap blocking all cross-surface RCA today.
- **RCA query toolbox:** ~10 deterministic cross-signal queries the investigation agent can call — error-trace-tree, first-seen-after-T, log-pattern-cluster, baseline-deviation, deploy-window-diff, profile-diff — exposed internally and as curated MCP tools. The LLM plans; deterministic queries answer.
- **Baselines and anomaly feed:** extend the existing `MetricBaselineHourly` rollups with per-service error-rate and latency-percentile baselines (ClickHouse materialized views) and add the missing anomaly/trend APIs, feeding a quiet Watchdog-style findings feed and the investigator's "is this abnormal?" primitive.

### Pillar 2 — The Investigation Engine ("the investigation is already done")

- **Auto-investigation on alert/incident creation,** hooked into the same `IncidentService.onCreateSuccess` cascade that runs owner rules, on-call rules, and workspace notifications today. New `Investigation` + `InvestigationFinding` models with status (Running / Conclusive / Inconclusive / NeedsHuman), typed evidence references, and a stored agent trace. Single-LLM-loop orchestrator over the RCA toolbox — a new worker, deliberately not a retrofit of the OpenCode harness.
- **Slack/Teams-native and multiplayer:** the 2-minute hypothesis post with numbered evidence links and one-click actions (Declare Incident, Page Owner via on-call policies, Draft Fix PR, Mark Wrong); thread replies steer the running investigation; `/catchup` gives late joiners a private summary built from `IncidentStateTimeline`, notes, and channel messages via the existing context builders.
- **Auto-drafted postmortems:** wire the existing generation path (`IncidentAIContextBuilder` at `IncidentAPI.ts:213/326`) to the on-resolve lifecycle event, drafting `postmortemNote` and `rootCause` for human review before `showPostmortemOnStatusPage` ever fires.
- **Replay mode:** the same engine run against historical windows — the Lane A demo, Fire Drills, and later the public benchmark all reuse it.

### Pillar 3 — The Fix Engine (verification-first)

Keep the skeleton: task queue and state machine (`AIAgentTask`, Semaphore-guarded task numbers), KEDA autoscaling, `TaskHandlerRegistry`, `WorkspaceManager`, `TaskLogger` (upgraded to structured events), `AIAgentTaskPullRequest` tracking. Replace the heart — `OpenCodeAgent.ts`'s single-shot 30-minute CLI invocation — with a verification-first harness:

- **Verification state machine** as explicit states on `AIAgentTask`/`AIAgentTaskPullRequest`: `Plan → Reproduce (failing test where feasible) → Fix → LocalVerify (suite green in sandbox) → DraftPR → CIWatch (iterate until checks pass, then flip ready-for-review) → DeployWatch → ProductionVerified | Recurred`. Never ask a human to review a red PR. Explicit degradation tiers when repos lack test suites: reproduce-only → build/lint-verify → propose-with-lowered-confidence, clearly labeled.
- **Evidence-brief prompts:** replace the bare stack-trace prompt in `FixExceptionTaskHandler.ts` with the Pillar-1 evidence bundle rendered as a structured brief (stack trace, span timeline, correlated logs, deploy diff, occurrence stats). The dotnet/runtime evidence (a thorough instructions file moved Copilot agent merge rates 38% → 69%) makes this the highest-leverage quality intervention; OneUptime's data advantage, turned into a file.
- **Repo Brief + `oneuptime.md` steering file:** on repo connect, an indexing pass auto-writes a brief (language, test command, conventions, service-path map from `ServiceCodeRepository.servicePathInRepository`); customers can commit an `oneuptime.md` the runtime honors.
- **Pluggable backends behind the existing `CodeAgentFactory`/`CodeAgentInterface`** (the commented-out ClaudeCode/Goose stubs in `CodeAgentFactory.ts` anticipate exactly this): Claude Agent SDK as the first-class default (streamed events map directly onto the Run view), OpenCode retained as the zero-API-key OSS/Ollama fallback, and handoff adapters exporting the evidence brief to Claude Code, Copilot Agent tasks, or Cursor Automations — we win whether our agent or theirs writes the diff.
- **Fixability gating and volume governors:** auto-triggering of `TelemetryExceptionService.createAIAgentTaskForException` (manual-only today) gated by a scoring pipeline (occurrences, recency, escaped flag, stack-trace-to-repo resolvability, blast radius via entityKeys), fingerprint-level dedup via the `AIAgentTaskTelemetryException` junction, and enforcement of the stored-but-never-checked `ServiceCodeRepository.maxOpenPullRequests`, `enableAutomaticImprovements`, and `restrictedImprovementActions`.
- **New task types** extending `AIAgentTaskType` and implementing the dormant `CodeRepositoryImprovementAction` values: `FixIncidentRootCause`, `AddRegressionTest`, `ImproveLogs`/`ImproveSpans` (instrumentation-gap PRs that convert thin telemetry from a demo-killer into a fixable finding), `FixPerformanceIssues` (profile-diff driven, gated hard), `PreventRecurrence`.

### Pillar 4 — Verification, Memory, and the Closed Loop

- **Post-merge production verification:** merge webhook + deploy marker → fingerprint watch for N hours/days → receipt commented on the PR and rendered in the Fix Report; the opposite case ("error rate regressed after this merge — consider revert") handled with equal prominence. The signature differentiator.
- **Recurrence → prevention:** verified-failed fixes reopen findings; recurring incident classes auto-queue `PreventRecurrence` tasks with cross-incident evidence.
- **Operational memory:** structured, user-visible-and-editable per-project store (confirmed root causes, fix outcomes, reviewer-feedback patterns, flaky tests, do-not-touch zones), injected into runs, with entries citing the runs that created them. Cleric proved memory compounds; making it inspectable is our trust twist.
- **Fix Scorecard:** per-project merge rate, revert rate, verified-fix rate, human-commit rate, cost per merged fix (queryable today via `LlmLog`'s `feature` tag and per-call cost) — the dashboard a champion uses to defend the feature, and the data that gates autonomy promotion.

### Pillar 5 — Trust Fabric

- The autonomy ladder (Section 6), per project × service × action class.
- **Per-run data-egress manifest:** an auditable record of exactly what was sent to which LLM endpoint on every run, reusing the existing exception-fingerprint normalization patterns (UUID/JWT/IP/email → placeholders) as the PII-redaction layer. Privacy contract as a feature, not a docs page.
- **Audit log** of every agent action, autonomy change, approval, and recharge.
- **Cost governance:** pre-run estimates, hard per-run/day/month caps layered on the existing balance + auto-recharge machinery, per-fix cost on every PR body, episode-level investigation dedup (one investigation per `AlertEpisode`, not per alert), deterministic L0 investigations never metered, and inconclusive investigations free on hosted.

### Pillar 6 — The Open Fabric and GTM as Product

- **MCP server v2:** curated high-level tools (`get_evidence_bundle`, `get_reliability_report`, `start_fix_run`, `run_investigation`) added beside the auto-generated CRUD tools from `MCP/ToolGenerator.ts`, plus published agent skills so Claude Code/Cursor users consume OneUptime context natively.
- **The covenant:** BYO-key in OSS forever, written into the README and pricing page; hosted credits cost-plus with a published markup; no mid-cycle lockouts.
- **Public reproducible benchmark:** OTel-Demo fault-injection harness (`make benchmark`), scoring RCA accuracy and fix merge rates, published with failure cases — built in Phase 1 as our eval suite, published at launch (Section 5, Phase 2).
- **Wedges:** the "Seer for self-hosters" comparison page targeting the audience Sentry explicitly denied, and (scoped as its own sized project, not a one-liner) a Sentry-DSN-compatible ingest path.

---

## 5. Phased Roadmap

Dependency spine: *incident–telemetry linkage + deploy markers + PR sync + sandbox (Phase 0) → investigation engine + evidence briefs + dual-lane wow (Phase 1) → verification state machine + production verification + public launch (Phase 2) → memory, on-call responder, status comms, autonomy graduation (Phase 3).*

### Phase 0 — Wire What Exists, Make It Safe (Weeks 0–6)

Pure wiring and gating of verified-existing assets; no new ML, no new architecture. Exit criterion: the existing fix pipeline cannot flood, cannot run unsandboxed, and every PR it opens is a draft with synced state.

| # | Feature | What & why | Builds on (verified) |
|---|---|---|---|
| 1 | Enforce safety flags + dedup | Check `enableAutomaticImprovements`, `maxOpenPullRequests`, `restrictedImprovementActions` in task creation and handler; fingerprint-level dedup. Stored-but-never-validated today — a trust bug. | `ServiceCodeRepository.ts`, `TelemetryExceptionService.createAIAgentTaskForException`, `AIAgentTaskTelemetryException` junction |
| 2 | Draft PRs + receipt template | Flip `draft: true` (option already exists, defaults false) and template the PR body with evidence links and the post-merge promise. | `AIAgent/Utils/PullRequestCreator.ts:18,63` |
| 3 | PR lifecycle sync | Process `pull_request`/`check_run` webhook events into `AIAgentTaskPullRequest.pullRequestState` + outcome fields (state is write-once "Open" today at `AIAgentDataAPI.ts:621`). Prerequisite for all quality metrics and verification. | Webhook stub at `GitHubAPI.ts:584`, `GitHub.ts verifyWebhookSignature()` |
| 4 | Sandboxed execution | Per-task sandbox (`@anthropic-ai/sandbox-runtime` or containers), network off during the agent phase, proxy-allowlisted egress. Pulled forward deliberately: current state is bare `os.tmpdir()` with path checks. | `WorkspaceManager.ts`, hardened |
| 5 | Deploy markers v1 | `DeploymentEvent` model + REST ingest + GitHub deployments webhook + auto-derivation from `service.version` transitions. | `ExceptionInstance.release` column, webhook plumbing from #3 |
| 6 | Incident–telemetry linkage | Junction models linking incidents/alerts to fingerprints, traceIds, time-windowed entityKeys; populated at creation from monitor criteria and alert metadata. **Schedule in week 1–2: this schema work (with #5) is the hard dependency of the Phase 1 Evidence Engine.** | New models; `Incident`, `Alert`, monitor criteria |
| 7 | On-resolve postmortem trigger + `/catchup` | Auto-draft `postmortemNote`/`rootCause` on resolve using the **already-wired** generation path; first Slack AI command. Smaller than it sounds (Section 2.5). | `IncidentAIContextBuilder` (`IncidentAPI.ts:213/326`), `AlertAIContextBuilder`, Slack utils |
| 8 | Structured run events + task hygiene | Typed event payloads (tool call, file edit, test run, citation) on `AIAgentTaskLog` with a WebSocket endpoint (today: batch-flushed severity text); task cancel/retry endpoints; fixability-priority replacing FIFO in `get-pending-task`. | `TaskLogger.ts`, `AIAgentTaskLog.ts`, `AIAgentTaskAPI.ts` |
| 9 | Settings consolidation + covenant | One AI hub (provider, credits, autonomy, privacy contract); BYO-key-forever covenant and price sheet published. Fixes documented settings fragmentation. | Existing LlmProvider / AI Credits / AI Agents pages |
| 10 | Cross-linking | Exception page ↔ task ↔ PR bidirectional navigation ("AI is fixing this" banner) — the dashboard audit's top dead-end. | Exception detail pages, `AIAgentTaskPullRequest` |

### Phase 1 — The Investigation Engine and the Dual-Lane Wow (Weeks 6–16)

Goal: ship Section 3 end-to-end. The release we quietly open up; not yet the loud launch.

| # | Feature | What & why | Builds on |
|---|---|---|---|
| 1 | Investigation engine v1 | `Investigation`/`InvestigationFinding` models; single-LLM-loop orchestrator as a Workers job, triggered from the `AlertService`/`IncidentService.onCreateSuccess` cascade; typed evidence references; historical (replay) mode. | Existing hook cascade, `AIService` metering |
| 2 | RCA query toolbox + evidence bundle | The ~10 deterministic cross-signal queries and the composed bundle API powering investigations, fix briefs, and MCP. | All five aggregation services, entityKeys, fingerprint store, deploy markers (P0.5) |
| 3 | Baselines + anomaly feed v1 | Per-service error-rate/latency baselines extending existing hourly rollups; quiet findings feed; investigation trigger class. | `MetricBaselineHourly.ts`, Metric/Span minute rollups |
| 4 | Lane A: Incident Replay onboarding | Rank resolved incidents by MTTR, replay over retained telemetry, side-by-side with the human postmortem; Fire Drill for empty states; private-first with honest inconclusive handling. | `Incident`, `IncidentStateTimeline`, engine #1 in historical mode |
| 5 | Lane B: First Look + first-fifteen-minutes | On-connect scanner over `TelemetryException` + ClickHouse; qualitative fixability labels with visible inputs; single-path onboarding wizard (OTLP → findings → repo → key). | `ExceptionAggregationService`, `TraceAggregationService`, GitHub App flow |
| 6 | Fix Engine v1.5 | Claude Agent SDK backend behind `CodeAgentFactory` (OpenCode kept as OSS fallback); evidence-brief prompts replacing the bare stack trace; reproduce-with-failing-test where feasible; LocalVerify; draft PR with receipts incl. cost + egress summary. Every Day-1 PR goes through this path; the legacy single-shot path is retired behind it. | `CodeAgentFactory.ts` stubs, `FixExceptionTaskHandler.ts`, sandbox (P0.4) |
| 7 | Live Run view + Slack threads | Streamed reasoning + agent trace UI from structured events (P0.8); hypothesis tracking; multiplayer steering via thread replies; Mark right/wrong feedback capture. | WebSocket events, `WorkspaceNotificationRuleService` |
| 8 | Fix Report page | The shareable artifact with Slack unfurl, composing finding + transcript + evidence + PR + (Phase 2) verification. | New page over `AIAgentTask`, `AIAgentTaskPullRequest`, aggregation APIs |
| 9 | Autonomy ladder v1 + guardrails | L0–L2 per service; `AlertEpisode`-level investigation dedup; concurrency caps; per-investigation/run cost display; per-run egress manifest. | `AlertEpisode` grouping models, `LlmLog`, `AIBillingService` |
| 10 | Benchmark harness (internal) | OTel-Demo fault-injection suite as our pre-release eval gate; numbers not yet published. | Investigation engine in replay mode |

### Phase 2 — Close the Loop, Then Launch (Months 4–8)

Goal: the verification claims become true, then become the launch.

| # | Feature | What & why | Builds on |
|---|---|---|---|
| 1 | CI watch loop | Agent watches checks on its draft PR via the GitHub Checks API, iterates to green, flips ready-for-review. | PR sync + webhooks (P0.3), state machine states |
| 2 | Post-merge production verification | DeployWatch worker: merge + deploy marker → fingerprint watch → `ProductionVerified`/`Recurred` → receipt on PR, Fix Report, Slack; regression flag with revert suggestion. **The differentiator.** | Deploy markers (P0.5), PR sync (P0.3), fingerprint occurrence counting |
| 3 | Fixability auto-trigger GA | Automatic task creation behind the gate — enabled only now that the verification loop exists. Score v2 calibrated on Phase-1 merge/close outcomes. | P0.1 governors, P1.6 engine |
| 4 | Incident → fix pipeline | Conclusive investigations identify suspect deploy/commit and offer one-click "Draft fix PR" from the Slack thread with the causal chain attached; `FixIncidentRootCause` task type. | Incident-telemetry linkage (P0.6), evidence bundle |
| 5 | New task types | `AddRegressionTest`, `ImproveLogs`/`ImproveSpans`, `FixPerformanceIssues` (profile-diff driven, gated hard — performance is where agent success rates drop). | Dormant `CodeRepositoryImprovementAction` enum, `TaskHandlerRegistry`, `ProfileAggregationService` diff flamegraphs |
| 6 | GitLab + self-hosted Git | Implement the dormant `gitLabProjectId` path; generalize the GitHub-hardcoded `PullRequestCreator`. Self-hosters skew GitLab — core audience, not nice-to-have. | `CodeRepository`, `CodeRepositoryType.GitLab` |
| 7 | Handoff adapters + MCP v2 | Evidence-brief export to Claude Code / Copilot Agent tasks / Cursor Automations, tracking resulting PRs; curated MCP tools; published skills. | `CodeAgentFactory`, `MCP/ToolGenerator.ts` |
| 8 | In-product PR review surface | Diff + evidence + verification status + approve/request-changes proxied to GitHub — closes the "must leave OneUptime to review" dead end. | `AIAgentTaskPullRequest`, GitHub App |
| 9 | Project memory v1 | Outcome-fed, user-visible/editable memory injected into runs; reviewer-feedback ingestion from PR comments. | PR sync, investigation corpus; pgvector or ClickHouse embeddings |
| 10 | **Public launch** | Benchmark v1 published (`make benchmark`, failure cases included, gated on credible numbers); "Show HN: open-source AI SRE that opens PRs to fix production errors — and verifies the fix in production"; "Seer for self-hosters" page; pricing page with covenant. Timed to land with #2 live. | Everything above |

### Phase 3 — Compound (Months 8–14)

- **Recurrence → prevention PRs:** pattern-match new incidents against memory; recurring classes auto-queue `PreventRecurrence` with cross-incident evidence.
- **AI as schedulable on-call responder:** agent-responder type in `OnCallDutyPolicyEscalationRule` — page the AI first on designated alert classes; escalate to humans with the completed, cited investigation attached.
- **Runbook remediation under approval:** investigations propose runbook executions (restart, rollback, scale) run by the customer-hosted `RunbookAgent` executor, approval-gated; per-runbook auto-approve only at the top ladder rung.
- **Monitor/SLO tuning + alert-fatigue reports:** "this monitor fired 40 times, paged 12, produced 2 incidents — suggest threshold change," from investigation telemetry.
- **Status-comms agent:** audience-tailored, approval-gated status-page updates and postmortem publications — the "AI incident management" gap on a surface (status pages + subscribers) no competitor owns.
- **Weekly Reliability Report:** digest with attached draft PRs ("your maintenance window, already done"), on the existing workflow scheduler.
- **Earned autonomy graduation** (Section 6) and **benchmark v2** with community scenarios and third-party-runnable leaderboards, including handoff agents.
- **Sentry-DSN-compatible ingest wedge,** scoped and sized as its own project.

---

## 6. Trust & Safety Model

**The autonomy ladder** — set per project, overridable per service and per action class; default L1; every promotion suggested by the system with quantified receipts ("23 merged, 0 reverts, 96% verified — enable auto-ready-for-review for instrumentation PRs?") and revocable in one click.

- **L0 — Off/Observe.** No AI, or read-only findings and baselines only. Deterministic L0 work is never metered.
- **L1 — Investigate (default).** Auto-investigations, postmortem drafts, `/catchup`. Read-only against telemetry; no repo writes. Value before write access.
- **L2 — Propose.** Draft PRs with verification receipts, gated by fixability score and volume governors; one-click recommended actions (declare, page, draft) for humans to click.
- **L3 — Drive to green.** CI iteration on its own draft PRs; flips ready-for-review only when checks pass; drafts status updates and queues runbook executions, all pending approval.
- **L4 — Act within policy (earned, scoped).** Individually-enabled, audit-logged per-class rules: auto-publish "investigating" status updates, auto-run read-only diagnostic runbooks, auto-flip specific low-risk PR classes (e.g., `AddRegressionTest`, instrumentation PRs) to ready-for-review after a quantified track record. **No auto-merge rung exists at any level** — merging is always a human action behind the customer's own branch protection.

**Never, at any level, without explicit human action:** merging or approving any PR; pushing to a default branch; modifying CI config, secrets, or branch protection; production mutation outside an explicitly approved, customer-authored runbook; publishing customer-facing postmortems or status updates (the Phase 3 status-comms agent *drafts*; a human approves each publication — except the narrow L4 "investigating" auto-post class a customer individually enables); suppressing or rerouting pages; resolving or deleting incidents; exceeding the project budget cap (runs halt gracefully, state preserved); sending code or telemetry to any LLM provider the customer didn't configure; deleting telemetry or audit records.

**Verification stack:** every finding cites evidence verifiable in under 30 seconds; full agent traces stored on the `Investigation`/run and rendered in UI and Slack; reproducing test required where feasible, with honest "could not reproduce — confidence lowered" labels; never ask a human to review a red PR; post-deploy telemetry verification with failures reported as prominently as successes; inconclusive investigations labeled inconclusive, never padded — and free on hosted.

**Privacy contract, published and versioned:** fingerprints, stack traces, and selected normalized log/span excerpts go to the customer-configured LLM — never bulk raw telemetry; the per-run egress manifest makes it auditable; code goes only to the configured provider; self-hosters with Ollama/local endpoints run the entire loop air-gapped; agent execution is sandboxed with egress allowlists and scoped 1-hour GitHub installation tokens.

**Spend safety:** hard caps with graceful halt; per-investigation and per-fix cost displayed from `LlmLog`; `AlertEpisode`-level dedup so a storm is one investigation, not fifty; no mid-cycle lockouts; pre-run estimates before expensive runs.

**The kill-switch metric:** the percentage of projects that disable auto-investigation after enabling it is tracked as the canonical 3am-false-positive signal. If it climbs, confidence gating is too loose — and it gates further autonomy rollout.

---

## 7. Differentiation

**vs. Sentry Seer:** app-layer only — no infra, no pager, no status pages; closed-source, cloud-only, GitHub-cloud-only, $40/active contributor/month, and explicitly unavailable to self-hosted Sentry users (our ready-made audience, addressed directly by the "Seer for self-hosters" page). We are open-source, self-hostable down to Ollama, GitLab-capable, and we close two loops Seer doesn't: CI iteration and post-deploy production verification.

**vs. Datadog Bits AI:** the closest functional analog and the thesis validator — but closed, locked to Datadog's data, credit-metered with bills that spike exactly during incident storms, and stops at CI. We attack on pricing trust (BYO key, published cost-plus, episode dedup, inconclusive-free, hard caps), openness, the on-call/status surfaces Datadog doesn't own, and the production-verification receipt Bits never produces. Their Hypothesis Tree / Agent Trace transparency is the UX pattern to adopt, not fight.

**vs. Resolve/Traversal/Cleric/incident.io AI:** sales-gated, weeks-long onboarding, opaque pricing, built for 100+ engineer orgs; they rent context through integrations while we own the pager, telemetry, and repo natively — 10-minute self-serve for the teams they structurally abandon. We adopt their best ideas with receipts: Cleric's memory (made user-visible), Traversal's replay demo (made self-serve), incident.io's cited 2-minute Slack hypothesis — shipped open.

**vs. generic Claude + MCP:** we embrace it — curated MCP tools, skills, and evidence-brief handoff make OneUptime the context source even when someone else's agent does the surgery. What a raw agent cannot replicate without the platform: always-on triggering inside the alert/incident lifecycle, the deterministic evidence engine (fingerprinting, entityKeys, deploy correlation, fixability triage, dedup), the verification loop (CI + production telemetry), autonomy policy and audit, operational memory, and the multiplayer incident thread. A tool you invoke versus a loop that runs.

**One-line positioning:** *the open-source AI SRE that owns the whole loop — it investigates before you wake up, fixes with evidence, and proves the fix worked in production.*

---

## 8. Metrics

**Day-1 wow and activation**
- Time-to-first-investigation (toggle → replay or live investigation complete): p50 < 10 min. Time-to-first-finding (Lane B): p50 < 5 min. Time-to-first-draft-PR: p50 < 15 min from repo connect.
- Replay completion rate and "matched our postmortem" rate.
- First-session completion (telemetry + repo or replay) and Fix Report share rate / Slack unfurl click-throughs.

**Investigation quality**
- % of alerts/incidents with a cited hypothesis posted < 2 minutes (headline SLO).
- Conclusive rate; human-confirmed accuracy from Mark-right/wrong + postmortem reconciliation; benchmark scores published per release.
- Evidence-click rate (are humans verifying?) and multiplayer steering rate.
- MTTA/MTTR delta for investigated vs. non-investigated incidents within the same project.

**Fix quality (the numbers we publish)**
- PR merge rate (industry reference: ~68% on well-scoped bug fixes), revert rate (reference: 0.6%), human-follow-up-commit rate, reproduce-test attach rate, reviewer burden (PRs per reviewer per week — governed, not maximized).
- **Verified-fix rate:** % of merged AI PRs whose fingerprint shows zero recurrence at 7/30 days — the signature metric nobody else can report.

**Trust, cost, retention**
- Autonomy distribution and L1→L2→L3 graduation rate; the kill-switch metric (% disabling auto-investigation).
- Cost per investigation and per merged fix (target legibly under $5 BYO-key, from `LlmLog`); cap-hit rate (~0 with good dedup); postmortem-draft acceptance rate and edit distance.
- Memory hit rate ("seen before" retrievals humans confirm) — the compounding-value metric.
- Honeycomb-style cohort analysis: week-6 retention and monitor/alert-creation rates for AI-feature users vs. non-users.
- GTM: benchmark clones/third-party runs, MCP tool-call volume from external agents, self-hosted deployments with AI enabled (opt-in telemetry), BYO-key → hosted conversion.

**Program discipline:** weekly "Traces Hour" over production agent transcripts, plus the benchmark as the pre-release eval gate.

---

## 9. Risks & Mitigations

1. **Confidently wrong RCA at 3am** — the killer failure mode. *Mitigations:* citations on every claim; deterministic query layer under the LLM; honest inconclusive labeling; confidence gates on Slack pages vs. quiet dashboard findings; no heuristic confidence percentages (Section 2.4); Mark-wrong feedback loop; benchmark-gated releases; the kill-switch metric as the canary.
2. **AI slop / reviewer fatigue** (documented industry failure: 30 agent PRs/day on six reviewers). *Mitigations:* fixability gate before any spend; fingerprint dedup; enforced `maxOpenPullRequests`; drafts-only; tests required; CI-green before review; the Fix Scorecard making volume-vs-merge-rate visible.
3. **Alert-storm cost explosions.** *Mitigations:* `AlertEpisode`-level dedup; concurrency caps; hard budget caps with graceful degradation to L1; inconclusive-free hosted pricing; BYO key removes the meter entirely.
4. **Replay anti-sells when the RCA misses.** *Mitigations:* private-first replays; honest inconclusive states offering the next-best incident; replay quality gated on the internal benchmark before Lane A defaults on.
5. **Reproduce-test fragility** (no suite, flaky suites, arbitrary languages). *Mitigations:* explicit degradation tiers (reproduce-only → build/lint-verify → propose-with-lowered-confidence, labeled); flaky-test detection feeding memory; "add a test harness" as its own low-risk task type; `ImproveLogs`/`ImproveSpans` converting thin data into fixable findings.
6. **Security of an agent with repo write access** (malicious repo content, prompt injection via telemetry, exfiltration via the fix branch). *Mitigations:* Phase 0 sandboxing with network-off agent phase and egress allowlists; scoped 1-hour installation tokens; telemetry sanitization via the normalization layer; full audit trail; published threat model before launch.
7. **Trust debt from the legacy pipeline.** Today's path can open unverified push-and-pray PRs under the same brand. *Mitigations:* Phase 1 retires the single-shot path behind the draft-plus-receipts engine; relaunch under capability naming ("Investigations," "Verified Fixes"), no mascot.
8. **Self-host model variance** (a 7B Ollama model investigates worse than Claude). *Mitigations:* published model-capability matrix from the benchmark; per-feature minimum-model recommendations; graceful degradation where small models summarize deterministic toolbox results rather than running open-ended agency.
9. **Benchmark backfires on mediocre numbers / launch-before-loop hype.** *Mitigations:* the launch is sequenced after production verification ships (Section 2.6); iterate privately until the bug-fix merge rate is credible; publish with failure-case analysis — candor is the currency.
10. **Generic-agent commoditization.** *Mitigations:* invest where raw agents are structurally weak (evidence engine, always-on triggering, verification, memory, governance) and be the best context source for external agents (MCP v2, handoff) — we capture the workflow either way.
11. **Scope creep into autonomous remediation.** The market punishes it (the cascading auto-remediation horror story). *Mitigations:* the ladder is policy, not preference — no auto-merge rung exists; infra writes stay behind customer-authored, approval-gated runbooks permanently; remediation suggestions ship only in Phase 3, after the investigate→fix→verify loop has earned credibility.
12. **Incumbent speed and overloaded phases.** *Mitigations:* Phase 0 is genuinely six weeks of wiring verified assets (every item cites the existing code it flips on); the dual-lane wow shares one engine; we compete where Seer/Bits architecturally can't follow (self-host, BYO-key, GitLab, production verification, open benchmark) rather than feature-by-feature.

---

## 10. Spec Backlog — Design Docs to Write Before Building

This roadmap sets direction, sequencing, and guardrails. The following engineering design specs are deliberately *not* in this document and must be written (in this folder) before their phase begins. Each was flagged by the internal review as load-bearing.

**Before Phase 0 starts:**
- **Security & Sandbox Threat Model** — threats (malicious repo content, prompt injection via telemetry, exfiltration via fix branch), sandbox architecture choice (`@anthropic-ai/sandbox-runtime` vs containers), egress allowlist policy, package-manager/network policy during LocalVerify, GitHub-token lifecycle. Phase 0 #4 blocker.

**Before Phase 1 starts:**
- **Evidence Engine: RCA Query Toolbox** — name, input/output schema, cost, and caching strategy for each of the ~10 deterministic queries; the evidence-bundle composition format. Load-bearing for the Investigation Engine, Fix Engine briefs, and MCP v2.
- **Investigation Engine Design** — planning prompt, tool-use strategy (native tool-calling over the toolbox), state machine and termination criteria, hallucinated-query prevention, alert→investigation→Slack end-to-end example.
- **Fix Engine State Machine** — transition rules and failure handling per state (Reproduce fails → ?, non-compiling fix → retry budget → ?, CIWatch exhausted → ?), human-intervention triggers, retry/cost budgets, Claude Agent SDK integration (event schema → Run view mapping, evidence-bundle injection, sandbox lifecycle).
- **Test Reproduction Strategy** — per-language scaffolding, pre-check heuristics for "is this reproducible," degradation-tier labeling.
- **First Look Findings Algorithm** — ranking heuristics without baselines, entityKey-coverage fallbacks, card selection/diversity; validated against a synthetic net-new onboarding run.
- **Incident Replay Scoring** — what "matches the postmortem" means, scoring function, conclusive/inconclusive thresholds, fallback UX; calibrated on real historical incidents before Lane A defaults on.
- **Benchmark Design** — OTel-Demo fault scenarios, RCA-accuracy and fix-quality metrics, harness loop, publish format, go/no-go launch criteria.
- **Anomaly Detection v1** — algorithm choice (EWMA/3-sigma class for v1), baseline windows, metrics in scope, false-positive gates.
- **Execution Plan** — team composition, person-week estimates per Phase 0/1 item, dependency DAG, critical path, parallel workstreams. (Phase 0's "6 weeks" and Phase 1's "10 weeks" are wall-clock targets pending this sizing; Fix Engine v1.5 is the descope candidate if Phase 1 overloads — evidence-brief prompts ship first, reproduce-test can trail by a sprint.)

**Before Phase 2 starts:**
- **Production Verification Engine** — definition of "verified" (window, confidence vs. traffic volume), low-volume-service handling, regression detection, query-cost model, PR comment timing.
- **Fixability Scoring Model v2** — features, weights, thresholds, calibration procedure on Phase-1 outcomes.
- **GitLab Integration Spec** — OAuth/scopes, MR creation + state sync, webhook event mapping, draft-MR/approval-rule handling, self-hosted GitLab test plan.
- **Handoff Adapter Spec** — evidence-brief export formats, resulting-PR tracking, failure paths when external agents (Claude Code, Copilot, Cursor) error.
- **Monetization & Cost Governance Model** — hosted cost-plus markup, per-investigation/per-fix price points, cap-size guidance by team size, "inconclusive-free" mechanics, autonomy-level cost implications.
- **`oneuptime.md` / Repo Brief Spec** — schema, auto-generated defaults, sync model, security constraints (it must not be able to weaken the sandbox), versioning.

---

## Appendix: Reuse vs. Replace

**Keep and build on:** `AIAgentTask` state machine + Semaphore task numbering + KEDA autoscaling; `TaskHandlerRegistry`; `WorkspaceManager` (hardened with sandbox); `TaskLogger` (upgraded to structured events); GitHub App auth and webhook verification (`GitHubAPI.ts`, `GitHub.ts`); `LlmProvider`/`LlmLog`/`AIService`/`AIBillingService` metering and billing; telemetry schema (fingerprinting + normalization, entityKeys, trace↔log linkage, `ExceptionInstance.release`); all five aggregation services incl. diff flamegraphs; `MetricBaselineHourly`; `IncidentAIContextBuilder` and siblings (already wired user-triggered; gains auto-triggers); `AlertEpisode` grouping; `WorkspaceNotificationRuleService` + Slack/Teams utils; the workflow engine; `RunbookAgent` + Executor; MCP server (curated tools added); `ServiceCodeRepository` safety fields (finally enforced); `PullRequestCreator` (draft flag finally flipped).

**Replace:** `OpenCodeAgent` as the sole execution path (becomes one pluggable backend behind `CodeAgentFactory`, with Claude Agent SDK first-class); the single-shot fix flow (becomes the verification state machine); the bare stack-trace prompt (becomes the evidence brief); FIFO-only queueing; write-once PR records; manual-only triggering (becomes fixability-gated, post-verification-loop); the fragmented AI settings UX (becomes one AI hub with the privacy contract on the front page).
