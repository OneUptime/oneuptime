# VPN 또는 방화벽 뒤에서 운영

자체 호스팅 OneUptime은 공용 인터넷에 노출하지 않고 운영할 수 있습니다. 모든 알림을 아웃바운드 연결로 보내기 때문입니다. 다만 안으로 들어오는 것도 몇 가지 있습니다. 대응자가 메시지에서 **Acknowledge**를 누를 때, Twilio가 통화 중에 눌린 키를 알려 올 때, Slack이 버튼 클릭을 알려 올 때입니다. 이 페이지에서는 각각에 대해 누가 어떤 경로로 서버에 연결하는지 정리하므로, 사용하는 것만 공개하거나 아무것도 공개하지 않을 수 있습니다.

:::cards
- [서버에 연결하는 주체](#서버에-연결하는-주체): 대응자의 휴대폰, 그리고 콜백을 보내는 공급자.
- [모두 비공개로 유지하기](#모두-비공개로-유지하기): 대응자의 휴대폰을 VPN에 연결합니다.
- [확인 페이지만 공개하기](#확인-페이지만-공개하기): 확인 링크만을 위한 좁은 입구.
- [공급자 콜백](#공급자-콜백): Telegram, Twilio, WhatsApp, Slack, Microsoft Teams.
:::

## 서버에 연결하는 주체

전송에는 인바운드 액세스가 전혀 필요 없습니다. OneUptime이 메일 서버, Twilio, Telegram, Meta, Slack, Microsoft, 푸시 릴레이 쪽으로 연결합니다. 안으로 들어오는 것은 다음 중 하나입니다.

| 일어나는 일 | 서버에 연결하는 주체 | 출발지 주소 허용 목록으로 제한할 수 있나요? |
| --- | --- | --- |
| 대응자가 이메일, SMS, WhatsApp 또는 Telegram 메시지에서 **Acknowledge**를 누름 | 대응자의 휴대폰 또는 컴퓨터 | 아니요. 대응자가 어디에 있든 그곳에서 연결합니다 |
| 대응자가 OneUptime On-Call 앱에서 확인함 | 대응자의 휴대폰 | 아니요. 위와 같습니다 |
| 대응자가 온콜 전화 통화 중에 1을 누름 | Twilio | Twilio의 Static Proxy for Webhooks를 쓸 때만 가능합니다 |
| 누군가 자신의 Telegram 계정을 연결함 | Telegram | 예. 또는 Telegram을 폴링하면 아무것도 허용하지 않아도 됩니다 |
| 누군가 Slack 또는 Microsoft Teams 메시지의 버튼을 클릭함 | Slack 또는 Microsoft | 아니요. 둘 다 고정 주소를 공개하지 않습니다 |
| WhatsApp이 메시지가 전달되었거나 읽혔다고 알림 | Meta | 아니요. Meta는 고정 주소를 공개하지 않습니다 |

자체 호스팅 서버는 OneUptime이 운영하는 서버를 거치지 않고 이 공급자들과 직접 통신하므로, 허용해야 할 OneUptime 주소 목록은 없습니다.

## 모두 비공개로 유지하기

대응자의 휴대폰을 VPN에 연결하세요. 항상 연결해 두거나 OneUptime 호스트 이름에 접속할 때 자동으로 연결되게 하면, 새벽 3시에 호출을 확인하기 전에 누구도 VPN부터 연결할 필요가 없습니다. 아무것도 공개하지 않은 상태에서는 다음과 같습니다.

- 이메일, SMS, WhatsApp, Telegram 메시지의 확인 링크가 열립니다. 휴대폰이 서버에 도달하기 때문입니다.
- OneUptime On-Call 앱이 동작합니다. 앱에 서버 주소를 지정하세요. 푸시 알림은 서버가 푸시 릴레이를 거쳐 보내므로 인바운드 액세스가 필요 없습니다.
- 폴링을 켜면 사용자가 Telegram 계정을 연결할 수 있습니다([Telegram](#telegram) 참조).

메시징 앱의 링크는 그 앱의 내장 브라우저나 휴대폰의 기본 브라우저에서 열리며, OneUptime 앱에서는 절대 열리지 않습니다. 따라서 앱별 VPN은 OneUptime 앱뿐 아니라 메시징 앱과 브라우저에도 적용되어야 합니다.

전화 통화 중 1 누르기, Slack 및 Microsoft Teams 메시지의 버튼, WhatsApp의 전달 상태 알림은 여전히 해당 공급자가 서버에 도달할 수 있어야 합니다.

## 확인 페이지만 공개하기

대응자의 휴대폰이 VPN을 쓸 수 없다면, 확인 링크가 여는 페이지만 공개하고 그 밖에는 아무것도 공개하지 마세요. OneUptime 앞에 리버스 프록시를 두거나, 인바운드 방화벽 규칙이 필요 없는 Cloudflare Tunnel 같은 아웃바운드 터널을 두고, 다음 경로만 통과시키세요.

| 메서드 | 경로 | 제공하는 내용 |
| --- | --- | --- |
| GET | `/l/*` | SMS, WhatsApp, Telegram 메시지의 단축 링크 |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | 호출 내용과 **Acknowledge** 버튼이 있는 페이지 |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | **Acknowledge** 버튼 |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | 선택: 호출을 다음 사람에게 넘기는 페이지 |
| POST | `/api/user-notification-log-timeline/pass-on/*` | 선택: 그 페이지의 버튼 |
| GET | `/oneuptime-assets/*` | 이 페이지들의 글꼴, 스타일, 로고 |

:::steps
### 공개 이름이 프록시를 가리키게 하기
메시지의 링크는 `HOST` 설정으로 만들어지므로, 그 이름은 공개 DNS에서 프록시로 확인되어야 하고 공개적으로 신뢰되는 인증서를 갖춰야 합니다. 분할 DNS를 쓰면 자체 네트워크의 사용자는 계속 그 이름을 프라이빗 주소로 확인하고, 나머지는 모두 이전처럼 사용합니다.

### 경로를 그대로 전달하기
이 경로의 요청은 메서드, 경로, 쿼리 문자열을 그대로 유지해 OneUptime의 ingress로 보내고, 그 밖의 요청에는 모두 404로 응답하세요.

### 요청 속도 제한하기
모든 링크에는 무작위 ID가 들어 있으며, 단축 링크는 영문자 8자로 되어 있습니다. 주소별로 보낼 수 있는 요청 수를 제한해, 누구도 ID를 빠르게 대입해 볼 수 없게 하세요.
:::

대응자가 확인하면 페이지가 대시보드에서 알림을 여는데, 대시보드는 자체 네트워크에서만 열립니다. 그 시점에는 확인이 이미 저장되어 있습니다.

## 공급자 콜백

### Telegram

알림을 보내는 데에는 `api.telegram.org`로 나가는 아웃바운드 HTTPS만 있으면 됩니다. 계정을 연결하려면 사용자가 봇에 보내는 `/start` 메시지를 서버가 받아야 하며, 방법은 두 가지입니다.

- **폴링**: **Admin Dashboard > 설정 > Telegram**에서 **Poll Telegram for Messages**를 켭니다. OneUptime이 몇 초마다 아웃바운드 HTTPS로 Telegram에서 봇의 메시지를 가져오므로, 서버로 들어와야 하는 것이 없습니다.
- **웹훅**: Telegram이 각 메시지를 `POST /api/notification/telegram/webhook`으로 보냅니다. Telegram은 `149.154.160.0/20`과 `91.108.4.0/22`에서 [웹훅을 보내므로](https://core.telegram.org/bots/webhooks) 이 주소만 허용하면 됩니다.

### Twilio

대응자가 통화 중에 1을 눌러 호출을 확인하면, Twilio가 누른 키를 `POST /api/user-notification-log-timeline/call/gather-input/*`로 보냅니다. 사용 중인 Twilio 에디션에 [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)가 포함되어 있지 않으면 Twilio의 웹훅 주소는 바뀝니다. SMS 전달 상태 업데이트와 수신 전화는 [Twilio 통합](/docs/self-hosted/twilio-integration)에서 설명합니다.

### WhatsApp

알림과 확인에는 인바운드 연결이 전혀 필요 없습니다. Meta는 전달 및 읽음 상태를 `/api/notification/whatsapp/webhook`으로 보냅니다. 이것이 없으면 OneUptime의 WhatsApp 로그는 Meta가 메시지를 수락한 뒤 그 메시지가 전달되었는지, 읽혔는지, 실패했는지 보여 줄 수 없습니다. Meta는 모든 요청에 서명하며 고정 주소는 공개하지 않습니다.

### Slack 및 Microsoft Teams

이들 메시지의 버튼, 메뉴, 명령은 두 서비스 모두 공개하지 않는 주소에서 서버로 요청을 보냅니다. 경로와 그 공개 방법은 [Slack 통합](/docs/self-hosted/slack-integration)과 [Microsoft Teams 통합](/docs/self-hosted/microsoft-teams-integration)을 참고하세요.

## 다음 단계

:::cards
- [Twilio 통합](/docs/self-hosted/twilio-integration): 자체 Twilio 계정으로 SMS와 통화를 보냅니다.
- [푸시 알림](/docs/self-hosted/push-notifications): 푸시 릴레이, 그리고 서버와 휴대폰이 연결하는 곳.
- [앱 개요](/docs/mobile-desktop-apps/index): OneUptime On-Call 앱을 서버에 연결합니다.
- [프라이빗 네트워크 접근](/docs/self-hosted/private-network-access): 반대 방향으로, OneUptime이 내부 도구에 도달하게 합니다.
:::
