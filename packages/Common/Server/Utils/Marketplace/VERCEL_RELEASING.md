# Publishing OneUptime Cloud on the Vercel Marketplace

This is the runbook for maintainers and AI agents who list **OneUptime Cloud**
(`https://oneuptime.com`) as a **native integration** on the
[Vercel Marketplace](https://vercel.com/marketplace), in the **Observability**
category, set up the integration in Vercel's Integration Console, and keep it
running. Follow the repository's [AGENTS.md](../../../../../AGENTS.md) and the
cloud marketplace guide, [RELEASING.md](RELEASING.md), as well: a Vercel
resource is billed by the same hourly usage report as an AWS, Microsoft or
Google Cloud purchase.

Written on **18 October 2026**, together with the integration code, before any
listing existed. Nothing in this guide had been submitted to Vercel yet. When
you do something below, add it to [History](#history), and recheck the live
state before acting: the Integration Console changes its wording and steps.
Vercel's provider docs:
[native integrations](https://vercel.com/docs/integrations/create-integration/native-integration),
[the Marketplace API](https://vercel.com/docs/integrations/create-integration/marketplace-api),
[submitting an integration](https://vercel.com/docs/integrations/create-integration/submit-integration)
and its [approval checklist](https://vercel.com/docs/integrations/create-integration/approval-checklist).

OneUptime Cloud only. A self-hosted OneUptime cannot be provisioned through
Vercel; its users send from Vercel with a custom drain and environment
variables they set themselves (the customer page,
`/docs/integrations/vercel`, says how).

## What a Vercel customer experiences

1. In the Vercel dashboard they open **Integrations → Browse Marketplace**,
   find OneUptime under **Observability** and install it, accepting
   OneUptime's terms. Vercel calls **Upsert Installation**: OneUptime records
   the installation (`VercelMarketplaceInstallation`) and keeps the access
   token Vercel gives it, encrypted. The token never expires.
2. They add a **resource**: a name, a plan (Free, Growth or Scale) and two
   settings, both on by default - **Monitor production domains** and
   **Create a status page**. Vercel calls **Provision Resource**. OneUptime
   makes a project for it, owned by the Vercel user who added it (found or
   made by their verified email address), billed through Vercel from the
   start; an ingestion key named `Vercel`; and a public status page. The
   answer carries the resource's secrets.
3. They connect Vercel projects to the resource. Vercel gives each one the
   resource's secrets as environment variables: `OTEL_EXPORTER_OTLP_ENDPOINT`
   (`https://oneuptime.com/otlp`), `OTEL_EXPORTER_OTLP_HEADERS`
   (`x-oneuptime-token=<key>`), `OTEL_EXPORTER_OTLP_PROTOCOL`
   (`http/protobuf`) and `ONEUPTIME_TELEMETRY_INGESTION_KEY`. `@vercel/otel`
   reads the first three, so traces arrive at the next deployment.
4. Vercel sends the `integration-resource.project-connected` webhook with the
   project's production domain: OneUptime makes a website monitor for it and
   puts it on the resource's status page (`VercelMarketplaceConnection`
   remembers which monitor is the project's). A project with no production
   domain yet gets its monitor at its first production deployment
   (`deployment.succeeded`), from the domains Vercel's API lists.
5. On Pro and Enterprise they add log and trace drains from the integration.
   Vercel posts logs to `/telemetry/vercel/v1/logs` and OTLP traces to
   `/otlp/v1/traces`, each with the resource's ingestion key in
   `x-oneuptime-token`.
6. **Open in OneUptime** signs them in through `/identity/vercel/sso` and
   lands them in the resource's project: Vercel admins in its Admin team,
   the read-only roles in Members.
7. Every hour Vercel is sent the month's running totals; once a month ends it
   is sent the month's invoice, which it charges to the team's card.

Deleting a resource in Vercel deletes its project after its final usage is
billed. Uninstalling deletes every resource's project, sends the final
invoice and tells Vercel billing is finalized. Deleting the project in
OneUptime deletes the resource in Vercel. All three are what the user asked
for: Vercel tells its customers that uninstalling "removes all associated
products and their data".

## How it is built

The integration is OneUptime Cloud's, so its code lives in the enterprise
module, [ee/Server/CloudMarketplace](../../../../../ee/Server/CloudMarketplace)
(OneUptime Cloud runs the Enterprise image; the Community image has none of
it). The log drain is a product feature of every edition and stays in core,
with the signature check it shares with the webhooks,
[Vercel/VercelSignature.ts](Vercel/VercelSignature.ts).

| Piece                                                                                                                | Code                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider API Vercel calls (`/api/marketplace/vercel/v1/...`)                                                         | [API/VercelMarketplaceProviderAPI.ts](../../../../../ee/Server/CloudMarketplace/API/VercelMarketplaceProviderAPI.ts), [Vercel/VercelMarketplaceProvider.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplaceProvider.ts) |
| Who is calling: Vercel's OIDC token (RS256, `https://marketplace.vercel.com/.well-known/jwks`, audience = client ID) | [Vercel/VercelMarketplaceAuth.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplaceAuth.ts)                                                                                                                               |
| A resource: its project, key, status page, secrets; deprovisioning                                                   | [Vercel/VercelMarketplaceResources.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplaceResources.ts), [Vercel/VercelResource.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelResource.ts)                     |
| Plans (OneUptime's, from `SUBSCRIPTION_PLAN_*`)                                                                      | [Vercel/VercelMarketplacePlans.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplacePlans.ts)                                                                                                                             |
| Billing: running totals, invoices, uninstall                                                                         | [Vercel/VercelMarketplaceBilling.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplaceBilling.ts), job `Marketplace:VercelBilling`                                                                                        |
| The marketplace framework's adapter                                                                                  | [Vercel/VercelMarketplaceAdapter.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplaceAdapter.ts)                                                                                                                         |
| Calls OneUptime makes to Vercel                                                                                      | [Vercel/VercelMarketplaceAPI.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplaceAPI.ts)                                                                                                                                 |
| Webhooks (`x-vercel-signature`, HMAC-SHA1 with the client secret)                                                    | [Vercel/VercelMarketplaceWebhooks.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplaceWebhooks.ts)                                                                                                                       |
| Monitors of connected projects                                                                                       | [Vercel/VercelMarketplaceMonitors.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplaceMonitors.ts)                                                                                                                       |
| Sign-in from Vercel                                                                                                  | [API/VercelSignIn.ts](../../../../../ee/Server/CloudMarketplace/API/VercelSignIn.ts), [Vercel/VercelMarketplaceSignIn.ts](../../../../../ee/Server/CloudMarketplace/Vercel/VercelMarketplaceSignIn.ts)                                     |
| Log drain endpoint                                                                                                   | [App/FeatureSet/Telemetry/API/VercelLogDrain.ts](../../../../App/FeatureSet/Telemetry/API/VercelLogDrain.ts), its service and `Utils/VercelLogDrain.ts`                                                                                    |

A resource is a `MarketplaceSubscription` with `marketplace` `Vercel`:
`externalSubscriptionId` is the resource's ID (OneUptime makes it),
`externalCustomerId` the installation's ID (`icfg_...`), `externalPlanId` the
Vercel plan (`free`, `growth`, `scale`), and `details` what Vercel shows of it
(name, settings) and the ingestion key and status page made for it.

## Pricing: OneUptime's plans, billed in usage units

The plans the plans endpoint serves are OneUptime's own, read from
`SUBSCRIPTION_PLAN_*`: every plan with a list price (Free, Growth, Scale -
not Enterprise), each a resource-level **subscription** plan whose ID is the
plan's name lowercased. Each charges its per-user price, and on every plan
active monitors ($1 per monitor per month) and telemetry (per GB) as used -
the same prices as [oneuptime.com/pricing](https://oneuptime.com/pricing) and
the other marketplaces (see [RELEASING.md](RELEASING.md#pricing-the-same-prices-as-oneuptimecom-in-usage-units)).

So **every plan needs a payment method** in Vercel (`paymentMethodRequired:
true`), the Free plan too: a project on the Free plan with no payment method
cannot send telemetry or make an active monitor on OneUptime Cloud, which
would leave a Vercel customer with nothing the listing promises. A free
allowance for Vercel customers would be a pricing decision: none exists.

Renaming a plan in `SUBSCRIPTION_PLAN_*` changes its Vercel plan ID, and
resources on the old ID would no longer name a plan: keep the names.

The hourly usage report prices each resource's project and writes the hour
down as a `MarketplaceUsageReport` in usage units of $0.01; the Vercel
adapter accepts it at once. From those reports, `Marketplace:VercelBilling`
(a quarter past every hour):

- sends each installation's **running totals** for the current month (Submit
  Billing Data: the billing lines, and the users, active monitors and
  telemetry spend of each resource). Vercel shows them; they charge nothing.
  An installation with no resources is sent none;
- sends the **invoice** of a month once it has ended and its last hour has
  been reported (two hours after midnight UTC), with `externalId`
  `oneuptime-<installation>-<YYYY-MM>`, so an invoice sent again is
  recognised (409) and not charged twice. Each resource has one line per
  kind of charge and plan - users, active monitors, telemetry, balance
  top-ups - at price `0.01` and quantity = usage units. The units are the
  reports' own, shared out to the kinds of charge by largest remainder, so
  the lines add up to exactly what the reports billed. A month with nothing
  billed sends no invoice; Vercel does not send invoices under $0.50 anyway;
- after an uninstall, sends the **final invoice** (`final: true`,
  `oneuptime-<installation>-final`) once every resource's project is
  deleted, then calls Finalize Billing.

Vercel collects the payment and handles tax and VAT. Its fees and payout
terms are in the Integrations Agreement accepted in the Integration Console;
they are not published - a maintainer reads them there.

**Trials:** nothing is billed while the project's plan is in its trial, as
on card billing.

**Not paying:** Vercel retries a failed charge (`marketplace.invoice.notpaid`)
for 15 days. When the invoice is `overdue`, OneUptime suspends the team's
resources - their projects are unpaid: not served, data kept - and tells
Vercel each resource changed. Paying it (`marketplace.invoice.paid`) brings
them back. Nothing is deleted for not paying (Vercel requires at least 15
days before anything destructive; OneUptime does nothing destructive at all).

## The settings OneUptime needs

| Environment variable               | Helm value                                                                   | What it is                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `VERCEL_MARKETPLACE_CLIENT_ID`     | `cloudMarketplace.vercel.clientId`                                           | The integration's client ID (`oac_...`), on its Credentials page. The audience of every token Vercel signs for OneUptime. |
| `VERCEL_MARKETPLACE_CLIENT_SECRET` | `cloudMarketplace.vercel.clientSecret` (or `existingSecret.clientSecretKey`) | Its client secret. Verifies webhooks and drain deliveries, and exchanges sign-in codes.                                   |

Both must be set, on OneUptime Cloud (`BILLING_ENABLED=true`), for Vercel to
be offered; with either missing, every Vercel route answers 404 and nothing
else changes. The app and the worker read them (the worker runs the billing
job; the app the provider API, the sign-in, the webhooks and the drain).

**Rotating the client secret** (the console's **Rotate Secret**): Vercel signs
with the new secret at once, so deploy the new value right after; webhooks
refused in between (401) are retried by Vercel for 24 hours. A drain
delivery refused in between is lost.

## The Integration Console (paste-ready)

Create the integration in **Dashboard → Integrations → Integrations
Console → Create**, as the team that will own it. It exists: `oneuptime`,
on the Vercel team `one-uptime`, made on 19 October 2026 (see
[History](#history)). The team was on the Hobby plan, which was enough to
create it.

Until Vercel approves the provider application, the console has no Base URL,
Redirect Login URL or Products: the rows and the [Product](#product) section
marked _after approval_ wait for it.

### Integration

| Field                            | Value                                                                                                                                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                             | OneUptime                                                                                                                                                                                                                                                                                            |
| URL Slug                         | `oneuptime` (if free; the listing is `vercel.com/integrations/<slug>`)                                                                                                                                                                                                                               |
| Developer                        | HackerBay, Inc.                                                                                                                                                                                                                                                                                      |
| Contact email                    | `vercel-marketplace@oneuptime.com` (private)                                                                                                                                                                                                                                                         |
| Support contact email            | `support@oneuptime.com` (public)                                                                                                                                                                                                                                                                     |
| Short Description (≤ 40)         | `Uptime, logs, traces and status pages`                                                                                                                                                                                                                                                              |
| Category                         | Observability                                                                                                                                                                                                                                                                                        |
| Website                          | `https://oneuptime.com`                                                                                                                                                                                                                                                                              |
| Documentation URL                | `https://oneuptime.com/docs/integrations/vercel`                                                                                                                                                                                                                                                     |
| EULA URL                         | `https://oneuptime.com/legal/terms`                                                                                                                                                                                                                                                                  |
| Privacy Policy URL               | `https://oneuptime.com/legal/privacy`                                                                                                                                                                                                                                                                |
| Support URL                      | `https://oneuptime.com/support`                                                                                                                                                                                                                                                                      |
| Redirect URL                     | `https://oneuptime.com/docs/integrations/vercel` until the approval. The console wants either a Redirect URL or the Base URL and Redirect Login URL, and offers those only after the approval. Then clear it: OneUptime has no connectable-account (OAuth) flow, and the checklist says to remove it |
| Base URL                         | `https://oneuptime.com/api/marketplace/vercel` (_after approval_)                                                                                                                                                                                                                                    |
| Redirect Login URL               | `https://oneuptime.com/identity/vercel/sso` (_after approval_)                                                                                                                                                                                                                                       |
| Webhook URL                      | `https://oneuptime.com/api/marketplace/vercel/webhook`                                                                                                                                                                                                                                               |
| Configuration URL                | Leave empty                                                                                                                                                                                                                                                                                          |
| Import Resource URL              | Leave empty                                                                                                                                                                                                                                                                                          |
| Installation-level Billing Plans | **Off**: plans are per resource (_after approval_)                                                                                                                                                                                                                                                   |
| Visibility                       | **Private** while testing: the Marketplace page answers 404, and only the owning team and the **Allowed Teams** (5 at most) see it. Public at go-live                                                                                                                                                |

**Overview (≤ 768 characters):**

```text
OneUptime is one observability platform for your Vercel projects: uptime monitoring, status pages, on-call, incidents, logs, traces and metrics, built on OpenTelemetry. Add a OneUptime resource and connect your projects: they get the OpenTelemetry settings @vercel/otel reads, so traces arrive with no setup; a log drain and a trace drain send Vercel's own logs and spans; and each project's production domain gets an uptime monitor on a status page. Sign in with Vercel and pay on your Vercel invoice, at the prices on oneuptime.com/pricing.
```

**Extended Description (≤ 240 characters):**

```text
Uptime monitoring, status pages, on-call, incidents, logs, traces and metrics for your Vercel projects, built on OpenTelemetry. Sign in with Vercel and pay on your Vercel invoice.
```

**Additional information (≤ 1,024 characters):**

```markdown
**What's billed**: the plan's price per user, $1 per active monitor per month, and telemetry per GB, at the prices on oneuptime.com/pricing. Nothing is billed during the plan's trial. Every plan needs a payment method in Vercel, the Free plan included, because monitors and telemetry are billed as you use them.

**Drains**: log and trace drains need Vercel's Pro or Enterprise plan, and Vercel bills the data they send. Traces from @vercel/otel work on every plan.

**Docs and support**: https://oneuptime.com/docs/integrations/vercel, and support@oneuptime.com.
```

**API Scopes:**

| Scope                      | Access     | Why                                                                                                               |
| -------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Integration Configuration  | Read       | The least the console allows                                                                                      |
| Integration Resource       | Read/Write | The installation token's resource calls: updating a resource's secrets, deleting a resource, resource events      |
| Projects (`project`)       | Read       | The production domain of a project connected before it had one (`GET /v9/projects/{id}/domains`), for its monitor |
| Deployments (`deployment`) | Read       | The deployment webhooks                                                                                           |
| Everything else            | None       |                                                                                                                   |

**Webhook events:** tick `deployment.succeeded`, `deployment.promoted`,
`deployment.ready`, `integration-resource.project-connected`,
`integration-resource.project-disconnected` and
`marketplace.member.changed`. Vercel subscribes every integration to
`marketplace.invoice.*`, `integration-configuration.removed` and
`deployment.integration.action.*` itself, and they cannot be turned off.
Turn on the permission that adds `userEmail` to `marketplace.member.changed`
where the console offers it; it was not in the console on 19 October 2026,
before the approval. Without it, someone who leaves the Vercel team stays
in its OneUptime projects until a project admin removes them.

**Credentials:** the client ID and secret are `VERCEL_MARKETPLACE_CLIENT_ID`
and `VERCEL_MARKETPLACE_CLIENT_SECRET`. Store them in the production
secrets, never in a file in the repository.

**Logo:** 1:1, non-transparent PNG, at least 256 px, readable in light and
dark mode. Source: `packages/Home/Static/img/OneUptimePNG/`. **Feature media:**
1 to 8 images, 16:9, 1920×1080, non-transparent PNG, each a real product
component with a description (not a full-window screenshot); the first one
becomes the listing's Open Graph image. A maintainer approves every image.

On the listing since 19 October 2026: the full OneUptime logo on white, and
five images captured that day from test.oneuptime.com and the live
status.oneuptime.com, each a page cropped below the app's header, with a
caption. In order: the status page (the Open Graph image), metrics, logs,
traces, trace insights. To make new ones, capture at 1440×810 CSS pixels at
2× and frame them at 1920×1080. Use a project whose data shows nothing
private: the test project's top log error carried a person's email address.

### Product

| Field                                  | Value                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Name                                   | OneUptime                                                                       |
| URL Slug                               | `oneuptime` (the product ID Vercel sends; OneUptime records it, whatever it is) |
| Short Description                      | `Uptime, logs, traces and status pages`                                         |
| Short Billing Plans Description (< 30) | `Free, Growth and Scale`                                                        |
| Disable Resource Renaming              | Off: a rename renames the project                                               |
| Global Config Support                  | Off                                                                             |
| Checks API                             | Off (not built - see [Known gaps](#known-gaps))                                 |
| Deployment Actions                     | None                                                                            |

**Metadata Schema** (check it in the Preview Form):

```json
{
  "type": "object",
  "properties": {
    "monitorProductionDomains": {
      "type": "boolean",
      "ui:control": "toggle",
      "ui:label": "Monitor production domains",
      "ui:description": "A website monitor for the production domain of each Vercel project you connect, on the status page. Each is an active monitor, at $1 per month.",
      "default": true
    },
    "createStatusPage": {
      "type": "boolean",
      "ui:control": "toggle",
      "ui:label": "Create a status page",
      "ui:description": "A public status page for this resource, showing those monitors.",
      "default": true,
      "ui:read-only": "update"
    }
  },
  "ui:order": ["$resourceName", "monitorProductionDomains", "createStatusPage"],
  "additionalProperties": false,
  "required": []
}
```

A status page is only made when the resource is, so its setting is read-only
afterwards. Turning **Monitor production domains** on later makes the
monitors still missing; turning it off makes no new ones (existing ones stay).

**Log Drain Settings:** Enabled; Delivery Format **JSON**; Endpoint
`https://oneuptime.com/telemetry/vercel/v1/logs`; one header,
`x-oneuptime-token` = `{{ONEUPTIME_TELEMETRY_INGESTION_KEY}}`.

**Trace drain settings** (where the console offers them; the API calls them
`protocols.traceDrain`): Endpoint `https://oneuptime.com/otlp/v1/traces`
(the full path: Vercel does not append `/v1/traces`); format **Proto**; the
same header.

**Snippets** (up to 6):

```ts title="instrumentation.ts"
import { registerOTel } from "@vercel/otel";

export function register(): void {
  registerOTel({ serviceName: "your-project" });
}
```

```bash title=".env.local"
OTEL_EXPORTER_OTLP_ENDPOINT={{OTEL_EXPORTER_OTLP_ENDPOINT}}
OTEL_EXPORTER_OTLP_HEADERS={{OTEL_EXPORTER_OTLP_HEADERS}}
OTEL_EXPORTER_OTLP_PROTOCOL={{OTEL_EXPORTER_OTLP_PROTOCOL}}
```

**Billing plans** come from the plans endpoint
(`GET /v1/products/{slug}/plans`): nothing to type.

**A Marketplace template** is required by the checklist: a Next.js starter
with `@vercel/otel` and a Deploy Button whose `stores` / `products`
parameter names this integration and product. It lives in a repository of
its own, which a maintainer creates.

## Going live

1. **Apply** (maintainer) at
   [vercel.com/marketplace/program](https://vercel.com/marketplace/program#become-a-provider):
   company name, contact, email, website, then the product, the use case,
   marketing, users, the pricing page and AI. Vercel reviews and gets in
   touch; it opens a shared Slack channel `#shared-<company>`. _Done on
   19 October 2026._
2. **Create the integration** in the Integration Console as above, from the
   Vercel team that will own it, accepting Vercel's Integrations Marketplace
   Agreement (maintainer). Share the team ID and the integration's URL slug
   with Vercel in the shared channel, as Vercel asks. _Done on 19 October
   2026, Private, with the placeholder Redirect URL._
3. **After the approval**, set the Base URL and Redirect Login URL, clear
   the Redirect URL, and add the [Product](#product).
4. **Deploy the settings** to production and check:
   `curl -s -o /dev/null -w '%{http_code}' https://oneuptime.com/api/marketplace/vercel/v1/products/oneuptime/plans`
   answers `403` (it wants Vercel's token: the route is live) rather than
   `404` (not configured).
5. **Ask Vercel to turn on** what only it can for a test integration first:
   secrets rotation (Request Secrets Rotation is implemented), and anything
   else it gates.
6. **Test while it is Private**, from the owning team or a test team added
   under **Allowed Teams**, through the [testing checklist](#testing-checklist).
7. **Email integrations@vercel.com** to ask for the review - a maintainer's
   decision. Vercel gives feedback, then a final walkthrough call.

## Testing checklist

From Vercel's approval checklist, with what to look at in OneUptime (the
master-admin API: `/api/vercel-marketplace-installation`,
`/api/vercel-marketplace-connection`, `/api/marketplace-subscription`,
`/api/marketplace-usage-report`). The installation's access token is never
served, to a master admin either: only the server reads it.

- [ ] Install as a new Vercel user, as an existing OneUptime user, and while
      signed out of Vercel. A `VercelMarketplaceInstallation` row is
      `Active`, with the team's name and contact.
- [ ] Add a resource on each plan. A `MarketplaceSubscription` row
      (marketplace `Vercel`) is `Active` with the project; the project is
      billed through Vercel Marketplace (**Project Settings → Billing**); the
      `Vercel` ingestion key and the status page exist. The Preview Form
      renders the metadata schema.
- [ ] Connect a project: the four environment variables are there, for the
      environments chosen; after a deployment, `@vercel/otel` traces arrive.
      The website monitor is made and on the status page.
- [ ] Connect a project with no production deployment yet; deploy it to
      production: the monitor is made then.
- [ ] Add a log drain and a trace drain from the integration: logs arrive
      under the Vercel project's name, traces with Vercel's spans. Check one
      delivery's `x-vercel-signature` was accepted (the drain shows healthy
      in Vercel) - see the open questions.
- [ ] **Open in OneUptime** from the resource, from its links and from the
      support link, as an admin and as a viewer of the team: signed in, in
      the Admin or Members team, on the right page.
- [ ] Rename the resource, change its plan in Vercel, and change the plan in
      OneUptime: the project, the purchase's `externalPlanId` and Vercel's
      view of the resource follow.
- [ ] Usage shows on the resource in Vercel within an hour.
- [ ] An invoice: Vercel's test mode (`test` on Submit Invoice) is not used
      by the code. Test a real one on a test team at the start of a month,
      watch `marketplace.invoice.created` and `.paid`, then refund it.
- [ ] `notpaid` and `overdue`: the projects stay served through `notpaid`,
      are suspended on `overdue`, and come back on `paid`.
- [ ] Delete a resource: its project is deleted after a final usage report;
      the connected projects lose the variables at their next deployment.
- [ ] Uninstall: every project deleted, the final invoice sent, Finalize
      Billing called; the installation is `Deleted` with no token.
- [ ] Delete a resource's project in OneUptime: the resource is deleted in
      Vercel.
- [ ] Edge cases: two installs at once, a provisioning retried (the same
      `Idempotency-Key` gives the same resource), reinstalling (a new
      installation ID, a new installation row).

## Operating it

- **Jobs:** `Marketplace:ReportUsage` (hourly, a minute past) prices the
  projects; `Marketplace:VercelBilling` (a quarter past) sends running
  totals and invoices, finishes uninstalls, and deletes the projects of
  ended resources a failed delete left behind.
- **Where things are:** installations in `VercelMarketplaceInstallation`
  (`invoicedUntil` is where the next invoice starts; `lastBillingError` why
  Vercel last refused, cleared once a run goes through), resources in
  `MarketplaceSubscription`, connected projects in
  `VercelMarketplaceConnection`, every billed hour in
  `MarketplaceUsageReport`. All master-admin only.
- **Revenue at risk is logged loudly:** a final invoice that could not be
  sent within Vercel's 24 hours is logged with "was NOT billed".
- **A month's invoice Vercel refuses** is tried again every hour, and the
  installation's `lastBillingError` says why. Nothing moves on until it is
  accepted, so no month is skipped.
- **A webhook OneUptime could not act on** (Vercel's API unreachable) is
  answered 503, and Vercel delivers it again for up to 24 hours.
- **The provider API's log** is in the Integration Console's **View Logs**.

## Known gaps

- **Checks API / deployment checks** are not built: OneUptime could run its
  monitor against a preview deployment and block a bad one.
- **Refunds** are not automated: refund through Vercel (partner support, or
  the invoice actions API with the installation's token).
- **Resource transfers** (Claim Deployments), the **REPL** and prepayment
  plans are not implemented: their endpoints answer 404.
- **Linking a resource to an existing OneUptime project** is not offered:
  each resource is a new project.
- **Members who leave** the Vercel team are taken out of its projects only
  when Vercel sends their email address (a console permission).

## Open questions for Vercel (shared Slack channel)

Each was unconfirmed in Vercel's docs on 18 October 2026; the code's choice
is in brackets.

1. Are a native integration's drains signed with the integration's client
   secret? [Yes: the drain endpoint takes deliveries signed with it, or with
   the ingestion key a hand-made drain sends.] Is the HMAC over the
   compressed body when gzip is on? [Both are checked.]
2. Does `{{ONEUPTIME_TELEMETRY_INGESTION_KEY}}` in the drain header resolve
   to the resource's secret by its name, and is it re-resolved after a
   secrets rotation? [Assumed.]
3. The trace drain's console settings, and whether Vercel appends a path.
   [The full `/otlp/v1/traces` URL is configured.]
4. Must `marketplace.*` and `integration-resource.*` webhooks be ticked in
   the console? [Tick them where offered.]
5. Does a `resource.updated` event make Vercel read the resource's plan
   again after a plan change in OneUptime? [Assumed.]
6. Invoice lines with price `0.01` and a quantity in usage units: acceptable
   on Vercel's invoices? [Yes, as on the other marketplaces.]
7. Fees and payout terms of the Integrations Agreement.
8. Must a provider's team be on the Pro plan? [The integration was made on
   a Hobby team, and the console allowed it.]
9. Does Vercel take a month's invoice lines for a resource deleted during
   that month, by the deleted resource's ID? [Assumed: its usage up to the
   deletion is on the month's invoice. If Vercel refuses the lines, the
   invoice fails and is retried each hour, and `lastBillingError` on the
   installation says why.]
10. Does the approval make the existing integration native, keeping its
    client ID and secret? [Assumed: the native fields appear on it.]

## History

Add a row for every submission, approval, rejection and go-live.

| Date       | What happened                                                                                                                                            | Who            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 2026-10-19 | Marketplace provider application submitted: HackerBay, Inc., contact `vercel-marketplace@oneuptime.com`                                                  | Nawaz Dhandala |
| 2026-10-19 | Integration `oneuptime` made on the team `one-uptime`, Private, Integrations Marketplace Agreement accepted, placeholder Redirect URL until the approval | Nawaz Dhandala |
| 2026-10-19 | Featured images: five captures from test.oneuptime.com and status.oneuptime.com                                                                          | Nawaz Dhandala |

## Notes for agents driving the browser

- Work in the maintainer's own signed-in Vercel session. Never create Vercel
  accounts or teams, and never type passwords, tax IDs, bank details or card
  numbers: stop and ask the maintainer.
- Never accept an agreement, rotate the client secret, or press **Submit**,
  **Publish** or anything that makes the integration public without the
  maintainer's go-ahead for that exact action, in chat.
- The client secret is shown once: hand it to the maintainer for the
  production secrets, never paste it into a file in the repository.
- The maintainer uploads files (the logo, featured images): the browser
  tools cannot choose a file. Put the file where they can drag it in.
- The featured images reorder only by a press-and-hold drag, which neither
  an agent's drag nor the keyboard sets off. Ask the maintainer to drag them,
  or have them uploaded one at a time in the order wanted: each upload goes
  at the end, and a multi-file upload can arrive reversed.
- The Browser pane's screenshots are scaled down. For listing images, drive a
  separate Chrome with a throwaway profile the maintainer signs in to, and
  capture at an exact size.
