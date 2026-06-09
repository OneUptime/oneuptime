# 클라우드 환경

## 개요

OneUptime은 관리형 클라우드 컴퓨트를 **클라우드 환경**으로 그룹화합니다 — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner, Azure App Service. `cloud.platform` + `cloud.account.id` + `cloud.region`의 고유한 조합마다 하나의 환경이 생성되므로, *"AWS ECS · us-east-1 · 123456789012"* 같은 항목은 그 위에서 실행되는 모든 워크로드를 집계하는 단일 엔터티가 됩니다.

원시 가상 머신(EC2, Compute Engine, Azure VM)은 **호스트**로 유지되며, Kubernetes는 **Kubernetes** 아래에 남습니다. 이 뷰는 특별히 관리형 / PaaS 컴퓨트를 위한 것입니다.

## 사전 요구 사항

- **OneUptime 텔레메트리 수집 토큰** — *Project Settings → Telemetry Ingestion Keys*에서 생성합니다.
- 워크로드 내부 또는 워크로드와 함께 실행되는 OpenTelemetry Collector 또는 SDK.

## OneUptime이 환경을 식별하는 방법

| 속성 | 필수 | 용도 |
|---|---|---|
| `cloud.platform` | **예** | 관리형 컴퓨트 플랫폼이어야 합니다(예: `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id` | 아니요 | 환경 키의 일부 |
| `cloud.region` | 아니요 | 환경 키의 일부 |
| `service.instance.id` | 아니요 | **인스턴스** 아래에서 작업/인스턴스별로 추적됩니다(실시간 CPU / 메모리 포함) |

이 속성들은 일반적으로 OpenTelemetry **리소스 감지기**에 의해 자동으로 채워집니다.

## 1단계 — 클라우드 리소스 감지기 활성화

OpenTelemetry Collector에서 `resourcedetection` 프로세서를 추가합니다.

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs]   # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

SDK를 사용하는 경우, 대신 `OTEL_RESOURCE_DETECTORS`를 설정합니다.

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## 2단계 — OTLP를 OneUptime으로 내보내기

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

OneUptime을 셀프 호스팅하는 경우 `https://YOUR-ONEUPTIME-HOST/otlp`를 사용합니다.

## 제공되는 기능

환경 개요에는 다음이 표시됩니다.

- 실행 중인 작업/인스턴스별 **CPU** 및 **메모리**(`container.cpu.utilization` / `container.memory.usage` 기반), 그리고 **CPU 기준 상위 인스턴스** 목록.
- **인스턴스** — 작업의 실시간 개수.
- 트레이스에서 도출된 **요청** 및 추세 차트.
- 전체 **로그**, **트레이스**, **메트릭**, **인스턴스** 탭.

동일한 워크로드에 대한 서비스별 분석은 **서비스** 아래에서 제공됩니다.
