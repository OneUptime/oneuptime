# クラウド環境

## 概要

OneUptime は、マネージドなクラウドコンピュートを **クラウド環境（Cloud Environments）** としてグループ化します — AWS ECS / Fargate、Google Cloud Run、Azure Container Apps / Container Instances、AWS Elastic Beanstalk、AWS App Runner、そして Azure App Service です。環境は `cloud.platform` + `cloud.account.id` + `cloud.region` の一意な組み合わせごとに 1 つ作成されます。したがって *「AWS ECS · us-east-1 · 123456789012」* のようなものは、その上で動作するすべてのワークロードを集約する単一のエンティティになります。

生の仮想マシン（EC2、Compute Engine、Azure VM）は引き続き **ホスト（Hosts）** であり、Kubernetes は **Kubernetes** 配下に残ります。このビューは、マネージド / PaaS コンピュートに特化したものです。

## 前提条件

- **OneUptime Telemetry Ingestion Token** — *Project Settings → Telemetry Ingestion Keys* から作成します。
- ワークロード内またはワークロードと併せて動作する OpenTelemetry Collector または SDK。

## OneUptime が環境を識別する仕組み

| 属性 | 必須 | 目的 |
|---|---|---|
| `cloud.platform` | **はい** | マネージドコンピュートのプラットフォームである必要があります（例: `aws_ecs`、`gcp_cloud_run`、`azure_container_apps`） |
| `cloud.account.id` | いいえ | 環境キーの一部 |
| `cloud.region` | いいえ | 環境キーの一部 |
| `service.instance.id` | いいえ | **インスタンス（Instances）** 配下でタスク / インスタンスごとに追跡されます（ライブの CPU / メモリ付き） |

これらは通常、OpenTelemetry の **リソースディテクター（resource detectors）** によって自動的に設定されます。

## ステップ 1 — クラウドリソースディテクターを有効化する

OpenTelemetry Collector で `resourcedetection` プロセッサを追加します。

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs]   # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

SDK を使用する場合は、代わりに `OTEL_RESOURCE_DETECTORS` を設定します。

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## ステップ 2 — OTLP を OneUptime にエクスポートする

```yaml
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
```

OneUptime をセルフホストしている場合は、`https://YOUR-ONEUPTIME-HOST/otlp` を使用してください。

## 得られるもの

環境の概要では、次の情報が表示されます。

- 実行中のタスク / インスタンスごとの **CPU** と **メモリ**（`container.cpu.utilization` / `container.memory.usage` から取得）に加え、**CPU 別の上位インスタンス（Top instances by CPU）** リスト。
- **インスタンス（Instances）** — タスクのライブカウント。
- トレースから導出される **リクエスト（Requests）** とトレンドチャート。
- 完全な **ログ（Logs）**、**トレース（Traces）**、**メトリクス（Metrics）**、**インスタンス（Instances）** タブ。

同じワークロードに対するサービスごとの内訳は、**サービス（Services）** 配下で利用できます。
