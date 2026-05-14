# Manual Monitor

Manual monitoring allows you to create monitors whose status is managed entirely by hand or through the API. OneUptime does not perform any automated checks — you control the monitor status directly.

## Overview

Manual monitors are placeholders that you update yourself. This is useful for:

- Integrating with external monitoring tools that update status via the OneUptime API
- Tracking services or systems that cannot be monitored automatically
- Managing incidents for components without automated health checks
- Representing third-party dependencies whose status you track manually

## Creating a Manual Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Manual** as the monitor type
4. Enter a name and description for the monitor

## How It Works

Manual monitors do not have monitoring intervals, probes, or automated criteria evaluation. The monitor status remains as you set it until you change it.

### Updating Status

You can update the status of a manual monitor in two ways:

- **Dashboard** — Change the monitor status directly from the OneUptime Dashboard
- **API** — Update the monitor status programmatically using the OneUptime API

### Incidents and Alerts

You can create incidents and alerts against manual monitors just like any other monitor type. This allows you to:

- Track downtime for externally monitored services
- Create incidents manually when issues are reported
- Use manual monitors on status pages to communicate status to users

## When to Use Manual Monitors

| Use Case | Description |
|----------|-------------|
| Third-party services | Track the status of external services you depend on but cannot monitor directly |
| Physical infrastructure | Represent hardware or physical systems without network monitoring |
| Business processes | Track non-technical processes that affect service status |
| API-driven status | Let external tools update monitor status via the OneUptime API |
| Status page placeholders | Show components on your status page that are managed outside OneUptime |
