# Cloud Costs and Savings

A connected cloud account also says what it costs and how it could cost less. OneUptime reads each day's costs from your cloud's own billing and the recommendations of your cloud's own recommender, shows them under **Cloud → Spend → Costs** and **Cloud → Spend → Savings**, lists your Savings Plans, reservations and committed use discounts under **Cloud → Spend → Commitments**, and alerts before a month costs more than its budget under **Cloud → Spend → Budgets**.

:::cards
- [Amazon Web Services](#amazon-web-services): Cost Explorer and Cost Optimization Hub, each turned on once.
- [Microsoft Azure](#microsoft-azure): Cost Management and Azure Advisor, with one more role.
- [Google Cloud](#google-cloud): Your billing export to BigQuery, and the Recommender.
- [Billed, amortized and net](#billed-amortized-and-net): Each cost three ways, so commitments and credits land where the money went.
- [Commitments](#commitments): Every commitment, alerts before one ends or while it is under-used, and what to renew or buy.
- [Budgets](#budgets): An alert as a month's spend passes a share of its budget.
:::

## How it works

```mermaid title="From your cloud's billing to Cloud's pages"
flowchart TB
    bill["Your cloud's billing,<br/>read twice a day"] --> costs["Costs"]
    rec["Your cloud's recommender,<br/>read once a day"] --> savings["Savings"]
    costs --> budgets["Budgets that alert"]
    costs --> overview["Cloud's Overview"]
    savings --> overview
```

- **Costs come from your cloud's own billing.** AWS Cost Explorer, Azure Cost Management and Google Cloud's billing export to BigQuery, in the currency the account is billed in, each kept billed, amortized and net: see [Billed, amortized and net](#billed-amortized-and-net). Each figure is a day's, in UTC days as your cloud bills them.
- **A cloud reports the last day or two late.** Each read takes the last week again, and all of last month in a month's first days, so a day's cost settles as your cloud finishes it. A connection's first read goes back to the start of the month before last.
- **The month's projection is the last week's pace.** It is what the month cost so far, with each day still to come at the average of the last seven full days.
- **Savings come from your cloud's own recommender.** AWS Cost Optimization Hub, Azure Advisor and Google Cloud's Recommender: a smaller size, a resource left idle, a commitment worth making, each with what it would save a month. One you act on or dismiss in your cloud's console goes away on the next read.

## Before you begin

- **A connected account.** [Connect a Cloud Account](/docs/telemetry/cloud-accounts) with today's setup command: it lets the connection read costs and recommendations. A connection made before reads neither until you run its command again.

## Amazon Web Services

The connection reads costs with `ce:GetCostAndUsage`, its commitments with `ce:GetSavingsPlansCoverage`, `ce:GetSavingsPlansUtilization`, `ce:GetSavingsPlansUtilizationDetails`, `ce:GetReservationCoverage` and `ce:GetReservationUtilization`, the Savings Plans bought with `savingsplans:DescribeSavingsPlans`, and recommendations with `cost-optimization-hub:ListRecommendations` and `cost-optimization-hub:GetRecommendation`. The setup command grants Cost Explorer's reads as three families, `ce:GetCostAndUsage*`, `ce:GetSavingsPlans*` and `ce:GetReservation*`, all of them reads, so an access key's user still fits the 2,048 characters IAM allows its policy. Cost Explorer and Cost Optimization Hub each need turning on in the account first:

:::steps
### Turn on Cost Explorer

Open Cost Explorer once in the AWS Billing and Cost Management console: AWS prepares the account's costs within a day. Connect the organization's management account to read every member account's costs.

### Opt in to Cost Optimization Hub

Open Cost Optimization Hub in the same console and opt in, for the organization from its management account or for the account alone. Its recommendations come within a day.
:::

Cost Explorer charges $0.01 for each request: a read of the costs makes two or a few more, one for billed and amortized and one for net, and the commitments are read with four a day for their coverage and use, and six to twelve more a day for each one's own. The Savings Plans API and Cost Optimization Hub are free.

### Costs per resource

Cost Explorer also says what each resource costs, for the last 14 days, once resource-level data is turned on. In the AWS Billing and Cost Management console, open Cost Management preferences and turn on resource-level data at daily granularity, for the organization from its management account. AWS prepares it within 48 hours.

Then edit the connection under **Cloud → Connect**, and under **More fields** turn on **Costs per resource**. The connection reads them with `ce:GetCostAndUsageWithResources` once a day: the 14 days the first time, then the last three again, with a few requests each time. What it reads stays with the account's costs after Cost Explorer forgets it. A connection made before needs its setup command run again, which adds the action.

## Microsoft Azure

The app reads costs with the **Cost Management Reader** role, on the same scope as **Monitoring Reader**: the setup command grants both. Azure Advisor's recommendations are read with **Monitoring Reader**, so there is nothing to turn on. To give an app made before the role, run:

```bash
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

Cost Management answers for each subscription, with the resource each cost is for, and costs nothing to read. When it cannot answer for a subscription, the account's **Costs** says why.

Cost Management limits how fast a tenant's costs are read, the same for everyone who reads them: each query costs a query processing unit (QPU) for every month of data it reads, and a tenant has 12 QPU every 10 seconds, 60 a minute and 600 an hour. OneUptime reads a tenant's subscriptions one after another within two thirds of each, waits as long as Cost Management asks when it turns a query away, and goes on at the next read where it stopped. A subscription not read yet says **Queued**, with when it is read, and one that already has figures keeps them meanwhile. Its amortized cost is read at every read and its actual cost once a day, so a subscription's first read asks Cost Management twice and takes twice the query units: a large tenant's first figures take a few reads more.

The tenant's reservations and savings plans are read with **Reservations Reader** and **Savings plan Reader**, which Azure gives at the tenant's own scope, where only a Global Administrator with elevated access may grant them. The setup command tries, and says so when it may not. To grant them later, as a Global Administrator with elevated access:

```bash
az role assignment create --assignee <APP_ID> --role "Reservations Reader" --scope /providers/Microsoft.Capacity
az role assignment create --assignee <APP_ID> --role "Savings plan Reader" --scope /providers/Microsoft.BillingBenefits
```

Without them, costs and recommendations are read as before, and **Cloud → Spend → Commitments** says which role to grant.

## Google Cloud

Google Cloud has no API for a project's costs: OneUptime reads them from your billing account's export to BigQuery.

:::steps
### Export your billing to BigQuery

In the Google Cloud console, open Billing, then Billing export, and turn on the detailed usage cost export to a BigQuery dataset. Google writes it a few hours behind, from the day you turn it on.

### Let the service account read it

Give the connection's service account **BigQuery Data Viewer** on the export's dataset. The setup command already gave it **BigQuery Job User**, to run the query in its own project.

### Name the export's table

Edit the connection under **Cloud → Connect**, and under **More fields** set **Billing export table** to the table's full name: `<PROJECT_ID>.<DATASET>.gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>`.
:::

The detailed export names the resource each cost is for; the standard one says the service and Region only. BigQuery bills the query: the first 1 TiB a month is free, then $6.25 per TiB, and a month of an export is a few megabytes to a few gigabytes. The Recommender's machine type and idle resource recommendations are read with **Compute Recommender Viewer**, which the setup command grants, and cost nothing. Compute Engine's commitments are listed from Cloud Asset Inventory with **Cloud Asset Viewer**, which the setup command already grants: nothing more to give.

## Billed, amortized and net

Every cost is kept three ways, and **Cloud → Spend → Costs**, an account's **Costs**, Cloud's Overview and budgets show the one you choose:

- **Billed** is each charge on the day your cloud billed it, before credits and refunds. A Savings Plan or a reservation paid up front is one large charge on the day it was bought, and the usage it covers looks free for the rest of its term.
- **Amortized** spreads each commitment's fees over the days and resources it covers, so the money lands where it was spent. Still before credits and refunds. It is what the pages show unless you choose another.
- **Net** is amortized, less credits, refunds and discounts: what the invoice comes to.

| | Billed | Amortized | Net |
|---|---|---|---|
| AWS | Cost Explorer's unblended cost | Cost Explorer's amortized cost | Cost Explorer's net amortized cost, credits and refunds included |
| Azure | Cost Management's actual cost | Cost Management's amortized cost | The amortized cost: Azure takes credits off at the billing account, which a subscription's connection does not read |
| Google Cloud | The export's cost | The cost less the committed use discounts' and subscriptions' credits | The cost less every credit |

The switch above the figures changes the basis on the page, and OneUptime remembers your choice on this project, in your browser. The project's own basis, the one the pages open on and budgets watch, is under **Cloud → Settings → Cost Settings**. A budget can watch a basis of its own: edit it and set **Cost Basis**.

Costs read before the three were kept read their billed figure on every basis. Each connection reads its costs again once, as far back as a first read, so each basis fills in.

## Ways to spend less

**Cloud → Spend → Savings** lists every recommendation, the largest saving first: what to do, to which resource, what would change and what it saves a month. The strip above it adds them up, in all and by kind: a smaller size, a resource left idle, a commitment. A recommendation links to its resource's page when OneUptime holds the resource.

### Right-sizing from OneUptime's own readings

A resource no recommender speaks for, because the recommender is not turned on, does not cover its type or finds it too new, is sized by OneUptime from the CPU and memory readings its connection took over the last 14 days. OneUptime sizes EC2 instances, RDS databases and ElastiCache clusters on AWS, virtual machines, PostgreSQL and MySQL flexible servers and App Service plans on Azure, and Compute Engine VMs and Cloud SQL instances on Google Cloud:

- **Over-provisioned** when the size half as big, or a quarter, would still have room: on the smaller size, its CPU's 95th percentile would be at most 60%, its highest CPU reading at most 100%, and its memory's peak at most 70% when its memory is read.
- **Under-provisioned** when its CPU's 95th percentile is 85% or more, or its memory's peak 90% or more: the size twice as big.

A resource is sized once it has 6 days of readings. Its page shows its **Right-sizing** beside what it costs, and an over-provisioned one is listed under **Cloud → Spend → Savings** with OneUptime as its source. What a change saves is its share of what the resource cost over the last 30 days, so it is known once your cloud bills the resource by name: Azure and Google Cloud's detailed export do, and AWS does once Costs per resource is on. An EC2 instance reports its memory only with the CloudWatch agent, and a Compute Engine VM only with the Ops Agent: without one, it is sized by its CPU alone. Burstable sizes, such as t3, B-series and e2-micro, are never sized.

### Commitments

**Cloud → Spend → Savings** and an account's **Costs** show how much of the last 30 days' spend each account's commitments paid for, and how much of them was used, a line for each kind:

- AWS: Savings Plans and Reserved Instances, from Cost Explorer. An organization's management account reads them for every account of the organization.
- Azure: savings plans and reservations, from Cost Management, in amortized cost.
- Google Cloud: committed use discounts, from your billing export. The export does not say how much of a commitment went unused, so how much is used is not shown.

An account with none says what ran at on-demand rates that a commitment would pay for at a lower rate. Each kind's figures are its cloud's own, and kinds are never added together: a reservation and a savings plan can both count the same machine's spend as theirs to cover. Each commitment on its own is listed under **Cloud → Spend → Commitments**: see [Commitments](#commitments).

## Commitments

**Cloud → Spend → Commitments** lists every Savings Plan, reservation and committed use discount your connections can read, so none ends unnoticed:

- **Active Commitments**, above them, counts the active ones and those that end within 90 days, **Utilization** how much of them was used over the last 30 days and what was left unused, and **Coverage** how much of the spend they cover.
- **Ending Soon** lists the ones that end within 90 days and do not renew themselves, each with its renewal plan: what to buy to keep its discount (its hourly commitment, or its instances, at the share of it that was used), what that costs and saves a month, when it breaks even, and how much of the spend is covered now and once it ends. **Renew in Console** opens the page your cloud renews it on.
- **All Commitments** is the whole list: what each one is and covers, its account, when it ends, its term and payment option, how much of it was used over the last 30 days, and the usage it paid for and what that saved.
- **Purchase Plans** are what your cloud's recommender suggests buying, each with what it would cost and save a month, when it would break even, and how coverage would change. **Buy in Console** opens the page to buy it on.
- Under them, each account's commitments by kind, as its **Costs** shows them, and when the commitments alert, with **Change Alerts**.

OneUptime only plans: it never buys, renews or returns a commitment. You buy in your cloud's console.

| | Where the commitments come from | What is known of each |
|---|---|---|
| AWS | Cost Explorer's Savings Plans and Reserved Instances, each with its own use, and the Savings Plans API for the plans bought, those queued to start included | Its end, term, payment option, hourly commitment or instances, fees, and use over the last 30 and 7 days |
| Azure | The tenant's reservations and savings plans | Its end, term, billing plan, whether it renews itself, and use over the last 30 and 7 days |
| Google Cloud | Compute Engine's commitments, from Cloud Asset Inventory | Its end, plan, resources and whether it renews itself. Google Cloud does not say how much of a commitment is used |

An organization's management account lists every account's on AWS. Spend-based committed use discounts, which Google Cloud keeps on the billing account rather than in a project, are not listed yet.

### Commitment alerts

Commitments raise alerts, paged through on-call policies as any alert is. Under **Cloud → Settings → Cost Settings**, **Commitment Alerts** says when:

- **Alert Before a Commitment Ends**: 90, 30 and 7 days before its end to start with. One alert at the nearest of those days the commitment has reached, each nearer one taking over from the one before. A commitment that renews itself, or whose renewal is queued to start when it ends, raises none.
- **Alert When Utilization Is Below**: 80% to start with, of a commitment's last 7 days, once it has run a week. The alert resolves when its use is back.
- **Alert When Coverage Falls Below**: 60% to start with, of the spend an account's commitments of one kind could cover, having covered more. It resolves when coverage is back. Empty, coverage raises no alert.

**Alert On Commitments** turns them all off, and **Alert Severity**, **On-Call Policies** and **Owners** say how severe they are, who is paged and who owns them. Each alert says what the commitment covers and what it paid for, and points to its renewal plan. An alert resolves by itself when its commitment ends, renews or is no longer listed.

## Budgets

:::steps
### Create a budget

Under **Cloud → Spend → Budgets**, create a budget: its **Monthly Amount**, the **Account** it is for, or none for every account, and the **Cost Basis** it counts, or none for the project's.

### Choose when it alerts

**Alert At** takes the shares of the budget to alert at, in percent: 80 and 100 to start with. **Alert When On Course To Pass** also alerts, once a month, when the last week's pace would take the month past the budget. **Alert On Unusual Days** also alerts the day after a day that cost far more than usual: see [Unusual days](#unusual-days). **Alert Severity** and **On-Call Policies** say how severe the alerts are and who is paged.
:::

A budget is checked after every read of the costs and every hour. As the month's spend passes a threshold, one alert is raised for it, the highest when a read passes several at once, and a new month resolves the last month's alerts. A budget counts only the accounts billed in its currency, on its basis: an amortized budget is not set off by a commitment bought up front, which a billed one counts on the day it was bought.

AI agents can create and change budgets through the [MCP server](/docs/ai/mcp-server), and scripts with the CLI's `oneuptime cloud-budget` command: see [Resource Operations](/docs/cli/resource-operations).

### Unusual days

After every read, each of an account's last 14 full days is held to the 14 days before it. A day is unusual when a service cost twice its usual day or more, or the whole account one and a half times its usual day or more. Either must be at least 10 more than usual, in the account's currency, and at least 5% of the account's usual day, so a few cents are never a spike. A day's usual is the median of the 14 days before it, so one spike moves it little, and an account is judged only once it has a week of costs.

**Cloud → Spend → Costs** marks the unusual days on the daily spend, above their bars, and lists them under it. Over every account, each mark opens its account's **Costs**. A budget that counts the account raises one alert for each account and day, the day after, naming every service that ran high. A spike that goes on for days is reported on the day it began, and a day more than a week old is not reported. A budget made before these alerts existed does not raise them until you edit it and turn them on.

## Where the money goes

**Cloud → Spend → Costs** breaks a period's spend down by service, Region, account or resource, and three more ways:

- By App Platforms environment: each environment's platform service in its account and Region, such as Amazon ECS or Cloud Run, and an Elastic Beanstalk environment's resources by the tag AWS gives them.
- By app: what a platform bills an app by name, such as a Cloud Run service or a Container App. Amazon ECS bills its tasks and App Service its plans, so their apps' costs stay their environment's.
- By tag: each value of the tag you pick. A cost keeps the tags it had when it was read: a Google Cloud billing export's labels, else the tags of the resource it is billed to, which on AWS needs Costs per resource.

Under the list, the card says what the rest came to: what is in no environment, what an environment is billed as a whole, or what does not carry the tag. Costs read before tags were kept are read again once, as far back as a first read, so their tags fill in.

## What you see in OneUptime

- **Cloud's Overview.** **Cloud → Overview** shows the month's spend against last month's by the same day, the services that cost the most and the largest ways to spend less, beside what needs attention.
- **Every day's spend.** **Cloud → Spend → Costs** draws each of the last 30 days with the days that cost far more than usual marked, lists those days and breaks a period down by service, Region, account, resource, App Platforms environment, app or tag, billed, amortized or net. The accounts whose costs are not read are listed under it, each with why.
- **Every commitment.** **Cloud → Spend → Commitments** lists each one with when it ends and how much of it is used, the ones ending soon with what to renew, and what to buy.
- **An account's costs.** An account's **Costs** shows the same for the account alone, with its commitments and its ways to spend less.
- **A resource's cost.** A resource's page shows what it cost this month and in the last 30 days when its cloud bills it by name, with its ways to spend less and its right-sizing.

## Troubleshooting

:::details An account says Needs permission
The connection may not read the account's costs yet. Run its setup command again from **Cloud → Connect**: it adds what reading costs needs. On Google Cloud, also give the service account **BigQuery Data Viewer** on the export's dataset.
:::

:::details An account says Not set up
Its cloud has no costs to give yet. On AWS, turn on Cost Explorer; on Google Cloud, name the export's table under **Billing export table**. The first figures come with the next read, within 12 hours.
:::

:::details An account says Queued
Its costs wait their turn: Azure Cost Management limits how fast a tenant's costs are read. The account says when they are read, at the connection's first read from then, and nothing needs doing. An account that already has figures keeps them meanwhile.
:::

:::details Costs per resource says Not set up
Resource-level data is not turned on for the account. Turn it on at daily granularity in the Cost Management preferences of the AWS Billing and Cost Management console, from the organization's management account for its members. AWS prepares it within 48 hours, and the next day's read takes it.
:::

:::details The commitments say Needs permission
The connection may not read the account's Savings Plans and reservations yet. Run its setup command again from **Cloud → Connect**: it adds the actions they are read with. On Azure, a Global Administrator with elevated access grants **Reservations Reader** and **Savings plan Reader**: see [Microsoft Azure](#microsoft-azure).
:::

:::details Amortized and net show the same as billed
Costs read before the three were kept show their billed figure on every basis until the connection's next read of costs, which reads them again as far back as its first read. On Azure, net is always the amortized cost.
:::

:::details A commitment ends and no alert came
A commitment that renews itself, or whose renewal is queued to start when it ends, raises none, and neither does one in a project whose commitment alerts are off under **Cloud → Settings → Cost Settings**. An alert also needs the project to have an alert severity.
:::

:::details The figures leave an account out
The figures are in the currency most of your accounts are billed in. An account billed in another is listed under them with its currency, and a budget counts only the accounts billed in its own.
:::

:::details This month is lower than in your cloud's console
Your cloud reports the last day or two late, and billed and amortized figures are before credits and refunds. The next reads catch up. Compare the basis your cloud's console shows: AWS opens on unblended costs, which is billed.
:::

## Next steps

:::cards
- [Connect a Cloud Account](/docs/telemetry/cloud-accounts): Connect another account, or run its command again.
- [Cloud Resources](/docs/telemetry/cloud-resources): Every resource's metrics, from a collector of your own.
- [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost): What each Kubernetes workload costs.
:::
