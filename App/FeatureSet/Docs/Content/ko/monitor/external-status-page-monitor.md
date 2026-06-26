# 외부 상태 페이지 모니터

외부 상태 페이지 모니터링을 통해 의존하는 타사 상태 페이지를 모니터링하고, 사용하는 서비스가 장애 또는 성능 저하를 겪을 때 알림을 받을 수 있습니다. OneUptime은 주기적으로 외부 상태 페이지(AWS, GCP, Azure, GitHub, OpenAI, Anthropic 등)를 확인하고 상태를 평가합니다.

## 개요

외부 상태 페이지 모니터는 공개 상태 페이지를 쿼리하여 의존하는 서비스의 상태를 확인합니다. 이를 통해 다음이 가능합니다:

- 애플리케이션이 의존하는 타사 서비스의 가용성 모니터링
- 업스트림 공급자가 장애를 겪을 때 알림 수신
- 개별 구성 요소 상태 추적 (예: "AWS EC2 us-east-1")
- 단일 구성 요소 그룹으로 모니터링 범위 지정 (예: OpenAI의 "APIs"만), 따라서 페이지의 다른 무관한 인시던트가 모니터를 트리거하지 않음
- 사용자에게 영향을 미치기 전에 성능 저하 감지
- 자체 인시던트와 업스트림 공급자 문제 연결

## 지원되는 공급자

OneUptime은 다음 방법으로 상태 페이지 모니터링을 지원합니다:

| 공급자 유형              | 설명                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| **자동** (기본값)        | 상태 페이지 형식을 자동으로 감지                                    |
| **Atlassian Statuspage** | Atlassian Statuspage로 구동되는 상태 페이지 (JSON API)              |
| **incident.io**          | incident.io로 구동되는 상태 페이지 (예: `https://status.openai.com`) |
| **RSS**                  | RSS 피드를 제공하는 상태 페이지                                     |
| **Atom**                 | Atom 피드를 제공하는 상태 페이지                                    |

### 자동 감지

**자동**으로 설정하면 OneUptime은 상태 페이지 형식을 다음 순서로 자동 감지합니다:

1. 먼저 incident.io 상태 페이지 API를 시도합니다 (`/proxy/<host>`)
2. 다음으로 Atlassian Statuspage JSON API를 시도합니다 (`/api/v2/status.json`, `/api/v2/components.json`, `/api/v2/incidents/unresolved.json`)
3. 위가 실패하면 RSS 또는 Atom 피드로 페이지를 파싱하려고 시도합니다
4. 최후 수단으로 기본 HTTP 도달 가능성 확인을 수행합니다

> **참고:** incident.io를 먼저 확인하는 이유는 일부 incident.io 상태 페이지(예: `https://status.openai.com`)가 구성 요소 그룹과 활성 인시던트를 생략하는 제한된 Atlassian 호환 엔드포인트도 노출하기 때문입니다. incident.io를 먼저 확인하면 더 풍부하고 그룹을 인식하는 데이터가 사용되도록 보장합니다.

## 외부 상태 페이지 모니터 생성

1. OneUptime 대시보드의 **모니터**로 이동합니다
2. **모니터 생성**을 클릭합니다
3. 모니터 유형으로 **외부 상태 페이지**를 선택합니다
4. 모니터링할 상태 페이지 URL을 입력합니다
5. 선택적으로 특정 공급자 유형을 선택합니다 (또는 **자동**으로 남겨 둠)
6. 선택적으로 **구성 요소 그룹**을 입력하여 "APIs"와 같은 그룹으로 범위를 지정합니다
7. 선택적으로 **구성 요소 이름**을 입력하여 단일 구성 요소로 필터링합니다 (그룹이 설정된 경우 해당 그룹 내에서)
8. 필요에 따라 모니터링 기준을 구성합니다

## 구성 옵션

### 상태 페이지 URL

모니터링할 외부 상태 페이지의 URL을 입력합니다. Atlassian Statuspage 및 incident.io 기반 사이트의 경우 일반적으로 루트 URL입니다 (예: `https://status.example.com`). RSS/Atom 피드의 경우 피드 URL을 직접 입력합니다.

### 공급자 유형

상태 페이지의 공급자 유형을 선택합니다. OneUptime이 형식을 자동으로 감지하도록 **자동** (기본값)을 사용하거나, 알고 있는 경우 **Atlassian Statuspage**, **incident.io**, **RSS** 또는 **Atom**을 지정합니다.

### 구성 요소 그룹 필터

상태 페이지가 구성 요소를 그룹으로 구성하는 경우 모니터를 단일 그룹으로 범위를 지정할 수 있습니다. 예를 들어 `https://status.openai.com`에서 `APIs`를 입력하면 모니터를 OpenAI의 API 서비스로 범위를 지정합니다.

구성 요소 그룹이 설정되면 **활성 인시던트 수**와 **전체 상태**는 해당 그룹의 구성 요소만 사용하여 계산됩니다 — 무관한 그룹(예: ChatGPT)에 영향을 미치는 인시던트는 "APIs" 그룹으로 범위가 지정된 모니터를 트리거하지 않습니다.

구성 요소 그룹 필터링은 **Atlassian Statuspage** 및 **incident.io** 공급자에서 지원됩니다. (RSS/Atom 피드는 구성 요소 그룹을 노출하지 않습니다.)

### 구성 요소 이름 필터

상태 페이지가 여러 구성 요소를 보고하는 경우 선택적으로 구성 요소 이름을 지정하여 해당 특정 구성 요소만 모니터링할 수 있습니다. 예를 들어 us-east-1의 AWS EC2만 모니터링하려면 `EC2 us-east-1`을 입력합니다 (상태 페이지에 표시된 정확한 구성 요소 이름).

구성 요소 그룹도 설정된 경우 구성 요소 이름 필터는 해당 그룹 **내에서** 적용되어 더 큰 그룹 내의 단일 구성 요소를 대상으로 지정할 수 있습니다. 두 필터를 모두 지정하지 않으면 범위 내의 모든 구성 요소가 모니터링됩니다.

### 고급 옵션

#### 타임아웃

상태 페이지의 응답을 기다리는 최대 시간 (밀리초). 기본값은 10000ms (10초)입니다.

#### 재시도

요청이 실패할 때 재시도 횟수. 기본값은 3회입니다.

## 모니터링 기준

다음을 기반으로 외부 서비스가 정상 작동 또는 오프라인으로 간주되는 시점을 결정하는 기준을 구성할 수 있습니다:

- **온라인 여부** – 상태 페이지에 도달할 수 있고 상태 데이터를 반환하는지 여부
- **전체 상태** – 상태 페이지의 전체 상태 표시기 (예: `operational`, `degraded_performance`, `partial_outage`, `major_outage`)
- **구성 요소 상태** – 범위 내 구성 요소의 상태 (구성 요소 그룹 / 구성 요소 이름 필터 적용)
- **활성 인시던트** – 상태 페이지에 보고된 현재 활성 인시던트 수 (필터가 설정된 경우 구성 요소 그룹 / 구성 요소로 범위 지정)
- **응답 시간** – 상태 페이지 데이터를 가져오는 데 걸리는 시간

### 기본 기준

기본적으로 OneUptime은 단순한 도달 가능성이 아니라 상태 페이지에 실제로 중요한 것, 즉 활성 인시던트와 구성 요소 상태를 기준으로 시드합니다:

- 범위 내에 활성 인시던트가 없을 때 모니터가 **정상 작동**으로 표시됩니다.
- 범위 내에 활성 인시던트가 하나 이상 있거나, 범위 내 구성 요소가 `degraded_performance`, `partial_outage`, `major_outage` 또는 `full_outage`를 보고할 때 모니터가 **오프라인**으로 표시됩니다 (그리고 인시던트가 생성됩니다).

활성 인시던트 수와 구성 요소 상태가 구성 요소 그룹 / 구성 요소 이름 필터를 따르므로, 이러한 기본 기준은 사용자가 관심을 갖는 구성 요소만 자동으로 대상으로 지정합니다.

## 인기 있는 상태 페이지 URL

모니터링할 수 있는 인기 있는 서비스 상태 페이지 URL의 선별된 목록입니다:

| 서비스                       | 상태 페이지 URL                               |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| OpenAI                       | `https://status.openai.com`                   |
| Anthropic                    | `https://status.anthropic.com`                |
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

> **참고:** 이 중 많은 것이 Atlassian Statuspage 또는 incident.io를 사용하므로 **자동** 공급자 유형이 자동으로 감지합니다.

## 인시던트 및 알림 템플릿

외부 상태 페이지 모니터에서 인시던트나 알림을 생성할 때 다음 템플릿 변수를 사용할 수 있습니다:

| 변수                      | 설명                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `{{isOnline}}`            | 상태 페이지가 온라인인지 여부 (true/false)                          |
| `{{responseTimeInMs}}`    | 밀리초 단위의 응답 시간                                             |
| `{{failureCause}}`        | 실패 원인 (있는 경우)                                              |
| `{{overallStatus}}`       | 전체 상태 표시기 값                                                |
| `{{activeIncidentCount}}` | 활성 인시던트 수 (필터가 있는 경우 해당 범위로 지정)               |
| `{{componentStatuses}}`   | 구성 요소 상태의 JSON 배열 (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | 감지된 공급자 (Atlassian Statuspage, incident.io, RSS, Atom)        |
| `{{componentGroup}}`      | 모니터의 범위가 지정된 구성 요소 그룹 (있는 경우)                  |
| `{{componentName}}`       | 모니터의 범위가 지정된 구성 요소 (있는 경우)                       |

## 모범 사례

- 정확한 형식을 알지 못하는 한 **자동 공급자 유형**을 사용합니다 — 자동 감지는 대부분의 상태 페이지에서 잘 작동합니다
- 공급자의 일부에만 의존하는 경우 **구성 요소 그룹으로 범위를 지정**합니다 (예: OpenAI의 "APIs"만), 따라서 무관한 인시던트가 노이즈를 생성하지 않습니다
- 특정 서비스에만 의존하는 경우 **특정 구성 요소를 모니터링**합니다 (예: 특정 AWS 리전)
- **인시던트 연결 설정** — 모니터가 문제를 감지하고 업스트림 상태 페이지도 문제를 표시할 때 근본 원인을 더 빠르게 파악하는 데 도움이 됩니다
- **다른 모니터와 결합** — 포괄적인 가시성을 위해 외부 상태 페이지 모니터와 자체 API/웹사이트 모니터를 결합합니다
