# クラウド アカウントの接続

ダッシュボードから AWS アカウント、Azure サブスクリプション、Google Cloud プロジェクトを接続すると、OneUptime がその中のすべてのリソースを一覧にし、主要なメトリクスを読み取って各リソースの状態を伝え、リソースで何が変わったか、クラウド プロバイダーがリソースの状態について何を伝えているかを記録し、アカウントのコストとコストを下げる方法を読み取ります。クラウドのブラウザー ターミナルでコマンドを一つ実行し、出力を貼り付けるだけです。コレクターの運用も、インストールも不要です。

:::cards
- [Amazon Web Services](#amazon-web-services): OneUptime がサインインする IAM ロール、またはアクセス キー。
- [Microsoft Azure](#microsoft-azure): Monitoring Reader と Cost Management Reader のロールを持つアプリ。
- [Google Cloud](#google-cloud): 読み取り専用の六つのロールを持つサービス アカウント。
- [OneUptime が読み取るもの](#oneuptime-が読み取るもの): リソース、メトリクス、変更、ヘルス イベント、コストを、どのくらいの頻度で読み取り、読み取りにいくらかかるか。
- [クラウドのコストと節約](/docs/telemetry/cloud-costs): 各アカウントのコスト、支出を減らす方法、アラートを出す予算。
- [CloudWatch のメトリクスとログのストリーミング](/docs/telemetry/cloud-streaming): すべてのメトリクスを数分以内に、CloudWatch Logs も Amazon Data Firehose 経由で。
- [Azure Monitor のメトリクスとログのストリーミング](/docs/telemetry/cloud-streaming-azure): 主要メトリクスを数分以内に、リソースログも、サブスクリプション内のイベント ハブから読み取ります。
- [Google Cloud のログのストリーミング](/docs/telemetry/cloud-streaming-google-cloud): 書き込まれたそばからすべてのログを、Pub/Sub 経由でプッシュします。
- [データセキュリティ](#データセキュリティ): 接続によってデータセキュリティが読み取れるものと、各レベルがコマンドに追加するもの。
- [AI に問題を修正させる](#ai-に問題を修正させる): コマンドをもう一つ実行すれば、OneUptime AI は見つけた問題を修正できます。
:::

## 仕組み

```mermaid title="クラウドからクラウドリソースへ"
flowchart TB
    cmd["クラウドのターミナルで<br/>コマンドを一つ実行"] --> access["読み取り専用のアクセス"]
    access --> ou["OneUptime が<br/>数分ごとに読み取る"]
    ou --> res["クラウドリソース"]
    ou --> met["メトリクス"]
    ou --> chg["変更と<br/>ヘルス イベント"]
```

- **アクセスは読み取りだけです。** コマンドが作成するアクセスは、リソースとその設定、メトリクス、変更内容、プロバイダーのヘルス イベント、アカウントのコストを読み取るだけで、それ以外は何もできません。AWS では下に挙げるアクション、Azure では **Monitoring Reader** と **Cost Management Reader** のロール、Google Cloud では六つの閲覧者ロールです。OneUptime がこのアクセスでデータやシークレットを読み取ることはありません。ただし、AI にアカウントのログの読み取りを許可した場合はログ行を、[データセキュリティ](#データセキュリティ) でコンテンツのサンプルをオンにした場合はそのサンプルを読み取ります。削除すれば OneUptime のアクセスを止められます。
- **OneUptime は定期的に読み取ります。** 接続時に別の間隔を選ばない限り、Azure と Google Cloud は 5 分ごと、AWS は 10 分ごとです。各読み取りは前回からの変更も記録し、30 分ごとにすべてのリソースをもう一度一覧にします。
- **リソースごとに専用のページがあります。** リソースは **クラウド → すべてのリソース** に、状態、主要なメトリクス、オーナー、ラベルとともに表示されます。一覧に載ったリソースのページには、**つながっているリソース** (どこで動いているか、どこからトラフィックが来るか)、エンドポイント、タグ、設定、そして **インシデント**、**アラート**、**変更** も表示されます。
- **アカウントごとに専用のページがあります。** アカウントは **クラウド → アカウント** に、種類とリージョン別のリソース、**コスト**、**変更**、リソースどうしのつながりを示す **トポロジー** とともに表示されます。
- **クラウドは概要から開きます。** **クラウド → 概要** には、対応が必要なリソースとその理由、今月のアカウントのコスト、クラウドが節約できると伝えている額が表示されます。コスト、節約、予算の読み取り方は [クラウドのコストと節約](/docs/telemetry/cloud-costs) で説明しています。アカウントでマネージドなアプリプラットフォーム上のアプリが動いている場合は、**アプリプラットフォーム** カードがその環境とアプリを数え、それぞれの数はそのアカウントで絞り込んだ状態でアプリプラットフォームの一覧を開きます。
- **OneUptime AI が変更を読み取ります。** クラウド リソースにリンクされたインシデントやアラートの調査は、まずそのリソースの変更を読み取り、開始時にアカウントのアクティビティ ログを読み直します。

## 始める前に

- **プロジェクトのオーナーまたは管理者。** クラウド アカウントを接続、テスト、編集できるのはこの人たちだけです。
- **クラウドのターミナル** (AWS CloudShell、Azure Cloud Shell、Google Cloud Shell)。IAM ロールまたはユーザー、アプリの登録、サービス アカウントを作成できる人がサインインしている必要があります。

## Amazon Web Services

:::steps
### AWS のフォームを開く

**クラウド → 接続** に移動し、**Amazon Web Services** を選びます。

### AWS CloudShell でコマンドを実行する

OneUptime のサインイン方法を選びます。推奨は **IAM ロール** です。秘密情報は保存されず、ロールはいつでも削除できます。フォームには、プロジェクト用に書かれたコマンドが表示されます。このコマンドは、プロジェクトの外部 ID で OneUptime の AWS アカウントを信頼するロールを作成し、ロールの ARN を出力します。

**読み取る対象** で、このアカウントか、AWS Organization のすべてのアカウントを選びます。組織用のコマンドは管理アカウントで実行します。このコマンドは、すべてのアカウントに同じロールを置く StackSet を追加し (今あるアカウントにも、あとから加わるアカウントにも)、管理アカウントのロールがアカウントを一覧にできるようにします。一つの接続で最大 50 個のアカウントを読み取ります。

ロールを使えない場合は **アクセス キー** を使います。読み取れるのは自分のアカウントだけです。次のコマンドは同じ権限を持つユーザーを作成し、そのキーを出力します。

```bash
aws iam create-user --user-name OneUptimeReadOnly > /dev/null 2>&1 || true
aws iam put-user-policy --user-name OneUptimeReadOnly --policy-name OneUptimeReadOnly --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["cloudwatch:GetMetricData","cloudwatch:ListMetrics","tag:GetResources","iam:ListAccountAliases","cloudformation:ListResources","ec2:DescribeInstances","ec2:DescribeVolumes","ec2:DescribeVpcs","ec2:DescribeNatGateways","autoscaling:DescribeAutoScalingGroups","elasticloadbalancing:DescribeLoadBalancers","elasticloadbalancing:DescribeLoadBalancerAttributes","elasticloadbalancing:DescribeTargetGroups","elasticloadbalancing:DescribeTargetGroupAttributes","elasticloadbalancing:DescribeTargetHealth","elasticloadbalancing:DescribeTags","ecs:ListClusters","ecs:DescribeClusters","ecs:ListServices","ecs:DescribeServices","lambda:ListFunctions","rds:DescribeDBInstances","rds:DescribeDBClusters","elasticache:DescribeReplicationGroups","sqs:ListQueues","sqs:GetQueueAttributes","sns:ListTopics","sns:GetTopicAttributes","sns:ListSubscriptionsByTopic","dynamodb:ListTables","dynamodb:DescribeTable","kinesis:ListStreams","kinesis:DescribeStreamSummary","states:ListStateMachines","states:DescribeStateMachine","cloudfront:ListDistributions","elasticfilesystem:DescribeFileSystems","es:ListDomainNames","es:DescribeDomains","apprunner:ListServices","apprunner:DescribeService","elasticbeanstalk:DescribeEnvironments","cloudtrail:LookupEvents","health:DescribeEvents","health:DescribeEventDetails","ce:GetCostAndUsage","ce:GetCostAndUsageWithResources","ce:GetSavingsPlansCoverage","ce:GetSavingsPlansUtilization","ce:GetReservationCoverage","ce:GetReservationUtilization","cost-optimization-hub:ListRecommendations","rds:DescribeEvents","autoscaling:DescribeScalingActivities","ec2:DescribeInstanceStatus","ecs:DescribeTaskDefinition","lambda:GetFunctionConfiguration","lambda:GetFunctionConcurrency","lambda:GetAlias","servicequotas:ListServiceQuotas","logs:DescribeLogGroups","logs:FilterLogEvents"],"Resource":"*"},{"Effect":"Allow","Action":["apigateway:GET"],"Resource":["arn:aws:apigateway:*::/restapis*","arn:aws:apigateway:*::/apis*"]}]}'
aws iam create-access-key --user-name OneUptimeReadOnly
```

### AWS のコマンドの出力を貼り付ける

コマンドの出力をすべて **コマンドの出力** に貼り付けます。OneUptime がロールの ARN、またはアクセス キー ID とそのシークレットを取り出します。

### AWS をテストして接続する

この手順を開くと、OneUptime が接続をテストします。サインインし、見つかったリソースを数え、読み取りにかかる費用を示します。**接続** を選んで保存します。
:::

このロールとユーザーにできるのは次のことだけです。

| OneUptime の用途 | アクション |
| --- | --- |
| メトリクスを送信しているリソースを見つけ、そのメトリクスを読み取る | `cloudwatch:GetMetricData`, `cloudwatch:ListMetrics` |
| 各リソースに名前を付け、そのタグを読み取る | `tag:GetResources`, `iam:ListAccountAliases` |
| Cloud Control を通じて、すべてのリソースとその構成を一覧にする | `cloudformation:ListResources`, `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ec2:DescribeVpcs`, `ec2:DescribeNatGateways`, `autoscaling:DescribeAutoScalingGroups`, `elasticloadbalancing:DescribeLoadBalancers`, `elasticloadbalancing:DescribeLoadBalancerAttributes`, `elasticloadbalancing:DescribeTargetGroups`, `elasticloadbalancing:DescribeTargetGroupAttributes`, `elasticloadbalancing:DescribeTargetHealth`, `elasticloadbalancing:DescribeTags`, `ecs:ListClusters`, `ecs:DescribeClusters`, `ecs:ListServices`, `ecs:DescribeServices`, `lambda:ListFunctions`, `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `elasticache:DescribeReplicationGroups`, `sqs:ListQueues`, `sqs:GetQueueAttributes`, `sns:ListTopics`, `sns:GetTopicAttributes`, `sns:ListSubscriptionsByTopic`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `kinesis:ListStreams`, `kinesis:DescribeStreamSummary`, `states:ListStateMachines`, `states:DescribeStateMachine`, `cloudfront:ListDistributions`, `elasticfilesystem:DescribeFileSystems`, `es:ListDomainNames`, `es:DescribeDomains`, `apprunner:ListServices`, `apprunner:DescribeService`, `elasticbeanstalk:DescribeEnvironments`, `apigateway:GET` |
| 変更を読み取る: アカウントの管理イベント | `cloudtrail:LookupEvents` |
| アカウントに関する AWS 自身のヘルス イベントを読み取る | `health:DescribeEvents`, `health:DescribeEventDetails` |
| アカウントのコストを Cost Explorer から読み取る | `ce:GetCostAndUsage`, `ce:GetCostAndUsageWithResources`, `ce:GetSavingsPlansCoverage`, `ce:GetSavingsPlansUtilization`, `ce:GetReservationCoverage`, `ce:GetReservationUtilization` |
| 支出を減らす方法を Cost Optimization Hub から読み取る | `cost-optimization-hub:ListRecommendations` |
| 調査中に、リソースの現在の状態と最近のイベントを読み取る | `rds:DescribeEvents`, `autoscaling:DescribeScalingActivities`, `ec2:DescribeInstanceStatus`, `ecs:DescribeTaskDefinition`, `lambda:GetFunctionConfiguration`, `lambda:GetFunctionConcurrency`, `lambda:GetAlias` |
| 調査中に、アカウントのクォータを読み取る | `servicequotas:ListServiceQuotas` |
| AI にアカウントのログの読み取りを許可した場合にのみ、ログ行を読み取る | `logs:DescribeLogGroups`, `logs:FilterLogEvents` |
| 管理アカウントから組織のアカウントを一覧にする | `organizations:ListAccounts` |

`apigateway:GET` は API 自身の定義に対してだけ許可され、キーには許可されません。また、組織のアカウントを一覧にできるのは管理アカウントのロールだけです。AWS Health が応答するのは、Business、Enterprise On-Ramp、Enterprise のいずれかのサポート プランを契約しているアカウントだけです。契約がない場合、OneUptime は一日後にもう一度問い合わせます。

> [!NOTE]
> セルフホストの OneUptime では、**IAM ロール** の方式に OneUptime 自身の AWS ID が必要です。`CLOUD_CONNECT_AWS_ACCESS_KEY_ID` と `CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY` に、`sts:AssumeRole` を呼び出せる IAM ユーザーのキーを設定してください。設定がない場合、フォームは **アクセス キー** を提示します。

## Microsoft Azure

:::steps
### Azure のフォームを開く

**クラウド → 接続** に移動し、**Microsoft Azure** を選びます。

### Azure Cloud Shell でコマンドを実行する

このコマンドは、現在のサブスクリプションで **Monitoring Reader** と **Cost Management Reader** のロールを持つアプリを作成し、その詳細をシークレットの有効期限とともに出力します。

```bash
SCOPE="/subscriptions/$(az account show --query id --output tsv)"
OUT=$(az ad sp create-for-rbac --name OneUptimeReadOnly --role "Monitoring Reader" --scopes "$SCOPE")
APP=$(echo "$OUT" | jq -r .appId)
az role assignment create --assignee "$APP" --role "Cost Management Reader" --scope "$SCOPE" > /dev/null
END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)
echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'
```

**読み取る対象** でテナントのすべてのサブスクリプションを選ぶと、ロールはテナントのルート管理グループに付与されます。

```bash
SCOPE="/providers/Microsoft.Management/managementGroups/$(az account show --query tenantId --output tsv)"
OUT=$(az ad sp create-for-rbac --name OneUptimeReadOnly --role "Monitoring Reader" --scopes "$SCOPE")
APP=$(echo "$OUT" | jq -r .appId)
az role assignment create --assignee "$APP" --role "Cost Management Reader" --scope "$SCOPE" > /dev/null
END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)
echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'
```

### Azure のコマンドの出力を貼り付ける

コマンドの出力をすべて **コマンドの出力** に貼り付けます。OneUptime が `tenant`、`appId`、`password` と有効期限を取り出します。

### Azure をテストして接続する

この手順を開くと、OneUptime が接続をテストします。**接続** を選んで保存します。
:::

同じアプリでほかのサブスクリプションも読み取るには、それぞれのサブスクリプションでアプリに両方のロールを付与します。

```bash
az role assignment create --assignee <APP_ID> --role "Monitoring Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
az role assignment create --assignee <APP_ID> --role "Cost Management Reader" --scope /subscriptions/<SUBSCRIPTION_ID>
```

**サブスクリプション** にいくつか指定しない限り、OneUptime はアプリが読み取れるすべてのサブスクリプションを最大 50 個まで読み取ります。アプリのシークレットは有効期限の日に使えなくなります。その 30 日前から、読み取りのたびに警告が出ます。コマンドをもう一度実行して出力を貼り付けると、新しいシークレットになります。

## Google Cloud

:::steps
### Google Cloud のフォームを開く

**クラウド → 接続** に移動し、**Google Cloud** を選びます。

### Google Cloud Shell でコマンドを実行する

監視するプロジェクトで実行します。OneUptime が読み取る API を有効にし、**Monitoring Viewer**、**Cloud Asset Viewer**、**Logs Viewer**、**Service Health Viewer**、**BigQuery Job User**、**Compute Recommender Viewer** の各ロールを持つサービス アカウントを作成して、そのキーを出力します。

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

**読み取る対象** で組織のすべてのプロジェクトを選ぶと、ロールはプロジェクトの組織に付与されます。

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

### キーを貼り付ける

コマンドの出力をすべて貼り付けます。OneUptime はキー自身のプロジェクトを読み取り、キーを暗号化して保存します。

### Google Cloud をテストして接続する

この手順を開くと、OneUptime が接続をテストします。**接続** を選んで保存します。
:::

同じサービス アカウントでほかのプロジェクトも読み取るには、それぞれのプロジェクトで次のロールを付与し、**プロジェクト** に指定します。

```bash
for ROLE in roles/monitoring.viewer roles/cloudasset.viewer roles/logging.viewer roles/servicehealth.viewer roles/recommender.computeViewer; do gcloud projects add-iam-policy-binding <PROJECT_ID> --member "serviceAccount:oneuptime-read-only@<KEY_PROJECT_ID>.iam.gserviceaccount.com" --role "$ROLE"; done
```

**プロジェクト** にいくつか指定しない限り、組織の接続はその組織のプロジェクトを最大 50 個まで読み取ります。

Google Cloud にはプロジェクトのコストを返す API がありません。OneUptime は請求先アカウントの BigQuery へのエクスポートからコストを読み取ります。そのテーブルを **課金エクスポートのテーブル** に指定すれば読み取りが始まります。手順は [クラウドのコストと節約](/docs/telemetry/cloud-costs#google-cloud) を参照してください。

## データセキュリティ

同じ接続で、[データセキュリティ](/docs/data-security/index) がアカウントのデータストア (バケット、データベース、データウェアハウス) を読み取れるようにもできます。**その他の項目** の **データセキュリティ** は、別の値を選ぶまで **オフ** で、フォームに表示されるコマンドはその値に合わせて変わります。

| データセキュリティ | データセキュリティが読み取れるもの | コマンドが追加するもの |
| --- | --- | --- |
| **オフ** | アカウントのデータストアはどれも読み取らない | なし |
| **設定のみ** | 各データストアにアクセスできる人と、その暗号化、バックアップ、ログ記録の設定。データは読み取らない。 | AWS では、読み取りアクションからなるもう一つのインラインポリシー `OneUptimeDataSecurity`。Azure と Google Cloud では何も追加しない。すでに **Monitoring Reader** と **Cloud Asset Viewer** で読み取れるため。 |
| **設定とコンテンツのサンプル** | 上記に加えて、機密データを見つけるためのオブジェクトと行のサンプル | AWS では、同じポリシーに `s3:ListBucket`、`s3:GetObject`、S3 経由に限った `kms:Decrypt` を加えたもの。Azure では **Storage Blob Data Reader**。Google Cloud では `roles/storage.objectViewer` と `roles/bigquery.dataViewer`。 |

AWS では、ロールのコマンドに一行加わり、それがポリシーを追加します。コンテンツのレベルでは次のとおりです。

```bash
aws iam put-role-policy --role-name "$ROLE" --policy-name OneUptimeDataSecurity --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListAllMyBuckets","s3:GetBucketLocation","s3:GetBucketPolicyStatus","s3:GetBucketPublicAccessBlock","s3:GetAccountPublicAccessBlock","s3:GetBucketAcl","s3:GetBucketPolicy","s3:GetEncryptionConfiguration","s3:GetBucketVersioning","s3:GetBucketLogging","s3:GetBucketOwnershipControls","s3:GetReplicationConfiguration","s3:GetBucketTagging","rds:DescribeDBInstances","rds:DescribeDBClusters","rds:DescribeDBSnapshots","rds:DescribeDBSnapshotAttributes","rds:DescribeDBClusterSnapshots","rds:DescribeDBClusterSnapshotAttributes","dynamodb:ListTables","dynamodb:DescribeTable","dynamodb:DescribeContinuousBackups","redshift:DescribeClusters","redshift:DescribeLoggingStatus","es:ListDomainNames","es:DescribeDomains","elasticache:DescribeReplicationGroups","elasticfilesystem:DescribeFileSystems","kms:ListAliases","iam:GetAccountAuthorizationDetails","iam:GenerateCredentialReport","iam:GetCredentialReport"],"Resource":"*"},{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::*"},{"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::*/*"},{"Effect":"Allow","Action":["kms:Decrypt"],"Resource":"*","Condition":{"StringLike":{"kms:ViaService":"s3.*.amazonaws.com"}}}]}'
```

IAM では、ユーザー自身のインラインポリシーは合計 2,048 文字までに制限されるため、**アクセス キー** の場合、ポリシーはユーザーが参加するグループ `OneUptimeDataSecurity` に付けられます。

```bash
aws iam create-user --user-name OneUptimeReadOnly > /dev/null 2>&1 || true
aws iam put-user-policy --user-name OneUptimeReadOnly --policy-name OneUptimeReadOnly --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["cloudwatch:GetMetricData","cloudwatch:ListMetrics","tag:GetResources","iam:ListAccountAliases","cloudformation:ListResources","ec2:DescribeInstances","ec2:DescribeVolumes","ec2:DescribeVpcs","ec2:DescribeNatGateways","autoscaling:DescribeAutoScalingGroups","elasticloadbalancing:DescribeLoadBalancers","elasticloadbalancing:DescribeLoadBalancerAttributes","elasticloadbalancing:DescribeTargetGroups","elasticloadbalancing:DescribeTargetGroupAttributes","elasticloadbalancing:DescribeTargetHealth","elasticloadbalancing:DescribeTags","ecs:ListClusters","ecs:DescribeClusters","ecs:ListServices","ecs:DescribeServices","lambda:ListFunctions","rds:DescribeDBInstances","rds:DescribeDBClusters","elasticache:DescribeReplicationGroups","sqs:ListQueues","sqs:GetQueueAttributes","sns:ListTopics","sns:GetTopicAttributes","sns:ListSubscriptionsByTopic","dynamodb:ListTables","dynamodb:DescribeTable","kinesis:ListStreams","kinesis:DescribeStreamSummary","states:ListStateMachines","states:DescribeStateMachine","cloudfront:ListDistributions","elasticfilesystem:DescribeFileSystems","es:ListDomainNames","es:DescribeDomains","apprunner:ListServices","apprunner:DescribeService","elasticbeanstalk:DescribeEnvironments","cloudtrail:LookupEvents","health:DescribeEvents","health:DescribeEventDetails","ce:GetCostAndUsage","ce:GetCostAndUsageWithResources","ce:GetSavingsPlansCoverage","ce:GetSavingsPlansUtilization","ce:GetReservationCoverage","ce:GetReservationUtilization","cost-optimization-hub:ListRecommendations","rds:DescribeEvents","autoscaling:DescribeScalingActivities","ec2:DescribeInstanceStatus","ecs:DescribeTaskDefinition","lambda:GetFunctionConfiguration","lambda:GetFunctionConcurrency","lambda:GetAlias","servicequotas:ListServiceQuotas","logs:DescribeLogGroups","logs:FilterLogEvents"],"Resource":"*"},{"Effect":"Allow","Action":["apigateway:GET"],"Resource":["arn:aws:apigateway:*::/restapis*","arn:aws:apigateway:*::/apis*"]}]}'
aws iam create-group --group-name OneUptimeDataSecurity > /dev/null 2>&1 || true
aws iam put-group-policy --group-name OneUptimeDataSecurity --policy-name OneUptimeDataSecurity --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListAllMyBuckets","s3:GetBucketLocation","s3:GetBucketPolicyStatus","s3:GetBucketPublicAccessBlock","s3:GetAccountPublicAccessBlock","s3:GetBucketAcl","s3:GetBucketPolicy","s3:GetEncryptionConfiguration","s3:GetBucketVersioning","s3:GetBucketLogging","s3:GetBucketOwnershipControls","s3:GetReplicationConfiguration","s3:GetBucketTagging","rds:DescribeDBInstances","rds:DescribeDBClusters","rds:DescribeDBSnapshots","rds:DescribeDBSnapshotAttributes","rds:DescribeDBClusterSnapshots","rds:DescribeDBClusterSnapshotAttributes","dynamodb:ListTables","dynamodb:DescribeTable","dynamodb:DescribeContinuousBackups","redshift:DescribeClusters","redshift:DescribeLoggingStatus","es:ListDomainNames","es:DescribeDomains","elasticache:DescribeReplicationGroups","elasticfilesystem:DescribeFileSystems","kms:ListAliases","iam:GetAccountAuthorizationDetails","iam:GenerateCredentialReport","iam:GetCredentialReport"],"Resource":"*"},{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::*"},{"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::*/*"},{"Effect":"Allow","Action":["kms:Decrypt"],"Resource":"*","Condition":{"StringLike":{"kms:ViaService":"s3.*.amazonaws.com"}}}]}'
aws iam add-user-to-group --user-name OneUptimeReadOnly --group-name OneUptimeDataSecurity
aws iam create-access-key --user-name OneUptimeReadOnly
```

Azure では、コンテンツのレベルで **Monitoring Reader** と同じスコープに **Storage Blob Data Reader** が追加されます。

```bash
SCOPE="/subscriptions/$(az account show --query id --output tsv)"
OUT=$(az ad sp create-for-rbac --name OneUptimeReadOnly --role "Monitoring Reader" --scopes "$SCOPE")
APP=$(echo "$OUT" | jq -r .appId)
az role assignment create --assignee "$APP" --role "Cost Management Reader" --scope "$SCOPE" > /dev/null
az role assignment create --assignee "$APP" --role "Storage Blob Data Reader" --scope "$SCOPE" > /dev/null
END=$(az ad app credential list --id "$APP" --query "max([].endDateTime)" --output tsv)
echo "$OUT" | jq --arg end "$END" '. + {endDateTime: $end}'
```

Google Cloud では、二つのロールを追加します。

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

低いレベルのコマンドは、AWS のポリシーをその低いレベルのものに置き換えます。**オフ** は何も追加しないため、以前のコマンドが付与したものは、削除するまでそのまま残ります。AWS の `OneUptimeDataSecurity` ポリシー (`aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity` で削除します) と、Azure と Google Cloud のコンテンツのレベルのロールです。どちらの場合も、データセキュリティはすぐに読み取りを止めます。読み取るのは、接続のレベルが許すものだけだからです。[データセキュリティを設定する](/docs/data-security/setup) には、ポリシーのすべてのアクションと、データセキュリティが読み取ったものから何を保持するかが載っています。

## OneUptime が読み取るもの

| | AWS | Azure | Google Cloud |
| --- | --- | --- | --- |
| リソース | 使用中のすべてのリージョンにある、OneUptime が知っている種類のすべてのリソース (Cloud Control から) | サブスクリプション内のすべてのリソース (Resource Graph から) | プロジェクト内のすべてのリソース (Cloud Asset Inventory から) |
| メトリクス | 各サービスの主要なメトリクス (インスタンスの CPU、ネットワーク、ステータス チェックなど) | リソースごとに最大 8 個の主要なメトリクス | 各リソース タイプの主要なメトリクス |
| 変更 | CloudTrail の管理イベント | アクティビティ ログの管理イベント | Admin Activity 監査ログ |
| ヘルス イベント | AWS Health | Service Health と Resource Health | Service Health |
| コスト | 毎日のコストを、サービスとリージョン別に、「リソースごとのコスト」がオンならリソース別にも Cost Explorer から | 毎日のコストを、リソースとサービス別に Cost Management から | 毎日のコストを、サービス、リージョン、リソース別に BigQuery への課金エクスポートから |
| 支出を減らす方法 | Cost Optimization Hub | Azure Advisor | Recommender |
| コミットメント | Savings Plans とリザーブドインスタンス: 対象範囲と使用された割合を Cost Explorer から | 節約プランと予約を Cost Management から | 確約利用割引を BigQuery への課金エクスポートから |
| 読み取り間隔 | 10 分 | 5 分 | 5 分 |
| 削除されたリソース | 完全な一覧に載らなくなるとアーカイブ | 完全な一覧に載らなくなるとアーカイブ | 完全な一覧に載らなくなるとアーカイブ |

各読み取りは前回の続きから始まるため、各データ ポイントと各変更は一度だけ書き込まれます。セキュリティイベントで **クラウド監査ログ** を有効にすると、同じ読み取りでアカウントの監査ログも [セキュリティイベント](/docs/telemetry/security-events#クラウド-アカウントの監査ログを読み取る) として保存されます。新しい接続の最初の読み取りは一分以内に始まり、メトリクスは一時間分、変更は 2 時間分さかのぼります。中断のあとの読み取りは、さかのぼっても最大 6 時間です。メトリクスを報告するだけでどの一覧にも載らないリソースは、メトリクスが 7 日間なければアーカイブされます。コストは一日に二回、支出を減らす方法とコミットメントは一日に一回読み取られます。

OneUptime の呼び出しは、クラウドの料金でお使いのクラウド アカウントに請求されます。リソースの一覧、変更やヘルス イベントの読み取り、支出を減らす方法の読み取り、Azure のコストの読み取りは無料です。費用がかかるのはメトリクスの読み取りと、AWS と Google Cloud のコストの読み取りです。テストは見つかったものの費用を見積もります。読み取り頻度を下げると費用も下がります。**その他の項目** の **メトリクスの読み取り間隔** を変更してください。

| クラウド | 料金 |
| --- | --- |
| AWS | CloudWatch `GetMetricData`: 1,000 メトリクスあたり $0.01。リソースの主要なメトリクス一つにつき、読み取りごとに一メトリクス |
| AWS のコスト | Cost Explorer: リクエストあたり $0.01。コストの読み取り一回で数回、コミットメントで一日に四回、「リソースごとのコスト」で一日にさらに数回リクエストします |
| Azure | 各サブスクリプションで月 1,000,000 回までのメトリクス読み取りは無料。その後は 1,000 回あたり $0.01 |
| Google Cloud | 月 1,000,000 件までの時系列の読み取りは無料。その後は百万件あたり $0.50 |
| Google Cloud のコスト | 課金エクスポートへのクエリは BigQuery の料金です。月 1 TiB までは無料、その後は TiB あたり $6.25 |

Service Bus または Event Hubs の名前空間の主要メトリクスは、`EntityName` ディメンションで分割して、キュー、トピック、イベントハブごとに読み取られます。呼び出しは読み取りのたびに名前空間ごとに同じ一回だけです: 5 分ごとに読み取る場合、50 個のキューがある名前空間でも、キューが一つの名前空間と同じく一時間に 12 回の呼び出しです。一回の読み取りで名前空間あたり最大 1,000 個まで読み取り、それより多い場合はそのことを伝えます。それぞれのメトリクスは [キュー](/docs/telemetry/queues#azure-service-bus) にあるそのページに、Collector の `azure_monitor` レシーバーと同じ方法で振り分けられて表示されます。そのレシーバーもキューのメトリクスを読み取っている場合は、レシーバーの値を残して接続の値を除くため、二重に数えられることはありません。

## OneUptime で見えるもの

- **アカウントのページ。** **クラウド → アカウント** で、アカウントの概要には種類とリージョン別のリソース数と、接続が最後に読み取った時刻が表示されます。**リソース** にはリソースの一覧、**変更** には新しい順の変更、**トポロジー** にはリージョン、その中のネットワーク、それぞれで動いているものが、リンクされたリソース上の未解決のインシデントとアラートとともに描かれます。**変更** では、OneUptime AI が行った変更に **OneUptime AI** と表示され、修正したインシデントまたはアラート、承認した人(または自動で実行されたこと)、そしてアカウントの **AI ログ** にあるその項目へのリンクが付きます。**フィード** には、アカウントが OneUptime に加わった経緯、クラウド AI エージェントの接続やリセット、そして OneUptime AI がそこで行えることを誰が変更したかが記録されます。
- **リソースの変更。** 変更は、変更したリソースとそのアカウントに結び付いた変更イベントとして保存され、リソースのメトリクス チャートにインシデントやアラートとともにマーカーとして描かれます。どのリソースにも絞り込まれていないチャートには、クラウド アカウントのアクティビティ ログは表示されません。忙しいアカウントでデプロイが埋もれないようにするためです。プロバイダーのヘルス イベントは表示されたままです。
- **インシデントとアラート。** モニター、インシデント、アラートのリンクされたリソースでクラウド リソースをリンクすると、そのインシデントとアラートがリソースのページに一覧表示されます。ホストがリソースのエンドポイントに (直接、または DNS を通じて) つながる Web サイト、API、SSL、ping、ポートのモニターでは、**リンクされたリソース** カードの **おすすめのクラウドリソース** にそのリソースが表示されます。**リソースをリンク** を選んでリンクします。
- **リソースの状態。** 各読み取りはリソースの主要なメトリクスの最新値を保持して判定します。リソースには **正常**、**機能低下**、**異常** が理由とともに表示されます (ステータス チェックの失敗、ストレージの残りわずかなど)。メトリクスが止まると **報告なし** になります。**クラウド → 概要** とアカウントの概要には、対応が必要なものが緊急度の高い順に表示されます。
- **推奨モニター。** アカウントの **推奨事項** には、OneUptime がそのリソースに推奨するモニターが、リソースのタイプごとに、それぞれの対象リソースと設定済みの数とともに一覧表示されます。あるリソースに追加することも、同じタイプのすべてのリソースに一度に追加することもでき、サイドメニューはまだセットアップされていないものを数えます。リソースの **推奨事項** タブには、そのリソース向けのモニターが表示されます。各モニターは、接続が読み取る主要なメトリクスを 5 分ごとに、AWS では直近 30 分、Azure と Google Cloud では直近 15 分にわたって読み取り、対象のリソースにリンクされます。エラーやスロットリングされたリクエストのような件数はそのウィンドウ全体で合計されるため、[メトリクスをストリーミングする](/docs/telemetry/cloud-streaming)アカウントと読み取られるアカウントは同じようにアラートを出し、ストリーミングするアカウントのほうが早く出します。ACM が 1 日 2 回公開する証明書の有効期限までの日数は 1 時間ごとに読み取られます。そのモニターは直近 2 日間を読み取り、証明書の残りが 30 日以下になったとき、または証明書が期限切れになって ACM が公開をやめたときにアラートを出します。RDS インスタンスの接続数は、そのクラスとエンジンの接続上限の 90% と比較されます。[メンテナンスイベント](/docs/scheduled-maintenance/creating-events)がリソースを含んでいる間は、そのモニターはインシデントもアラートも作成しません。
- **アカウントのコスト。** **クラウド → 支出 → コスト** は毎日の支出とその内訳を描き、**クラウド → 支出 → 節約** は支出を減らす方法を一覧にし、**クラウド → 支出 → 予算** は月のコストが想定を超える前にアラートを出します。[クラウドのコストと節約](/docs/telemetry/cloud-costs) を参照してください。

## AI に問題を修正させる

OneUptime AI は調査中、上記の読み取り専用のアクセスで、接続されたすべてのアカウントを読み取ります。サービスの再起動、スケールアウト、ロールバックなどで問題の修正もさせるには、**クラウド → アカウント** でアカウントを開き、その **概要** にある **AI エージェント** カードで **AI に問題を修正させる** を選択します。

ダイアログは **AI にどこまで任せますか？** という一つの質問をします。デフォルトの **実行前に確認する** では OneUptime AI が修正をひとつずつ提案し、人がワンクリックで承認します。**安全な修正は自動で適用する** では安全な変更は自動的に実行され、よりリスクの高い変更は引き続き承認を待ちます。そのほかはすべて、**その他の項目** の下に安全なデフォルトがあります。次に、このアカウント用に書き出されたコマンドが一つ表示されます。アカウントでロールを作成できるユーザーとしてサインインし、AWS CloudShell、Azure Cloud Shell、または Google Cloud Shell で実行してください。コマンドは、有効にした変更だけを行えるロールを作成し、そのロールでクラウド AI エージェントをアカウント内に起動します。エージェントは数分以内に自動的に接続され、ダイアログにもそう表示されます。貼り戻すものは何もありません。

コマンドには、このアカウントのエージェント専用に作成されたキーが含まれます。このキーはエージェントが接続するまで一日間有効で、新しいキーはダイアログをもう一度開くと取得できます。キーを受け取れるのは、エージェントをリセットでき、アカウントを編集できる人だけです。

AWS Organization を読み取る接続が見つけた AWS アカウントでは、ダイアログで **どのアカウントに？** も尋ねます。**組織のすべてのアカウント** を選ぶと、管理アカウントの AWS CloudShell で一つのコマンドを実行するだけで、組織の各アカウントにエージェントを設定します。各エージェントは専用のキーと同じ最小権限のロールを持ち、どのアカウントのエージェントが接続したかが一覧で表示されます。

エージェントはアカウント内で月中ずっと動作し、クラウドの標準料金で請求されます。Google Cloud では、何も受け入れない専用ネットワーク内の小さな専用 VM で動作します。組織のポリシーで VM に外部 IP アドレスを持たせられないプロジェクトでは、**その他の項目** の **エージェントの実行場所** で **Cloud Run** を選んでください:

| クラウド | 実行されるもの | 目安 |
| --- | --- | --- |
| AWS | 0.25 vCPU と 0.5 GB の ECS Fargate タスク一つと、そのパブリック IPv4 アドレス(`us-east-1` の料金) | 月 $13 |
| Azure | 0.25 vCPU と 0.5 GiB の Container Apps レプリカ一つ。サブスクリプションの毎月の無料付与分である 180,000 vCPU 秒と 360,000 GiB 秒を差し引いた後 | 月 $14 |
| Google Cloud | `e2-micro` の Compute Engine VM 一つと、その 10 GB の標準ブートディスクと外部 IPv4 アドレス(`us-central1` の料金)。Google Cloud の無料枠で、`us-central1`、`us-west1`、`us-east1` の `e2-micro` VM 一つが毎月賄われます | 月 $10 |
| Google Cloud(Cloud Run 上) | CPU を常に割り当てた 1 vCPU と 0.5 GiB の Cloud Run インスタンス一つ(vCPU を丸ごと一つ使用)。毎月の無料枠である 240,000 vCPU 秒と 450,000 GiB 秒を差し引いた後 | 月 $45 |

エージェントが変更できるもの、各変更の段階と取り消し方、ログの読み方: [インフラストラクチャの AI エージェント](/docs/ai/infrastructure-ai-agents#クラウド-アカウント内で)。

## トラブルシューティング

:::details テストでキーまたはシークレットが受け付けられなかったと表示される
コマンドの出力をすべてコピーして、もう一度貼り付けてください。作成したばかりのキーは、使えるようになるまで少し時間がかかることがあります。有効期限が切れた Azure のシークレットも拒否されます。コマンドをもう一度実行してください。
:::

:::details テストでサインインはできるが、読み取れない
コマンドをもう一度実行してください。OneUptime に必要なロールが付与されます。AWS では、このプロジェクト用にフォームが表示するコマンドを実行してください。別のプロジェクト用に作成したロールは、そのプロジェクトの外部 ID を信頼しており、このプロジェクトのものではありません。
:::

:::details Google Cloud でコマンドがキーを作成できない
組織のポリシー `iam.disableServiceAccountKeyCreation` で、サービス アカウント キーが禁止されている場合があります。組織の管理者にこのプロジェクトの例外を依頼するか、[独自のコレクターでメトリクスを送信](/docs/telemetry/cloud-resources)してください。
:::

:::details リソースが表示されない
最初の読み取りでは、メトリクスを報告しているかどうかにかかわらず、アカウントのすべてのリソースが一覧になります。接続が動作していない場合は、**クラウド → 接続** の **エラーを表示** で、最後の読み取りが失敗した理由を確認できます。
:::

:::details 組織の一部のアカウントが見当たらない
一つの接続で読み取れるのは最大 50 個のアカウント、サブスクリプション、プロジェクトで、それより多い場合は読み取りのたびにそう表示されます。残りは別の接続で接続してください。
:::

:::details 読み取りに警告がある
動作している読み取りでも、一部のリソースについてクラウドが返さなかったメトリクスや、名前空間の最初の 1,000 個を超えるキューなど、読み取れないものが残ることがあります。その場合、**クラウド → 接続** の接続のステータスに、最後の読み取りの警告の数が表示されます。選択すると、それぞれの内容を確認できます。
:::

## 次のステップ

:::cards
- [クラウドリソース](/docs/telemetry/cloud-resources): 代わりに独自の OpenTelemetry Collector を運用するか、CloudWatch メトリクスをストリーミングします。
- [デプロイと変更](/docs/telemetry/change-events): OneUptime が記録するすべての変更と、OneUptime AI がそれを読み取るしくみ。
- [メトリクス モニター](/docs/monitor/metrics-monitor): リソースのメトリクスでアラートを出します。
:::
