# Glossary

Every word OneUptime uses, in a sentence or two, with the other names it goes by and the page that covers it in full. The words are grouped the way you meet them: the first group is the loop every project runs, and the last is the words that mean more than one thing.

:::cards
- [Start here](#start-here): The loop every project runs, from a monitor to a page and a status page.
- [What you watch](#what-you-watch): Services, hosts, clusters, clouds and the targets you hold them to.
- [Working on a problem](#working-on-a-problem): States, severities, owners and labels, and the other kinds of problem.
- [Telemetry and dashboards](#telemetry-and-dashboards): What your systems send, and where you look at it.
- [Automation and AI](#automation-and-ai): What runs by itself, and what OneUptime AI does.
- [What you install, and the keys](#what-you-install-and-the-keys): The agents you run, and the key each one takes.
- [Words with more than one meaning](#words-with-more-than-one-meaning): Rule, role, resource, settings and the other words with several jobs.
:::

## Start here

### Project

Where everything you set up lives: monitors, incidents, on-call, status pages, telemetry and settings. Nothing in one project is visible in another, and most companies need only one.

See [Core Concepts](/docs/introduction/core-concepts#projects-and-people).

### Account

You: the email and password you sign in with, your name, time zone and language. One account can belong to any number of projects.

See [Your Account](/docs/introduction/your-account).

### Team

A group of people in a project, whose permissions decide what its members can do. Every new project starts with three teams: Owners, Admin and Members. Invite people under **Users**, and group them under **Teams**.

See [Users, Teams & Permissions](/docs/permissions/index).

### Monitor

Checks one thing you run, such as a website, an API, a server or a Kubernetes cluster, and decides whether it works. When its criteria match, it changes its status and can declare an incident or create an alert.

See [Creating a Monitor](/docs/monitor/create-monitor).

### Criteria

A monitor's rules: what each check result means. They are checked in order, and the first one that matches can change the monitor's status, declare an incident, create an alert, or all three.

Also called: **Monitoring Criteria**, **Monitor Criteria**, **Monitor Steps**. See [Criteria & Statuses](/docs/monitor/criteria-and-statuses).

### Monitor Status

What a monitor is right now. Every new project has three monitor statuses, **Operational**, **Degraded** and **Offline**, and you can add your own.

See [Criteria & Statuses](/docs/monitor/criteria-and-statuses).

### Probe

A machine that runs monitors' checks on a schedule: it requests a page, calls an API or pings a host. OneUptime Cloud runs probes in several regions, and a custom probe you run inside your own network checks what only that network can reach.

Also called: **Custom Probes**. See [Custom Probes](/docs/probe/custom-probe).

### Incident

A problem that affects your users, such as an outage or a slowdown, and the record your team works from while it lasts. It can page whoever is on call and show on your status pages.

See [Incidents Overview](/docs/incidents/index).

### Alert

A problem for your team to look into before users notice, such as a disk filling up or a certificate about to expire. It can page whoever is on call, but it never shows on a status page.

See [Alerts Overview](/docs/alerts/index).

### Episode

A group of related incidents, or of related alerts, that your team works as one, with one set of owners and one state. Grouping rules decide what belongs in each.

Also called: **Incident Episode**, **Alert Episode**. See [Episodes](/docs/incidents/episodes).

### On-Call Policy

Decides who is paged about an incident, an alert or an episode, and who is next if nobody acknowledges. Its levels are escalation rules.

Also called: **On-Call Duty**, **On-Call Duty Policy**, **On Call**, `OnCallDutyPolicy`. See [On-Call Policies](/docs/on-call/policies).

### Escalation Rule

One level of an on-call policy: who is paged, and how long to wait for someone to acknowledge before the next level is paged. A level can page people, teams or an on-call schedule.

See [Escalation Rules](/docs/on-call/escalation-rules).

### On-Call Schedule

Who is on call at any moment: people take turns, and each one hands over to the next. An escalation rule that pages a schedule pages whoever is on call in it.

Also called: **Rotation**, **On-Call Policy Schedule**. See [On-Call Schedules](/docs/on-call/schedules).

### Layer

One rotation inside an on-call schedule: the people who take turns, how often they hand over, and the hours it covers. The highest layer with someone on call is the one that pages, so the main rotation goes on top and fall-back cover below it.

See [On-Call Schedules](/docs/on-call/schedules#layers).

### Notification Method

An address OneUptime may reach you at in a project: an email address, a phone number for SMS or calls, your Slack or Microsoft Teams account, or the OneUptime app on your phone. Each person adds their own under **User Settings**.

See [Notification Methods](/docs/notifications/notification-methods).

### How to Reach Me

Your own rules for being paged: which of your notification methods a page tries, and after how long. One ladder covers every incident, alert and episode, and a severity can have rules of its own. Each person sets their own under **User Settings**.

Also called: **Personal On-Call Rules**. See [How to Reach Me](/docs/notifications/on-call-rules).

### Status Page

A page that shows your customers whether your services work, and the incidents and maintenance that affect them. It can be public, or private to the people you let in.

See [Status Pages Overview](/docs/status-pages/index).

### Subscriber

Someone who follows a status page by email, SMS, Slack, Microsoft Teams or webhook, and is told when an incident or maintenance on it starts, changes and ends.

See [Subscribers & Announcements](/docs/status-pages/subscribers).

### Scheduled Maintenance

Planned work, announced ahead of time. Each maintenance event moves through the maintenance states **Scheduled**, **Ongoing**, **Ended** and **Completed**, and the status pages it is shown on tell visitors and subscribers about it.

Also called: **Scheduled Maintenance Event**, **Scheduled Event**, **Event**. See [Scheduled Maintenance Overview](/docs/scheduled-maintenance/index).

### Telemetry

What your systems send OneUptime: logs, metrics, traces, exceptions and profiles. Apps send it with OpenTelemetry, and OneUptime's agents send it from hosts, clusters and other infrastructure, each with an ingestion key.

See [OpenTelemetry](/docs/telemetry/open-telemetry).

## What you watch

### Monitor Group

Several monitors rolled up into one status, the worst among them, with its own uptime. A status page can show the whole group as one row. Turn monitor groups on under **Project Settings → Advanced → Feature Flags**.

See [Monitor Groups](/docs/monitor/monitor-groups).

### Service

An application or microservice you run. OneUptime adds one the first time its telemetry arrives, named by its `service.name`, and brings its logs, traces, metrics, exceptions, incidents and owners together on one page.

Also called: **Service Catalog**, **Telemetry Service**. See [Services](/docs/telemetry/services).

### Host

A Linux, Windows or macOS machine that sends its metrics, processes, logs and service states through the OpenTelemetry Collector. **Add Host** installs the collector with one command, and OneUptime keeps its config up to date.

See [Hosts](/docs/telemetry/hosts).

### Kubernetes

Your Kubernetes clusters, with their nodes, pods, workloads, events and logs, sent by the Kubernetes agent you install with Helm.

See [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

### Infrastructure

The menu's group of the machines and platforms you run: Hosts, Kubernetes, Docker, Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Storage Arrays, Network and IoT. An agent or a connection fills each one, and each says how every machine, cluster or device in it is doing.

See [Hosts](/docs/telemetry/hosts).

### Network

Your switches, routers, firewalls, access points and anything else with an address on your network, whether or not it speaks SNMP.

See [Network Device Monitor](/docs/monitor/network-device-monitor).

### Cloud

Your AWS accounts, Azure subscriptions and Google Cloud projects, connected from the dashboard. OneUptime lists every resource in them, reads their key metrics and records what changed in them.

See [Connect a Cloud Account](/docs/telemetry/cloud-accounts).

### App Platforms

The apps you run on managed platforms such as Amazon ECS and Fargate, Google Cloud Run and Azure App Service. Each place they run is a cloud environment, which OneUptime creates the first time its telemetry arrives.

Also called: **Cloud Environment**. See [Cloud Environments](/docs/telemetry/cloud-environments).

### Serverless

Your serverless functions, such as AWS Lambda, Google Cloud Functions and Azure Functions, listed with their traces, logs and metrics as soon as their OpenTelemetry data arrives.

Also called: **Serverless Functions**. See [Serverless Functions](/docs/telemetry/serverless-functions).

### Databases

Every database your applications query, put together from your traces, the database's own metrics and the other sources OneUptime can read, with how its engine is doing.

See [Databases](/docs/telemetry/databases).

### Queues

The message queues and topics your services use, such as Apache Kafka, RabbitMQ and Amazon SQS, from your traces and your brokers' metrics.

See [Queues](/docs/telemetry/queues).

### Real User Monitoring

What real people experience in your web and mobile apps: page loads, requests, errors and Core Web Vitals, reported by the app itself rather than by a probe.

See [RUM Overview](/docs/rum/index).

### Inventory

One list of everything OneUptime knows about your estate: services, hosts, Kubernetes objects, virtual machines, network devices, cloud resources, and the things that send no telemetry at all. Most of it fills in by itself.

See [Inventory Overview](/docs/inventory/overview).

### Topology

A map of how your systems connect, which services call which and what runs where, drawn from the telemetry you already send.

See [Topology](/docs/telemetry/topology).

### SLO

A reliability target for what you monitor, such as up 99.9% of the time over 30 days. OneUptime measures every SLO against its monitors every 5 minutes.

Also called: **Service Level Objective**. See [SLOs Overview](/docs/slo/introduction).

### Error Budget

The downtime an SLO's target allows: at 99.9% over 30 days, 43 minutes and 12 seconds. With plenty left you can take risks; with little left, slow down and invest in stability.

See [Error Budgets](/docs/slo/error-budget).

## Working on a problem

### State

Where an incident or an alert is in your response. Every new project starts with **Identified**, **Acknowledged** and **Resolved**: acknowledging says someone is on it and stops the next escalation level from being paged, and resolving closes it.

Also called: **Incident State**, **Alert State**. See [Incident States & Severities](/docs/incidents/states-and-severities).

### Severity

How much an incident or an alert matters. A new project starts with Critical Incident, Major Incident and Minor Incident for incidents, and **High** and **Low** for alerts; rename them, recolor them or add your own.

Also called: **Incident Severity**, **Alert Severity**. See [Incident States & Severities](/docs/incidents/states-and-severities).

### Owner

A person or a team responsible for one record, such as a monitor, an incident or a status page. Owners are told when something happens to what they own.

See [Label and Owner Rules](/docs/configuration/label-and-owner-rules).

### Label

A tag, such as Production or Checkout, that you put on monitors, incidents, status pages and most other records to filter and group them. A team's permissions can be limited to the records with some labels.

See [Label and Owner Rules](/docs/configuration/label-and-owner-rules).

### Exception

An error your code throws. OneUptime groups every occurrence of the same error into one exception, with its stack trace, its trend and the requests it happened in.

Also called: **Exception Tracking**, `/telemetry-exception`. See [Exceptions](/docs/telemetry/exceptions).

### AI Insights

Problems OneUptime finds in your telemetry before anything pages: new and spiking exceptions, spikes of error logs, slower traces, metric drift and deploys that made things worse. Insights never page anyone and never open incidents; they wait in an inbox until someone looks. The **Insights** page in a product's or a record's AI section is what OneUptime AI learned there.

Also called: **Insights**. See [AI SRE](/docs/ai/ai-sre#insights-proactive-detection).

### Security Events

OneUptime's SIEM: the security events from your logs, your security tools and anything else you send, kept in one shape beside your telemetry, with detection rules that find threats in them.

Also called: **SIEM**. See [Security Events (SIEM)](/docs/telemetry/security-events).

### Security Case

One thing worth looking into, from detection rules, threat intelligence or a connected security product, with every detection about the same user, host or address grouped into it. Analysts work cases in a queue, and playbooks respond to them.

Also called: **Case**. See [Security Cases and Playbooks (SOAR)](/docs/telemetry/security-cases).

## Telemetry and dashboards

### Logs

The lines your services, hosts and agents write, which you search in the Logs explorer and watch with a Logs monitor.

See [Logs Explorer](/docs/telemetry/logs-explorer).

### Metrics

The numbers your services and infrastructure report over time, such as request counts, latency, CPU and queue depth.

See [Metrics Explorer](/docs/telemetry/metrics-explorer).

### Traces

The path of one request through your services, step by step. Each step is a span, with its timing and its result.

See [Traces Explorer](/docs/telemetry/traces-explorer).

### Profiles

How your application spends CPU time and memory, function by function, sent by a profiler that pushes to OneUptime's Pyroscope-compatible API.

Also called: **Performance Profiles**, **Profiler**, **Continuous Profiling**. See [Profiles](/docs/telemetry/profiles).

### AI / LLM

The conversations your AI apps and agents have: every model call, with its tokens, cost, latency, prompt and answer, built from the OpenTelemetry spans your app sends.

Also called: **AI / LLM Observability**. See [AI / LLM Observability](/docs/telemetry/ai-llm-observability).

### Data Observability

Watches the tables in your databases and warehouses, and tells you when their data is late, missing or wrong, and which run, deploy or table is behind it.

See [Data Observability Overview](/docs/data-observability/index).

### Data Security

Finds the sensitive data your company keeps, in cloud buckets, databases, warehouses and the telemetry you send, and tells you what is wrong with how it is kept.

See [Data Security Overview](/docs/data-security/index).

### Dashboard

A page of widgets you arrange yourself: charts of your metrics, logs and traces, lists of incidents and monitors, your SLOs and more. A dashboard is private to your project until you share it.

See [Dashboards Overview](/docs/dashboards/index).

### Public Dashboard

A dashboard shared through a public link, for people who do not sign in to your project. Protect it with a password, limit it to some IP addresses or host it on your own domain.

See [Sharing & Public Dashboards](/docs/dashboards/sharing).

## Automation and AI

### Workflow

An automation without code: blocks on a canvas that run when their trigger fires, such as posting to Slack when an incident is declared, or calling another tool.

See [Workflows Overview](/docs/workflows/index).

### Runbook

A reusable response procedure: manual and automated steps your team runs on an incident, an alert or a maintenance event, by hand or when a runbook rule matches.

See [Runbooks Overview](/docs/runbooks/index).

### Playbook

The steps that respond to a security case, such as preserving the evidence, paging whoever is on call or suspending a user, run by themselves or at a click.

Also called: **Security Playbook**. See [Security Cases and Playbooks (SOAR)](/docs/telemetry/security-cases#playbooks).

### AI Rule

Decides which new incidents or alerts OneUptime AI investigates and fixes, and how. With no AI rule it investigates every one, so most projects need none.

Also called: **Auto Remediation Rule**. See [AI SRE](/docs/ai/ai-sre#which-incidents-are-investigated-and-fixed).

### OneUptime AI

OneUptime's AI site reliability engineer: it investigates each new incident and alert across your telemetry and posts what it found to its timeline. The **Enable AI** switch in **Project Settings** turns all of it off.

Also called: **AI SRE**. See [AI SRE](/docs/ai/ai-sre).

### Ask AI

A chat over your project's data. It queries your logs, traces, metrics, incidents, monitors and more, and answers with a citation for every claim.

Also called: **Chat**. See [Ask AI](/docs/ai/ask-ai).

### Code

Where you ask OneUptime AI to work in your repositories, the way you would ask a coding agent: fix a bug, write tests or make a change, and get a pull request back.

Also called: **Tasks**. See [Code](/docs/ai/ai-agent).

### Form

A page anyone with its link can fill in, without an account. Each submission creates an incident, for a problem report, or a maintenance event, for a change request.

See [Forms Overview](/docs/forms/index).

## What you install, and the keys

### Infrastructure Agent

The `oneuptime-infrastructure-agent` service behind a Server / VM monitor: it reports one machine's CPU, memory, disks and processes every 30 seconds, signed with the monitor's secret key.

See [Server / VM Monitor](/docs/monitor/server-monitor).

### Kubernetes Agent

A Helm chart that collects a cluster's metrics, events and pod logs and, with eBPF, its traces, and sends them with an ingestion key.

See [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

### OpenTelemetry Collector

The open-source agent that receives, processes and sends telemetry. **Add Host** installs it on a machine, the Docker agent is one, and your own collectors send to OneUptime with an ingestion key.

Also called: **Collector**. See [Hosts](/docs/telemetry/hosts) and [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).

### Runner

A small process you run in your own infrastructure that runs the JavaScript, Bash, SSH and kubectl steps of your runbooks. It connects out to OneUptime with its own Runner ID and key.

Also called: **Runbook Agents**. See [Runbook Agents](/docs/runbooks/agents).

### Ingestion Key

The key that lets something send telemetry into your project: apps with OpenTelemetry, collectors and agents. It goes in the `x-oneuptime-token` header, and a project API key does not work in its place.

Also called: **Telemetry Ingestion Key**, `oneuptime.apiKey`. See [Ingestion Keys](/docs/telemetry/ingestion-keys).

### API Key

A key that lets a script, the CLI, Terraform or an AI assistant read and change your project through the API, with the permissions you give it. Create one under **Project Settings → Advanced → API Keys**.

See [Users, Teams & Permissions](/docs/permissions/index#api-keys).

## Words with more than one meaning

### Rule

Many things in OneUptime are rules, and each one makes one decision for you: who is paged (**On-Call Rules**, **Escalation Rules**), who owns and labels new records (**Owner Rules**, **Label Rules**), what belongs together (**Grouping Rules**) and what OneUptime AI does (**AI Rules**). A monitor's own rules are its criteria.

See [Core Concepts](/docs/introduction/core-concepts#the-kinds-of-rule).

### Role

Four different things: the permissions a team grants, such as Project Owner or Project Admin; a **Custom Role** you put together from permissions; an **Incident Role**, the part someone plays in one incident; and a **Network Device Role**, what a device on your network does.

See [Users, Teams & Permissions](/docs/permissions/index).

### Resource

Most often, the infrastructure OneUptime records, such as hosts, clusters, databases and cloud resources. An incident's **Affected Resources** are the monitors and infrastructure it touches, a status page's resources are the monitors and groups it shows, and OpenTelemetry's resource attributes say where telemetry came from.

See [Inventory Overview](/docs/inventory/overview).

### Settings

Each level has its own: **Project Settings** for the whole project, **User Settings** for how OneUptime reaches you, and a product's own **Settings** in its side menu, such as incident states and templates under **Incidents**. A self-hosted server's settings are in the Admin Dashboard.

See [Project Settings](/docs/configuration/project-settings).

### Policy

Most often an **On-Call Policy**: who is paged, and who is next. An incoming call policy gives your team a phone number that rings whoever is on call, and an error budget policy writes down what your team does as an SLO's budget runs out.

See [On-Call Policies](/docs/on-call/policies).

### Template

A saved starting point: a monitor template creates monitors, incident and alert templates fill in new records, note and postmortem templates start what you write, and dashboard templates build a dashboard's widgets.

See [Monitor Templates](/docs/monitor/monitor-templates).

### Workspace

A Slack or Microsoft Teams workspace you connect to OneUptime under **Workspace Connections**, to post updates to your channels and act on incidents from chat. What some other tools call a workspace is a project in OneUptime.

See [Slack](/docs/workspace-connections/slack).

### Agent

A program you install that reports to OneUptime or acts for it: the infrastructure, Kubernetes and Docker agents send what they collect, a Runner runs runbook steps, and an AI agent lets OneUptime AI look into a cluster or a host. The tasks you give **Code** are AI agent tasks.

See [Which One Do I Use?](/docs/introduction/which-one#probe-agent-collector-or-runner).

### On-Call Rules

Under **Incidents** and **Alerts**, on-call rules pick the on-call policies a new incident or alert runs. A person's own rules for how a page reaches them were called on-call rules too: they are **How to Reach Me** now, under **User Settings**.

See [Incident Settings & Automation](/docs/incidents/settings#incident-on-call-rules) and [How to Reach Me](/docs/notifications/on-call-rules).

### Notification Settings

Under **User Settings**, which updates reach you about what you own, and on which channels. The project's switches for SMS and calls, its messaging balance and its own SMTP and Twilio were called notification settings too: they are **Notification Channels** now, under **Project Settings**.

See [Notification Settings](/docs/notifications/notification-settings).

## Next steps

:::cards
- [Which One Do I Use?](/docs/introduction/which-one): Incident or alert, workflow or runbook, and the other look-alikes side by side.
- [Core Concepts](/docs/introduction/core-concepts): How the pieces connect, on one page.
- [Quickstart](/docs/introduction/quickstart): Put the words to work in fifteen minutes.
:::
