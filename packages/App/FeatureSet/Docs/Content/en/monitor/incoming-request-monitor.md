# Incoming Request Monitor

An Incoming Request monitor gives you a URL that other systems send HTTP requests to. OneUptime evaluates every request against your criteria, and can change the monitor's status, declare incidents, and page your on-call rota.

It covers two different jobs:

- **Heartbeat monitoring** — a cron job, worker, or device pings the URL on a schedule, and OneUptime raises an incident when the pings stop arriving.
- **Receiving alerts from another system** — Prometheus Alertmanager, Grafana, or anything else that can POST JSON pushes alerts in, and OneUptime turns each one into an incident with on-call escalation and automatic resolution on recovery.

Both use the same monitor type. What separates them is the criteria you configure.

:::cards
- [Create the monitor](#creating-an-incoming-request-monitor): Get a heartbeat URL in a few steps.
- [Send a heartbeat](#sending-a-heartbeat): From curl, cron, Node.js, Python or Go.
- [Alert when pings stop](#mark-as-offline-if-no-heartbeat-in-10-minutes-a-dead-mans-switch): Turn the monitor into a dead-man's switch.
- [Receive alerts](#receiving-alerts-from-another-system): One incident per Alertmanager or Grafana alert.
- [Subscribe to SNS or Event Grid](#subscribing-to-amazon-sns-or-azure-event-grid): Confirm the subscription in one click.
:::

## How it works

Nothing checks your system from outside: your system calls the monitor's URL, OneUptime answers at once, and then evaluates the request against the monitor's criteria. A criteria that checks for requests that *stopped* arriving is also re-checked in the background, every 30 seconds, so silence can raise an incident too.

```mermaid title="A heartbeat, from your job to the on-call team"
sequenceDiagram
    participant J as Your job
    participant O as OneUptime
    participant T as On-call team
    J->>O: GET or POST /heartbeat/KEY
    O-->>J: 200 at once
    O->>O: Evaluate the criteria
    Note over O: Every 30 seconds, check<br/>for missing requests
    O->>T: Incident, if a<br/>criteria matches
```

Use it to:

- Monitor cron jobs and scheduled tasks
- Verify background workers are running
- Monitor services behind firewalls that cannot be reached externally
- Receive alerts from Prometheus Alertmanager, Grafana, and other alerting systems
- Track heartbeat signals from any HTTP-capable system

## Creating an Incoming Request Monitor

:::steps
### Start a new monitor

Go to **Monitors** and click **Create Monitor**.

### Choose Incoming Request

Under **Monitor Type**, pick **Incoming Request** — it is one of the common types at the top. Enter a **Name**, then click **Next**.

### Review the criteria

The **Criteria** step starts with [the default criteria](#what-you-get-out-of-the-box). For a heartbeat, click **Add Criteria** and give the new criteria an **Incoming Request** / **Not Recieved In Minutes** filter that changes the status to offline and declares an incident, with **Auto Resolve Incident** on. Then drag it to the top of the list — see [Example Criteria](#example-criteria) for why.

### Create the monitor

Click **Create Monitor**. The monitor opens on its **Overview** page, where the **Send the first heartbeat** card shows the **Heartbeat URL** with a copy button and an example `curl` command.

### Send the first request

Configure your service to send requests to that URL (see [Sending a heartbeat](#sending-a-heartbeat)). When the first request arrives, the card makes way for the monitor's history, and a **Heartbeat URL** card shows the URL and when the last request came in.
:::

> [!NOTE]
> The URL contains the monitor's secret key, so only people who can edit monitors can see it. You can find it again at any time on the monitor's **Documentation** page, in the **Configuration** section of its side menu.

## The request URL

Your monitor has a unique URL in this format:

```text
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Replace `https://oneuptime.com` with your OneUptime instance URL if self-hosted.

Send **GET** or **POST** requests to this URL. HEAD is accepted and treated as GET; PUT, PATCH and DELETE return 404. The secret key in the path is the credential: no header or token is needed, unless the project [requires a secret on every request](#require-a-secret-on-every-request). Query strings are ignored: send what criteria should read in the body or the headers.

> [!WARNING]
> Anyone who knows this URL can mark the monitor healthy, so treat it as a secret. If it leaks, open the monitor's **Settings** page and click **Reset Incoming Request Secret Key**, then update every sender. The monitor's overview shows the latest request as its logs keep it: with secrets and personal data masked, and with no headers or body when **Keep request content** is off. Masking catches the names and patterns it knows, so do not send API keys or tokens to this endpoint.

> [!IMPORTANT]
> OneUptime replies `200` with an empty JSON object (`{}`) immediately and processes the request on a queue. That reply is written before any validation happens, so a `200` is **not** confirmation that the request was accepted — a wrong secret key, a deleted monitor, and a disabled monitor all return `200` too. Check the monitor's own timeline to confirm requests are landing. A project that requires a secret on every request answers a request without one with `401`, and a service that checks the URL before it delivers gets the answer it expects: see [Services that check the URL first](#services-that-check-the-url-first).

### Sending a request body

If you want to address fields inside the body — `{{requestBody.status}}` in an incident title, a JSON path in incident grouping, or a JavaScript Expression criteria — send `Content-Type: application/json`. It is the format these docs assume throughout. The body must be a JSON object or array: malformed JSON, or a bare value such as `"error"`, is refused with a `500`.

| Content type | What criteria and templates see |
| --- | --- |
| `application/json` | The parsed JSON. |
| `application/x-www-form-urlencoded` | The parsed form. Bracketed keys nest (`alerts[0][status]=firing`), and every value is a string. |
| `text/plain` | The parsed JSON, when the text is a JSON object or array: Amazon SNS sends its messages this way. Any other text is the text itself, so `backup failed: error 42` takes the monitor offline under the default criteria. |
| `application/cloudevents+json`, or another `+json` type | The parsed JSON: Azure Event Grid delivers CloudEvents this way. |
| Anything else, or none | An empty body (`{}`), so no `requestBody` reference resolves, and a template leaves it as written. |

Bodies up to 50 MB are accepted; a larger one is refused with a `413`. Do not compress the body with `Content-Encoding: gzip`: it is not stored as JSON, and paths into it will not resolve.

### Sending a heartbeat

Each example sends one request. Replace `YOUR_SECRET_KEY` with the key from your monitor's URL.

:::tabs
@tab curl
```bash
# Simple GET request
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST request with a JSON body
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```
@tab Cron
```bash
# Send a heartbeat every 5 minutes
*/5 * * * * curl -fsS https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null

# Or ping only when the job succeeds, so a failed run counts as a missed heartbeat
0 2 * * * /usr/local/bin/backup.sh && curl -fsS https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```
@tab Node.js
```javascript title="heartbeat.mjs"
// Node.js 18 or later: fetch is built in. Run with `node heartbeat.mjs`.
const response = await fetch(
  "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "healthy", version: "1.2.3" }),
  },
);

console.log(response.status); // 200
```
@tab Python
```python title="heartbeat.py"
# Python 3, standard library only. Run with `python3 heartbeat.py`.
import json
import urllib.request

request = urllib.request.Request(
    "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY",
    data=json.dumps({"status": "healthy", "version": "1.2.3"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(request, timeout=10) as response:
    print(response.status)  # 200
```
@tab Go
```go title="heartbeat.go"
// Run with `go run heartbeat.go`.
package main

import (
	"bytes"
	"fmt"
	"net/http"
)

func main() {
	body := []byte(`{"status": "healthy", "version": "1.2.3"}`)

	resp, err := http.Post(
		"https://oneuptime.com/heartbeat/YOUR_SECRET_KEY",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	fmt.Println(resp.StatusCode) // 200
}
```
@tab PowerShell
```powershell
# Windows PowerShell 5.1 or PowerShell 7
Invoke-RestMethod -Method Post `
  -Uri "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY" `
  -ContentType "application/json" `
  -Body '{"status": "healthy", "version": "1.2.3"}'
```
:::

## Require a secret on every request

Anyone who has a monitor's URL can send it requests. A Project Owner or Project Admin can make every Incoming Request monitor in the project also require one of the project's own secrets, whoever set the monitor up: turn on **Require a secret on every request**. A request without one is refused with `401` and the reason, before it counts as a heartbeat, is kept as the monitor's latest request or reaches any criteria. A request with one goes on to the monitor's own criteria, as before.

Project Owners and Project Admins manage the secrets and the switch, and so does a custom role with the Create, Read, Edit and Delete Incoming Request Secret permissions: Read shows the secrets' values, and Edit also turns the switch on and off.

:::steps
### Create a secret

Go to **Monitors → Settings → Incoming Request Secrets** and create a secret. Give it a name and OneUptime generates the value; copy it from the list.

### Send it from every sender

Send the secret in the `X-OneUptime-Secret` header, or as a bearer token in the `Authorization` header, whichever your sender can set. A sender that cannot set a header of its own can sign each request with the secret instead: see [Sign requests with the secret](#sign-requests-with-the-secret).

### Find the senders you missed

As soon as the project has a secret, OneUptime checks every request for one, without refusing any yet. **Requests Without a Secret**, on the same page, lists each Incoming Request monitor that got a request without a valid secret in the last 24 hours, and why: none was sent, or a wrong one. Fix those senders. A monitor whose senders are fixed shows a **Last With Secret** later than its **Last Without Secret**, and leaves the list within 24 hours.

### Turn on the requirement

Turn on **Require a secret on every request**. It cannot be turned on while the project has no secret, so no sender is refused by mistake. Before it turns on, it names how many Incoming Request monitors got a request without a valid secret in the last 24 hours, if any: their senders are refused from then on.
:::

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "X-OneUptime-Secret: YOUR_PROJECT_SECRET"

# Or as a bearer token
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Authorization: Bearer YOUR_PROJECT_SECRET"
```

OneUptime never stores the secret: it takes the header off the request, and masks a bearer token that is one of the project's secrets, before it keeps anything.

An address that sends one monitor more than 10 different wrong secrets in 15 minutes is refused with `429` for every secret it then sends, right or wrong, until the time its `Retry-After` header gives, at most 15 minutes. Senders at other addresses are not affected, and a sender that keeps sending one old secret keeps getting the `401` that says what is wrong.

> [!TIP]
> To replace a secret without refusing anyone, create a second one, move your senders to it, then delete the old one once its **Last Used** stops changing. Any of the project's secrets is accepted unless it is limited to other monitors, and the last one that covers a monitor cannot be deleted while the requirement is on.

### Sign requests with the secret

A sender can sign each request with the secret instead of sending it, which is safer: nothing secret travels, and a request someone captured cannot be sent again later. Prefer it wherever a sender can sign. OneUptime checks these signatures, each an HMAC-SHA256 in hex with the secret as its key:

| Sender | Header | What is signed |
| --- | --- | --- |
| Your own code | `X-OneUptime-Signature: t=<time>,v1=<signature>` | `<time>.<body>` |
| GitHub webhooks | `X-Hub-Signature-256` | The body |
| Slack | `X-Slack-Signature`, with `X-Slack-Request-Timestamp` | `v0:<time>:<body>` |
| Stripe | `Stripe-Signature` | `<time>.<body>` |

`<time>` is when the request was signed, in seconds since 1970. A signature more than 5 minutes from OneUptime's clock is refused, and so is a signed request sent a second time; GitHub's signature has no time, so OneUptime remembers each one for a day. For GitHub, give the webhook one of the project's secrets as its secret. Slack and Stripe make their own signing secret: create the project's secret with that value, under **More fields**.

```bash
body='{"status":"healthy"}'
t=$(date +%s)
sig=$(printf '%s.%s' "$t" "$body" | openssl dgst -sha256 -hmac "YOUR_PROJECT_SECRET" | sed 's/^.* //')

curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -H "X-OneUptime-Signature: t=$t,v1=$sig" \
  -d "$body"
```

A secret in the URL's query string is not accepted: proxies and access logs keep whole URLs, beside the monitor's own key. A probe's incoming request ingress passes a signed request's body on as it came, so its signature holds there too.

### Limit a secret to some monitors

A secret is accepted by every Incoming Request monitor of the project unless you limit it, as a project whose tenants each send their own secret does: under **More fields**, pick **Specific monitors** or **Monitors with labels**. Any other monitor refuses it with `401`, as it refuses a wrong secret, and **Requests Without a Secret** gives the reason as **Secret not for this monitor**. While the requirement is on, the project keeps at least one secret that covers a monitor.

## Criteria

You can configure criteria to determine when your service is considered online, degraded, or offline. Each criteria filter has a **Filter Type** (what to look at), a **Filter Condition** (how to compare it), and a **Value**.

### What you get out of the box

A new Incoming Request monitor is created with two criteria that read the request body:

| Criteria | Filter Type  | Filter Condition | Value   | Effect                                       |
| -------- | ------------ | ---------------- | ------- | -------------------------------------------- |
| Offline  | Request Body | Contains         | `error` | Marks the monitor offline, opens an incident |
| Online   | Request Body | Not Contains     | `error` | Marks the monitor online                     |

This suits the common case where the sender reports its own health in the payload: a request whose body mentions `error` takes the monitor down, and the next request without it brings the monitor back up and resolves the incident. A request with no body at all counts as "does not contain `error`", so a plain heartbeat ping keeps the monitor online.

Change the value to whatever your sender actually emits (`"status":"firing"`, `FAILED`, and so on) — the match is a case-sensitive substring test against the whole body, keys included, so `{"error":null}` matches `error` too.

> [!NOTE]
> These defaults are **not** a dead-man's switch: nothing here fires when requests stop arriving. If you want to be alerted on silence, add an **Incoming Request** / **Not Recieved In Minutes** criteria as described below.

### Available Filter Types

| Filter Type           | Checks                                                 | Notes                                                                                        |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Incoming Request      | Whether a request was received within a time window    | The only check that can fire when nothing arrives                                            |
| Request Body          | The request body                                       | Substring match. Object bodies are compared as compact JSON                                  |
| Request Header        | The names of the request headers                       | Exact match against a whole header name, ignoring case                                       |
| Request Header Value  | The values of the request headers                      | Exact match against a whole header value, ignoring case                                      |
| JavaScript Expression | Any expression over `requestBody` and `requestHeaders` | The most flexible option — see [JavaScript Expressions](/docs/monitor/javascript-expression) |

### Filter Conditions

Each filter type offers its own set of conditions:

| Filter Type | Conditions |
| --- | --- |
| **Incoming Request** | **Recieved In Minutes** — a request was received within the specified number of minutes. **Not Recieved In Minutes** — no request was received within the specified number of minutes. (The dashboard spells them this way.) |
| **Request Body**, **Request Header**, **Request Header Value** | **Contains** and **Not Contains** |
| **JavaScript Expression** | **Evaluates To True** |

> [!NOTE]
> Header names and values are compared in lower case, against the whole name or value, not a substring: `application/json` does not match `application/json; charset=utf-8`. Only **Request Body** does a substring match. Headers your proxy or OneUptime's own load balancer add (`x-forwarded-for`, `x-real-ip`) are stored too.

Object bodies are compared as compact JSON with no spaces, so a **Request Body** / **Contains** filter must be written `"status":"firing"` — copying `"status": "firing"` out of a pretty-printed payload will never match.

### Example Criteria

#### Mark as offline if no heartbeat in 10 minutes (a dead-man's switch)

| Field | Value |
| --- | --- |
| **Filter Type** | Incoming Request |
| **Filter Condition** | Not Recieved In Minutes |
| **Value** | `10` |

#### Mark as degraded based on request body content

| Field | Value |
| --- | --- |
| **Filter Type** | Request Body |
| **Filter Condition** | Contains |
| **Value** | `"status":"degraded"` |

> [!IMPORTANT]
> Put the dead-man's switch **above** the default criteria. Criteria are checked from the top, and the first one that matches decides. The background check re-reads the last request, so the default online criteria — "Request Body Not Contains `error`" — keeps matching it, and a criteria below it never gets its turn. **Add Criteria** adds a criteria at the bottom: drag it up.

> [!WARNING]
> A monitor is only re-evaluated in the background if at least one of its criteria checks on **Incoming Request**. A monitor whose criteria only check Request Body, Request Header, or a JavaScript Expression is evaluated when a request arrives and at no other time — so it can never go offline on its own. If you want a missing-heartbeat alarm, you need an **Incoming Request** criteria.

The background check counts whole minutes and fires once *more* than the value has passed: "Not Recieved In Minutes: 10" fires about 11 minutes after the last request (the check runs every 30 seconds). A monitor which has never received a request is treated as though its creation time were the last request, so the same criteria on a brand-new monitor fires about 11 minutes after you create it, even if the sender was never wired up. Only minutes OneUptime was receiving count toward the value: minutes while OneUptime itself restarts, is upgraded or catches up do not, as [When OneUptime Is Not Receiving Data](/docs/monitor/when-oneuptime-is-not-receiving) explains.

## Receiving alerts from another system

Alertmanager, Grafana, and similar tools POST a JSON document describing one or more alerts. By default a criteria opens **one** incident, so a payload carrying five alerts would produce a single incident. Incident grouping changes that: it extracts a value from the payload and opens a **separate incident per distinct value**, all of which can be open at once.

```mermaid title="Incident grouping: one incident per alert in the payload"
flowchart TB
    payload["Webhook payload"] --> keys["One key per alert"]
    keys --> state{"Alert resolved?"}
    state -->|No| open["Open or keep its incident"]
    state -->|Yes| resolve["Resolve its incident"]
```

### Turning on incident grouping

:::steps
1. Open the criteria and expand **Settings**.
2. Turn on **Group incidents and alerts by a payload field**.
3. Fill in **Open a separate incident for each…**. To have each incident resolve itself, also fill in the field and value under **Auto-resolve each incident when…** (below). Then save the monitor.
:::

| Field                              | Example                                  | What it does                                                           |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | The path whose distinct values split incidents apart                   |
| Field that signals recovery        | `requestBody.alerts[*].status`           | The path checked to decide an alert has recovered                      |
| Value that means recovered         | `resolved`                               | The exact value that marks recovery                                    |
| Max incidents per request          | `100` (default)                          | Safety cap so a high-cardinality field cannot open unbounded incidents |

Grouping belongs to the criteria it is turned on in. The monitor's other criteria do not group: when one of them matches a request, it opens its incident and alert as it would on a monitor where no criteria groups.

### Path syntax

Paths must start with the literal prefix `requestBody.`. A path without it — `alerts[*].labels.alertname` — finds no value in any request. The `{{ }}` wrapper is optional: `requestBody.status` and `{{requestBody.status}}` behave identically.

- `[*]` fans out over an array — one incident per **distinct** value. Two elements yielding the same value collapse into one incident, and that incident's firing/resolved state is taken from the **first** matching element. **Only the first `[*]` in a path is a wildcard**; `requestBody.groups[*].alerts[*].name` matches nothing.
- `[0]` and `[last]` select a single element, and may follow a `[*]`.
- Object and array values, empty strings, and nulls are skipped. `0` and `false` are valid keys.
- The body must be a JSON object; a payload whose top level is an array is not grouped.

### Requests without the field

A request that matches a grouped criteria but has no value at its path — the field is missing or empty, holds an object or a list, or the body is not a JSON object — still opens that criteria's incident and alert: one for the whole monitor, as the criteria would without grouping. So does a grouped criteria that matches because requests stopped arriving. A title that names the grouping variable, such as `{{alertname}}`, shows it as written, since there is no value to put in.

That incident resolves, if **Auto Resolve Incident** is on, when a later request without the field reports it recovered, or when a later request matches another criteria. Such a recovery opens nothing new.

When some elements of an array have a value and others do not, each value opens its own incident, and the elements without one open nothing of their own.

The **Monitor Summary** card on the monitor's **Overview** shows what each request did, including when a criteria handled it for the whole monitor or opened nothing new.

### Resolution is event-driven

A webhook describes only what is in that payload, so OneUptime never resolves an incident because its key stopped appearing. An incident is resolved only when a payload explicitly says that key recovered. Two things must both be true:

1. **Field that signals recovery** and **Value that means recovered** are set, and match the payload. The comparison is exact and case-sensitive — `Resolved` does not match `resolved`.
2. The criteria's incident has **Auto Resolve Incident** turned on, under **More fields** in the incident form. Without it, matching recovery events are ignored and the incidents stay open. (The same applies to alerts and **Auto Resolve Alert**.) The default offline criteria starts with it on; an incident you add to a criteria yourself starts with it off.

An alert you add to a criteria starts with **Auto Resolve Alert** off as well, so a recovery leaves the alert open until it is on. **Auto-resolve each incident when…** says which of the criteria's incidents and alerts a recovery resolves, and names each one it would leave open, with a button that turns its switch on. The **Monitor Summary** card on the monitor's **Overview** names each incident and alert a recovery left open, and why.

**Max incidents per request** caps extraction, not just creation. Keys past the cap are invisible to recovery as well, so in a payload carrying more distinct keys than the cap, an alert reporting `resolved` beyond it will not close its incident.

> [!NOTE]
> A monitor with a criteria that groups by a payload field evaluates every request it receives, one at a time and in the order they arrived, so a burst of alerts and recoveries opens and resolves each value's incident and alert. Up to 1,000 requests, or 16 MB of them, wait to be evaluated; past that, the oldest waiting are skipped, and the **Monitor Summary** card says how many. A monitor without grouping evaluates only the newest of the requests waiting for it.

> [!NOTE]
> If **Field that signals recovery** contains `[*]` but **Open a separate incident for each…** does not, a request has recovered only when every element of that array says so. With `requestBody.alerts[*].status` and `resolved`, an incident grouped by `requestBody.groupLabels.alertname` resolves once every alert of a request is resolved, and stays open while one still fires.

> [!WARNING]
> A recovery path without `[*]` is evaluated against the whole payload, so a payload-level `status: resolved` resolves every key in that payload — including alerts whose own status is still firing.

### Naming the incidents

The grouping key is exposed to incident and alert templates as a variable named after the **last segment of the path**:

| Path                                     | Variable          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

The full payload is available alongside it, so an incident title of `{{alertname}}` and a description referencing `{{requestBody.commonAnnotations.summary}}` both work. See [Incident & Alert Dynamic Templating](/docs/monitor/incident-alert-templating).

> [!WARNING]
> The variable name is part of the identity OneUptime uses to match a recovery event to an open incident. Changing the grouping path to one with a different last segment orphans every incident that is currently open under the old path — they can no longer be resolved automatically and must be closed by hand.

`[*]` works **only** in the two grouping path fields. Elsewhere it does not resolve, and an unresolved placeholder is printed **verbatim** rather than blanked — a title of `{{requestBody.alerts[*].labels.alertname}}` renders with the braces still in it. A title of `{{requestBody.alerts[0].annotations.summary}}` resolves, but always reads the first alert in the payload, not the one this incident was opened for. Prefer the grouping variable plus the payload's shared `commonAnnotations` fields.

### Worked example

For a full Alertmanager configuration, see [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager). For Grafana, see [Grafana](/docs/integrations/grafana).

## Services that check the URL first

Some services check a new endpoint before they deliver anything to it: they send it a request, and deliver only once it answers the way they expect. OneUptime answers these checks itself, so pasting the monitor's **Heartbeat URL** into the service is all it takes.

| Service | The check | What OneUptime answers |
| --- | --- | --- |
| Azure Event Grid, Event Grid schema | A `SubscriptionValidationEvent` | Its `validationCode`, as `validationResponse` |
| Azure Event Grid, CloudEvents schema | An `OPTIONS` request that names its origin | `WebHook-Allowed-Origin`, with that origin |
| Slack Events API | A `url_verification` request | Its `challenge` |
| Microsoft Graph change notifications | A `POST` with a `validationToken` | The token, as `text/plain` |
| Okta event hooks | A `GET` with `X-Okta-Verification-Challenge` | The challenge, as `verification` |

A check is answered only on a monitor's own URL, and only when the request counts: in a project that requires a secret on every request, a check that sends none is refused with `401`, as any request is, so the service must send the secret in a header. The answer holds what the service sent to be echoed, and nothing else of the request, and only when it has the form the service gives it.

A check reaches the monitor as any request does, so its criteria evaluate it and it shows on the monitor's **Overview**; the CloudEvents check is answered and nothing more. A probe's incoming request ingress answers a check as it answers every request, with `{}`, so send these services to OneUptime's own URL.

## Subscribing to Amazon SNS or Azure Event Grid

Amazon SNS sends nothing to a new endpoint until someone confirms the subscription, by opening a link it sends there. Azure Event Grid sends such a link too, for an endpoint that does not answer its check, and OneUptime answers it. When a link arrives that is still to be opened, the **Monitor Summary** card on the monitor's **Overview** shows what the service is waiting for, the topic, and one button that opens the link in a new tab.

| Service | The request | Button | The link works for |
| --- | --- | --- | --- |
| Amazon SNS | `SubscriptionConfirmation`, for a new HTTPS subscription | **Confirm Subscription** | Two days |
| Amazon SNS | `UnsubscribeConfirmation`, when the subscription is deleted | **Restore Subscription** | Two days |
| Azure Event Grid | `SubscriptionValidationEvent`, for a new webhook event subscription | **Validate Subscription** | 10 minutes |

The button stays until the monitor's next request arrives, even after you open the link. Once the link's time is up, the card says how to get a new one instead. If newer requests have arrived, open **Monitoring Logs** and click **View Summary** on the request's row.

The link, and the token in it, are kept unmasked wherever the request is kept: its details, its logs, and the incidents and alerts it opens. All the link can do is start deliveries to this monitor. Only a link to the service's own address counts: any other is masked as usual and gets no button.

### Amazon SNS

:::steps
1. In the Amazon SNS console, open the topic and choose **Create subscription**. Choose `HTTPS` as the protocol, and paste the monitor's **Heartbeat URL** as the endpoint.
2. Open the monitor's **Overview**, and click **Confirm Subscription** in the **Monitor Summary** card. In the SNS console, the subscription's status changes from **Pending confirmation** to confirmed.
:::

SNS sends its messages as JSON labelled `text/plain`, and the monitor reads them as JSON, so criteria, templates and incident grouping can use their fields, such as `{{requestBody.Subject}}` and `{{requestBody.Message}}`. A notification's own JSON, such as a CloudWatch alarm's, arrives as text in `Message`.

If the card says the link can no longer be opened, select the subscription in the SNS console and choose **Request confirmation**. SNS deletes a subscription that isn't confirmed within 48 hours; if that happens, create the subscription again.

### Azure Event Grid

:::steps
1. In the Azure portal, open the resource whose events you want and add an event subscription. Choose **Event Grid Schema** or **Cloud Event Schema v1.0** as its event schema, **Web Hook** as its endpoint type, and the monitor's **Heartbeat URL** as its endpoint.
2. Create the event subscription. OneUptime answers Event Grid's check, so the subscription is validated as it is created, and its events start to arrive.
:::

Event Grid validates an endpoint that echoes a code back to it, or whose owner opens the link it sends. OneUptime echoes the code, so the **Monitor Summary** card offers **Validate Subscription** only for a validation OneUptime did not answer: open it within 10 minutes. The link points at Event Grid on port 553, which a firewall in front of your browser must allow. If 10 minutes pass first, the event subscription fails: create it again.

## Best Practices

1. **Set the time window appropriately** — If your cron job runs every 5 minutes, set the "Not Recieved In Minutes" threshold to 10–15 minutes to allow for occasional delays, and put that criteria first.
2. **Include meaningful data** — Send status information in the request body so you can set up granular criteria.
3. **Use POST with `Content-Type: application/json`** — anything that reads inside the body depends on it.
4. **Don't mix the two jobs on one monitor** — a monitor receiving event-driven alerts has no regular cadence, so a "Not Recieved In Minutes" criteria on it will flap. Use a separate monitor for the dead-man's switch.
5. **Monitor the monitor** — Ensure the service sending requests has proper error handling so failed requests don't go unnoticed.

## Troubleshooting

:::details My sender gets a 200, but nothing shows on the monitor
The `200` is sent before the request is validated, so it does not prove the request was accepted. Check that the secret key in the URL matches the monitor's **Heartbeat URL**, and that the monitor is not disabled. Then look at the monitor's timeline to see whether requests are landing.
:::

:::details My sender gets a 401
The project requires a secret on every request, and the request sent none, or one that is not the project's: the reply says which. Send one of the project's secrets in the `X-OneUptime-Secret` header or as a bearer token, as [Require a secret on every request](#require-a-secret-on-every-request) shows. A refused request never reaches the monitor. It gets `401` too with one of the project's secrets that is limited to other monitors, and for a signed request whose signature is more than 5 minutes old, was sent before, or was made with another secret or over a body that changed on the way.
:::

:::details My sender gets a 429
Its address sent one monitor more than 10 different wrong secrets or signatures in 15 minutes, so every request it sends that monitor with a secret is refused until the time in its `Retry-After` header. A sender that signs with a wrong secret makes a new wrong signature every time, and gets here quickly: give it a secret the monitor accepts, as [Require a secret on every request](#require-a-secret-on-every-request) shows, and its requests are accepted once the time is up.
:::

:::details The monitor stopped getting requests after a secret was required
Its senders send no secret, or a wrong one, so every request they send is refused. A line under the monitor's **Heartbeat URL** says when the latest refused request came, and **Requests Without a Secret** lists every monitor that got one in the last 24 hours, and why. Send one of the project's secrets from those senders, as [Require a secret on every request](#require-a-secret-on-every-request) shows.
:::

:::details The monitor never goes offline when the heartbeats stop
Only an **Incoming Request** criteria (**Not Recieved In Minutes**) can notice silence. Add one if there is none, and drag it above the default criteria: the default online criteria matches the last request on every background check, and the first criteria that matches decides.
:::

:::details A Request Body filter never matches
Send `Content-Type: application/json`, and write the value as compact JSON — `"status":"firing"`, with no space after the colon. Without a JSON, form or `text/plain` content type, the body is empty, and a filter on it never matches.
:::

:::details A service says the URL did not answer its check
Give the service the monitor's **Heartbeat URL**, on OneUptime itself rather than a probe. If the project requires a secret on every request, the check is refused with `401` unless the service sends the secret. Then have the service check the URL again: it is answered at once.
:::

:::details A Request Header filter never matches
Header names and values are compared whole. Give the complete value, such as `application/json; charset=utf-8`, rather than part of it.
:::

:::details Amazon SNS says the subscription is pending confirmation
Click **Confirm Subscription** in the **Monitor Summary** card on the monitor's **Overview**. If newer requests have arrived, open **Monitoring Logs** and click **View Summary** on the confirmation's row. With **Keep request content** off, the monitor keeps no body, so no link either: turn it on in the monitor's **Settings**, and the latest request is shown again with its link.
:::

:::details The sender gets a 500
The request says `Content-Type: application/json` but its body is not a JSON object or array. Send valid JSON, or a different content type.
:::

## Next steps

:::cards
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager): A complete inbound alerting setup.
- [Grafana](/docs/integrations/grafana): The same, for Grafana alerting.
- [Incident & Alert Dynamic Templating](/docs/monitor/incident-alert-templating): Every variable available in titles and descriptions.
- [JavaScript Expressions](/docs/monitor/javascript-expression): Expression syntax and quoting rules.
:::
