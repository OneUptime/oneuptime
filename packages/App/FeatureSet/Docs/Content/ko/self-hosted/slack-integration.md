# Slack 통합

자체 호스팅 OneUptime 프로젝트를 Slack에 연결하여 알림, 인시던트 작업, 명령어 및 메시지 이벤트를 사용하세요.

## 설정

1. 아래와 같이 OneUptime 호스트명과 HTTPS를 설정하세요. **Settings > Slack Integration**에서 생성된 매니페스트를 복사하세요. `https://your-oneuptime-domain.com/api/slack/app-manifest`에서도 받을 수 있습니다.
2. 자체 배포에서 생성한 매니페스트로 워크스페이스에 [Slack 앱을 만드세요](https://api.slack.com/apps). URL이 실제 호스트명과 일치해야 합니다.
3. 앱의 **Basic Information**에서 **Client ID**, **Client Secret**, **Signing Secret**을 Docker Compose의 `config.env`로 복사하세요.

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Helm에서는 다음 값을 설정하세요.

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. 설정을 적용하고 OneUptime이 다시 시작될 때까지 기다리세요. 서명 비밀 키 설정 전에 Events URL 검증이 실패했다면 다시 시도하세요.
5. **Settings > Slack Integration**으로 돌아가 **Connect to Slack**을 선택하고 앱을 승인하세요. 사용자 신원이 필요한 작업에는 OneUptime에서 개인 Slack 계정도 연결하세요.

## 자체 호스팅 배포의 네트워크 액세스

### 트래픽 방향과 엔드포인트

| 트래픽 | 필요한 액세스 |
| --- | --- |
| OneUptime → Slack | DNS 및 TCP 443 아웃바운드 HTTPS. Web API와 OAuth 토큰 교환은 `slack.com`, 명령 응답과 사용 중인 수신 웹훅 알림은 `hooks.slack.com` |
| Slack → OneUptime | 전체 통합을 위해 아래 네 POST 경로로 TCP 443 공개 HTTPS 접속 |
| 사용자 브라우저 → OneUptime | 대시보드 및 `/api/slack/auth/:projectId/:userId`, `/api/slack/auth/:projectId/:userId/user` OAuth 리디렉션. 사용자 VPN을 통해 접근 가능하게 유지해도 됩니다 |

이 도메인은 OneUptime 통합용이며 Slack 클라이언트나 모든 기능의 완전한 허용 목록은 아닙니다. Slack *수신 웹훅*은 Slack에 호스팅되며 OneUptime이 그쪽으로 전송합니다. OneUptime 서버의 인바운드 엔드포인트가 아닙니다. [수신 웹훅 안내](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)를 참고하세요.

다음 공급자 콜백을 ingress를 통해 OneUptime 애플리케이션으로 전달하세요.

| 메서드와 경로 | 용도 |
| --- | --- |
| `POST /api/slack/events` | Events API 검증, 반응, 멘션, 메시지 |
| `POST /api/slack/interactive` | 버튼, 바로가기, 모달 제출, `/incident`, `/maintenance` |
| `POST /api/slack/options-load` | 대화형 메뉴 옵션 요청 |
| `POST /api/slack/command` | `/oneuptime` 명령 |

OAuth는 [브라우저 리디렉션 후 서버에서 토큰을 교환](https://docs.slack.dev/authentication/installing-with-oauth/)합니다. 매니페스트는 `/api/slack/auth`를 접두사로 등록하고, OneUptime은 승인 시 프로젝트와 사용자 경로를 추가합니다. 브라우저 접속만으로 Slack이 이벤트나 버튼 작업을 전달할 수는 없습니다.

### 비공개 배포와 콜백 보안

공개 DNS와 공인 신뢰 HTTPS 인증서, 전체 인증서 체인, OneUptime ingress로 연결되는 사설 경로가 있는 게이트웨이를 사용하세요. 인바운드 TCP 443을 허용하고 위의 공급자 POST 콜백만 공개하세요. 사설 `ClusterIP`, 내부 DNS, 직원 VPN만으로는 공급자가 접속할 수 없습니다. 분할 DNS로 같은 호스트명 아래 대시보드와 브라우저 OAuth 경로를 비공개로 유지할 수 있습니다.

`config.env`에서 `HOST=oneuptime.example.com`, `HTTP_PROTOCOL=https`를 설정하거나 Helm에서 `host: oneuptime.example.com`, `httpProtocol: https`를 설정하세요. 적용 후 재시작을 기다리세요. 이 값은 URL을 생성하며 DNS, TLS 또는 방화벽 규칙을 구성하지 않습니다. 호스트명이 바뀌면 Slack 매니페스트를 다시 생성하고 업데이트하세요.

메서드, 경로, 쿼리 문자열, 원본 본문, `Content-Type`, `X-Slack-Signature`, `X-Slack-Request-Timestamp`를 보존하세요. 신뢰할 수 있는 프록시 헤더로 공개 호스트와 HTTPS 스킴을 유지하세요. 콜백은 브라우저 SSO, CAPTCHA, 프록시 로그인에서 제외하되 OneUptime의 서명과 타임스탬프 검증은 유지하세요. 서버 시계를 동기화하세요. 소스 IP 검사는 [Slack 서명 검증](https://docs.slack.dev/authentication/verifying-requests-from-slack/)을 대신하지 않습니다.

### 접속 확인과 제한 사항

**Event Subscriptions**에서 Events Request URL을 검증하세요. Slack은 [POST 챌린지를 보내고 TLS를 검사](https://docs.slack.dev/apis/events-api/using-http-request-urls/)합니다. 이후 테스트 알림, 슬래시 명령, 인시던트 버튼, 구독 이벤트를 실행하세요. 비밀 정보를 기록하지 않고 게이트웨이와 OneUptime 로그를 확인하세요. Slack은 빠른 수신 확인을 요구하며 [상호작용은 3초 이내 응답](https://docs.slack.dev/interactivity/handling-user-interaction/)이 필요합니다. 브라우저 GET이나 발신 메시지 성공만으로 POST 콜백을 검증할 수 없습니다.

모든 인바운드 연결이 금지되면 이미 승인된 앱은 아웃바운드 HTTPS로 메시지를 보낼 수 있지만 이벤트, 버튼, 바로가기, 명령은 작동하지 않습니다. OneUptime 매니페스트는 HTTP 콜백을 사용하고 Socket Mode를 비활성화합니다. Slack Socket Mode 활성화는 지원되는 대안이 아닙니다. [사설 네트워크 액세스 설정](/docs/self-hosted/private-network-access)은 사설 대상으로 나가는 요청을 제어하며 콜백을 공개하지 않습니다.
