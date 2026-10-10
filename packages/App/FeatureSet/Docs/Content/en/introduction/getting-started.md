# Getting Started

OneUptime is an open-source observability platform. It checks that your websites, APIs and servers work, collects the logs, metrics and traces your apps send, pages whoever is on call when something breaks, and tells your customers on a status page. It all happens in one product, so the tool that notices a problem is the one that pages your team. Use it on OneUptime Cloud, or run it on your own servers.

Start here:

:::cards
- [Quickstart](/docs/introduction/quickstart): Monitor a website, get paged when it fails and publish a status page.
- [Core Concepts](/docs/introduction/core-concepts): The handful of ideas everything else builds on, and how they connect.
- [Home Page & Shortcuts](/docs/introduction/home): Find your way around the dashboard, and the keys that save you clicks.
- [Your Account](/docs/introduction/your-account): Your profile, password, passkeys and two-factor authentication.
:::

## How OneUptime fits together

Everything starts with something you watch. A monitor checks it on a schedule, or reads the telemetry it sends. When the monitor's criteria match, OneUptime declares an incident or creates an alert, pages whoever is on call, and puts the incident on your status page if you want it there.

```mermaid title="From a failed check to a paged team and an updated status page"
flowchart TB
    subgraph watch["What you watch"]
        direction LR
        site["Websites and APIs"]
        infra["Servers and Kubernetes"]
        apps["Apps with OpenTelemetry"]
    end
    site --> probes["Probes"]
    infra --> agents["Agents"]
    apps --> telemetry["Logs, metrics, traces"]
    agents --> telemetry
    probes --> monitors["Monitors"]
    telemetry --> monitors
    monitors -->|"criteria met"| incidents["Incidents"]
    monitors -->|"criteria met"| alerts["Alerts"]
    incidents --> oncall["On-call policies"]
    alerts --> oncall
    oncall --> people["Email, SMS, call, push, Slack, Teams"]
    incidents --> status["Status pages"]
    status --> subscribers["Subscribers"]
```

- An **incident** is a problem that affects your users. It can page whoever is on call, and show on your status page.
- An **alert** is a problem for your team to look into before users notice. It can page whoever is on call too, but never shows on a status page.

[Core Concepts](/docs/introduction/core-concepts) explains each piece in a few sentences.

## Explore the docs

The docs are organized like the sidebar, in nine sections. Pick the part you need.

### Monitoring

:::cards
- [Monitors](/docs/monitor/create-monitor): Check websites, APIs, ports, DNS, NTP servers, certificates and more from probes around the world.
- [Infrastructure monitors](/docs/monitor/server-monitor): Watch servers, Kubernetes, Docker, VMware, network devices and storage.
- [Telemetry monitors](/docs/monitor/logs-monitor): Alert on the logs, metrics, traces, exceptions and profiles you send.
- [SLOs](/docs/slo/introduction): Track reliability targets, error budgets and burn rates.
- [Probes](/docs/probe/custom-probe): Run checks from inside your own network.
- [When OneUptime is not receiving data](/docs/monitor/when-oneuptime-is-not-receiving): Why a gap on OneUptime's side never counts as your downtime.
:::

### Incident Response

:::cards
- [Incidents](/docs/incidents/index): Declare, coordinate and resolve incidents, with a full timeline.
- [On-call](/docs/on-call/schedules): Rotations, escalation rules and who gets paged when.
- [Status pages](/docs/status-pages/index): Keep customers informed on public or private status pages.
- [Workspace connections](/docs/workspace-connections/slack): Work on incidents from Slack and Microsoft Teams.
:::

### Observability

:::cards
- [Telemetry](/docs/telemetry/open-telemetry): Send logs, metrics and traces with OpenTelemetry, and search them.
- [Infrastructure agents](/docs/telemetry/kubernetes-agent): Install the agents for Kubernetes, hosts, Docker, Proxmox, VMware and more.
- [Cloud](/docs/telemetry/cloud-environments): Observe ECS, Cloud Run, Azure Container Apps and other managed platforms.
- [AI observability](/docs/telemetry/ai-llm-observability): Follow your AI's conversations, and get told when it answers badly.
- [Security](/docs/telemetry/security-events): Collect security events and threat intelligence.
- [Real user monitoring](/docs/rum/index): Measure what real users experience, with Core Web Vitals and session replay.
- [Dashboards](/docs/dashboards/index): Build dashboards from your metrics, logs and monitors.
- [Inventory](/docs/inventory/overview): See every service, host and device OneUptime knows about.
:::

### Automation & AI

:::cards
- [Runbooks](/docs/runbooks/index): Turn response procedures into steps your team can run.
- [Forms](/docs/forms/index): Let anyone report a problem through a form that opens an incident.
- [Workflows](/docs/workflows/index): Automate actions when something happens in OneUptime.
- [AI](/docs/ai/ai-sre): Let OneUptime AI investigate incidents and alerts, and ask it about your systems.
:::

### Integrations

:::cards
- [Integrations](/docs/integrations/index): Connect Jira, ServiceNow, Grafana, Datadog, Huntress, SIEM tools, Discord, Telegram, IRC and more.
:::

### Developers

:::cards
- [API reference](/docs/api-reference/api-reference): Automate OneUptime with its REST API.
- [CLI](/docs/cli/index): Manage OneUptime from your terminal and your CI.
- [Terraform provider](/docs/terraform/index): Manage monitors, status pages and on-call as code.
:::

### Administration

:::cards
- [Users and permissions](/docs/permissions/index): Invite people, organize teams and control what they can do.
- [Identity](/docs/identity/sso): Sign in with SAML or OIDC single sign-on, and provision users with SCIM.
- [Configuration](/docs/configuration/label-and-owner-rules): Label resources and assign owners automatically.
- [Emails](/docs/emails/smtp): Send OneUptime's email through your own SMTP server.
- [Mobile and desktop apps](/docs/mobile-desktop-apps/index): Get paged and respond on iOS, Android, macOS, Windows and Linux.
:::

### Self-Hosting

:::cards
- [Installation](/docs/installation/docker-compose): Install, size and upgrade your own OneUptime.
- [Self-hosted setup](/docs/self-hosted/architecture): Architecture, integrations and Enterprise features for your own install.
:::

## Coming from another tool

### Bring your setup with you

**Project Settings → Import from another tool** reads your setup in another tool, with an API key or, for Uptime Kuma, a file. It shows you what it found, and creates what you tick. Nothing in the other tool changes, and running the import again never creates anything twice.

| Coming from | What OneUptime reads |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Users, teams, schedules, escalations and services |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Users, teams, schedules, escalation policies and services |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Users, teams, schedules, escalation paths, services and incident settings |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Users, teams, rotations and escalation policies |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Users, teams, schedules and escalation chains |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Monitors and public status pages |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Pages, their components and groups, and email subscribers |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Monitors, heartbeats, status pages and email subscribers |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Uptime checks |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Uptime, SSL and heartbeat checks |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Monitors, from a backup or the metrics page |

### What OneUptime replaces

| Capability | What it does | Replaces tools like |
| --- | --- | --- |
| Uptime monitoring | Checks availability and response time from locations around the world. | Pingdom, UptimeRobot |
| Status pages | Shows customers the current status and history of your services. | Atlassian Statuspage |
| Incident management | Runs incidents from start to finish, with notes, owners and a timeline. | incident.io |
| On-call and alerts | Schedules on-call shifts and escalates until someone responds. | PagerDuty, Opsgenie |
| Logs management | Collects, searches and visualizes logs. | Loggly |
| Workflows | Automates actions and connects OneUptime to the tools you already use. | Zapier |
| Application performance monitoring | Tracks traces, response times, throughput and error rates. | New Relic, Datadog |
| Error tracking | Groups exceptions with stack traces and context. | Sentry |

## Next steps

:::cards
- [Quickstart](/docs/introduction/quickstart): Set up your first monitor, on-call policy and status page.
- [Core Concepts](/docs/introduction/core-concepts): Learn the words every other page uses.
- [Home Page & Shortcuts](/docs/introduction/home): Find any page, setting or action in the dashboard.
- [Docker Compose](/docs/installation/docker-compose): Run OneUptime on your own server.
:::
