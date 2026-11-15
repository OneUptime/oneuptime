# 连接云账户

在仪表板中连接 AWS 账户、Azure 订阅或 Google Cloud 项目，OneUptime 会列出其中的每个资源，读取它们的关键指标并说明每个资源的状况，记录它们发生了哪些变更以及你的云提供商对它们健康状况的说明，并读取账户的成本以及降低成本的方法。你只需在云自带的浏览器终端中运行一条命令，再粘贴它的输出：无需运行采集器，也无需安装任何东西。

:::cards
- [Amazon Web Services](#amazon-web-services): OneUptime 登录所用的 IAM 角色，或一个访问密钥。
- [Microsoft Azure](#microsoft-azure): 具有 Monitoring Reader 和 Cost Management Reader 角色的应用。
- [Google Cloud](#google-cloud): 具有六个只读角色的服务账号。
- [OneUptime 读取什么](#oneuptime-读取什么): 资源、指标、变更、健康事件和成本，多久读取一次，以及读取它们的费用是多少。
- [云成本与节省](/docs/telemetry/cloud-costs): 每个账户的成本、减少支出的方法，以及会发出警报的预算。
- [流式传输 CloudWatch 指标和日志](/docs/telemetry/cloud-streaming): 通过 Amazon Data Firehose，在几分钟内获得每个指标以及 CloudWatch Logs。
- [流式传输 Azure Monitor 指标和日志](/docs/telemetry/cloud-streaming-azure): 几分钟内获得关键指标和资源日志，从你订阅中的事件中心读取。
- [流式传输 Google Cloud 日志](/docs/telemetry/cloud-streaming-google-cloud): 每条日志一写入就通过 Pub/Sub 推送。
- [数据安全](#数据安全): 该连接让数据安全可以读取什么，以及每个级别会给命令添加什么。
- [让 AI 修复问题](#让-ai-修复问题): 再运行一条命令，OneUptime AI 就能修复它发现的问题。
:::

## 工作原理

```mermaid title="从你的云到云资源"
flowchart TB
    cmd["在云的终端中<br/>运行一条命令"] --> access["只读访问权限"]
    access --> ou["OneUptime 每隔<br/>几分钟读取一次"]
    ou --> res["云资源"]
    ou --> met["指标"]
    ou --> chg["变更和<br/>健康事件"]
```

- **访问权限只能读取。** 命令创建的访问权限只读取你的资源及其配置、它们的指标、发生的变更、提供商的健康事件和账户的成本，不做其他任何事：在 AWS 上是下面列出的操作，在 Azure 上是 **Monitoring Reader** 和 **Cost Management Reader** 角色，在 Google Cloud 上是六个查看者角色。OneUptime 从不通过它读取数据或机密：只有当你允许 AI 读取账户的日志时，才会读取日志行；只有当你为 [数据安全](#数据安全) 开启了内容样本时，才会读取这些样本。删除它即可切断 OneUptime 的访问。
- **OneUptime 按计划读取。** 除非你在连接时选择其他间隔，Azure 和 Google Cloud 每 5 分钟读取一次，AWS 每 10 分钟读取一次。每次读取还会记录自上次以来的变更，并且每 30 分钟会有一次读取重新列出所有资源。
- **每个资源都有自己的页面。** 资源会显示在 **云 → 所有资源** 中，带有其健康状况、关键指标、负责人和标签。已列出资源的页面还会显示它的 **相连的资源**（它运行在什么里面，什么向它发送流量）、它的端点、标签和设置，以及它的 **事件**、**警报** 和 **更改**。
- **每个账户都有自己的页面。** 账户会显示在 **云 → 账户** 中，带有按类型和区域划分的资源、它们的 **成本**、它们的 **更改**，以及显示其资源如何相互关联的 **拓扑**。
- **云从它的概览打开。** **云 → 概览** 列出需要关注的资源及原因、账户本月的成本，以及你的云认为可以节省的金额。[云成本与节省](/docs/telemetry/cloud-costs) 说明成本、节省和预算是如何读取的。如果你的账户在托管应用平台上运行应用，**应用平台** 卡片会统计其环境和应用，每个计数都会在应用平台中打开对应列表，并已按这些账户筛选。
- **OneUptime AI 会读取发生的变更。** 对关联到云资源的事件或警报的调查，会先读取该资源的变更，并在开始时重新读取账户的活动日志。

## 开始之前

- **项目所有者或管理员。** 只有他们可以连接、测试和编辑云账户。
- **你的云的终端**（AWS CloudShell、Azure Cloud Shell 或 Google Cloud Shell），并以可以创建 IAM 角色或用户、应用注册或服务账号的身份登录。

## Amazon Web Services

:::steps
### 打开 AWS 表单

前往 **云 → 连接**，然后选择 **Amazon Web Services**。

### 在 AWS CloudShell 中运行命令

选择 OneUptime 的登录方式。推荐使用 **IAM 角色**：不存储任何机密，你可以随时删除该角色。表单会显示为你的项目编写的命令：它会创建一个以你项目的外部 ID 信任 OneUptime 的 AWS 账户的角色，并输出该角色的 ARN。

在 **读取范围** 中，选择此账户或你的 AWS Organization 中的每个账户。在组织的管理账户中运行组织的命令：它会添加一个 StackSet，把同一个角色放进每个账户（现有的账户和之后加入的账户），并让管理账户的角色列出这些账户。一个连接最多读取 50 个账户。

无法使用角色时，请使用 **访问密钥**：它只读取自己的账户。以下命令会创建一个具有相同权限的用户，并输出其密钥：

```bash
aws iam create-user --user-name OneUptimeReadOnly > /dev/null 2>&1 || true
aws iam put-user-policy --user-name OneUptimeReadOnly --policy-name OneUptimeReadOnly --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["cloudwatch:GetMetricData","cloudwatch:ListMetrics","tag:GetResources","iam:ListAccountAliases","cloudformation:ListResources","ec2:DescribeInstances","ec2:DescribeVolumes","ec2:DescribeVpcs","ec2:DescribeNatGateways","autoscaling:DescribeAutoScalingGroups","elasticloadbalancing:DescribeLoadBalancers","elasticloadbalancing:DescribeLoadBalancerAttributes","elasticloadbalancing:DescribeTargetGroups","elasticloadbalancing:DescribeTargetGroupAttributes","elasticloadbalancing:DescribeTargetHealth","elasticloadbalancing:DescribeTags","ecs:ListClusters","ecs:DescribeClusters","ecs:ListServices","ecs:DescribeServices","lambda:ListFunctions","rds:DescribeDBInstances","rds:DescribeDBClusters","elasticache:DescribeReplicationGroups","sqs:ListQueues","sqs:GetQueueAttributes","sns:ListTopics","sns:GetTopicAttributes","sns:ListSubscriptionsByTopic","dynamodb:ListTables","dynamodb:DescribeTable","kinesis:ListStreams","kinesis:DescribeStreamSummary","states:ListStateMachines","states:DescribeStateMachine","cloudfront:ListDistributions","elasticfilesystem:DescribeFileSystems","es:ListDomainNames","es:DescribeDomains","apprunner:ListServices","apprunner:DescribeService","elasticbeanstalk:DescribeEnvironments","cloudtrail:LookupEvents","health:DescribeEvents","health:DescribeEventDetails","ce:GetCostAndUsage","ce:GetCostAndUsageWithResources","ce:GetSavingsPlansCoverage","ce:GetSavingsPlansUtilization","ce:GetReservationCoverage","ce:GetReservationUtilization","cost-optimization-hub:ListRecommendations","rds:DescribeEvents","autoscaling:DescribeScalingActivities","ec2:DescribeInstanceStatus","ecs:DescribeTaskDefinition","lambda:GetFunctionConfiguration","lambda:GetFunctionConcurrency","lambda:GetAlias","servicequotas:ListServiceQuotas","logs:DescribeLogGroups","logs:FilterLogEvents"],"Resource":"*"},{"Effect":"Allow","Action":["apigateway:GET"],"Resource":["arn:aws:apigateway:*::/restapis*","arn:aws:apigateway:*::/apis*"]}]}'
aws iam create-access-key --user-name OneUptimeReadOnly
```

### 粘贴 AWS 命令的输出

将命令输出的全部内容粘贴到 **命令的输出** 中。OneUptime 会从中找出角色的 ARN，或访问密钥 ID 及其机密。

### 测试并连接 AWS

此步骤打开时，OneUptime 会测试连接：它会登录，统计找到的资源，并说明读取它们的费用。选择 **连接** 即可保存。
:::

该角色和用户只能做以下这些事：

| OneUptime 的用途 | 操作 |
| --- | --- |
| 找到上报指标的资源，并读取它们的指标 | `cloudwatch:GetMetricData`, `cloudwatch:ListMetrics` |
| 为每个资源命名并读取其标签 | `tag:GetResources`, `iam:ListAccountAliases` |
| 通过 Cloud Control 列出每个资源及其配置 | `cloudformation:ListResources`, `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ec2:DescribeVpcs`, `ec2:DescribeNatGateways`, `autoscaling:DescribeAutoScalingGroups`, `elasticloadbalancing:DescribeLoadBalancers`, `elasticloadbalancing:DescribeLoadBalancerAttributes`, `elasticloadbalancing:DescribeTargetGroups`, `elasticloadbalancing:DescribeTargetGroupAttributes`, `elasticloadbalancing:DescribeTargetHealth`, `elasticloadbalancing:DescribeTags`, `ecs:ListClusters`, `ecs:DescribeClusters`, `ecs:ListServices`, `ecs:DescribeServices`, `lambda:ListFunctions`, `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `elasticache:DescribeReplicationGroups`, `sqs:ListQueues`, `sqs:GetQueueAttributes`, `sns:ListTopics`, `sns:GetTopicAttributes`, `sns:ListSubscriptionsByTopic`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `kinesis:ListStreams`, `kinesis:DescribeStreamSummary`, `states:ListStateMachines`, `states:DescribeStateMachine`, `cloudfront:ListDistributions`, `elasticfilesystem:DescribeFileSystems`, `es:ListDomainNames`, `es:DescribeDomains`, `apprunner:ListServices`, `apprunner:DescribeService`, `elasticbeanstalk:DescribeEnvironments`, `apigateway:GET` |
| 读取发生的变更：账户的管理事件 | `cloudtrail:LookupEvents` |
| 读取 AWS 自己针对该账户的健康事件 | `health:DescribeEvents`, `health:DescribeEventDetails` |
| 从 Cost Explorer 读取账户的成本 | `ce:GetCostAndUsage`, `ce:GetCostAndUsageWithResources`, `ce:GetSavingsPlansCoverage`, `ce:GetSavingsPlansUtilization`, `ce:GetReservationCoverage`, `ce:GetReservationUtilization` |
| 从 Cost Optimization Hub 读取减少支出的方法 | `cost-optimization-hub:ListRecommendations` |
| 在调查期间读取资源的当前状态和最近的事件 | `rds:DescribeEvents`, `autoscaling:DescribeScalingActivities`, `ec2:DescribeInstanceStatus`, `ecs:DescribeTaskDefinition`, `lambda:GetFunctionConfiguration`, `lambda:GetFunctionConcurrency`, `lambda:GetAlias` |
| 在调查期间读取账户的配额 | `servicequotas:ListServiceQuotas` |
| 读取日志行，仅当你允许 AI 读取账户的日志时 | `logs:DescribeLogGroups`, `logs:FilterLogEvents` |
| 从组织的管理账户列出组织的账户 | `organizations:ListAccounts` |

`apigateway:GET` 只允许用于 API 自身的定义，从不用于它们的密钥，并且只有管理账户的角色可以列出组织的账户。AWS Health 只响应使用 Business、Enterprise On-Ramp 或 Enterprise 支持计划的账户：没有这类计划时，OneUptime 会在一天后再次询问。

> [!NOTE]
> 在自托管的 OneUptime 上，**IAM 角色** 方式需要 OneUptime 自己的 AWS 身份：将 `CLOUD_CONNECT_AWS_ACCESS_KEY_ID` 和 `CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY` 设置为一个可以调用 `sts:AssumeRole` 的 IAM 用户的密钥。未设置时，表单会提供 **访问密钥**。

## Microsoft Azure

:::steps
### 打开 Azure 表单

前往 **云 → 连接**，然后选择 **Microsoft Azure**。

### 在 Azure Cloud Shell 中运行命令

该命令会在你当前的订阅上创建一个具有 **Monitoring Reader** 和 **Cost Management Reader** 角色的应用，并输出其详细信息以及其机密的到期日期：

```bash
SCOPE="/subscriptions/$(az account show --query id --output tsv)"
OUT=$(az ad sp create-for-rbac --name OneUptimeReadOnly --role "Monitoring Reader" --scopes "$SCOPE")
APP=$(echo "$OUT" | jq -r .appId)
az role assignment create --assignee "$APP" --role "Cost Management Reader" --scope "$SCOPE" > /dev/null
END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)
echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'
```

在 **读取范围** 中改为选择租户中的每个订阅，角色就会授予租户的根管理组：

```bash
SCOPE="/providers/Microsoft.Management/managementGroups/$(az account show --query tenantId --output tsv)"
OUT=$(az ad sp create-for-rbac --name OneUptimeReadOnly --role "Monitoring Reader" --scopes "$SCOPE")
APP=$(echo "$OUT" | jq -r .appId)
az role assignment create --assignee "$APP" --role "Cost Management Reader" --scope "$SCOPE" > /dev/null
END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)
echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'
```

### 粘贴 Azure 命令的输出

将命令输出的全部内容粘贴到 **命令的输出** 中。OneUptime 会从中找出 `tenant`、`appId`、`password` 和到期日期。

### 测试并连接 Azure

此步骤打开时，OneUptime 会测试连接。选择 **连接** 即可保存。
:::

要用同一个应用读取更多订阅，请在每个订阅上为它授予这两个角色：

```bash
az role assignment create --assignee <APP_ID> --role "Monitoring Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

除非你在 **订阅** 中列出一些订阅，否则 OneUptime 会读取该应用可以读取的每个订阅，最多 50 个。应用的机密会在到期日停止工作：从到期前 30 天起，每次读取都会对此发出提醒。再次运行该命令并粘贴它的输出，即可为它换一个新的机密。

## Google Cloud

:::steps
### 打开 Google Cloud 表单

前往 **云 → 连接**，然后选择 **Google Cloud**。

### 在 Google Cloud Shell 中运行命令

在要监控的项目中运行它。它会启用 OneUptime 读取的 API，创建一个具有 **Monitoring Viewer**、**Cloud Asset Viewer**、**Logs Viewer**、**Service Health Viewer**、**BigQuery Job User** 和 **Compute Recommender Viewer** 角色的服务账号，并输出其密钥：

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

在 **读取范围** 中改为选择组织中的每个项目，角色就会授予该项目所在的组织：

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

### 粘贴密钥

粘贴命令输出的全部内容。OneUptime 会读取密钥自身所属的项目，并加密存储密钥。

### 测试并连接 Google Cloud

此步骤打开时，OneUptime 会测试连接。选择 **连接** 即可保存。
:::

要用同一个服务账号读取更多项目，请在每个项目中为它授予这些角色，并在 **项目** 中列出它们：

```bash
for ROLE in roles/monitoring.viewer roles/cloudasset.viewer roles/logging.viewer roles/servicehealth.viewer roles/recommender.computeViewer; do gcloud projects add-iam-policy-binding <PROJECT_ID> --member "serviceAccount:oneuptime-read-only@<KEY_PROJECT_ID>.iam.gserviceaccount.com" --role "$ROLE"; done
```

除非你在 **项目** 中列出一些项目，否则组织的连接最多读取其 50 个项目。

Google Cloud 没有提供项目成本的 API：OneUptime 从你的结算账户导出到 BigQuery 的数据中读取成本，只要你在 **账单导出表** 中填入它的表即可。[云成本与节省](/docs/telemetry/cloud-costs#google-cloud) 说明了具体做法。

## 数据安全

同一个连接还可以让 [数据安全](/docs/data-security/index) 读取账户的数据存储：它的存储桶、数据库和数据仓库。在 **更多字段** 下，**数据安全** 默认为 **关闭**，直到你另行选择；表单显示的命令会随之变化：

| 数据安全 | 数据安全可以读取什么 | 命令添加了什么 |
| --- | --- | --- |
| **关闭** | 不读取账户中的任何数据存储 | 无 |
| **仅配置** | 谁可以访问每个数据存储，以及它如何加密、备份和记录日志。从不读取数据。 | 在 AWS 上，添加第二个由读取操作组成的内联策略 `OneUptimeDataSecurity`。在 Azure 和 Google Cloud 上不添加任何内容：**Monitoring Reader** 和 **Cloud Asset Viewer** 已经能读取这些信息。 |
| **配置和内容样本** | 上述内容，以及对象和行的样本，用于在其中查找敏感数据 | 在 AWS 上，同一策略再加上 `s3:ListBucket`、`s3:GetObject` 和仅限通过 S3 使用的 `kms:Decrypt`。在 Azure 上，添加 **Storage Blob Data Reader**。在 Google Cloud 上，添加 `roles/storage.objectViewer` 和 `roles/bigquery.dataViewer`。 |

在 AWS 上，角色的命令会多用一行来添加该策略。在内容级别下，这一行是：

```bash
aws iam put-role-policy --role-name "$ROLE" --policy-name OneUptimeDataSecurity --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListAllMyBuckets","s3:GetBucketLocation","s3:GetBucketPolicyStatus","s3:GetBucketPublicAccessBlock","s3:GetAccountPublicAccessBlock","s3:GetBucketAcl","s3:GetBucketPolicy","s3:GetEncryptionConfiguration","s3:GetBucketVersioning","s3:GetBucketLogging","s3:GetBucketOwnershipControls","s3:GetReplicationConfiguration","s3:GetBucketTagging","rds:DescribeDBInstances","rds:DescribeDBClusters","rds:DescribeDBSnapshots","rds:DescribeDBSnapshotAttributes","rds:DescribeDBClusterSnapshots","rds:DescribeDBClusterSnapshotAttributes","dynamodb:ListTables","dynamodb:DescribeTable","dynamodb:DescribeContinuousBackups","redshift:DescribeClusters","redshift:DescribeLoggingStatus","es:ListDomainNames","es:DescribeDomains","elasticache:DescribeReplicationGroups","elasticfilesystem:DescribeFileSystems","kms:ListAliases","iam:GetAccountAuthorizationDetails","iam:GenerateCredentialReport","iam:GetCredentialReport"],"Resource":"*"},{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::*"},{"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::*/*"},{"Effect":"Allow","Action":["kms:Decrypt"],"Resource":"*","Condition":{"StringLike":{"kms:ViaService":"s3.*.amazonaws.com"}}}]}'
```

IAM 把一个用户自身的内联策略总长度限制在 2,048 个字符以内，因此使用 **访问密钥** 时，该策略会放在用户所加入的组 `OneUptimeDataSecurity` 上：

```bash
aws iam create-user --user-name OneUptimeReadOnly > /dev/null 2>&1 || true
aws iam put-user-policy --user-name OneUptimeReadOnly --policy-name OneUptimeReadOnly --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["cloudwatch:GetMetricData","cloudwatch:ListMetrics","tag:GetResources","iam:ListAccountAliases","cloudformation:ListResources","ec2:DescribeInstances","ec2:DescribeVolumes","ec2:DescribeVpcs","ec2:DescribeNatGateways","autoscaling:DescribeAutoScalingGroups","elasticloadbalancing:DescribeLoadBalancers","elasticloadbalancing:DescribeLoadBalancerAttributes","elasticloadbalancing:DescribeTargetGroups","elasticloadbalancing:DescribeTargetGroupAttributes","elasticloadbalancing:DescribeTargetHealth","elasticloadbalancing:DescribeTags","ecs:ListClusters","ecs:DescribeClusters","ecs:ListServices","ecs:DescribeServices","lambda:ListFunctions","rds:DescribeDBInstances","rds:DescribeDBClusters","elasticache:DescribeReplicationGroups","sqs:ListQueues","sqs:GetQueueAttributes","sns:ListTopics","sns:GetTopicAttributes","sns:ListSubscriptionsByTopic","dynamodb:ListTables","dynamodb:DescribeTable","kinesis:ListStreams","kinesis:DescribeStreamSummary","states:ListStateMachines","states:DescribeStateMachine","cloudfront:ListDistributions","elasticfilesystem:DescribeFileSystems","es:ListDomainNames","es:DescribeDomains","apprunner:ListServices","apprunner:DescribeService","elasticbeanstalk:DescribeEnvironments","cloudtrail:LookupEvents","health:DescribeEvents","health:DescribeEventDetails","ce:GetCostAndUsage","ce:GetCostAndUsageWithResources","ce:GetSavingsPlansCoverage","ce:GetSavingsPlansUtilization","ce:GetReservationCoverage","ce:GetReservationUtilization","cost-optimization-hub:ListRecommendations","rds:DescribeEvents","autoscaling:DescribeScalingActivities","ec2:DescribeInstanceStatus","ecs:DescribeTaskDefinition","lambda:GetFunctionConfiguration","lambda:GetFunctionConcurrency","lambda:GetAlias","servicequotas:ListServiceQuotas","logs:DescribeLogGroups","logs:FilterLogEvents"],"Resource":"*"},{"Effect":"Allow","Action":["apigateway:GET"],"Resource":["arn:aws:apigateway:*::/restapis*","arn:aws:apigateway:*::/apis*"]}]}'
aws iam create-group --group-name OneUptimeDataSecurity > /dev/null 2>&1 || true
aws iam put-group-policy --group-name OneUptimeDataSecurity --policy-name OneUptimeDataSecurity --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListAllMyBuckets","s3:GetBucketLocation","s3:GetBucketPolicyStatus","s3:GetBucketPublicAccessBlock","s3:GetAccountPublicAccessBlock","s3:GetBucketAcl","s3:GetBucketPolicy","s3:GetEncryptionConfiguration","s3:GetBucketVersioning","s3:GetBucketLogging","s3:GetBucketOwnershipControls","s3:GetReplicationConfiguration","s3:GetBucketTagging","rds:DescribeDBInstances","rds:DescribeDBClusters","rds:DescribeDBSnapshots","rds:DescribeDBSnapshotAttributes","rds:DescribeDBClusterSnapshots","rds:DescribeDBClusterSnapshotAttributes","dynamodb:ListTables","dynamodb:DescribeTable","dynamodb:DescribeContinuousBackups","redshift:DescribeClusters","redshift:DescribeLoggingStatus","es:ListDomainNames","es:DescribeDomains","elasticache:DescribeReplicationGroups","elasticfilesystem:DescribeFileSystems","kms:ListAliases","iam:GetAccountAuthorizationDetails","iam:GenerateCredentialReport","iam:GetCredentialReport"],"Resource":"*"},{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::*"},{"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::*/*"},{"Effect":"Allow","Action":["kms:Decrypt"],"Resource":"*","Condition":{"StringLike":{"kms:ViaService":"s3.*.amazonaws.com"}}}]}'
aws iam add-user-to-group --user-name OneUptimeReadOnly --group-name OneUptimeDataSecurity
aws iam create-access-key --user-name OneUptimeReadOnly
```

在 Azure 上，内容级别会在与 **Monitoring Reader** 相同的范围上添加 **Storage Blob Data Reader**：

```bash
SCOPE="/subscriptions/$(az account show --query id --output tsv)"
OUT=$(az ad sp create-for-rbac --name OneUptimeReadOnly --role "Monitoring Reader" --scopes "$SCOPE")
APP=$(echo "$OUT" | jq -r .appId)
az role assignment create --assignee "$APP" --role "Cost Management Reader" --scope "$SCOPE" > /dev/null
az role assignment create --assignee "$APP" --role "Storage Blob Data Reader" --scope "$SCOPE" > /dev/null
END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)
echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'
```

在 Google Cloud 上，它会添加这两个角色：

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

较低级别的命令会用较低级别的策略替换 AWS 策略。**关闭** 不添加任何内容，因此之前的命令所授予的权限会保留，直到你删除它们：AWS 上的 `OneUptimeDataSecurity` 策略（使用 `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity` 删除），以及 Azure 和 Google Cloud 上内容级别的角色。无论哪种情况，数据安全都会立即停止读取：它只读取连接的级别所允许的内容。[设置数据安全](/docs/data-security/setup) 列出了该策略的每个操作，以及数据安全会保留所读取内容中的哪些部分。

## OneUptime 读取什么

| | AWS | Azure | Google Cloud |
| --- | --- | --- | --- |
| 资源 | 你使用的每个区域中 OneUptime 所知类型的每个资源，来自 Cloud Control | 订阅中的每个资源，来自 Resource Graph | 项目中的每个资源，来自 Cloud Asset Inventory |
| 指标 | 每项服务的关键指标，例如实例的 CPU、网络和状态检查 | 每个资源最多 8 个关键指标 | 每种资源类型的关键指标 |
| 变更 | CloudTrail 管理事件 | 活动日志的管理事件 | Admin Activity 审核日志 |
| 健康事件 | AWS Health | Service Health 和 Resource Health | Service Health |
| 成本 | 每天的成本，按服务和区域，开启“按资源的成本”后还按资源，来自 Cost Explorer | 每天的成本，按资源和服务，来自 Cost Management | 每天的成本，按服务、区域和资源，来自你导出到 BigQuery 的结算数据 |
| 减少支出的方法 | Cost Optimization Hub | Azure Advisor | Recommender |
| 承诺 | Savings Plans 和预留实例：覆盖了多少以及使用了多少，来自 Cost Explorer | 节省计划和预留，来自 Cost Management | 承诺使用折扣，来自你导出到 BigQuery 的结算数据 |
| 读取间隔 | 10 分钟 | 5 分钟 | 5 分钟 |
| 已删除的资源 | 完整列表中不再有它时归档 | 完整列表中不再有它时归档 | 完整列表中不再有它时归档 |

每次读取都会从上一次停止的地方继续，因此每个数据点和每项变更只写入一次。在安全事件中开启 **云审计日志** 后，同样的读取也会把账户的审计日志保存为 [安全事件](/docs/telemetry/security-events#读取云账户的审计日志)。新连接的首次读取会在一分钟内开始，指标回溯一小时，变更回溯 2 小时；暂停之后，一次读取最多回溯 6 小时。只上报指标、且不在任何列表中的资源，会在 7 天没有指标后归档。成本每天读取两次，减少支出的方法和承诺每天读取一次。

OneUptime 发出的调用会按你的云的价格计入你的云账户。列出资源、读取变更和健康事件、读取减少支出的方法以及读取 Azure 的成本都不收费；读取指标收费，读取 AWS 和 Google Cloud 的成本也收费。测试会估算它找到的内容的费用，降低读取频率可以减少费用：在 **更多字段** 中修改 **指标读取间隔**。

| 云 | 价格 |
| --- | --- |
| AWS | CloudWatch `GetMetricData`：每 1,000 个指标 $0.01，每个资源的每个关键指标每次读取计为一个指标 |
| AWS 成本 | Cost Explorer：每个请求 $0.01。每次读取成本会发出几个请求，承诺每天四个，“按资源的成本”每天再多几个 |
| Azure | 每个订阅每月的前 1,000,000 次指标读取免费，之后每 1,000 次 $0.01 |
| Google Cloud | 每月读取的前 1,000,000 个时间序列免费，之后每百万个 $0.50 |
| Google Cloud 成本 | BigQuery 对结算导出的查询收费：每月前 1 TiB 免费，之后每 TiB $6.25 |

Service Bus 或 Event Hubs 命名空间的关键指标会按 `EntityName` 维度拆分，为它的每个队列、主题和事件中心读取，每次读取仍然只对每个命名空间调用一次：每 5 分钟读取一次时，有 50 个队列的命名空间每小时调用 12 次，与只有一个队列的命名空间相同。每次读取每个命名空间最多读取 1,000 个，超出时会说明。每一个的指标都显示在 [队列](/docs/telemetry/queues#azure-service-bus) 下它自己的页面上，归属方式与 Collector 的 `azure_monitor` 接收器相同；如果该接收器也读取某个队列的同一指标，则保留它的值并舍弃连接的值，因此不会重复计数。

## 你在 OneUptime 中看到的内容

- **账户的页面。** 在 **云 → 账户** 下，账户的概览会按类型和区域统计其资源，并说明某个连接上次读取它的时间。它的 **资源** 会列出这些资源，它的 **更改** 会按从新到旧列出其中发生的变更，它的 **拓扑** 会绘制它的区域、其中的网络以及每个网络中运行的内容，并在关联的资源上显示未关闭的事件和警报。在 **更改** 中，OneUptime AI 所做的更改会标为 **OneUptime AI**，并附上它修复的事件或警报、批准者（或说明它是自动执行的），以及指向账户 **AI 日志** 中对应条目的链接。它的 **动态** 会记录该账户如何来到 OneUptime、它的云 AI 代理何时连接或被重置，以及谁更改了 OneUptime AI 在其中可以做什么。
- **资源的变更。** 一项变更会保存为一个变更事件，关联到它所变更的资源和该资源的账户，并与资源的事件和警报一起，以标记的形式绘制在资源的指标图表上。未筛选到任何资源的图表不会显示云账户的活动日志，这样繁忙的账户就不会挤掉你的部署；提供商的健康事件仍会保留在这些图表上。
- **事件和警报。** 在监控器、事件或警报的关联资源中关联一个云资源，它的事件和警报就会列在该资源的页面上。如果网站、API、SSL、ping 或端口监控器的主机直接或通过 DNS 指向某个资源的端点，该监控器的 **已关联资源** 卡片会在 **建议的云资源** 下列出该资源：选择 **关联资源** 即可关联它。
- **资源的健康状况。** 每次读取都会保存资源关键指标的最新值并加以判断：资源会显示 **健康**、**性能下降** 或 **不健康**，并附上原因，例如状态检查失败或存储快满，指标停止时会显示 **未上报**。**云 → 概览** 和账户的概览会列出需要关注的内容，最紧急的排在最前。
- **推荐的监视器。** 账户的 **建议** 按资源类型列出 OneUptime 为其资源推荐的监视器，以及每个监视器适用的资源和已有多少资源设置了它：可以将其添加到单个资源，或一次添加到同类型的所有资源，侧边菜单会统计仍待设置的数量。资源自己的 **建议** 选项卡会提供它自己的监视器。每个监视器每 5 分钟读取一次连接所读取的关键指标，在 AWS 上读取最近 30 分钟、在 Azure 和 Google Cloud 上读取最近 15 分钟的数据，并关联到其资源。计数（例如错误或被限流的请求）会在该时间窗口内汇总，因此[以流式方式传输指标](/docs/telemetry/cloud-streaming)的账户与被读取的账户会以相同方式告警，流式传输的账户会更早告警。ACM 每天发布两次的证书剩余天数每小时读取一次：其监视器读取最近 2 天的数据，在证书剩余 30 天或更少时，或在证书过期、ACM 停止发布时告警。RDS 实例的连接数会与其实例类和引擎连接上限的 90% 进行比较。当[维护事件](/docs/scheduled-maintenance/creating-events)包含某个资源时，其监视器不会创建事件或警报。
- **账户的成本。** **云 → 支出 → 成本** 绘制每天的支出及其去向，**云 → 支出 → 节省** 列出减少支出的方法，**云 → 支出 → 预算** 会在某个月的成本超出应有水平之前发出警报：[云成本与节省](/docs/telemetry/cloud-costs)。

## 让 AI 修复问题

OneUptime AI 在调查时会借助上面的只读访问读取每个已连接的账户。若要让它也能修复问题，例如重启服务、对其扩容或将其回滚，请在 **云 → 账户** 下打开该账户，然后在其 **概览** 的 **AI 代理** 卡片中选择 **让 AI 修复问题**。

对话框只问一个问题——**AI 可以做到哪一步？** 选择默认的 **先询问我** 时，OneUptime AI 会提出每项修复，由人一键批准；选择 **自行修复低风险问题** 时，安全的更改会自行运行，风险较高的更改仍需等待批准。其他所有设置都在 **更多字段** 下，并有安全的默认值。随后它会显示一条为此账户编写的命令：请以可以在该账户中创建角色的身份登录，在 AWS CloudShell、Azure Cloud Shell 或 Google Cloud Shell 中运行它。该命令会创建一个只能进行已开启更改的角色，并用它在你的账户中启动云 AI 代理。代理会在几分钟内自行连接，对话框也会显示这一点：无需粘贴任何内容。

该命令包含一个仅为此账户的代理创建的密钥，在代理用它连接之前一天内有效：重新打开对话框即可获取新密钥。只有可以重置代理并编辑该账户的人才能获得密钥。

对于读取 AWS Organization 的连接所找到的 AWS 账户，对话框还会询问 **哪些账户？**：选择 **组织的所有账户** 后，只需在管理账户的 AWS CloudShell 中运行一条命令，即可在组织的每个账户中各设置一个代理，每个代理都有自己的密钥和相同的最小权限角色，并列出哪些账户的代理已连接。

代理整月都在你的账户中运行，由你的云按其标价计费。在 Google Cloud 上，它运行在一台专属的小型虚拟机上，所在网络不允许任何入站连接；如果项目所属组织不允许任何虚拟机拥有外部 IP 地址，请在 **更多字段** 的 **代理的运行位置** 中选择 **Cloud Run**：

| 云 | 运行的内容 | 大约 |
| --- | --- | --- |
| AWS | 一个 0.25 vCPU、0.5 GB 的 ECS Fargate 任务及其公共 IPv4 地址，按 `us-east-1` 的价格计算 | 每月 $13 |
| Azure | 一个 0.25 vCPU、0.5 GiB 的 Container Apps 副本，扣除订阅每月 180,000 vCPU 秒和 360,000 GiB 秒的免费额度之后 | 每月 $14 |
| Google Cloud | 一台 `e2-micro` Compute Engine 虚拟机，及其 10 GB 标准启动磁盘和外部 IPv4 地址，按 `us-central1` 的价格计算。Google Cloud 的免费层级每月涵盖 `us-central1`、`us-west1` 和 `us-east1` 中的一台 `e2-micro` 虚拟机 | 每月 $10 |
| Google Cloud（Cloud Run 上） | 一个 1 vCPU、0.5 GiB 且始终分配 CPU 的 Cloud Run 实例，它会占用一整个 vCPU，扣除每月 240,000 vCPU 秒和 450,000 GiB 秒的免费层级之后 | 每月 $45 |

代理可以更改什么、每项更改如何分级和撤销，以及如何读取其日志：[基础设施 AI 代理](/docs/ai/infrastructure-ai-agents#在云账户中)。

## 故障排除

:::details 测试显示密钥或机密未被接受
复制命令输出的全部内容并重新粘贴。刚创建的密钥可能需要一点时间才能生效。已过期的 Azure 机密也会被拒绝：请再次运行该命令。
:::

:::details 测试可以登录，但无法读取
再次运行该命令：它会授予 OneUptime 所需的角色。在 AWS 上，请运行表单为此项目显示的命令：为其他项目创建的角色信任的是那个项目的外部 ID，而不是此项目的外部 ID。
:::

:::details Google Cloud 不允许该命令创建密钥
组织政策 `iam.disableServiceAccountKeyCreation` 可能禁止服务账号密钥。请向组织的管理员申请为该项目设置例外，或[使用你自己的采集器发送指标](/docs/telemetry/cloud-resources)。
:::

:::details 没有显示任何资源
首次读取会列出账户的每个资源，无论它是否上报指标。如果某个连接无法正常工作，**云 → 连接** 中的 **查看错误** 会说明其上次读取失败的原因。
:::

:::details 组织的部分账户缺失
一个连接最多读取 50 个账户、订阅或项目，超出时每次读取都会说明。请用单独的连接连接其余的账户。
:::

:::details 读取有警告
正常工作的读取仍可能遗漏一些内容，例如云没有为某些资源返回的指标，或命名空间中超出前 1,000 个的队列。此时，**云 → 连接** 中连接的状态会显示其上次读取有多少个警告：选择它即可逐条查看。
:::

## 后续步骤

:::cards
- [云资源](/docs/telemetry/cloud-resources): 改为运行你自己的 OpenTelemetry Collector，或以流方式发送 CloudWatch 指标。
- [部署与变更](/docs/telemetry/change-events): OneUptime 记录的每项变更，以及 OneUptime AI 如何读取它们。
- [指标监控器](/docs/monitor/metrics-monitor): 根据资源的指标发出告警。
:::
