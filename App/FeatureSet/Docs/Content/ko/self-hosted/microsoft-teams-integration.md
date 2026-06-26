# Microsoft Teams 통합

자체 호스팅 OneUptime 인스턴스와 Microsoft Teams를 통합하려면 Azure 앱 등록을 구성하고 필요한 환경 변수를 설정해야 합니다.

## 전제 조건

- Azure 계정 - [https://azure.com](https://azure.com)에서 생성할 수 있습니다
- OneUptime 서버 구성에 대한 액세스

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
- **ChannelMessage.Send** - 프로그래밍 방식으로 채널에 메시지를 전송하는 데 필요합니다

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

1. 프로젝트 **설정** > **통합** > **Microsoft Teams**로 이동합니다
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
