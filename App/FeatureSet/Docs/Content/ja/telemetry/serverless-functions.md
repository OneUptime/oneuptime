# サーバーレス関数

## 概要

OneUptime は、`faas.name` リソース属性でタグ付けされた OpenTelemetry データを受信した瞬間に、**サーバーレス関数**を自動的に認識します。手動で作成するものは何もありません。お使いのランタイム用の OpenTelemetry SDK で関数をインストルメント化し、その OTLP エクスポーターを OneUptime に向けるだけで、その関数はトレース、ログ、メトリクスとともに**サーバーレス関数**の下に表示されます。

これは AWS Lambda、Google Cloud Functions、Azure Functions、Cloudflare Workers、または OpenTelemetry を出力できるあらゆる FaaS ランタイムで機能します。

## 前提条件

- **OneUptime Telemetry Ingestion Token** — _Project Settings → Telemetry Ingestion Keys_ から作成し、`x-oneuptime-token` の値をコピーします。
- 関数の言語用の OpenTelemetry SDK(または自動インストルメンテーションレイヤー)。

## OneUptime が関数を識別する方法

OneUptime は各関数を `faas.name` リソース属性をキーとして識別します。

| 属性                                                   | 必須     | 目的                                                        |
| ------------------------------------------------------ | -------- | ----------------------------------------------------------- |
| `faas.name`                                            | **はい** | 関数の識別子(例: `checkout-handler`)                        |
| `faas.version`                                         | いいえ   | 概要に表示されます                                          |
| `faas.instance`                                        | いいえ   | **Instances** タブでインスタンスごとに追跡されます          |
| `cloud.platform`                                       | いいえ   | `aws_lambda`、`gcp_cloud_functions`、`azure_functions`、... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | いいえ   | 概要に表示されます                                          |

> `service.name` も設定している関数は、**Services** の下にも引き続き表示されます。**サーバーレス関数**ビューは、`faas.name` でスコープされた FaaS 中心のレンズです。

## ステップ 1 — OTLP エクスポーターの環境変数を設定する

ほとんどの言語の自動インストルメンテーションは、標準の OpenTelemetry 環境変数を尊重します。

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

OneUptime をセルフホストしている場合は、エンドポイントを `https://YOUR-ONEUPTIME-HOST/otlp` に置き換えます。

## ステップ 2 —(AWS Lambda)OpenTelemetry レイヤーを追加する

AWS Lambda の場合、最も簡単な方法は [OpenTelemetry Lambda レイヤー](https://opentelemetry.io/docs/faas/lambda-auto/)です。お使いのランタイム用のレイヤーをアタッチし、次を設定します。

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

レイヤーは関数名から `faas.name` を自動的に設定し、リソースディテクターが `cloud.platform`、`cloud.region`、`cloud.account.id` を補完します。

## 得られるもの

関数がスパン、ログ、またはメトリクスを出力すると、**サーバーレス関数**の下に表示されます。概要には次が表示されます。

- **Invocations**、**error rate**、**p95 duration** — トレースから導出され、選択可能な時間範囲にわたって、トレンドチャートとともに表示されます。
- **Instances** — 観測された `faas.instance` の値のライブカウント。
- この関数にスコープされた完全な **Logs**、**Traces**、**Metrics** タブ。

_Serverless → Settings → Label Rules / Owner Rules_ を介して、ラベルとオーナーを自動適用することもできます。
