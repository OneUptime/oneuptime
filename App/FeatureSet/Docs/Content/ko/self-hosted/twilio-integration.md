# Twilio SMS 및 음성 통화 통합

자체 호스팅 OneUptime은 사용자의 Twilio 계정으로 SMS와 음성 알림을 보냅니다. 요금은 Twilio에 직접 지불합니다. 자격 증명은 OneUptime 대시보드에서 설정하세요. 알림 전송은 저장된 설정을 읽으며, Helm 차트에는 Twilio 자격 증명 설정값이 없습니다. 과거 마이그레이션에서 `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`를 가져왔지만, 이 변수를 변경하는 것은 기존 설치의 자격 증명을 업데이트하는 방법이 아닙니다.

## 1. Twilio 계정 준비

1. [Twilio Console](https://console.twilio.com/)을 열고 **Account SID**와 **Auth Token**을 확인합니다.
2. 필요한 SMS 및/또는 음성 기능을 갖춘 Twilio 전화번호를 준비합니다. 발신자와 수신자 번호에는 국가 코드를 포함한 E.164 형식을 사용하세요.
3. 계정 잔액, 대상 국가 권한, 적용되는 발신자 등록 요건을 확인합니다. 체험 계정에는 수신자, 지역 등의 제한이 있어 실제 OneUptime 알림이 작동하지 않을 수 있습니다. 테스트 전에 [Twilio 계정 및 체험 문서](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account)를 확인하세요. 프로덕션에는 업그레이드한 계정을 사용합니다.

## 2. OneUptime에 자격 증명 저장

프로젝트별 설정:

1. **프로젝트 설정 > 알림 > 알림 설정**으로 이동합니다.
2. **Twilio 설정**에서 **Twilio 설정 만들기**를 선택합니다.
3. 이름, **Twilio Account SID**, **Twilio Auth Token**, **Twilio 기본 전화번호**를 입력합니다. 필요하면 다른 국가에 사용할 **Twilio 보조 전화번호**를 쉼표로 구분하여 입력합니다.
4. **프로젝트 기본값으로 설정**을 켜면 온콜 알림을 포함한 프로젝트 구성원의 SMS와 통화에 이 설정을 사용합니다. 이 스위치를 켜지 않고 설정을 생성하기만 하면 해당 알림에 사용할 설정으로 선택되지 않습니다.
5. 저장합니다. 프로젝트 기본값은 하나만 지정할 수 있습니다. 상태 페이지는 각 페이지에 명시적으로 지정된 설정을 사용합니다.

설치 전체의 기본값을 설정하려면 관리자가 **관리자 대시보드 > 설정 > 통화 및 SMS**를 열어 Twilio 자격 증명과 전화번호를 수정하고 저장할 수 있습니다. 프로젝트에 기본값이 없으면 구성원 알림에 이 전역 설정을 사용합니다. Auth Token은 기밀로 관리하세요.

## 3. 네트워크 액세스 설정

비공개 배포에서 SMS와 통화 요청을 전송하려면 Twilio로의 아웃바운드 HTTPS 액세스가 필요합니다. Twilio API 주소는 동적으로 변경되므로 `*.twilio.com`으로의 아웃바운드 HTTPS를 허용할 것을 권장합니다. [Twilio IP 주소](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)를 참조하세요. Kubernetes NetworkPolicies와 외부 방화벽을 포함하여 OneUptime 애플리케이션 워크로드의 송신 트래픽에 적용하세요.

인바운드 액세스 필요 여부는 기능에 따라 다릅니다.

| 기능 | Twilio가 OneUptime에 접근해야 하나요? |
| --- | --- |
| SMS 전송 요청 | 아니요. 단, 전달 상태 업데이트에는 콜백이 필요합니다. |
| 일반 음성 테스트 통화 | 아니요. OneUptime은 아웃바운드 API 요청에 음성 지침을 포함합니다. |
| 1번을 눌러 온콜 알림 확인 | 예. Twilio가 키패드 입력을 OneUptime으로 전송합니다. |
| 수신 통화 정책 | 예. Twilio가 통화 지침을 요청하고 발신 결과를 보고합니다. |

콜백에는 [Twilio 및 Microsoft Teams 네트워크 액세스](/docs/self-hosted/integration-network-access) 안내에 따라 인그레스나 역방향 프록시를 통해 필요한 HTTPS 경로를 공개하고 대시보드는 비공개로 유지하세요. 관리자 노트북의 VPN은 Twilio에 연결 경로를 제공하지 않습니다.

Docker Compose의 `config.env`에 `HOST=oneuptime.example.com`과 `HTTP_PROTOCOL=https`를 설정하거나, Helm values에 `host: oneuptime.example.com`과 `httpProtocol: https`를 설정한 다음 배포 변경 사항을 적용합니다. 예시를 실제 도메인으로 바꾸세요. 이 설정은 생성되는 URL을 결정하며 DNS 레코드, 인증서, 방화벽 규칙을 만들지 않습니다. OneUptime에는 별도의 Twilio 콜백 호스트 이름 설정이 없습니다.

다음은 OneUptime의 Nginx 게이트웨이를 통과하는 외부 경로입니다. 자리표시자 값은 알림마다 다릅니다.

| 메서드 | 경로 | 용도 |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | SMS 전달 상태 |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | 키패드 확인 |
| POST | `/notification/incoming-call/voice` | 선택적 수신 통화 지침 |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | 선택적 수신 통화 라우팅 결과 |

OneUptime은 SMS와 확인 동작 URL을 자동으로 생성합니다. 이 URL의 토큰을 고정 웹후크 URL로 바꾸지 마세요. 수신 통화에는 [수신 통화 정책](/docs/on-call/incoming-call-policy) 안내를 따르세요. 번호를 연결할 때 해당 번호의 웹후크가 설정됩니다.

Twilio에는 [공개적으로 접근 가능한 웹후크 URL](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)이 필요합니다. 공개적으로 신뢰되는 TLS 인증서를 사용하고, 프록시를 거쳐도 원래 호스트, 프로토콜, 경로, 쿼리 매개변수, 본문, `X-Twilio-Signature` 헤더를 보존하세요. 수신 통화 핸들러는 Twilio 서명을 검증합니다. SMS 전달에는 메시지별 URL 토큰을 사용하고, 키패드 확인에는 서명된 쿼리 토큰을 사용합니다. 공유 로그나 스크린샷에 토큰을 노출하지 마세요. [Twilio 웹후크 보안](https://www.twilio.com/docs/usage/webhooks/webhooks-security)을 참조하세요.

## 4. 전달과 콜백을 별도로 테스트

1. 프로젝트의 Twilio 설정에서 **테스트 SMS 보내기**와 **테스트 전화 걸기**를 사용합니다. 대상 휴대전화에서 수신을 확인합니다.
2. 사용자의 인증된 SMS/통화 연락처와 알림 규칙을 설정한 다음, 통제된 온콜 테스트 알림을 발생시킵니다. 1번을 누르고 OneUptime에서 확인 처리되었는지 확인합니다.
3. OneUptime과 Twilio 메시지 로그에서 SMS 전달 상태를 확인합니다. 전송 요청이 수락되었다고 전달된 것은 아닙니다. [Twilio는 이후 상태 변경을 콜백으로 보고합니다](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

전송에 실패하면 자격 증명, 번호 기능, 계정 제한, 아웃바운드 연결을 확인하세요. 메시지나 통화는 도착했지만 상태나 확인 결과가 업데이트되지 않으면 콜백 URL과 공개 인그레스 로그를 살펴보세요. Twilio의 [HTTP 검색 실패 안내](https://www.twilio.com/docs/api/errors/11200)는 콜백 접근 불가, TLS 문제, HTTP 오류를 진단하는 데 도움이 됩니다. 테스트 통화 성공만으로 콜백 액세스를 검증할 수는 없습니다.
