# Connect a Cloud Account

Connect an AWS account, an Azure subscription or a Google Cloud project from the dashboard, and OneUptime lists every resource in it, reads their key metrics and says how each is doing, records what changed in them and what your cloud provider says about their health, and reads what the account costs and how it could cost less. You run one command in your cloud's own browser terminal and paste what it prints: there is no collector to run and nothing to install.

:::cards
- [Amazon Web Services](#amazon-web-services): An IAM role OneUptime signs in to, or an access key.
- [Microsoft Azure](#microsoft-azure): An app with the Monitoring Reader and Cost Management Reader roles.
- [Google Cloud](#google-cloud): A service account with six read-only roles.
- [What OneUptime reads](#what-oneuptime-reads): Resources, metrics, changes, health events and costs, how often, and what reading them costs.
- [Cloud Costs and Savings](/docs/telemetry/cloud-costs): What each account costs, the ways to spend less, and budgets that alert.
- [Stream CloudWatch Metrics and Logs](/docs/telemetry/cloud-streaming): Every metric within minutes, and CloudWatch Logs, through Amazon Data Firehose.
- [Stream Azure Monitor Metrics and Logs](/docs/telemetry/cloud-streaming-azure): Key metrics within minutes, and resource logs, read from event hubs in your subscription.
- [Stream Google Cloud Logs](/docs/telemetry/cloud-streaming-google-cloud): Every log as it is written, pushed through Pub/Sub.
- [Data security](#data-security): What the connection lets Data Security read, and what each level adds to the command.
- [Let AI fix problems](#let-ai-fix-problems): One more command, and OneUptime AI can fix what it finds.
:::

## How it works

```mermaid title="From your cloud to Cloud Resources"
flowchart TB
    cmd["One command in<br/>your cloud's terminal"] --> access["Read-only access"]
    access --> ou["OneUptime reads it<br/>every few minutes"]
    ou --> res["Cloud Resources"]
    ou --> met["Metrics"]
    ou --> chg["Changes and<br/>health events"]
```

- **The access can only read.** The command creates access that reads your resources and how they are set up, their metrics, what changed, your provider's health events and what the account costs, and nothing else: the actions listed below on AWS, the **Monitoring Reader** and **Cost Management Reader** roles on Azure and six viewer roles on Google Cloud. OneUptime never reads data or secrets with it, except log lines when you let AI read an account's logs, and content samples when you turn them on for [Data security](#data-security). Delete it to cut OneUptime off.
- **OneUptime reads on a schedule.** Every 5 minutes for Azure and Google Cloud, and every 10 minutes for AWS, unless you pick another interval when you connect. Each read also records what changed since the last one, and every 30 minutes a read lists every resource again.
- **Each resource has a page of its own.** Resources appear under **Cloud → All Resources** with their health, key metrics, owners and labels. A listed resource's page also shows its **Connected Resources** (what it runs in, what sends it traffic), its endpoints, tags and settings, and its **Incidents**, **Alerts** and **Changes**.
- **Each account has a page of its own.** Accounts appear under **Cloud → Accounts** with their resources by type and Region, their **Costs**, their **Changes**, and a **Topology** of how their resources fit together.
- **Cloud opens on its Overview.** **Cloud → Overview** lists the resources that need attention and why, what the accounts cost this month, and what your clouds say could be saved. [Cloud Costs and Savings](/docs/telemetry/cloud-costs) says how costs, savings and budgets are read. When your accounts run apps on managed app platforms, its **App Platforms** card counts their environments and apps, and each count opens that list in App Platforms, already filtered to those accounts.
- **OneUptime AI reads what changed.** An investigation of an incident or an alert linked to a cloud resource reads that resource's changes first, and reads the account's activity log again as it starts.

## Before you begin

- **A project owner or admin.** Only they can connect, test and edit cloud accounts.
- **Your cloud's terminal** (AWS CloudShell, Azure Cloud Shell or Google Cloud Shell), signed in as someone who can create an IAM role or user, an app registration or a service account.

## Amazon Web Services

:::steps
### Open the AWS form

Go to **Cloud → Connect** and pick **Amazon Web Services**.

### Run the command in AWS CloudShell

Pick how OneUptime signs in. An **IAM role** is the recommended way: nothing secret is stored, and you can delete the role at any time. The form shows the command written for your project: it creates a role that trusts OneUptime's AWS account with your project's external ID, and prints the role's ARN.

Under **What to read**, pick this account, or every account in your AWS Organization. Run the organization's command in its management account: it adds a StackSet that puts the same role in every account, now and as accounts join, and lets the management account's role list the accounts. One connection reads up to 50 accounts.

Use an **Access key** when a role is not possible: it reads its own account only. This command creates a user with the same permissions and prints its key:

```bash
aws iam create-user --user-name OneUptimeReadOnly > /dev/null 2>&1 || true
aws iam put-user-policy --user-name OneUptimeReadOnly --policy-name OneUptimeReadOnly --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["cloudwatch:GetMetricData","cloudwatch:ListMetrics","tag:GetResources","iam:ListAccountAliases","cloudformation:ListResources","ec2:DescribeInstances","ec2:DescribeVolumes","ec2:DescribeVpcs","ec2:DescribeNatGateways","autoscaling:DescribeAutoScalingGroups","elasticloadbalancing:DescribeLoadBalancers","elasticloadbalancing:DescribeLoadBalancerAttributes","elasticloadbalancing:DescribeTargetGroups","elasticloadbalancing:DescribeTargetGroupAttributes","elasticloadbalancing:DescribeTargetHealth","elasticloadbalancing:DescribeTags","ecs:ListClusters","ecs:DescribeClusters","ecs:ListServices","ecs:DescribeServices","lambda:ListFunctions","rds:DescribeDBInstances","rds:DescribeDBClusters","elasticache:DescribeReplicationGroups","sqs:ListQueues","sqs:GetQueueAttributes","sns:ListTopics","sns:GetTopicAttributes","sns:ListSubscriptionsByTopic","dynamodb:ListTables","dynamodb:DescribeTable","kinesis:ListStreams","kinesis:DescribeStreamSummary","states:ListStateMachines","states:DescribeStateMachine","cloudfront:ListDistributions","elasticfilesystem:DescribeFileSystems","es:ListDomainNames","es:DescribeDomains","apprunner:ListServices","apprunner:DescribeService","elasticbeanstalk:DescribeEnvironments","cloudtrail:LookupEvents","health:DescribeEvents","health:DescribeEventDetails","ce:GetCostAndUsage","ce:GetCostAndUsageWithResources","ce:GetSavingsPlansCoverage","ce:GetSavingsPlansUtilization","ce:GetReservationCoverage","ce:GetReservationUtilization","cost-optimization-hub:ListRecommendations","rds:DescribeEvents","autoscaling:DescribeScalingActivities","ec2:DescribeInstanceStatus","ecs:DescribeTaskDefinition","lambda:GetFunctionConfiguration","lambda:GetFunctionConcurrency","lambda:GetAlias","servicequotas:ListServiceQuotas","logs:DescribeLogGroups","logs:FilterLogEvents"],"Resource":"*"},{"Effect":"Allow","Action":["apigateway:GET"],"Resource":["arn:aws:apigateway:*::/restapis*","arn:aws:apigateway:*::/apis*"]}]}'
aws iam create-access-key --user-name OneUptimeReadOnly
```

### Paste what the AWS command printed

Paste everything the command printed into **What the command printed**. OneUptime picks out the role's ARN, or the access key ID and its secret.

### Test and connect AWS

OneUptime tests the connection as this step opens: it signs in, counts the resources it finds and says what reading them costs. Select **Connect** to save.
:::

The role and the user can do these things, and nothing else:

| What OneUptime uses them for | Actions |
| --- | --- |
| Find the resources that report metrics, and read their metrics | `cloudwatch:GetMetricData`, `cloudwatch:ListMetrics` |
| Name each resource and read its tags | `tag:GetResources`, `iam:ListAccountAliases` |
| List every resource and how it is configured, through Cloud Control | `cloudformation:ListResources`, `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ec2:DescribeVpcs`, `ec2:DescribeNatGateways`, `autoscaling:DescribeAutoScalingGroups`, `elasticloadbalancing:DescribeLoadBalancers`, `elasticloadbalancing:DescribeLoadBalancerAttributes`, `elasticloadbalancing:DescribeTargetGroups`, `elasticloadbalancing:DescribeTargetGroupAttributes`, `elasticloadbalancing:DescribeTargetHealth`, `elasticloadbalancing:DescribeTags`, `ecs:ListClusters`, `ecs:DescribeClusters`, `ecs:ListServices`, `ecs:DescribeServices`, `lambda:ListFunctions`, `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `elasticache:DescribeReplicationGroups`, `sqs:ListQueues`, `sqs:GetQueueAttributes`, `sns:ListTopics`, `sns:GetTopicAttributes`, `sns:ListSubscriptionsByTopic`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `kinesis:ListStreams`, `kinesis:DescribeStreamSummary`, `states:ListStateMachines`, `states:DescribeStateMachine`, `cloudfront:ListDistributions`, `elasticfilesystem:DescribeFileSystems`, `es:ListDomainNames`, `es:DescribeDomains`, `apprunner:ListServices`, `apprunner:DescribeService`, `elasticbeanstalk:DescribeEnvironments`, `apigateway:GET` |
| Read what changed: the account's management events | `cloudtrail:LookupEvents` |
| Read AWS's own health events for the account | `health:DescribeEvents`, `health:DescribeEventDetails` |
| Read what the account costs, from Cost Explorer | `ce:GetCostAndUsage`, `ce:GetCostAndUsageWithResources`, `ce:GetSavingsPlansCoverage`, `ce:GetSavingsPlansUtilization`, `ce:GetReservationCoverage`, `ce:GetReservationUtilization` |
| Read the ways to spend less, from Cost Optimization Hub | `cost-optimization-hub:ListRecommendations` |
| Read a resource's live status and recent events during an investigation | `rds:DescribeEvents`, `autoscaling:DescribeScalingActivities`, `ec2:DescribeInstanceStatus`, `ecs:DescribeTaskDefinition`, `lambda:GetFunctionConfiguration`, `lambda:GetFunctionConcurrency`, `lambda:GetAlias` |
| Read the account's quotas during an investigation | `servicequotas:ListServiceQuotas` |
| Read log lines, only when you let AI read an account's logs | `logs:DescribeLogGroups`, `logs:FilterLogEvents` |
| List the organization's accounts, from its management account | `organizations:ListAccounts` |

`apigateway:GET` is allowed on the APIs' own definitions only, never on their keys, and only the management account's role may list the organization's accounts. AWS Health answers only accounts on a Business, Enterprise On-Ramp or Enterprise support plan: without one, OneUptime asks again a day later.

> [!NOTE]
> On a self-hosted OneUptime, the **IAM role** way needs an AWS identity of OneUptime's own: set `CLOUD_CONNECT_AWS_ACCESS_KEY_ID` and `CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY` to the key of an IAM user that may call `sts:AssumeRole`. Without them, the form offers an **Access key**.

## Microsoft Azure

:::steps
### Open the Azure form

Go to **Cloud → Connect** and pick **Microsoft Azure**.

### Run the command in Azure Cloud Shell

The command creates an app with the **Monitoring Reader** and **Cost Management Reader** roles on your current subscription, and prints its details with the date its secret expires:

```bash
SCOPE="/subscriptions/$(az account show --query id --output tsv)"
OUT=$(az ad sp create-for-rbac --name OneUptimeReadOnly --role "Monitoring Reader" --scopes "$SCOPE")
APP=$(echo "$OUT" | jq -r .appId)
az role assignment create --assignee "$APP" --role "Cost Management Reader" --scope "$SCOPE" > /dev/null
END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)
echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'
```

Under **What to read**, pick every subscription in the tenant instead, and the role goes on the tenant's root management group:

```bash
SCOPE="/providers/Microsoft.Management/managementGroups/$(az account show --query tenantId --output tsv)"
OUT=$(az ad sp create-for-rbac --name OneUptimeReadOnly --role "Monitoring Reader" --scopes "$SCOPE")
APP=$(echo "$OUT" | jq -r .appId)
az role assignment create --assignee "$APP" --role "Cost Management Reader" --scope "$SCOPE" > /dev/null
END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)
echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'
```

### Paste what the Azure command printed

Paste everything the command printed into **What the command printed**. OneUptime picks out the `tenant`, the `appId`, the `password` and the date it expires.

### Test and connect Azure

OneUptime tests the connection as this step opens. Select **Connect** to save.
:::

To read more subscriptions with the same app, give it both roles on each of them:

```bash
az role assignment create --assignee <APP_ID> --role "Monitoring Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

OneUptime reads every subscription the app can read, up to 50, unless you list some under **Subscriptions**. The app's secret stops working on the date it expires: from 30 days before, each read warns about it. Run the command again and paste what it prints to give it a new one.

## Google Cloud

:::steps
### Open the Google Cloud form

Go to **Cloud → Connect** and pick **Google Cloud**.

### Run the command in Google Cloud Shell

Run it in the project to monitor. It turns on the APIs OneUptime reads, creates a service account with the **Monitoring Viewer**, **Cloud Asset Viewer**, **Logs Viewer**, **Service Health Viewer**, **BigQuery Job User** and **Compute Recommender Viewer** roles, and prints its key:

```bash
PROJECT_ID=$(gcloud config get-value project)
gcloud services enable monitoring.googleapis.com cloudasset.googleapis.com logging.googleapis.com cloudresourcemanager.googleapis.com servicehealth.googleapis.com bigquery.googleapis.com recommender.googleapis.com
gcloud iam service-accounts create oneuptime-read-only --display-name "OneUptime (read only)" > /dev/null 2>&1 || true
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/monitoring.viewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/cloudasset.viewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/logging.viewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/servicehealth.viewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/bigquery.jobUser --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/recommender.computeViewer --condition=None > /dev/null
gcloud iam service-accounts keys create oneuptime-key.json --iam-account "oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com"
cat oneuptime-key.json && rm oneuptime-key.json
```

Under **What to read**, pick every project in the organization instead, and the roles go on the project's organization:

```bash
PROJECT_ID=$(gcloud config get-value project)
ORG_ID=$(gcloud projects get-ancestors "$PROJECT_ID" --format="value(id)" | tail -1)
gcloud services enable monitoring.googleapis.com cloudasset.googleapis.com logging.googleapis.com cloudresourcemanager.googleapis.com servicehealth.googleapis.com bigquery.googleapis.com recommender.googleapis.com
gcloud iam service-accounts create oneuptime-read-only --display-name "OneUptime (read only)" > /dev/null 2>&1 || true
gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/monitoring.viewer --condition=None > /dev/null
gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/cloudasset.viewer --condition=None > /dev/null
gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/logging.viewer --condition=None > /dev/null
gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/servicehealth.viewer --condition=None > /dev/null
gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/bigquery.jobUser --condition=None > /dev/null
gcloud organizations add-iam-policy-binding "$ORG_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/recommender.computeViewer --condition=None > /dev/null
gcloud iam service-accounts keys create oneuptime-key.json --iam-account "oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com"
cat oneuptime-key.json && rm oneuptime-key.json
```

### Paste the key

Paste everything the command printed. OneUptime reads the key's own project, and stores the key encrypted.

### Test and connect Google Cloud

OneUptime tests the connection as this step opens. Select **Connect** to save.
:::

To read more projects with the same service account, give it these roles in each of them and list them under **Projects**:

```bash
for ROLE in roles/monitoring.viewer roles/cloudasset.viewer roles/logging.viewer roles/servicehealth.viewer roles/recommender.computeViewer; do gcloud projects add-iam-policy-binding <PROJECT_ID> --member "serviceAccount:oneuptime-read-only@<KEY_PROJECT_ID>.iam.gserviceaccount.com" --role "$ROLE"; done
```

An organization's connection reads up to 50 of its projects, unless you list some under **Projects**.

Google Cloud has no API for a project's costs: OneUptime reads them from your billing account's export to BigQuery, once you name its table under **Billing export table**. [Cloud Costs and Savings](/docs/telemetry/cloud-costs#google-cloud) shows how.

## Data security

The same connection can let [Data Security](/docs/data-security/index) read the account's data stores: its buckets, databases and warehouses. Under **More fields**, **Data security** is **Off** until you choose otherwise, and the command the form shows changes with it:

| Data security | What Data Security may read | What the command adds |
| --- | --- | --- |
| **Off** | None of the account's stores | Nothing |
| **Configuration only** | Who can reach each store, and how it is encrypted, backed up and logged. Never data. | On AWS, a second inline policy, `OneUptimeDataSecurity`, of read actions. On Azure and Google Cloud, nothing: **Monitoring Reader** and **Cloud Asset Viewer** already read it. |
| **Configuration and content samples** | That, and samples of objects and rows, to find sensitive data in them | On AWS, the same policy with `s3:ListBucket`, `s3:GetObject` and `kms:Decrypt` through S3 only. On Azure, **Storage Blob Data Reader**. On Google Cloud, `roles/storage.objectViewer` and `roles/bigquery.dataViewer`. |

On AWS, the role's command adds the policy with one more line. At the content level, it is:

```bash
aws iam put-role-policy --role-name "$ROLE" --policy-name OneUptimeDataSecurity --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListAllMyBuckets","s3:GetBucketLocation","s3:GetBucketPolicyStatus","s3:GetBucketPublicAccessBlock","s3:GetAccountPublicAccessBlock","s3:GetBucketAcl","s3:GetBucketPolicy","s3:GetEncryptionConfiguration","s3:GetBucketVersioning","s3:GetBucketLogging","s3:GetBucketOwnershipControls","s3:GetReplicationConfiguration","s3:GetBucketTagging","rds:DescribeDBInstances","rds:DescribeDBClusters","rds:DescribeDBSnapshots","rds:DescribeDBSnapshotAttributes","rds:DescribeDBClusterSnapshots","rds:DescribeDBClusterSnapshotAttributes","dynamodb:ListTables","dynamodb:DescribeTable","dynamodb:DescribeContinuousBackups","redshift:DescribeClusters","redshift:DescribeLoggingStatus","es:ListDomainNames","es:DescribeDomains","elasticache:DescribeReplicationGroups","elasticfilesystem:DescribeFileSystems","kms:ListAliases","iam:GetAccountAuthorizationDetails","iam:GenerateCredentialReport","iam:GetCredentialReport"],"Resource":"*"},{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::*"},{"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::*/*"},{"Effect":"Allow","Action":["kms:Decrypt"],"Resource":"*","Condition":{"StringLike":{"kms:ViaService":"s3.*.amazonaws.com"}}}]}'
```

IAM holds a user's own inline policies to 2,048 characters in all, so with an **Access key** the policy goes on a group, `OneUptimeDataSecurity`, that the user joins:

```bash
aws iam create-user --user-name OneUptimeReadOnly > /dev/null 2>&1 || true
aws iam put-user-policy --user-name OneUptimeReadOnly --policy-name OneUptimeReadOnly --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["cloudwatch:GetMetricData","cloudwatch:ListMetrics","tag:GetResources","iam:ListAccountAliases","cloudformation:ListResources","ec2:DescribeInstances","ec2:DescribeVolumes","ec2:DescribeVpcs","ec2:DescribeNatGateways","autoscaling:DescribeAutoScalingGroups","elasticloadbalancing:DescribeLoadBalancers","elasticloadbalancing:DescribeLoadBalancerAttributes","elasticloadbalancing:DescribeTargetGroups","elasticloadbalancing:DescribeTargetGroupAttributes","elasticloadbalancing:DescribeTargetHealth","elasticloadbalancing:DescribeTags","ecs:ListClusters","ecs:DescribeClusters","ecs:ListServices","ecs:DescribeServices","lambda:ListFunctions","rds:DescribeDBInstances","rds:DescribeDBClusters","elasticache:DescribeReplicationGroups","sqs:ListQueues","sqs:GetQueueAttributes","sns:ListTopics","sns:GetTopicAttributes","sns:ListSubscriptionsByTopic","dynamodb:ListTables","dynamodb:DescribeTable","kinesis:ListStreams","kinesis:DescribeStreamSummary","states:ListStateMachines","states:DescribeStateMachine","cloudfront:ListDistributions","elasticfilesystem:DescribeFileSystems","es:ListDomainNames","es:DescribeDomains","apprunner:ListServices","apprunner:DescribeService","elasticbeanstalk:DescribeEnvironments","cloudtrail:LookupEvents","health:DescribeEvents","health:DescribeEventDetails","ce:GetCostAndUsage","ce:GetCostAndUsageWithResources","ce:GetSavingsPlansCoverage","ce:GetSavingsPlansUtilization","ce:GetReservationCoverage","ce:GetReservationUtilization","cost-optimization-hub:ListRecommendations","rds:DescribeEvents","autoscaling:DescribeScalingActivities","ec2:DescribeInstanceStatus","ecs:DescribeTaskDefinition","lambda:GetFunctionConfiguration","lambda:GetFunctionConcurrency","lambda:GetAlias","servicequotas:ListServiceQuotas","logs:DescribeLogGroups","logs:FilterLogEvents"],"Resource":"*"},{"Effect":"Allow","Action":["apigateway:GET"],"Resource":["arn:aws:apigateway:*::/restapis*","arn:aws:apigateway:*::/apis*"]}]}'
aws iam create-group --group-name OneUptimeDataSecurity > /dev/null 2>&1 || true
aws iam put-group-policy --group-name OneUptimeDataSecurity --policy-name OneUptimeDataSecurity --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListAllMyBuckets","s3:GetBucketLocation","s3:GetBucketPolicyStatus","s3:GetBucketPublicAccessBlock","s3:GetAccountPublicAccessBlock","s3:GetBucketAcl","s3:GetBucketPolicy","s3:GetEncryptionConfiguration","s3:GetBucketVersioning","s3:GetBucketLogging","s3:GetBucketOwnershipControls","s3:GetReplicationConfiguration","s3:GetBucketTagging","rds:DescribeDBInstances","rds:DescribeDBClusters","rds:DescribeDBSnapshots","rds:DescribeDBSnapshotAttributes","rds:DescribeDBClusterSnapshots","rds:DescribeDBClusterSnapshotAttributes","dynamodb:ListTables","dynamodb:DescribeTable","dynamodb:DescribeContinuousBackups","redshift:DescribeClusters","redshift:DescribeLoggingStatus","es:ListDomainNames","es:DescribeDomains","elasticache:DescribeReplicationGroups","elasticfilesystem:DescribeFileSystems","kms:ListAliases","iam:GetAccountAuthorizationDetails","iam:GenerateCredentialReport","iam:GetCredentialReport"],"Resource":"*"},{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::*"},{"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::*/*"},{"Effect":"Allow","Action":["kms:Decrypt"],"Resource":"*","Condition":{"StringLike":{"kms:ViaService":"s3.*.amazonaws.com"}}}]}'
aws iam add-user-to-group --user-name OneUptimeReadOnly --group-name OneUptimeDataSecurity
aws iam create-access-key --user-name OneUptimeReadOnly
```

On Azure, the content level adds **Storage Blob Data Reader** on the same scope as **Monitoring Reader**:

```bash
SCOPE="/subscriptions/$(az account show --query id --output tsv)"
OUT=$(az ad sp create-for-rbac --name OneUptimeReadOnly --role "Monitoring Reader" --scopes "$SCOPE")
APP=$(echo "$OUT" | jq -r .appId)
az role assignment create --assignee "$APP" --role "Cost Management Reader" --scope "$SCOPE" > /dev/null
az role assignment create --assignee "$APP" --role "Storage Blob Data Reader" --scope "$SCOPE" > /dev/null
END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)
echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'
```

On Google Cloud, it adds the two roles:

```bash
PROJECT_ID=$(gcloud config get-value project)
gcloud services enable monitoring.googleapis.com cloudasset.googleapis.com logging.googleapis.com cloudresourcemanager.googleapis.com servicehealth.googleapis.com bigquery.googleapis.com recommender.googleapis.com
gcloud iam service-accounts create oneuptime-read-only --display-name "OneUptime (read only)" > /dev/null 2>&1 || true
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/monitoring.viewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/cloudasset.viewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/logging.viewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/servicehealth.viewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/bigquery.jobUser --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/recommender.computeViewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/storage.objectViewer --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com" --role roles/bigquery.dataViewer --condition=None > /dev/null
gcloud iam service-accounts keys create oneuptime-key.json --iam-account "oneuptime-read-only@$PROJECT_ID.iam.gserviceaccount.com"
cat oneuptime-key.json && rm oneuptime-key.json
```

A lower level's command replaces the AWS policy with the lower one. **Off** adds nothing, so it leaves what an earlier command granted in place until you delete it: the `OneUptimeDataSecurity` policy on AWS, with `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, and the content level's roles on Azure and Google Cloud. Data Security stops reading at once either way: it reads only what the connection's level says. [Set Up Data Security](/docs/data-security/setup) lists every action of the policy, and what Data Security keeps of what it reads.

## What OneUptime reads

| | AWS | Azure | Google Cloud |
| --- | --- | --- | --- |
| Resources | Every resource of the types OneUptime knows, in every Region you use, from Cloud Control | Every resource in the subscriptions, from Resource Graph | Every resource in the projects, from Cloud Asset Inventory |
| Metrics | The key metrics of each service, such as an instance's CPU, network and status checks | Up to 8 key metrics per resource | The key metrics of each resource type |
| Changes | CloudTrail management events | The Activity Log's administrative events | The Admin Activity audit log |
| Health events | AWS Health | Service Health and Resource Health | Service Health |
| Costs | Each day's, by service and Region, and by resource with Costs per resource on, from Cost Explorer | Each day's, by resource and service, from Cost Management | Each day's, by service, Region and resource, from your billing export to BigQuery |
| Ways to spend less | Cost Optimization Hub | Azure Advisor | The Recommender |
| Commitments | Savings Plans and Reserved Instances: what they cover and what of them is used, from Cost Explorer | Savings plans and reservations, from Cost Management | Committed use discounts, from your billing export to BigQuery |
| Read every | 10 minutes | 5 minutes | 5 minutes |
| A deleted resource | Archived once a full listing no longer has it | Archived once a full listing no longer has it | Archived once a full listing no longer has it |

Each read picks up where the last one stopped, so every data point and every change is written once. With **Cloud audit logs** on in Security Events, the same reads keep the accounts' audit logs as [security events](/docs/telemetry/security-events#read-your-cloud-accounts-audit-logs) too. A new connection's first read starts within a minute and goes an hour back for metrics and 2 hours back for changes; after a pause, a read goes back 6 hours at most. A resource that only reports metrics, which no listing has, is archived after 7 days without metrics. Costs are read twice a day, and the ways to spend less and the commitments once a day.

The calls OneUptime makes are billed to your cloud account, at your cloud's prices. Listing resources, reading changes and health events, reading the ways to spend less and reading Azure's costs cost nothing; reading metrics does, and so does reading AWS's and Google Cloud's costs. The test estimates the cost of what it finds, and reading less often costs less: change **Read metrics every** under **More fields**.

| Cloud | Price |
| --- | --- |
| AWS | CloudWatch `GetMetricData`: $0.01 per 1,000 metrics, and each key metric of a resource is one metric a read |
| AWS costs | Cost Explorer: $0.01 a request. A read of the costs makes a few, the commitments four a day, and Costs per resource a few more a day |
| Azure | The first 1,000,000 metric reads a month of each subscription are free, then $0.01 per 1,000 |
| Google Cloud | The first 1,000,000 time series read a month are free, then $0.50 per million |
| Google Cloud costs | BigQuery bills the query of your billing export: the first 1 TiB a month is free, then $6.25 per TiB |

A Service Bus or Event Hubs namespace's key metrics are read for each of its queues, topics and event hubs, split by the `EntityName` dimension, in the same one call per namespace and read: read every 5 minutes, a namespace of 50 queues costs 12 calls an hour, as a namespace of one does. A read takes up to 1,000 of them per namespace, and says so when there are more. Each one's metrics show on its page under [Queues](/docs/telemetry/queues#azure-service-bus), filed the way the collector's `azure_monitor` receiver files them, and where that receiver also reads a metric of a queue, its figures are kept and the connection's left out, so nothing is counted twice.

## What you see in OneUptime

- **An account's page.** Under **Cloud → Accounts**, an account's Overview counts its resources by type and Region and says when a connection last read it. Its **Resources** lists them, its **Changes** lists what changed in it, newest first, and its **Topology** draws its Regions, the networks in them and what runs in each, with the open incidents and alerts on the resources they are linked to. On **Changes**, a change OneUptime AI made reads **OneUptime AI**, with the incident or alert it fixed, who approved it or that it ran on its own, and a link to its entry in the account's **AI Logs**. Its **Feed** records how the account came to OneUptime, its Cloud AI agent connecting or being reset, and who changed what OneUptime AI may do in it.
- **A resource's changes.** A change is kept as a change event tied to the resource it changed and to its account, and drawn as a marker on the resource's metric charts with its incidents and alerts. Charts filtered to no resource leave a cloud account's activity log out, so a busy account cannot crowd out your deploys; the provider's health events stay on them.
- **Incidents and alerts.** Link a cloud resource to a monitor, an incident or an alert under its linked resources, and its incidents and alerts are listed on the resource's page. A website, API, SSL, ping or port monitor whose host leads to a resource's endpoint, directly or through its DNS, lists the resource under **Suggested Cloud Resources** on its **Linked Resources** card: select **Link resource** to link it.
- **A resource's health.** Each read keeps the newest value of a resource's key metrics and judges them: a resource reads **Healthy**, **Degraded** or **Unhealthy**, with why, such as failing status checks or storage nearly full, and **Not reporting** once its metrics stop. **Cloud → Overview** and an account's Overview list what needs attention, the most urgent first.
- **Recommended monitors.** An account's **Recommendations** lists the monitors OneUptime recommends for its resources, by type of resource, with the resources each one is for and how many have it already: add one to a resource, or to every resource of its type at once, and the side menu counts the ones still to set up. A resource's own **Recommendations** tab offers its own. Each monitor reads the key metrics the connection reads, every 5 minutes, over the last 30 minutes on AWS and the last 15 on Azure and Google Cloud, and is linked to its resource. A count, such as errors or throttled requests, is totalled over that window, so an account that [streams its metrics](/docs/telemetry/cloud-streaming) and one that is read alert alike, the streamed one sooner. A certificate's days to expiry, which ACM publishes twice a day, are read once an hour: its monitor reads the last 2 days and fires once the certificate has 30 days or fewer left, or once ACM stops publishing them because it expired. An RDS instance's connections are judged against 90% of the connection limit of its class and engine. While a [maintenance event](/docs/scheduled-maintenance/creating-events) holds a resource, its monitors open no incident or alert.
- **What the accounts cost.** **Cloud → Spend → Costs** draws each day's spend and where it goes, **Cloud → Spend → Savings** lists the ways to spend less, and **Cloud → Spend → Budgets** alerts before a month costs more than it should: [Cloud Costs and Savings](/docs/telemetry/cloud-costs).

## Let AI fix problems

OneUptime AI reads every connected account while it investigates, with the read-only access above. To let it fix problems too, such as restarting a service, scaling it out or rolling it back, open the account under **Cloud → Accounts** and select **Let AI fix problems** in the **AI agent** card of its **Overview**.

The dialog asks one question, **How far may AI go?**: **Ask me first**, the default, where OneUptime AI proposes each fix and a person approves it with one click, or **Fix safe problems on its own**, where safe changes run on their own and riskier ones still wait for approval. Everything else has a safe default under **More fields**. It then shows one command, written for this account: run it in AWS CloudShell, Azure Cloud Shell or Google Cloud Shell, signed in as someone who may create roles in the account. The command creates a role that may make only the changes turned on, and starts the Cloud AI agent with it in your account. The agent connects on its own within a few minutes, and the dialog says so: there is nothing to paste back.

The command holds a key made for this account's agent alone, which works for a day until the agent connects with it: open the dialog again for a new one. Only someone who may reset the agent and edit the account gets one.

On an AWS account found by a connection that reads an AWS Organization, the dialog also asks **Which accounts?**: **Every account of the organization** sets an agent up in each of its accounts with one command in the management account's AWS CloudShell, each agent with its own key and the same least-privilege role, and lists which accounts' agents connected.

The agent runs all month in your account, billed by your cloud at its list prices. On Google Cloud it runs on a small VM of its own, in a network that lets nothing in; for a project whose organization lets no VM have an external IP address, choose **Cloud Run** in **Where the agent runs**, under **More fields**:

| Cloud | What runs | About |
| --- | --- | --- |
| AWS | One ECS Fargate task of 0.25 vCPU and 0.5 GB, and its public IPv4 address, at `us-east-1` prices | $13 a month |
| Azure | One Container Apps replica of 0.25 vCPU and 0.5 GiB, after the subscription's monthly free grant of 180,000 vCPU-seconds and 360,000 GiB-seconds | $14 a month |
| Google Cloud | One `e2-micro` Compute Engine VM, with its 10 GB standard boot disk and its external IPv4 address, at `us-central1` prices. Google Cloud's free tier covers one `e2-micro` VM a month in `us-central1`, `us-west1` and `us-east1` | $10 a month |
| Google Cloud, on Cloud Run | One Cloud Run instance of 1 vCPU and 0.5 GiB with CPU always allocated, which takes a whole vCPU, after the monthly free tier of 240,000 vCPU-seconds and 450,000 GiB-seconds | $45 a month |

What the agent may change, how each change is tiered and undone, and how to read its logs: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#in-a-cloud-account).

## Troubleshooting

:::details The test says the key or secret was not accepted
Copy everything the command printed and paste it again. A key made a minute ago can take a minute to work. An Azure secret that has expired is refused too: run the command again.
:::

:::details The test signs in, but cannot read
Run the command again: it grants the roles OneUptime needs. On AWS, run the command the form shows for this project: a role made for another project trusts that project's external ID, not this one's.
:::

:::details Google Cloud does not let the command create a key
An organization policy, `iam.disableServiceAccountKeyCreation`, can forbid service account keys. Ask your organization's admin for an exception for the project, or [send the metrics with your own collector](/docs/telemetry/cloud-resources).
:::

:::details No resources appear
The first read lists every resource of the account, whether it reports metrics or not. If a connection is not working, **View error** under **Cloud → Connect** says why its last read failed.
:::

:::details Some accounts of the organization are missing
One connection reads up to 50 accounts, subscriptions or projects, and each read says so when there are more. Connect the others with a connection of their own.
:::

:::details A read has warnings
A read that works can still leave something out, such as a metric the cloud did not return for some resources, or the queues of a namespace past the first 1,000. On **Cloud → Connect**, the connection's status then says how many warnings its last read had: select them to read each one.
:::

## Next steps

:::cards
- [Cloud Resources](/docs/telemetry/cloud-resources): Run your own OpenTelemetry Collector instead, or stream CloudWatch metrics.
- [Deploys and Changes](/docs/telemetry/change-events): Every change OneUptime records, and how OneUptime AI reads them.
- [Metrics Monitor](/docs/monitor/metrics-monitor): Alert on a resource's metrics.
:::
