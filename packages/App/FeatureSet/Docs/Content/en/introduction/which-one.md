# Which One Do I Use?

Some things in OneUptime look alike. This page puts each set side by side, with what each one is for, so you pick the right one the first time. Each table fits on one screen, and its first column opens the page that covers that choice in full.

:::cards
- [Incident, alert or another kind of problem?](#incident-alert-or-another-kind-of-problem): What a problem becomes in OneUptime.
- [Workflow, runbook, playbook or AI rule?](#workflow-runbook-playbook-or-ai-rule): What to automate with.
- [Monitor group, service or label?](#monitor-group-service-or-label): How to group what you monitor.
- [Probe, agent, collector or Runner?](#probe-agent-collector-or-runner): What to install, and the key each one takes.
- [Dashboard, public dashboard or status page?](#dashboard-public-dashboard-or-status-page): What to share, and with whom.
:::

## Incident, alert or another kind of problem?

Most problems are an incident or an alert: pick by who the problem affects. The others are records OneUptime keeps for you, and each of them can lead to an incident or an alert.

| Record | What it is | Use it when |
| --- | --- | --- |
| [Incident](/docs/incidents/index) | A problem that affects your users. It can page whoever is on call and show on your status pages. | Customers notice, or soon will: an outage, a slowdown, a checkout that fails. |
| [Alert](/docs/alerts/index) | A problem for your team. It can page whoever is on call, but it never shows on a status page. | Your team should act before users notice: a disk filling up, a certificate about to expire. |
| [Episode](/docs/incidents/episodes) | A group of related incidents, or of related alerts, worked as one. | One cause raised many incidents or alerts. Grouping rules open episodes for you. |
| [Exception](/docs/telemetry/exceptions) | Every occurrence of one error your code throws, grouped, with its stack trace. | You want to fix a bug. An Exceptions monitor can raise an alert or an incident when errors spike. |
| [AI insight](/docs/ai/ai-sre#insights-proactive-detection) | A problem OneUptime found in your telemetry before anything paged, such as a spike in error logs. | You want early warnings. An insight never pages anyone and never opens an incident: it waits in an inbox. |
| [Security case](/docs/telemetry/security-cases) | One threat worth looking into, with every detection about the same user, host or address in it. | Your security team investigates. **Declare Incident** on a case opens an incident when users are affected. |

An alert can be linked to the incident it turned out to be part of, so starting with an alert loses nothing.

## Workflow, runbook, playbook or AI rule?

All four can run by themselves. Pick by what they act on and who wrote the steps.

| Tool | What it does | Use it when |
| --- | --- | --- |
| [Workflow](/docs/workflows/index) | Blocks on a canvas that run when their trigger fires: an incident is created, a schedule comes due, another tool calls a URL. | You want to connect OneUptime to other tools, or act on its records, without writing code. |
| [Runbook](/docs/runbooks/index) | Your response procedure as steps, from manual checklists to scripts, HTTP requests and kubectl, run on an incident, an alert or a maintenance event. | Responders should follow the same steps every time. Runbook rules start a runbook on the incidents that match. |
| [Playbook](/docs/telemetry/security-cases#playbooks) | Steps that respond to a security case: preserve the evidence, page whoever is on call, suspend a user. | Your security team responds to the same kind of threat the same way every time. |
| [AI rule](/docs/ai/ai-sre#which-incidents-are-investigated-and-fixed) | Decides which new incidents and alerts OneUptime AI investigates and fixes, and whether it asks first. | OneUptime AI should work on only some incidents, or fix without asking. With no rule, it investigates every one. |

## Monitor group, service or label?

All three bring things together, for different readers. They also work together: a service's monitors can make up one monitor group, and all of them can carry the same label.

| Choice | What it is | Use it when |
| --- | --- | --- |
| [Monitor group](/docs/monitor/monitor-groups) | Several monitors rolled into one status, the worst among them, with its own uptime. | Customers should see one row on a status page for something made of several monitors, such as Checkout. |
| [Service](/docs/telemetry/services) | An application OneUptime found in your telemetry, with its logs, traces, metrics, incidents and owners on one page. | You want everything about one application in one place. It appears by itself from its `service.name`. |
| [Label](/docs/configuration/label-and-owner-rules) | A tag you put on monitors and most other records. A record can carry many. | You want to filter lists, limit a team's permissions, or pick records out in rules. |

Monitor groups start turned off: turn them on under **Project Settings → Advanced → Feature Flags**.

## Probe, agent, collector or Runner?

Most of OneUptime needs nothing installed: install something only to reach what OneUptime cannot see from outside. Each one connects out, with a key of its own kind.

| Install | What it does | Install it when | Key it takes |
| --- | --- | --- | --- |
| [Custom probe](/docs/probe/custom-probe) | Runs your monitors' checks from inside your network. | What you check is behind your firewall. OneUptime's own probes check what is public. | Its own probe ID and key |
| [Infrastructure agent](/docs/monitor/server-monitor) | Reports one machine's CPU, memory, disks and processes to a Server / VM monitor. | You want one monitor of one server, with criteria on its numbers. | The monitor's secret key |
| [OpenTelemetry Collector](/docs/telemetry/hosts) | Sends a machine's metrics, logs and processes. **Add Host** installs it with one command. | You want a machine under **Hosts**, with its telemetry. | An ingestion key |
| [Kubernetes agent](/docs/telemetry/kubernetes-agent) | Collects a cluster's metrics, events, logs and traces. You install it with Helm. | You run Kubernetes. | An ingestion key |
| [Runner](/docs/runbooks/agents) | Runs runbook steps, such as Bash, SSH and kubectl, inside your infrastructure. | Your runbooks need to reach your own hosts and clusters. | Its own Runner ID and key |

### Ingestion key or API key?

| Key | What it lets you do | Where you create it |
| --- | --- | --- |
| [Ingestion key](/docs/telemetry/ingestion-keys) | Send telemetry into the project, and nothing else. | **Project Settings → Telemetry & APM → Ingestion Keys** |
| [API key](/docs/permissions/index#api-keys) | Read and change the project through the API, the CLI, Terraform or an AI assistant, with the permissions you give it. | **Project Settings → Advanced → API Keys** |

Neither works in place of the other.

## Dashboard, public dashboard or status page?

Pick by who should see it.

| Share | Who sees it | Use it when |
| --- | --- | --- |
| [Dashboard](/docs/dashboards/index) | People who sign in to your project. | Your team watches charts and lists: an on-call screen, a team's own view. |
| [Public dashboard](/docs/dashboards/sharing) | Anyone with its link, unless you add a password, limit it to some IP addresses or host it on your own domain. | People outside the project should see your charts, such as a partner or a screen on the wall. |
| [Status page](/docs/status-pages/index) | Your customers, in public, or only the private users you let in. | Customers want to know whether your services work, and to be told about incidents and maintenance. |

A status page speaks in incidents and in the names you give your monitors; a dashboard shows the numbers behind them.

## Next steps

:::cards
- [Glossary](/docs/introduction/glossary): Every word OneUptime uses, in a sentence or two.
- [Core Concepts](/docs/introduction/core-concepts): How the pieces connect, on one page.
- [Quickstart](/docs/introduction/quickstart): A monitor, a page and a status page in fifteen minutes.
:::
