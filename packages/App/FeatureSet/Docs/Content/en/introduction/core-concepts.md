# Core Concepts

OneUptime has many products, but they rest on a handful of ideas: projects, monitors, incidents and alerts, on-call, status pages and telemetry. Around them are what you watch, what you install and the rules that act for you. This page explains each one in a few sentences, shows how they connect, and links to where each is covered in full. Read it once, and every other page in the docs reads more easily. For one word at a time, see the [Glossary](/docs/introduction/glossary); to choose between two things that look alike, see [Which One Do I Use?](/docs/introduction/which-one).

:::cards
- [Projects and people](#projects-and-people): Where everything lives, and who can do what.
- [Monitors and probes](#monitors-and-probes): How OneUptime notices that something is wrong.
- [Incidents and alerts](#incidents-and-alerts): The record your team works from.
- [On-call](#on-call): Who is paged, how, and who is next.
:::

## How the pieces connect

A problem moves through OneUptime in one direction. Probes and your own telemetry feed monitors. A monitor's criteria decide when something is wrong and what to open: an incident, an alert, or both. On-call policies page people about them, and status pages tell your customers about incidents.

```mermaid title="How a problem moves through OneUptime"
flowchart TB
    probes["Probes run checks"] --> monitors["Monitors"]
    telemetry["Apps and agents<br/>send telemetry"] --> monitors
    monitors -->|"declares"| incident["Incident"]
    monitors -->|"creates"| alert["Alert"]
    incident --> policy["On-call policy"]
    alert --> policy
    incident --> statuspage["Status page"]
    policy --> person["Whoever is on call"]
    statuspage --> subscribers["Subscribers"]
```

## Projects and people

A **project** holds everything: monitors, incidents, on-call policies, status pages, telemetry and settings. Most companies need one, and some keep one per environment or business unit. Nothing you create in one project is visible in another.

Your **account** is separate from your projects. One account, with one email and password, can belong to any number of projects; switch between them with the project picker at the top left. See [Your Account](/docs/introduction/your-account).

People are in a project through **teams**, and a team's permissions decide what its members can do. Every new project starts with three teams: Owners, with you in it, Admin and Members. On OneUptime Cloud, each project has its own plan.

:::cards
- [Users, Teams & Permissions](/docs/permissions/index): Invite people and decide what they can do.
:::

## Monitors and probes

A **monitor** checks one thing you run and decides whether it works. Most monitors are checked by **probes**: machines that run the check on a schedule, such as requesting a page, calling an API, pinging a host or querying a database. OneUptime Cloud runs probes in several regions, a self-hosted installation runs its own, and you can add custom probes inside your network. Other monitors read what you send instead: the telemetry from your apps, or the data an agent on your servers, Kubernetes clusters and other infrastructure reports.

A monitor's **criteria** decide what each result means. They are checked in order, and the first one that matches can change the monitor's status, declare an incident, create an alert, or all three. Every new project has three monitor statuses: **Operational**, **Degraded** and **Offline**.

:::cards
- [Creating a Monitor](/docs/monitor/create-monitor): Pick a type, say what to check, and how often.
- [Custom Probes](/docs/probe/custom-probe): Check what only your own network can reach.
:::

## What you watch

A monitor checks one thing. Around your monitors, OneUptime keeps a record of what you run, and you meet these records in the menu:

- A **monitor group** rolls several monitors into one status, so a status page can show something made of many parts, such as Checkout, as one row.
- A **service** is an application or microservice you run. OneUptime adds it the first time its telemetry arrives, and brings its logs, traces, metrics, exceptions and incidents together on one page.
- **Hosts**, **Kubernetes** clusters and the rest of **Infrastructure** are the machines and platforms you run, filled in by the agents you install.
- **Inventory** is one list of all of it: services, hosts, clusters, devices, cloud resources, and the things that send no telemetry at all.

They meet where a problem shows. A service's monitors can roll up into a monitor group, an SLO measures them, and when one fails it declares an incident. The incident lists the service among the resources it affects, and the status page shows the group and the incident.

```mermaid title="One service, what watches it, and where it shows"
flowchart TB
    service["Service: Checkout"] -->|"watched by"| monitors["Its monitors"]
    monitors --> group["Monitor group"]
    monitors --> slo["SLO"]
    monitors -->|"declare"| incident["Incident"]
    group --> statuspage["Status page"]
    incident --> statuspage
```

:::cards
- [Monitor Groups](/docs/monitor/monitor-groups): Roll several monitors into one status.
- [Services](/docs/telemetry/services): Every application you run, on one page each.
- [Inventory Overview](/docs/inventory/overview): Everything OneUptime knows about your estate.
:::

## Reliability targets

An **SLO** (service level objective) is a reliability target for what you monitor, such as up 99.9% of the time over 30 days. OneUptime measures it from its monitors every 5 minutes. The downtime the target allows is its error budget: with plenty left you can take risks, and with little left you slow down and invest in stability.

:::cards
- [SLOs Overview](/docs/slo/introduction): Set a target, and see how much of the budget is left.
:::

## Incidents and alerts

Both record a problem, and both can page whoever is on call. What differs is who the problem affects.

| | Incident | Alert |
| --- | --- | --- |
| **What it is** | A problem that affects your users, such as an outage or a slowdown | A problem for your team to look into before users are affected |
| **On status pages** | Can show, and tells subscribers | Never |
| **Starting states** | **Identified**, **Acknowledged**, **Resolved** | **Identified**, **Acknowledged**, **Resolved** |
| **Starting severities** | Critical Incident, Major Incident, Minor Incident | **High**, **Low** |

Acknowledging one says someone is on it, and stops its on-call policies from paging the next level. Resolving it closes it. You can add your own states and severities, and link alerts to the incident they turned out to be part of.

An **episode** groups related incidents, or related alerts, so your team works on them as one. Grouping rules decide which belong together.

:::cards
- [Incidents Overview](/docs/incidents/index): How incidents are declared, worked and resolved.
- [Alerts Overview](/docs/alerts/index): Where alerts come from, and how episodes group them.
- [Linked Alerts](/docs/incidents/linked-alerts): Tie the alerts an outage raised to its incident.
:::

## On-call

An **on-call policy** decides who is paged about an incident or alert, and who is next if nobody responds. Its **escalation rules** are its levels: each one pages its people, then waits for someone to acknowledge before the next level is paged. A level can page people, teams, or an **on-call schedule**, a rotation that knows who is on call at any moment.

How each person is reached is up to them. In **User Settings**, everyone keeps the ways OneUptime can reach them, such as email, SMS, phone calls, push notifications, Slack or Microsoft Teams, and which of them to use when they are paged.

:::cards
- [On-Call Overview](/docs/on-call/index): How a page reaches someone, and where each piece lives.
- [Escalation Rules](/docs/on-call/escalation-rules): Page people level by level until someone responds.
- [On-Call Schedules](/docs/on-call/schedules): Rotations, layers and hand-offs.
- [How OneUptime Reaches You](/docs/notifications/index): The methods, rules and settings that decide how each person is reached.
:::

## Status pages and maintenance

A **status page** shows your customers whether your services work. You choose which monitors it shows, under names your customers understand. While an incident on one of those monitors is active, the page shows it, and its **subscribers** are told by email, SMS, Slack, Microsoft Teams or webhook. A status page can be public, or private to the people you let in.

**Scheduled maintenance** announces planned work ahead of time. An event moves through **Scheduled**, **Ongoing**, **Ended** and **Completed**, and the status pages you show it on tell visitors and subscribers about it.

:::cards
- [Status Pages Overview](/docs/status-pages/index): Create a status page and decide what it shows.
- [Subscribers & Announcements](/docs/status-pages/subscribers): Who is told, and when.
- [Scheduled Maintenance Overview](/docs/scheduled-maintenance/index): How an event runs, and what it pauses.
:::

## Telemetry

**Telemetry** is what your systems send OneUptime: logs, metrics, traces, exceptions and profiles. Apps send it with OpenTelemetry, and OneUptime's agents send it from hosts, Kubernetes clusters, Docker hosts and other infrastructure. Every sender uses an **ingestion key**, created under **Project Settings → Telemetry & APM → Ingestion Keys**. You search telemetry, chart it on dashboards, and watch it with telemetry monitors, which raise incidents and alerts like any other monitor. In the menu, **Logs**, **Metrics**, **Traces**, **Profiles** and **Exceptions** each open one kind; **AI / LLM** follows your AI's conversations, **Data Observability** watches the tables in your databases, and **Topology** maps how it all connects.

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Send logs, metrics and traces from your apps.
- [Logs Monitor](/docs/monitor/logs-monitor): Get told when a pattern shows up in your logs.
:::

## Security

**Security Events** keeps the security events from your logs, your security tools and anything else you send. Its detection rules turn what they find into security cases, which your team works in a queue and playbooks respond to. **Data Security** finds the sensitive data in your buckets, databases and telemetry, and what is wrong with how it is kept.

:::cards
- [Get Started with Security](/docs/telemetry/security-getting-started): Find threats in the data you already have.
- [Data Security Overview](/docs/data-security/index): Find your sensitive data, and fix how it is kept.
:::

## What you install, and the keys

Most of OneUptime needs nothing installed. You install something only to reach what OneUptime cannot see from outside, and each piece connects out to OneUptime with a key:

- A custom probe runs monitors' checks inside your network, with its own probe ID and key.
- The **OpenTelemetry Collector**, the Kubernetes agent and the Docker agent send telemetry with an **ingestion key**. The infrastructure agent behind a Server / VM monitor sends with that monitor's secret key.
- A **Runner** runs runbook steps inside your infrastructure, with its own Runner ID and key.

An ingestion key only sends telemetry in. An **API key** is the other kind: it lets a script, the CLI, Terraform or an AI assistant read and change your project, with the permissions you give it. Neither works in place of the other.

:::cards
- [Which One Do I Use?](/docs/introduction/which-one#probe-agent-collector-or-runner): What to install, and the key each one takes.
- [Ingestion Keys](/docs/telemetry/ingestion-keys): Create, scope and rotate the keys that send telemetry.
:::

## Automation and AI

- **Workflows** run actions when something happens, such as posting to Slack when an incident is declared.
- **Runbooks** turn a response procedure into steps your team can run, by hand or automatically.
- **OneUptime AI** investigates new incidents and alerts and posts what it found to their timeline, and **Ask AI** answers questions about your project. A new project starts with AI on; the **Enable AI** switch under **Project Settings → AI → AI Features** turns all of it off.

:::cards
- [Workflows Overview](/docs/workflows/index): Automate actions with triggers and components.
- [AI SRE](/docs/ai/ai-sre): How OneUptime AI investigates incidents and alerts.
:::

## Labels and owners

**Labels** are tags you put on monitors, incidents, status pages and most other resources, to filter and group them. A team's permissions can be limited to resources with some labels. **Owners** are the people and teams responsible for one resource: they are told when something happens to it. Label rules and owner rules add labels and owners to new resources for you.

:::cards
- [Label and Owner Rules](/docs/configuration/label-and-owner-rules): Label new resources and give them owners automatically.
:::

## The kinds of rule

Many things in OneUptime are called a rule. Each makes one decision for you when something new arrives, and they come in a few families. Most of them are under **Rules** in the side menus of **Incidents** and **Alerts**.

| What it decides | Rules |
| --- | --- |
| Who is paged | **On-Call Rules** pick the on-call policies a new incident or alert runs, and a policy's **Escalation Rules** page level by level |
| Who owns it, and how it is labelled | **Owner Rules**, **Label Rules** and **Privacy Rules** |
| What belongs together | **Grouping Rules** open episodes and add to them |
| What runs on it | **Runbook Rules** start runbooks, and **AI Rules** decide what OneUptime AI investigates and fixes |
| When to follow up | **SLA Rules** track response and resolution times, and **Reminder Rules** remind owners while it is open |

A monitor's own rules are its criteria. How to Reach Me, under **User Settings**, is something else again: each person's own steps, which decide how a page reaches them.

:::cards
- [Incident Settings & Automation](/docs/incidents/settings#rules-that-run-when-an-incident-is-created): The rules that run when an incident is created, in order.
- [How to Reach Me](/docs/notifications/on-call-rules): How a page reaches you.
:::

## Next steps

:::cards
- [Quickstart](/docs/introduction/quickstart): Put these ideas to work in fifteen minutes.
- [Glossary](/docs/introduction/glossary): Every word OneUptime uses, in a sentence or two.
- [Which One Do I Use?](/docs/introduction/which-one): Incident or alert, workflow or runbook, and the other look-alikes.
- [Incidents Overview](/docs/incidents/index): What happens after a monitor declares an incident.
:::
