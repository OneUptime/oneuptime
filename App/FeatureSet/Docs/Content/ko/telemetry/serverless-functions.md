# 서버리스 함수

## 개요

OneUptime은 `faas.name` 리소스 속성으로 태그된 OpenTelemetry 데이터를 수신하는 순간 **서버리스 함수(Serverless Function)**를 자동으로 인식합니다. 수동으로 생성할 것은 없습니다 — 사용 중인 런타임에 맞는 OpenTelemetry SDK로 함수를 계측하고, OTLP 익스포터가 OneUptime을 가리키도록 설정하면, 해당 함수가 트레이스, 로그, 메트릭과 함께 **서버리스 함수(Serverless Functions)** 아래에 표시됩니다.

이는 AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers 또는 OpenTelemetry를 내보낼 수 있는 모든 FaaS 런타임에서 작동합니다.

## 사전 요구 사항

- **OneUptime 텔레메트리 수집 토큰(Telemetry Ingestion Token)** — *Project Settings → Telemetry Ingestion Keys*에서 하나를 생성하고 `x-oneuptime-token` 값을 복사합니다.
- 함수의 언어에 맞는 OpenTelemetry SDK(또는 자동 계측 레이어).

## OneUptime이 함수를 식별하는 방법

OneUptime은 각 함수를 `faas.name` 리소스 속성을 기준으로 식별합니다:

| 속성 | 필수 | 용도 |
|---|---|---|
| `faas.name` | **예** | 함수 식별자(예: `checkout-handler`) |
| `faas.version` | 아니요 | 개요에 표시됨 |
| `faas.instance` | 아니요 | **Instances** 탭에서 인스턴스별로 추적됨 |
| `cloud.platform` | 아니요 | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | 아니요 | 개요에 표시됨 |

> `service.name`도 함께 설정하는 함수는 **Services** 아래에도 계속 표시됩니다. **서버리스 함수(Serverless Functions)** 보기는 `faas.name`으로 범위가 지정된, FaaS에 초점을 맞춘 렌즈입니다.

## 1단계 — OTLP 익스포터 환경 변수 설정

대부분의 언어 자동 계측은 표준 OpenTelemetry 환경 변수를 따릅니다:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

OneUptime을 자체 호스팅하는 경우, 엔드포인트를 `https://YOUR-ONEUPTIME-HOST/otlp`로 교체합니다.

## 2단계 — (AWS Lambda) OpenTelemetry 레이어 추가

AWS Lambda의 경우 가장 간단한 방법은 [OpenTelemetry Lambda 레이어](https://opentelemetry.io/docs/faas/lambda-auto/)입니다. 사용 중인 런타임에 맞는 레이어를 연결하고 다음을 설정합니다:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

이 레이어는 함수 이름에서 `faas.name`을 자동으로 설정하며, 리소스 디텍터가 `cloud.platform`, `cloud.region`, `cloud.account.id`를 채웁니다.

## 얻을 수 있는 것

함수가 스팬, 로그 또는 메트릭을 내보내면 **서버리스 함수(Serverless Functions)** 아래에 표시됩니다. 개요에는 다음이 표시됩니다:

- **호출 수(Invocations)**, **오류율(error rate)**, **p95 지속 시간(p95 duration)** — 트레이스에서 파생되며, 선택 가능한 시간 범위에 걸쳐 추세 차트와 함께 제공됩니다.
- **인스턴스(Instances)** — 확인된 `faas.instance` 값의 실시간 개수.
- 이 함수로 범위가 지정된 전체 **Logs**, **Traces**, **Metrics** 탭.

또한 *Serverless → Settings → Label Rules / Owner Rules*를 통해 레이블과 소유자를 자동으로 적용할 수 있습니다.
