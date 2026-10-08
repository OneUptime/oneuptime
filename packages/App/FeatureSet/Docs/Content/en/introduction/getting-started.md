# Getting Started

OneUptime is an open-source observability platform. It brings uptime monitoring, status pages, incident management, on-call scheduling, logs, metrics, traces and error tracking into one product, so the tool that notices a problem is the same one that pages your team and tells your customers. You can use it on OneUptime Cloud or run it on your own servers.

Pick where to start:

:::cards
- [Quickstart](/docs/introduction/quickstart): Create a monitor, get notified when it fails, and publish a status page in about ten minutes.
- [Core concepts](/docs/introduction/core-concepts): Projects, monitors, probes, alerts, incidents and on-call — and how they connect.
- [Send telemetry](/docs/telemetry/open-telemetry): Ship logs, metrics and traces from your apps with OpenTelemetry.
- [Self-host OneUptime](/docs/installation/docker-compose): Run OneUptime on your own server with Docker Compose, or on Kubernetes with Helm.
:::

## How OneUptime fits together

Everything starts with something you watch. Monitors check it on a schedule, or read the telemetry it sends. When a monitor's criteria match, OneUptime raises an alert or declares an incident, pages whoever is on call, and — if you want it to — updates your status page.

```mermaid title="From a failed check to a notified team and an updated status page"
flowchart TB
    subgraph watch["What you watch"]
        direction LR
        site["Websites and APIs"]
        infra["Servers and Kubernetes"]
        apps["Apps with OpenTelemetry"]
    end
    site --> probes["Probes"]
    apps --> telemetry["Logs, metrics, traces"]
    probes --> monitors["Monitors"]
    infra --> monitors
    telemetry --> monitors
    monitors -->|"criteria met"| alerts["Alerts"]
    monitors -->|"criteria met"| incidents["Incidents"]
    alerts --> oncall["On-call policies"]
    incidents --> oncall
    incidents --> status["Status pages"]
    incidents --> automation["Workflows and runbooks"]
    oncall --> people["Email, SMS, call, push, Slack, Teams"]
    status --> subscribers["Subscribers"]
```

## Explore the docs

### Monitoring

:::cards
- [Monitors](/docs/monitor/create-monitor): Check websites, APIs, ports, DNS, certificates and more from probes around the world.
- [Infrastructure monitors](/docs/monitor/server-monitor): Watch servers, Kubernetes, Docker, VMware, network devices and storage.
- [Telemetry monitors](/docs/monitor/logs-monitor): Alert on the logs, metrics, traces, exceptions and profiles you send.
- [SLOs](/docs/slo/introduction): Track reliability targets, error budgets and burn rates.
- [Probes](/docs/probe/custom-probe): Run checks from your own network with a custom probe.
:::

### Incident response

:::cards
- [Incidents](/docs/incidents/index): Declare, coordinate and resolve incidents, with a full timeline.
- [On-call](/docs/on-call/schedules): Rotations, escalation rules and who gets paged when.
- [Status pages](/docs/status-pages/index): Keep customers informed with branded, public or private status pages.
- [Workspace connections](/docs/workspace-connections/slack): Work on incidents from Slack and Microsoft Teams.
:::

### Observability

:::cards
- [Telemetry](/docs/telemetry/open-telemetry): Send logs, metrics and traces with OpenTelemetry, and search them.
- [Infrastructure agents](/docs/telemetry/kubernetes-agent): Install the agents for Kubernetes, hosts, Docker, Proxmox, VMware and more.
- [Cloud](/docs/telemetry/cloud-environments): Observe ECS, Cloud Run, Azure Container Apps and other managed platforms.
- [AI observability](/docs/telemetry/ai-llm-observability): Trace LLM calls, token usage and AI coding assistants.
- [Security](/docs/telemetry/security-events): Collect security events and threat intelligence.
- [Real user monitoring](/docs/rum/index): Measure what real users experience, with Core Web Vitals and session replay.
- [Dashboards](/docs/dashboards/index): Build dashboards from your metrics, logs and monitors.
- [Inventory](/docs/inventory/overview): See every service, host and resource OneUptime knows about.
:::

### Automation and AI

:::cards
- [Runbooks](/docs/runbooks/index): Turn response procedures into steps your team can run.
- [Forms](/docs/forms/index): Let anyone report a problem through a form that opens an incident.
- [Workflows](/docs/workflows/index): Automate actions when something happens in OneUptime.
- [AI](/docs/ai/ai-sre): Investigate incidents and fix issues with OneUptime AI.
:::

### Integrations and developers

:::cards
- [Integrations](/docs/integrations/index): Connect Jira, PagerDuty, ServiceNow, Grafana, SIEM tools and more.
- [API reference](/docs/api-reference/api-reference): Automate OneUptime with its REST API.
- [CLI](/docs/cli/index): Manage OneUptime resources from your terminal and CI.
- [Terraform provider](/docs/terraform/index): Manage monitors, status pages and on-call as code.
:::

### Administration and self-hosting

:::cards
- [Users and permissions](/docs/permissions/index): Invite people, organize teams and control what they can do.
- [Identity](/docs/identity/sso): Sign in with SAML or OIDC single sign-on, and provision users with SCIM.
- [Configuration](/docs/configuration/label-and-owner-rules): Label resources and assign owners automatically.
- [Emails](/docs/emails/smtp): Send OneUptime's email through your own SMTP server.
- [Mobile and desktop apps](/docs/mobile-desktop-apps/index): Get paged and respond on iOS, Android, macOS, Windows and Linux.
- [Installation](/docs/installation/docker-compose): Install, size and upgrade a self-hosted OneUptime.
- [Self-hosted setup](/docs/self-hosted/architecture): Architecture, integrations and enterprise features for your own install.
:::

## What OneUptime replaces

OneUptime replaces several single-purpose tools with one integrated platform:

| Capability | What it does | Replaces tools like |
| --- | --- | --- |
| Uptime monitoring | Checks availability and response time from locations around the world. | Pingdom |
| Status pages | Shows customers the current status and history of your services. | StatusPage.io |
| Incident management | Runs incidents from start to finish, with notes, owners and a timeline. | Incident.io |
| On-call and alerts | Schedules on-call shifts and escalates until someone responds. | PagerDuty |
| Logs management | Collects, searches and visualizes logs. | Loggly |
| Workflows | Automates actions and connects OneUptime to the tools you already use. | Zapier-style automation |
| Application performance monitoring | Tracks traces, response times, throughput and error rates. | New Relic, Datadog |
| Error tracking | Groups exceptions with stack traces and context. | Sentry |

## Finding your way around

Everything in OneUptime is under **Products** in the top bar. The menu lists its groups as the rows of one list, and always opens with the first of them, the essentials, open: Monitors, Incidents, Alerts, On-Call Duty, Status Pages, Scheduled Maintenance and SLOs. Every other group (Observability, AI, Code, Resources, Infrastructure, Dashboards & Automation and Settings) is folded into a row of the same list. Each row names the products the group holds and says how many. Click a row to open it or fold it, or move to it with the arrow keys and press **Enter**.

- **Search finds everything.** Type in the menu's search box to find any product by its name, by what it does, or by a familiar word such as `k8s` or `RUM`. Search looks inside the folded groups too.
- **You start where you are.** The group of the page you are on opens by itself, and the products you opened recently are listed at the top.
- **Your choices stay.** The menu remembers, on your browser, which of the other groups you opened or folded. The essentials are open again each time you open the menu, even if you folded them.
- **On a phone**, the menu button lists the products the same way: the essentials open at the top, and every other group as one row that opens on a tap.

## Searching for a page, a setting or an action

Press **Cmd+K** (Mac) or **Ctrl+K** (Windows and Linux), or click the search icon in the top bar, and start typing. Search finds:

- **Every page in the menus**, by the name the menu gives it: API Keys, Danger Zone, On-Call Schedules, Incident Severity, your own Notification Methods. Each result says where it lives, such as *Project Settings › Advanced*, so pages that share a name (Custom Fields in Incidents, Alerts and Monitors) are easy to tell apart.
- **Actions**, by what you want to do: Declare Incident, Create Monitor, or Delete Project, which opens the Danger Zone. An action that changes something is offered only to people allowed to do it.
- **Your monitors, incidents, alerts, status pages and on-call policies**, by name.

Search reads what you type the way you mean it:

- Case, accents, spaces and hyphens do not matter: *on-call*, *on call* and *oncall* find the same pages, and words can come in any order.
- It knows other words for many pages: *pager* or *escalation* for On-Call Policies, *rota* for On-Call Schedules, *2fa* for two-factor authentication, *delete project* for the Danger Zone.
- Add the product's name to narrow a search down: *incident custom fields* finds the Custom Fields page of Incidents.
- A small typo, such as *incidnet*, still finds what you meant when nothing matches as typed.

With the search box empty, Search lists the pages you opened recently, the actions, and the products.
