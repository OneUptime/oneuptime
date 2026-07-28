# AI Auto-Remediation — Propose, Approve, Execute

OneUptime AI can close the loop from detection to action. Where [AI SRE investigations](/docs/ai/ai-sre) stop at a cited root cause analysis, auto-remediation continues one step further: after a confident investigation, the AI proposes concrete remediation actions — running one of your existing runbooks, or a drafted command for one of your [Runbook Agents](/docs/runbooks/agents) — and either waits for a human to approve them or, where you wrote a rule that authorizes it in advance, executes them on its own.

Everything on this page is **off by default**, and nothing ever runs unattended until you have written an **Auto Remediation Rule** saying it may. Read the safety model section before enabling anything — it is the most important part of this page.

## The full story

With every opt-in enabled, the chain runs end to end without a human in the detection loop:

1. **The AI keeps watch.** Deterministic [AI Insight detectors](/docs/ai/ai-sre) scan your telemetry every 15 minutes — new exception fingerprints, exception and error-log spikes, trace latency regressions, metric drift. No LLM reads your firehose; the watchers are statistical checks.
2. **A finding escalates to an alert.** Normally insights wait in a quiet inbox. With **insight escalation** enabled, an insight at or above your chosen severity threshold opens a real alert — titled `[AI] <insight title>`, carrying the insight's evidence, mapped to the alert severity you configured.
3. **The alert pages your on-call.** The escalated alert attaches the on-call duty policy you configured, so it rides the exact same paging machinery as any other alert — escalation rules, rotations, the works. Escalation creates **alerts only** — never incidents, and nothing status-page visible.
4. **The AI investigates.** If automatic alert investigations are enabled, the new alert wakes a read-only, budgeted, citation-minting investigation. Within a few minutes the alert timeline has a root cause analysis where every claim deep-links to the exact log line, trace span, or metric that supports it.
5. **The AI proposes remediation.** If the investigation reached a **confident** conclusion (a server-verified signal, not the model's own prose), one further constrained LLM call reads the analysis alongside a server-fetched list of your enabled runbooks and your runbook agents, and proposes up to three actions. Each proposal names what it wants to run, where, why, and whether it only **diagnoses** or actually **changes something** — posted to the incident or alert timeline.
6. **Your rules decide whether a human is needed.** Every proposal shows Approve and Reject buttons on the incident or alert page. A proposal executes unattended only if an enabled **Auto Remediation Rule** you authored matches this incident or alert — and, for an AI-drafted command, only if that rule also grants **Auto-Execute Drafted Commands**. Where the action would _change_ something, the agent it targets must additionally carry a **ReadWrite** AI access grant. No matching rule means every proposal simply waits for a person.
7. **The outcome is posted back.** Execution runs on the ordinary runbook substrate — same execution view, same step-by-step audit trail — and when it finishes, the result (succeeded or failed) is posted to the timeline and announced to your Slack/Teams workspace. Executing on your infrastructure is always news, so outcomes are never quiet.
8. **A diagnostic answer goes back to the AI.** When a **Diagnostic** action succeeds, its captured output is filed on the incident or alert and one follow-up investigation runs with that output in hand. See [the closed diagnostic loop](#the-closed-diagnostic-loop) below.

Each stage is independently optional. Remediation proposals attach to **any** confident investigation — an ordinary monitor-created incident benefits exactly as much as an escalated insight. You can enable remediation without escalation, escalation without remediation, or approval-only remediation (write no rules at all) without any unattended execution.

## The safety model

This feature runs code on your infrastructure, so the guardrails are the design, not an afterthought. In order of importance:

### Everything is off by default

| Setting                                            | Default  | What it gates                                                                                       |
| -------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| **Enable AI** (Project Settings > AI > AI Credits) | on       | The master kill switch. Turning this off kills every AI path in the project, remediation included.  |
| **Enable AI Remediation**                          | off      | Whether investigations propose remediation actions at all.                                          |
| **Auto Remediation Rules**                         | none     | Whether anything executes _unattended_. With no rules, every proposal waits for a human. See below. |
| **AI Access Level** on each Runbook Agent          | ReadOnly | Whether AI-proposed actions that _change_ things may land on that host at all.                      |
| **Daily AI Remediation Execution Limit**           | 10/day   | How many actions may execute per UTC day. Unset means 10 — not unlimited. Set 0 to pause the lane.  |
| **Enable AI Insight Escalation**                   | off      | Whether insights can open alerts (and therefore page). Independent of remediation.                  |

Turning **Enable AI Remediation** on gets you proposals and nothing more. Autonomy is a second, separate decision you make by writing a rule.

### Auto Remediation Rules are the gate

Nothing an AI proposes executes unattended unless an **enabled Auto Remediation Rule that a project admin authored matches** the incident or alert it was proposed for. This is the single authorization boundary for autonomy — the equivalent of an on-call rule, except what it routes to is execution rather than a person.

Rules come in two flavours, matching the same shape as your on-call and owner rules:

- **Incident Auto Remediation Rules** — **Incidents > Settings > Auto Remediation**.
- **Alert Auto Remediation Rules** — **Alerts > Settings > Auto Remediation**.

Each rule carries a name, a description, an enabled toggle, and any combination of these criteria:

| Criterion                               | Matches when                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| **Monitors**                            | The incident/alert came from one of the listed monitors.                          |
| **Incident / Alert Severities**         | The subject's severity is one of the listed severities.                           |
| **Incident / Alert Labels**             | The subject carries at least one of the listed labels.                            |
| **Monitor Labels**                      | A monitor behind the subject carries at least one of the listed labels.           |
| **Title / Description patterns**        | A case-insensitive regular expression matches the subject's title or description. |
| **Monitor Name / Description patterns** | A case-insensitive regular expression matches a monitor behind the subject.       |

How matching resolves:

- **Every criterion you configure must pass** (AND across criteria), and within one criterion any listed value is enough (OR within a list).
- **A criterion you leave empty is ignored.** Therefore **a rule with no criteria at all matches every incident or alert in the project** — that is the "auto-remediate everything" rule. It is a legitimate thing to want on a test project and a very bad thing to create by accident. Give every rule at least one criterion unless you truly mean "everywhere".
- **Rules are grants, and grants union.** If any enabled rule matches, the subject is authorized. Adding a narrower rule never takes authorization away from a broader one — to withhold autonomy from a class of incidents, make sure no rule matches them.
- **Only enabled rules count**, and evaluation is **fail-closed**: no rules, no match, an invalid stored regex, or any error at all means "wait for a human". Autonomy is never the failure mode.
- **Escalated AI alerts carry no monitor.** A rule with monitor, monitor-label, or monitor-pattern criteria can never match one. Authorize those with severity, label, or title criteria if you want them covered.

The names of the rules that authorized an execution are recorded on the proposal, so "why did this run by itself?" is answerable from the timeline.

### "Auto-Execute Drafted Commands" is a separate, blunt grant

Each rule carries an **Auto-Execute Drafted Commands** toggle. When it is on, a matching subject may execute not only runbooks you wrote, but also **commands the AI drafted**.

Be clear about what that means: **a shell script no human has ever read will run on your infrastructure, unattended.** The AI wrote it from an investigation, the server capped it at 2,000 characters and checked which agent it targets — and that is the whole of the review. Nobody looked at it.

That is a real capability and it has real uses (a staging environment, a lab, a fleet where the blast radius is genuinely bounded). It is also the highest-trust surface in the product. Scope those rules narrowly — a specific set of monitors, a specific severity, a specific label — and prefer leaving the toggle off on any rule that can match production.

Rules where the toggle is off still auto-execute **runbook** actions, which reference procedures a human authored: every step, and which agent each step runs on, was written and accepted by a person before the AI could point at it.

### Per-agent AI access grants decide where writes may land

A rule says _this incident may be handled unattended_. It does not say _the AI may change things on this host_. That second decision lives on the agent, as the **AI Access Level** field on every [Runbook Agent](/docs/runbooks/agents):

| Access level           | AI may dispatch                                                      |
| ---------------------- | -------------------------------------------------------------------- |
| **ReadOnly** (default) | **Diagnostic** actions only — actions that gather information.       |
| **ReadWrite**          | Diagnostic **and Remediation** actions — actions that change things. |

Every proposal declares an **intent**: `Diagnostic` (status checks, log or metric collection, describing resources — changes nothing) or `Remediation` (restart, rollback, scale, delete, config edit). A Remediation action auto-executes only if **every** agent it would touch is granted ReadWrite. A Diagnostic action may auto-execute on any agent the server can resolve, because reading is exactly what ReadOnly permits.

New agents default to **ReadOnly**, and only Project Owners and Project Admins may change the field — it is the boundary that decides whether AI-proposed writes can reach a host at all.

**The recommended posture: leave production agents ReadOnly, grant ReadWrite to your test and staging agents.** That gives you _diagnose everywhere, act only where I said_ — the AI can go look at the production box and bring back what it found, but it can only change the boxes you nominated.

**Be honest about what this enforces.** OneUptime classifies an action by the **intent the proposer declared**; it cannot read a script and prove what it really does. A script labelled Diagnostic that quietly restarts a service will not be caught by this field. The durable enforcement is on your side of the wire: **run ReadOnly agents as an OS user that genuinely cannot mutate anything** — no write access to the paths that matter, no privileged container, no credentials that can change infrastructure. Then the grant is enforced by the operating system rather than by trust, and the field becomes a declaration of something already true.

### Execution is budgeted

| Budget                      | Default              | Behavior                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily execution limit       | **10 per UTC day**   | Counts every execution — human-approved and auto-executed alike. Unset is **not** unlimited: unlike token budgets, an unset limit means the default of 10, because these actions run on your infrastructure. Set **0** to pause all AI remediation execution. Configurable on the AI settings pages (Incidents > Settings > AI, or Alerts > Settings > AI — the setting is shared). |
| Per-incident/alert cap      | **3 executions**     | One flapping subject cannot drain the day's budget. Once three actions have executed for a subject, further remediation there is a human call, not an AI retry loop.                                                                                                                                                                                                                |
| Proposals per investigation | **3**                | An investigation proposes at most three actions.                                                                                                                                                                                                                                                                                                                                    |
| Proposal expiry             | **24 hours**         | A proposal nobody decides on is swept to Expired. An hours-old remediation for a live incident is stale advice; acting on it would be worse than doing nothing. Expired is tracked separately from Rejected so "the team declined" and "this went stale" never blur.                                                                                                                |
| Command script size         | **2,000 characters** | Hard cap on any drafted command.                                                                                                                                                                                                                                                                                                                                                    |

Budgets are checked **at execution time**, for both the approval path and the auto path. An approval that lands over budget puts the action back to Proposed with a message explaining why nothing ran — the Approve button simply works again tomorrow, or after you raise the limit (until the proposal's normal 24-hour expiry).

### Some things never auto-execute, whatever your rules say

Even with a matching rule and the right grants, a proposal falls back to requiring approval when the server cannot establish where it would run:

- A runbook containing an **HTTP request step** — a URL has no agent, so there is no access grant to check.
- A runbook containing a **step type the policy does not recognize** — the fail-safe direction for anything new.
- A runbook or command referencing an **agent the server cannot resolve**.

None of these are refusals. The proposal is still made, still visible on the timeline, still one click away.

### Concurrency cannot double-execute

Every status transition (Proposed → Approved → Executing → Succeeded/Failed, plus Rejected and Expired) is a compare-and-swap: a single conditional update that only one caller can win. Two people clicking Approve at the same moment, or an approval racing the expiry sweeper, resolves to exactly one outcome. An action can never execute twice.

### The proposal call is metered and budgeted like every autonomous call

The single LLM call that drafts proposals runs at temperature 0 with a small token cap, is metered in the AI Logs page like every other call, and counts against the project's **daily autonomous token budget** — the same pool that bounds investigations. No provider, no budget headroom, or no balance simply means no proposals.

### Prompt injection cannot mint targets

The lists of runbooks and agents the model may reference are **fetched server-side** and act as strict allowlists. If the model's output names a runbook ID or agent ID outside those lists — say, because an attacker-controlled log line tried to steer it — the proposal is dropped. Telemetry content is treated as adversarial by default; it can influence _what the AI suggests_, but it cannot invent _where things run_.

### Everything leaves a trail

- Every proposal is a persistent **AI Remediation Action** record: what was proposed, its intent, the rationale, whether a rule auto-approved it (and which), who approved or rejected it and when, the rejection reason, when it executed, and how it ended.
- Every execution is a normal **Runbook Execution** — the same step-by-step audit view as a human-triggered run — stamped with the remediation action that triggered it, so "did the AI start this?" is a recorded fact, not an inference.
- A drafted command, once authorized, is materialized as a single-step runbook marked **Created by AI** before it runs, so even one-off commands ride the same audited substrate.
- The investigation that produced the proposals keeps its full ordered event trail, and its LLM calls are metered in **Project Settings > AI Logs**.

### The environment tag is context, not a control

Every Runbook Agent still carries an **Environment** field (Production, Staging, Testing, Development). It is **informational**: a badge that tells an approver at a glance which kind of box a proposal targets. It gates nothing. Autonomy is decided by your Auto Remediation Rules; where writes may land is decided by the agent's AI Access Level. Tag agents because it makes the approval screen readable, not because it protects you.

## The closed diagnostic loop

A **Diagnostic** action exists to answer a question telemetry could not: _is the pod actually OOMKilled? what does the connection pool look like right now?_ That answer is only worth collecting if it gets back to the AI, so when a Diagnostic action succeeds:

1. The runbook execution's **per-step output is captured** — up to 2,000 characters per step and 6,000 characters in total, with anything beyond that truncated and marked.
2. It is **filed on the incident or alert as an internal note**, clearly labelled as raw output from your infrastructure. Because internal notes are already part of the context an investigation reads, no other plumbing is needed for the next run to see it.
3. **One follow-up investigation is queued**, and it now reasons with the live host output in hand rather than telemetry alone.

The loop terminates by construction, three ways over:

- The **per-subject execution cap** (3) means a subject only ever gets a few actions executed at all.
- A **per-subject investigation cap** (4 investigation runs of any origin, including the original wake-on-signal run) stops follow-ups even if actions are still available.
- The **daily autonomous token budget** bounds the LLM spend of every investigation the loop can start.

A diagnostic that produces no output files nothing and queues nothing.

**Captured output is untrusted data.** A log line, a process name, or a container label can all carry text an attacker chose. The captured block is fenced and explicitly labelled as untrusted in the note — the same treatment every tool result gets. It is evidence for the next investigation to reason about, never instructions for it to follow.

## Setting it up

### 1. Deploy Runbook Agents

Follow the [Runbook Agents guide](/docs/runbooks/agents) to install an agent inside your infrastructure — one per environment or blast-radius boundary you care about. An agent can only do what the host and OS user you run it as can do, which is the most important sizing decision on this page.

### 2. Set each agent's AI access level

On **Runbooks > Settings > Agents**, set **AI Access Level** on every agent:

- Leave production agents **ReadOnly** (the default). The AI can still run diagnostics there — and that alone is most of the value.
- Grant **ReadWrite** only where you are content for the AI to change things unattended, typically test and staging.

Back the grant with OS permissions: a ReadOnly agent should be running as a user that genuinely cannot mutate anything. Only Project Owners and Admins can change this field.

### 3. Author the runbooks you would trust the AI to suggest

The AI proposes from your **enabled** runbooks. It picks whole runbooks — it cannot edit steps, reorder them, or choose different agents inside one. So the unit of trust is the runbook as you wrote it:

- Give runbooks clear names and descriptions — that text is what the model matches against a root cause. "Recycle payments-api worker pool" beats "runbook-7".
- Write steps to be **safe to re-run** and, where possible, reversible. There is no undo (see limitations below).
- Keep destructive procedures out of enabled runbooks, or gate them behind Manual steps — a Manual step parks the execution until a human completes it, even in an auto-executed run.

### 4. Enable the lane

On **Incidents > Settings > AI** (or **Alerts > Settings > AI** — the card is shared between both):

- Turn on **Enable AI Remediation**.
- Optionally set the **Daily AI Remediation Execution Limit** (unset means 10/day; 0 pauses).

Remediation proposals ride investigations, so also make sure automatic investigations are on for the signals you care about, and that an [LLM provider](/docs/ai/llm-provider) is configured.

Stop here and you have the whole feature in approval-only mode: proposals appear on incidents and alerts, and nothing runs until someone clicks Approve. Many teams should stay here for a while.

### 5. Author Auto Remediation Rules for what you want handled unattended

When you are ready for autonomy, go to **Incidents > Settings > Auto Remediation** (and/or **Alerts > Settings > Auto Remediation**) and create a rule. Start narrow:

- Name it for the thing it authorizes, e.g. "Staging checkout — auto-remediate".
- Give it **at least one criterion**. A rule with none matches every incident in the project.
- Decide **Auto-Execute Drafted Commands** deliberately. Leave it off unless you genuinely accept unreviewed scripts running on the hosts this rule can reach.
- Remember what the rule cannot do on its own: a Remediation action still needs a ReadWrite agent underneath it.

Only Project Owners and Project Admins can create, edit, or delete rules.

### 6. Optionally, let insights page

If you want the watch loop itself to open alerts, configure insight escalation in **AI > Insights > Settings**:

- **Enable AI Insight Escalation** — the opt-in.
- **Minimum severity** — only insights at or above this severity escalate. Unset means **High**, so only the strongest detector findings ever page. (Metric drift insights are always Low severity, so with the default threshold they can never page.)
- **Alert severity** — which of your alert severities escalated insights are created with. Unset falls back to your most critical severity.
- **On-call duty policy** — the policy the escalated alert should page. Without one, no policy is attached directly — but your Alert on-call rules can still match the escalated alert and page whoever they route to.

Escalation deliberately creates at most **3 alerts per scan cycle** per project, and an insight that already escalated never escalates again — a recurring finding refreshes its existing insight instead.

## A worked example

The Checkout project runs two runbook agents: `prod-eu-central-1` (AI access **ReadOnly**) and `staging-eu-central-1` (AI access **ReadWrite**). AI Insights, insight escalation (minimum severity High, on-call policy "Platform on-call"), alert investigations, and AI remediation are all enabled. One alert rule exists — **"Staging checkout — auto-remediate"**, matching alerts labelled `staging`, with Auto-Execute Drafted Commands **on**. Nothing matches production alerts.

- **02:10** — The error-log spike detector files an insight: _Error log volume spike: 4.2× the normal hourly rate — top contributing service: payments-api_, severity High.
- **02:10** — High meets the escalation threshold. An alert `[AI] Error log volume spike: payments-api` is created with the insight's evidence and pages Priya through "Platform on-call". It carries no `staging` label, so no rule matches it.
- **02:12** — The wake-on-alert investigation posts its cited analysis: the 22:47 deploy of `payments-api` introduced an unbounded retry loop; the connection pool is exhausted; every claim deep-links to the spans and log lines that prove it. The confidence signal is positive.
- **02:12** — The remediation proposer runs. From the project's enabled runbooks and agents it proposes two actions on the alert timeline:
  1. **Runbook: "Recycle payments-api worker pool"**, intent **Remediation** — rationale: the pool is exhausted and the runbook's Bash steps drain and restart the workers. Its steps target `prod-eu-central-1`. No rule matches this alert, so it **requires approval** — and even if one did, `prod-eu-central-1` is ReadOnly, so a Remediation action there would still wait.
  2. **Command** for `prod-eu-central-1`, intent **Diagnostic**: `kubectl -n payments get pods -o wide && kubectl -n payments describe deploy/payments-api` — rationale: confirm how many replicas are actually serving. Also **requires approval**, because no rule matches this alert at all.
     The workspace gets one ping: proposals are waiting.
- **02:15** — Priya reads the analysis, agrees with the diagnosis, and clicks **Approve** on the diagnostic command. The daily budget (0 of 10 used) and the per-alert cap (0 of 3) pass; the command is materialized as a single-step AI-authored runbook and dispatched to `prod-eu-central-1`.
- **02:16** — It succeeds. The output is filed on the alert as an internal note, and one follow-up investigation is queued with that output in hand. She approves the worker-pool runbook next; it completes, the outcome is posted to the alert timeline, and the workspace is notified.

Contrast the staging path. At **02:40** a monitor-created alert labelled `staging` fires for the same service. Its investigation proposes a Remediation command for `staging-eu-central-1`. This time the rule **"Staging checkout — auto-remediate"** matches (the `staging` label), the rule grants Auto-Execute Drafted Commands, and `staging-eu-central-1` is granted ReadWrite — so the command executes the moment it is proposed, and the timeline shows an outcome rather than a request, annotated with the rule that authorized it.

## Where things live in the dashboard

- **Incident and alert pages** — the AI Investigation panel gains a Remediation section: every proposal with its status, intent, rationale, target (with the agent's environment badge and access level), the command script where applicable, Approve/Reject buttons while a proposal is live, and a link to the runbook execution once one exists.
- **AI > Remediation** — a project-wide list of all remediation actions, filterable by status, so pending proposals never depend on someone having the right incident page open.
- **Incidents > Settings > Auto Remediation** and **Alerts > Settings > Auto Remediation** — the Auto Remediation Rules that stand in for a human approval.
- **Runbooks > Settings > Agents** — each agent's AI Access Level and its (informational) environment tag.
- **Incidents > Settings > AI** and **Alerts > Settings > AI** — the AI Remediation settings card (shared between both).
- **AI > Insights > Settings** — the insight escalation settings.
- **Project Settings > AI Logs** — where the proposal calls are metered.

## Limitations — read before relying on it

- **There is no undo.** Executing a runbook is not reversible by the platform; whatever the runbook did stays done. Write runbooks to be reversible or idempotent, and keep anything irreversible behind a Manual step or out of enabled runbooks entirely. (An undo/rollback contract is roadmap work, not a hidden feature.)
- **A rule is a standing authorization.** It is not a one-time approval: it applies to every future incident or alert that matches it, including ones nobody has imagined yet. Review Auto Remediation Rules the way you review on-call policies — periodically, and whenever the things they match change.
- **Rule scope is asserted, not verified.** OneUptime checks that a rule matches; it cannot know that the monitors, labels, or patterns you chose describe the blast radius you had in mind. A pattern that is broader than you thought silently authorizes more than you meant.
- **Intent is declared, not proven.** An action's Diagnostic/Remediation label comes from the proposer, and access grants are enforced against that label. OneUptime cannot inspect a script and prove what it does — which is why a ReadOnly agent should also be an OS user that cannot mutate anything.
- **The AI picks whole runbooks, not steps.** It cannot retarget a step at a different agent, skip a step, or pass parameters. If a runbook is only sometimes safe, that nuance is invisible to the proposer — split it into runbooks that are each always safe, or leave it disabled.
- **Success is not verification.** Succeeded means the runbook execution completed, not that the incident is fixed. Nothing checks the outcome against the symptom.
- **Escalated alerts carry no monitor**, so rules with monitor-based criteria never match them, and the per-monitor re-investigation cooldown that protects against repeat alerts from a flapping monitor does not apply to them either. Escalation has its own duplicate protection (an insight escalates at most once, and each scan escalates at most three), but it is a different mechanism.
- **Proposals only follow confident investigations.** An inconclusive analysis proposes nothing — the same fail-quiet direction as the rest of the AI. If investigations in your project rarely reach confidence, you will rarely see proposals.
- **Proposals expire after 24 hours.** Remediation is advice about a live situation; it is not left lying around to be executed against a different one.
