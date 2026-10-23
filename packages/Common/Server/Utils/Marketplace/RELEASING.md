# Publishing OneUptime Cloud on cloud marketplaces

This is the runbook for maintainers and AI agents who list **OneUptime Cloud**
(`https://oneuptime.com`) on **AWS Marketplace**, **Microsoft Marketplace**
(Azure) and **Google Cloud Marketplace**, set up the integration each listing
needs, and keep it running. Follow the repository's
[AGENTS.md](../../../../../AGENTS.md) as well.

It does not cover self-hosted OneUptime Enterprise, which the same
marketplaces sell as a Kubernetes application billed per user-hour: see
[SELF_HOSTED_RELEASING.md](SELF_HOSTED_RELEASING.md). OneUptime Cloud is also
a native integration on the Vercel Marketplace, billed by the same hourly
usage report and invoiced through Vercel: see
[VERCEL_RELEASING.md](VERCEL_RELEASING.md). Every setting in this guide is
ignored unless billing is enabled (`BILLING_ENABLED=true`, OneUptime Cloud
only).

The integration's code is OneUptime Cloud's, so it lives in the enterprise
module: [ee/Server/CloudMarketplace](../../../../../ee/Server/CloudMarketplace)
(the routes, the adapters, the purchases, the hourly usage report and the
jobs; OneUptime Cloud runs the Enterprise image). The Community image has none
of it. What every edition uses stays next to this guide: the HTTP client
([MarketplaceHttp.ts](MarketplaceHttp.ts)) and the token verifier
([RemoteJwtVerifier.ts](RemoteJwtVerifier.ts)) Sign in with Microsoft is built
on.

Written on **16 October 2026**, together with the integration code, before any
listing existed. Nothing in this guide had been submitted to any marketplace
yet. When you do something below, add it to [History](#history), and recheck
the live state before acting: the portals change their wording and steps.

## What a buyer experiences

1. They find OneUptime on the marketplace and subscribe. The marketplace bills
   them on their cloud bill; there is no card and no OneUptime invoice.
2. The marketplace sends them to OneUptime with a token:
   - AWS: their browser POSTs `x-amzn-marketplace-token` to the fulfillment URL;
   - Azure: their browser opens the landing page with `?token=`;
   - Google Cloud: their browser POSTs a signed JWT, `x-gcp-marketplace-token`,
     to the sign-up URL.
3. OneUptime resolves the token with the marketplace at once, records the
   purchase (`MarketplaceSubscription`), and sends the browser to
   **/accounts/marketplace** carrying a one-use claim token in an HttpOnly
   cookie (never in a URL). A Microsoft buyer who is not signed in goes through
   **Sign in with Microsoft** on the way.
4. If they are not signed in, they sign in or sign up (any method). Every
   sign-in ends on the dashboard, which sends them back to the purchase page.
5. They choose an existing project of theirs (they must be its owner or manage
   its billing) or name a new one and pick a plan. OneUptime activates the
   purchase on the marketplace (Azure: Activate; Google Cloud: approve the
   account and its orders; AWS: confirm the agreement is active) and moves the
   project's billing to the marketplace. A project that was paying by card has
   its card subscriptions cancelled with one final invoice for what they
   already owe.
6. From then on, every hour, OneUptime reports what the project used to the
   marketplace, and follows the purchase: suspended on the marketplace means
   unpaid in OneUptime (service stops, data kept); cancelled means cancelled.

Coming back later from the marketplace's "manage" / "set up account" link takes
them straight to the project's Billing page.

Deleting the project ends OneUptime's billing of it, after one last report for
what it used since the last hourly one. The purchase itself stays active on the
marketplace until they cancel it there; the project's Danger Zone page tells
them so before they delete it.

## Public listings

Where buyers find OneUptime Cloud, as each marketplace links it. Microsoft's
addresses carry the publisher ID Partner Center has for HackerBay,
`oneupitme` (spelled so, and permanent), before the offer ID.

| Marketplace  | Listing                                                                                                                      | Seen public |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------- |
| AWS          | `https://aws.amazon.com/marketplace/pp/prodview-ttfnc3eqofayw` (product `prod-unn56dxklr4mw`, seller `seller-d3b2fafj4knc2`) | 2026-10-21  |
| Microsoft    | `https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-cloud` (offer `oneuptime-cloud`)                        | 2026-10-21  |
| Google Cloud | Not public yet                                                                                                               |             |

The website shows them, from
[packages/Home/Utils/CloudMarketplaces.ts](../../../../Home/Utils/CloudMarketplaces.ts):
the Resellers page's "Buy through your cloud marketplace" section
(`/resellers#cloud-marketplaces`) and a line under the plans on `/pricing`.
A listing that is not public there says "Coming soon". When a listing goes
public, put its address in that file as well as here, exactly as the
marketplace links it.

## Pricing: the same prices as oneuptime.com, in usage units

Every marketplace listing has **one public pay-as-you-go plan** and **one
metered dimension**, `usage_units`, priced at **USD 0.01 per unit**.
OneUptime reports each hour's charges as whole units:

| What                                 | Price                                                       | Where it comes from                                                    |
| ------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Users (seats) of the project's plan  | The plan's monthly per-user price, accrued by the hour      | `SUBSCRIPTION_PLAN_*` monthly amount (Growth, Scale...). Free is free. |
| Active monitors                      | USD 1 per monitor per month, accrued by the hour            | `ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH`                                |
| Telemetry (logs, traces, metrics...) | USD 0.10 per GB per 15 days of retention (session replay 2) | The daily telemetry staging (`TelemetryUsageBilling`)                  |

**Trials:** nothing is billed while the project is in its plan's trial - not
its users, its monitors or its telemetry - exactly as on card billing, where the
plan and its usage trial together.

The buyer chooses their OneUptime plan inside OneUptime (on the purchase page,
then **Project Settings > Billing > Change Plan**, which needs no card for a
marketplace project), exactly as a card customer does. Changing the price list
on oneuptime.com changes what marketplace customers pay with no marketplace
change. The fraction of a cent left over each hour is carried to the next
report, so nothing is rounded away.

The code is [MarketplaceUsageCalculator.ts](../../../../../ee/Server/CloudMarketplace/MarketplaceUsageCalculator.ts) and
[MarketplaceUsageReporter.ts](../../../../../ee/Server/CloudMarketplace/MarketplaceUsageReporter.ts).

**Enterprise deals** are private offers on the marketplace (AWS, Azure and
Google Cloud all support them) - usually a discount on the unit price. For a
deal whose fee the marketplace already charges in full (a flat yearly fee with
usage included), a master admin sets `isUsageMetered` to false on the
purchase's `MarketplaceSubscription` row so OneUptime reports nothing for it,
and moves the project to the Enterprise plan from the Admin Dashboard.

**Balance top-ups** - the SMS, call, WhatsApp and Telegram balance and OneUptime
AI credits, by hand or by Auto Recharge - are billed through the marketplace
too, while the purchase is active there: each is recorded as a
`MarketplaceCharge` and billed with the next hourly usage report, in the same
usage units ([MarketplaceChargeService](../../Services/MarketplaceChargeService.ts)).
Never as a record of its own: Microsoft Marketplace takes one usage event per
hour per dimension. A top-up is billed during a plan's trial, and on a purchase
whose usage is not metered (`isUsageMetered` false), whose hourly report then
carries only top-ups. While the purchase is suspended or cancelled, a top-up is
refused and the owners are told to put the subscription right.

**What customers see:** the project's **Settings > Billing** page shows what each
of the last three months of its marketplace bill was made of - users, active
monitors, telemetry and top-ups (`GET /api/marketplace/usage`, read by the
people who read the project's usage history).

## Before you start: decisions and facts that are the business's

Agents: these are maintainer decisions and company facts. Never guess them,
never type banking or tax details, and never press a final publish / go live /
submit button without a maintainer's explicit go-ahead in chat.

- **The integration does not depend on where OneUptime Cloud runs; the
  Google listing does.** OneUptime Cloud runs on Google Cloud today and is
  moving to OneUptime's own data centre; the `oneuptime-k8s` Google Cloud
  project will be deleted. The integration only calls the marketplaces' APIs
  over the internet, so it works from anywhere, and the listings must not
  claim a cloud OneUptime will not be on:
  - **Google Cloud Marketplace** lists only products "hosted primarily on
    Google Cloud". Google checks this against its approved hosting patterns
    during onboarding, and a change that affects it must be reported to
    Google for re-review
    ([requirements](https://docs.cloud.google.com/marketplace/docs/partners/get-started)).
    OneUptime qualifies while it runs fully on Google Cloud. **Before the
    move**, a maintainer decides between keeping the listing eligible under
    Google's "storage and backup on Google Cloud" pattern (the application
    may run elsewhere, but all customer data must replicate to Google Cloud)
    and telling Google and withdrawing the listing. The listing lives in a
    Google Cloud project of its own (`oneuptime-marketplace`), never in
    `oneuptime-k8s`. Whether a purchase counts toward a buyer's Google Cloud
    commitment is Google's rule for the product, not something to promise in
    the listing.
  - **AWS Marketplace** lists SaaS hosted anywhere (since May 2025). Only
    products deployed on AWS get the "Deployed on AWS" badge and count toward
    a buyer's AWS spend commitment, so OneUptime's listing has neither.
  - **Microsoft Marketplace** requires a transactable SaaS offer to be
    "primarily platformed on Azure" to be **purchasable in the Azure portal**
    and Azure-benefit (MACC) eligible, so OneUptime's is neither. A SaaS not
    on Azure can still be listed and sold on Microsoft Marketplace if it
    integrates with or extends a Microsoft product (OneUptime's Microsoft
    Teams app and Sign in with Microsoft) - certification policy 1000.1.
    Expect the reviewer to ask.
- **Fees:** each marketplace keeps a share of every sale (about 3% for SaaS on
  all three at the time of writing - check each marketplace's current terms).
- **Company facts** (from the Slack and Teams guides): **HackerBay, Inc.**,
  United States; terms `https://oneuptime.com/legal/terms`; privacy
  `https://oneuptime.com/legal/privacy`; sub-processors
  `https://oneuptime.com/legal/subprocessors`; support
  `https://oneuptime.com/support`.
- **Who does what:** seller registration, tax interviews (W-9), bank accounts,
  identity verification, agreements and the final publish are done by a
  maintainer, in their own accounts. Everything else here an agent can prepare.

## Listing content (paste-ready)

Use the same copy on all three, trimmed to each field's limit. Screenshots,
logo and video are listed after.

**Name:** OneUptime

**Short summary (≤ 100 characters):**

```text
Uptime monitoring, status pages, on-call, incidents, logs, traces and metrics in one platform.
```

**Description (≤ 3,000 characters):**

```text
OneUptime is one observability platform for the whole incident lifecycle - so
you stop paying for, and stitching together, a dozen separate tools.

- Uptime monitoring: websites, APIs, ping, ports, SSL certificates, DNS and
  synthetic browser checks from probes around the world.
- Status pages: branded public and private status pages with email, SMS and
  webhook subscribers.
- On-call and alerts: schedules, rotations and escalation policies, with
  alerts by SMS, phone call, push, email, Slack and Microsoft Teams.
- Incident management: declare, triage and communicate incidents, with
  timelines, runbooks and post-mortems.
- Observability: logs, traces, metrics, APM, error tracking, profiles and
  session replay, built on OpenTelemetry.
- OneUptime AI: finds the likely root cause of an incident and can open the
  fix as a pull request.

Buying through this marketplace bills OneUptime on your cloud bill, at the same
prices as oneuptime.com/pricing: your plan's per-user price, active monitors at
$1 per month, and telemetry per GB. Charges are reported every hour in usage
units of $0.01. Choose or change your plan (Free, Growth or Scale) anytime in
OneUptime. For Enterprise pricing and private offers, contact us at
https://oneuptime.com/enterprise/demo.

OneUptime is open source (Apache 2.0).
```

Add compliance certifications to the description only if a maintainer confirms
OneUptime holds them; never from guesswork.

**Getting started / fulfillment instructions (Azure requires this field):**

```text
1. After you subscribe, choose "Configure account" (Azure), "Set up your
   account" (AWS) or "Sign up with OneUptime" (Google Cloud).
2. Sign in to OneUptime, or create an account. On Microsoft Marketplace you can
   sign in with your Microsoft account.
3. Choose the OneUptime project this purchase pays for - one of yours, or a new
   one - and its plan.
Your project is now billed through the marketplace. Manage your plan in
OneUptime under Project Settings > Billing. Documentation: https://oneuptime.com/docs
```

**Keywords:** uptime monitoring, status page, on-call, incident management,
observability, APM, log management, OpenTelemetry.

**Usage dimension (all three):** ID `usage_units`; display name "Usage units";
unit "unit"; price USD 0.01; description:

```text
OneUptime usage in units of $0.01: your plan's per-user price, active monitors
and telemetry, at the prices on oneuptime.com/pricing, reported hourly.
```

**Media to prepare** (a maintainer approves every image):

- Logo: square PNG, 216-350 px for Azure (Azure makes the 48 and 90 px sizes),
  and whatever size each of the others asks for. Source:
  `packages/Home/Static/img/OneUptimePNG/`.
- Screenshots: at least 1, up to 5, **1280x720 PNG** with a caption each
  (Azure's rule; the others accept the same files). Real product screenshots of
  oneuptime.com: monitors, status page, on-call schedule, an incident, a trace.
- Optional video: YouTube or Vimeo link (Azure), a demo video for AWS.

## The settings OneUptime needs

Every value goes into OneUptime Cloud's configuration (Helm values for
production; `config.env` for docker compose). A marketplace is offered only
when all of its values are set; with any missing, its URLs answer "not
available here" and nothing else changes.

| Environment variable                                    | Helm value                                               | What it is                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `AWS_MARKETPLACE_ACCESS_KEY_ID`                         | `cloudMarketplace.aws.accessKeyId`                       | IAM user of the seller account (policy below)                                                 |
| `AWS_MARKETPLACE_SECRET_ACCESS_KEY`                     | `cloudMarketplace.aws.secretAccessKey`                   | Its secret key (or `existingSecret`)                                                          |
| `AWS_MARKETPLACE_PRODUCT_CODE`                          | `cloudMarketplace.aws.productCode`                       | The SaaS product's product code                                                               |
| `AWS_MARKETPLACE_EVENTS_SECRET`                         | `cloudMarketplace.aws.eventsSecret`                      | A long random string; the EventBridge connection sends it as `x-oneuptime-marketplace-secret` |
| `AZURE_MARKETPLACE_TENANT_ID`                           | `cloudMarketplace.azure.tenantId`                        | Entra tenant in the offer's Technical configuration                                           |
| `AZURE_MARKETPLACE_CLIENT_ID`                           | `cloudMarketplace.azure.clientId`                        | The single-tenant fulfillment app in the offer's Technical configuration                      |
| `AZURE_MARKETPLACE_CLIENT_SECRET`                       | `cloudMarketplace.azure.clientSecret`                    | Its client secret (or `existingSecret`)                                                       |
| `GOOGLE_CLOUD_MARKETPLACE_PROVIDER_ID`                  | `cloudMarketplace.googleCloud.providerId`                | Partner ID from Producer Portal                                                               |
| `GOOGLE_CLOUD_MARKETPLACE_SERVICE_ACCOUNT_KEY`          | `cloudMarketplace.googleCloud.serviceAccountKey`         | JSON key of the linked service account, raw or base64 (or `existingSecret`)                   |
| `GOOGLE_CLOUD_MARKETPLACE_SERVICE_NAME`                 | `cloudMarketplace.googleCloud.serviceName`               | Service Control service (Producer Portal, "Service domain")                                   |
| `GOOGLE_CLOUD_MARKETPLACE_USAGE_METRIC`                 | `cloudMarketplace.googleCloud.usageMetric`               | Full metric name of `usage_units`, exactly as Producer Portal shows it                        |
| `GOOGLE_CLOUD_MARKETPLACE_PUBSUB_SERVICE_ACCOUNT_EMAIL` | `cloudMarketplace.googleCloud.pubSubServiceAccountEmail` | The push subscription's authentication service account                                        |
| `GOOGLE_CLOUD_MARKETPLACE_SIGNUP_AUDIENCE`              | `cloudMarketplace.googleCloud.signupAudience`            | Optional; defaults to `HOST` (`oneuptime.com`)                                                |
| `GOOGLE_CLOUD_MARKETPLACE_PUBSUB_AUDIENCE`              | `cloudMarketplace.googleCloud.pubSubAudience`            | Optional; defaults to the push endpoint's URL                                                 |
| `MICROSOFT_SIGN_IN_CLIENT_ID`                           | `microsoftSignInApp.clientId`                            | Multi-tenant Sign in with Microsoft app (public)                                              |
| `MICROSOFT_SIGN_IN_CLIENT_SECRET`                       | `microsoftSignInApp.clientSecret`                        | Its client secret (or `existingSecret`)                                                       |

The URLs each marketplace asks for (production):

| Marketplace  | Field                       | URL                                                         |
| ------------ | --------------------------- | ----------------------------------------------------------- |
| AWS          | Fulfillment URL             | `https://oneuptime.com/api/marketplace/aws/register`        |
| AWS          | EventBridge API destination | `https://oneuptime.com/api/marketplace/aws/events`          |
| Azure        | Landing page URL            | `https://oneuptime.com/api/marketplace/azure/landing`       |
| Azure        | Connection webhook          | `https://oneuptime.com/api/marketplace/azure/webhook`       |
| Google Cloud | Sign-up URL                 | `https://oneuptime.com/api/marketplace/google-cloud/signup` |
| Google Cloud | Login URL                   | `https://oneuptime.com/accounts/login`                      |
| Google Cloud | Pub/Sub push endpoint       | `https://oneuptime.com/api/marketplace/google-cloud/events` |
| Microsoft    | Sign-in redirect URI        | `https://oneuptime.com/identity/microsoft/callback`         |

## Google Cloud Marketplace

The listing, its service account, its Pub/Sub subscription and its Service
Control service live in a Google Cloud project made for the listing,
`oneuptime-marketplace` - never `oneuptime-k8s`, which hosts OneUptime Cloud
today and will be deleted when OneUptime moves to its own data centre. Nothing
in the integration depends on where OneUptime Cloud runs, but Google's listing
rules do: see the hosting rule under
[Before you start](#before-you-start-decisions-and-facts-that-are-the-businesss).

1. **Become a Google Cloud Marketplace partner** (maintainer). Join the Google
   Cloud Partner Network (`https://partners.cloud.google.com`, "Create new
   account"; Google confirms by email within 48 hours), then accept the Cloud
   Marketplace agreements and set up the payments profile Producer Portal asks
   for. Onboarding includes Google's hosting review. Create the
   `oneuptime-marketplace` project (with a billing account that will outlive
   the move) and enable the Cloud Commerce Partner Procurement, Service
   Control, Pub/Sub and IAM APIs in it. Producer Portal is at
   `https://console.cloud.google.com/producer-portal?project=oneuptime-marketplace`;
   it may not load until the partner account is approved.
2. **Create the product**: a SaaS product, "integrated with Google Cloud"
   (Google Cloud bills it).
3. **Pricing**: usage-based, one metric, `usage_units`, unit "unit", USD 0.01
   per unit; no subscription fee; no free trial (OneUptime's own plan trial
   applies). Ask the Partner Engineer to create the Service Control service
   for it; Producer Portal then shows the **service name** and the **metric
   name** - those are `GOOGLE_CLOUD_MARKETPLACE_SERVICE_NAME` and
   `GOOGLE_CLOUD_MARKETPLACE_USAGE_METRIC`, copied exactly.
4. **Technical integration > Frontend**: sign-up URL and login URL from the
   table above; **Enable SSO login: No** (OneUptime has its own sign-in). The
   product's domain is `oneuptime.com` - the sign-up JWT's audience.
5. **Technical integration > Backend**: create one service account (for
   example `marketplace@oneuptime-marketplace.iam.gserviceaccount.com`) and link it in
   Producer Portal for the **Procurement API**, **Pub/Sub** and **Service
   Control** (grant it `roles/servicemanagement.serviceController` there).
   Create a JSON key for it: that is `GOOGLE_CLOUD_MARKETPLACE_SERVICE_ACCOUNT_KEY`.
   The partner ID on the same page is `GOOGLE_CLOUD_MARKETPLACE_PROVIDER_ID`.
6. **Pub/Sub push subscription** to the topic Producer Portal names (it is
   `projects/cloudcommerceproc-prod/topics/<partner ID>`), signed with an OIDC
   token for a push service account:

   ```bash
   gcloud iam service-accounts create marketplace-pubsub-push --project=oneuptime-marketplace
   gcloud pubsub subscriptions create oneuptime-marketplace-events \
     --project=oneuptime-marketplace \
     --topic=projects/cloudcommerceproc-prod/topics/<partner ID> \
     --push-endpoint=https://oneuptime.com/api/marketplace/google-cloud/events \
     --push-auth-service-account=marketplace-pubsub-push@oneuptime-marketplace.iam.gserviceaccount.com \
     --ack-deadline=60
   ```

   `GOOGLE_CLOUD_MARKETPLACE_PUBSUB_SERVICE_ACCOUNT_EMAIL` is that push service
   account. The subscription must be created by the service account linked for
   Pub/Sub (or a person with its permissions). If push deliveries are refused
   with 401 in OneUptime's logs, the Pub/Sub service agent
   (`service-<project number>@gcp-sa-pubsub.iam.gserviceaccount.com`) needs
   `roles/iam.serviceAccountTokenCreator` on the push service account.

7. **Deploy** the values (table above) to production and check
   `https://oneuptime.com/api/marketplace/google-cloud/signup` answers (a GET
   shows "Open OneUptime from Google Cloud Marketplace").
8. **Listing**: the copy and media above; support and legal links.
9. **Test** with Producer Portal's test flow before submitting: buy as a test
   customer, sign up, pick a project, then check (Admin Dashboard API or
   database) that a `MarketplaceSubscription` row is `Active` with a
   `usageReportingId`, and after the next hour a `MarketplaceUsageReport` is
   `Reported`. Change plan and cancel from the Google Cloud console and watch
   the row follow.
10. **Submit for review** - a maintainer's decision.

What OneUptime does with Google's events:
[GoogleCloudMarketplaceInbound.ts](../../../../../ee/Server/CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceInbound.ts).
New orders and plan changes are approved automatically (every plan bills the
same units); an order made before the buyer signed up is approved when they
finish the purchase page.

## AWS Marketplace

1. **Register as a seller** (maintainer) in the AWS Marketplace Management
   Portal (`https://aws.amazon.com/marketplace/management/`) with the AWS
   account that will own the listing: public profile, tax interview, bank
   account, identity verification. Sellers registered after **15 July 2026**
   get EventBridge events, not SNS - this integration uses EventBridge.
2. **Create a SaaS product**: Products > SaaS > Create SaaS product, pricing
   **"Usage-based pricing" (SaaS subscription)**, one dimension `usage_units`
   (details in [Listing content](#listing-content-paste-ready)), fulfillment
   URL from the table above. The product's **product code** is
   `AWS_MARKETPLACE_PRODUCT_CODE`. New products use concurrent agreements: a
   purchase is identified by AWS account ID and license ARN, which is what this
   code stores.
3. **IAM user** in the seller account for OneUptime (its access key is
   `AWS_MARKETPLACE_ACCESS_KEY_ID` / `AWS_MARKETPLACE_SECRET_ACCESS_KEY`):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "aws-marketplace:ResolveCustomer",
           "aws-marketplace:BatchMeterUsage",
           "aws-marketplace:DescribeAgreement"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

4. **Events** (us-east-1, in the seller account): an EventBridge rule on the
   default bus for `{"source": ["aws.agreement-marketplace"]}`, targeting an
   API destination with an API-key connection:

   ```bash
   aws events create-connection --region us-east-1 \
     --name oneuptime-marketplace \
     --authorization-type API_KEY \
     --auth-parameters '{"ApiKeyAuthParameters":{"ApiKeyName":"x-oneuptime-marketplace-secret","ApiKeyValue":"<AWS_MARKETPLACE_EVENTS_SECRET>"}}'
   aws events create-api-destination --region us-east-1 \
     --name oneuptime-marketplace-events \
     --connection-arn <connection ARN> \
     --invocation-endpoint https://oneuptime.com/api/marketplace/aws/events \
     --http-method POST \
     --invocation-rate-limit-per-second 10
   aws events put-rule --region us-east-1 \
     --name oneuptime-marketplace-agreements \
     --event-pattern '{"source":["aws.agreement-marketplace"]}'
   ```

   Then `aws events put-targets` with the API destination's ARN, a role
   EventBridge may assume with `events:InvokeApiDestination`, a retry policy
   (EventBridge retries for up to 24 hours) and an SQS dead-letter queue.

5. **Deploy** the values and check the fulfillment URL answers.
6. **Test** with the product in **limited** state, allow-listing the test
   buyer AWS accounts: subscribe, set up the account, pick a project; check the
   `MarketplaceSubscription` row (license ARN, AWS account ID, agreement ID,
   `Active`) and an hourly `MarketplaceUsageReport` `Reported` with a metering
   record ID. AWS reviews the integration from these calls.
7. **Request public visibility** - a maintainer's decision.

What OneUptime does with AWS's events:
[AwsMarketplaceInbound.ts](../../../../../ee/Server/CloudMarketplace/AWS/AwsMarketplaceInbound.ts). A purchase becomes
billable only once its agreement is `ACTIVE` (checked with DescribeAgreement,
never on the event's word); "License Deprovisioned" sends the last usage within
AWS's one-hour window, then cancels.

## Microsoft Marketplace (Azure)

OneUptime already has a Partner Center account and a Microsoft Entra tenant
(**HackerBay**, `oneuptimehq.onmicrosoft.com`) for its Microsoft Teams app -
see [the Microsoft Teams guide](../Workspace/MicrosoftTeams/RELEASING.md) for
the account and its gotchas. Use the same account.

1. **Marketplace program, payout and tax** (maintainer): in Partner Center,
   make sure the account is enrolled in the Microsoft Marketplace program and
   has a **payout profile** and **tax profile** - required to sell through
   Microsoft.
2. **Two Entra apps** in the HackerBay tenant:
   - **OneUptime Marketplace Fulfillment** - single tenant. Create a client
     secret. Register the marketplace API's service principal in the tenant
     once: `az ad sp create --id 20e940b3-4c77-4b0b-9a53-9e16a1b010a7`.
     Its tenant ID, client ID and secret are `AZURE_MARKETPLACE_TENANT_ID`,
     `AZURE_MARKETPLACE_CLIENT_ID`, `AZURE_MARKETPLACE_CLIENT_SECRET`. Do not
     enable public client flows.
   - **OneUptime Sign-in** - "Accounts in any organizational directory and
     personal Microsoft accounts", Web redirect URI
     `https://oneuptime.com/identity/microsoft/callback`, delegated
     `User.Read` only (anything needing admin consent would block buyers),
     optional ID token claims **`email`** and **`xms_edov`**, and a client
     secret: `MICROSOFT_SIGN_IN_CLIENT_ID` / `_SECRET`. This is what certifies
     policy 1000.3 (buyers sign in with the account they bought with). Without
     `xms_edov` every work or school account is refused, by design: an email
     address Microsoft does not vouch for is never matched to a OneUptime user.
     An existing OneUptime account whose address was never verified is sent a
     verification link instead of being signed in, as with Global OIDC; users
     with two-factor authentication, and master admins, sign in with their
     password. Do not reuse the Teams bot's app (`0e5480fd-...`) for either.
3. **New offer > Software as a Service** in Partner Center. Offer setup:
   **"Yes, I would like to sell through Microsoft and have Microsoft host
   transactions"** (this cannot be changed after publishing). Microsoft
   recommends a separate **DEV offer** for testing that is never taken live.
4. **Properties**: categories (monitoring / DevOps / IT management - pick the
   closest Microsoft offers), legal: OneUptime's own terms
   (`https://oneuptime.com/legal/terms`) or the Microsoft standard contract -
   a maintainer decides; it cannot be switched afterwards.
5. **Offer listing**: the copy and media above, privacy policy, support and
   engineering contacts (maintainer supplies names and phone numbers).
6. **Technical configuration**: landing page URL and connection webhook from
   the table above; tenant ID and **application ID of the fulfillment app**.
7. **Plans**: one public plan, **Pay as you go** (plan ID `pay-as-you-go`),
   pricing model **flat rate**, USD 0 per month, metered dimension
   `usage_units` (USD 0.01 per unit, 0 included), all markets OneUptime sells
   in. Metered billing is only available on flat-rate plans - which is why the
   plan is not per-user; OneUptime prices users itself. Auto activation off:
   OneUptime activates when the buyer has picked a project.
8. **Preview audience**: the testers' Microsoft accounts. Test in preview -
   buy, Configure account, Sign in with Microsoft, pick a project; change the
   plan and cancel from the Azure portal / Microsoft 365 admin center; check
   the `MarketplaceSubscription` row and the hourly `MarketplaceUsageReport`.
   Test purchases are billed; cancel within 72 hours for a refund.
9. **Review and publish**, then **Go live** - each a maintainer's decision.
   Microsoft certification checks the landing page, Sign in with Microsoft,
   and the webhook. Certification notes template below.

What OneUptime does with Microsoft's webhook calls:
[AzureMarketplaceInbound.ts](../../../../../ee/Server/CloudMarketplace/Azure/AzureMarketplaceInbound.ts). Each call's
bearer token is verified (issued by the offer's tenant, for the fulfillment
app, to the marketplace API's app), and the operation and subscription are read
back from the fulfillment API before anything changes, as Microsoft requires.
Plan and quantity changes and reinstatements are accepted. An unsubscription
first sends the usage since the last hourly report (best effort: if Microsoft
refuses it, the report is marked `Failed` and logged).

### Certification notes template (Microsoft)

```text
Landing page: https://oneuptime.com/api/marketplace/azure/landing (resolves the
purchase token, then signs the buyer in with Microsoft Entra ID - work, school
or personal accounts - and lets them choose the OneUptime project to bill).
Webhook: https://oneuptime.com/api/marketplace/azure/webhook (validates the
Entra bearer token and calls the operations API before acting; ChangePlan,
ChangeQuantity and Reinstate are acknowledged within seconds).
Metered billing: one dimension, usage_units ($0.01), emitted hourly.
Test steps: subscribe to the preview plan, select Configure account, sign in
with Microsoft, choose "Create a new project", select Set up purchase. The
project's Settings > Billing page then shows "Billed through Microsoft
Marketplace".
```

## Operating it

- **Where things are**: purchases in `MarketplaceSubscription`, reports in
  `MarketplaceUsageReport` (both master-admin only:
  `/api/marketplace-subscription`, `/api/marketplace-usage-report`).
- **Jobs**: `Marketplace:ReportUsage` (hourly, a minute past the hour) and
  `Marketplace:SyncPurchases` (daily; reads every purchase back from its
  marketplace so a missed webhook or event is caught within a day).
- **Revenue at risk is logged loudly**: a report the marketplace refuses for
  good, or that is not accepted within 23 hours, is marked `Failed` with
  "was NOT billed" in the log. Look at these: they are money not collected.
- **A webhook or event that cannot be acted on** (the marketplace's API
  unreachable) is answered 503, so the marketplace delivers it again.
- **Status**: a purchase's status drives the project's subscription status:
  Active -> active, Suspended -> unpaid (service stops, data kept), Cancelled
  -> cancelled. Nothing deletes a customer's project or data on its own, even
  when Google says the account was deleted.
- **A buyer who deletes their project**: before the project goes
  (`ProjectService.onBeforeDelete`), OneUptime bills what it used since the
  last hourly report - its users and active monitors for the part of the hour,
  its staged telemetry, and every top-up bought since - in one final report
  (`isFinal` in its breakdown;
  `MarketplaceUsageReporter.reportFinalUsageOfProject`). The delete waits for
  the report to be written, never for the marketplace: a report the
  marketplace does not take now stays `Pending`, and the hourly job sends it
  again, which needs only the report and its purchase, not the project. Then
  the purchase is unlinked: its `MarketplaceSubscription` row stays, still
  `Active`, with `projectId` empty, and no hourly report bills it again. It
  stays active on the marketplace until the buyer cancels it there - the
  Danger Zone page tells a marketplace customer so before they delete, as the
  Billing page's Cancel Plan card does - or links it to another project from
  the marketplace's link, whose billing starts at the new link.
- **One report per purchase and hour on AWS and Microsoft**: both bill the
  first usage record of a purchase in an hour and refuse any other as a
  duplicate, unbilled. Every report is filed a minute before its period ends
  (`MarketplaceUsageHour` in [MarketplaceAdapter.ts](../../../../../ee/Server/CloudMarketplace/MarketplaceAdapter.ts)):
  an hourly report in the hour it covers, a final one in the hour it ends in.
  An hourly report that would land in a final report's hour - after a project
  delete that failed, or a purchase linked again within the hour - waits for
  the next hour, and bills the whole time since. Google Cloud counts each
  report by its own ID, and is never held back. A report sent again is taken
  as it was the first time (AWS answers `Success`; Microsoft answers
  `Duplicate` with the event it kept, of the same quantity). One that lands in
  an hour where the marketplace already has a different record anyway (AWS
  `DuplicateRecord`; a Microsoft `Duplicate` whose kept event has another
  quantity) is marked `Failed` and logged as "was NOT billed".
- **Moving a marketplace customer back to card billing** is not built: today
  it is a master-admin job (clear `billingMarketplace`, give the project card
  subscriptions through Change Plan once a card is added).

## Known gaps

- The Admin Dashboard has no page for marketplace purchases yet; use the
  master-admin API (`/api/marketplace-subscription`,
  `/api/marketplace-usage-report`, `/api/marketplace-charge`).
- A project delete that fails after its final report, and is tried again in
  the same clock hour, on AWS or Microsoft: the minutes between the two tries
  cannot be billed in that hour, and are logged as "was NOT billed". A top-up
  bought in those minutes stays on the purchase, and is billed if the purchase
  is linked to another project.
- No product documentation page for buyers yet (docs pages must be translated
  into 16 languages to pass the docs tests).

## History

Add a row for every submission, approval, rejection and go-live.

| Date       | Marketplace | What happened                                                                        | Who   |
| ---------- | ----------- | ------------------------------------------------------------------------------------ | ----- |
| 2026-10-21 | AWS         | SaaS listing seen public (`prodview-ttfnc3eqofayw`); the website links it            | Agent |
| 2026-10-21 | Microsoft   | SaaS offer `oneuptime-cloud` seen live (publisher `oneupitme`); the website links it | Agent |

## Notes for agents driving the browser

- Work in the maintainer's own signed-in sessions. Never create seller
  accounts, and never type passwords, tax IDs, bank details or card numbers:
  stop and ask the maintainer to do those steps.
- Never accept agreements or press **Publish**, **Go live**, **Submit** or
  **Request public visibility** without the maintainer's go-ahead for that
  exact action, in chat.
- Portal pages lose unsaved text when you leave them; save each page before
  moving on.
- Uploads (logos, screenshots) may need a person: save the files where they
  can reach them and ask.
