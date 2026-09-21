# AI SRE — Autonomous Investigations

OneUptime AI is your AI Site Reliability Engineer. The moment a new incident or alert is declared, it wakes up, investigates it across your own telemetry — logs, metrics, traces, exceptions, monitors, and recent changes — and posts a cited root cause analysis to the incident or alert timeline, usually before the on-call engineer has finished reading the page.

Every claim in the analysis carries a citation that deep-links to the exact data that supports it, and the investigation itself is **strictly read-only**: OneUptime AI can never change anything in your project while investigating.

## What the investigation posts

When an investigation finishes, OneUptime AI posts a root cause analysis with these sections:

- **Summary** — one or two sentences a paged engineer can read in five seconds.
- **Most likely root cause** — the hypothesis, with only the confidence the evidence supports, each factual claim cited. If the telemetry is insufficient, the AI says so plainly and lists what it checked instead of guessing.
- **Evidence** — the key findings that support or rule out the hypothesis, each cited.
- **Suggested next steps** — concrete actions for the on-call engineer.

For incidents, the analysis is posted to the incident feed **and** as an incident internal note (where responders collaborate). For alerts, it is posted to the alert feed.

While the investigation runs, the incident or alert page shows a live **AI Investigation** panel that narrates each step — which tools ran, what they found, and how long they took — so you can watch it think. If an investigation fails, the panel shows the failure reason rather than a silent gap.

## Enabling AI investigations

Autonomous investigations are **off by default**. To enable them:

1. **Configure an LLM provider.** Self-hosted installations bring their own key (or run fully air-gapped with local Ollama) — see [LLM Providers](/docs/ai/llm-provider). OneUptime Cloud users can use the pre-configured global provider, billed as metered AI tokens.
2. **Make sure AI is enabled for the project** (it is by default) — Project Settings > AI > AI Credits > Enable AI.
3. **Opt in per signal type:**
   - Incidents: **Incidents > AI > Investigation** — toggle _Automatically Investigate Incidents_.
   - Alerts: **Alerts > AI > Investigation** — toggle _Automatically Investigate Alerts_.

Incidents and alerts are configured independently, so you can give each signal type its own concurrency cap, daily token budget, fix-task budget, and follow-up pull request policy. Changing an alert AI setting does not change the corresponding incident setting, or vice versa.

One further setting builds on top of investigations: **Enable Automatic Code Fixes** (off by default and configured independently on each signal type's AI settings page) lets an investigation that confidently identifies a repository code change open a fix pull request automatically — see **Automatic code fixes** below.

## Cluster access — let OneUptime AI run kubectl

Out of the box, an investigation can only use the telemetry your agents ship. For a Kubernetes signal that is often not enough: "pods stuck in Pending" is a scheduling problem you diagnose by describing the pod and reading its events, not by looking at a metric. OneUptime AI can do exactly that when a cluster gives it access — and, if you allow it, fix what it finds.

Everything is configured on the cluster's **AI** page (Kubernetes → cluster → AI). The page is also the "what is missing" checklist: every reason OneUptime AI cannot (fully) use the cluster is listed there with the step that fixes it, and the same explanation appears on the incident's investigation panel when AI had to investigate with OneUptime data only.

### One flag to connect a cluster

If the cluster runs the [OneUptime Kubernetes agent](/docs/telemetry/kubernetes-agent), one extra flag installs a small in-cluster Runner that registers itself to the cluster — no Runner to create, no key to copy:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --reuse-values \
  --set aiAccess.enabled=true
```

Within a minute the cluster's AI page shows the Runner as Connected and turns **Let AI investigate with kubectl** on. Add `--set aiAccess.remediation.enabled=true` to also grant the write RBAC fixes need; the cluster then starts in **ask for approval**.

Any other Runner works too: bind it on the AI page together with a Kubernetes credential (API server URL + ServiceAccount token, under Project Settings → Runner Credentials) and turn on "Runs AI Remediation Commands" for that Runner.

### What an investigation may run

With access, an investigation runs **read-only** kubectl through the Runner — `get`, `describe`, `logs`, `events`, `top`, `rollout status`, `auth can-i` — and cites each command like any other evidence. Three independent checks keep it read-only: the policy that tiers every command, the server that refuses to enqueue anything else for an investigation, and the Runner, which re-checks the same policy before spawning kubectl. "Read-only — nothing in your systems was changed" stays literally true.

### How fixes work

**AI remediation** on the cluster's AI page has three settings:

- **Off** — AI only investigates.
- **Ask for approval** — after the root cause analysis, OneUptime AI diagnoses with kubectl and composes the smallest kubectl plan that addresses the cause, for example `kubectl rollout restart deployment/web -n web`. The plan appears on the incident with its rationale, expected effect and rollback; a human approves it with one click, and OneUptime runs exactly those commands. If the monitors do not recover, the rollback runs and OneUptime AI composes one more plan — again for approval — with the failed attempt in front of it, so it takes a different approach or says what a human should look at.
- **Automatic** — safe changes run without a human: `rollout restart/undo/pause/resume`, `scale`, deleting a **named** pod or job, `cordon/uncordon`, `label/annotate`. Riskier changes (`patch`, `set image/env/resources`, `taint`, `drain`, deleting workloads, deleting by selector) still ask for approval unless you allowlist their exact shape on the AI page. Automatic mode also resolves the signal once verification confirms the monitors recovered, and it is circuit-broken to three automatic fixes per cluster per hour.

Some commands **never** run, whatever the mode and even with human approval: `exec`, `attach`, `cp`, `port-forward`, `proxy`, `debug`, `run`, `edit`, `apply`, `replace`, any file input, `--all-namespaces` writes, `delete --all`, and deleting namespaces, nodes, volumes, secrets, CRDs or cluster roles. The in-cluster Runner's RBAC does not grant them either.

Every command — investigation or fix — is recorded on the cluster's AI page under **Commands OneUptime AI ran on this cluster**, with its output and outcome.

## Quiet mode

An investigation that cannot determine a cause posts its analysis to the timeline **without** pinging your Slack/Teams workspace or the on-call. A non-answer should never page anyone — the analysis is there when someone looks, but nobody is woken up for "inconclusive". Confident analyses notify the workspace normally.

Whether an analysis counts as confident is decided by a server-verified signal, not by what the analysis text says: an investigation that gathered no evidence (no successful telemetry queries, no citations) is always treated as inconclusive, and otherwise a separate constrained check classifies the analysis. If that check itself fails, OneUptime AI errs on the side of notifying — quiet mode fails louder, never silent.

## Automatic code fixes

For projects that opt in, a confident analysis that recommends a repository code change can go one step further than notifying: it opens the fix. **Enable Automatic Code Fixes** is configured independently under **Incidents > AI > Investigation** and **Alerts > AI > Investigation** (both are **off by default**). A signal type with this setting enabled automatically queues the same fix task as the **Open Fix PR from this analysis** button on the investigation panel: an AI agent task that turns the posted analysis into a pull request, ready for review. The button uses the same recommendation and is hidden for analyses whose remedy is operational, infrastructure-only, external, an expected denial, a user error, or inconclusive.

The same constrained, server-verified classification that decides confidence also decides whether a repository change is appropriate. Only a positive code-fix classification offers or automatically opens the pull request. An investigation that gathered no server-verified evidence, recommends a non-code remedy, or whose classification failed never opens one — PR creation always fails toward doing nothing. Everything else matches the manual button: the pull request opens ready for review, needs a GitHub-App-connected repository and a Runner with the code-fix capability, counts against that signal type's daily fix-task budget and each repository's open-PR cap, and at most one fix task per incident or alert can be active at a time. The investigation itself stays read-only — the fix runs as a separate, fully-logged agent task. See [Fix Tasks](/docs/ai/ai-agent) for how fix pull requests work, including the build-and-test verification that runs before each pull request opens.

## Auto-remediation waits for the analysis

If the project uses auto-remediation rules (rules on the incident and alert settings pages that match new incidents and alerts to remediation runbooks — suggested or fully automatic), their ordering relative to investigations is deliberate — **RCA first**:

- When a new incident or alert **enqueues an AI investigation**, auto-remediation for that incident or alert is deferred until the investigation **settles** — any terminal outcome: the analysis is posted, the run errors out after its retries, it expires in the queue, or it goes stale. Only then do the remediation rules run, so the remediation planner always has the posted root cause analysis as input instead of racing it.
- When **no investigation is enqueued** (investigations disabled, the alert below the severity floor, the cooldown or a budget skipped it), remediation fires immediately when the incident or alert is created, exactly as before. Auto-remediation never depends on the AI investigation lane being enabled.

An investigation that fails, expires, or goes stale still releases remediation — the deferral delays remediation until the outcome is known; it never cancels it.

## Cost controls

Alert volume can be much higher than incident volume, so autonomous investigations are gated by several cost controls:

| Control                            | Behavior                                                                                                                                                                                                                                                                                                                                                             | Where to configure                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Severity floor (alerts)            | Only alerts at or above a minimum severity are investigated. Default: the project's **top two severity tiers**.                                                                                                                                                                                                                                                      | Alerts > AI > Investigation              |
| Re-investigation cooldown (alerts) | Repeat alerts from the same monitor within the cooldown are not re-investigated — the first analysis stands. Default **30 minutes**; set 0 to disable.                                                                                                                                                                                                               | Alerts > AI > Investigation              |
| Concurrency cap                    | How many investigations of this signal type run at once. Incidents and alerts have separate pools. Default **3** per pool (1–25); queued investigations wait for a free slot and expire after 30 minutes.                                                                                                                                                            | Incidents or Alerts > AI > Investigation |
| Per-run budget                     | Each investigation is capped at 8 LLM calls, 12 tool calls, 150 seconds, and 2,000 output tokens. A completed investigation additionally spends one tiny confidence-classification call (20 output tokens max), metered and counted against the daily token limit.                                                                                                   | Built in                                 |
| Daily token limit                  | Optional maximum tokens per UTC day for autonomous AI work linked to this signal type, including investigations, remediation, and follow-up fix tasks. Incident and alert usage is counted separately. When one limit is reached, only that signal type's AI work is paused until the next day — interactive AI chat is never blocked. Set **0** to pause that lane. | Incidents or Alerts > AI > Investigation |
| Daily fix-task limit               | Maximum incident- or alert-linked fix tasks created per UTC day. Each signal type has its own limit. Default **25**; set 0 to pause that lane's fix tasks.                                                                                                                                                                                                           | Incidents or Alerts > AI > Investigation |

## Trust and safety

- **Read-only, always.** Autonomous investigations run with a curated set of read-only tools (metric, log, trace, exception, and change queries — including `baseline_anomaly`, which judges a metric against its learned hour-of-week normal range). The AI cannot acknowledge, resolve, page, or modify anything from an investigation.
- **Citations are minted server-side** from tool calls that actually executed — the model cannot fabricate a citation to data it never read.
- **Full audit trail.** Every investigation is recorded as an AI run with an ordered event trail (every LLM call and tool call), and every LLM call is metered in the AI Logs page (Project Settings > AI > AI Logs) with token counts and cost.
- **Secrets are redacted** from tool results before anything is sent to the LLM (tokens, credentials, key patterns).
- **Self-host = zero third-party egress.** With your own LLM provider (including local Ollama), telemetry never leaves your infrastructure.

## Auto-postmortem

Separately from investigations, OneUptime AI can draft a postmortem automatically when an incident is resolved. The draft never overwrites an existing postmortem note. This uses the same LLM provider and appears in the incident's postmortem tab for human review.

## Insights — proactive detection

Investigations react to incidents and alerts. **AI Insights** watch for problems before anything pages: every 15 minutes, deterministic detectors scan your telemetry for trouble that has not (yet) tripped a monitor. There is **no AI in the watch loop** — the detectors are statistical checks with fixed thresholds, so the always-on part of the feature spends no tokens and cannot hallucinate a finding. The thresholds are deliberately conservative: an insight means something genuinely moved, not that a number wiggled.

What the detectors watch:

| Detector                  | Fires when                                                                                                                                                                                                                                                                                 | Severity                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| New exceptions            | An exception first seen in the last 24 hours has already occurred 3+ times                                                                                                                                                                                                                 | Medium; High at 50+ occurrences                                                                         |
| Exception spikes          | An established exception jumps to 10+ occurrences in the last hour, at 5×+ its normal hourly rate — including a long-dormant exception waking up                                                                                                                                           | Medium; High at 10×                                                                                     |
| Error-log spikes          | Project-wide Error/Fatal log volume reaches 100+ in the last hour, at 3×+ the prior day's hourly average; the insight names the top contributing services                                                                                                                                  | Medium; High at 10×                                                                                     |
| Trace latency regressions | A service's p99 latency over the last hour is at least 1 second and 2×+ its prior-24-hour p99, with enough traffic to be meaningful. The detector drills into a representative slow trace and records what it found — N+1 query patterns, dominant slow spans — as evidence on the insight | Medium; High at 4×                                                                                      |
| Metric drift              | A metric's average this week has moved 50%+ versus the same metric last week                                                                                                                                                                                                               | Always Low — drift direction says nothing about whether the change is bad, so drift is never auto-fixed |

Each finding becomes an **insight** in a quiet inbox — **AI > Insights** in the dashboard. Insights **never page anyone and never open incidents**; they wait until someone looks. A recurring finding refreshes its existing insight (last seen, occurrence count) instead of piling up duplicates, a finding you dismiss stays out of your inbox for 7 days, and each scan files at most 10 new insights per project.

When an LLM provider is configured, each new insight also gets a **triage analysis**: a read-only, cited AI investigation — same engine, same audit trail, and same per-run budget as autonomous investigations — that assesses the likely root cause, the blast radius, and the one next action worth taking. Insights use the separate **Daily Background AI Token Limit** under **Project Settings > AI > AI Guardrails**, so they cannot consume either the incident or alert budget. The result is saved to the insight page. Without a provider you still get the insights; you just skip the AI triage.

Optionally, OneUptime AI can also open a **fix pull request** for the insight types with the strongest evidence: new and spiking exceptions (through the existing exception-fix pipeline) and trace latency regressions (grounded in the span evidence recorded on the insight). Error-log spikes and metric drift are never auto-fixed. Every automatic fix PR opens ready for review, counts against the **Daily Other AI Fix Task Limit** under **Project Settings > AI > AI Guardrails** and each repository's open-PR cap, and requires human review — auto-merge does not exist.

Both settings are **off by default**, at **AI > Insights > Settings**:

1. **Enable AI Insights** — turns on the watch loop, the inbox, and triage.
2. **Automatically open fix PRs from insights** — turns on fix-task creation for eligible insights. This needs the same setup as the manual "Fix with AI" flow: a GitHub-App-connected repository and an LLM provider.

Every insight has **Confirm** and **Dismiss** buttons — use them even when you don't act on the finding. Your confirm/dismiss votes are how each detector's precision gets measured, and that measured precision is what decides which insight types earn more automation over time. Dismissing also keeps the same finding out of your inbox for the next 7 days.

## Requirements and limits

- An LLM provider must be configured (project-specific or the cloud global provider).
- Investigations trigger on **newly created** incidents and alerts only — enabling the toggles does not investigate historical signals.
- The `baseline_anomaly` check needs about two weeks of metric history before its hour-of-week baselines are reliable; before that it reports "insufficient baseline data" rather than guessing.
- On OneUptime Cloud with the global provider, investigations consume metered AI tokens (see Project Settings > AI Credits). Bring your own provider key for unmetered usage.
