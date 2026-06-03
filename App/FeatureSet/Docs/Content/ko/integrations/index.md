# 통합

OneUptime은 팀이 이미 사용하는 도구들 — Zabbix, Jira, PagerDuty, Slack 등 — 을 내장 자동화 엔진인 **[Workflows](/docs/workflows/index)** 를 통해 연결합니다. 별도 플러그인을 설치할 필요가 없습니다. 드래그 앤 드롭 캔버스에서 통합을 구성하면, 무언가 발생할 때마다 실행됩니다.

이 페이지는 모든 통합에서 사용하는 두 가지 패턴을 설명합니다. 이것을 이해하면, 이 페이지에 전용 항목이 없는 도구도 OneUptime에 연결할 수 있습니다.

## 두 가지 패턴

모든 통합은 두 방향 중 하나로 데이터를 이동합니다(그리고 많은 경우 두 방향을 모두 사용합니다).

### 인바운드 — 다른 도구가 OneUptime으로 데이터를 보내는 경우

외부 시스템이 OneUptime에서 *무언가를 생성하거나 업데이트해야 할 때* — 보통 문제를 감지했을 때 인시던트나 알림을 열어야 할 때 — 사용합니다.

1. **[Webhook 트리거](/docs/workflows/triggers#webhook)** 로 시작하는 워크플로를 만듭니다. OneUptime이 고유 URL을 제공합니다.
2. 다른 도구에서 무언가가 발생할 때 해당 URL로 POST하는 webhook/알림 액션을 설정합니다.
3. 워크플로에서 들어오는 페이로드를 읽고 **Create Incident** (또는 Create Alert) 컴포넌트를 사용해 기록합니다.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### 아웃바운드 — OneUptime이 다른 도구로 데이터를 보내는 경우

*OneUptime의 무언가가 다른 도구에도 나타나야 할 때* — Jira 티켓 열기, PagerDuty에 호출하기, Slack에 게시하기 — 사용합니다.

1. **[OneUptime 이벤트 트리거](/docs/workflows/triggers#oneuptime-event-triggers)** 로 시작하는 워크플로를 만듭니다 — 예를 들어 **Incident → On Create**.
2. 인시던트 세부 정보로 다른 도구의 REST API를 호출하는 **[API 컴포넌트](/docs/workflows/components#api)** 를 추가합니다.
3. API 키는 **시크릿 [전역 변수](/docs/workflows/variables#global-variables)** 로 저장해 워크플로나 로그에 노출되지 않도록 합니다.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## 카탈로그

| 도구 | 방향 | 기능 |
| --- | --- | --- |
| [Zabbix](/docs/integrations/zabbix) | 인바운드 | Zabbix 문제를 OneUptime 인시던트로 변환합니다(복구 시 해결도 가능). |
| [Jira](/docs/integrations/jira) | 아웃바운드 (+ 인바운드) | 모든 인시던트에 Jira 이슈를 열고 상태를 동기화합니다. |
| [PagerDuty](/docs/integrations/pagerduty) | 아웃바운드 (+ 인바운드) | OneUptime 인시던트에서 PagerDuty 이벤트를 트리거하고 해결합니다. |
| [Opsgenie](/docs/integrations/opsgenie) | 아웃바운드 (+ 인바운드) | Opsgenie 알림을 생성하고 닫습니다. |
| [ServiceNow](/docs/integrations/servicenow) | 아웃바운드 (+ 인바운드) | OneUptime에서 ServiceNow 인시던트를 엽니다. |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | 인바운드 | Alertmanager 알림을 인시던트로 변환합니다. |
| [Grafana](/docs/integrations/grafana) | 인바운드 | Grafana 알림을 인시던트로 변환합니다. |
| [Datadog](/docs/integrations/datadog) | 인바운드 | Datadog 모니터 알림을 인시던트로 변환합니다. |
| [GitHub](/docs/integrations/github) | 아웃바운드 | 인시던트에 대한 GitHub 이슈를 엽니다. |
| [GitLab](/docs/integrations/gitlab) | 아웃바운드 | 인시던트에 대한 GitLab 이슈를 엽니다. |
| [Discord](/docs/integrations/discord) | 아웃바운드 | 인시던트 업데이트를 Discord 채널에 게시합니다. |
| [Telegram](/docs/integrations/telegram) | 아웃바운드 | 인시던트 업데이트를 Telegram 채팅으로 전송합니다. |
| [Slack](/docs/workspace-connections/slack) | 양방향 | 네이티브 워크스페이스 연결 — 채널, 알림, 온콜. |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams) | 양방향 | 네이티브 워크스페이스 연결. |

> **Slack과 Microsoft Teams** 는 워크플로를 넘어서는 더 깊은 네이티브 연결을 제공합니다 — 자동 인시던트 채널, 양방향 액션, 온콜 알림 등. 이 경우 워크플로를 구성하는 대신 [Slack](/docs/workspace-connections/slack) 및 [Microsoft Teams](/docs/workspace-connections/microsoft-teams) 워크스페이스 연결을 사용하세요.

## 시크릿 처리

API 키나 토큰을 블록에 직접 붙여넣지 마세요. 대신:

1. **Workflows → Global Variables** 로 이동합니다.
2. 변수를 만듭니다 — 예를 들어 `JIRA_AUTH` — 그리고 **Is Secret** 를 켭니다.
3. 어디서든 `{{variable.JIRA_AUTH}}` 로 참조합니다.

시크릿 변수는 저장 후 UI에서 숨겨지며 실행 로그에서도 제거됩니다. [변수](/docs/workflows/variables#global-variables)를 참조하시기 바랍니다.

## 인증 빠른 참조

대부분의 아웃바운드 통합은 API 블록에 `Authorization` 헤더가 필요합니다. 일반적인 형식:

| 방식 | 헤더 값 | 사용처 |
| --- | --- | --- |
| Bearer 토큰 | `Bearer {{variable.TOKEN}}` | GitHub, 많은 최신 API |
| Basic 인증 | `Basic {{variable.BASE64_USER_PASS}}` | Jira, ServiceNow |
| API 키 헤더 | `GenieKey {{variable.OPSGENIE_KEY}}` | Opsgenie |
| 본문의 토큰 | JSON 본문의 `routing_key` 필드 | PagerDuty Events API |
| Private 토큰 헤더 | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab |

Basic 인증의 경우, `username:password` (또는 `email:api_token`) 를 **한 번** base64 인코딩한 후 결과를 시크릿으로 저장합니다. macOS/Linux에서:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## 원하는 도구가 없나요?

거의 모든 도구는 위의 두 패턴 중 하나에 해당합니다.

- 도구가 무언가 발생할 때 **webhook을 보낼 수 있다면**, **인바운드** 패턴을 사용하세요 — 해당 webhook을 OneUptime Webhook 트리거로 지정합니다.
- 도구에 **REST API** 가 있다면, **아웃바운드** 패턴을 사용하세요 — **API 컴포넌트** 에서 호출합니다.
- 두 시스템 간에 데이터를 재구성해야 한다면 **[Custom Code](/docs/workflows/components#custom-code)** 블록을 사용하세요.

이것으로 긴 꼬리를 커버할 수 있습니다 — Zendesk, AWS CloudWatch(SNS 경유), New Relic, Splunk, StatusCake 등. 레시피는 동일하며, URL과 페이로드만 바뀝니다.

## 다음에 읽어 볼 내용

- [워크플로 개요](/docs/workflows/index) — 자동화 엔진의 작동 방식.
- [트리거](/docs/workflows/triggers) — Webhook 및 OneUptime 이벤트 트리거 상세 설명.
- [컴포넌트](/docs/workflows/components) — API, Webhook, 데이터 컴포넌트.
- [변수](/docs/workflows/variables) — 시크릿과 블록 간 데이터 전달.
- [Zabbix](/docs/integrations/zabbix) 및 [Jira](/docs/integrations/jira) — 완성된 예시.
