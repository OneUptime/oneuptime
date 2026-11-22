# Ingestion Keys

An ingestion key connects your telemetry to your project. Applications, OpenTelemetry collectors and agents send it with every request, and OneUptime files their logs, traces and metrics in the project the key belongs to. This page shows how to create a key, which kind to pick, and how to keep keys safe. To tell an ingestion key from an API key, see [Which One Do I Use?](/docs/introduction/which-one#ingestion-key-or-api-key).

:::cards
- [Create an ingestion key](#create-an-ingestion-key): A name, a type and a secret to copy.
- [Server, Browser or Mobile](#server-browser-or-mobile): Which kind of key a sender needs.
- [Lock down a Browser key](#lock-down-a-browser-key): Origins, one service name and a limit.
- [Rotate, turn off or delete a key](#rotate-turn-off-or-delete-a-key): What to do when a key leaks.
:::

## How a key is checked

Every request carries the key's secret, usually in an `x-oneuptime-token` header. OneUptime looks the key up, checks that it may still send, and only then accepts the data into the key's project.

```mermaid title="What OneUptime checks before it accepts telemetry"
flowchart TB
    request["A request with<br/>x-oneuptime-token"] --> known{"Known, enabled,<br/>not expired?"}
    known -->|"Yes"| origin{"Allowed origin, for<br/>a Browser key?"}
    origin -->|"Yes"| limit{"Under its limit?"}
    limit -->|"Yes"| accepted["Accepted into the<br/>key's project"]
    known -->|"No"| refused["Refused, with a<br/>status that says why"]
    origin -->|"No"| refused
    limit -->|"No"| refused
```

- **The key decides the project.** You never send a project ID: data sent with a key lands in the project the key belongs to.
- **Changes reach every server within seconds.** Turning a key off, resetting its secret, or changing its origins, expiry or limit takes effect on every server within a few seconds.
- **A key can have budgets of its own.** A daily budget and a per-second rate for each signal, within its project's: see [Ingestion Budgets](/docs/telemetry/ingestion-budgets).
- **A Server key is a password.** Anyone who has it can send telemetry into your project. Keep it in your servers' secrets, never in source control, a web page or a mobile app.

## Server, Browser or Mobile

Pick the type by where the key will live. The type cannot be changed after the key is created.

| | **Server** | **Browser** | **Mobile** |
| --- | --- | --- | --- |
| For | Applications, collectors and agents on machines you run | Web pages | One iOS, Android or React Native app |
| Sends | Every kind of telemetry, to every endpoint | Traces, logs, metrics, session replays and [Sentry events](/docs/telemetry/compatible-endpoints#sentry-sdks) | That app's traces, logs and metrics, over OTLP/HTTP, and its session replays |
| A secret | Yes: keep it on your servers | No: anyone who views the page can read it | No: anyone who has the app can copy it |
| Origins | Not checked | Only the listed origins are accepted | A request from a web page is refused |
| Requests per minute | No limit, unless you set one | 6,000, unless you set another limit | 6,000, unless you set another limit |

OneUptime refuses a Browser key everywhere else, such as over gRPC and MQTT, for profiles, syslog, Fluent Bit and Fluentd, and for source map uploads, and a Mobile key anywhere but OTLP traces, logs and metrics over HTTP and its app's session replays. To move a sender to another type, create a key of that type, switch the sender to it, then delete the old key.

## Before you begin

- **A role that manages ingestion keys.** Project Owner or Project Admin, or a custom role with the Create Ingestion Key permission. The Telemetry roles do not include ingestion keys.
- **On OneUptime Cloud, a payment method.** Telemetry is billed as you use it, so a project on the Free plan needs a payment method before it can create a key. The create dialog then ends on a **Billing** step with the pricing.

## Create an ingestion key

:::steps
### Open Ingestion Keys

Go to **Project Settings → Telemetry & APM → Ingestion Keys**. **Telemetry & APM** starts collapsed in the side menu: click it to open it. The list shows each key's **Name**, **Type**, **Last Used** and **Description**.

### Name the key and pick its type

Click **Create Ingestion Key**. The dialog starts with the name **Server key** and the **Server** type. Pick the **Key Type**, and rename the key after what will use it, such as `checkout-collector`. A **Description** is under **Advanced**.

### Add a Browser key's origins or a Mobile key's app

A **Browser** key asks for its **Allowed Origins** on the next step, **Browser Settings**, with its **Pinned Service Name** under **Advanced**. See [Lock down a Browser key](#lock-down-a-browser-key). A **Mobile** key asks for its **Pinned Service Name** on the first page instead: the `service.name` of the app it ships in.

### Create the key and copy its secret

Click **Create Ingestion Key**. The key's own page opens: copy its **Secret Key** and give it to your senders.
:::

Every product's **Setup Guide** starts with **Choose an ingestion key**, which lists the keys that guide can use and creates one in place. The snippets on the guide then carry that key.

## Send telemetry with the key

Senders put the secret in an `x-oneuptime-token` header:

```text
x-oneuptime-token: YOUR_ONEUPTIME_INGESTION_KEY
```

- OpenTelemetry SDKs read it from `OTEL_EXPORTER_OTLP_HEADERS`. See the [OpenTelemetry quickstart](/docs/telemetry/open-telemetry#quickstart).
- Over OTLP/gRPC, it goes in the `x-oneuptime-token` metadata.
- An MQTT device sends it as its password. See [IoT Devices](/docs/telemetry/iot-devices).
- OneUptime also reads the key from an `x-oneuptime-ingestion-key` or `x-oneuptime-service-token` header, which some older setups send.

## Lock down a Browser key

A Browser key sits in your page, where anyone can copy it. Everything it sends is filed as a browser RUM application, never as a host, a cluster, a cloud resource, a database or a backend service: of the resource a sender sets, the key keeps only what a page says about itself, such as `service.*`, `browser.*` and `user_agent.*` attributes and `oneuptime.label.*` labels. These settings limit what a copy can do. Change them on the key's page with **Edit Ingestion Key**.

| Setting | What it does |
| --- | --- |
| **Allowed Origins** | The only origins the key is accepted from. A request from any other origin, or with no `Origin` header at all, is refused. A Browser key must keep at least one. |
| **Pinned Service Name** | Files everything the key sends over OTLP/HTTP under this one application, whatever `service.name` the sender set. A copy of the key can then only write into that application. |
| **Requests Per Minute Limit** | The most requests the key is accepted for each minute, shared by every visitor. A Browser key gets 6,000 when you leave it empty. |
| **Expires At** | The date after which the key is refused, so a published copy stops working. |

An origin is a scheme, a host and an optional port: `https://app.example.com` does not cover `https://app.example.com:8443`. One leading `*.` covers every subdomain, but not the bare domain itself. React Native session replay sent with a Browser key carries an exact `app://` identity, which takes no wildcard:

```json
[
  "https://app.example.com",
  "https://*.example.com",
  "app://com.example.mobile"
]
```

[Services](/docs/telemetry/services#how-a-service-gets-into-the-catalog) shows how a pinned name decides the service. The Kubernetes agent's Runner and AI agent, and the infrastructure AI agents, do not register with a pinned key: give them an unpinned Server key.

## What a Mobile key limits

A Mobile key ships inside your app, and anyone who has the app can copy it. These limits keep every copy to the app it was made for:

- **It writes only as one app.** Everything it sends is filed under its **Pinned Service Name** as a mobile RUM application, whatever service or host the sender names. A copy cannot write into your backend services, hosts or clusters.
- **It sends only that app's telemetry.** OTLP traces, logs and metrics over HTTP, and the app's session replays from its React Native recorder, with the key's **Pinned Service Name** as their `appIdentifier`. It is refused over gRPC and MQTT, for another app's session replays, profiles and source maps, on every other endpoint, and from any web page.
- **It is rate limited.** 6,000 requests per minute for all copies together, unless you set its **Requests Per Minute Limit**.
- **You can stop it.** Turn **Enabled** off, or set **Expires At**, and every copy is refused within seconds.

What it cannot stop: someone who has your app can still send made-up traces, logs, metrics and session replays for that one app, up to the key's limit, until you turn the key off or it expires. Rotate the key with your releases, so an old copy stops working with its version.

## Rotate, turn off or delete a key

A key's page shows its **Status**, its **Secret Key** behind **Click to reveal**, and its **Last Used At**: the last time OneUptime accepted data sent with it.

| To | Do this | What senders see |
| --- | --- | --- |
| Stop a key at once, and undo it later | Click **Edit Ingestion Key**, open **Access & Limits** and turn **Enabled** off. The status reads **Disabled — telemetry refused**. | `422` until you turn it back on |
| Replace a leaked secret | Click **Reset Secret Key** and confirm. The key keeps its settings and gets a new secret. | `401` until they send the new secret |
| Stop a key for good | Click **Delete Ingestion Key** at the bottom of its page. | `401` |

To change a secret without losing data, create a second key, move your senders to it, and delete the old key once its **Last Used At** stops moving. **Last Used At** is updated every few minutes, not on every request.

## Troubleshooting

A refused request is answered with a status and a sentence that says why.

The key's page keeps count too: **Refused Telemetry** lists what was refused from the key in the past 30 days, why, on which endpoint, how many requests and when. A missing or mistyped key belongs to no project, so nothing counts it.

| Answer | What it means |
| --- | --- |
| `401` with `Missing ingestion token` | The request has no key. Send it in `x-oneuptime-token`. |
| `401` with `Invalid ingestion token` | No key has this secret: it was mistyped, reset or deleted. |
| `401` with `This telemetry ingestion key expired.` | Its **Expires At** has passed. Set a later date, or use another key. |
| `402` with `Add a payment method` | On OneUptime Cloud, the project is on the Free plan and has no payment method yet. |
| `422` with `This telemetry ingestion key has been disabled.` | Someone turned **Enabled** off. |
| `422` with `A browser ingestion key cannot be used for` | A Browser key reached an endpoint that takes only Server keys. |
| `422` with `did not send an Origin header` | A Browser key was sent from outside a browser. Use a Mobile key in a mobile app, and a Server key anywhere else. |
| `422` with `A mobile ingestion key cannot be used for` | A Mobile key reached an endpoint other than OTLP traces, logs and metrics over HTTP and session replay, such as gRPC or profiles. |
| `422` with `A mobile ingestion key can send session replays only` | A Mobile key sent a web page's recording, or another app's. Give the React Native recorder the key's **Pinned Service Name** as its `appIdentifier`. |
| `422` with `A mobile ingestion key cannot be used from a web page` | A Mobile key was sent from a browser. Use a Browser key in a web page. |
| `422` with `is not allowed for this browser ingestion key` | The page's origin is not in **Allowed Origins**. |
| `422` with `is pinned to a single service` | A key with a **Pinned Service Name** was used to register an agent. Use an unpinned Server key. |
| `429` with `Too many telemetry requests for this ingestion key` | The key reached its **Requests Per Minute Limit**. Exporters retry after the `Retry-After` time. |

For the other answers an OTLP exporter can get, see [Responses](/docs/telemetry/open-telemetry#responses).

:::details Data still arrives after I turned the key off
Each OneUptime server checks for a change to a key at least once a second, so a change reaches all of them within a few seconds, and requests after that are refused. While a server cannot reach OneUptime's cache, it may go by what it knew of the key for up to a minute. An MQTT client that connected with the key is cut off within a few seconds.
:::

:::details A Browser key works on my laptop but not in production
An origin includes its scheme and port. `http://localhost:3000` and `https://app.example.com` are different origins: list each one the page is served from.
:::

:::details Last Used At still says Never
Nothing has sent data with this key since OneUptime began recording its use. Check that your senders hold this key's secret, and that their requests reach OneUptime.
:::

## Next steps

:::cards
- [OpenTelemetry](/docs/telemetry/open-telemetry): Send traces, metrics and logs with your key.
- [Services](/docs/telemetry/services): See the services your telemetry is filed under.
- [Data Retention](/docs/telemetry/data-retention): Decide how long the data is kept.
- [Drop Filters & Scrub Rules](/docs/telemetry/drop-filters-and-scrub-rules): Drop or mask data before it is stored.
- [Ingestion Budgets](/docs/telemetry/ingestion-budgets): Cap how much each key may send in a day.
:::
