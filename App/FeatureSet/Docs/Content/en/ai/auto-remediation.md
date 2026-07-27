# AI Auto-Remediation — Propose, Approve, Execute

OneUptime AI can close the loop from detection to action. Where [AI SRE investigations](/docs/ai/ai-sre) stop at a cited root cause analysis, auto-remediation continues one step further: after a confident investigation, the AI proposes concrete remediation actions — running one of your existing runbooks, or a drafted command for one of your [Runbook Agents](/docs/runbooks/agents) — and either waits for a human to approve them or, in narrowly defined non-production cases you explicitly opt into, executes them on its own.

Everything on this page is **off by default**. Read the safety model section before enabling anything — it is the most important part of this page.

## The full story

With every opt-in enabled, the chain runs end to end without a human in the detection loop:

1. **The AI keeps watch.** Deterministic [AI Insight detectors](/docs/ai/ai-sre) scan your telemetry every 15 minutes — new exception fingerprints, exception and error-log spikes, trace latency regressions, metric drift. No LLM reads your firehose; the watchers are statistical checks.
2. **A finding escalates to an alert.** Normally insights wait in a quiet inbox. With **insight escalation** enabled, an insight at or above your chosen severity threshold opens a real alert — titled `[AI] <insight title>`, carrying the insight's evidence, mapped to the alert severity you configured.
3. **The alert pages your on-call.** The escalated alert attaches the on-call duty policy you configured, so it rides the exact same paging machinery as any other alert — escalation rules, rotations, the works. Escalation creates **alerts only** — never incidents, and nothing status-page visible.
4. **The AI investigates.** If automatic alert investigations are enabled, the new alert wakes a read-only, budgeted, citation-minting investigation. Within a few minutes the alert timeline has a root cause analysis where every claim deep-links to the exact log line, trace span, or metric that supports it.
5. **The AI proposes remediation.** If the investigation reached a **confident** conclusion (a server-verified signal, not the model's own prose), one further constrained LLM call reads the analysis alongside a server-fetched list of your enabled runbooks and your runbook agents, and proposes up to three actions. Each proposal names what it wants to run, where, and why — posted to the incident or alert timeline.
6. **A human approves — or a non-production runbook runs itself.** Every proposal shows Approve and Reject buttons on the incident or alert page. Runbook actions can skip the wait _only_ when you opted into non-production auto-execution _and_ every step of that runbook targets an agent you explicitly tagged as Staging, Testing, or Development. Drafted commands always wait for a human, everywhere.
7. **The outcome is posted back.** Execution runs on the ordinary runbook substrate — same execution view, same step-by-step audit trail — and when it finishes, the result (succeeded or failed) is posted to the timeline and announced to your Slack/Teams workspace. Executing on your infrastructure is always news, so outcomes are never quiet.

Each stage is independently optional. Remediation proposals attach to **any** confident investigation — an ordinary monitor-created incident benefits exactly as much as an escalated insight. You can enable remediation without escalation, escalation without remediation, or approval-only remediation without any auto-execution.

## The safety model

This feature runs code on your infrastructure, so the guardrails are the design, not an afterthought. In order of importance:

### Everything is off by default

Four separate opt-ins gate the chain, each defaulting to off:

| Setting                                                  | Default | What it gates                                                                                                  |
| -------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| **Enable AI** (Project Settings > AI > AI Credits)       | on      | The master kill switch. Turning this off kills every AI path in the project, remediation included.             |
| **Enable AI Remediation**                                | off     | Whether investigations propose remediation actions at all.                                                     |
| **Auto-Execute AI Remediation on Non-Production Agents** | off     | Whether eligible runbook proposals may execute without approval. Meaningless unless AI Remediation is also on. |
| **Enable AI Insight Escalation**                         | off     | Whether insights can open alerts (and therefore page). Independent of remediation.                             |

### Drafted commands always require human approval

A **command** proposal is a shell script the AI wrote — nobody has ever reviewed it. Commands therefore require an explicit human approval **everywhere, always**. There is no flag, plan, or configuration that lets a drafted command execute unattended. This is a deliberate v1 invariant, not a missing feature.

A **runbook** proposal, by contrast, references a runbook a human already authored: every step, and which agent each step runs on, was written and accepted by a person before the AI could ever point at it. That is why runbook actions are the only kind eligible for auto-execution.

### Auto-execution is fenced to explicitly non-production agents

Even with auto-execution enabled, a runbook proposal executes unattended only when **every** Bash and JavaScript step in it targets a Runbook Agent whose **Environment** field is explicitly set to Staging, Testing, or Development:

- An agent tagged **Production** never auto-runs.
- An agent that was **never tagged** counts as Production — the fail-safe direction. Nothing auto-runs anywhere until a human has deliberately said "this agent is a test box".
- A runbook containing an **HTTP request step** never auto-runs: a URL has no environment tag to verify.
- A runbook referencing an agent the server cannot resolve never auto-runs.

Anything that fails these checks simply falls back to requiring approval — it is still proposed, still visible, still one click away.

**Tag truthfully.** The environment tag is an assertion you make, not something OneUptime can verify. If you tag a production agent as "Testing", you have defeated this guardrail entirely — the AI will treat that host as a safe place to act unattended. Treat the environment field with the same care as the agent's key.

### Execution is budgeted

| Budget                      | Default              | Behavior                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily execution limit       | **10 per UTC day**   | Counts every execution — human-approved and auto-executed alike. Unset is **not** unlimited: unlike token budgets, an unset limit means the default of 10, because these actions run on your infrastructure. Set **0** to pause all AI remediation execution. Configurable on the AI settings pages (Incidents > Settings > AI, or Alerts > Settings > AI — the setting is shared). |
| Per-incident/alert cap      | **3 executions**     | One flapping subject cannot drain the day's budget. Once three actions have executed for a subject, further remediation there is a human call, not an AI retry loop.                                                                                                                                                                                                                |
| Proposals per investigation | **3**                | An investigation proposes at most three actions.                                                                                                                                                                                                                                                                                                                                    |
| Proposal expiry             | **24 hours**         | A proposal nobody decides on is swept to Expired. An hours-old remediation for a live incident is stale advice; acting on it would be worse than doing nothing. Expired is tracked separately from Rejected so "the team declined" and "this went stale" never blur.                                                                                                                |
| Command script size         | **2,000 characters** | Hard cap on any drafted command.                                                                                                                                                                                                                                                                                                                                                    |

Budgets are checked **at execution time**, for both the approval path and the auto path. An approval that lands over budget parks the action as Approved with a message explaining why — it can run tomorrow, or after you raise the limit.

### Concurrency cannot double-execute

Every status transition (Proposed → Approved → Executing → Succeeded/Failed, plus Rejected and Expired) is a compare-and-swap: a single conditional update that only one caller can win. Two people clicking Approve at the same moment, or an approval racing the expiry sweeper, resolves to exactly one outcome. An action can never execute twice.

### The proposal call is metered and budgeted like every autonomous call

The single LLM call that drafts proposals runs at temperature 0 with a small token cap, is metered in the AI Logs page like every other call, and counts against the project's **daily autonomous token budget** — the same pool that bounds investigations. No provider, no budget headroom, or no balance simply means no proposals.

### Prompt injection cannot mint targets

The lists of runbooks and agents the model may reference are **fetched server-side** and act as strict allowlists. If the model's output names a runbook ID or agent ID outside those lists — say, because an attacker-controlled log line tried to steer it — the proposal is dropped. Telemetry content is treated as adversarial by default; it can influence _what the AI suggests_, but it cannot invent _where things run_.

### Everything leaves a trail

- Every proposal is a persistent **AI Remediation Action** record: what was proposed, the rationale, who approved or rejected it and when, the rejection reason, when it executed, and how it ended.
- Every execution is a normal **Runbook Execution** — the same step-by-step audit view as a human-triggered run — stamped with the remediation action that triggered it, so "did the AI start this?" is a recorded fact, not an inference.
- A drafted command, once approved, is materialized as a single-step runbook marked **Created by AI** before it runs, so even one-off commands ride the same audited substrate.
- The investigation that produced the proposals keeps its full ordered event trail, and its LLM calls are metered in **Project Settings > AI Logs**.

## Setting it up

### 1. Deploy a Runbook Agent and tag its environment

Follow the [Runbook Agents guide](/docs/runbooks/agents) to install an agent inside your infrastructure. When creating (or editing) the agent, set its **Environment** field: Production, Staging, Testing, or Development.

Tag every agent, and tag honestly. Untagged agents are treated as Production — that is safe, but it also means auto-execution will never trigger until you tag something. And a production host mistagged as Testing removes the strongest guardrail this feature has.

### 2. Author the runbooks you would trust the AI to suggest

The AI proposes from your **enabled** runbooks. It picks whole runbooks — it cannot edit steps, reorder them, or choose different agents inside one. So the unit of trust is the runbook as you wrote it:

- Give runbooks clear names and descriptions — that text is what the model matches against a root cause. "Recycle payments-api worker pool" beats "runbook-7".
- Write steps to be **safe to re-run** and, where possible, reversible. There is no undo (see limitations below).
- Keep destructive procedures out of enabled runbooks, or gate them behind Manual steps — a Manual step parks the execution until a human completes it, even in an auto-executed run.

### 3. Enable the flags

On **Incidents > Settings > AI** (or **Alerts > Settings > AI** — the card is shared between both):

- Turn on **Enable AI Remediation**.
- Optionally turn on **Auto-Execute AI Remediation on Non-Production Agents** — only after your agents are tagged truthfully.
- Optionally set the **Daily AI Remediation Execution Limit** (unset means 10/day; 0 pauses).

Remediation proposals ride investigations, so also make sure automatic investigations are on for the signals you care about (**Incidents > Settings > AI** and **Alerts > Settings > AI**), and that an [LLM provider](/docs/ai/llm-provider) is configured.

### 4. Optionally, let insights page

If you want the watch loop itself to open alerts, configure insight escalation in **AI > Insights > Settings**:

- **Enable AI Insight Escalation** — the opt-in.
- **Minimum severity** — only insights at or above this severity escalate. Unset means **High**, so only the strongest detector findings ever page. (Metric drift insights are always Low severity, so with the default threshold they can never page.)
- **Alert severity** — which of your alert severities escalated insights are created with. Unset falls back to your most critical severity.
- **On-call duty policy** — the policy the escalated alert should page. Without one, the alert is created but pages nobody.

Escalation deliberately creates at most **3 alerts per scan cycle** per project, and an insight that already escalated never escalates again — a recurring finding refreshes its existing insight instead.

## A worked example

The Checkout project runs two runbook agents: `prod-eu-central-1` (tagged Production) and `staging-eu-central-1` (tagged Staging). AI Insights, insight escalation (minimum severity High, on-call policy "Platform on-call"), alert investigations, and AI remediation are all enabled; auto-execution is not.

- **02:10** — The error-log spike detector files an insight: _Error log volume spike: 4.2× the normal hourly rate — top contributing service: payments-api_, severity High.
- **02:10** — High meets the escalation threshold. An alert `[AI] Error log volume spike: payments-api` is created with the insight's evidence and pages Priya through "Platform on-call".
- **02:12** — The wake-on-alert investigation posts its cited analysis: the 22:47 deploy of `payments-api` introduced an unbounded retry loop; the connection pool is exhausted; every claim deep-links to the spans and log lines that prove it. The confidence signal is positive.
- **02:12** — The remediation proposer runs. From the project's enabled runbooks and agents it proposes two actions on the alert timeline:
  1. **Runbook: "Recycle payments-api worker pool"** — rationale: the pool is exhausted and the runbook's Bash steps drain and restart the workers. Its steps target `prod-eu-central-1`, which is Production, so it **requires approval** (it would even if auto-execution were on).
  2. **Command** for `staging-eu-central-1`: `kubectl -n payments rollout restart deployment/payments-api` — rationale: verify the restart clears the retry loop in staging first. Commands **always require approval**.
     The workspace gets one ping: proposals are waiting.
- **02:15** — Priya reads the analysis, agrees with the diagnosis, and clicks **Approve** on the runbook action. The daily budget (0 of 10 used) and the per-alert cap (0 of 3) pass; a runbook execution starts, stamped as triggered by this remediation action. She rejects the staging command with the reason "staging can wait for morning".
- **02:17** — The execution completes. The action is marked Succeeded, the outcome is posted to the alert timeline, and the workspace is notified. The alert record now tells the whole story: what fired, what the cause was, what was done about it, who approved it, and how it ended.

Had "Recycle payments-api worker pool" targeted only `staging-eu-central-1`, and had the project opted into non-production auto-execution, step one would have executed the moment it was proposed — with the outcome (not a request) posted to the timeline.

## Where things live in the dashboard

- **Incident and alert pages** — the AI Investigation panel gains a Remediation section: every proposal with its status, rationale, target (and environment badge), the command script where applicable, Approve/Reject buttons while a proposal is live, and a link to the runbook execution once one exists.
- **AI > Remediation** — a project-wide list of all remediation actions, filterable by status, so pending proposals never depend on someone having the right incident page open.
- **Settings > Runbooks > Agents** — the environment tag on each agent.
- **Incidents > Settings > AI** and **Alerts > Settings > AI** — the AI Remediation settings card (shared between both).
- **AI > Insights > Settings** — the insight escalation settings.
- **Project Settings > AI Logs** — where the proposal calls are metered.

## Limitations — read before relying on it

- **There is no undo.** Executing a runbook is not reversible by the platform; whatever the runbook did stays done. Write runbooks to be reversible or idempotent, and keep anything irreversible behind a Manual step or out of enabled runbooks entirely. (An undo/rollback contract is roadmap work, not a hidden feature.)
- **The AI picks whole runbooks, not steps.** It cannot retarget a step at a different agent, skip a step, or pass parameters. If a runbook is only sometimes safe, that nuance is invisible to the proposer — split it into runbooks that are each always safe, or leave it disabled.
- **Environment tags are trusted, not verified.** OneUptime cannot detect that a "Testing" agent actually sits in production. The tag is a human assertion, and auto-execution is only as safe as your tagging discipline.
- **Escalated alerts carry no monitor**, so the per-monitor re-investigation cooldown that protects against repeat alerts from a flapping monitor does not apply to them. Escalation has its own duplicate protection (an insight escalates at most once, and each scan escalates at most three), but it is a different mechanism.
- **Proposals only follow confident investigations.** An inconclusive analysis proposes nothing — the same fail-quiet direction as the rest of the AI. If investigations in your project rarely reach confidence, you will rarely see proposals.
- **Proposals expire after 24 hours.** Remediation is advice about a live situation; it is not left lying around to be executed against a different one.
