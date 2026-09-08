# Microsoft Teams 통합

자체 호스팅 OneUptime 인스턴스와 Microsoft Teams를 통합하려면 Azure 앱 등록을 구성하고 필요한 환경 변수를 설정해야 합니다.

## 전제 조건

- Azure 계정 - [https://azure.com](https://azure.com)에서 생성할 수 있습니다
- OneUptime 서버 구성에 대한 액세스

## 네트워크 액세스

OneUptime은 Teams 통합에 Azure Bot을 사용합니다. Incoming Webhook이나 Teams Workflow URL은 이 봇의 메시징 엔드포인트를 대체하지 않습니다. Microsoft는 [자체 호스팅 봇에 공개적으로 접근 가능한 HTTPS 엔드포인트](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)를 요구합니다. 사설 IP 주소, 내부 DNS 이름, 직원의 VPN 연결은 Azure Bot Service에 OneUptime 액세스를 제공하지 않습니다.

| 기능 | OneUptime에서 공급자로 | 공급자에서 OneUptime으로 |
| --- | --- | --- |
| Teams 알림 | Microsoft API로의 HTTPS | 대화 검색을 포함한 전체 봇 통합에 필요 |
| Teams 명령, 카드 버튼, 채팅 설치 이벤트 | HTTPS | `POST /api/microsoft-bot/messages` |

앱 등록 리디렉션 `/api/microsoft-teams/auth`와 `/api/microsoft-teams/admin-consent/callback`은 사용자 브라우저를 통해 돌아옵니다. 이 브라우저는 회사 네트워크나 VPN 등을 통해 OneUptime에 접근할 수 있어야 합니다. 봇 메시지와 카드 동작은 Microsoft 서버에서 도착하므로 별도로 접근 가능한 인그레스가 필요합니다. 아웃바운드 알림 전달만으로는 인바운드 연결을 검증할 수 없습니다.

### 프로덕션: 비공개 배포로 연결하는 게이트웨이 공개

1. **호스트 이름을 선택합니다.** 예: `oneuptime.example.com`. 인터넷에 연결된 게이트웨이를 가리키는 공개 DNS 레코드를 게시합니다. 공급자는 사설 IP 주소와 내부 전용 DNS 이름에 접근할 수 없습니다. 분할 DNS를 사용하면 직원은 같은 호스트 이름을 비공개 인그레스로 확인하고 VPN을 통해 대시보드를 계속 사용할 수 있습니다. 비공개 인그레스도 해당 호스트 이름에 유효한 인증서로 HTTPS를 제공해야 합니다.

2. **게이트웨이를 OneUptime에 연결합니다.** 비공개 인그레스로의 경로가 있는 DMZ에 배치하거나, 자체 사이트 간 VPN/사설 링크로 연결된 공개 게이트웨이를 사용합니다. 업스트림 서비스 포트에서 게이트웨이와 인그레스 간 트래픽을 허용하세요. Kubernetes/Portainer에서는 비공개 `ClusterIP` 서비스만으로는 충분하지 않습니다. 게이트웨이에 인그레스/컨트롤러 또는 다른 접근 가능한 업스트림이 필요합니다. 데이터베이스와 다른 내부 서비스는 비공개로 유지하세요.

3. **포트 443에서 HTTPS를 종료합니다.** 공개적으로 신뢰되는 인증서와 전체 중간 인증서 체인을 사용합니다. 게이트웨이로의 인바운드 TCP 443을 허용하세요. 인증서를 설치하거나 DNS만 변경한다고 사설 업스트림 경로가 생기지는 않습니다.

4. `/api/microsoft-bot/messages`만 공개하고 4단계의 Azure Bot 메시징 엔드포인트를 이 전체 공개 HTTPS URL로 설정합니다. OneUptime Bot Framework 어댑터가 요청을 수신하고 인증할 수 있어야 합니다. 메서드, 경로, 쿼리 문자열, 본문, 인증 헤더(`Authorization`)를 유지합니다. 공개 `Host`를 보존하고 신뢰할 수 있는 `X-Forwarded-Host` 및 `X-Forwarded-Proto: https` 헤더를 설정하세요. 리디렉션을 추가하지 마세요.

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

   예시를 실제 도메인으로 바꾸세요. 이 설정은 URL을 생성하며 DNS, TLS 또는 방화벽 규칙을 만들지는 않습니다. Compose 설정 또는 Helm 업데이트를 적용하고 애플리케이션이 다시 시작될 때까지 기다리세요. 호스트 이름이 바뀌면 Azure Bot 엔드포인트와 앱 등록의 리디렉션 URI를 업데이트한 다음 Teams 매니페스트를 다시 다운로드하고 업로드하세요.

[사설 네트워크 액세스 설정](/docs/self-hosted/private-network-access)은 OneUptime에서 내부 서비스로 보내는 아웃바운드 요청을 제어합니다. `ALLOW_PRIVATE_NETWORK_WEBHOOKS`를 켜도 Teams에서 OneUptime에 접근할 수 있게 되지는 않습니다.

### 아웃바운드 액세스 및 IP 제한

OneUptime 애플리케이션의 DNS 확인과 아웃바운드 HTTPS (TCP 443)를 허용합니다. Teams는 `graph.microsoft.com`, `login.microsoftonline.com`, Bot Framework 인증/채널 엔드포인트, 대화의 커넥터 서비스 URL을 사용합니다. [Microsoft 방화벽 안내](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)를 참고하고 테스트 중 차단된 트래픽을 점검하세요. 이 예시는 전체 도메인 목록이 아닙니다. 상용 클라우드의 대체 커넥터는 `https://smba.trafficmanager.net/teams/`이며 대화의 서비스 URL은 다를 수 있습니다.

Microsoft는 주소가 변경되므로 고정된 인바운드 Bot Framework IP 허용 목록을 지원하지 않습니다. Teams 클라이언트 미디어 범위는 봇 웹훅의 원본 주소가 아닙니다. Bot Framework 인증을 활성화 상태로 유지하세요.

### 테스트 및 인바운드 액세스가 없는 배포

VPN 외부 네트워크에서 공개 DNS와 TLS를 확인한 다음 Teams 경로를 확인합니다.

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

현재 OneUptime 버전에서는 `Allow: POST`와 함께 `405 Method Not Allowed`가 반환되어야 합니다. 이는 GET이 해당 경로에 도달했음을 확인할 뿐, 인증된 봇 POST가 작동한다는 의미는 아닙니다. 이전 버전은 OneUptime의 JSON 404를 반환할 수 있으므로 응답 본문과 프록시 로그를 확인하세요. TLS 오류, 시간 초과, 프록시의 HTML 오류 페이지는 인증서 또는 라우팅 문제를 나타냅니다.

Teams를 연결하고 테스트 알림을 보낸 뒤 봇에 메시지를 보내고 카드 버튼을 누릅니다. OneUptime에서 동작을 확인하고 Microsoft 진단을 게이트웨이 및 애플리케이션 로그와 대조하세요. 알림 배달만으로 인증된 인바운드 POST를 검증할 수 없습니다.

개발 환경을 위해 Microsoft의 [Teams 테스트 가이드](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/add-authentication#testing-the-bot-locally-in-teams)는 터널로 로컬 서비스를 공개하는 방법을 설명합니다. OneUptime 인그레스로 전달하고 Microsoft 예시의 `/api/messages` 경로 대신 `/api/microsoft-bot/messages`를 사용하세요. 공개 터널 URL이 바뀔 때마다 Azure Bot 엔드포인트를 업데이트하고 프로덕션에서는 안정적인 인그레스를 사용합니다. 해당 OneUptime 호스트 이름도 설정하세요. 터널 역시 인바운드 접근을 공개하므로 테스트 후 중지하세요.

모든 인바운드 연결이 금지되면 전체 Teams 통합은 작동하지 않습니다. 명령, 카드 동작, 대화 검색은 인바운드 연결에 의존합니다. 완전히 연결이 끊긴 설치에서는 Teams를 사용할 수 없습니다.

Azure Bot Private Endpoint는 이 Teams 인그레스를 대체하지 않습니다. Microsoft의 [네트워크 격리 지침](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0)은 Direct Line 격리를 설명하며, 공개 네트워크 액세스를 끄면 Teams 채널 설정이 해제된다고 명시합니다.

## 설정 지침

### 1단계: Azure 앱 등록 생성

1. [Azure 포털](https://portal.azure.com)로 이동합니다
2. "앱 등록"으로 이동하고 "새 등록"을 클릭합니다
3. 등록 양식을 작성합니다:
   - **이름:** oneuptime
   - **지원되는 계정 유형:** 모든 조직 디렉토리의 계정 (모든 Microsoft Entra ID 테넌트 - 멀티테넌트)
   - **리디렉션 URI:** 웹 - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - 다음도 추가하십시오: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. "등록"을 클릭합니다
5. "애플리케이션(클라이언트) ID"를 기록합니다 - 나중에 필요합니다

### 2단계: 앱 권한 구성

1. 앱 등록에서 "API 권한"으로 이동합니다
2. "권한 추가"를 클릭하고 "Microsoft Graph"를 선택합니다

**위임된 권한 추가** (로그인한 사용자를 대신하여 작동할 때):

- **User.Read** - OAuth 흐름 중에 인증된 사용자의 프로필 정보 (표시 이름, 이메일)를 가져오는 데 필요합니다
- **Team.ReadBasic.All** - 연결할 팀을 선택할 때 사용자가 구성원인 팀을 나열하는 데 필요합니다
- **Channel.ReadBasic.All** - 알림 전달을 위한 팀 내 채널 읽기 및 나열에 필요합니다
- **ChannelMessage.Send** - Teams 채널에 알림 및 인시던트 알림을 전송하는 데 필요합니다

**애플리케이션 권한 추가** (로그인한 사용자 없이 앱 자체로 작동할 때):

- **Team.ReadBasic.All** - 관리자 동의가 부여된 후 조직의 모든 팀을 나열하는 데 필요합니다
- **Channel.ReadBasic.All** - 채널 존재 확인 및 채널 세부 정보 검색에 필요합니다

`ChannelMessage.Send`는 위임된 권한만 제공합니다. [Microsoft Graph 권한 참조](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend)에 애플리케이션 권한 유형은 없습니다. 위의 위임된 권한 목록에 유지하세요.

**참고:** Bot Framework는 Teams 앱 매니페스트에 정의된 리소스별 동의 (RSC) 권한을 사용하여 메시지 전달을 처리합니다. 이러한 권한은:

- **ChannelMessage.Send.Group** - 봇이 팀 채널에 메시지를 전송할 수 있도록 합니다
- **ChannelMessage.Read.Group** - 봇이 대화형 명령을 위한 채널 메시지를 읽을 수 있도록 합니다
- **Channel.Create.Group** - 봇이 필요할 때 채널을 만들 수 있도록 합니다

3. 조직에 대한 "관리자 동의 부여"를 클릭합니다

### 3단계: 클라이언트 시크릿 생성

1. 앱 등록에서 "인증서 및 시크릿"으로 이동합니다
2. "새 클라이언트 시크릿"을 클릭합니다
3. 설명을 추가하고 만료 기간 설정 (24개월 권장)
4. "추가"를 클릭하고 즉시 시크릿 값을 복사합니다 - 다시 볼 수 없습니다

**중요:** 시크릿 ID가 아닌 시크릿 값을 복사하십시오. 시크릿 값은 일반적으로 더 길고 더 많은 문자를 포함합니다.

### 4단계: 봇 서비스 생성

1. Azure 포털에서 "Azure Bot"으로 이동하고 "만들기"를 클릭합니다
2. 봇 생성 양식을 작성합니다:

   - **봇 핸들:** oneuptime-bot
   - **구독:** Azure 구독
   - **리소스 그룹:** 새로 만들거나 기존 사용
   - **위치:** 사용자와 가까운 위치 선택
   - **가격 책정 계층:** F0 (무료)로 테스트에 충분
   - 이전에 생성한 앱 등록의 앱(클라이언트) ID와 테넌트 ID를 사용하십시오

3. "검토 + 만들기"를 클릭한 후 "만들기"를 클릭합니다

4. 배포된 후 봇 리소스로 이동하여 "구성"으로 이동합니다
5. "메시징 엔드포인트"를 `https://your-oneuptime-domain.com/api/microsoft-bot/messages`로 설정합니다
6. 구성을 저장합니다

### 5단계: 봇에 Microsoft Teams 채널 추가

1. Azure Bot 리소스에서 "채널"로 이동합니다
2. "Microsoft Teams"를 찾아 선택하고 "열기" 또는 "추가"를 클릭합니다
3. 설정을 검토합니다 (Teams에 대해 활성화, 특별한 요구 사항이 없는 한 기본 메시징 옵션 유지)
4. "저장"을 클릭합니다 (메시지가 표시되면 "완료"/"게시"도 클릭)

### 6단계: OneUptime 환경 변수 구성

#### Docker Compose

Docker Compose를 사용하는 경우 구성에 다음 환경 변수를 추가합니다:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes + Helm

Kubernetes + Helm을 사용하는 경우 `values.yaml` 파일에 다음을 추가합니다:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
  tenantId: YOUR_MICROSOFT_TENANT_ID
```

**중요:** 이러한 환경 변수를 추가한 후 OneUptime 서버를 재시작하여 적용합니다.

### 7단계: Teams 앱 매니페스트 업로드

1. **프로젝트 설정** > **워크스페이스** > **Microsoft Teams**로 이동합니다
2. 거기에서 Teams 앱 매니페스트를 다운로드합니다
3. Microsoft Teams로 이동하여 사이드바에서 "앱"을 클릭합니다
4. 하단에서 "앱 관리"를 클릭합니다
5. "커스텀 앱 업로드"를 클릭합니다
6. "나 또는 내 팀을 위해 업로드"를 선택합니다
7. 이전에 다운로드한 매니페스트 zip 파일을 업로드합니다

## 문제 해결

문제가 발생하는 경우:

- 앱에 올바른 권한이 부여되어 있는지 확인합니다
- 리디렉션 URI가 정확히 일치하는지 확인합니다 (`your-oneuptime-domain.com`을 실제 도메인으로 교체)
- 환경 변수가 올바르게 설정되어 있는지 확인합니다
- 봇 메시징 엔드포인트가 인터넷에서 액세스 가능한지 확인합니다
- 봇이 Teams 채널과 올바르게 구성되어 있는지 확인합니다
- Teams 앱 매니페스트가 성공적으로 업로드되었는지 확인합니다

## 지원

이 통합을 개선하고 싶으므로 피드백은 대환영입니다. [hello@oneuptime.com](mailto:hello@oneuptime.com)으로 보내 주십시오.
