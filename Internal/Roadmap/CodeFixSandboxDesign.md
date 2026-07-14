# Code-Fix Verification & Sandbox — Design (B4)

> The design spike the execution doc requires before any code-fix verification ships ("per-repo CI sandbox — isolation model, resource limits, secrets handling, air-gapped behavior, multi-tenant cost"). Status: **approved for implementation** (founder, 2026-07-13). Companion tracker: [AISentinelExecution.md](./AISentinelExecution.md) — code-fix track.

## The problem, precisely

Every fix recipe today opens a PR whose code **nobody has executed**. The honest residual repeated in five PR descriptions: no build, no test run, no proof a generated regression test actually fails. Verification means running untrusted code (the repo's own toolchain + AI-written changes), which raises three risks: credential theft (the workspace must never see agent keys, LLM keys, or installation tokens beyond the one repo), network egress (exfiltration or attack traffic from inside our infra), and resource abuse (multi-tenant cost). Additionally, agent LLM calls today use a raw provider key handed to the worker — unmetered by design origin, patched around ever since.

## Decision: two tiers, metering first

### Tier 0 (ships with the in-house agent): server-mediated, metered LLM calls

The OpenCode CLI shell-out is replaced by an in-house tool-loop agent whose completions route through the server (`AIService.executeWithLogging`, feature "Sentinel Code Fix", linked to the run, under the G4 daily budget). Consequences, in order of importance:

1. **The raw-key handoff dies.** `get-llm-config` is removed from the protocol; the worker never holds a provider secret.
2. **Metering becomes universal**, which lifts the Workstream-A restriction the right way: the **global provider becomes usable on the agent path on cloud** (it is billed now). Cloud zero-config completes.
3. Per-step `ProgressLog` events give fix runs the same glass-box narration investigations have.
4. Loop budgets (max LLM calls / tool calls / wall-clock) are enforced server-side per run, not trusted to the worker.

Workspace tool surface: `read_file`, `write_file`, `list_directory`, `search` (path-guarded to the workspace, same escape checks as `WorkspaceManager`), and `run_command` (workspace-cwd, timeout-capped). `run_command` retains the status-quo risk OpenCode already had — a repo's own build scripts run in the worker container. Tier 2 is what removes that risk class; until then the worker container's posture (no mounted secrets beyond its agent key, per-task ephemeral workspace) is unchanged, and the risk is documented rather than pretended away.

### Tier 1 — **shipped 2026-07-13**: verify via the customer's own CI on draft PRs

No sandbox at all. Fix PRs are already drafts; the repository's own CI runs them. We poll check runs through the GitHub App (the `SyncPullRequestStates` pattern) and record the conclusion on the PR row (`ciStatus`). Surfaces:

- **Verified-green rate** beside the acceptance rate in the outcomes card — merged is good, merged-and-CI-green is better.
- **Regression-test SHOULD-FAIL check**: for `WriteRegressionTest` PRs, a failing test job on the PR is the *expected* outcome — reported as `ExpectedFailureObserved` rather than red. Closes the honesty gap deterministically — with the honest caveat that check-run granularity cannot tell WHICH job failed (a repo whose lint breaks on the PR also reads as expected-failure); job-level discrimination via check names is the tracked refinement.
- Runs annotated with the CI conclusion as a `ProgressLog` event.

Limits, stated: repos without CI verify nothing (recorded as `NoCiConfigured`, per G9 "verification fails to unverified, never verified" — never counted as verified anywhere); we never re-run or gate the customer's CI; check-run polling shares the PR-state sync cadence (30 min, so conclusions can lag). As shipped: roll-up per PR head branch = no check runs → `NoCiConfigured`, any pending → `Pending` (conclusions are final-only — a failure while checks still run is not yet the branch's conclusion), any failed → `Red` (unknown/future conclusions count as failed, toward unverified), else `Green`; the GitHub App needs the **Checks: Read-only** permission — installations without it degrade gracefully to PR-state-only sync (ciStatus stays null = unverified).

### Tier 2 (later): ephemeral sandbox for verify-before-PR

For running builds/tests *before* a PR exists (and for the Preventive lane's auto-created fixes, where a draft PR per candidate is too noisy):

- **Isolation:** one Kubernetes Job per verification, from a dedicated runner image; `runtimeClass: gvisor` on cloud; plain runc acceptable self-host (operator's own code); no service account token, no secrets mounted; the workspace arrives as a content-addressed tarball, results leave as a JSON verdict + logs tail.
- **Network:** default-deny egress NetworkPolicy; allowlist = package registries via a caching proxy. Air-gapped installs point the proxy at their mirror or run `network: none` with vendored deps (verification degrades to build-only when deps can't resolve — reported, not hidden).
- **Resources:** CPU/memory limits + activeDeadlineSeconds per job; per-project daily verification-minutes budget (same shape as the fix-run budget); queue on the existing worker queue.
- **Cost model:** verification pods are burst load; KEDA-scaled runner pool with max cap; cloud pricing folds into the metered-token story (verification minutes are cheap relative to tokens).
- **Threat model recap (vision §6):** sandbox output is untrusted data; verdicts are parsed structurally (exit codes + JUnit-style reports), never free-form; a sandbox cannot mint citations or tokens.

## Sequencing

1. **B4-PR1 (this document + brand sweep)** — the spike, satisfying the tracker's "design spike first" requirement.
2. **B4-PR2** — in-house metered agent (Tier 0): server completion endpoint, tool loop, OpenCode env-fallback (`CODE_AGENT_TYPE=OpenCode`) for one release, global-provider re-enable on cloud, `get-llm-config` removal. *Shipped 2026-07-13; the OpenCode fallback + `get-llm-config` raw-key endpoint were fully removed 2026-07-14 — the in-house agent is now the only code agent, and no code path hands a provider key to the worker.*
3. **B4-PR3** — Tier 1 CI verify: check-run polling, `ciStatus` on PR rows, verified-green rate, SHOULD-FAIL reporting. *Shipped 2026-07-13.*
4. **Tier 2** — after real usage data shows where pre-PR verification pays for its infrastructure; blocked on nothing else.

## Non-goals

- No auto-merge under any tier (standing non-goal).
- No gating of the customer's CI — we read conclusions, never write requirements.
- Tier 2 does not ship until Tiers 0–1 have production mileage; the pre-PR verification demand must be observed, not assumed.
