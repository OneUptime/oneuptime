# 无服务器函数

## 概述

当 OneUptime 收到带有 `faas.name` 资源属性标记的 OpenTelemetry 数据时，会立即自动识别出一个 **无服务器函数（Serverless Function）**。无需手动创建任何内容 —— 使用适合你运行时的 OpenTelemetry SDK 为函数添加监测埋点，将其 OTLP 导出器指向 OneUptime，该函数便会连同其追踪、日志和指标一起出现在 **无服务器函数（Serverless Functions）** 之下。

这适用于 AWS Lambda、Google Cloud Functions、Azure Functions、Cloudflare Workers，或任何能够发出 OpenTelemetry 数据的 FaaS 运行时。

## 前置条件

- 一个 **OneUptime 遥测采集令牌（Telemetry Ingestion Token）** —— 从 *Project Settings → Telemetry Ingestion Keys* 创建一个，并复制其中的 `x-oneuptime-token` 值。
- 适合你的函数所用语言的 OpenTelemetry SDK（或自动监测埋点层）。

## OneUptime 如何识别一个函数

OneUptime 以 `faas.name` 资源属性作为每个函数的键：

| 属性 | 是否必需 | 用途 |
|---|---|---|
| `faas.name` | **是** | 函数标识（例如 `checkout-handler`） |
| `faas.version` | 否 | 显示在概览中 |
| `faas.instance` | 否 | 在 **实例（Instances）** 选项卡下按实例进行跟踪 |
| `cloud.platform` | 否 | `aws_lambda`、`gcp_cloud_functions`、`azure_functions`、…… |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | 否 | 显示在概览中 |

> 同时设置了 `service.name` 的函数仍然也会出现在 **服务（Services）** 之下。**无服务器函数（Serverless Functions）** 视图是以 FaaS 为中心、按 `faas.name` 划定范围的视角。

## 步骤 1 —— 设置 OTLP 导出器环境变量

大多数语言的自动监测埋点都遵循标准的 OpenTelemetry 环境变量：

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

如果你自托管 OneUptime，请将端点替换为 `https://YOUR-ONEUPTIME-HOST/otlp`。

## 步骤 2 —— （AWS Lambda）添加 OpenTelemetry 层

对于 AWS Lambda，最简单的方式是使用 [OpenTelemetry Lambda 层](https://opentelemetry.io/docs/faas/lambda-auto/)。为你的运行时附加该层并设置：

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

该层会自动从函数名称设置 `faas.name`，并且资源检测器会填充 `cloud.platform`、`cloud.region` 和 `cloud.account.id`。

## 你将获得什么

一旦函数发出 span、日志或指标，它就会出现在 **无服务器函数（Serverless Functions）** 之下。概览会显示：

- **调用次数（Invocations）**、**错误率（error rate）** 和 **p95 持续时间（p95 duration）** —— 根据你的追踪数据得出，可在可选择的时间范围内查看，并带有趋势图表。
- **实例（Instances）** —— 已观测到的 `faas.instance` 值的实时计数。
- 限定到此函数范围的完整 **日志（Logs）**、**追踪（Traces）** 和 **指标（Metrics）** 选项卡。

你还可以通过 *Serverless → Settings → Label Rules / Owner Rules* 自动应用标签和负责人。
