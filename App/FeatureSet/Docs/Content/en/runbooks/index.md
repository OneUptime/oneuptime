# Runbooks Overview

Runbooks are reusable response procedures — ordered lists of manual or automated steps — that you attach to incidents, alerts, or scheduled maintenance events. They turn ad-hoc "what do we do now?" Slack threads into something a teammate can pick up cold at 3am.

## At a glance

- **Top-level feature** in the OneUptime dashboard under **Analytics & Automation → Runbooks**.
- **Four step types**: Manual checklist, JavaScript (sandboxed) and Bash (both run on a [Runbook Agent](/docs/runbooks/agents) inside your own infrastructure), HTTP request.
- **Three trigger paths**: rules that match incidents/alerts/scheduled maintenance, or a manual "Run Runbook" button on any event.
- **Snapshot semantics**: when a runbook starts, its steps are copied onto the execution. Editing the template later never mutates an in-flight run.
- **Full audit trail**: every step's status, output, error message, and duration is captured on the execution forever.

## Why use runbooks?

Incident response is often the difference between a one-minute blip and a multi-hour outage. Runbooks help you:

- **Codify tribal knowledge** — the "what to do when the queue backs up" lives somewhere your team can find it.
- **Reduce mean time to recovery (MTTR)** — automated steps execute in seconds; manual steps remove decision paralysis.
- **Audit response actions** — every step run, every output, every responder click is recorded on the execution.
- **Bring junior engineers up to speed** — they can run a runbook with confidence instead of paging a senior at 3am.
- **Write postmortems from data, not memory** — the captured execution is a frozen record of exactly what happened.

## Key concepts

A few terms recur across the rest of the runbook docs. Get these straight first:

| Term | Meaning |
| --- | --- |
| **Runbook** | The template. A named, reusable procedure with an ordered list of steps and an `isEnabled` flag. |
| **Step** | One item in a runbook. Has a type (Manual / JavaScript / HTTP / Bash), a title, a description, and type-specific config. |
| **Runbook Rule** | A pattern that auto-attaches one or more runbooks to incidents, alerts, or scheduled maintenance events when their title or description matches a regex. |
| **Execution** | One run of a runbook. Created when a rule fires, when someone clicks "Run Runbook" on an event, or when someone clicks "Run Now" on the runbook itself. Holds a snapshot of the steps and per-step status / output. |
| **Snapshot** | The frozen copy of the runbook's steps that lives on each execution. Lets you edit the template later without rewriting history. |

## The lifecycle of a runbook

1. **Author** — Create a runbook, drop in a mix of Manual, JavaScript, HTTP, and Bash steps. Save.
2. **(Optional) Add a rule** — On Incidents, Alerts, or Scheduled Maintenance settings, tell OneUptime to start this runbook whenever an event's title or description matches a regex.
3. **Trigger** — Either the rule fires automatically when a matching event is created, or a responder clicks **Run Runbook** on the event manually.
4. **Execute** — A new execution is created with a snapshot of the steps. Automated steps run inline on the Runbook worker; the execution pauses at each Manual step until someone ticks it off.
5. **Audit** — The execution stays on the event's **Runbooks** tab and on the runbook's **Executions** list forever. Per-step output, errors, and timing are preserved for the postmortem.

## When to use each step type

A quick decision guide. The longer breakdown is in [Authoring a Runbook](/docs/runbooks/authoring).

| Step type | Reach for it when… | Example |
| --- | --- | --- |
| **Manual** | A human has to verify something, make a judgement call, or take an action OneUptime can't observe. | "Confirm secondary region traffic on the load balancer dashboard." |
| **JavaScript** | You need a small, contained computation — query a config service, transform a payload, run logic before the next step. Runs sandboxed on a [Runbook Agent](/docs/runbooks/agents) in your own infrastructure. | Compute current replica lag and decide whether to proceed. |
| **HTTP request** | You're calling an existing API — your own admin endpoint, a cloud provider, PagerDuty, Slack. | `POST` to your failover orchestrator. |
| **Bash** | You need to run shell commands on your own infrastructure — restart a service, run `kubectl`, call a deploy script. Requires a [Runbook Agent](/docs/runbooks/agents) installed in your environment. | Restart a service, run `kubectl rollout restart`, exec a recovery script. |

You can mix all four in a single runbook — the strength of runbooks is interleaving human verification with automation.

## Where runbooks live in the dashboard

| Page | What you do there |
| --- | --- |
| **Analytics & Automation → Runbooks** | Browse, create, and edit runbook templates. |
| **A runbook's Steps tab** | Author and reorder the step list. |
| **A runbook's Executions tab** | See every run of this runbook with status filters. |
| **A runbook's Run Now button** | Kick off an ad-hoc execution not attached to any event. |
| **Incidents / Alerts / Scheduled Maintenance → Settings → Runbook Rules** | Create the auto-trigger rules per entity type. |
| **An incident / alert / maintenance event → Runbooks tab** | See executions attached to this event and click **Run Runbook** for a manual run. |

## Common use cases

A few patterns we see teams reach for runbooks for:

- **Database failover** — Capture current state with JavaScript, ask the on-call DBA to confirm replica health (Manual), call the orchestrator API (HTTP), tick off "DNS updated" (Manual), post all-clear to Slack (HTTP).
- **Cache flush** — A single HTTP step plus a Manual "confirm cache hit rate is recovering on the dashboard."
- **Customer-impacting incident** — Manual: "Post status page update." HTTP: "Notify CS team in #customer-incidents." JavaScript: "Pull list of affected accounts from internal API."
- **Scheduled maintenance pre-flight** — JavaScript: snapshot current metrics. Manual: "Confirm change window with stakeholders." HTTP: enable maintenance mode on the load balancer.
- **Always-run hygiene** — A rule with an empty title pattern that captures system state on every incident, no matter what — great for postmortems.

## A worked example

Suppose you want every incident with "db-primary" in the title to kick off a five-step DB failover runbook automatically.

**1. Create the runbook.** Under **Runbooks → Create Runbook**, name it "DB primary failover" and add these steps:

| # | Type | Title |
| --- | --- | --- |
| 1 | JavaScript | Capture pre-failover replica lag |
| 2 | Manual | Confirm replica is healthy in DBA dashboard |
| 3 | HTTP | `POST` to failover orchestrator |
| 4 | Manual | Verify writes are now going to the new primary |
| 5 | HTTP | Post all-clear to `#db-incidents` Slack |

**2. Add a rule.** Under **Incidents → Settings → Runbook Rules**, create:

```
Title Pattern:  ^db-primary
Runbooks:       [DB primary failover]
```

**3. Trigger.** A monitor alert opens incident `INC-4821 · db-primary connection timeout`. The rule matches, an execution is created, and:

- Step 1 (JavaScript) runs immediately on the worker — its `return { lagMs: 412 }` value is captured.
- Step 2 (Manual) pauses the run. The on-call sees a "Waiting for you" pill on the incident page, clicks the dashboard, and ticks the step off.
- Step 3 (HTTP) runs as soon as Step 2 is ticked — the `POST` response body is captured.
- Step 4 (Manual) pauses again.
- Step 5 (HTTP) runs and the execution finishes.

**4. Audit.** The execution stays on the incident's **Runbooks** tab. Every step's output is one click away. When you write the postmortem next week, you don't have to ask "what did that script return?" — it's right there.

## How runbooks fit with the rest of OneUptime

- **Monitors** open incidents and alerts; **runbook rules** turn those events into runbook executions. Together they form a closed loop: detect → trigger → respond → record.
- **Workspace connections** (Slack, Microsoft Teams) are a natural target for runbook HTTP steps — post status updates, notify channels.
- **Status pages** are commonly updated as a Manual step in a customer-impacting runbook.
- **On-call schedules** decide who gets paged; runbooks decide what that person does once they're awake.

## Where to read next

- [Authoring a Runbook](/docs/runbooks/authoring) — creating runbooks, the four step types, and what each does.
- [Runbook Rules](/docs/runbooks/rules) — auto-attaching runbooks to incidents, alerts, and scheduled maintenance events.
- [Running a Runbook](/docs/runbooks/running) — manual triggers, the execution view, and how manual steps interact with automated ones.
- [Runbook Agents](/docs/runbooks/agents) — installing the agents that run Bash steps inside your own infrastructure.
- [Configuration & Safety](/docs/runbooks/configuration) — output limits, permissions, hardening notes.
