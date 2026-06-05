# Discord 통합

인시던트 업데이트를 [Discord](https://discord.com) 채널에 게시합니다. OneUptime에는 내장 **Discord** 워크플로 컴포넌트가 있어 가장 빠르게 설정할 수 있는 통합 중 하나입니다.

이 통합은 **아웃바운드**: OneUptime이 수신 webhook URL을 통해 Discord 채널에 게시합니다.

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## 1단계 — Discord webhook 만들기

1. Discord에서 대상 채널의 **Edit Channel → Integrations → Webhooks** 를 엽니다.
2. **New Webhook** 을 클릭하고 이름(예: `OneUptime`)을 지정하고, 채널을 선택하고 **Copy Webhook URL** 을 클릭합니다.

## 2단계 — webhook URL 저장 (선택 사항이지만 권장)

1. OneUptime에서 **Workflows → Global Variables → Create** 로 이동합니다.
2. 이름을 `DISCORD_WEBHOOK_URL` 로 지정하고 URL을 붙여넣고 **Is Secret** 를 켭니다.

변수에 저장하면 여러 워크플로에서 재사용하고 한 곳에서 교체할 수 있습니다.

## 3단계 — 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Incidents → Discord` 로 지정하고 **Builder** 를 엽니다.
2. **Incident** 트리거를 **On Create** 로 설정해 추가합니다. 이름을 `Incident` 로 변경합니다.
3. 트리거에 연결된 **Discord** 컴포넌트를 추가합니다:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (또는 직접 붙여넣습니다).
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save** 하고, 활성화하고, 테스트 인시던트를 만듭니다. 채널에 메시지가 나타납니다.

## 대안: API 컴포넌트

전용 컴포넌트를 사용하지 않으려면 **API** 블록으로도 동일한 작업이 가능합니다:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Discord의 풍부한 [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook)를 원한다면 이 방식이 편리합니다 — 본문에 `embeds` 배열을 추가하세요.

## 팁

- **Conditions** 를 사용해 특정 심각도에만 게시하도록 합니다 — Discord 블록 앞에서 `{{Incident.incidentSeverity.name}}` 으로 분기하세요.
- **Incident → On Update** 에 워크플로를 더 추가해 같은 채널에 확인 및 해결 메시지를 게시합니다.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 아웃바운드 패턴.
- [Telegram](/docs/integrations/telegram) — Telegram에 대한 동일한 아이디어.
- [컴포넌트 → Discord](/docs/workflows/components#discord) — 컴포넌트 참조.
