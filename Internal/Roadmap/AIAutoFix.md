# Plan: Make OneUptime the Platform that Watches Production and Fixes Code Automatically

## Context

OneUptime's current product is an observability platform: it ingests telemetry (logs, metrics, traces, spans, exceptions) via OTLP, stores it in ClickHouse, surfaces incidents/alerts, runs synthetic probes, and links each `Service` to one or more `CodeRepository` records via `ServiceCodeRepository`. It also exposes 100+ tools through an MCP server (`MCP/`), runs an event-driven `Workflow` engine, and has a `RunbookAgent` that executes bash steps in customer infrastructure.

The mission for the next phase: OneUptime should not stop at observing production — it should **close the loop and improve the software automatically with AI-authored code changes**. Every signal we already collect (an unhandled exception, a p95 regression, a failing synthetic probe, a CVE in a dependency, a code path that has gone cold) becomes the input to an `Improvement`: a structured, auditable unit of work that an AI agent diagnoses, patches in a sandbox, and ships through a policy gate back into the customer's repository.

This plan defines the data model, the agent runtime, the safety boundaries, and the phased rollout. It assumes the existing `AIAgent` service is retired (see "Deprecated" below) and the new platform is built from scratch on top of the existing telemetry, service catalog, MCP, and workflow primitives.

## Deprecated

The following will be removed before Phase 0 work begins. Keep frozen in-repo (no deletes) until Phase 1 ships, so we can mine it for migration learnings.

- **`/AIAgent` service** — single-task (`FixException` only), tightly coupled to one Git/PR flow, no policy layer, no sandbox isolation, no verification loop. Will be replaced by the `Improvement Runtime` defined in Phase 0.
- **`FixExceptionTaskHandler`** and the `CodeAgentFactory` registry in `/AIAgent/CodeAgents` — superseded by the pluggable `PatchAgent` interface in Phase 1.

## Completed

None — this is a fresh build. The existing `AIAgent` is explicitly excluded; see "Deprecated".

## Gap Analysis Summary

The comparison column is the best-in-class behavior available today across the AI-fix landscape. No single product does all of this end-to-end — that is the opportunity.

| Capability | OneUptime Today | Industry Best-in-Class | Priority |
|---|---|---|---|
| Production signal → structured improvement candidate | Incidents/Alerts exist but no AI handoff | Sentry Seer (exceptions only); GitHub Copilot Autofix (CodeQL only) | **P0** |
| Service ↔ code repository linkage | Present (`ServiceCodeRepository`) | Sentry source-map repo link; CodeSee | **P0** |
| Per-service autonomy / autofix policy | None | None at this granularity (org-wide toggles only) | **P0** |
| Sandboxed code execution environment | None | Devin scratchpad; Cursor agent runner | **P0** |
| Telemetry-driven reproducer in sandbox | None | Sentry Seer reads stack frame only | **P0** |
| AI-authored patch with generated test | Old `AIAgent` (no test gen) | Devin, Sweep, Codium | **P0** |
| PR with rich incident/telemetry context | Old `AIAgent` (sparse context) | Sentry Seer PR body; Linear/Jira deep links | **P0** |
| Confidence + blast-radius scoring | None | None standardized | **P1** |
| Per-service trust score / earned autonomy | None | None | **P1** |
| Canary deploy + auto-rollback on metric regression | None | LaunchDarkly + Datadog Watchdog (manual wiring) | **P1** |
| Performance-regression-driven fixes | None | None autonomous | **P1** |
| Dependency CVE → patch PR | None | Dependabot / Renovate (no code-level fix) | **P1** |
| SLO burn → fix | None | None | **P2** |
| Dead-code / cold-path refactor suggestions | None | None telemetry-backed | **P2** |
| Cost-anomaly-driven optimization fixes | None | None | **P2** |
| Third-party Improvement agent marketplace | None | None (closed platforms) | **P3** |
| Provenance / audit trail per AI-authored line | None | Limited (commit author only) | **P0** (non-negotiable) |
| Reproducer-required gate (no patch without repro) | None | None enforced | **P0** (non-negotiable) |
| Open-weight models + open-source harness | None | Closed (all current AI-fix products are proprietary stacks) | **P0** (non-negotiable) |

---

## Signal → Fix Catalog

What OneUptime observes (left column) and what an `Improvement` typically proposes (right column). Each row maps to a data source we already ingest or are landing on the broader roadmap. The **Confidence** column is the *starting bias* before per-Improvement scoring: `High` = we expect to earn unattended auto-merge here by Phase 3; `Medium` = open-PR for review by default; `Low` = review-required forever, the AI is a suggester not a deployer. **Phase** is when the agent for that signal first ships.

### Application Telemetry

| Signal | What we see | What we patch | Confidence | Phase |
|---|---|---|---|---|
| **Unhandled exception** | `ExceptionInstance` recurring, ≥1 stack frame in owned repo | Null/undefined guard; type narrowing; missing `try/catch`; input validation; off-by-one; race-condition fix | High | 1 |
| **5xx rate spike on endpoint** | HTTP server span `status=ERROR` rising on a specific operation | Fix the actual 5xx cause traced from spans; or add retry / circuit breaker / timeout fix when the cause is downstream | Medium | 1 |
| **Error-class spike** | Log `severity=ERROR` matching a message template rising | Same patterns as exceptions; plus error-handling redirects (return vs throw); message-template fix | Medium | 1 |
| **p95 / p99 latency regression** | Operation latency up ≥X% vs 7-day baseline | N+1 query → batch; missing index (emits a registered migration per `AGENTS.md`); missing cache; payload pagination; sequential awaits → parallel | Medium | 2 |
| **SLO burn ≥ 2x sustained** | Error budget burn elevated | Composite — routes to the appropriate latency or error fix above | Medium | 2 |
| **Memory monotonically rising** | RSS growing without GC recovery | Unclosed handle / connection; `removeListener` fix; cache with TTL / LRU eviction; `clearTimeout` / `clearInterval` | Medium | 2 |
| **CPU sustained high** | Host CPU stuck high on a service process | Memoize; replace expensive regex / `JSON.parse` in hot loop; sync I/O → async; batch | Medium | 2 |
| **Crash loop** | Kubernetes events show `CrashLoopBackOff`; logs show fatal startup error | Env-var default + clear error message; fix startup ordering; pin transitive dep | High | 2 |
| **Flaky operation** | High error rate that disappears on retry | Idempotency key; race-condition fix (mutex, atomic compare); timeout-too-short fix | Medium | 2 |

### Infrastructure & Probe Telemetry

| Signal | What we see | What we patch | Confidence | Phase |
|---|---|---|---|---|
| **Synthetic HTTP probe failing** | `Probe` reports failure on monitored endpoint | Revert offending config change; fix broken redirect; fix CORS / CSRF config; fix SSL renewal automation | High | 2 |
| **TLS cert expiring** | Probe surfaces expiry within N days | Fix `cert-manager` config; renew via runbook automation | High | 2 |
| **Disk filling** | Host disk trending toward full | Add `logrotate`; raise rotation cadence; suppress noisy log line; lower retention | Medium | 2 |
| **DNS probe failing** | Probe DNS resolution failure | IaC DNS record fix (when Terraform / Pulumi repo linked); flagged for manual otherwise | Low | 2 |

### Dependency & Supply Chain

| Signal | What we see | What we patch | Confidence | Phase |
|---|---|---|---|---|
| **CVE in dependency** | OSV.dev advisory matches lockfile | Upgrade + adapt breaking call sites + run tests; pin to safe version; remove unused dep | High (when reachability is proven via telemetry) | 2 |
| **Deprecated API in use** | Deprecation log emitted at runtime | Migrate call sites to the recommended replacement | Medium | 2 |
| **Outdated dep, no CVE** | Major version behind current | Upgrade + adapt (opt-in only) | Low | 4 |

### Database & Query

| Signal | What we see | What we patch | Confidence | Phase |
|---|---|---|---|---|
| **Slow query** | DB span duration outlier; query text captured | Index migration (registered per `AGENTS.md` postgres convention); query rewrite; `LIMIT` cap | High | 2 |
| **Connection pool exhaustion** | DB connection errors in logs | `finally { release() }`; convert to pool transaction helper | High | 2 |

### Security & Privacy

| Signal | What we see | What we patch | Confidence | Phase |
|---|---|---|---|---|
| **Credentials in logs / URLs** | `LogScrubRule` fires repeatedly on outbound URL | Move secret to header; apply redaction helper; rotate + remove | High | 2 |
| **Stack trace returned to client** | 5xx response body contains stack-trace pattern | Wrap in generic error handler; log internally, return safe message | High | 2 |
| **SSRF / open-redirect pattern** | Outbound HTTP from server to user-supplied URL, no allowlist | URL allowlist; reject internal IPs | Medium (review-required) | 3 |

### Cost & Efficiency

| Signal | What we see | What we patch | Confidence | Phase |
|---|---|---|---|---|
| **Egress spike** | Outbound bandwidth jump on a service | Cache layer; field projection (select only needed); compression | Medium | 4 |
| **Storage-class waste** | (Once cloud-cost ingest lands) cold data on hot storage | Lifecycle policy (IaC change) | Low | 4 |

### Code & Usage (Proactive)

| Signal | What we see | What we patch | Confidence | Phase |
|---|---|---|---|---|
| **Cold path** | Zero executions in 90 days (span / log absence) | Delete code + tests + downstream usages; or mark deprecated first | Low (review-required) | 4 |
| **Dead config** | Env var never read; feature flag always-off | Remove from code, config, IaC | Medium | 4 |
| **Log noise** | One template accounts for > X% of log volume | Lower severity; remove; sample | High | 4 |

---

## Guiding Principles (Non-Negotiable)

These constraints apply to every phase. They exist before features because the failure modes of AI-fix products — shipping plausible-but-wrong patches, leaking PII in sandboxes, eroding customer trust through over-autonomy — kill the product faster than missing features do.

1. **Explicit autonomy ladder.** Every `Service` starts at `off`. Customers climb the ladder deliberately per service: `off → suggest → open-PR → auto-merge → auto-deploy`. Never auto-promote a service, and never inherit autonomy from the project level.
2. **Honest verification.** Refuse to open a PR for an `Improvement` whose reproducer the sandbox could not execute. "We couldn't reproduce" is a valid terminal state; a plausible-but-unverified patch is not.
3. **Sandbox isolation per customer.** Code execution containers are ephemeral, network-egress-restricted, and never shared across customers. Exceptions carry PII; treat the sandbox as a privacy boundary.
4. **Provenance on every line.** Every AI-authored change is signed and traceable to `Improvement ID + Agent ID + Model + Prompt hash + Telemetry inputs`. Required for audit, rollback, and post-incident review.
5. **Close the loop or close the Improvement.** An `Improvement` is not complete when the PR merges — it is complete when the metric it was opened against has moved (error rate, p95, SLO burn). If post-deploy the metric does not move, the Improvement reopens automatically.
6. **Open weights, open harness.** Every agent in the loop runs on **open-weight models** (Qwen3-Coder, DeepSeek-Coder, GLM, Kimi K2, Llama, Codestral, etc.) routed through an **OpenAI-compatible Model Gateway**, and wraps an **open-source coding harness** ([sst/opencode](https://github.com/sst/opencode) by default; [Goose](https://github.com/block/goose) and [Aider](https://github.com/Aider-AI/aider) as alternatives). Customers can run the full pipeline on their own GPUs — code, telemetry, and prompts never leave their boundary in self-hosted mode. OneUptime ships a hosted default, but never depends on a proprietary model API as the single path. This is why: customer sovereignty (regulated industries cannot ship production code or PII-bearing telemetry to a third-party LLM), predictable cost as the loop scales, and the freedom to swap models as the open-weight frontier moves quarter-to-quarter.

---

## Phase 0: Foundation — The Improvement Loop

Land the core abstraction, data model, sandbox, and per-service policy. No customer-facing autofix yet; this is the substrate everything else builds on.

### 0.1 `Improvement` Model

**Current**: No equivalent. `Incident` and `Alert` exist but are not designed as inputs to a code-change workflow.

**Target**: New database model `Improvement` representing a single unit of AI-driven change. Fields include:
- `serviceId` (FK → `Service`)
- `codeRepositoryId` (FK → `CodeRepository`, resolved via `ServiceCodeRepository`)
- `signalType` (enum: `Exception`, `PerformanceRegression`, `SLOBurn`, `DependencyCVE`, `ColdPath`, `CostAnomaly`, `Manual`)
- `signalRef` (polymorphic: `IncidentId`, `AlertId`, `ExceptionInstanceId`, `MetricMonitorId`, etc.)
- `stage` (enum: `Detected`, `Diagnosing`, `Patching`, `AwaitingReview`, `Merged`, `Deployed`, `Verified`, `Reverted`, `Failed`)
- `confidence` (0.0–1.0, populated by the Diagnose agent)
- `blastRadius` (enum: `Low`, `Medium`, `High` — derived from diff size, files touched, service criticality)
- `reproducer` (JSON: sandbox script + inputs + expected failure)
- `patchPullRequestUrl`, `patchDiffStats`, `patchAgentId`, `patchModelVersion`, `promptHash`
- `verificationMetric` (the metric whose recovery closes the Improvement)
- `verificationDeadline`, `verificationResult`
- `@EnableMCP()`, `@EnableWorkflow()` decorators so it is queryable and event-routable like other first-class models

### 0.2 `AutofixPolicy` Per-Service Config

**Current**: No concept.

**Target**: New model `AutofixPolicy` linked one-to-one with `Service`. Fields:
- `autonomyLevel` (enum: `Off`, `SuggestOnly`, `OpenPR`, `AutoMerge`, `AutoDeploy` — default `Off`)
- `allowedSignalTypes` (multi-select; subset of `Improvement.signalType`)
- `maxDiffLines`, `maxFilesChanged`
- `requiredReviewers` (FK → `User[]` / `Team[]`)
- `branchNamePrefix` (default `oneuptime/improvement/`)
- `targetBranch` (defaults to `CodeRepository.mainBranchName`)
- `dailySpendCap` (USD — caps agent token + sandbox compute per service per day)
- `pausedUntil` (kill-switch with timestamp)

Surface in dashboard at `Service settings → AI Autofix`. Audit-log every change.

### 0.3 Sandbox Executor Service

**Current**: None. Old `AIAgent` cloned into its own process — no isolation, no language toolchain matrix, no resource limits.

**Target**: New standalone service (sibling to `Worker`, `Probe`, etc.) that exposes a job API:
- `POST /sandbox/jobs` with `{ repoUrl, ref, commands[], inputs{}, timeoutSec, languageProfile }`
- Provisions an ephemeral container per job, image selected by `languageProfile` (`node-20`, `node-22`, `python-3.12`, `python-3.11`, `go-1.23`, `java-21` — start with these five)
- Mounts no persistent storage; network egress allow-list per customer (default: package registries only)
- Returns artifacts: command outputs, exit codes, file diffs, captured stderr
- Resource caps: 4 vCPU / 8 GB RAM / 30-min wall clock / 10 GB scratch — overridable per `AutofixPolicy`

The sandbox is the privacy boundary. Customer code, customer secrets (when needed for repro — e.g. test DB URL), and customer PII (in captured request payloads) all live and die inside the container.

### 0.4 Extend MCP Surface for Agent Actions

**Current**: MCP exposes read/write tools for database models. No tools yet for "open a PR", "post a sandbox job", "fetch the full stack trace + surrounding logs for an exception".

**Target**: Add the following MCP tools (consumed by the in-process Improvement agents in Phase 1, and exposed externally in Phase 5):
- `oneuptime_getImprovementContext(improvementId)` → bundles signal + telemetry slice + service + repo metadata
- `oneuptime_runSandboxJob(...)` → wraps the Phase 0.3 API
- `oneuptime_openPullRequest(improvementId, branch, title, body, diff)` → uses the customer's stored Git OAuth token
- `oneuptime_updateImprovementStage(improvementId, stage, payload)`
- `oneuptime_fetchTelemetrySlice(serviceId, timeRange, filters)` → unified query over logs/spans/exceptions for context window

### 0.5 Git Provider OAuth at the Service Level

**Current**: Repo credentials stored on `CodeRepository`, scoped per repo.

**Target**: Keep the existing per-repo model — it is already the right granularity for the autonomy boundary. Add: scoped tokens with minimum permissions (`contents:write`, `pull_requests:write` only — never `admin`), token rotation surfacing, and a "test connection" probe that posts a no-op branch to verify write access before `AutofixPolicy.autonomyLevel` can be raised above `SuggestOnly`.

### 0.6 Open-Source Patch Harness + Model Gateway

**Current**: Old `AIAgent` was wired to a single proprietary model with no abstraction layer — no way to self-host, no role separation, no harness choice.

**Target**: Two new components, both fully open-source and self-hostable. This is the unblocker for Phase 1.2 and 1.3; nothing in Phase 1 lands until 0.6 lands.

**Model Gateway** — an OpenAI-compatible proxy (built on [LiteLLM](https://github.com/BerriAI/litellm), MIT) configured per project. Requests are routed by **role**, not by model name, so the model behind each role can swap without touching agent code:

- `classify_model` — Detect-stage rule firing (does this signal warrant an Improvement?). Cheap and fast. Default: 7B-class open-weight coder.
- `diagnose_model` — Diagnose-stage reasoning. Default: 30B-class open-weight coder (Qwen3-Coder-30B or DeepSeek-V2.5 class).
- `patch_model` — Patch-stage code generation. Default: top open-weight coder (Qwen3-Coder-480B MoE, DeepSeek-V3, or Kimi K2).
- `embed_model` — Repo embeddings for context retrieval. Default: `nomic-embed-code` or `jina-code-v2` (both open-weight).

Each role independently swappable per project to: (a) OneUptime-hosted vLLM / SGLang cluster, (b) the customer's own self-hosted endpoint, (c) a hosted open-source provider (Together AI, Fireworks, OpenRouter, DeepInfra), or (d) for non-OSS-strict customers who explicitly opt in, a commercial API. The default ships pointing at OneUptime-hosted open-weight models. **Specific model names are not load-bearing** — the gateway abstracts them so the frontier can move without re-architecting.

**Patch Harness** — wraps the per-job agentic loop (read repo, edit files, run tests, iterate). Pluggable via a `PatchHarness` interface implemented in `ImprovementRuntime`:

- `OpenCodePatchHarness` (default) — wraps [sst/opencode](https://github.com/sst/opencode); MIT-licensed; TypeScript; runs headless inside the sandbox container (Phase 0.3); consumes the Model Gateway via the OpenAI-compatible base URL.
- `GoosePatchHarness` — wraps Block's [Goose](https://github.com/block/goose); Apache 2.0; alternative for customers preferring its extension model.
- `AiderPatchHarness` — wraps [Aider](https://github.com/Aider-AI/aider); Apache 2.0; alternative when diff-precise git-aware editing matters most (smaller, more conservative edits).

Each `Improvement` records `patchHarnessId` + `patchHarnessVersion` + `patchModelId` + `patchModelVersion`. This feeds the Provenance principle and lets us A/B harnesses on the same Improvement queue. The harness choice is per-`AutofixPolicy`, so customers can run a different harness on different services if needed.

**Self-hosted reference deployment.** Ship a Helm chart that brings up the full stack — Improvement Runtime + Sandbox Executor + LiteLLM Gateway + a vLLM-served open-weight `patch_model` — on customer GPUs. This is the proof that "open weights, open harness" isn't a marketing claim: a regulated customer can run the entire AI-fix loop in their own VPC, with zero outbound calls to OneUptime or any LLM provider.

---

## Phase 1: Exception → Pull Request, Done Excellently

One signal type. One language ecosystem (Node/TypeScript). Done so well that customers opt in.

### 1.1 Detect: Exception → Improvement Candidate

**Current**: `ExceptionInstance` exists in ClickHouse with stack trace, service linkage, occurrence count.

**Target**: Detection rule (defaults shipped, customer-overridable per service):
- Exception occurred ≥ N times in last 24h (default N=5) **and**
- At least one stack frame resolves to a file path inside the linked `CodeRepository` **and**
- No open `Improvement` already exists for this exception group **and**
- `AutofixPolicy.autonomyLevel ≥ SuggestOnly` and `signalType` includes `Exception`

Emits one `Improvement` per exception group (not per occurrence). The grouping key is the existing exception fingerprint.

### 1.2 Diagnose: Root Cause + Reproducer Generation

**Current**: None.

**Target**: Diagnose agent runs in the `ImprovementRuntime` worker, invoking the `diagnose_model` role through the Model Gateway (Phase 0.6, open-weight by default). It does not edit code; it reads via MCP tools (`oneuptime_fetchTelemetrySlice`, `oneuptime_getImprovementContext`) and sandbox commands. Inputs:
- Full stack trace + resolved source ranges from the linked repo (clone via sandbox)
- Recent commits to files in the stack trace (last 30 days)
- Captured request body / env / headers from the `ExceptionInstance` (sanitized through existing `LogScrubRule` PII patterns before entering the prompt)
- Surrounding span (if traceId present) + logs from the same window

Output written to `Improvement.reproducer`: a sandbox script that, when run against the cloned repo, reliably triggers the exception. Plus `Improvement.confidence` and `Improvement.blastRadius`.

**Gate**: If the Diagnose agent cannot produce a reproducer that actually fails in the sandbox, the `Improvement` moves to `stage = Failed` with reason `NoReproducer`. We do not proceed to patch. This is the "honest verification" principle in code.

### 1.3 Patch: Generate Fix + Test

**Current**: Old `AIAgent` generated a fix but no test, no iterative verification.

**Target**: Patch agent runs through the configured `PatchHarness` (Phase 0.6, default `OpenCodePatchHarness`) inside the sandbox container, invoking the `patch_model` role through the Model Gateway. Given:
- The repo (cloned in sandbox)
- The reproducer script
- `package.json` / lint config / test framework detected from the repo
- Project conventions distilled from a sample of recent merged PRs

Loop: generate diff → run reproducer (must now pass) → run existing test suite (must still pass) → run typecheck + lint → iterate up to N rounds (default 6) or until all gates pass. Always emits a new test that locks in the fix.

Cap diff size at `AutofixPolicy.maxDiffLines`; if exceeded, the agent must split or abort.

### 1.4 Deliver: Pull Request with Full Context

**Current**: Old `AIAgent` opened a PR with the diff and a short description.

**Target**: PR body is a structured improvement report:
- Link back to the `Improvement` in OneUptime dashboard
- The incident / exception summary that triggered it
- The reproducer (as a runnable script attached to the PR)
- Sanitized telemetry slice (the request that triggered it, with PII scrubbed)
- The new test that locks in the fix
- Diff explanation in plain English (what changed, why)
- Provenance footer: `Improvement ID`, `Agent ID`, `Model + version`, `Prompt hash`, sandbox job ID

### 1.5 Improvements Dashboard

**Current**: None.

**Target**: New dashboard route `/dashboard/{projectId}/ai/improvements`:
- Table view: filter by `Service`, `stage`, `signalType`, `confidence`
- Per-Improvement detail view: timeline (Detected → Diagnosing → ... → Verified), full agent transcript, sandbox job logs, PR link, verification metric chart
- Bulk actions: pause autofix on a service, reopen failed Improvements, mark false-positive

### 1.6 Success Criteria for Phase 1

Phase 1 is not "shipped" when code merges. It is shipped when, on a cohort of 3–5 design-partner customers running it on real production services for 90 days, we can publish:
- **Merge rate ≥ 50%** of `Improvement`s reach `Merged` stage
- **Regression rate < 5%** of merged Improvements get reverted within 7 days
- **Reproducer success rate ≥ 80%** of detected Improvements produce a working sandbox reproducer

If we miss these, do not advance to Phase 2 — fix Phase 1 first.

---

## Phase 2: Expand Signal Sources

Reuse the Diagnose → Patch → Deliver → Verify pipeline from Phase 1. Each new signal type adds its own Detect rule and Diagnose specialization; the rest is shared infrastructure.

### 2.1 Performance Regression → Improvement

**Current**: Spans stored in ClickHouse; no automatic regression detection.

**Target**: Detect when an operation's p95 latency increases by ≥ X% sustained for Y minutes vs the prior 7-day baseline, in a service with `AutofixPolicy` allowing `PerformanceRegression`. Diagnose agent receives flamegraph-style attribution from spans, recent commits to the hot files, and known optimization patterns. Patch agent generates the optimization + a benchmark test.

### 2.2 Dependency CVE → Patch PR

**Current**: None. Dependabot/Renovate handle bumps but not code-level adjustments for breaking changes.

**Target**: Ingest CVE feed (OSV.dev). Detect when a customer's `package.json` / `go.mod` / `requirements.txt` includes an affected version. Diagnose: is the vulnerable code path actually reachable? (cross-reference span/log data). Patch: upgrade + adapt any breaking-change call sites + run tests.

### 2.3 SLO Burn → Improvement

**Current**: SLO/SLI tracking is itself on the Metrics roadmap — depends on `Metrics.md` Phase 2 SLO work landing first.

**Target**: When SLO burn rate exceeds 2x sustained, open an Improvement targeting the dominant contributing endpoint/operation.

### 2.4 Synthetic Probe Failure → Improvement

**Current**: `Probe` service runs synthetic checks; failures create incidents but no code action.

**Target**: When a synthetic probe fails repeatedly against an endpoint owned by a service with `AutofixPolicy ≥ SuggestOnly`, open an Improvement. Diagnose pulls the last successful probe, the first failing probe, the diff in response, and recent deploys.

---

## Phase 3: Trust & Earned Autonomy

Phase 1 and 2 default to `OpenPR`. Phase 3 introduces the data and machinery to move services to `AutoMerge` and `AutoDeploy` *safely*.

### 3.1 Trust Score Per Service

**Current**: None.

**Target**: Computed score per service from historical Improvement outcomes: merge rate, post-merge revert rate, time-to-merge, post-deploy metric movement. Surfaced in `Service settings → AI Autofix` as a gauge. Customer can manually raise autonomy regardless, but the UI flags services whose score does not warrant the requested level.

### 3.2 Auto-Merge Policies for Low-Risk Classes

**Current**: All PRs require human review.

**Target**: `AutofixPolicy.autoMergeRules` — narrowly scoped rules. Examples:
- `signalType=DependencyCVE AND diff.linesChanged ≤ 5 AND testsAdded ≥ 1 AND ciGreen=true → auto-merge`
- `signalType=Exception AND diff.filesChanged = 1 AND testsAdded ≥ 1 AND blastRadius=Low AND trustScore ≥ 0.8 → auto-merge`

Rules are explicit, customer-editable, and version-controlled in the audit log.

### 3.3 Canary Deploy + Auto-Rollback Hook

**Current**: None.

**Target**: Optional integration with the customer's deploy system (GitHub Actions, ArgoCD, Spinnaker — via webhooks customer authors). On merge of an auto-merge Improvement, OneUptime:
1. Triggers customer's canary deploy
2. Watches the `Improvement.verificationMetric` for the configured window (default 30 min)
3. If the metric improves or holds steady → promote
4. If the metric degrades → trigger customer's rollback hook and reopen the Improvement to `stage = Failed`

The deploy/rollback mechanics live in the customer's CD system. OneUptime is the watcher and signaller, not the deployer. This boundary keeps blast radius bounded.

---

## Phase 4: Proactive Improvements

Stop waiting for failures. Use the telemetry already in ClickHouse to propose improvements before anything breaks. This is the moat IDE-resident AI tools cannot copy — they do not have the production data.

### 4.1 Cold-Path / Dead-Code Detection → Refactor PR

**Current**: None.

**Target**: When a code path has zero recorded executions for ≥ 90 days (cross-reference span data with source code), open a low-priority Improvement proposing deletion. Customer reviews; if accepted, the Patch agent removes the code + tests + downstream usages.

### 4.2 Hot-Path Optimization Suggestions

**Current**: None.

**Target**: For each service, identify the top-N operations by total time consumed. When AI can identify a known-improvable pattern (N+1 query, unbatched API call, missing cache, allocation in hot loop), open a `PerformanceRegression`-class Improvement preemptively.

### 4.3 Cost-Anomaly-Driven Optimization

**Current**: None. Cost data is not yet a first-class telemetry input.

**Target**: Depends on ingestion of customer cloud-cost data (separate roadmap item — out of scope for this plan). Once available, detect cost regressions tied to specific operations (suddenly 10x DB read volume) and open Improvements.

---

## Phase 5: Open the Improvement Agent Platform

Make the Improvement runtime extensible. Third-party agents — and customers' own agents — plug in via MCP.

### 5.1 External Improvement Agent Spec

**Current**: All agents run in-process.

**Target**: Publish the MCP tool surface (from Phase 0.4) as a stable, versioned interface. Document the contract: an agent receives `improvementId`, reads context via MCP tools, writes back through MCP tools (`updateImprovementStage`, `openPullRequest`). Third parties can author Detect+Diagnose+Patch agents specialized for their domain.

### 5.2 Trust Boundary for Third-Party Agents

**Current**: N/A.

**Target**: Third-party agents run in their own sandbox (Phase 0.3 infrastructure), have their own audit trail, and are subject to per-customer enable/disable. Customers see *which agent* authored every line, not just "AI". Provenance principle from Guiding Principles extended to vendor name + version.

### 5.3 Improvement Agent Marketplace UI

**Current**: None.

**Target**: Browse, install, configure third-party agents per project. Security-focused agents (e.g., a vendor specializing in OWASP-class fixes), performance agents, compliance agents.

---

## Verification

For each phase:
1. Unit tests for new models (`Improvement`, `AutofixPolicy`) and policy evaluation logic
2. Integration tests for the sandbox executor — including the negative cases (timeout, OOM, network exfil attempt)
3. End-to-end tests for the full loop using synthetic exceptions seeded into a fixture repo
4. Provenance audit: spot-check 20 random merged Improvements and confirm every changed line is traceable to `Improvement + Agent + Model + Prompt hash`
5. Manual verification at `https://oneuptimedev.genosyn.com/dashboard/{projectId}/ai/improvements`
6. Design-partner cohort review before each phase advances: publish merge rate, regression rate, reproducer success rate from real production usage

## Recommended Build Order

1. **Phase 0** in full — non-negotiable foundation
2. **Phase 1.1–1.6** — single signal type, ship to design partners
3. **Phase 1 success criteria gate** — do not start Phase 2 until met
4. **Phase 2.1 → 2.2 → 2.4 → 2.3** (SLO last because it depends on Metrics SLO work)
5. **Phase 3** — only after Phase 2 has 90 days of merge/regression data
6. **Phase 4** — parallelizable with Phase 3 by a separate team
7. **Phase 5** — after the internal agent surface has stabilized over Phases 1–3
