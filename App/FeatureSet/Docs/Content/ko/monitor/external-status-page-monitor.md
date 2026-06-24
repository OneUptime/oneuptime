# 외부 상태 페이지 모니터

외부 상태 페이지 모니터링을 통해 의존하는 타사 서비스의 상태 페이지를 모니터링하고 서비스가 장애 또는 성능 저하를 겪을 때 알림을 받을 수 있습니다. OneUptime은 주기적으로 외부 상태 페이지(AWS, GCP, Azure, GitHub 등)를 확인하고 상태를 평가합니다.

## 개요

외부 상태 페이지 모니터는 공개 상태 페이지를 쿼리하여 의존하는 서비스의 상태를 확인합니다. 이를 통해 다음이 가능합니다:

- 애플리케이션이 의존하는 타사 서비스의 가용성 모니터링
- 업스트림 공급자가 장애를 겪을 때 알림 수신
- 개별 구성 요소 상태 추적 (예: "AWS EC2 us-east-1")
- 사용자에게 영향을 미치기 전에 성능 저하 감지
- 자체 인시던트와 업스트림 공급자 문제 연결

## 지원되는 공급자

OneUptime은 다음 방법으로 상태 페이지 모니터링을 지원합니다:

| 공급자 유형              | 설명                                                   |
| ------------------------ | ------------------------------------------------------ |
| **자동** (기본값)        | 상태 페이지 형식을 자동으로 감지                       |
| **Atlassian Statuspage** | Atlassian Statuspage로 구동되는 상태 페이지 (JSON API) |
| **RSS**                  | RSS 피드를 제공하는 상태 페이지                        |
| **Atom**                 | Atom 피드를 제공하는 상태 페이지                       |

### 자동 감지

**자동**으로 설정하면 OneUptime은 상태 페이지 형식을 자동으로 감지합니다:

1. 먼저 Atlassian Statuspage JSON API를 시도합니다 (`/api/v2/status.json` 및 `/api/v2/components.json`)
2. 실패하면 RSS 또는 Atom 피드로 페이지를 파싱하려고 시도합니다
3. 최후 수단으로 기본 HTTP 도달 가능성 확인을 수행합니다

## 외부 상태 페이지 모니터 생성

1. OneUptime 대시보드의 **모니터**로 이동합니다
2. **모니터 생성**을 클릭합니다
3. 모니터 유형으로 **외부 상태 페이지**를 선택합니다
4. 모니터링할 상태 페이지 URL을 입력합니다
5. 선택적으로 특정 공급자 유형을 선택합니다 (또는 자동으로 남겨 둠)
6. 선택적으로 구성 요소 이름을 입력하여 특정 구성 요소로 모니터링을 필터링합니다
7. 필요에 따라 모니터링 기준을 구성합니다

## 구성 옵션

### 상태 페이지 URL

모니터링할 외부 상태 페이지의 URL을 입력합니다. Atlassian Statuspage 기반 사이트의 경우 일반적으로 루트 URL입니다 (예: `https://status.example.com`). RSS/Atom 피드의 경우 피드 URL을 직접 입력합니다.

### 공급자 유형

상태 페이지의 공급자 유형을 선택합니다. OneUptime이 형식을 자동으로 감지하도록 **자동** (기본값)을 사용하거나 알고 있는 경우 특정 공급자 유형을 지정합니다.

### 구성 요소 이름 필터

상태 페이지가 여러 구성 요소를 보고하는 경우 선택적으로 구성 요소 이름을 지정하여 해당 특정 구성 요소만 모니터링할 수 있습니다. 예를 들어 us-east-1의 AWS EC2만 모니터링하려면 `EC2 us-east-1`을 입력합니다 (상태 페이지에 표시된 정확한 구성 요소 이름).

구성 요소 이름이 지정되지 않으면 상태 페이지의 전체 상태가 모니터링됩니다.

### 고급 옵션

#### 타임아웃

상태 페이지의 응답을 기다리는 최대 시간 (밀리초). 기본값은 10000ms (10초)입니다.

#### 재시도

요청이 실패할 때 재시도 횟수. 기본값은 3회입니다.

## 모니터링 기준

다음을 기반으로 외부 서비스가 온라인, 저하 또는 오프라인으로 간주되는 시점을 결정하는 기준을 구성할 수 있습니다:

- **온라인 여부** – 상태 페이지에 도달할 수 있고 상태 데이터를 반환하는지 여부
- **전체 상태** – 상태 페이지의 전체 상태 표시기 (예: "operational", "major_outage")
- **구성 요소 상태** – 특정 구성 요소의 상태 (구성 요소 이름 필터 사용 시)
- **활성 인시던트** – 상태 페이지에 보고된 현재 활성 인시던트 수
- **응답 시간** – 상태 페이지 데이터를 가져오는 데 걸리는 시간

## 인기 있는 상태 페이지 URL

모니터링할 수 있는 인기 있는 서비스 상태 페이지 URL의 선별된 목록입니다:

| 서비스                       | 상태 페이지 URL                               |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| Cloudflare                   | `https://www.cloudflarestatus.com`            |
| Datadog                      | `https://status.datadoghq.com`                |
| PagerDuty                    | `https://status.pagerduty.com`                |
| Twilio                       | `https://status.twilio.com`                   |
| Stripe                       | `https://status.stripe.com`                   |
| Slack                        | `https://status.slack.com`                    |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com`                |
| Vercel                       | `https://www.vercel-status.com`               |
| Netlify                      | `https://www.netlifystatus.com`               |
| DigitalOcean                 | `https://status.digitalocean.com`             |
| Heroku                       | `https://status.heroku.com`                   |
| MongoDB Atlas                | `https://status.cloud.mongodb.com`            |
| Fastly                       | `https://status.fastly.com`                   |
| New Relic                    | `https://status.newrelic.com`                 |
| Sentry                       | `https://status.sentry.io`                    |
| CircleCI                     | `https://status.circleci.com`                 |

> **참고:** 이 중 많은 것이 Atlassian Statuspage를 사용하므로 **자동** 공급자 유형이 자동으로 감지합니다.

## 인시던트 및 알림 템플릿

외부 상태 페이지 모니터에서 인시던트나 알림을 생성할 때 다음 템플릿 변수를 사용할 수 있습니다:

| 변수                      | 설명                                       |
| ------------------------- | ------------------------------------------ |
| `{{isOnline}}`            | 상태 페이지가 온라인인지 여부 (true/false) |
| `{{responseTimeInMs}}`    | 밀리초 단위의 응답 시간                    |
| `{{failureCause}}`        | 실패 원인 (있는 경우)                      |
| `{{overallStatus}}`       | 전체 상태 표시기 값                        |
| `{{activeIncidentCount}}` | 활성 인시던트 수                           |
| `{{componentStatuses}}`   | 구성 요소 상태의 JSON 배열                 |

## 모범 사례

- 정확한 형식을 알지 못하는 한 **자동 공급자 유형**을 사용합니다 — 자동 감지는 대부분의 상태 페이지에서 잘 작동합니다
- 특정 서비스에만 의존하는 경우 **특정 구성 요소를 모니터링**합니다 (예: 특정 AWS 리전)
- **인시던트 연결 설정** — 모니터가 문제를 감지하고 업스트림 상태 페이지도 문제를 표시할 때 근본 원인을 더 빠르게 파악하는 데 도움이 됩니다
- **다른 모니터와 결합** — 포괄적인 가시성을 위해 외부 상태 페이지 모니터와 자체 API/웹사이트 모니터를 결합합니다
