# External Status Page Monitor

External Status Page monitoring allows you to monitor third-party status pages and get alerted when services you depend on experience outages or degraded performance. OneUptime periodically checks external status pages (such as AWS, GCP, Azure, GitHub, and more) and evaluates their status.

## Overview

External Status Page monitors check the health of services you rely on by querying their public status pages. This enables you to:

- Monitor the availability of third-party services your application depends on
- Get alerted when upstream providers experience outages
- Track individual component statuses (e.g., "AWS EC2 us-east-1")
- Detect degraded performance before it impacts your users
- Correlate your own incidents with upstream provider issues

## Supported Providers

OneUptime supports monitoring status pages via the following methods:

| Provider Type | Description |
|---|---|
| **Auto** (default) | Automatically detects the status page format |
| **Atlassian Statuspage** | Status pages powered by Atlassian Statuspage (JSON API) |
| **RSS** | Status pages that provide an RSS feed |
| **Atom** | Status pages that provide an Atom feed |

### Auto-Detection

When set to **Auto**, OneUptime will attempt to detect the status page format automatically:

1. First, it tries the Atlassian Statuspage JSON API (`/api/v2/status.json` and `/api/v2/components.json`)
2. If that fails, it attempts to parse the page as an RSS or Atom feed
3. As a final fallback, it performs a basic HTTP reachability check

## Creating an External Status Page Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **External Status Page** as the monitor type
4. Enter the status page URL you want to monitor
5. Optionally select a specific provider type (or leave as Auto)
6. Optionally enter a component name to filter monitoring to a specific component
7. Configure monitoring criteria as needed

## Configuration Options

### Status Page URL

Enter the URL of the external status page you want to monitor. For Atlassian Statuspage-powered sites, this is typically the root URL (e.g., `https://status.example.com`). For RSS/Atom feeds, enter the feed URL directly.

### Provider Type

Select the provider type for the status page. Use **Auto** (default) to let OneUptime detect the format automatically, or specify a specific provider type if you know it.

### Component Name Filter

If the status page reports on multiple components, you can optionally specify a component name to monitor only that specific component. For example, to monitor only AWS EC2 in us-east-1, you would enter `EC2 us-east-1` (the exact component name as shown on the status page).

When no component name is specified, the overall status of the status page is monitored.

### Advanced Options

#### Timeout

The maximum time (in milliseconds) to wait for a response from the status page. Default is 10000ms (10 seconds).

#### Retries

The number of times to retry the request if it fails. Default is 3 retries.

## Monitoring Criteria

You can configure criteria to determine when the external service is considered online, degraded, or offline based on:

- **Is Online** – Whether the status page is reachable and returning status data
- **Overall Status** – The overall status indicator of the status page (e.g., "operational", "major_outage")
- **Component Status** – The status of a specific component (when using component name filter)
- **Active Incidents** – The number of currently active incidents reported on the status page
- **Response Time** – How long it takes to fetch the status page data

## Popular Status Page URLs

Here is a curated list of popular service status page URLs you can monitor:

| Service | Status Page URL |
|---|---|
| AWS | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform | `https://status.cloud.google.com` |
| Microsoft Azure | `https://status.azure.com` |
| GitHub | `https://www.githubstatus.com` |
| Cloudflare | `https://www.cloudflarestatus.com` |
| Datadog | `https://status.datadoghq.com` |
| PagerDuty | `https://status.pagerduty.com` |
| Twilio | `https://status.twilio.com` |
| Stripe | `https://status.stripe.com` |
| Slack | `https://status.slack.com` |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com` |
| Vercel | `https://www.vercel-status.com` |
| Netlify | `https://www.netlifystatus.com` |
| DigitalOcean | `https://status.digitalocean.com` |
| Heroku | `https://status.heroku.com` |
| MongoDB Atlas | `https://status.cloud.mongodb.com` |
| Fastly | `https://status.fastly.com` |
| New Relic | `https://status.newrelic.com` |
| Sentry | `https://status.sentry.io` |
| CircleCI | `https://status.circleci.com` |

> **Note:** Many of these use Atlassian Statuspage, so the **Auto** provider type will detect them automatically.

## Incident & Alert Templating

When creating incidents or alerts from External Status Page monitors, you can use the following template variables:

| Variable | Description |
|---|---|
| `{{isOnline}}` | Whether the status page is online (true/false) |
| `{{responseTimeInMs}}` | Response time in milliseconds |
| `{{failureCause}}` | Reason for failure, if any |
| `{{overallStatus}}` | The overall status indicator value |
| `{{activeIncidentCount}}` | Number of active incidents |
| `{{componentStatuses}}` | JSON array of component statuses |

## Best Practices

- **Use Auto provider type** unless you know the exact format — Auto detection works well for most status pages
- **Monitor specific components** if you only depend on certain services (e.g., a specific AWS region)
- **Set up incident correlation** — when your monitors detect issues and the upstream status page also shows problems, it helps identify root causes faster
- **Combine with other monitors** — pair External Status Page monitors with your own API/Website monitors for comprehensive visibility
