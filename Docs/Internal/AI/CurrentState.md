# AI & Code Repository Features — Current State Assessment

> Internal doc. Last updated: June 2026. Companion to [Roadmap.md](./Roadmap.md) and [MarketLandscape.md](./MarketLandscape.md).
>
> This is an honest inventory of what exists in the codebase today, what works, and what blocks the vision: *"OneUptime continuously improves customer software using the telemetry it collects, automatically identifying issues and opening PRs that fix bugs and prevent incidents."*

## TL;DR

We have already built a real, end-to-end **exception → AI agent → GitHub PR** pipeline. That is rare — almost nobody in the market has this shipped, and no open-source product does. But it is a skeleton: one task type, one git provider, one code agent, no verification, no intelligence about *what* to fix, no proactive surface, no feedback loop, and a UX that hides the magic. The foundations (task queue, billing, LLM abstraction, GitHub App, telemetry layer, incident stack, MCP server) are solid and worth keeping. The intelligence and the experience around them are what the overhaul must build.

---

## 1. The AIAgent service (`AIAgent/`)

A standalone microservice (port 3875) that polls the backend for tasks and executes them.

**How it works today:**

1. `TelemetryExceptionService.createAIAgentTaskForException()` creates an `AIAgentTask` (status `Scheduled`) with exception metadata. Today this is effectively manual/on-demand — there is no automatic trigger wired into exception ingestion.
2. The agent polls `POST /api/ai-agent-task/get-pending-task` every 60s, authenticating with `AI_AGENT_ID` + `AI_AGENT_KEY`. FIFO by age, one task at a time.
3. `FixExceptionTaskHandler` (`AIAgent/TaskHandlers/FixExceptionTaskHandler.ts`) orchestrates: fetch exception details → find repositories linked to the service via Service Catalog → clone each repo (HTTPS `x-access-token:` auth) → branch `oneuptime-fix-exception-{taskId}` → run the code agent → commit, push → open a GitHub PR via REST API → record it via `/ai-agent-data/record-pull-request`.
4. `OpenCodeAgent` (`AIAgent/CodeAgents/OpenCodeAgent.ts`) shells out to the **OpenCode CLI** with the stack trace as prompt and a generated `opencode.json` pointing at the project's LLM provider (Anthropic / OpenAI / Ollama). 30-minute hard timeout.
5. Logs stream back via buffered `TaskLogger` (batch 10, 5s flush). Status → `Completed`/`Error`. Stuck tasks are reset by `App/FeatureSet/Workers/Jobs/AIAgent/TimeoutStuckTasks.ts`.
6. KEDA autoscaling hook exists (`/metrics/queue-size` + `get-pending-task-count`).

**Key files:** `AIAgent/Jobs/ProcessScheduledTasks.ts`, `AIAgent/TaskHandlers/FixExceptionTaskHandler.ts`, `AIAgent/CodeAgents/*`, `AIAgent/Utils/{BackendAPI,RepositoryManager,PullRequestCreator,WorkspaceManager,TaskLogger}.ts`.

**What's good:** clean task-handler registry pattern (extensible to new task types), isolated workspaces with path-traversal protection, buffered log streaming, agent registration/heartbeat (`Alive.ts`), KEDA-ready.

**Critical gaps:**

- **One task type.** `AIAgentTaskType` contains only `FixException`. `CodeRepositoryImprovementAction` defines `ImproveLogs`, `ImproveSpans`, `ImproveMetrics`, `FixPerformanceIssues` — none implemented.
- **One code agent.** Goose / Claude Code / Aider integrations are commented out. OpenCode is a single-shot shell-out: no plan step, no test-running, no iteration against failures.
- **No verification.** The agent never runs the customer's tests, never watches CI, never validates the fix compiles. PRs ship as-is, ready-for-review (not draft).
- **GitHub-only PRs.** `PullRequestCreator` is hardcoded to the GitHub REST API. `CodeRepositoryType.GitLab` exists in the enum but has no implementation.
- **No intelligence about what to fix.** Every exception is treated equally — no fixability scoring, no impact ranking, no dedup beyond "one active task per exception fingerprint."
- **No feedback loop.** PR state (`Open`) is written once and never synced. Nobody knows if the PR merged, if the exception stopped recurring, or if the fix was reverted.
- **Settings the UI promises aren't enforced.** `ServiceCodeRepository.enableAutomaticImprovements`, `maxOpenPullRequests` (default 3), and `restrictedImprovementActions` are stored but never checked anywhere in the task pipeline.
- **No task cancellation, prioritization, retry policy, or concurrency** (sequential, FIFO only).

## 2. AI data models & billing (`Common/Models/DatabaseModels/`, `Common/Server/Services/`)

**What exists and is solid:**

- `AIAgent` — agent registry: key auth, heartbeat (`lastAlive`, GlobalCache-debounced), `connectionStatus`, global vs. customer-deployed agents, default-agent-per-project, owners/labels. Gated to Growth plan.
- `AIAgentTask` — task queue with per-project `taskNumber` (Semaphore-protected increment), status state machine (`Scheduled → InProgress → Completed/Error`), JSON `metadata`.
- `AIAgentTaskLog`, `AIAgentTaskPullRequest` (PR metadata incl. state, branch refs, repo), `AIAgentTaskTelemetryException` (junction), `AIAgentOwnerUser/Team`.
- `LlmProvider` — six backends (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama), encrypted BYO API keys, custom base URLs, project-level vs. global providers, default selection, `costPerMillionTokensInUSDCents`.
- `LlmLog` — full metering: tokens, cost in USD cents, feature attribution tag, request/response previews, latency, status (incl. `InsufficientBalance`), links to incident/alert/user.
- `AIService` (`Common/Server/Services/AIService.ts`) — wraps every LLM call with provider resolution (project default → global default), pre-call balance check, post-call cost deduction, logging.
- `AIBillingService` — AI credit balance on `Project` (`aiCurrentBalanceInUSDCents`), manual recharge, auto-recharge with thresholds, owner notifications on failure/low balance.

**Gaps:** no per-project rate limiting or budget caps beyond balance; no cost estimate before a run; no response caching; no prompt versioning; no model override per task; no cost attribution per service/team.

**Verdict:** the metering/billing layer is genuinely ahead of most competitors (transparent per-token cost with BYO-key zero-margin path) and should be kept nearly as-is.

## 3. Code repository integration

- **GitHub App flow is complete and production-quality** (`Common/Server/Utils/CodeRepository/GitHub/GitHub.ts`, `Common/Server/API/GitHubAPI.ts`): JWT state tokens, OAuth callback, installation tokens scoped to `contents:write, pull_requests:write, metadata:read`, stale-installation cleanup, HMAC webhook signature verification.
- `CodeRepository` model: org/repo/main-branch/URL, `gitHubAppInstallationId`, unused `gitLabProjectId` and `secretToken` fields.
- `ServiceCodeRepository`: links services to repos with `servicePathInRepository` (monorepo support), plus the three unenforced governance fields noted above.
- **Webhook handler is a stub** — no PR-state sync, no merge/close/review processing. `AIAgentTaskPullRequest.pullRequestState` is never updated after creation.
- PAT fallback ("Connect with Access Token") UI exists but the flow is incomplete.

## 4. Telemetry layer (the context goldmine)

ClickHouse + OTel ingestion. This is OneUptime's unfair advantage as agent context, and it is rich:

- **Five signals:** Logs, Spans, Metrics, ExceptionInstances, Profiles (pprof, with flamegraph + diff-flamegraph APIs).
- **Cross-signal linking:** logs and spans share `traceId`/`spanId`; exceptions are extracted from span events with trace/span refs; everything carries `primaryEntityId` + `entityKeys` (hashed service/host/pod/cluster/container identities) for cross-cutting queries.
- **Exception fingerprinting** (SHA256 over normalized message/stack/type, 25+ normalization regexes) with Postgres-side `TelemetryException` aggregation: occurrence counts, first/last seen, resolved/archived states.
- **Aggregation services** per signal (histograms, facets, percentiles, top-lists) behind `TelemetryAPI` (28 endpoints).
- Per-service retention via `retainTelemetryDataForDays` → ClickHouse TTL.

**What's missing for autonomous RCA — the single biggest platform investment area:**

- No deploy/release markers or change events (only a `service.version` string attribute). No "exception spike ↔ deploy" correlation.
- No anomaly detection, baselining, trend, or outlier APIs. Nothing Watchdog-like.
- No cross-signal RCA query ("give me the full evidence bundle for this exception: trace tree, surrounding logs, related metrics, profile delta, recent deploys").
- No incident↔telemetry linkage in the schema; `MonitorLog` is separate from service telemetry.
- Profiles aren't linked to spans/exceptions.
- No SLO/error-rate primitives, no composite alert conditions.

## 5. Incident / alert / monitor stack

Mature and complete as a workflow engine: monitors → probes → alerts (with per-series fingerprinting, episodes/grouping) → incidents (severity, state timelines, owner/label/on-call rule engines, Slack/Teams posting via `WorkspaceNotificationRule`), on-call escalation chains, postmortem fields (`rootCause`, `postmortemNote`, templates), status pages.

**AI hooks that exist but are dormant or buried:**

- `IncidentAIContextBuilder` (`Common/Server/Utils/AI/IncidentAIContextBuilder.ts`) builds LLM context from incident timeline/notes/workspace messages — **not hooked into the incident lifecycle**.
- Postmortem/note generation endpoints exist on `IncidentAPI`/`AlertAPI` but are user-pulled, not proactive, and fetch no underlying telemetry (no logs/metrics/traces that triggered the incident).
- No incident → fix-PR path at all. The incident stack and the AIAgent pipeline are entirely disconnected today.

## 6. Dashboard UX

What a user sees today: `AI Agent Tasks` list (status tabs, logs tab, PRs tab), Settings spread across four pages (Global/Self-Hosted AI Agents, Bring Your Own LLM, AI Credits, AI logs), Code Repositories page (GitHub App or token connect).

**The experience hides the product:**

- Exception pages don't show "AI is fixing this" or link to tasks/PRs; PRs don't link back to the exception/incident that caused them.
- Task creation is invisible (users can't see *why* a task appeared) and there's no manual trigger/cancel/retry UI.
- No notifications ("PR #1247 opened for the exception you were paged about").
- No analytics: fix success rate, merge rate, cost trends, time saved.
- Marketing site (`Home/.../ai-agent.ejs`) promises "Stop debugging. Start merging fixes," a chat interface, and root-cause analysis — most of which the product doesn't deliver yet. The gap between pitch and product is a churn risk.

## 7. Automation platform (assets to orchestrate)

- **Workflows** (`App/FeatureSet/Workflow`): node-graph automation, 4 trigger types (webhook, manual, cron, on-create/update/delete for 100+ models via `@EnableWorkflow`), components for Slack/Teams/email/HTTP/JS-sandbox. Gaps: analytics models (logs/traces/metrics) can't trigger workflows; no AI components.
- **RunbookAgent** (`RunbookAgent/`): self-hosted script executor with heartbeat + job claiming — a ready-made **action arm** for remediation (restart, rollback, scale) that is currently disconnected from incidents, workflows, and AI.
- **MCP server** (`MCP/`): auto-generates CRUD tools for 100+ models with API-key auth. Exists but is CRUD-shaped, not investigation-shaped (no "query logs around this trace," no "get exception evidence bundle").

## 8. LLM infrastructure

- `LLMService` (`Common/Server/Utils/LLM/LLMService.ts`) routes to six providers; defaults: `gpt-4o`, `claude-sonnet-4-20250514`, `llama-3.3-70b-versatile`, `mistral-large-latest`.
- `docker-compose.llm.yml` defines a local HuggingFace-model service (GPU-reserved, port 8547) — currently a placeholder (`/LLM` Dockerfile is empty).
- Helm chart ships an optional `ai-agent` deployment with KEDA autoscaling support.

## 9. What we should keep, fix, and replace

| Verdict | Component |
|---|---|
| **Keep** | Task queue + status machine, LlmProvider/LlmLog/AIService billing stack, GitHub App auth, telemetry schema + fingerprinting, incident stack, MCP server skeleton, KEDA/Helm deployment story |
| **Fix / extend** | Webhook handler (PR-state sync), `ServiceCodeRepository` governance enforcement, exception→task auto-triggering with gating, dashboard cross-linking, `IncidentAIContextBuilder` lifecycle hooks, workflow triggers from analytics models |
| **Replace / build new** | Single-shot OpenCode shell-out → proper agent harness with plan/verify/iterate loops and pluggable backends; absent context engine (RCA evidence bundles, deploy markers, anomaly baselines); absent proactive surface (findings feed, Slack-first investigation); absent feedback loop (PR outcome → exception recurrence → agent memory) |

The detailed plan for these is in [Roadmap.md](./Roadmap.md).
