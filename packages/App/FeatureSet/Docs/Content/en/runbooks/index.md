# Runbooks Overview

A runbook is a reusable response procedure: an ordered list of manual and automated steps that you run on an incident, an alert or a scheduled maintenance event. It turns the "what do we do now?" thread into a checklist anyone on call can follow at 3am, with the scripts, API calls and approvals already written. Runbooks are for the on-call engineers who respond to incidents and for the platform teams who automate that response.

:::cards
- [Authoring a Runbook](/docs/runbooks/authoring): Create a runbook and write its steps.
- [Runbook Rules](/docs/runbooks/rules): Start runbooks on new incidents, alerts and maintenance events.
- [Running a Runbook](/docs/runbooks/running): Start a run, complete and approve its steps, cancel it.
- [Runbook Triggers](/docs/runbooks/triggers): Run a runbook on a schedule, or from another tool through its webhook URL.
- [Runbook Variables](/docs/runbooks/variables): The hosts, keys, passwords and kubeconfigs your steps use by name.
- [Runbook Agents](/docs/runbooks/agents): Install the Runner that runs your scripts in your own infrastructure.
:::

## How a runbook runs

```mermaid title="From a trigger to a recorded result"
flowchart TB
    subgraph triggers["What starts a run"]
        direction LR
        rule["Runbook rule"]
        manual["Run Runbook<br/>on an event"]
        runnow["Run Now on<br/>the runbook"]
    end
    rule --> execution["Execution:<br/>a snapshot<br/>of the steps"]
    manual --> execution
    runnow --> execution
    execution --> worker["OneUptime<br/>Worker takes the<br/>steps in order"]
    worker -->|"Manual step<br/>or approval"| person["Waits for<br/>a person"]
    worker -->|"HTTP and<br/>AI steps"| onworker["Runs on<br/>the Worker"]
    worker -->|"JavaScript,<br/>Bash, SSH,<br/>kubectl"| runner["Runner in your<br/>infrastructure"]
    person --> record["Status, output<br/>and errors<br/>recorded"]
    onworker --> record
    runner --> record
    record --> history["The event's<br/>Runbooks<br/>page and the<br/>runbook's<br/>Executions"]
```

Every run is an **execution**. When it starts, the runbook's steps are copied onto it, and OneUptime works through them in order. A Manual step, or a step that needs approval, pauses the run until someone acts on it.

HTTP and AI steps run on the OneUptime Worker. Bash, SSH and kubectl steps run on a [Runner](/docs/runbooks/agents) you install in your own infrastructure, so those scripts never run on OneUptime's servers. A JavaScript step runs on one of your Runners too or, if it picks none and the project has no [default Runner](/docs/runbooks/agents#the-projects-default-runner), on a [global Runner](/docs/runbooks/agents#global-runners), in a sandbox that reaches the internet only. Each step's status, output and error message are recorded on the execution, which stays with the incident, alert or event it ran for.

## Key concepts

| Term | Meaning |
| --- | --- |
| **Runbook** | The template. A named, reusable procedure with an ordered list of steps and a **Run this runbook** switch. |
| **Step** | One item in a runbook. It has a type (Manual, JavaScript, HTTP request, Bash, SSH, kubectl or AI), a title, a description and type-specific settings. |
| **Runbook Rule** | A rule that auto-attaches one or more runbooks to incidents, alerts, or scheduled maintenance events that match its conditions: their monitors, severity, labels, monitor labels, title or description. |
| **Execution** | One run of a runbook. Created when a rule fires, when someone clicks **Run Runbook** on an event, or when someone clicks **Run Now** on the runbook itself. It holds a snapshot of the steps and each step's status and output. |
| **Snapshot** | The frozen copy of the runbook's steps that lives on each execution. You can edit the runbook later without rewriting the history of past runs. |
| **Runner** | A small agent you run on a host in your own infrastructure. It runs the JavaScript, Bash, SSH and kubectl steps that name it. Also called a Runbook Agent. A global Runner, one OneUptime runs for every project, runs the JavaScript steps that name none, unless the project has a default Runner. |
| **Variable** | A value steps use by name, such as a host or a URL: `{{global.variables.NAME}}` for one of the project's, which every runbook can use, or `{{local.variables.NAME}}` for one of the runbook's own. |
| **Secret** | A variable whose value is encrypted at rest, never shown again and hidden in what steps print, such as an SSH key, a password, a kubeconfig or an API token. Handed only to the Runners you let use it; global Runners get it only if you let them. |

## Step types

Pick the type that fits each step. [Authoring a Runbook](/docs/runbooks/authoring) has every type's settings.

| Step type | Runs on | Reach for it when… | Example |
| --- | --- | --- | --- |
| **Manual** | A person | A human has to verify something, make a judgement call, or act where OneUptime can't. | "Confirm traffic has moved to the secondary region." |
| **JavaScript** | A Runner | You need a small, contained computation, sandboxed. | Compute replica lag and decide whether to proceed. |
| **HTTP request** | The OneUptime Worker | You're calling an existing API: a cloud provider, PagerDuty, a Slack webhook, your own service. | `POST` to your failover orchestrator. |
| **Bash** | A Runner | You need shell commands on your own infrastructure. | Run a recovery script, or `curl` a service only your network reaches. |
| **SSH** | A Runner | You need a bash script on a remote machine, signed in with a secret variable. | Restart a service on a web server. |
| **kubectl** | A Runner | You need kubectl commands against a cluster. | Restart `checkout-api` in `production`, then wait for its new pods. |
| **AI** | The OneUptime Worker | You want an analysis, a summary or a judgement call mid-run, from your project's LLM provider. | "Review the diagnostics above. Is it safe to fail over?" |

A runbook can mix all of them. The strength of runbooks is interleaving human checks with automation and AI analysis.

## What starts a run

| How | Where | The execution is attached to |
| --- | --- | --- |
| A runbook rule | **Incidents**, **Alerts** or **Scheduled Maintenance** → **Rules** → **Runbook Rules** | The new incident, alert or event |
| **Run Runbook** | The **Runbooks** page of an incident, alert or scheduled maintenance event | That event |
| **Run Now** | The runbook's **Overview** page | Nothing: an ad-hoc run |
| An AI rule | See [AI SRE](/docs/ai/ai-sre) | The incident or alert |
| The runbook's schedule | The runbook's **Triggers** page, see [Runbook Triggers](/docs/runbooks/triggers#run-on-a-schedule) | Nothing: an unattended run |
| A call to the runbook's webhook URL | The runbook's **Triggers** page, see [Runbook Triggers](/docs/runbooks/triggers#call-the-webhook) | Nothing: the run keeps the values the call sent |

A runbook whose **Run this runbook** switch is off, on its **Settings** page, is not started by any of these. Runs that already started carry on.

## Where runbooks live in the dashboard

Runbooks is under **Products**, in the **Dashboards & Automation** group.

| Page | What you do there |
| --- | --- |
| **Products → Runbooks** | Browse, create and open runbooks. |
| A runbook's **Steps** | Write and reorder its steps, then **Save Steps**. |
| A runbook's **Overview** | See its last run and outcomes, and click **Run Now**. |
| A runbook's **Executions** | Every run of this runbook, filtered by status or start date. |
| A runbook's **Triggers** | Run it on a [schedule](/docs/runbooks/triggers#run-on-a-schedule), or from another tool through its [webhook URL](/docs/runbooks/triggers#call-the-webhook). |
| A runbook's **Variables** | Manage the [variables](/docs/runbooks/variables) only this runbook's steps use. |
| A runbook's **Owners** | Add the people and teams responsible for it. |
| A runbook's **Settings** | Turn **Run this runbook** off without deleting the runbook. |
| **Runbooks → Executions** | Every run of every runbook in the project. |
| **Runbooks → Runners** | Install the [Runners](/docs/runbooks/agents) your runbook steps run on. |
| **Runbooks → Settings** | Manage the **Global Variables** every runbook can [use](/docs/runbooks/variables), and the **Owner Rules** and **Label Rules** that add owners and labels to new runbooks. |
| **Incidents / Alerts / Scheduled Maintenance → Rules → Runbook Rules** | Create the rules that start runbooks automatically. |
| An incident, alert or maintenance event → **Runbooks** | See the runs attached to it, and click **Run Runbook** to start one. |

A runbook's own side menu groups its pages like this. Only **Basic** starts open: click a section's title to open it. A section opens by itself on any page inside it.

| Section | Pages |
| --- | --- |
| **Basic** | **Overview**, **Steps** |
| **Logs** | **Executions** |
| **Owners** | **Owners** |
| **Settings** | **Triggers**, **Variables**, **Settings** |
| **Developer** | **Terraform**, **API**, **AI Assistants** |
| **Advanced** | **Audit Logs**, **Delete Runbook** |

## A worked example

Suppose you want every incident with "db-primary" in its title to start a five-step database failover runbook.

:::steps
### Create the runbook

Under **Runbooks**, click **Create Runbook** and name it "DB primary failover". It opens on its **Steps**: add these steps, then click **Save Steps**:

| # | Type | Title |
| --- | --- | --- |
| 1 | JavaScript | Capture pre-failover replica lag |
| 2 | Manual | Confirm the replica is healthy in the DBA dashboard |
| 3 | HTTP request | `POST` to the failover orchestrator |
| 4 | Manual | Verify writes are going to the new primary |
| 5 | HTTP request | Post the all-clear to `#db-incidents` in Slack |

### Add a rule

Under **Incidents → Rules → Runbook Rules**, create a rule with one condition and the runbook to start:

```text
Conditions:  Incident Title starts with db-primary
Runbooks:    [DB primary failover]
```

### Let it run

A monitor opens incident `INC-4821 · db-primary connection timeout`. The rule matches and an execution starts:

- Step 1 (JavaScript) runs on the Runner you picked for it. Its return value, such as `{ lagMs: 412 }`, is captured. A step that picks no Runner runs on the project's default Runner or, with none set, on a global Runner.
- Step 2 (Manual) pauses the run, which shows **Waiting for you**. The on-call checks the dashboard and clicks **Mark complete**.
- Step 3 (HTTP request) runs, and the `POST` response is captured.
- Step 4 (Manual) pauses the run again until someone completes it.
- Step 5 (HTTP request) runs, and the execution is **Completed**.

### Review it

The execution stays on the incident's **Runbooks** page. When you write the postmortem, every step's output, error and timing is one click away.
:::

## Common use cases

- **Database failover**: capture state with JavaScript, ask the on-call DBA to confirm replica health (Manual), call the orchestrator (HTTP request), confirm DNS (Manual), post the all-clear (HTTP request).
- **Cache flush**: one HTTP request, then a Manual "confirm the cache hit rate is recovering".
- **Customer-impacting incident**: Manual "post a status page update", HTTP request to notify the support team, JavaScript to pull the list of affected accounts.
- **Scheduled maintenance pre-flight**: snapshot metrics, confirm the change window with stakeholders (Manual), enable maintenance mode on the load balancer (HTTP request).
- **Diagnose, then fix**: a Bash step collects diagnostics, an AI step reads them and recommends a fix, and a kubectl step with **Require approval** restarts the workload only once a person has approved it.
- **Always-run hygiene**: a rule with no conditions that captures system state on every incident, for the postmortem.

## How runbooks fit with the rest of OneUptime

- **Monitors** open incidents and alerts, and **runbook rules** turn them into runbook executions: detect, trigger, respond, record.
- **[On-call policies](/docs/on-call/schedules)** decide who is paged. Runbooks decide what that person does once they are awake.
- **[Workspace connections](/docs/workspace-connections/slack)** such as Slack and Microsoft Teams are natural targets for HTTP request steps that post updates.
- **[Status pages](/docs/status-pages/index)** are often updated as a Manual step of a customer-facing runbook.

## Next steps

:::cards
- [Authoring a Runbook](/docs/runbooks/authoring): Create your first runbook and its steps.
- [Runbook Agents](/docs/runbooks/agents): Install a Runner before you write a Bash, SSH or kubectl step.
- [Runbook Rules](/docs/runbooks/rules): Start runbooks automatically when incidents are created.
- [Runbook Configuration & Safety](/docs/runbooks/configuration): Limits, timeouts, permissions and hardening.
:::
