# Sentinel — Autonomous AI Investigations

Sentinel is OneUptime's AI Site Reliability Engineer. The moment a new incident or alert is declared, Sentinel wakes up, investigates it across your own telemetry — logs, metrics, traces, exceptions, monitors, and recent changes — and posts a cited root cause analysis to the incident or alert timeline, usually before the on-call engineer has finished reading the page.

Every claim in the analysis carries a citation that deep-links to the exact data that supports it, and the investigation itself is **strictly read-only**: Sentinel can never change anything in your project while investigating.

## What Sentinel posts

When an investigation finishes, Sentinel posts a root cause analysis with these sections:

- **Summary** — one or two sentences a paged engineer can read in five seconds.
- **Most likely root cause** — the hypothesis, with only the confidence the evidence supports, each factual claim cited. If the telemetry is insufficient, Sentinel says so plainly and lists what it checked instead of guessing.
- **Evidence** — the key findings that support or rule out the hypothesis, each cited.
- **Suggested next steps** — concrete actions for the on-call engineer.

For incidents, the analysis is posted to the incident feed **and** as an incident internal note (where responders collaborate). For alerts, it is posted to the alert feed.

While the investigation runs, the incident or alert page shows a live **Sentinel Investigation** panel that narrates each step — which tools ran, what they found, and how long they took — so you can watch Sentinel think. If an investigation fails, the panel shows the failure reason rather than a silent gap.

## Enabling Sentinel

Sentinel is **off by default**. To enable it:

1. **Configure an LLM provider.** Self-hosted installations bring their own key (or run fully air-gapped with local Ollama) — see [LLM Providers](/docs/ai/llm-provider). OneUptime Cloud users can use the pre-configured global provider, billed as metered AI tokens.
2. **Make sure AI is enabled for the project** (it is by default) — Project Settings > Sentinel > AI Credits > Enable AI.
3. **Opt in per signal type:**
   - Incidents: **Incidents > Settings > Sentinel** — toggle *Automatically Investigate Incidents*.
   - Alerts: **Alerts > Settings > Sentinel** — toggle *Automatically Investigate Alerts*.

Incidents and alerts are opted in independently, so you can start with incidents only.

## Quiet mode

An investigation that cannot determine a cause posts its analysis to the timeline **without** pinging your Slack/Teams workspace or the on-call. A non-answer should never page anyone — the analysis is there when someone looks, but nobody is woken up for "inconclusive". Confident analyses notify the workspace normally.

Whether an analysis counts as confident is decided by a server-verified signal, not by what the analysis text says: an investigation that gathered no evidence (no successful telemetry queries, no citations) is always treated as inconclusive, and otherwise a separate constrained check classifies the analysis. If that check itself fails, Sentinel errs on the side of notifying — quiet mode fails louder, never silent.

## Cost controls

Alert volume can be much higher than incident volume, so autonomous investigations are gated by several cost controls:

| Control | Behavior | Where to configure |
|---|---|---|
| Severity floor (alerts) | Only alerts at or above a minimum severity are investigated. Default: the project's **top two severity tiers**. | Alerts > Settings > Sentinel |
| Re-investigation cooldown (alerts) | Repeat alerts from the same monitor within the cooldown are not re-investigated — the first analysis stands. Default **30 minutes**; set 0 to disable. | Alerts > Settings > Sentinel |
| Concurrency cap | How many investigations run at once per project. Default **3** (1–25); queued investigations wait for a free slot and expire after 30 minutes. | Incidents or Alerts > Settings > Sentinel |
| Per-run budget | Each investigation is capped at 8 LLM calls, 12 tool calls, 150 seconds, and 2,000 output tokens. A completed investigation additionally spends one tiny confidence-classification call (20 output tokens max), metered and counted against the daily token limit. | Built in |
| Daily token limit | Optional maximum tokens per UTC day across all autonomous investigations. When reached, new investigations are skipped until the next day — interactive AI chat is never blocked. Set **0** to pause autonomous investigations entirely. | Incidents or Alerts > Settings > Sentinel |

## Trust and safety

- **Read-only, always.** Autonomous investigations run with a curated set of read-only tools (metric, log, trace, exception, and change queries — including `baseline_anomaly`, which judges a metric against its learned hour-of-week normal range). Sentinel cannot acknowledge, resolve, page, or modify anything from an investigation.
- **Citations are minted server-side** from tool calls that actually executed — the model cannot fabricate a citation to data it never read.
- **Full audit trail.** Every investigation is recorded as an AI run with an ordered event trail (every LLM call and tool call), and every LLM call is metered in the AI Logs page (Project Settings > Sentinel > AI Logs) with token counts and cost.
- **Secrets are redacted** from tool results before anything is sent to the LLM (tokens, credentials, key patterns).
- **Self-host = zero third-party egress.** With your own LLM provider (including local Ollama), telemetry never leaves your infrastructure.

## Auto-postmortem

Separately from investigations, Sentinel can draft a postmortem automatically when an incident is resolved. The draft never overwrites an existing postmortem note. This uses the same LLM provider and appears in the incident's postmortem tab for human review.

## Insights — proactive detection

Investigations react to incidents and alerts. **Sentinel Insights** watch for problems before anything pages: every 15 minutes, deterministic detectors scan your telemetry for trouble that has not (yet) tripped a monitor. There is **no AI in the watch loop** — the detectors are statistical checks with fixed thresholds, so the always-on part of the feature spends no tokens and cannot hallucinate a finding. The thresholds are deliberately conservative: an insight means something genuinely moved, not that a number wiggled.

What the detectors watch:

| Detector | Fires when | Severity |
|---|---|---|
| New exceptions | An exception first seen in the last 24 hours has already occurred 3+ times | Medium; High at 50+ occurrences |
| Exception spikes | An established exception jumps to 10+ occurrences in the last hour, at 5×+ its normal hourly rate — including a long-dormant exception waking up | Medium; High at 10× |
| Error-log spikes | Project-wide Error/Fatal log volume reaches 100+ in the last hour, at 3×+ the prior day's hourly average; the insight names the top contributing services | Medium; High at 10× |
| Trace latency regressions | A service's p99 latency over the last hour is at least 1 second and 2×+ its prior-24-hour p99, with enough traffic to be meaningful. Sentinel drills into a representative slow trace and records what it found — N+1 query patterns, dominant slow spans — as evidence on the insight | Medium; High at 4× |
| Metric drift | A metric's average this week has moved 50%+ versus the same metric last week | Always Low — drift direction says nothing about whether the change is bad, so drift is never auto-fixed |

Each finding becomes an **insight** in a quiet inbox — **Sentinel > Insights** in the dashboard. Insights **never page anyone and never open incidents**; they wait until someone looks. A recurring finding refreshes its existing insight (last seen, occurrence count) instead of piling up duplicates, a finding you dismiss stays out of your inbox for 7 days, and each scan files at most 10 new insights per project.

When an LLM provider is configured, each new insight also gets a **triage analysis**: a read-only, cited Sentinel investigation — same engine, same audit trail, same per-run budget and daily token limit as autonomous investigations — that assesses the likely root cause, the blast radius, and the one next action worth taking. The result is saved to the insight page. Without a provider you still get the insights; you just skip the AI triage.

Optionally, Sentinel can also open a **draft fix pull request** for the insight types with the strongest evidence: new and spiking exceptions (through the existing exception-fix pipeline) and trace latency regressions (grounded in the span evidence recorded on the insight). Error-log spikes and metric drift are never auto-fixed. Every automatic fix PR opens as a draft, counts against the project's daily fix-task budget and each repository's open-PR cap, and requires human review — auto-merge does not exist.

Both settings are **off by default**, at **Sentinel > Insights > Settings**:

1. **Enable Sentinel Insights** — turns on the watch loop, the inbox, and triage.
2. **Automatically open draft fix PRs from insights** — turns on fix-task creation for eligible insights. This needs the same setup as the manual "Fix with AI" flow: a GitHub-App-connected repository and an LLM provider.

Every insight has **Confirm** and **Dismiss** buttons — use them even when you don't act on the finding. Your confirm/dismiss votes are how each detector's precision gets measured, and that measured precision is what decides which insight types earn more automation over time. Dismissing also keeps the same finding out of your inbox for the next 7 days.

## Requirements and limits

- An LLM provider must be configured (project-specific or the cloud global provider).
- Investigations trigger on **newly created** incidents and alerts only — enabling the toggles does not investigate historical signals.
- The `baseline_anomaly` check needs about two weeks of metric history before its hour-of-week baselines are reliable; before that it reports "insufficient baseline data" rather than guessing.
- On OneUptime Cloud with the global provider, investigations consume metered AI tokens (see Project Settings > AI Credits). Bring your own provider key for unmetered usage.
