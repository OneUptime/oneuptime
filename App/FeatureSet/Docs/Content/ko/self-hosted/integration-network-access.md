# 사설 네트워크에서의 통합 액세스

자체 호스팅 OneUptime 인스턴스는 Twilio와 Microsoft에 요청을 보낼 수 있어도 이들의 클라우드 서비스에서는 접근할 수 없을 수 있습니다. 직원의 VPN 연결은 어느 공급자에게도 사설 네트워크 액세스를 제공하지 않습니다. [Twilio 설정 가이드](/docs/self-hosted/twilio-integration)와 [Teams 설정 가이드](/docs/self-hosted/microsoft-teams-integration)를 아래 네트워크 단계와 함께 사용하세요.

## 어느 방향에 액세스가 필요한가요?

| 기능 | OneUptime에서 공급자로 | 공급자에서 OneUptime으로 |
| --- | --- | --- |
| SMS 전송 또는 간단한 발신 음성 알림 재생 | HTTPS | SMS 요청 전송이나 인라인 음성 지침 재생에는 불필요 |
| SMS 전달 상태 업데이트, 음성 키패드 동작, 수신 통화 라우팅 | HTTPS | 콜백 필요. 경로는 Twilio 가이드 참조 |
| Teams 알림 | Microsoft API로의 HTTPS | 대화 검색을 포함한 전체 봇 통합에 필요 |
| Teams 명령, 카드 버튼, 채팅 설치 이벤트 | HTTPS | `POST /api/microsoft-bot/messages` |

[사설 네트워크 액세스 설정](/docs/self-hosted/private-network-access)은 OneUptime에서 내부 서비스로 보내는 아웃바운드 요청을 제어합니다. `ALLOW_PRIVATE_NETWORK_WEBHOOKS`를 켜도 Twilio나 Teams에서 OneUptime에 접근할 수 있게 되지는 않습니다.

## 프로덕션: 비공개 배포로 연결하는 게이트웨이 공개

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
공개 게이트웨이 (역방향 프록시 또는 부하 분산 장치)
          | 사설 연결, 콜백 경로만 허용
          v
비공개 OneUptime 인그레스 -> OneUptime 애플리케이션
```

1. **호스트 이름을 선택합니다.** 예: `oneuptime.example.com`. 인터넷에 연결된 게이트웨이를 가리키는 공개 DNS 레코드를 게시합니다. 공급자는 사설 IP 주소와 내부 전용 DNS 이름에 접근할 수 없습니다. 분할 DNS를 사용하면 직원은 같은 호스트 이름을 비공개 인그레스로 확인하고 VPN을 통해 대시보드를 계속 사용할 수 있습니다. 비공개 인그레스도 해당 호스트 이름에 유효한 인증서로 HTTPS를 제공해야 합니다.
2. **게이트웨이를 OneUptime에 연결합니다.** 비공개 인그레스로의 경로가 있는 DMZ에 배치하거나, 자체 사이트 간 VPN/사설 링크로 연결된 공개 게이트웨이를 사용합니다. 업스트림 서비스 포트에서 게이트웨이와 인그레스 간 트래픽을 허용하세요. Kubernetes/Portainer에서는 비공개 `ClusterIP` 서비스만으로는 충분하지 않습니다. 게이트웨이에 인그레스/컨트롤러 또는 다른 접근 가능한 업스트림이 필요합니다. 데이터베이스와 다른 내부 서비스는 비공개로 유지하세요.
3. **포트 443에서 HTTPS를 종료합니다.** 공개적으로 신뢰되는 인증서와 전체 중간 인증서 체인을 사용합니다. 게이트웨이로의 인바운드 TCP 443을 허용하세요. 인증서를 설치하거나 DNS만 변경한다고 사설 업스트림 경로가 생기지는 않습니다.
4. **필요한 콜백 경로만 전달합니다.** Twilio 가이드 표의 경로와 Teams의 `/api/microsoft-bot/messages`가 대상입니다. 이미 `/notification`을 애플리케이션에 매핑하는 OneUptime 인그레스를 통해 라우팅하세요. 메서드, 원래 경로, 쿼리 문자열, 본문, `Authorization`, `X-Twilio-Signature`를 보존합니다. 공개 `Host`를 유지하고 게이트웨이에서 신뢰할 수 있는 `X-Forwarded-Host`와 `X-Forwarded-Proto: https`를 설정하세요. `/api`를 제거하거나 리디렉션을 추가하지 마세요. 공개 게이트웨이에서는 다른 경로를 거부합니다. 직원은 비공개 인그레스로 대시보드와 브라우저 로그인 콜백에 접근할 수 있습니다.
5. **콜백 인증을 유지합니다.** 공급자는 브라우저 SSO, CAPTCHA, 프록시 로그인 페이지를 완료할 수 없으므로 이 경로를 해당 요구 사항에서 제외합니다. OneUptime은 계속해서 콜백 토큰, 수신 통화 경로의 Twilio 서명, Bot Framework 인증을 검증합니다. 이 검사를 제거하지 마세요. 원본 서버 액세스는 게이트웨이와 승인된 내부 클라이언트에만 허용하고 로그의 콜백 토큰을 가리세요. Twilio는 이 [DMZ 프록시 아키텍처와 웹후크 보안](https://www.twilio.com/docs/usage/webhooks/webhooks-security)을 설명합니다.
6. 어느 통합이든 설정하기 전에 **OneUptime의 표준 URL을 설정합니다.**

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

   이 설정은 생성되는 URL을 제어하며 DNS, TLS, 방화벽 액세스를 구성하지 않습니다. Compose 설정이나 Helm 릴리스 업데이트를 적용하고 애플리케이션이 다시 시작될 때까지 기다립니다. OneUptime은 별도의 Twilio 콜백 호스트 이름 설정을 제공하지 않습니다. 호스트 이름이 변경되면 기존 Twilio 전화번호 웹후크, Azure Bot 메시징 엔드포인트, 앱 등록 리디렉션 URI를 업데이트하고 Teams 매니페스트를 다시 다운로드하여 업로드하세요.

## 아웃바운드 액세스 및 IP 제한

OneUptime 애플리케이션의 DNS 확인과 아웃바운드 HTTPS를 허용합니다. API 주소가 바뀌기 때문에 Twilio는 `*.twilio.com` 액세스를 권장합니다. [Twilio IP 주소 안내](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)를 참조하세요. Teams는 `graph.microsoft.com`, `login.microsoftonline.com`, Bot Framework 인증/채널 엔드포인트, 대화의 커넥터 서비스 URL을 사용합니다. [Microsoft 방화벽 안내](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)를 참고하고 테스트 중 차단된 트래픽을 점검하세요. 이 예시는 전체 도메인 목록이 아닙니다.

Twilio SIP/미디어 범위나 Teams 클라이언트 미디어 범위를 웹후크 원본 허용 목록으로 사용하지 마세요. 일반 Twilio 웹후크 주소는 동적입니다. 해당하는 Twilio 에디션에서는 [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)를 제공하며, Twilio와 별도로 설정해야 합니다. Microsoft 방화벽 안내는 고정된 Bot Framework 인바운드 IP 허용 목록이 지원되지 않는다고 설명합니다. 고정 원본 IP만으로 신원이 입증된다고 가정하지 말고 애플리케이션에서 콜백을 인증하세요.

## 테스트 및 인바운드 액세스가 없는 배포

VPN 외부 네트워크에서 공개 DNS와 TLS를 확인한 다음 Teams 경로를 확인합니다.

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

현재 OneUptime 버전에서는 `Allow: POST`와 함께 `405 Method Not Allowed`가 반환되어야 합니다. 이는 GET이 해당 경로에 도달했음을 확인할 뿐, 인증된 봇 POST가 작동한다는 의미는 아닙니다. 이전 버전은 OneUptime의 JSON 404를 반환할 수 있으므로 응답 본문과 프록시 로그를 확인하세요. TLS 오류, 시간 초과, 프록시의 HTML 오류 페이지는 인증서 또는 라우팅 문제를 나타냅니다.

브라우저 GET으로는 Twilio POST 콜백을 테스트할 수 없습니다. 실제 테스트 SMS를 보내 전달 상태 업데이트를 확인하고, 테스트 인시던트 통화를 받아 키패드 동작을 사용한 다음, Teams 봇에 메시지를 보내고 카드 버튼을 누르세요. 토큰을 가린 상태로 공급자의 전달 진단과 게이트웨이 및 애플리케이션 로그를 대조합니다. 아웃바운드 전달 성공만으로 콜백 작동이 입증되지는 않습니다.

개발 환경을 위해 Twilio는 [터널을 통한 테스트](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)를, Microsoft는 [로컬 Teams 디버깅](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug)을 설명합니다. 필요한 경로만 허용하는 프록시로 공개 HTTPS 터널을 전달하고, 생성된 호스트 이름을 위와 같이 설정한 후 테스트가 끝나면 터널을 중지하세요. 터널도 인바운드 엔드포인트를 공개하므로 배포를 외부 네트워크와 완전히 격리하지는 않습니다.

정책에서 모든 인바운드 연결을 금지한다면 SMS 전송 요청과 간단한 인라인 음성 재생은 아웃바운드 HTTPS로 계속 작동할 수 있습니다. 그러나 전달 콜백, 키패드 동작, 수신 통화 라우팅, 전체 Teams 봇 통합은 작동할 수 없습니다. Direct Line용 Azure Bot 프라이빗 엔드포인트는 Teams 연결 문제를 해결하지 않습니다. Microsoft의 [네트워크 격리 가이드](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0)는 공개 액세스를 끄면 Teams를 포함한 다른 채널이 제거된다고 설명합니다. 완전히 연결이 끊긴 배포는 이러한 클라우드 통합을 사용할 수 없습니다.
