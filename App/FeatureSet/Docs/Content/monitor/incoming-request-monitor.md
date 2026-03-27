# Incoming Request Monitor

Incoming Request monitoring (also known as heartbeat monitoring) allows you to monitor services by having them send periodic HTTP requests to OneUptime. Instead of OneUptime reaching out to your service, your service pings OneUptime to confirm it is running.

## Overview

Incoming Request monitors provide a unique webhook URL that your services call on a schedule. This enables you to:

- Monitor cron jobs and scheduled tasks
- Verify background workers are running
- Monitor services behind firewalls that cannot be reached externally
- Integrate with third-party monitoring tools
- Track heartbeat signals from any HTTP-capable system

## Creating an Incoming Request Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Incoming Request** as the monitor type
4. A **Secret Key** and heartbeat URL will be generated for this monitor
5. Configure your service to send requests to the heartbeat URL
6. Configure monitoring criteria as needed

## Heartbeat URL

Once created, your monitor will have a unique heartbeat URL in the format:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Your service should send HTTP **GET** or **POST** requests to this URL at regular intervals.

### Sending a Heartbeat

#### Using curl

```bash
# Simple GET request
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST request with custom body
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### From a cron job

```bash
# Add to crontab to send heartbeat every 5 minutes
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### From application code

```javascript
// Node.js example
const https = require('https');
https.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY');
```

```python
# Python example
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

Replace `https://oneuptime.com` with your OneUptime instance URL if self-hosted.

## Monitoring Criteria

You can configure criteria to determine when your service is considered online, degraded, or offline based on:

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Incoming Request | Whether a heartbeat was received within a time window |
| Request Body | Content of the request body sent with the heartbeat |
| Request Header | Name of a specific request header |
| Request Header Value | Value of a specific request header |

### Filter Types

For **Incoming Request**:

- **Received In Minutes** — A heartbeat was received within the specified number of minutes
- **Not Received In Minutes** — No heartbeat was received within the specified number of minutes

For **Request Body**, **Request Header**, and **Request Header Value**:

- **Contains** — Value contains the specified text
- **Not Contains** — Value does not contain the specified text

### Example Criteria

#### Mark as offline if no heartbeat in 10 minutes

- **Check On**: Incoming Request
- **Filter Type**: Not Received In Minutes
- **Value**: 10

#### Mark as degraded based on request body content

- **Check On**: Request Body
- **Filter Type**: Contains
- **Value**: `"status": "degraded"`

## Best Practices

1. **Set the time window appropriately** — If your cron job runs every 5 minutes, set the "Not Received In Minutes" threshold to 10–15 minutes to allow for occasional delays
2. **Include meaningful data** — Send status information in the request body so you can set up granular criteria
3. **Use POST for rich data** — Use POST requests with JSON bodies when you need to send detailed status information
4. **Monitor the monitor** — Ensure the service sending heartbeats has proper error handling so failed heartbeat requests don't go unnoticed
