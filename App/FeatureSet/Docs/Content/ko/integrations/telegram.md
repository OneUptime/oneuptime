# Telegram 통합

인시던트 업데이트를 [Telegram](https://telegram.org) 채팅이나 그룹으로 전송합니다. OneUptime에는 내장 **Telegram** 워크플로 컴포넌트가 있어 빠르게 설정할 수 있습니다.

이 통합은 **아웃바운드**: OneUptime이 Telegram 봇을 통해 메시지를 전송합니다.

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## 1단계 — 봇 만들기 및 토큰 가져오기

1. Telegram에서 [@BotFather](https://t.me/BotFather) 에게 메시지를 보내고 `/newbot` 을 전송합니다.
2. 안내에 따릅니다. BotFather가 `123456789:AA...` 형태의 **봇 토큰** 을 제공합니다.

## 2단계 — 채팅 ID 찾기

1. 봇을 그룹에 추가하거나(또는 직접 대화를 시작하고) 봇에게 아무 메시지나 보냅니다.
2. 브라우저에서 `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` 를 엽니다.
3. 응답에서 `"chat":{"id":...}` 를 찾습니다 — 그 숫자가 **채팅 ID** 입니다(그룹 ID는 음수입니다).

## 3단계 — 시크릿 저장

1. OneUptime에서 **Workflows → Global Variables → Create** 로 이동합니다.
2. `TELEGRAM_BOT_TOKEN` (시크릿) 과 `TELEGRAM_CHAT_ID` 를 만듭니다.

## 4단계 — 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Incidents → Telegram` 으로 지정하고 **Builder** 를 엽니다.
2. **Incident** 트리거를 **On Create** 로 설정해 추가합니다. 이름을 `Incident` 로 변경합니다.
3. 트리거에 연결된 **Telegram** 컴포넌트를 추가합니다:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save** 하고, 활성화하고, 테스트 인시던트를 만듭니다. 채팅에 메시지가 도착합니다.

## 대안: API 컴포넌트

**API** 블록도 동작합니다:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## 팁

- 봇은 그룹에 추가되고 **개인 정보 보호 모드** 가 허용된 후에만 메시지를 볼 수 있습니다 — `getUpdates` 가 비어 있다면 먼저 봇에게 메시지를 보내거나 BotFather를 통해 개인 정보 보호 모드를 비활성화하세요.
- 전송 전에 **Conditions** 를 사용해 심각도로 필터링합니다.
- API 본문에 `"parse_mode": "Markdown"` 을 추가하거나(또는 컴포넌트의 서식 기능 사용) 굵은 글씨와 링크를 사용합니다.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 아웃바운드 패턴.
- [Discord](/docs/integrations/discord) — Discord에 대한 동일한 아이디어.
- [컴포넌트 → Telegram](/docs/workflows/components#telegram) — 컴포넌트 참조.
