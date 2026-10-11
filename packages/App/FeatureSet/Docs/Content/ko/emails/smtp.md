# SMTP

OneUptime의 메일을 자체 메일 서버를 통해 보냅니다. 프로젝트는 상태 페이지가 메일을 보낼 때 쓰는 SMTP 구성을 추가하고, 자체 호스팅 설치는 OneUptime이 그 밖의 모든 메일을 보내는 서버를 설정합니다. 둘 다 세 가지 로그인 방식을 지원합니다.

- **사용자 이름과 비밀번호**: 기존 SMTP 인증.
- **OAuth 2.0**: 기본 인증이 꺼져 있는 경우가 많은 Microsoft 365와 Google Workspace용.
- **없음**: 인증이 필요 없는 릴레이 서버용.

```mermaid title="어떤 메일 서버가 무엇을 보내는가"
flowchart TB
    SP["상태 페이지의 메일"] --> Q{"페이지에 사용자 지정<br/>SMTP 구성을 골랐는가?"}
    Q -->|"예"| P["프로젝트의 SMTP 구성"]
    Q -->|"아니요"| D["OneUptime 자체 메일 서버"]
    E["OneUptime의 다른 모든 메일"] --> D
```

자체 호스팅 설치에서 OneUptime 자체 메일 서버는 Admin Dashboard에서 설정한 서버입니다. 상태 페이지는 자신의 **구독자 설정** 페이지에 있는 **사용자 지정 SMTP** 카드에서 SMTP 구성을 고릅니다.

:::cards
- [메일 서버 추가하기](#smtp-서버-추가하기): 두 단계이며, 나머지는 모두 접혀 있습니다.
- [Microsoft 365](#microsoft-365-구성): Entra 앱 등록을 사용하는 OAuth.
- [Google Workspace](#google-workspace-구성): 서비스 계정을 사용하는 OAuth.
- [문제 해결](#문제-해결): 흔한 오류와 그 의미.
:::

## SMTP 서버 추가하기

프로젝트의 메일 서버는 **프로젝트 설정 > 알림 > 알림 설정** 의 **사용자 지정 SMTP 구성** 카드에서 추가합니다. 자체 호스팅 설치에서 OneUptime 자체가 메일을 보내는 서버는 **Admin Dashboard > 설정 > 알림 > 이메일** 의 **사용자 정의 이메일 및 SMTP 설정** 카드에서 설정합니다. 두 양식 모두 두 단계에 걸쳐 같은 내용을 묻습니다.

:::steps
### 양식 열기

:::tabs
@tab 프로젝트
**프로젝트 설정 > 알림 > 알림 설정** 의 **사용자 지정 SMTP 구성** 카드에서 **SMTP 구성 만들기** 를 클릭합니다.
@tab 자체 호스팅 인스턴스
Admin Dashboard에서 **설정** 을 열고 사이드 메뉴의 **알림 > 이메일** 을 엽니다 (**알림** 은 처음에 접혀 있습니다). **이메일 서버 설정** 카드에서 **서버 편집** 을 클릭하고 **이메일 서버 유형** 을 `Custom SMTP` 로 설정합니다. 그런 다음 그 아래에 나타나는 **사용자 정의 이메일 및 SMTP 설정** 카드에서 **SMTP 구성 편집** 을 클릭합니다.
:::

### 서버 단계 채우기

**서버** 단계에서 **이름** (프로젝트 구성만), **호스트 이름**, **포트** (새 프로젝트 구성은 `587` 에서 시작합니다), **사용자 이름**, **비밀번호** 를 입력합니다.

### 추가 필드 확인하기

나머지는 모두 **서버** 단계 끝의 **추가 필드** 아래에 접혀 있습니다. 접혀 있는 동안에는 제목에 메일을 보내는 방식이 표시됩니다. 예: "메일은 SMTP로 전송되며 사용자 이름과 비밀번호로 로그인합니다. TLS가 필수입니다." 아래 표의 설정 중 하나를 바꿔야 할 때만 여세요.

### 보낸 사람 단계 채우기

**보낸 사람** 단계에서 메일이 오는 **보낸 사람 이메일** 과 **보낸 사람 이름** 을 입력합니다. 서버가 그 주소에서 보내는 것을 허용해야 합니다.

### 저장하고 테스트 이메일 보내기

구성을 저장합니다. 프로젝트 구성을 저장하면 그 행의 **테스트 이메일 보내기** 로 작동 여부를 확인할 수 있습니다. 여기에는 SMTP 구성을 추가할 권한이 필요합니다: **Project Owner**, **Project Admin**, 또는 사용자 지정 역할의 **Create SMTP Config** 와 **Read SMTP Config** 입니다. OneUptime Cloud에서는 구성을 추가할 때와 마찬가지로 **Growth** 요금제도 필요합니다. 그 밖의 사용자에게는 버튼이 잠기며, 도구 설명에 필요한 것이 표시됩니다.

테스트는 보낼 **이메일** 주소를 묻는데, 처음에는 본인 주소가 들어 있습니다. 메시지가 도착하는지 확인하세요.
:::

**추가 필드** 아래의 설정은 다음과 같습니다.

| 필드 | 하는 일 |
| --- | --- |
| **전송** | `SMTP` (기본값), 또는 SMTP AUTH가 꺼진 Microsoft 365 테넌트용 `Microsoft Graph`. Microsoft Graph를 고르면 호스트 이름, 포트, 사용자 이름, 비밀번호가 숨겨지고 OAuth 필드가 표시됩니다. |
| **TLS 필수** | 새 프로젝트 구성에서는 켜져 있습니다. 메일은 유효한 인증서가 있는 암호화된 연결로만 전송됩니다. 이 옵션이 꺼져 있으면 서버가 지원할 때만 메일이 암호화되며 인증서는 확인하지 않습니다. 포트 465는 항상 암호화됩니다. |
| **인증 유형** | `Username and Password` (기본값), `OAuth`, 또는 로그인이 필요 없는 릴레이용 `None`. |
| **OAuth 필드** | **OAuth 공급자 유형**, **OAuth 클라이언트 ID**, **OAuth 클라이언트 시크릿**, **OAuth 토큰 URL**, **OAuth 범위**. OAuth 또는 Microsoft Graph를 고르면 표시됩니다. |
| **설명** | 팀을 위한 메모 (프로젝트 구성만). |

**Microsoft Graph.** **추가 필드** 를 열고 **전송** 을 `Microsoft Graph` 로 설정한 뒤, **Mail.Send** 애플리케이션 권한이 있는 Azure 앱의 정보를 입력합니다: 클라이언트 ID와 클라이언트 시크릿, 토큰 URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`, 범위 `https://graph.microsoft.com/.default` 입니다. 메일은 **보낸 사람 이메일** 사서함에서 전송되며, 이 사서함은 테넌트에서 라이선스가 있는 사서함이어야 합니다.

> [!NOTE]
> OneUptime Cloud에서는 프로젝트의 메일 서버에 인터넷으로 연결할 수 있어야 합니다. 사설 주소나 내부 주소로 확인되는 호스트는 거부됩니다. 자체 호스팅 설치에서는 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` 가 `true` 가 아니면 사설 주소가 허용되지만, 루프백과 링크 로컬 주소는 항상 거부됩니다. 인스턴스 자체의 메일 서버는 이런 방식으로 확인하지 않습니다.

## OAuth 2.0 인증

OAuth 2.0을 사용하면 OneUptime이 비밀번호 없이 메일 서버에 로그인할 수 있으며, 기업용 메일 서비스는 점점 이를 요구하고 있습니다. OneUptime은 두 가지 OAuth 권한 부여 유형을 지원합니다.

- **Client Credentials**: Microsoft 365와 대부분의 OAuth 공급자가 사용합니다.
- **JWT Bearer**: Google Workspace 서비스 계정이 사용합니다.

```mermaid title="OneUptime이 OAuth로 로그인하는 과정"
sequenceDiagram
    participant O as OneUptime
    participant T as 토큰 URL
    participant M as 메일 서버
    O->>T: 액세스 토큰 요청
    T-->>O: 액세스 토큰
    Note over O: 캐시되며 만료 전에<br/>갱신됨
    O->>M: 토큰으로 로그인
    O->>M: 이메일 전송
```

**인증 유형** 과 OAuth 필드는 양식의 서버 단계에 있는 **추가 필드** 아래에 있습니다. OAuth로 로그인하려면 다음을 입력합니다.

| 필드 | 설명 |
| --- | --- |
| **호스트 이름** | SMTP 서버 주소 |
| **포트** | SMTP 포트 (보통 STARTTLS는 587, 암시적 TLS는 465) |
| **사용자 이름** | 메일을 보내는 사서함의 이메일 주소 |
| **인증 유형** | `OAuth` |
| **OAuth 공급자 유형** | Microsoft 365는 `Client Credentials`, Google Workspace는 `JWT Bearer` |
| **OAuth 클라이언트 ID** | OAuth 공급자의 애플리케이션 (클라이언트) ID (Google은 서비스 계정 이메일) |
| **OAuth 클라이언트 시크릿** | OAuth 공급자의 클라이언트 시크릿 (Google은 개인 키) |
| **OAuth 토큰 URL** | 공급자의 OAuth 토큰 엔드포인트 |
| **OAuth 범위** | SMTP 액세스를 허용하는 OAuth 범위 |

OneUptime은 OAuth 토큰을 캐시하고 만료되기 전에 자동으로 갱신합니다.

## Microsoft 365 구성

Microsoft 365 (Exchange Online) 에서 OAuth를 사용하려면 Microsoft Entra에 애플리케이션을 등록하고, SMTP로 메일을 보낼 권한을 주고, 메일을 보내는 사서함을 사용하도록 허용합니다.

:::steps
### Microsoft Entra에 애플리케이션 등록하기

1. [Microsoft Entra 관리 센터](https://entra.microsoft.com) 에 로그인합니다.
2. **Identity** > **Applications** > **App registrations** 로 이동해 **New registration** 을 클릭합니다.
3. 이름 (예: "OneUptime SMTP") 을 입력하고 "Accounts in this organizational directory only" 를 선택한 다음 **Redirect URI** 는 비워 둡니다.
4. **Register** 를 클릭합니다.

**Overview** 페이지에서 **Application (client) ID** (클라이언트 ID) 와 **Directory (tenant) ID** (토큰 URL용) 를 적어 둡니다.

### 클라이언트 시크릿 만들기

1. 앱 등록에서 **Certificates & secrets** 로 이동해 **New client secret** 을 클릭합니다.
2. 설명을 추가하고 만료 기간을 고른 다음 **Add** 를 클릭합니다.
3. **시크릿 값을 바로 복사하세요**: 다시 표시되지 않습니다.

### SMTP 권한 추가하기

1. **API permissions** 로 이동해 **Add a permission** 을 클릭합니다.
2. **APIs my organization uses** 를 선택한 다음 **Office 365 Exchange Online** 을 검색해 선택합니다.
3. **Application permissions** 를 선택하고 **SMTP.SendAsApp** 에 체크한 뒤 **Add permissions** 를 클릭합니다.
4. **Grant admin consent for [your organization]** 을 클릭합니다 (관리자 권한이 필요합니다).

### Exchange Online에 서비스 주체 등록하기

애플리케이션이 메일을 보내려면 먼저 Exchange Online에 서비스 주체를 등록하고, 메일을 보내는 사서함에 대한 액세스 권한을 주어야 합니다.

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> `Add-RecipientPermission` 이 아니라 `Add-MailboxPermission` 을 사용하세요. `Add-RecipientPermission` 은 받는 사람에 대한 `SendAs` 만 부여하므로, 서비스 주체가 OAuth로 SMTP를 통해 메일을 보내기에는 부족하며 인증 오류나 권한 오류로 전송이 실패합니다.

### OneUptime에서 SMTP 구성 만들기

다음 설정으로 SMTP 구성을 만들거나 편집하고, `<tenant-id>` 를 **Directory (tenant) ID** 로 바꿉니다.

| 필드 | 값 |
| --- | --- |
| 호스트 이름 | `smtp.office365.com` |
| 포트 | `587` |
| 사용자 이름 | 권한을 부여한 이메일 주소 (예: `sender@yourdomain.com`) |
| 인증 유형 | `OAuth` |
| OAuth 공급자 유형 | `Client Credentials` |
| OAuth 클라이언트 ID | **Application (client) ID** |
| OAuth 클라이언트 시크릿 | 클라이언트 시크릿 값 |
| OAuth 토큰 URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth 범위 | `https://outlook.office365.com/.default` |
| 보낸 사람 이메일 | 사용자 이름과 같음 |
| TLS 필수 | 켜짐 |

그런 다음 **테스트 이메일 보내기** 로 확인합니다.
:::

## Google Workspace 구성

Google Workspace에는 도메인 전체 위임이 있는 **서비스 계정** 이 필요하며, 이 계정이 도메인 사용자를 대신해 메일을 보냅니다. Google의 SMTP 서버는 Gmail에 대해 단순한 client credentials 흐름을 지원하지 않습니다.

### Google Workspace를 시작하기 전에

- Google Workspace 계정. 개인 Gmail 계정은 이를 지원하지 않습니다.
- Google Workspace 관리 콘솔에 대한 최고 관리자 액세스 권한.
- Google Cloud Console에 대한 액세스 권한.

:::steps
### Google Cloud 프로젝트 만들기

1. [Google Cloud Console](https://console.cloud.google.com) 로 이동합니다.
2. 프로젝트 선택 드롭다운을 클릭하고 **New Project** 를 선택합니다.
3. 프로젝트 이름을 입력하고 **Create** 를 클릭한 다음 새 프로젝트를 선택합니다.

### Gmail API 사용 설정하기

1. **APIs & Services** > **Library** 로 이동합니다.
2. "Gmail API" 를 검색하고 **Gmail API** 를 클릭한 다음 **Enable** 을 클릭합니다.

### 서비스 계정 만들기

1. **APIs & Services** > **Credentials** 로 이동합니다.
2. **Create Credentials** > **Service account** 를 클릭합니다.
3. 이름과 설명을 입력하고 **Create and Continue** 를 클릭한 뒤, 선택 단계는 건너뛰고 **Done** 을 클릭합니다.

### 서비스 계정 키 만들기

1. 방금 만든 서비스 계정을 클릭하고 **Keys** 탭으로 이동합니다.
2. **Add Key** > **Create new key** 를 클릭하고 **JSON** 을 선택한 다음 **Create** 를 클릭합니다.
3. 다운로드한 JSON 파일을 안전하게 보관하세요. 이 파일의 `client_email` 이 OAuth 클라이언트 ID이고, `private_key` 가 OAuth 클라이언트 시크릿입니다.

### 도메인 전체 위임 사용 설정하기

1. 서비스 계정 세부 정보에서 **Show Advanced Settings** 를 클릭합니다.
2. 숫자로 된 **Client ID** 를 적어 둡니다.
3. **Enable Google Workspace Domain-wide Delegation** 에 체크하고 **Save** 를 클릭합니다.

### Google Workspace 관리에서 서비스 계정 승인하기

1. [Google Workspace 관리 콘솔](https://admin.google.com) 에 로그인합니다.
2. **Security** > **Access and data control** > **API Controls** 로 이동해 **Manage Domain Wide Delegation** 을 클릭합니다.
3. **Add new** 를 클릭하고, 이전 단계의 숫자로 된 **Client ID** 를 입력한 다음 **OAuth Scopes** 에 `https://mail.google.com/` 을 입력합니다.
4. **Authorize** 를 클릭합니다.

위임이 적용되기까지 몇 분에서 최대 24시간이 걸릴 수 있습니다.

### Google Workspace용 SMTP 구성 만들기

다음 설정으로 SMTP 구성을 만들거나 편집합니다.

| 필드 | 값 |
| --- | --- |
| 호스트 이름 | `smtp.gmail.com` |
| 포트 | `587` |
| 사용자 이름 | 메일을 보낼 Google Workspace 이메일 주소 (예: `notifications@yourdomain.com`). 서비스 계정이 이 사용자를 대신합니다. |
| 인증 유형 | `OAuth` |
| OAuth 공급자 유형 | `JWT Bearer` |
| OAuth 클라이언트 ID | 서비스 계정 JSON의 `client_email` (예: `your-service@your-project.iam.gserviceaccount.com`) |
| OAuth 클라이언트 시크릿 | 서비스 계정 JSON의 `private_key` (`-----BEGIN PRIVATE KEY-----` 와 `-----END PRIVATE KEY-----` 를 포함한 키 전체) |
| OAuth 토큰 URL | `https://oauth2.googleapis.com/token` |
| OAuth 범위 | `https://mail.google.com/` |
| 보낸 사람 이메일 | 사용자 이름과 같음 |
| TLS 필수 | 켜짐 |

그런 다음 **테스트 이메일 보내기** 로 확인합니다.
:::

> [!IMPORTANT]
> Google (JWT Bearer) 의 **OAuth 클라이언트 ID** 는 숫자로 된 `client_id` 가 아니라 **서비스 계정 이메일** (`client_email`) 입니다. 서비스 계정은 **사용자 이름** 의 사용자를 대신해 메일을 보냅니다.

## 문제 해결

### Microsoft 365 오류

| 문제 | 해결 방법 |
| --- | --- |
| "Authentication unsuccessful" | 서비스 주체가 Exchange에 등록되어 있고 사서함 권한이 있는지 확인합니다 |
| "AADSTS700016: Application not found" | 클라이언트 ID가 올바르고 앱이 테넌트에 있는지 확인합니다 |
| "AADSTS7000215: Invalid client secret" | 새 클라이언트 시크릿을 만듭니다. 이전 시크릿이 만료되었을 수 있습니다 |
| "The mailbox is not enabled for this operation" | `Add-MailboxPermission` 을 실행해 사서함 액세스 권한을 부여합니다 |

### Google Workspace 오류

| 문제 | 해결 방법 |
| --- | --- |
| "invalid_grant" | 도메인 전체 위임이 제대로 구성되고 적용되었는지 확인합니다 |
| "unauthorized_client" | 클라이언트 ID가 Google Workspace 관리 콘솔에서 승인되었는지 확인합니다 |
| "access_denied" | 범위 `https://mail.google.com/` 이 승인되었는지 확인합니다 |
| "Domain policy has disabled third-party Drive apps" | Google Workspace 관리의 Security > API Controls에서 API 액세스를 사용 설정합니다 |

### 기타 문제

:::details "Cannot send email. Please check your SMTP config."
사용자 이름과 비밀번호로 로그인하거나 로그인 없이 쓰는 서버가 메일을 받지 않으면 **테스트 이메일 보내기** 에 이 메시지가 표시됩니다. **호스트 이름**, **포트**, **사용자 이름**, **비밀번호** 를 확인하세요. 서버가 TLS를 지원하지 않거나 인증서가 호스트 이름에 유효하지 않으면 **추가 필드** 에서 **TLS 필수** 를 끄고 다시 시도합니다. 서버 자체의 응답은 테스트와 함께 저장됩니다. **프로젝트 설정 > 알림 > 알림 로그** 의 **이메일** 탭을 열고 해당 행에서 **상태 메시지 보기** 를 선택하세요.
:::

:::details "Cannot send email with OAuth authentication"
OAuth 로그인이 실패했으며, 메시지 끝에 공급자가 반환한 오류가 붙어 있습니다. **OAuth 클라이언트 ID**, **OAuth 클라이언트 시크릿**, **OAuth 토큰 URL**, **OAuth 범위** 를 확인하고, 애플리케이션에 위의 권한이 있는지와 관리자 동의가 부여되었는지 확인하세요. Microsoft 365 테넌트에서 SMTP AUTH가 꺼져 있으면 대신 **전송** 을 `Microsoft Graph` 로 설정합니다.
:::

:::details "Microsoft Graph send failed"
**전송** 이 `Microsoft Graph` 인 구성에서 Graph가 메일을 받지 않으면 이 메시지가 표시되고, 이어서 Microsoft 자체의 오류가 나옵니다. 앱에 관리자 동의가 부여된 **Mail.Send** 애플리케이션 권한이 있는지, **OAuth 범위** 가 `https://graph.microsoft.com/.default` 인지, **보낸 사람 이메일** 이 테넌트에서 라이선스가 있는 사서함인지 확인하세요.
:::

:::details "SMTP server host … could not be reached"
OneUptime이 프로젝트의 메일 서버 연결을 거부했습니다. OneUptime Cloud에서는 확인되지 않거나 사설, 루프백, 링크 로컬 주소로 확인되는 호스트 이름이 이 메시지로 거부되며, 어떤 경우인지는 알려 주지 않습니다. 메일 서버의 공개 호스트 이름을 사용하세요. 자체 호스팅 설치이거나 IP 주소로 지정한 메일 서버라면 메시지에 이유가 대신 표시됩니다. **테스트 이메일 보내기** 는 OAuth 구성에서만 이 메시지를 보여 주며, 다른 구성에서는 알림 로그의 **이메일** 탭에서 **상태 메시지 보기** 로 찾을 수 있습니다.
:::

:::details 테스트 이메일이 도착하지 않음
**보낸 사람 이메일** 을 확인하세요. 서버가 그 주소에서 보내는 것을 허용해야 합니다. 그런 다음 받는 사람의 스팸 폴더와 메일 서버 로그에서 전송 시도를 찾아보세요.
:::

## 보안 모범 사례

- **시크릿을 정기적으로 교체하세요.** 클라이언트 시크릿이 만료되기 전에 교체하도록 알림을 설정합니다.
- **전용 자격 증명을 사용하세요.** 다른 애플리케이션과 공유하지 말고 OneUptime 전용 자격 증명을 만듭니다.
- **최소 권한을 부여하세요.** 전송에 필요한 것만 부여합니다: Microsoft는 **SMTP.SendAsApp**, Google은 범위 `https://mail.google.com/` 입니다.
- **사용 현황을 모니터링하세요.** 메일 로그와 OAuth 애플리케이션 로그인에서 평소와 다른 활동이 있는지 검토합니다.
- **시크릿을 안전하게 보관하세요.** 클라이언트 시크릿을 버전 관리에 커밋하지 마세요.

## 더 읽을거리

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## 다음 단계

:::cards
- [알림 요약](/docs/emails/notification-rollup): OneUptime이 소유자에게 몰리는 이메일을 어떻게 묶는지.
- [구독자 및 공지](/docs/status-pages/subscribers): 프로젝트의 SMTP 구성으로 상태 페이지 구독자에게 메일을 보냅니다.
:::
