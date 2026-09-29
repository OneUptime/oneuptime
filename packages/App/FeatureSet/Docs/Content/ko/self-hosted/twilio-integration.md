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

비공개 배포에서 SMS와 통화 요청을 전송하려면 Twilio로의 아웃바운드 HTTPS 액세스가 필요합니다. Twilio API 주소는 동적으로 변경되므로 `*.twilio.com`으로의 아웃바운드 HTTPS를 허용할 것을 권장합니다. [Twilio IP 주소](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)를 참조하세요. Kubernetes NetworkPolicies와 외부 방화벽을 포함하여 OneUptime 애플리케이션 워크로드의 송신 트래픽에 적용하세요. OneUptime 애플리케이션의 DNS 확인과 아웃바운드 HTTPS (TCP 443)를 허용합니다.

인바운드 액세스 필요 여부는 기능에 따라 다릅니다.

| 기능 | Twilio가 OneUptime에 접근해야 하나요? |
| --- | --- |
| SMS 전송 요청 | 아니요. 단, 전달 상태 업데이트에는 콜백이 필요합니다. |
| 일반 음성 테스트 통화 | 아니요. OneUptime은 아웃바운드 API 요청에 음성 지침을 포함합니다. |
| 1번을 눌러 온콜 알림 확인 | 예. Twilio가 키패드 입력을 OneUptime으로 전송합니다. |
| 수신 통화 정책 | 예. Twilio가 통화 지침을 요청하고 발신 결과를 보고합니다. |

다음은 OneUptime의 Nginx 게이트웨이를 통과하는 외부 경로입니다. 자리표시자 값은 알림마다 다릅니다.

| 메서드 | 경로 | 용도 |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | SMS 전달 상태 |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | 키패드 확인 |
| POST | `/notification/incoming-call/voice` | 선택적 수신 통화 지침 |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | 선택적 수신 통화 라우팅 결과 |

OneUptime은 SMS와 확인 동작 URL을 자동으로 생성합니다. 이 URL의 토큰을 고정 웹후크 URL로 바꾸지 마세요. 수신 통화에는 [수신 통화 정책](/docs/on-call/incoming-call-policy) 안내를 따르세요. 번호를 연결할 때 해당 번호의 웹후크가 설정됩니다.

Twilio에는 [공개적으로 접근 가능한 웹후크 URL](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)이 필요합니다. 공개적으로 신뢰되는 TLS 인증서를 사용하고, 프록시를 거쳐도 원래 호스트, 프로토콜, 경로, 쿼리 매개변수, 본문, `X-Twilio-Signature` 헤더를 보존하세요. 수신 통화 핸들러는 Twilio 서명을 검증합니다. SMS 전달에는 메시지별 URL 토큰을 사용하고, 키패드 확인에는 서명된 쿼리 토큰을 사용합니다. 공유 로그나 스크린샷에 토큰을 노출하지 마세요. [Twilio 웹후크 보안](https://www.twilio.com/docs/usage/webhooks/webhooks-security)을 참조하세요.

### 프로덕션: 비공개 배포로 연결하는 게이트웨이 공개

1. **호스트 이름을 선택합니다.** 예: `oneuptime.example.com`. 인터넷에 연결된 게이트웨이를 가리키는 공개 DNS 레코드를 게시합니다. 공급자는 사설 IP 주소와 내부 전용 DNS 이름에 접근할 수 없습니다. 분할 DNS를 사용하면 직원은 같은 호스트 이름을 비공개 인그레스로 확인하고 VPN을 통해 대시보드를 계속 사용할 수 있습니다. 비공개 인그레스도 해당 호스트 이름에 유효한 인증서로 HTTPS를 제공해야 합니다.

2. **게이트웨이를 OneUptime에 연결합니다.** 비공개 인그레스로의 경로가 있는 DMZ에 배치하거나, 자체 사이트 간 VPN/사설 링크로 연결된 공개 게이트웨이를 사용합니다. 업스트림 서비스 포트에서 게이트웨이와 인그레스 간 트래픽을 허용하세요. Kubernetes/Portainer에서는 비공개 `ClusterIP` 서비스만으로는 충분하지 않습니다. 게이트웨이에 인그레스/컨트롤러 또는 다른 접근 가능한 업스트림이 필요합니다. 데이터베이스와 다른 내부 서비스는 비공개로 유지하세요.

3. **포트 443에서 HTTPS를 종료합니다.** 공개적으로 신뢰되는 인증서와 전체 중간 인증서 체인을 사용합니다. 게이트웨이로의 인바운드 TCP 443을 허용하세요. 인증서를 설치하거나 DNS만 변경한다고 사설 업스트림 경로가 생기지는 않습니다.

4. 위 표의 필요한 콜백 경로만 OneUptime Nginx 게이트웨이를 통해 공개합니다. 이 게이트웨이는 `/notification`을 애플리케이션에 연결합니다. 키패드 확인 경로의 `/api`를 유지하세요. 메서드, 경로, 쿼리 문자열, 본문, 인증 헤더(`X-Twilio-Signature`)를 유지합니다. 공개 `Host`를 보존하고 신뢰할 수 있는 `X-Forwarded-Host` 및 `X-Forwarded-Proto: https` 헤더를 설정하세요. 리디렉션을 추가하지 마세요.

5. 이 경로를 브라우저 SSO, CAPTCHA, 프록시 로그인 페이지에서 제외합니다. OneUptime 인증은 활성화 상태로 유지합니다. 원본 서버 접근은 게이트웨이와 승인된 내부 클라이언트로 제한하고 로그의 토큰을 가리세요.

6. **OneUptime의 표준 URL을 설정하세요**:

   Docker Compose의 `config.env`:

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm/Portainer values:

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   예시를 실제 도메인으로 바꾸세요. 이 설정은 URL을 생성하며 DNS, TLS 또는 방화벽 규칙을 만들지는 않습니다. Compose 설정 또는 Helm 업데이트를 적용하고 애플리케이션이 다시 시작될 때까지 기다리세요. OneUptime에는 Twilio 콜백 전용 호스트 이름 설정이 없습니다. 이름이 바뀌면 기존 Twilio 전화번호의 웹훅도 업데이트하세요.

[사설 네트워크 액세스 설정](/docs/self-hosted/private-network-access)은 OneUptime에서 내부 서비스로 보내는 아웃바운드 요청을 제어합니다. `ALLOW_PRIVATE_NETWORK_WEBHOOKS`를 켜도 Twilio에서 OneUptime에 접근할 수 있게 되지는 않습니다.

### 아웃바운드 액세스 및 IP 제한

일반 Twilio 웹훅의 원본 주소는 변경됩니다. SIP 또는 미디어 범위를 콜백 허용 목록으로 사용하지 마세요. 해당 에디션은 [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)를 제공합니다. 자격과 지원 제품을 확인하고 현재 공개된 범위로 방화벽을 설정하세요. 콜백 인증은 계속 유지하세요.

### 테스트 및 인바운드 액세스가 없는 배포

인바운드 접근 없이도 아웃바운드 HTTPS로 SMS 전송과 단순 음성 재생은 가능합니다. 배달 상태, 키패드 확인, 수신 전화 라우팅에는 접근 가능한 콜백이 필요합니다. 완전히 연결이 끊긴 설치에서는 Twilio를 사용할 수 없습니다.

개발용 공개 터널은 Twilio의 [웹훅 테스트 안내](https://www.twilio.com/docs/usage/webhooks/webhook-testing)를 참고하세요. 필요한 경로만 허용하는 프록시로 전달하고 생성된 호스트 이름을 위와 같이 설정한 뒤 테스트 후 터널을 중지합니다. 터널도 인바운드 접근을 공개합니다.

## 4. 전달과 콜백을 별도로 테스트

1. 회사 네트워크와 VPN 외부에서 콜백 호스트 이름이 공개 게이트웨이로 확인되고 유효한 TLS 인증서를 제공하는지 확인합니다. 브라우저 GET은 이러한 POST 콜백을 테스트하지 않습니다.
2. 프로젝트의 Twilio 설정에서 **테스트 SMS 보내기**와 **테스트 전화 걸기**를 사용합니다. 대상 휴대전화에서 수신을 확인합니다.
3. 사용자의 인증된 SMS/통화 연락처와 알림 규칙을 설정한 다음, 통제된 온콜 테스트 알림을 발생시킵니다. 1번을 누르고 OneUptime에서 확인 처리되었는지 확인합니다. 수신 전화 정책을 사용한다면 설정한 번호로 전화해 라우팅과 통화 로그를 확인하세요.
4. OneUptime과 Twilio 메시지 로그에서 SMS 전달 상태를 확인합니다. 전송 요청이 수락되었다고 전달된 것은 아닙니다. [Twilio는 이후 상태 변경을 콜백으로 보고합니다](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status).

전송에 실패하면 자격 증명, 번호 기능, 계정 제한, 아웃바운드 연결을 확인하세요. 메시지나 통화는 도착했지만 상태나 확인 결과가 업데이트되지 않으면 콜백 URL과 공개 인그레스 로그를 살펴보세요. Twilio의 [HTTP 검색 실패 안내](https://www.twilio.com/docs/api/errors/11200)는 콜백 접근 불가, TLS 문제, HTTP 오류를 진단하는 데 도움이 됩니다. 테스트 통화 성공만으로 콜백 액세스를 검증할 수는 없습니다.
