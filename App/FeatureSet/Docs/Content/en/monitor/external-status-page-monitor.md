# External Status Page Monitor

External Status Page monitoring allows you to monitor third-party status pages and get alerted when services you depend on experience outages or degraded performance. OneUptime periodically checks external status pages (such as AWS, GCP, Azure, GitHub, OpenAI, Anthropic, and more) and evaluates their status.

## Overview

External Status Page monitors check the health of services you rely on by querying their public status pages. This enables you to:

- Monitor the availability of third-party services your application depends on
- Get alerted when upstream providers experience outages
- Track individual component statuses (e.g., "AWS EC2 us-east-1")
- Scope monitoring to a single component group (e.g., only OpenAI's "APIs"), so unrelated incidents elsewhere on the page do not trip your monitor
- Detect degraded performance before it impacts your users
- Correlate your own incidents with upstream provider issues

## Supported Providers

OneUptime supports monitoring status pages via the following methods:

| Provider Type            | Description                                                        |
| ------------------------ | ----------------------------------------------------------------- |
| **Auto** (default)       | Automatically detects the status page format                      |
| **Atlassian Statuspage** | Status pages powered by Atlassian Statuspage (JSON API)           |
| **incident.io**          | Status pages powered by incident.io (e.g. `https://status.openai.com`) |
| **RSS**                  | Status pages that provide an RSS feed                             |
| **Atom**                 | Status pages that provide an Atom feed                           |

### Auto-Detection

When set to **Auto**, OneUptime will attempt to detect the status page format automatically, in this order:

1. First, it tries the Atlassian Statuspage JSON API (`/api/v2/status.json`, `/api/v2/components.json`, and `/api/v2/incidents/unresolved.json`)
2. Next, it tries the incident.io status page API (`/proxy/<host>`)
3. If those fail, it attempts to parse the page as an RSS or Atom feed
4. As a final fallback, it performs a basic HTTP reachability check

## Creating an External Status Page Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **External Status Page** as the monitor type
4. Enter the status page URL you want to monitor
5. Optionally select a specific provider type (or leave as **Auto**)
6. Optionally enter a **component group** to scope to a group such as "APIs"
7. Optionally enter a **component name** to filter to a single component (within the group, if a group is set)
8. Configure monitoring criteria as needed

## Configuration Options

### Status Page URL

Enter the URL of the external status page you want to monitor. For Atlassian Statuspage and incident.io-powered sites, this is typically the root URL (e.g., `https://status.example.com`). For RSS/Atom feeds, enter the feed URL directly.

### Provider Type

Select the provider type for the status page. Use **Auto** (default) to let OneUptime detect the format automatically, or specify **Atlassian Statuspage**, **incident.io**, **RSS**, or **Atom** if you know it.

### Component Group Filter

If the status page organizes its components into groups, you can scope the monitor to a single group. For example, on `https://status.openai.com`, entering `APIs` scopes the monitor to OpenAI's API services.

When a component group is set, the **active incident count** and **overall status** are computed using only the components in that group — an incident affecting an unrelated group (for example, ChatGPT) will not trip a monitor scoped to the "APIs" group.

Component group filtering is supported for **Atlassian Statuspage** and **incident.io** providers. (RSS/Atom feeds do not expose component groups.)

### Component Name Filter

If the status page reports on multiple components, you can optionally specify a component name to monitor only that specific component. For example, to monitor only AWS EC2 in us-east-1, you would enter `EC2 us-east-1` (the exact component name as shown on the status page).

When a component group is also set, the component name filter is applied **within** that group, letting you target a single component inside a larger group. When neither filter is specified, all components in scope are monitored.

### Advanced Options

#### Timeout

The maximum time (in milliseconds) to wait for a response from the status page. Default is 10000ms (10 seconds).

#### Retries

The number of times to retry the request if it fails. Default is 3 retries.

## Monitoring Criteria

You can configure criteria to determine when the external service is considered operational or down based on:

- **Is Online** – Whether the status page is reachable and returning status data
- **Overall Status** – The overall status indicator of the status page (e.g., `operational`, `degraded_performance`, `partial_outage`, `major_outage`)
- **Component Status** – The status of components in scope (respecting the component group / component name filters)
- **Active Incidents** – The number of currently active incidents reported on the status page (scoped to the component group / component when a filter is set)
- **Response Time** – How long it takes to fetch the status page data

### Default Criteria

By default, OneUptime seeds criteria based on what actually matters for a status page — its active incidents and component health, rather than mere reachability:

- The monitor is marked **Operational** when there are no active incidents in scope.
- The monitor is marked **Down** (and an incident is created) when there is at least one active incident in scope, or when a component in scope reports `degraded_performance`, `partial_outage`, `major_outage`, or `full_outage`.

Because the active incident count and component statuses respect the component group / component name filters, these default criteria automatically target only the components you care about.

## Popular Status Page URLs

Here is a curated list of popular service status page URLs you can monitor:

| Service                      | Status Page URL                               |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| OpenAI                       | `https://status.openai.com`                   |
| Anthropic                    | `https://status.anthropic.com`                |
| Cloudflare                   | `https://www.cloudflarestatus.com`            |
| Datadog                      | `https://status.datadoghq.com`                |
| PagerDuty                    | `https://status.pagerduty.com`                |
| Twilio                       | `https://status.twilio.com`                   |
| Stripe                       | `https://status.stripe.com`                   |
| Slack                        | `https://status.slack.com`                    |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com`                |
| Vercel                       | `https://www.vercel-status.com`               |
| Netlify                      | `https://www.netlifystatus.com`               |
| DigitalOcean                 | `https://status.digitalocean.com`             |
| Heroku                       | `https://status.heroku.com`                   |
| MongoDB Atlas                | `https://status.cloud.mongodb.com`            |
| Fastly                       | `https://status.fastly.com`                   |
| New Relic                    | `https://status.newrelic.com`                 |
| Sentry                       | `https://status.sentry.io`                    |
| CircleCI                     | `https://status.circleci.com`                 |

> **Note:** Many of these use Atlassian Statuspage or incident.io, so the **Auto** provider type will detect them automatically.

## Incident & Alert Templating

When creating incidents or alerts from External Status Page monitors, you can use the following template variables:

| Variable                  | Description                                                  |
| ------------------------- | ------------------------------------------------------------ |
| `{{isOnline}}`            | Whether the status page is online (true/false)               |
| `{{responseTimeInMs}}`    | Response time in milliseconds                                |
| `{{failureCause}}`        | Reason for failure, if any                                  |
| `{{overallStatus}}`       | The overall status indicator value                          |
| `{{activeIncidentCount}}` | Number of active incidents (scoped to the filter, if any)   |
| `{{componentStatuses}}`   | JSON array of component statuses (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | Detected provider (Atlassian Statuspage, incident.io, RSS, Atom) |
| `{{componentGroup}}`      | Component group the monitor is scoped to, if any            |
| `{{componentName}}`       | Component the monitor is scoped to, if any                  |

## Best Practices

- **Use Auto provider type** unless you know the exact format — Auto detection works well for most status pages
- **Scope to a component group** if you only depend on part of a provider (e.g. only OpenAI's "APIs"), so unrelated incidents don't create noise
- **Monitor specific components** if you only depend on certain services (e.g., a specific AWS region)
- **Set up incident correlation** — when your monitors detect issues and the upstream status page also shows problems, it helps identify root causes faster
- **Combine with other monitors** — pair External Status Page monitors with your own API/Website monitors for comprehensive visibility
