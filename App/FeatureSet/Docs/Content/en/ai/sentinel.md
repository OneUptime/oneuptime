# Sentinel — Autonomous AI Investigations

Sentinel is OneUptime's AI Site Reliability Engineer. The moment a new incident or alert is declared, Sentinel wakes up, investigates it across your own telemetry — logs, metrics, traces, exceptions, monitors, and recent changes — and posts a cited root cause analysis to the incident or alert timeline, usually before the on-call engineer has finished reading the page.

Every claim in the analysis carries a citation that deep-links to the exact data that supports it, and the investigation itself is **strictly read-only**: Sentinel can never change anything in your project while investigating.

## What Sentinel posts

When an investigation finishes, Sentinel posts a root cause analysis with these sections:

- **Summary** — one or two sentences a paged engineer can read in five seconds.
- **Most likely root cause** — the hypothesis, with only the confidence the evidence supports, each factual claim cited. If the telemetry is insufficient, Sentinel says "Inconclusive — insufficient signal" and lists what it checked instead of guessing.
- **Evidence** — the key findings that support or rule out the hypothesis, each cited.
- **Suggested next steps** — concrete actions for the on-call engineer.

For incidents, the analysis is posted to the incident feed **and** as an incident internal note (where responders collaborate). For alerts, it is posted to the alert feed.

While the investigation runs, the incident or alert page shows a live **AI Investigation** panel that narrates each step — which tools ran, what they found, and how long they took — so you can watch Sentinel think. If an investigation fails, the panel shows the failure reason rather than a silent gap.

## Enabling Sentinel

Sentinel is **off by default**. To enable it:

1. **Configure an LLM provider.** Self-hosted installations bring their own key (or run fully air-gapped with local Ollama) — see [LLM Providers](/docs/ai/llm-provider). OneUptime Cloud users can use the pre-configured global provider, billed as metered AI tokens.
2. **Make sure AI is enabled for the project** (it is by default) — Project Settings > AI Credits > Enable AI.
3. **Opt in per signal type:**
   - Incidents: **Incidents > Settings > AI** — toggle *Automatically Investigate Incidents*.
   - Alerts: **Alerts > Settings > AI** — toggle *Automatically Investigate Alerts*.

Incidents and alerts are opted in independently, so you can start with incidents only.

## Quiet mode

An investigation that cannot determine a cause posts its analysis to the timeline **without** pinging your Slack/Teams workspace or the on-call. A non-answer should never page anyone — the analysis is there when someone looks, but nobody is woken up for "inconclusive". Confident analyses notify the workspace normally.

## Cost controls

Alert volume can be much higher than incident volume, so autonomous investigations are gated by several cost controls:

| Control | Behavior | Where to configure |
|---|---|---|
| Severity floor (alerts) | Only alerts at or above a minimum severity are investigated. Default: the project's **top two severity tiers**. | Alerts > Settings > AI |
| Dedupe window (alerts) | Repeat alerts from the same monitor within **30 minutes** are not re-investigated — the first analysis stands. | Built in |
| Concurrency cap | At most **3** investigations run at once per project. | Built in |
| Per-run budget | Each investigation is capped at 8 LLM calls, 12 tool calls, 150 seconds, and 2,000 output tokens. | Built in |
| Daily token limit | Optional maximum tokens per UTC day across all autonomous investigations. When reached, new investigations are skipped until the next day — interactive AI chat is never blocked. Set **0** to pause autonomous investigations entirely. | Incidents or Alerts > Settings > AI |

## Trust and safety

- **Read-only, always.** Autonomous investigations run with a curated set of read-only tools (metric, log, trace, exception, and change queries — including `baseline_anomaly`, which judges a metric against its learned hour-of-week normal range). Sentinel cannot acknowledge, resolve, page, or modify anything from an investigation.
- **Citations are minted server-side** from tool calls that actually executed — the model cannot fabricate a citation to data it never read.
- **Full audit trail.** Every investigation is recorded as an AI run with an ordered event trail (every LLM call and tool call), and every LLM call is metered in the AI Logs page (Project Settings > AI Logs) with token counts and cost.
- **Secrets are redacted** from tool results before anything is sent to the LLM (tokens, credentials, key patterns).
- **Self-host = zero third-party egress.** With your own LLM provider (including local Ollama), telemetry never leaves your infrastructure.

## Auto-postmortem

Separately from investigations, Sentinel can draft a postmortem automatically when an incident is resolved. The draft never overwrites an existing postmortem note. This uses the same LLM provider and appears in the incident's postmortem tab for human review.

## Requirements and limits

- An LLM provider must be configured (project-specific or the cloud global provider).
- Investigations trigger on **newly created** incidents and alerts only — enabling the toggles does not investigate historical signals.
- The `baseline_anomaly` check needs about two weeks of metric history before its hour-of-week baselines are reliable; before that it reports "insufficient baseline data" rather than guessing.
- On OneUptime Cloud with the global provider, investigations consume metered AI tokens (see Project Settings > AI Credits). Bring your own provider key for unmetered usage.
