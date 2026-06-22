# 실사용자 모니터링(브라우저 및 모바일)

## 개요

OneUptime은 수신되는 텔레메트리가 클라이언트 속성 — 웹의 경우 `browser.*`, 모바일의 경우 `device.*` — 을 포함할 때 이를 **RUM**으로 분류합니다. 각 애플리케이션은 `service.name`으로 식별되며 해당 RUM 애플리케이션이 전적으로 소유합니다(클라이언트 텔레메트리는 백엔드 서비스로 중복 생성되지 않습니다).

이를 사용하여 사용자가 실제로 경험하는 것을 확인하세요: 페이지 조회수, 오류, 지연 시간, 사용 중인 플랫폼/기기, 그리고 SDK가 방출하는 경우 Core Web Vitals까지.

## 사전 요구 사항

- **OneUptime 텔레메트리 수집 토큰** — _Project Settings → Telemetry Ingestion Keys_ 에서 생성하세요.
- OpenTelemetry 브라우저 또는 모바일 SDK.

## OneUptime이 RUM 애플리케이션을 식별하는 방법

| 속성                     | 필수          | 용도                                      |
| ------------------------ | ------------- | ----------------------------------------- |
| `service.name`           | **예**        | 애플리케이션 식별자(예: `storefront-web`) |
| `browser.*`              | 웹의 경우     | 텔레메트리를 브라우저 RUM으로 표시        |
| `device.*`               | 모바일의 경우 | 텔레메트리를 모바일 RUM으로 표시          |
| `telemetry.sdk.language` | 아니요        | 예: `webjs`, `swift`, 개요에 표시됨       |

## 브라우저(OpenTelemetry Web)

OTLP/HTTP 익스포터를 OneUptime으로 지정하고 `service.name`을 앱 이름으로 설정하세요:

```js
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// OneUptime OTLP/HTTP exporter:
const exporter = new OTLPTraceExporter({
  url: "https://oneuptime.com/otlp/v1/traces",
  headers: { "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN" },
});

// Register `exporter` with your WebTracerProvider, using a resource of:
//   { "service.name": "storefront-web" }
```

브라우저 계측은 `browser.*` 리소스 속성을 자동으로 추가하며 — 이것이 데이터를 RUM으로 라우팅합니다.

## 모바일(Swift / Android)

OpenTelemetry Swift 또는 Android SDK를 사용하고 `service.name`을 설정한 후 OTLP를 OneUptime으로 내보내세요:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

SDK의 `device.*` 속성이 텔레메트리를 RUM으로 라우팅합니다. OneUptime을 자체 호스팅하는 경우 `https://YOUR-ONEUPTIME-HOST/otlp`를 사용하세요.

## Core Web Vitals

브라우저 계측이 web vitals(LCP, INP, CLS, FCP, TTFB)를 OpenTelemetry 메트릭으로 방출하는 경우, OneUptime은 이를 애플리케이션 개요에 good / needs-improvement / poor 등급과 함께 표시합니다. web-vital 메트릭이 보고되지 않으면 패널에서 전송을 시작하는 방법을 설명합니다.

## 제공되는 항목

- 선택 가능한 범위에 걸친 추세 차트와 함께 제공되는 **페이지 조회수**, **오류율**, **p95 지속 시간**.
- **클라이언트** — 확인된 브라우저 플랫폼/기기 모델.
- **Core Web Vitals**(보고된 경우).
- 애플리케이션으로 범위가 지정된 전체 **Logs**, **Traces**, **Metrics** 탭.
