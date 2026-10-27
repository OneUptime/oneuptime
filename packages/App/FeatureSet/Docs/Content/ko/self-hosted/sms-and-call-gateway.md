# SMS 및 통화 게이트웨이

OneUptime은 SMS와 통화를 Twilio 대신 직접 운영하는 게이트웨이를 통해 보낼 수 있습니다. 모든 메시지가 자체 SMS 및 음성 공급자를 거치거나, 네트워크를 떠나기 전에 메시지를 검사하는 시스템을 거쳐야 한다는 규정이 있을 때 사용하세요. OneUptime은 각 SMS와 통화를 서명된 JSON 요청으로 게이트웨이에 보내고, 게이트웨이가 이를 전달합니다.

:::cards
- [게이트웨이 설정하기](#게이트웨이-설정하기): URL 하나와 자동으로 만들어지는 서명 시크릿.
- [게이트웨이가 받는 내용](#게이트웨이가-받는-내용): SMS나 통화마다 서명된 JSON 요청 하나.
- [호출에 대응하기](#호출에-대응하기): 통화나 답장에서 인지, 에스컬레이션, 해결을 합니다.
- [전송과 재시도](#전송과-재시도): 게이트웨이가 다운되었을 때 일어나는 일.
:::

## 작동 방식

```mermaid title="자체 게이트웨이를 통한 SMS"
flowchart LR
    OneUptime["OneUptime"]
    Gateway["자체 게이트웨이"]
    Provider["자체 SMS 및 음성 공급자"]
    Phone["전화"]
    OneUptime -->|"서명된 JSON 요청"| Gateway
    Gateway --> Provider
    Provider --> Phone
```

게이트웨이는 서버 자체의 Twilio 계정을 거쳤을 모든 것에서 그 계정을 대신합니다. 온콜 호출, 알림, 인증 코드, 상태 페이지 구독자에게 보내는 SMS가 모두 해당됩니다. **프로젝트 설정 > 알림 > 알림 설정**의 **Twilio 구성** 카드에서 자체 Twilio 구성을 추가한 프로젝트는 계속 그 구성을 통해 보냅니다. 각 프로젝트의 SMS 및 통화 스위치와, 결제가 켜져 있는 곳에서는 잔액도 Twilio와 똑같이 확인됩니다.

## 게이트웨이 설정하기

:::steps
1. Admin Dashboard에서 **설정 > 통화 및 SMS**로 이동한 뒤 **SMS and Call Provider** 카드에서 **Edit Provider**를 클릭합니다.
2. **Your own gateway**를 선택하고 **Gateway URL**을 입력합니다. 게이트웨이는 프라이빗 네트워크에 있어도 됩니다.
3. 저장합니다. OneUptime이 서명 시크릿을 만들어 줍니다. 카드에서 복사해 게이트웨이에 넣으세요.
4. **Send Test**를 클릭합니다. 게이트웨이는 2xx 상태로 응답하고 아무것도 보내지 않아야 합니다.
:::

시크릿을 바꾸려면 **추가 필드**에서 **Signing Secret**을 비우고 저장합니다. 그러면 OneUptime이 새 시크릿을 만듭니다. Twilio로 돌아가려면 **Twilio**를 선택하고 저장합니다.

## 게이트웨이가 받는 내용

각 SMS와 통화는 JSON 본문과 다음 헤더가 포함된 `POST` 요청 하나입니다.

| 헤더 | 값 |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-OneUptime-Event` | `sms`, `call` 또는 `test` |
| `X-OneUptime-Signature` | `sha256=` 뒤에 서명 시크릿을 키로 계산한 본문의 HMAC-SHA256이 16진수로 이어집니다 |
| `User-Agent` | `OneUptime-CallAndSmsGateway/1.0` |

```json title="An on-call page by SMS"
{
  "version": 1,
  "event": "sms",
  "id": "7c5b0d0e-3e5f-4d1a-9a4f-2b8e6c1d9f00",
  "sentAt": "2026-10-27T09:30:00.000Z",
  "to": "+15551234567",
  "message": "OneUptime: A new alert has been created. Alert #42: Database is down…",
  "isSensitive": false,
  "project": {
    "id": "0f6b8c3a-1d2e-4f5a-8b9c-0d1e2f3a4b5c",
    "name": "Production"
  },
  "actions": {
    "acknowledge": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…",
    "escalate": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/escalate?token=…",
    "resolve": "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/resolve?token=…"
  }
}
```

| 필드 | 설명 |
| --- | --- |
| `version` | 이 형식에서는 항상 `1`입니다. 필드는 추가되기만 합니다. |
| `event` | `X-OneUptime-Event`와 같은 `sms`, `call` 또는 `test`입니다. |
| `id` | 이 메시지에 고유하며, 전달을 시도할 때마다 같습니다. 이미 보낸 메시지를 무시하는 데 사용하세요. |
| `sentAt` | OneUptime이 보낸 시각으로, ISO 8601 형식입니다. |
| `to` | E.164 형식의 전화번호입니다. 테스트에서는 `null`입니다. |
| `message` | SMS 또는 통화에서 말하는 내용입니다. SMS는 최대 1,600자, 통화 텍스트는 최대 16,384자입니다. 더 긴 텍스트는 잘리고, 나머지는 OneUptime에 있다는 안내로 끝납니다. |
| `isSensitive` | 인증 코드에서는 `true`입니다. 메시지를 자체 로그에 남기지 마세요. |
| `project` | 프로젝트의 `id`와 `name`이며, 프로젝트가 보낸 것이 아니면 `null`입니다. |
| `actions` | 온콜 호출에서는 호출에 대응하는 링크입니다. 그 외에는 `null`입니다. |

통화는 스크립트가 아니라 내용으로 전달됩니다. `message`는 통화에서 말할 내용이며, Twilio의 "인지하려면 1을 누르세요"는 포함되지 않습니다. 키 입력 등 원하는 방식으로 동작을 제공하고, 해당하는 링크를 호출하세요.

### 서명 확인하기

요청의 원본 본문을 파싱하기 전에 HMAC을 계산해 헤더와 비교합니다. 이 확인은 [사용자 지정 채널](/docs/self-hosted/custom-notification-channels#서명-확인하기)과 같으므로, 검증 함수 하나로 둘 다 처리할 수 있습니다.

```javascript title="Node.js"
const crypto = require("crypto");

function isFromOneUptime(rawBody, signatureHeader, secret) {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = String(signatureHeader || "");

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}
```

## 호출에 대응하기

상대가 통화 중에 응답하거나 답장을 보내면, 게이트웨이는 `actions`의 해당 링크로 `POST` 요청을 보냅니다. 링크는 사용자 지정 채널의 링크와 똑같이 작동합니다. API 키가 필요 없고, 각 링크에는 그 호출에만 쓰이는 7일 동안 유효한 토큰이 들어 있으며, 동작은 호출을 받은 사람이 한 것으로 기록됩니다. 각 동작과 응답은 [호출에 대응하기](/docs/self-hosted/custom-notification-channels#호출에-대응하기)를 참고하세요.

```bash title="Acknowledge a page"
curl -X POST "https://oneuptime.example.com/api/custom-notification-channel/page/5f2c…/acknowledge?token=…"
```

## 전송과 재시도

게이트웨이가 10초 안에 2xx 상태로 응답하면 요청은 전달된 것으로 간주됩니다. 응답하지 않았거나 408, 429 또는 5xx 상태로 응답한 요청은 1초 후, 그리고 다시 4초 후에 재전송됩니다. 시도는 모두 세 번입니다. 그 밖의 4xx 상태에서는 재전송하지 않습니다.

SMS 또는 통화 로그와, 온콜 호출의 경우 그 사람의 온콜 로그에는 `Sent to the SMS and call gateway (HTTP 200).` 또는 전달되지 않은 이유가 기록되며, URL은 절대 기록되지 않습니다. OneUptime은 메시지가 휴대폰에 도착했는지 알 수 없으므로, SMS는 게이트웨이가 받아들이는 즉시 보낸 것으로 표시되고 발신 번호는 비워 둡니다.

## 테스트 요청

**Send test**는 `event`를 `test`로, `to`, `project`, `actions`를 `null`로 설정한 요청을 보냅니다. 2xx 상태로 응답하고 아무것도 보내지 마세요.

## 다음 단계

:::cards
- [사용자 지정 알림 채널](/docs/self-hosted/custom-notification-channels): 자체 앱을 통해 사람들을 호출합니다.
- [푸시 알림](/docs/self-hosted/push-notifications): 서버 전체에서 푸시를 끕니다.
- [Twilio 통합](/docs/self-hosted/twilio-integration): 대신 Twilio를 통해 보냅니다.
- [프라이빗 네트워크 접근](/docs/self-hosted/private-network-access): 서버가 자체 네트워크에서 접근할 수 있는 범위.
:::
