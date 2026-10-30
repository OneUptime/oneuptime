# Selling self-hosted OneUptime Enterprise on cloud marketplaces

This is the runbook for maintainers and AI agents who list **self-hosted
OneUptime Enterprise** as a Kubernetes application on **AWS Marketplace**
(Amazon EKS), **Microsoft Marketplace** (AKS) and **Google Cloud Marketplace**
(GKE), billed through each marketplace by the user-hour, and who ship new
versions to those listings. Follow the repository's
[AGENTS.md](../../../../../AGENTS.md) as well.

OneUptime Cloud's listings (SaaS, billed in usage units) are a different
product with a different integration: see [RELEASING.md](RELEASING.md). The
two share seller accounts, company facts and listing media, nothing else.
The free Kubernetes agent's Amazon EKS add-on is a third product on AWS, built
and shipped by the same pipeline: see
[The Kubernetes agent as an Amazon EKS add-on](#the-kubernetes-agent-as-an-amazon-eks-add-on).

Buyers read the guide at
[`/docs/installation/cloud-marketplaces`](https://oneuptime.com/docs/installation/cloud-marketplaces)
(`packages/App/FeatureSet/Docs/Content/<lang>/installation/cloud-marketplaces.md`,
in every docs language): installing, billing, licensing, upgrading, settings
and troubleshooting. Change it with the product: every listing links to it.

Where buyers find each listing, as its marketplace links it:

| Marketplace  | Listing                                                                                                         | Seen public |
| ------------ | --------------------------------------------------------------------------------------------------------------- | ----------- |
| AWS          | Not public yet: product `prod-5ijwaqpun3coo` is Limited (the seller account and its allowlist only)             |             |
| Microsoft    | `https://marketplace.microsoft.com/en-us/product/oneupitme.oneuptime-enterprise` (offer `oneuptime-enterprise`) | 2026-10-21  |
| Google Cloud | Not public yet                                                                                                  |             |

The website names the public ones (the Resellers page's "Buy through your
cloud marketplace" section, and a line under the self-hosted page's
Enterprise Edition call to action) from
[packages/Home/Utils/CloudMarketplaces.ts](../../../../Home/Utils/CloudMarketplaces.ts),
and says "Coming soon" for the others. When a listing goes public, put its
address in that file as well as here, exactly as the marketplace links it.

Written on **17 October 2026**, together with the billing code and the
packaging, before any self-hosted listing existed. Nothing in this guide had
been submitted to any marketplace yet. When you do something below, add it to
[History](#history), and recheck the live state before acting: the portals
change their wording and steps.

## How it works

|                     | AWS Marketplace                                                                                                            | Microsoft Marketplace                                                                         | Google Cloud Marketplace                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Product             | Container product, Helm chart delivery, on Amazon EKS                                                                      | Azure Container offer with a Kubernetes application plan, on AKS only                         | Kubernetes app (deployer image), on GKE                                                                                    |
| How OneUptime bills | `MeterUsage`, dimension `users`, signed with the pod's IAM role (IRSA)                                                     | A usage event on the custom meter `users`, sent with the cluster extension's managed identity | Service Control `report`, metric `<service name>/users`, with the reporting secret Marketplace creates for each deployment |
| What the buyer does | Creates the service account and its IAM role with the `eksctl` command of the usage instructions, then runs `helm install` | Creates the app in the Azure portal: cluster, name, domain name, protocol                     | Configures the app in the Google Cloud console: cluster, namespace, name, domain name, protocol                            |
| Latest report taken | 6 hours after the hour (OneUptime stops trying at 5)                                                                       | 24 hours (OneUptime stops at 23)                                                              | OneUptime stops at 23 hours                                                                                                |

1. **Counting.** Every 15 minutes, and when it starts, the Enterprise
   Edition's job `EnterpriseMarketplace:ReportUsage`
   ([ee/Server/Marketplace](../../../../../ee/Server/Marketplace)) counts the
   installation's users: everyone with a OneUptime login. Status page
   subscribers and private status page viewers are not users.
2. **Reporting.** Each clock hour is billed once, at the most users any run
   saw during it, with an idempotency key derived from the installation and
   the hour, so an hour is never billed twice even when its report is sent
   again. Each report is claimed in the database before it is sent. Hours in
   which no run happened (the installation was down) are not billed. The
   reporters
   ([ee/Server/Marketplace/Reporters](../../../../../ee/Server/Marketplace/Reporters))
   share the AWS and Google Cloud clients of OneUptime Cloud's own marketplace
   billing
   ([ee/Server/CloudMarketplace](../../../../../ee/Server/CloudMarketplace)),
   so a change to one is a change to both.
3. **Licensing.** A report the marketplace accepts is its word that the buyer
   is subscribed: it licenses every Enterprise feature for 72 hours, with no
   seat limit and no license key
   ([MarketplaceLicense.ts](../../../../../ee/Server/License/MarketplaceLicense.ts)).
   When no report has been accepted for longer than that, the usual 30-day
   grace period runs. An answer that the buyer is **not** subscribed (a
   cancelled or suspended purchase) ends the Enterprise features at once; the
   Community Edition keeps running, and the next accepted report licenses it
   again.
4. **Failures.** A report the marketplace cannot take now (network,
   throttling, an outage) is sent again on the next run. One that was never
   sent and grew too old for the marketplace rides in the next report. One
   that was sent but never answered is not sent again, because the marketplace
   may have billed it, and is logged as possibly not billed. Nothing older than
   30 days is billed.
5. **Nothing in configuration licenses anything.** The settings only say
   which marketplace to report to. An installation that sets them without a
   purchase is refused by the marketplace and gets no license.

**What the marketplace license includes:** every Enterprise feature, for every
user. Terms that only a verified license key carries stay with a key (see
[ee/README.md](../../../../../ee/README.md)): sell those as a private deal with
a key. A license key and a marketplace subscription can live side by side: the
installation runs on whichever of the two is better.

### The settings

The marketplace editions of the chart (built by
[HelmChart/Marketplace/build.py](../../../../../HelmChart/Marketplace/build.py))
set these; nobody types them in by hand. The app and worker pods report; the
telemetry writers only get `ENTERPRISE_MARKETPLACE`, for the license.

| Environment variable                                        | Comes from                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ENTERPRISE_MARKETPLACE`                                    | `enterpriseMarketplace.provider`: `aws`, `azure` or `google-cloud` (build.py sets it per edition)                       |
| `AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_REGION` | EKS, from the service account's `eks.amazonaws.com/role-arn` annotation (IRSA)                                          |
| `ENTERPRISE_MARKETPLACE_AWS_REGION`                         | `enterpriseMarketplace.aws.region`; only for a pod EKS gives no `AWS_REGION`                                            |
| `ENTERPRISE_MARKETPLACE_AWS_PRODUCT_CODE`                   | Not set by the chart. Picks one of `AWS_SELF_HOSTED_PRODUCT_CODES` if there is ever more than one                       |
| `ENTERPRISE_MARKETPLACE_AZURE_RESOURCE_ID`                  | `global.azure.extension.resourceId`, which Azure fills in at install                                                    |
| `ENTERPRISE_MARKETPLACE_AZURE_PLAN_ID`                      | `global.azure.marketplace.planId`, which Azure fills in                                                                 |
| `ENTERPRISE_MARKETPLACE_AZURE_CLIENT_ID`                    | `global.azure.identity.clientId`, which Azure fills in                                                                  |
| `ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_SERVICE_NAME`          | `enterpriseMarketplace.googleCloud.serviceName` (build.py, from `editions.json`)                                        |
| `ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_CONSUMER_ID`           | Key `consumer-id` of the Secret named by `enterpriseMarketplace.googleCloud.reportingSecret`, which Marketplace creates |
| `ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_ENTITLEMENT_ID`        | Key `entitlement-id` of that Secret                                                                                     |
| `ENTERPRISE_MARKETPLACE_GOOGLE_CLOUD_REPORTING_KEY`         | Key `reporting-key` of that Secret                                                                                      |
| `DISABLE_UPDATE_CHECK`                                      | `updateCheck.disabled`: `true` in every edition (build.py); upgrades come through the marketplace, not GitHub           |
| `DISABLE_INSTANCE_CHECK_IN`                                 | `instanceCheckIn.disabled`: `true` in every edition (build.py); the marketplace knows its buyers and their release      |

The AWS product code is compiled in (`AWS_SELF_HOSTED_PRODUCT_CODES` in
[SelfHostedMarketplaceConfig.ts](../../../../../ee/Server/Marketplace/Reporters/SelfHostedMarketplaceConfig.ts)),
because AWS asks sellers to keep it out of the buyer's hands.

## Pricing

Approved by the maintainer on **17 October 2026**.

- **Unit: the user-hour.** The dimension (AWS), meter (Microsoft) and metric
  (Google) are all `users`.
- **List price: USD 0.10 per user-hour** on all three: about USD 73 per user
  per month (730 hours). No minimum and no other charge; the buyer's cloud
  bills the cluster as usual.
- **One public pay-as-you-go plan** on each marketplace. Discounts, annual
  commitments and enterprise deals are [private offers](#private-offers). A
  starting point for an annual private offer: about 20% off (USD 0.08 per
  user-hour), decided deal by deal.
- **Every installation is billed on its own**: staging and production both
  report their users. Discounts for non-production installations are private
  offers.

|                                            | AWS                                                                            | Microsoft                                                                                                                                                            | Google Cloud                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Marketplace fee                            | 20% on public offers; 3% on private offers under USD 1M (less above)           | 3%                                                                                                                                                                   | 3% (private offers 3%, 2% or 1.5% by size)                                                 |
| OneUptime keeps per user-hour at list      | USD 0.08 (public), 0.097 (private)                                             | USD 0.097                                                                                                                                                            | USD 0.097                                                                                  |
| Counts toward the buyer's cloud commitment | Yes: container products on EKS are "Deployed on AWS" (per the buyer's EDP/PPA) | Only once the offer is Azure IP co-sell eligible: at least USD 100K of Azure-billed sales or consumed revenue over the trailing 12 months, plus technical validation | Yes, as the buyer's agreement allows (at the time of writing, up to 25% of the commitment) |
| Free trial                                 | Not available with custom metering                                             | None                                                                                                                                                                 | Optional; not used                                                                         |
| Notice before a price increase             | 90 days                                                                        | 90 days (a decrease applies the next month)                                                                                                                          | 30 days                                                                                    |

Because of AWS's 20% public fee, enterprise deals on AWS belong in private
offers (3%).

**What cannot change later:** AWS cannot switch a product's pricing model;
Microsoft locks a plan's billing model and its dimensions (ID, display name,
unit) once published; Google has one pricing plan per product. Get the
dimension right the first time: ID `users`, one per product.

## What it costs OneUptime

Besides each marketplace's fee, about USD 5 to 7 a month:

| Cost                       | About                                | Kept down by                                                                                                                        |
| -------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Marketplace fees           | AWS 20% (public) or 3% (private); 3% | Selling to any sizeable buyer on AWS through a private offer, even at the list price                                                |
| Azure Container Registry   | USD 5 a month (Basic)                | A daily `acr purge` task keeps each repository's newest release and any from the last 7 days; Microsoft serves buyers its own copy  |
| Google Artifact Registry   | About USD 1 a month                  | The cleanup policy keeps each image's 3 newest releases, by count, and deletes the rest; Google serves buyers from its own registry |
| AWS Marketplace's registry | Nothing                              | It is AWS Marketplace's account, not ours                                                                                           |
| Reporting usage, CI        | Nothing                              | The metering APIs are free; GitHub Actions is free for a public repository                                                          |
| Test installations         | Nothing                              | We run none: each marketplace's own review installs and tests every version we submit                                               |

Buyers' clusters and their downloads are on the buyers' cloud bills, never on
ours.

The workflow ships once a week, not each of OneUptime's several releases a day:
every version a marketplace takes is a review, an approval, a copy in two of
the registries above, and on Microsoft an upgrade of every buyer's cluster. With
the cleanup counting releases rather than days, each registry holds about 3
releases whatever the pace.

## Who does what

Agents: these are maintainer decisions and company facts. Never guess them,
never type banking or tax details, never accept an agreement, and never press a
final publish / go live / submit button without a maintainer's explicit
go-ahead in chat for that exact step.

| Step                                                                                                    | Who                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Seller registration, agreements, tax and bank details, identity verification                            | Maintainer, in their own accounts                                                                                         |
| Signing in: `aws login --profile oneuptime`, `az login`, `gcloud auth login`, the portals               | Maintainer. An agent may then work in that session                                                                        |
| Anything that costs money: the Azure Container Registry, Artifact Registry, any cluster                 | Maintainer approves the cost first                                                                                        |
| Prices, dimensions, private offer terms                                                                 | Maintainer, a go-ahead for each exact change                                                                              |
| Building an edition, running the tests, scanning the images                                             | Agent or maintainer                                                                                                       |
| Copying images and pushing charts and bundles to the marketplace registries                             | The Marketplace Release workflow, every Monday; by hand, an agent or a maintainer, for a release the maintainer has named |
| Approving each publish the workflow makes (**Review deployments** on the run, `marketplace-publish`)    | Maintainer, a required reviewer of that environment                                                                       |
| The one-time CI setup (`ci_setup.py`): it prints each script to read first                              | Agent or maintainer, signed in as the maintainer, once the maintainer approved its costs                                  |
| Filling in and saving portal drafts: listing copy, plans without prices, technical settings             | Agent                                                                                                                     |
| Submitting a version, **Review and publish**, **Go live**, **Update visibility**, **Submit for review** | Maintainer, a go-ahead for each exact action                                                                              |
| Code changes: the AWS product code, `editions.json`, image pins                                         | Agent, through a pull request                                                                                             |

**Company facts** are in [RELEASING.md](RELEASING.md#before-you-start-decisions-and-facts-that-are-the-businesss):
HackerBay, Inc., United States; terms, privacy, sub-processors and support
URLs. The EULA of the self-hosted product is the maintainer's choice: the
marketplace's standard contract, or OneUptime's terms
(`https://oneuptime.com/legal/terms`), which the
[Enterprise license](../../../../../ee/LICENSE) already points to.

## The packaging

Everything lives in [HelmChart/Marketplace](../../../../../HelmChart/Marketplace)
([README](../../../../../HelmChart/Marketplace/README.md)):

| File                       | What it is                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.py`                 | Builds one edition: `python3 HelmChart/Marketplace/build.py --marketplace aws\|azure\|google-cloud --version X.Y.Z --out DIR`                                                                                  |
| `images.json`              | The images every edition ships, with the third-party versions pinned                                                                                                                                           |
| `editions.json`            | Each marketplace's registry and its own settings                                                                                                                                                               |
| `mirror-images.sh`         | Copies an edition's images into its marketplace's registry (`crane`; `--dry-run` shows the plan)                                                                                                               |
| `azure/`                   | The CNAB manifest, the Azure portal's create experience and the ARM template                                                                                                                                   |
| `google-cloud/`            | The deployer's Dockerfile, `schema.yaml`, the `Application` resource and the tester                                                                                                                            |
| `aws/delivery-option.json` | The Helm delivery option every AWS version gets: title, description, usage instructions, override parameters                                                                                                   |
| `automation/`              | The release automation the workflow runs (`release_plan.py`, `aws_catalog.py`, `partner_center.py`, `google_cloud_release.py`) and the one-time CI setup (`ci_setup.py`), with their unit tests                |
| `aws-eks-addon/`           | The Kubernetes agent's EKS add-on: its delivery option, its images and the configuration schema buyers set (see [The Kubernetes agent as an Amazon EKS add-on](#the-kubernetes-agent-as-an-amazon-eks-add-on)) |

The workflow is [`.github/workflows/marketplace-release.yml`](../../../../../.github/workflows/marketplace-release.yml):
see [Releasing a version](#releasing-a-version).

Every edition is the public chart with every image (OneUptime's, and the
PostgreSQL, ClickHouse and Valkey it bundles) taken from the marketplace's
registry, `enterpriseMarketplace.provider` set, the update check off (buyers
upgrade through the marketplace, which has a release a week, not GitHub's
several a day), the daily check-in with oneuptime.com off (the marketplace
knows its buyers and the release it ships them), no subcharts and no
`helm test` pod. The chart tests'
`marketplace` suite builds and checks all three:

```bash
bash HelmChart/Tests/run.sh marketplace
```

Tools a release needs: Python 3, Helm 3.19 or later, `crane`
(`brew install crane`), the cloud's CLI, Docker on an x86-64 machine for the
Microsoft bundle (Microsoft's packaging tool runs only there), and Docker with
buildx for the Google deployer.

## One-time setup

### What the code needs first

Some values exist only once the portals have created the products. Each goes
into the repository through a pull request, before the first release that
needs it. Record each one in [History](#history).

| Value                                            | Where it comes from                                                                                        | Where it goes                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS product code                                 | AWS Marketplace Management Portal, when the container product is created                                   | `AWS_SELF_HOSTED_PRODUCT_CODES` in [SelfHostedMarketplaceConfig.ts](../../../../../ee/Server/Marketplace/Reporters/SelfHostedMarketplaceConfig.ts). It is compiled into the image: a OneUptime release made before this change cannot bill AWS, and says "This build of OneUptime has no AWS Marketplace product code" |
| AWS registry prefix                              | The portal's repository URIs: `709825985650.dkr.ecr.us-east-1.amazonaws.com/<sellerName>`                  | `editions.json`, `aws.registry`                                                                                                                                                                                                                                                    |
| Azure registry                                   | The Azure Container Registry you create: `<name>.azurecr.io`                                               | `editions.json`, `azure.registry`                                                                                                                                                                                                                                                  |
| Google registry path and Service Control service | The Artifact Registry repository you create; Producer Portal's **Overview** page, **Service name** column  | `editions.json`, `google-cloud.registry` and `google-cloud.serviceName`                                                                                                                                                                                                            |
| AWS product ID                                   | `python3 HelmChart/Marketplace/automation/aws_catalog.py find-product` (the Catalog API's entity ID)       | `editions.json`, `aws.productId`                                                                                                                                                                                                                                                   |
| Microsoft offer, plan, extension type, bundle    | Partner Center; the bundle's repository is the one `cpa buildbundle` pushes to (check after the first run) | `editions.json`, `azure.offerId`, `planId`, `clusterExtensionType`, `resourceGroup`, `bundleRepository`                                                                                                                                                                            |
| Ready                                            | Every value of the edition above is the portal's real one                                                  | `editions.json`, `"ready": true` for that edition. Until then the workflow pushes and submits nothing to that marketplace                                                                                                                                                          |

The AWS and Microsoft values in `editions.json` are the real ones, and both
editions are ready. Google Cloud's service name waits for its Producer Portal
product.

### AWS Marketplace: container product

Seller account `176820170339` already sells OneUptime Cloud (SaaS product
`prod-unn56dxklr4mw`). The container product goes in the same account.

1. **Sign in** (maintainer): `aws login --profile oneuptime`, and the
   [AWS Marketplace Management Portal](https://us-east-1.console.aws.amazon.com/partnercentral/home)
   in the browser.
2. **Create the product** (an agent drafts it; the maintainer submits it):
   **Server products > Create server product > Container**. This generates
   the **product ID** and **product code**. In the wizard:
   - Product information: the copy in [Listing content](#listing-content-paste-ready).
   - Pricing: **usage pricing with custom metering**, one dimension: API name
     `users`, display name "Users", description "OneUptime users, billed per
     user for every hour". AWS starts every paid container product at
     **USD 0.01** so that Seller Operations can test it cheaply; the
     maintainer sets **USD 0.10** when requesting public visibility.
   - Offer information: refund policy (draft below), EULA (maintainer),
     availability (every country unless the maintainer says otherwise).
   - Initial repository: `oneuptime` (the chart's repository: `helm push`
     names it after the chart).
   - **Submit** (maintainer) moves the product to **Limited**: visible only to
     the seller account and the allowlist.
3. **Repositories**: with `aws.productId` in `editions.json`,
   `python3 HelmChart/Marketplace/automation/aws_catalog.py add-repositories`
   creates them through the Catalog API: `oneuptime` for the chart, and `app`,
   `nginx`, `probe`, `runner`, `postgres`, `clickhouse-server`, `valkey` (the
   `name`s in `images.json`). In the portal it is **Request changes > Add
   repositories**. Their URIs show the seller prefix AWS generated: put
   `709825985650.dkr.ecr.us-east-1.amazonaws.com/<sellerName>` into
   `editions.json` as `aws.registry`.
4. **The product code into the code** (agent, pull request), then a OneUptime
   release that contains it.
5. **Allowlist** any test AWS accounts other than the seller's own
   (**Request changes > Update allowlist**).

### Microsoft Marketplace: Azure Container offer

OneUptime's Partner Center account and the HackerBay tenant
(`5ecf4811-0b2d-4001-85dc-d2b2663ea202`) already exist for the SaaS offer
`oneuptime-cloud`; use the same ones.

1. **The container registry** (the maintainer approves the cost first: Basic,
   about USD 5 a month). `ci_setup.py azure-registry` creates it in the
   tenant's subscription with what Microsoft needs: its ingestion app may pull
   from it, and `Microsoft.PartnerCenterIngestion` is registered. It also adds
   a daily ACR task (`acr purge`) that keeps each repository's newest
   release, and anything pushed in the last 7 days: Microsoft copies a release
   while it certifies it (up to 2 business days) and serves buyers from its own
   copy, so ours only holds releases on their way through. Basic's flat price
   covers 10 GiB, about three releases. Running the script again
   replaces the task, so a changed rule takes effect. Read the script, then
   run it (`az login` first, as an Owner of the subscription):

   ```bash
   python3 HelmChart/Marketplace/automation/ci_setup.py azure-registry
   python3 HelmChart/Marketplace/automation/ci_setup.py azure-registry --apply
   ```

   The registry is `editions.json`'s `azure.registry`
   (`oneuptimemarketplace.azurecr.io`).

2. **New offer** in Partner Center: **Marketplace offers > New offer > Azure
   Container**. Offer ID `oneuptime-enterprise` (permanent; it shows in URLs),
   alias "OneUptime Enterprise (self-hosted)".
   - **Properties**: categories (monitoring, DevOps: the closest Microsoft
     offers), legal terms (maintainer: the Standard Contract or OneUptime's
     terms).
   - **Offer listing**: the copy and media in
     [Listing content](#listing-content-paste-ready); privacy policy; support
     and engineering contacts (the maintainer supplies names and phone
     numbers).
   - **Preview audience**: the Azure subscription IDs of the testers (up to 10
     by hand).
3. **Plan**: **New plan**, plan ID `enterprise` (permanent), name "OneUptime
   Enterprise".
   - **Pricing and availability**: markets (maintainer); billing model
     **Custom**, one dimension: ID `users`, display name "Users", unit of
     measure "user per hour", price **USD 0.10** (maintainer). Visibility:
     public.
   - **Technical configuration** (after the first `cpa buildbundle`, below):
     **Add CNAB Bundle** and pick the bundle from the registry, and set the
     **cluster extension type name**: `HackerBay.OneUptimeEnterprise`
     (`PublisherName.ApplicationName`, at most 50 characters, unique across
     the account's offers, permanent once the plan reaches Preview).

Custom meters work on AKS only, not on Azure Arc-enabled clusters, and one
offer targets one cluster type: this offer is AKS only (the manifest names no
other). Microsoft copies every image to **its public registry**, readable by
anyone whatever the plan's audience; the Enterprise images are public on
Docker Hub already, so nothing new is exposed.

### Google Cloud Marketplace: Kubernetes app

Waiting on Google: OneUptime's Google Cloud partner sign-up is still pending.
Everything lives in the `oneuptime-marketplace` project, never in
`oneuptime-k8s`.

1. **Partner account** (maintainer): finish the partner sign-up, accept the
   Cloud Marketplace agreements and set up payments in Producer Portal
   (`https://console.cloud.google.com/producer-portal?project=oneuptime-marketplace`).
2. **Ask the Partner Engineer two things before building on them**: that
   Google still takes new **deployer-based** Kubernetes apps (Producer Portal
   also offers Terraform-based Kubernetes apps, whose billing works another
   way: this integration is built for the deployer kind, with the reporting
   secret), and that it takes images from an **Artifact Registry
   `pkg.dev`** repository (Google's older guide speaks of Container Registry,
   which has shut down).
3. **Access for Google**: in `oneuptime-marketplace`, grant
   `roles/viewer` to `cloud-commerce-marketplace-onboarding@twosync-src.google.com`,
   and whatever else Producer Portal's technical integration page asks for.
4. **The registry** (the maintainer approves the cost: Artifact Registry
   storage, about a dollar a month). `ci_setup.py google` creates it, with a
   cleanup policy that keeps each image's 3 newest releases and deletes the
   rest once they are a day old (Google serves buyers from its own copy), and
   the workflow's sign-in (below). By hand:

   ```bash
   gcloud services enable artifactregistry.googleapis.com servicecontrol.googleapis.com servicemanagement.googleapis.com --project=oneuptime-marketplace
   gcloud artifacts repositories create oneuptime --repository-format=docker --location=us --project=oneuptime-marketplace
   ```

   The app's path is `us-docker.pkg.dev/oneuptime-marketplace/oneuptime/oneuptime-enterprise`
   (`editions.json`, `google-cloud.registry`): the primary image at that path,
   every other image beneath it, and the deployer at `.../deployer`.

5. **Create the product** in Producer Portal: **Add product > Kubernetes
   app**. The **Overview** page then shows the product's **service name**:
   put it into `editions.json` as `google-cloud.serviceName`, exactly.
6. **Pricing**: usage-based, one custom metric: ID `users`, display name
   "Users", unit "user-hour", **USD 0.10** (maintainer). No free trial.
   OneUptime reports it as `<service name>/users`; check that Producer Portal
   names the metric so.
7. **Listing**: the copy and media in
   [Listing content](#listing-content-paste-ready); support and legal links.

### The release workflow: one-time setup

The Marketplace Release workflow signs in to every cloud with GitHub's OIDC
token, so the repository holds no secret. `ci_setup.py` prints each script
first; read it, then run it with `--apply`, signed in as the maintainer. Each
script is safe to run again, and prints the repository variables to set.

1. **AWS** (`aws login --profile oneuptime`; needs `aws.productId` and
   `aws.registry`): `ci_setup.py aws`. A role that only the workflow's two
   environments can assume, which may push to this product's repositories and
   add versions (`AddDeliveryOptions`) to this product, and nothing else.
2. **Microsoft** (`az login`): `ci_setup.py azure-registry` (above), then
   `ci_setup.py azure`: an Entra app with federated credentials for the two
   environments and AcrPush on the registry. Then, by hand, once: in Partner
   Center, **Account settings > User management > Microsoft Entra
   applications**, add that app with the **Manager** role, so it can update
   and publish the offer.
3. **Google** (`gcloud auth login`): `ci_setup.py google`: the registry with
   its cleanup policy, a service account that can write to it, and Workload
   Identity Federation that trusts only this repository's two environments.
4. **GitHub** (`gh auth login`, as a repository admin):

   ```bash
   python3 HelmChart/Marketplace/automation/ci_setup.py github --reviewer <your login> \
     --set MARKETPLACE_RELEASE_AWS_ROLE_ARN=... --set MARKETPLACE_RELEASE_AZURE_CLIENT_ID=... (each variable printed above)
   ```

   It creates the `marketplace-push` environment (master only) and the
   `marketplace-publish` environment (master only, and every job waits for a
   reviewer), and sets the variables. Add `--enable` to set
   `MARKETPLACE_RELEASES=enabled` once a dry run has passed: the workflow
   then ships the newest release every Monday.

5. **Each edition**: set `"ready": true` in `editions.json` once its values
   are real.
6. **Try it**: run **Marketplace Release** by hand (Actions > Marketplace
   Release > Run workflow). It is a dry run unless you untick `dry_run`.

## Releasing a version

Ship the same OneUptime release to all three listings.

### With the Marketplace Release workflow

Every Monday at 09:00 UTC, once `MARKETPLACE_RELEASES` is `enabled`,
[the workflow](../../../../../.github/workflows/marketplace-release.yml) ships
the newest release (the newest `#.#.#` tag, which GitHub cuts only once the
release's images are all published), doing everything below for each ready
marketplace:

1. **Tests** the marketplace chart suite on the chart as it was released.
2. **Asks each marketplace whether it has the release already**: AWS for the
   product's versions, Partner Center for the bundle the preview names,
   Artifact Registry for the deployer. One that has it is left alone: nothing
   is pushed, and its publishing job neither runs nor asks for an approval. So
   a week with no new release ships nothing, and running the workflow again
   ships nothing twice.
3. **Pushes**, with no approval (pushing publishes nothing): each edition's
   images, then the chart to AWS Marketplace's registry, the bundle (built
   with Microsoft's `cpa`) to our Azure registry, and the deployer to
   Artifact Registry. What an earlier run pushed (its publishing did not go
   through) is used again: AWS images and chart, and Microsoft's bundle, are
   not pushed twice.
4. **Waits for a maintainer** to approve the publishing jobs (**Review
   deployments** on the run), then:
   - **AWS**: adds the version (Catalog API, `AddDeliveryOptions`, with the
     GitHub release's notes) and follows AWS's scan; the version is public
     once AWS applies it.
   - **Microsoft**: points the plan's technical configuration at the new
     bundle and publishes the offer to **preview** (Product Ingestion API).
   - **Google**: Google has no API for this step. The run's summary says
     what to add in Producer Portal: the deployer, its digest and its track.
5. **Microsoft goes live by hand**: once the preview has passed Microsoft's
   checks (its certification installs and tests the bundle; we run no test
   installation of our own, which would cost money), run the workflow with
   **action: azure-go-live**; after its approval it publishes the newest
   succeeded preview to live, and AKS then upgrades buyers' clusters to it.

Run it by hand for a release that should not wait for Monday (an urgent
fix), one marketplace, an older release, or a dry run (**version**,
**marketplaces**, **dry_run**; an empty version is the newest release). A real
run ships only a released version (one with its tag). A dry run builds and
checks everything and keeps what a real run would send (the AWS change set,
the Partner Center request) as the run's artifacts.

The steps below are what the workflow runs, and how to do them by hand.

### Before every release

1. **The release exists**: OneUptime publishes the Enterprise images as
   `oneuptime/<image>:enterprise-<version>` on Docker Hub. Check with
   `crane manifest docker.io/oneuptime/app:enterprise-X.Y.Z`. For AWS, the
   release must contain the product code (above).
2. **The third-party pins** in `images.json` (PostgreSQL, ClickHouse,
   Valkey): move each to the newest patch of the same line, and keep
   PostgreSQL on the major version `docker-compose.base.yml` runs. Every
   marketplace scans every layer: AWS blocks critical vulnerabilities that can
   be exploited remotely, Microsoft blocks CVSS 7 and above.
3. **The tests**: `bash HelmChart/Tests/run.sh marketplace` passes.
4. **A scan of your own** before submitting, so a finding does not cost a
   review round:

   ```bash
   trivy image --severity HIGH,CRITICAL --ignore-unfixed docker.io/oneuptime/app:enterprise-X.Y.Z
   ```

   for every source in `images.json`.

### AWS Marketplace

```bash
VERSION=X.Y.Z
OUT="$(mktemp -d)/oneuptime-aws"
python3 HelmChart/Marketplace/build.py --marketplace aws --version "$VERSION" --out "$OUT"

REGISTRY=709825985650.dkr.ecr.us-east-1.amazonaws.com
aws ecr get-login-password --region us-east-1 --profile oneuptime | crane auth login "$REGISTRY" -u AWS --password-stdin
aws ecr get-login-password --region us-east-1 --profile oneuptime | helm registry login "$REGISTRY" --username AWS --password-stdin

HelmChart/Marketplace/mirror-images.sh "$OUT/images.json"
helm package "$OUT/oneuptime" --destination "$OUT"
helm push "$OUT/oneuptime-$VERSION.tgz" "oci://$REGISTRY/<sellerName>"
```

The mirror keeps only `linux/amd64` and `linux/arm64` of each image
(`crane index filter`): AWS refuses images with layers of architectures it
does not run, which includes the build attestations Docker Hub images carry
and the official images' other platforms. The portal's **View push commands**
on each repository shows the login commands. Then **Request changes > Add new
version**:

- **Version title** `X.Y.Z`; **release notes** from the GitHub release.
- One **Helm chart** delivery option:
  - **Helm chart**: `709825985650.dkr.ecr.us-east-1.amazonaws.com/<sellerName>/oneuptime:X.Y.Z`.
  - **Container images**: every `target` in `$OUT/images.json`.
  - **Delivery option title**, description and **usage instructions**: as
    `HelmChart/Marketplace/aws/delivery-option.json` has them (the workflow
    sends that file).
  - **Supported services**: Amazon EKS.
  - **Helm release name** `oneuptime`; **Helm installation namespace**
    `oneuptime`; **Kubernetes service account name** left empty.
  - **Override parameters**: `host` (default `localhost`), `httpProtocol`
    (default `http`), and `serviceAccount.name` with the default
    `${AWSMP_SERVICE_ACCOUNT}`. The chart creates no service account: it
    runs OneUptime as this one, and reports usage with its IAM role.
    AWS's launch page shows the parameter as
    `<ENTER_SERVICE_ACCOUNT_NAME_HERE>`, and the
    `eksctl create iamserviceaccount` of its **General launch instructions**
    attaches a role the buyer already has (`--attach-role-arn`) and names no
    policy. So the usage instructions give the command that creates the
    `oneuptime` service account with a role that has
    `AWSMarketplaceMeteringFullAccess` (`AWSMarketplaceMeteringRegisterUsage`
    allows only `RegisterUsage`; OneUptime calls `MeterUsage`), and have the
    buyer set `serviceAccount.name=oneuptime`.
- **Submit**: AWS scans the images and the new version appears to the
  allowlist. A version that is not public yet can still be edited.

**Testing is AWS's**: AWS scans every version, and Seller Operations installs
and tests the product before it goes public. We run no test installation of
our own: it would cost money, and the review covers it. Once buyers run it,
AWS shows metering in the seller reports a day or two later.

**Go public** (first release only): the maintainer sets the price to USD 0.10
and submits **Request changes > Update visibility**; Seller Operations
reviews the product against AWS's container policies. Settle
[the policy questions](#policy-questions-to-settle-before-submitting) with
them first. Usage instructions must not tell buyers to edit anything but
`values.yaml` or to add `--set` flags: the delivery option's override
parameters are how buyers set the domain name and the service account.

### Microsoft Marketplace

The version must be new for every bundle (`#.#.#`); never
`cpa buildbundle --force` a version Partner Center has already taken.

```bash
VERSION=X.Y.Z
OUT="$(mktemp -d)/oneuptime-azure"
python3 HelmChart/Marketplace/build.py --marketplace azure --version "$VERSION" --out "$OUT"

az acr login --name oneuptimemarketplace --expose-token --output tsv --query accessToken | crane auth login oneuptimemarketplace.azurecr.io -u 00000000-0000-0000-0000-000000000000 --password-stdin
HelmChart/Marketplace/mirror-images.sh "$OUT/images.json"
```

Then build and push the bundle with Microsoft's packaging tool, on an x86-64
Linux or Windows machine with Docker:

```bash
docker run -it --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$OUT:/data" --entrypoint /bin/bash mcr.microsoft.com/container-package-app:latest
```

and inside it:

```bash
az login
az acr login --name oneuptimemarketplace
cd /data
cpa verify
cpa buildbundle
```

Before the first submission, paste `createUIDefinition.json` into the
[createUiDefinition sandbox](https://portal.azure.com/#view/Microsoft_Azure_CreateUIDef/SandboxBlade)
and walk through both paths (new cluster, existing cluster).

In Partner Center, the plan's **Technical configuration**: pick the new
bundle (tag `X.Y.Z`), save, then **Review and publish** (maintainer). Microsoft
copies the bundle and images, scans them, and the offer goes to **Preview**.

**Test** from the preview: in the Azure portal, as a preview-audience
subscription, create the app on a test AKS cluster, then
[check the installation](#checking-an-installation). Preview purchases are
billed like real ones, at USD 0.10 per user-hour: a day's test with one user
costs USD 2.40.

**Go live** (maintainer). Every minor and patch version reaches every
customer's cluster by itself (`autoUpgradeMinorVersion` in `mainTemplate.json`);
a major version waits for each customer's consent. Test before **Go live**:
there is no limited rollout.

### Google Cloud Marketplace

```bash
VERSION=X.Y.Z
TRACK="${VERSION%.*}"
OUT="$(mktemp -d)/oneuptime-google-cloud"
python3 HelmChart/Marketplace/build.py --marketplace google-cloud --version "$VERSION" --out "$OUT"

gcloud auth print-access-token | crane auth login us-docker.pkg.dev -u oauth2accesstoken --password-stdin
HelmChart/Marketplace/mirror-images.sh "$OUT/images.json"
```

The mirror annotates every image with the listing's service
(`com.googleapis.cloudmarketplace.product.service.name=services/<service name>`,
which Google requires) and tags it with the track (`major.minor`) as well.
Then the deployer, with Docker buildx (`--provenance=false` keeps build
attestations out of the pushed image):

```bash
REGISTRY=us-docker.pkg.dev/oneuptime-marketplace/oneuptime/oneuptime-enterprise
SERVICE=oneuptime-enterprise.endpoints.oneuptime-marketplace.cloud.goog   # editions.json, google-cloud.serviceName
gcloud auth configure-docker us-docker.pkg.dev
docker buildx build --platform linux/amd64 --provenance=false \
  --build-arg REGISTRY="$REGISTRY" --build-arg TAG="$VERSION" \
  --annotation "manifest:com.googleapis.cloudmarketplace.product.service.name=services/$SERVICE" \
  --tag "$REGISTRY/deployer:$VERSION" --tag "$REGISTRY/deployer:$TRACK" \
  --push "$OUT"
```

**Testing is Google's**: its review installs and tests each version we
submit. We keep no GKE test cluster: it would cost money. Only to reproduce a
failure Google reports, on a cluster the maintainer approves, Google's `mpdev`
runs the same checks:

```bash
kubectl apply -f "https://raw.githubusercontent.com/GoogleCloudPlatform/marketplace-k8s-app-tools/master/crd/app-crd.yaml"
docker run gcr.io/cloud-marketplace-tools/k8s/dev cat /scripts/dev > ~/bin/mpdev && chmod +x ~/bin/mpdev
mpdev doctor
mpdev verify --deployer="$REGISTRY/deployer:$VERSION"
```

`mpdev verify` installs the app, waits for it to be ready (up to 30 minutes:
the first start migrates the database), runs the tester (it opens
`/status/ready`, `/status`, `/dashboard` and `/accounts`) and removes the app.
`mpdev` gives the deployment a reporting secret that is not real, so such an
installation logs that it cannot report and stays unlicensed: expected.

In Producer Portal, add the version (the deployer image and its track),
then **Submit for review** (maintainer).

## Checking an installation

We run no test installations: each marketplace's review tests every version.
Use this when an installation needs looking at, such as a buyer's (with them)
or one the maintainer approved to reproduce a problem:

1. **It runs**: every pod is ready (the first start migrates the database:
   allow up to 30 minutes), and `https://<domain>/status/ready` answers.
2. **It reports**: within an hour, the app (or worker) logs a line like
   `<marketplace> accepted N user-hours for <hour>`, after the prefix every
   billing line starts with (`OneUptime Enterprise marketplace billing`). A
   line saying usage "cannot be reported ... until this is fixed" lists what
   the installation is missing (no IAM role, no Region, no reporting
   secret...).
3. **It is licensed**: the dashboard's edition label says **Enterprise
   Edition**, and opening it shows "Licensed through <marketplace>". As a
   master admin, `GET /api/global-config/license` returns `marketplaceBilling`
   with `verifiedAt` set, `pendingReportCount` 0 and no `lastProblem`.
4. **It bills the right number**: the marketplace's own usage report shows the
   installation's user count for each hour (a day or two later).
5. **It stops when the purchase stops**: cancel the test subscription. The
   next report is refused, the edition label says **Enterprise Edition
   (Marketplace Subscription Ended)**, and the Enterprise features stop. The
   Community Edition keeps working.

## Private offers

Nothing needs switching on for private offers: each marketplace makes them
on a published product. Each offer is a maintainer's decision (its price,
term and customer); an agent can draft one and stop before sending it.

- **AWS**: **Offers > Create private offer** in the Management Portal: the
  buyer's AWS account IDs, a custom price for `users` (per user-hour), and
  optionally a contract term with a payment schedule (overage at the metered
  price). AWS's fee on a private offer is 3% below USD 1M.
- **Microsoft**: **Marketplace offers > Private offers** in Partner Center:
  a customer private offer (the buyer's billing account or tenant) with a
  percentage discount or an absolute price for the `enterprise` plan's
  `users` meter, and its start and end dates; the buyer accepts it in the
  Azure portal. A multiparty private offer lets a Microsoft partner resell
  it. Turn on the listing's **request a private offer** option so buyers can
  ask from the listing.
- **Google Cloud**: **Offers** in Producer Portal: a private offer for the
  buyer's billing account, with a committed-use discount (a commitment plus
  overage) or a usage discount, a term of up to five years and a payment
  schedule.

## Listing content (paste-ready)

Trim each field to its marketplace's limit. Logos and screenshots: as in
[RELEASING.md](RELEASING.md#listing-content-paste-ready) (square PNG logo from
`packages/Home/Static/img/OneUptimePNG/`; 1280x720 PNG screenshots with
captions, approved by a maintainer).

**Name:** OneUptime Enterprise (self-hosted)

**Search summary (≤ 100 characters):**

```text
OneUptime Enterprise in your own Kubernetes cluster: monitoring, status pages, on-call and APM.
```

**Short description (plain text, one line):**

```text
Self-hosted OneUptime Enterprise: uptime monitoring, status pages, on-call, incident management, logs, traces and metrics in your own Kubernetes cluster, billed per user by the hour through this marketplace.
```

**Highlights (AWS asks for three):**

```text
Monitoring, status pages, on-call, incidents, logs, traces and metrics in one platform, in your own cluster.
Billed per user by the hour on your cloud bill. No license key and no minimum.
Built on OpenTelemetry, with an open-source (Apache 2.0) core.
```

**Description:**

```text
OneUptime Enterprise, self-hosted in your own Kubernetes cluster: one platform
for the whole incident lifecycle, with your data in your own cloud account.

- Uptime monitoring: websites, APIs, ping, ports, SSL certificates, DNS and
  synthetic browser checks.
- Status pages: branded public and private status pages with email, SMS and
  webhook subscribers.
- On-call and alerts: schedules, rotations and escalation policies, with
  alerts by SMS, phone call, push, email, Slack and Microsoft Teams.
- Incident management: declare, triage and communicate incidents, with
  timelines, runbooks and post-mortems.
- Observability: logs, traces, metrics, APM, error tracking, profiles and
  session replay, built on OpenTelemetry.
- Enterprise Edition: SCIM provisioning, audit logs, team compliance,
  retention by telemetry type and the OneUptime Health dashboards.

Pricing: $0.10 per user per hour (about $73 per user per month), billed every
hour on your cloud bill for each person with a OneUptime login. Status page
subscribers are not billed. No license key: your marketplace subscription
licenses the Enterprise features. Your cloud provider bills the cluster as
usual. For annual pricing and volume discounts, ask us for a private offer:
https://oneuptime.com/enterprise/demo.

OneUptime runs its own PostgreSQL, ClickHouse and Valkey in the cluster. It
needs at least 3 nodes of 2 vCPUs and 8 GiB (4 vCPUs and 16 GiB recommended),
a default StorageClass and load balancer support.
```

**Usage instructions (AWS delivery option):**

```text
Before you install:
1. An Amazon EKS cluster with at least 3 nodes of 4 vCPUs and 16 GiB of
   memory, the Amazon EBS CSI driver with a default StorageClass, and an IAM
   OIDC provider:
   eksctl utils associate-iam-oidc-provider --cluster <cluster> --approve
2. The oneuptime service account, with an IAM role that has the
   AWSMarketplaceMeteringFullAccess policy. Create both with this command, in
   place of the eksctl command in step 1 of the General launch instructions on
   this page (that one attaches a role you would have to create first):
   eksctl create iamserviceaccount --name oneuptime --namespace oneuptime --cluster <cluster> --attach-policy-arn arn:aws:iam::aws:policy/AWSMarketplaceMeteringFullAccess --approve --override-existing-serviceaccounts
   OneUptime reports its users to AWS Marketplace every hour with this role;
   without it, the Enterprise features stay off.

Install with the commands in step 2 of the General launch instructions. In the
helm install command, set these values:
   serviceAccount.name=oneuptime (the service account above)
   host=<your domain name>, for example oneuptime.example.com
   httpProtocol=https if a certificate is in front of OneUptime, otherwise http

Then point the domain name at the load balancer (the EXTERNAL-IP of the
service ending in -nginx: kubectl get service --namespace oneuptime) and open
it to create the first account. The first start migrates the database and
takes a few minutes. Within the hour, the dashboard's edition label shows the
Enterprise Edition, licensed through AWS Marketplace.

To upgrade, run helm upgrade with a newer version of this chart and the same
values.

Guide: https://oneuptime.com/docs/en/installation/cloud-marketplaces
Support: https://oneuptime.com/support
```

**Support description (AWS):** its only link is the support page. AWS made the
last link of the first one (Documentation: https://oneuptime.com/docs) the
listing's **Get support** button, which then opened the docs.

```text
Email support@oneuptime.com or visit https://oneuptime.com/support for help. We
provide global coverage Monday through Friday, and most requests receive a
response within one business day. Enterprise plans include a dedicated Slack
channel, priority response times and direct access to our engineering team.
```

**Additional resources (AWS):** each link goes straight to its page, in English
(`/docs/en/...`), not to an address that redirects there. AWS's review refused
the first request to make the listing public for broken links (2026-10-20)
without naming one; two of its links redirected then, and Get support opened
the docs.

- Installing from AWS Marketplace: https://oneuptime.com/docs/en/installation/cloud-marketplaces
- Enterprise Edition: https://oneuptime.com/docs/en/self-hosted/enterprise

**Refund policy (draft; the maintainer decides):**

```text
OneUptime is billed by the hour for the users of each installation, so you pay
only for the hours you run it. Contact https://oneuptime.com/support about any
charge you believe is wrong; we review every request.
```

**Dimension / meter / metric (all three):** ID `users`; display name "Users";
description (AWS takes at most 90 characters):

```text
Each OneUptime user (anyone with a login), per hour. Status page subscribers are free.
```

## Operating it

- **The job**: `EnterpriseMarketplace:ReportUsage`, every 15 minutes and at
  startup, on the worker (or the app, when there is no worker). A Valkey lock
  keeps one run at a time across pods.
- **The state**: one JSON column, `GlobalConfig.enterpriseMarketplaceBilling`
  (written by the job only, readable by master admins as `marketplaceBilling`
  in `GET /api/global-config/license`): the hours observed, the reports not
  yet accepted, the last accepted report, when the marketplace last accepted
  or refused one, and the last problem.
- **Logs**: every line starts with
  `OneUptime Enterprise marketplace billing`. **"were NOT billed"** marks
  usage that will never be billed (a refusal, a conflicting record, a report
  too old to send): money lost, look at each one. **"cannot be reported ...
  until this is fixed"** is a setup problem on the buyer's side, with the
  reasons; the usage is kept until it is fixed or too old.
- **A buyer whose Enterprise features stopped**: the edition label says why.
  "Marketplace Reports Failing" means the reports are not getting through: the
  logs say why, and the 30-day grace period gives them time. "Marketplace
  Subscription Ended" means the marketplace refused the installation (the
  purchase was cancelled or suspended, or the installation is not the one
  purchased: they subscribe again), or the reports kept failing past the
  grace period; the edition dialog says which.
- **Moving an installation between marketplaces**: the usage still owed to
  the old marketplace is logged as not billed, and the new one starts fresh.

## The Kubernetes agent as an Amazon EKS add-on

A second, free product on AWS Marketplace, in the same seller account: the
Kubernetes agent ([HelmChart/Public/kubernetes-agent](../../../../../HelmChart/Public/kubernetes-agent)),
which buyers add to an EKS cluster from the EKS console's **Get more add-ons**
next to Datadog's, Dynatrace's and New Relic's. It sends to OneUptime Cloud or
a self-hosted OneUptime; nothing in it is billed or licensed. Buyers read
[Install as an Amazon EKS add-on](https://oneuptime.com/docs/telemetry/kubernetes-agent#install-as-an-amazon-eks-add-on)
(`packages/App/FeatureSet/Docs/Content/<lang>/telemetry/kubernetes-agent.md`,
in every docs language).

|                     |                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product             | Container product, free, with one **Amazon EKS add-on** delivery option per version (`EksAddOnDeliveryOptionDetails`)                                                                                                            |
| Add-on              | `kubernetes-agent`, which EKS names `<seller alias>_kubernetes-agent` (editions.json `sellerAlias`, expected `oneuptime`); type `monitoring`; namespace `oneuptime-agent`. None of the three can change once a version has them  |
| Kubernetes versions | `compatibleKubernetesVersions` in `aws-eks-addon/delivery-option.json`: EKS's standard-support versions (1.34 to 1.37 on 2026-10-18)                                                                                             |
| What the buyer does | Creates the Secret `oneuptime-ingestion-key` (key `api-key`) in `oneuptime-agent`, then adds the add-on: no IAM role, no Helm                                                                                                    |
| A new version       | Published as **Limited** (the seller account's EKS clusters in ap-northeast-2, Seoul) once AWS has ingested it (5 to 10 business days), tested by us there on every Kubernetes version it names, then made public on our request |

### What the add-on is

`build.py --marketplace aws-eks-addon` builds the agent chart for AWS's add-on
rules (Seller Guide, "Requirements for Amazon EKS add-on products"), and the
marketplace suite checks each rule:

- **Every image from the add-on product's repositories**, linux/amd64 and
  linux/arm64 only: the collector, eBPF instrumentation, kube-state-metrics,
  OpenCost, Prometheus, and OneUptime's log tailer, cost poller and AI agent
  (`aws-eks-addon/images.json`). Third-party images keep the chart's pins;
  OneUptime's are tagged with the release, not `release`.
- **No secret in the configuration.** EKS refuses a configuration schema that
  takes keys, and shows configuration values in plain text: the agent reads
  the ingestion key from the Secret `oneuptime.existingSecretName` names
  (default `oneuptime-ingestion-key`), which the buyer creates.
- **The cluster's name from EKS**: the delivery option's environment override
  sets `clusterName` to `${AWS_EKS_CLUSTER_NAME}` at install. AWS's own checks
  render the chart without it, so values.yaml carries the placeholder
  `set-by-amazon-eks`; a cluster that shows up under that name in OneUptime
  means the override did not reach it.
- **What a buyer may set** is `aws_mp_configuration_schema.json`
  (`aws-eks-addon/configuration-schema.json`, JSON Schema draft-07: EKS takes
  no 2020-12): the URL, the Secret's name, labels, the `eks-fargate` preset,
  and logs, eBPF, the AI agent, kube-state-metrics and costs on or off. Each
  default there is the add-on's values.yaml's. The chart's own schema is
  open at its root, for the `k8version` value EKS renders add-ons with.
- **Nothing EKS cannot run**: no hook, no `lookup`, no CRD, no Release object
  but `.Name` and `.Namespace`, no subchart; no profiler and no debug sidecar
  (not offered, so their images are not shipped). Resources are named as the
  Helm install names them (`fullnameOverride: kubernetes-agent`).
- **eBPF is on**, as in the Helm install: its DaemonSet runs privileged, which
  AWS's least-privilege rule may question (eBPF sensors such as groundcover's
  and Upwind's are EKS add-ons). `ebpf.enabled: false` turns it off.

### One-time setup (maintainer)

1. **Create the product** (an agent may draft it; the maintainer submits it):
   **Server products > Create server product > Container**. Pricing **Free**.
   Product information from [the add-on's listing content](#the-add-ons-listing-content);
   EULA: the maintainer's choice (the agent is Apache-2.0). Initial repository
   `kubernetes-agent` (`helm push` names the chart's repository after the
   chart). **Submit** moves it to **Limited**.
2. **Its ID into the code** (agent, pull request): `aws_catalog.py find-product`
   lists the seller's container products; put the new one's ID in
   `editions.json`, `aws-eks-addon.productId`.
3. **Repositories**: `python3 HelmChart/Marketplace/automation/aws_catalog.py add-repositories --edition aws-eks-addon`
   creates `kubernetes-agent` (if the wizard did not) and one per image. They
   share the seller prefix with the Enterprise product's (`aws-eks-addon.registry`),
   under names that product does not use.
4. **The release role**: run `ci_setup.py aws --apply` again, so the workflow's
   role may add versions to the new product and list its open change sets.
5. **The add-on delivery option**: **Request changes > Add new version** must
   offer an **Amazon EKS add-on** delivery option. If it does not, ask AWS
   Marketplace Seller Operations (**Contact us** in the Management Portal) to
   enable EKS add-on delivery for the product: name the add-on
   (`kubernetes-agent`), its type (`monitoring`), its namespace
   (`oneuptime-agent`), the Kubernetes versions, and that it needs no IAM
   permissions. Confirm the seller alias EKS will put before the name, and
   correct `sellerAlias` (and the docs' `oneuptime_kubernetes-agent`) if it
   is not `oneuptime`.
6. **Ready**: set `"ready": true` for `aws-eks-addon` in `editions.json`.

### Releasing a version

The Marketplace Release workflow does it, as for the other editions:
`aws-eks-addon-push` builds the edition from the released agent chart, copies
its images and pushes its chart; `aws-eks-addon-publish`, once a maintainer
approves it, adds the version (`AddDeliveryOptions`, Visibility Limited) and
writes the testing steps to the run's summary. **The weekly run adds no new
add-on version while AWS is still applying one, or one is Limited**: each
version costs AWS's ingestion and our testing, so they never pile up. A run
by hand (**marketplaces**: `aws-eks-addon`) ships whatever. By hand:

```bash
VERSION=X.Y.Z
OUT="$(mktemp -d)/oneuptime-eks-addon"
python3 HelmChart/Marketplace/build.py --marketplace aws-eks-addon --version "$VERSION" --out "$OUT"
HelmChart/Marketplace/mirror-images.sh "$OUT/images.json"
helm package "$OUT/kubernetes-agent" --destination "$OUT"
helm push "$OUT/kubernetes-agent-$VERSION.tgz" "oci://709825985650.dkr.ecr.us-east-1.amazonaws.com/<sellerName>"
python3 HelmChart/Marketplace/automation/aws_catalog.py plan --edition aws-eks-addon --images-json "$OUT/images.json" --version "$VERSION" --out "$OUT/change-set.json"
python3 HelmChart/Marketplace/automation/aws_catalog.py submit --change-set "$OUT/change-set.json" --name "OneUptime Kubernetes agent $VERSION"
```

**Testing (maintainer; it costs money)**: once the request shows **Success**
(the version is Limited), in the seller account, in ap-northeast-2:

1. Create an EKS cluster on each Kubernetes version the version names, with
   two small nodes (one amd64, one arm64 Graviton, so both images run).
2. In each: create the namespace `oneuptime-agent` and the Secret
   `oneuptime-ingestion-key` with a test project's ingestion key, then
   `aws eks create-addon --cluster-name <cluster> --addon-name oneuptime_kubernetes-agent --addon-version <version>`.
3. Check the add-on is `ACTIVE`, every pod runs, and the cluster shows in
   OneUptime under its EKS name (not `set-by-amazon-eks`) with metrics, logs
   and eBPF traces. Try a configuration value (`{"kubeStateMetrics": {"enabled": true}}`
   with `update-addon`), and on one cluster a Fargate profile with
   `{"preset": "eks-fargate"}`.
4. Keep the clusters until AWS makes the version public; scale the nodes down
   meanwhile.

**Going public**: `python3 HelmChart/Marketplace/automation/aws_catalog.py go-public --version X.Y.Z`
(the maintainer, signed in: the workflow's role cannot), which asks AWS to
make that version public (`UpdateDeliveryOptionsVisibility`); AWS refuses it
until the testing is done. The first time, the product itself must be public
first: **Request changes > Update visibility**.

**New EKS versions**: AWS gives sellers 45 days after a new EKS version is
generally available to support it. Test the newest add-on version on it, add
it to `compatibleKubernetesVersions` (the next version carries it), and drop
versions that leave extended support.

### The add-on's listing content

**Name:** OneUptime Kubernetes Agent

**Short description:**

```text
The OneUptime Kubernetes agent as an Amazon EKS add-on: your cluster's metrics, events, pod logs and eBPF traces in OneUptime, installed and upgraded by EKS.
```

**Long description** (AWS asks an add-on to another product, and one that
needs an ongoing connection, to say so):

```text
The OneUptime Kubernetes agent sends your EKS cluster's metrics, Kubernetes events and pod logs to OneUptime over OpenTelemetry, and with eBPF the traces, request metrics and service map of every pod, with no code changes and no SDKs. It also runs the Kubernetes AI agent, which runs read-only kubectl while OneUptime AI investigates an incident or alert on the cluster.

This product extends the functionality of OneUptime and without it, this product has very limited utility: it needs a OneUptime project, on OneUptime Cloud (also on AWS Marketplace) or on your own OneUptime. This product requires an ongoing internet connection to that OneUptime, over HTTPS.

Before you add it, put your OneUptime ingestion key in the Kubernetes Secret oneuptime-ingestion-key, in the oneuptime-agent namespace. Guide: https://oneuptime.com/docs/telemetry/kubernetes-agent#install-as-an-amazon-eks-add-on
```

**Highlights:** metrics, events and pod logs from every node, with no
configuration; eBPF traces and the service map, with no code changes;
read-only AI investigations of the cluster's incidents.

The delivery option's description and usage instructions are
`aws-eks-addon/delivery-option.json` (the workflow sends them).

## Policy questions to settle before submitting

Settle these with each marketplace before the first submission; each can
cost a review round.

- **AWS: password-based authentication.** AWS's
  [container policies](https://docs.aws.amazon.com/marketplace/latest/userguide/container-product-policies.html)
  say services in the containers must not use password-based authentication,
  "even if the password is generated". OneUptime's bundled PostgreSQL,
  ClickHouse and Valkey authenticate inside the cluster with passwords the
  chart generates into Kubernetes Secrets, and people sign in to OneUptime
  with a password or single sign-on. Ask Seller Operations, before building
  anything around it, whether this applies to an application's own users and
  to databases reachable only inside the cluster.
- **AWS: secrets in the chart's schema.** AWS's chart validation refuses a
  configuration schema with fields that take passwords, keys or secrets.
  `values.schema.json` has some (`oneuptimeSecret`, `encryptionSecret`, the
  database passwords); each can come from an existing Secret instead
  (`externalSecrets`). If AWS flags them, drop them from the AWS edition's
  schema.
- **AWS: running as root.** Images "should be configured to run with non-root
  privileges by default"; the OneUptime `nginx` and `probe` images run as
  root. A recommendation, not a rule: expect the question.
- **Google: the product type and the registry** (step 2 of the Google
  setup).
- **Vulnerability scans on every release**, on all three (see
  [Before every release](#before-every-release)).

## Known gaps

- Google Cloud's values in `editions.json` are placeholders until Producer
  Portal has the product.
- **Google Cloud deployments have no upgrade path yet.** Google Cloud
  Marketplace never updates a deployed app, and a deployer-based app has no
  upgrade button: Google asks sellers to document the upgrade steps, and the
  buyer guide only says to contact support. Settle it with the Partner
  Engineer (Terraform-based Kubernetes apps update in place) before the
  Google listing goes live.
- **Google's version is added by hand** in Producer Portal: Google has no API
  for it. The workflow pushes everything and writes what to add.
- **The automation has met the real listings only in part.** Checked against
  them on 2026-10-18: AWS's product description (a draft lists a placeholder
  version), and what Partner Center answers: it spells `externalId` and
  `jobId`, and a bundle reference's `tenantId` and `subscriptionId` (the docs'
  examples say `tenantID` and `subscriptionID`, which it refuses), and answers
  400 ("has no published submission"), not 404, for a target the offer was
  never published to. And `cpa` 1.3.59 reads the ARM template from
  `clusterArmTemplate`, as Microsoft's samples spell it (the docs' table says
  `clusterARMTemplate`, which it rejects as missing). AWS refused 14.0.72's
  version (MISSING_VALUES_IMAGE_REFERENCE): it takes an image only as
  values.yaml spells it out with a repository and its registry and tag beside
  it, not as a full reference in `image.overrides`; the chart takes that form
  since 2026-10-19, and `build.py` refuses an AWS edition of an older release.
  Not yet: AWS's version change set and Microsoft's publish to preview, until
  their first success.
- `mpdev verify` does not run in the workflow (it needs a GKE cluster, which
  costs money): Google's review runs the same checks on every version.
- Microsoft and Google editions install on `linux/amd64` nodes only.
- **The EKS add-on has not met AWS yet** (2026-10-18): the add-on delivery
  option's fields are AWS's published shapes, and the chart passes AWS's own
  `helm lint` and `helm template` with Helm 3.19.0, but nothing has been
  submitted. Unverified until the first version: the seller alias, whether the
  environment override fills `clusterName` in, the release name EKS renders
  with (the chart does not depend on it), and AWS's scan of the agent's
  images. Scanned with trivy 0.75.0 on 2026-10-18, both architectures: no
  fixable critical finding in any of them; fixable high ones in
  kube-state-metrics v2.20.0 (9), Prometheus v3.15.0 (8), OpenCost 1.121.3
  (7), the collector 0.161.0 (4: Go 1.26.8 and x/net, fixed in 0.163.1),
  OBI v0.14.0 (4) and the AI agent's kubectl (13). Scan again before each
  submission (`trivy image --severity HIGH,CRITICAL --ignore-unfixed
  <source>`, for each source in the edition's `images.json`).

## History

Add a row for every product created, value recorded, submission, approval,
rejection, go-live and price change.

| Date       | Marketplace | What happened                                                                                       | Who        |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------- | ---------- |
| 2026-10-17 | All three   | Pricing approved: per user-hour, USD 0.10, one public plan per marketplace, deals as private offers | Maintainer |
| 2026-10-17 | All three   | Billing, licensing and packaging merged with this guide; nothing submitted to any marketplace       | Agent      |
| 2026-10-17 | All three   | The Marketplace Release workflow and the one-time CI setup added; nothing set up yet                | Agent      |
| 2026-10-18 | All three   | The workflow ships weekly and skips what a marketplace has; the registries keep 3 releases by count | Agent      |
| 2026-10-18 | All three   | The editions turn off OneUptime's update check: buyers upgrade through their marketplace            | Agent      |
| 2026-10-18 | AWS         | Container product prod-5ijwaqpun3coo, code c8qvytt92i74r7bhzi6nxunsi, created as a draft (API)      | Agent      |
| 2026-10-18 | AWS         | Offer offer-nazez256wqin4 drafted: Standard EULA, Cloud's refund policy, `users` at USD 0.01        | Agent      |
| 2026-10-18 | Microsoft   | Offer `oneuptime-enterprise` drafted (API): plan `enterprise`, `users` at USD 0.10, Cloud's terms   | Agent      |
| 2026-10-18 | Microsoft   | Registry `oneuptimemarketplace` (Basic, daily purge); the release app is a Partner Center Manager   | Agent      |
| 2026-10-18 | Google      | Artifact Registry `oneuptime` (us, keeps 3 releases), the release service account and Workload ID   | Agent      |
| 2026-10-18 | GitHub      | Release environments (reviewers simlarsen, nawazdhandala) and variables; releases not enabled yet   | Agent      |
| 2026-10-18 | Microsoft   | First real run: cpa 1.3.59 wants `clusterArmTemplate`, not the docs' `clusterARMTemplate`; fixed    | Agent      |
| 2026-10-18 | AWS         | The Kubernetes agent's EKS add-on: edition, release jobs and docs added; no product created yet     | Agent      |
| 2026-10-19 | AWS         | Product prod-5ijwaqpun3coo and offer offer-nazez256wqin4 released to Limited                        | Maintainer |
| 2026-10-19 | Microsoft   | The registry's purge keeps each repository's newest release, and any from the last 7 days           | Agent      |
| 2026-10-19 | AWS         | AWS refused 14.0.72: MISSING_VALUES_IMAGE_REFERENCE; the chart takes registry, repository and tag   | Agent      |
| 2026-10-21 | Microsoft   | Offer `oneuptime-enterprise` seen live (publisher `oneupitme`); the website links it                | Agent      |
| 2026-10-27 | All three   | The editions turn off the daily check-in with oneuptime.com: the marketplace knows its buyers      | Agent      |

## Notes for agents driving the browser

- Work in the maintainer's own signed-in sessions. Never create seller
  accounts, and never type passwords, tax IDs, bank details or card numbers:
  stop and ask the maintainer to do those steps.
- Never accept agreements, set or change a price, or press **Submit**,
  **Review and publish**, **Go live**, **Update visibility** or **Submit for
  review** without the maintainer's go-ahead for that exact action, in chat.
- Portal pages lose unsaved text when you leave them; save each page before
  moving on.
- Uploads (logos, screenshots) may need a person: save the files where they
  can reach them and ask.
