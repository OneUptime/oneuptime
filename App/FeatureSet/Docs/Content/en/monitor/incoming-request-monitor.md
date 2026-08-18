# Incoming Request Monitor

An Incoming Request monitor gives you a URL that other systems send HTTP requests to. OneUptime evaluates every request against your criteria, and can change the monitor's status, declare incidents, and page your on-call rota.

It covers two different jobs:

- **Heartbeat monitoring** — a cron job, worker, or device pings the URL on a schedule, and OneUptime raises an incident when the pings stop arriving.
- **Receiving alerts from another system** — Prometheus Alertmanager, Grafana, or anything else that can POST JSON pushes alerts in, and OneUptime turns each one into an incident with on-call escalation and automatic resolution on recovery.

Both use the same monitor type. What separates them is the criteria you configure.

## Overview

Incoming Request monitors provide a unique URL that your services call. This enables you to:

- Monitor cron jobs and scheduled tasks
- Verify background workers are running
- Monitor services behind firewalls that cannot be reached externally
- Receive alerts from Prometheus Alertmanager, Grafana, and other alerting systems
- Track heartbeat signals from any HTTP-capable system

## Creating an Incoming Request Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Incoming Request** as the monitor type
4. A **Secret Key** and URL are generated for this monitor
5. Open the monitor and click **Documentation** in the left menu to copy the URL
6. Configure your service to send requests to that URL
7. Configure monitoring criteria as described below

## The request URL

Your monitor has a unique URL in the format:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Replace `https://oneuptime.com` with your OneUptime instance URL if self-hosted.

Send **GET** or **POST** requests to this URL. HEAD is accepted and treated as GET. Other methods return 404. The secret key in the path is the only credential — no header or token is required.

> **Warning:** Anyone who knows this URL can mark the monitor healthy, so treat it as a secret. Every header you send is stored on the monitor and is visible to anyone who can read it — do not send API keys or tokens in headers to this endpoint.

OneUptime replies with an empty `200` immediately and processes the request on a queue. That reply is written before any validation happens, so a `200` is **not** confirmation that the request was accepted — a wrong secret key, a deleted monitor, and a disabled monitor all return `200` too. Check the monitor's own timeline to confirm requests are landing.

### Sending a request body

If you want to address fields inside the body — `{{requestBody.status}}` in an incident title, a JSON path in incident grouping, or a JavaScript Expression criteria — send `Content-Type: application/json` — it is the format these docs assume throughout. An `application/x-www-form-urlencoded` body is also parsed, but only into flat top-level fields. Any other content type, or none at all, is not parsed and every `requestBody` reference resolves to nothing.

Bodies up to 50 MB are accepted. Do not compress the body with `Content-Encoding: gzip`; it is stored unparsed and paths into it will not resolve.

### Sending a heartbeat

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
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python example
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Monitoring Criteria

You can configure criteria to determine when your service is considered online, degraded, or offline. Each criteria filter has a **Filter Type** (what to look at), a **Filter Condition** (how to compare it), and a **Value**.

### Available Filter Types

| Filter Type           | Checks                                                 | Notes                                                                                        |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Incoming Request      | Whether a request was received within a time window    | The only check that can fire when nothing arrives                                            |
| Request Body          | The request body                                       | Substring match. Object bodies are compared as compact JSON                                  |
| Request Header        | The names of the request headers                       | Exact match against a header name, lower-cased                                               |
| Request Header Value  | The values of the request headers                      | Exact match against a header value, lower-cased                                              |
| JavaScript Expression | Any expression over `requestBody` and `requestHeaders` | The most flexible option — see [JavaScript Expressions](/docs/monitor/javascript-expression) |

### Filter Conditions

Each filter type offers its own set of conditions.

For **Incoming Request** (reproduced here with the dashboard's spelling):

- **Recieved In Minutes** — a request was received within the specified number of minutes
- **Not Recieved In Minutes** — no request was received within the specified number of minutes

For **Request Body**, **Request Header**, and **Request Header Value**: **Contains** and **Not Contains**.

For **JavaScript Expression**: **Evaluates To True**.

> **Note:** Header names and header values are lower-cased before comparison, and the match is against the whole name or value, not a substring. Write `content-type`, not `Content-Type`, and `application/json`, not `application/JSON`. Only **Request Body** does a true substring match.

Object bodies are compared as compact JSON with no spaces, so a **Request Body** / **Contains** filter must be written `"status":"firing"` — copying `"status": "firing"` out of a pretty-printed payload will never match.

### Example Criteria

#### Mark as offline if no heartbeat in 10 minutes

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### Mark as degraded based on request body content

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** A monitor is only re-evaluated in the background if at least one of its criteria checks on **Incoming Request**. A monitor whose criteria only check Request Body, Request Header, or a JavaScript Expression is evaluated when a request arrives and at no other time — so it can never go offline on its own. If you want a missing-heartbeat alarm, you need an **Incoming Request** criteria.

Note also that a monitor which has never received a request is treated as though its creation time were the last request. A "Not Recieved In Minutes: 10" criteria on a brand-new monitor fires 10 minutes after you create it, even if the sender was never wired up.

## Receiving alerts from another system

Alertmanager, Grafana, and similar tools POST a JSON document describing one or more alerts. By default a criteria opens **one** incident, so a payload carrying five alerts would produce a single incident. Incident grouping changes that: it extracts a value from the payload and opens a **separate incident per distinct value**, all of which can be open at once.

### Turning on incident grouping

Open the criteria, expand **Settings**, and turn on **Group incidents and alerts by a payload field**. Four fields appear:

| Field                              | Example                                  | What it does                                                           |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | The path whose distinct values split incidents apart                   |
| Field that signals recovery        | `requestBody.alerts[*].status`           | The path checked to decide an alert has recovered                      |
| Value that means recovered         | `resolved`                               | The exact value that marks recovery                                    |
| Max incidents per request          | `100` (default)                          | Safety cap so a high-cardinality field cannot open unbounded incidents |

### Path syntax

Paths must start with the literal prefix `requestBody.`. A path without it — `alerts[*].labels.alertname` — matches nothing, silently. The `{{ }}` wrapper is optional: `requestBody.status` and `{{requestBody.status}}` behave identically.

- `[*]` fans out over an array — one incident per **distinct** value. Two elements yielding the same value collapse into one incident, and that incident's firing/resolved state is taken from the **first** matching element. **Only the first `[*]` in a path is a wildcard**; `requestBody.groups[*].alerts[*].name` matches nothing.
- `[0]` and `[last]` select a single element, and may follow a `[*]`.
- Object and array values, empty strings, and nulls are skipped. `0` and `false` are valid keys.

### Resolution is event-driven

A webhook describes only what is in that payload, so OneUptime never resolves an incident because its key stopped appearing. An incident is resolved only when a payload explicitly says that key recovered. Two things must both be true:

1. **Field that signals recovery** and **Value that means recovered** are set, and match the payload. The comparison is exact and case-sensitive — `Resolved` does not match `resolved`.
2. The criteria's incident has **Auto Resolve Incident** turned on, under **Advanced Options** in the incident form. Without it, matching recovery events are ignored and the incidents stay open. (The same applies to alerts and **Auto Resolve Alert**.)

**Max incidents per request** caps extraction, not just creation. Keys past the cap are invisible to recovery as well, so in a payload carrying more distinct keys than the cap, an alert reporting `resolved` beyond it will not close its incident.

> **Warning:** If **Field that signals recovery** contains `[*]` but **Open a separate incident for each…** does not, nothing will ever resolve. Either use `[*]` in both, or neither. A recovery path without `[*]` is evaluated against the whole payload, so a payload-level `status: resolved` resolves every key in that payload — including alerts whose own status is still firing.

### Naming the incidents

The grouping key is exposed to incident and alert templates as a variable named after the **last segment of the path**:

| Path                                     | Variable          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

The full payload is available alongside it, so an incident title of `{{alertname}}` and a description referencing `{{requestBody.commonAnnotations.summary}}` both work. See [Incident & Alert Dynamic Templating](/docs/monitor/incident-alert-templating).

> **Warning:** The variable name is part of the identity OneUptime uses to match a recovery event to an open incident. Changing the grouping path to one with a different last segment orphans every incident that is currently open under the old path — they can no longer be resolved automatically and must be closed by hand.

Note that `[*]` works **only** in the two grouping path fields. Elsewhere it does not resolve, and an unresolved placeholder is printed **verbatim** rather than blanked — a title of `{{requestBody.alerts[*].labels.alertname}}` renders with the braces still in it. A title of `{{requestBody.alerts[0].annotations.summary}}` resolves, but always reads the first alert in the payload, not the one this incident was opened for. Prefer the grouping variable plus the payload's shared `commonAnnotations` fields.

### Worked example

For a full Alertmanager configuration, see [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). For Grafana, see [Grafana](/docs/integrations/grafana).

## Best Practices

1. **Set the time window appropriately** — If your cron job runs every 5 minutes, set the "Not Recieved In Minutes" threshold to 10–15 minutes to allow for occasional delays
2. **Include meaningful data** — Send status information in the request body so you can set up granular criteria
3. **Use POST with `Content-Type: application/json`** — anything that reads inside the body depends on it
4. **Don't mix the two jobs on one monitor** — a monitor receiving event-driven alerts has no regular cadence, so a "Not Recieved In Minutes" criteria on it will flap. Use a separate monitor for the dead-man's switch
5. **Monitor the monitor** — Ensure the service sending requests has proper error handling so failed requests don't go unnoticed

## Where to read next

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — a complete inbound alerting setup
- [Grafana](/docs/integrations/grafana) — the same, for Grafana alerting
- [Incident & Alert Dynamic Templating](/docs/monitor/incident-alert-templating) — every variable available in titles and descriptions
- [JavaScript Expressions](/docs/monitor/javascript-expression) — expression syntax and quoting rules
