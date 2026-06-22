# SMTP 구성

OneUptime은 세 가지 인증 방법을 통해 커스텀 SMTP 서버로 이메일 전송을 지원합니다:

- **사용자 이름 및 비밀번호** - 전통적인 SMTP 인증
- **OAuth 2.0** - Microsoft 365 및 Google Workspace를 위한 현대적 인증
- **없음** - 인증이 필요 없는 릴레이 서버용

이 가이드는 Microsoft 365 및 Google Workspace에 대한 OAuth 2.0 인증을 구성하는 방법을 다룹니다.

## OAuth 2.0 인증

OAuth 2.0은 특히 기본 인증을 비활성화한 엔터프라이즈 환경에서 이메일 서버에 인증하는 더 안전한 방법을 제공합니다. OneUptime은 두 가지 OAuth 부여 유형을 지원합니다:

- **클라이언트 자격 증명** - Microsoft 365 및 대부분의 OAuth 공급자에서 사용
- **JWT Bearer** - Google Workspace 서비스 계정에서 사용

### OAuth에 필요한 필드

OneUptime에서 OAuth 인증으로 SMTP를 구성할 때 다음이 필요합니다:

| 필드                  | 설명                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ |
| **호스트 이름**       | SMTP 서버 주소                                                                       |
| **포트**              | SMTP 포트 (일반적으로 STARTTLS의 경우 587, 암묵적 TLS의 경우 465)                    |
| **사용자 이름**       | 발송에 사용할 이메일 주소                                                            |
| **인증 유형**         | "OAuth" 선택                                                                         |
| **OAuth 공급자 유형** | Microsoft 365의 경우 "Client Credentials", Google Workspace의 경우 "JWT Bearer" 선택 |
| **클라이언트 ID**     | OAuth 공급자의 애플리케이션/클라이언트 ID (Google의 경우: 서비스 계정 이메일)        |
| **클라이언트 시크릿** | OAuth 공급자의 클라이언트 시크릿 (Google의 경우: 개인 키)                            |
| **토큰 URL**          | OAuth 토큰 엔드포인트 URL                                                            |
| **범위**              | SMTP 액세스에 필요한 OAuth 범위                                                      |

---

## Microsoft 365 구성

Microsoft 365/Exchange Online에서 OAuth를 사용하려면 Microsoft Entra(Azure AD)에 애플리케이션을 등록하고 적절한 권한을 구성해야 합니다.

### 1단계: Microsoft Entra에 애플리케이션 등록

1. [Microsoft Entra 관리 센터](https://entra.microsoft.com)에 로그인합니다
2. **ID** > **애플리케이션** > **앱 등록**으로 이동합니다
3. **새 등록**을 클릭합니다
4. 애플리케이션 이름을 입력합니다 (예: "OneUptime SMTP")
5. **지원되는 계정 유형**에서 "이 조직 디렉토리의 계정만"을 선택합니다
6. **리디렉션 URI**는 비워 둡니다 (클라이언트 자격 증명 흐름에는 필요하지 않음)
7. **등록**을 클릭합니다

등록 후 **개요** 페이지에서 다음 값을 기록합니다:

- **애플리케이션(클라이언트) ID** - 클라이언트 ID입니다
- **디렉터리(테넌트) ID** - 토큰 URL에 필요합니다

### 2단계: 클라이언트 시크릿 생성

1. 앱 등록에서 **인증서 및 시크릿**으로 이동합니다
2. **새 클라이언트 시크릿**을 클릭합니다
3. 설명을 추가하고 만료 기간을 선택합니다
4. **추가**를 클릭합니다
5. **시크릿 값을 즉시 복사하십시오** - 다시 표시되지 않습니다

### 3단계: SMTP API 권한 추가

1. **API 권한**으로 이동합니다
2. **권한 추가**를 클릭합니다
3. **조직에서 사용하는 API**를 선택합니다
4. **Office 365 Exchange Online**을 검색하고 선택합니다
5. **애플리케이션 권한**을 선택합니다
6. **SMTP.SendAsApp**을 찾아 체크합니다
7. **권한 추가**를 클릭합니다
8. **[조직]에 대한 관리자 동의 부여**를 클릭합니다 (관리자 권한 필요)

### 4단계: Exchange Online에서 서비스 주체 등록

애플리케이션이 이메일을 전송하려면 Exchange Online에서 서비스 주체를 등록하고 사서함 권한을 부여해야 합니다.

1. Exchange Online PowerShell 모듈을 설치합니다:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Exchange Online에 연결합니다:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. 서비스 주체를 등록합니다 (앱 등록이 아닌 **엔터프라이즈 애플리케이션**의 개체 ID 사용):

```powershell
# Microsoft Entra > 엔터프라이즈 애플리케이션 > 앱 > 개체 ID에서 개체 ID를 찾습니다
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. 특정 사서함으로 발송할 수 있도록 서비스 주체에 권한을 부여합니다:

```powershell
# 서비스 주체에 사서함 전체 액세스 권한 부여
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **참고:** `Add-RecipientPermission`이 아닌 `Add-MailboxPermission`을 사용하십시오. `Add-RecipientPermission`은 수신자에 대한 `SendAs`만 부여하며 서비스 주체가 OAuth로 SMTP를 통해 메일을 보내기에는 충분하지 않습니다 — 전송 시 인증/권한 오류가 발생합니다. 실제로 작동하는 명령은 `FullAccess`가 있는 `Add-MailboxPermission`입니다.

### 5단계: OneUptime에서 구성

OneUptime에서 다음 설정으로 SMTP 구성을 생성하거나 편집합니다:

| 필드              | 값                                                                |
| ----------------- | ----------------------------------------------------------------- |
| 호스트 이름       | `smtp.office365.com`                                              |
| 포트              | `587`                                                             |
| 사용자 이름       | 권한을 부여한 이메일 주소 (예: `sender@yourdomain.com`)           |
| 인증 유형         | `OAuth`                                                           |
| OAuth 공급자 유형 | `Client Credentials`                                              |
| 클라이언트 ID     | 1단계의 애플리케이션(클라이언트) ID                               |
| 클라이언트 시크릿 | 2단계의 시크릿 값                                                 |
| 토큰 URL          | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| 범위              | `https://outlook.office365.com/.default`                          |
| 발신자 이메일     | 사용자 이름과 동일                                                |
| 보안 (TLS)        | 활성화                                                            |

`<tenant-id>`를 1단계의 디렉터리(테넌트) ID로 교체합니다.

---

## Google Workspace 구성

Google Workspace는 사용자를 대신하여 이메일을 전송하기 위해 도메인 전체 위임이 있는 **서비스 계정**이 필요합니다. Google의 SMTP 서버는 Gmail의 직접 OAuth 클라이언트 자격 증명 흐름을 지원하지 않기 때문입니다.

### 전제 조건

- Google Workspace 계정 (일반 Gmail 불가 - 소비자 Gmail 계정은 이 기능을 지원하지 않음)
- Google Workspace 관리 콘솔에 대한 슈퍼 관리자 액세스
- Google Cloud 콘솔에 대한 액세스

### 1단계: Google Cloud 프로젝트 생성

1. [Google Cloud 콘솔](https://console.cloud.google.com)로 이동합니다
2. 프로젝트 드롭다운을 클릭하고 **새 프로젝트**를 선택합니다
3. 프로젝트 이름을 입력하고 **만들기**를 클릭합니다
4. 새 프로젝트를 선택합니다

### 2단계: Gmail API 활성화

1. **API 및 서비스** > **라이브러리**로 이동합니다
2. "Gmail API"를 검색합니다
3. **Gmail API**를 클릭한 다음 **사용 설정**을 클릭합니다

### 3단계: 서비스 계정 생성

1. **API 및 서비스** > **자격 증명**으로 이동합니다
2. **자격 증명 만들기** > **서비스 계정**을 클릭합니다
3. 서비스 계정의 이름과 설명을 입력합니다
4. **만들고 계속하기**를 클릭합니다
5. 선택적 단계는 건너뛰고 **완료**를 클릭합니다

### 4단계: 서비스 계정 키 생성

1. 방금 생성한 서비스 계정을 클릭합니다
2. **키** 탭으로 이동합니다
3. **키 추가** > **새 키 만들기**를 클릭합니다
4. **JSON**을 선택하고 **만들기**를 클릭합니다
5. 다운로드된 JSON 파일을 안전하게 저장합니다 - 여기에 포함된 내용:
   - `client_id` - 클라이언트 ID
   - `private_key` - 클라이언트 시크릿 (개인 키)

### 5단계: 도메인 전체 위임 활성화

1. 서비스 계정 세부 정보에서 **고급 설정 표시**를 클릭합니다
2. **클라이언트 ID** (숫자 ID)를 기록합니다
3. **Google Workspace 도메인 전체 위임 활성화**를 체크합니다
4. **저장**을 클릭합니다

### 6단계: Google Workspace 관리에서 서비스 계정 승인

1. [Google Workspace 관리 콘솔](https://admin.google.com)에 로그인합니다
2. **보안** > **액세스 및 데이터 제어** > **API 제어**로 이동합니다
3. **도메인 전체 위임 관리**를 클릭합니다
4. **새로 추가**를 클릭합니다
5. 5단계의 **클라이언트 ID**를 입력합니다
6. **OAuth 범위**에 `https://mail.google.com/`을 입력합니다
7. **승인**을 클릭합니다

참고: 위임이 전파되는 데 몇 분에서 24시간이 걸릴 수 있습니다.

### 7단계: OneUptime에서 구성

OneUptime에서 다음 설정으로 SMTP 구성을 생성하거나 편집합니다:

| 필드              | 값                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 호스트 이름       | `smtp.gmail.com`                                                                                                            |
| 포트              | `587`                                                                                                                       |
| 사용자 이름       | 발송에 사용할 Google Workspace 이메일 주소 (예: `notifications@yourdomain.com`). 이 사용자는 서비스 계정에 의해 가장됩니다. |
| 인증 유형         | `OAuth`                                                                                                                     |
| OAuth 공급자 유형 | `JWT Bearer`                                                                                                                |
| 클라이언트 ID     | 서비스 계정 JSON의 `client_email` (예: `your-service@your-project.iam.gserviceaccount.com`)                                 |
| 클라이언트 시크릿 | 서비스 계정 JSON의 `private_key` (`-----BEGIN PRIVATE KEY-----` 및 `-----END PRIVATE KEY-----` 포함한 전체 키)              |
| 토큰 URL          | `https://oauth2.googleapis.com/token`                                                                                       |
| 범위              | `https://mail.google.com/`                                                                                                  |
| 발신자 이메일     | 사용자 이름과 동일                                                                                                          |
| 보안 (TLS)        | 활성화                                                                                                                      |

**중요:** Google (JWT Bearer)의 경우 클라이언트 ID는 숫자 `client_id`가 아닌 **서비스 계정 이메일** (`client_email`)입니다. 서비스 계정은 사용자 이름 필드에 지정된 사용자를 가장하여 이메일을 전송합니다.

---

## 문제 해결

### Microsoft 365

| 문제                                            | 해결책                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| "Authentication unsuccessful"                   | Exchange에서 서비스 주체가 등록되어 있고 사서함 권한이 있는지 확인합니다 |
| "AADSTS700016: Application not found"           | 클라이언트 ID가 올바르고 앱이 테넌트에 존재하는지 확인합니다             |
| "AADSTS7000215: Invalid client secret"          | 클라이언트 시크릿을 재생성합니다 - 만료되었을 수 있습니다                |
| "The mailbox is not enabled for this operation" | `Add-MailboxPermission`을 실행하여 사서함에 액세스 권한을 부여합니다     |

### Google Workspace

| 문제                                                | 해결책                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| "invalid_grant"                                     | 도메인 전체 위임이 올바르게 구성되고 전파되었는지 확인합니다           |
| "unauthorized_client"                               | Google Workspace 관리 콘솔에서 클라이언트 ID가 승인되었는지 확인합니다 |
| "access_denied"                                     | `https://mail.google.com/` 범위가 승인되었는지 확인합니다              |
| "Domain policy has disabled third-party Drive apps" | Google Workspace 관리 > 보안 > API 제어에서 API 액세스를 활성화합니다  |

### 일반

- **구성 테스트**: OneUptime의 "테스트 이메일 전송" 버튼을 사용하여 설정을 확인합니다
- **로그 확인**: 자세한 오류 메시지에 대한 OneUptime 로그를 검토합니다
- **토큰 캐싱**: OneUptime은 OAuth 토큰을 캐시하고 만료 전에 자동으로 갱신합니다

---

## 보안 모범 사례

1. **정기적으로 시크릿 교체**: 만료 전에 클라이언트 시크릿을 교체하기 위한 캘린더 알림을 설정합니다
2. **전용 서비스 계정 사용**: 다른 애플리케이션과 공유하지 않고 OneUptime 전용 자격 증명을 생성합니다
3. **최소 권한 원칙**: 필요한 최소한의 권한만 부여합니다 (Microsoft의 경우 SMTP.SendAsApp, Google의 경우 mail.google.com 범위)
4. **사용량 모니터링**: 비정상적인 활동에 대한 이메일 로그 및 OAuth 애플리케이션 로그인을 검토합니다
5. **안전한 보관**: 클라이언트 시크릿을 버전 제어에 절대 커밋하지 마십시오

---

## 추가 리소스

### Microsoft 365

- [OAuth를 사용하여 IMAP, POP 또는 SMTP 연결 인증](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Microsoft ID 플랫폼에 애플리케이션 등록](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace

- [서버 간 애플리케이션에 OAuth 2.0 사용](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API 문서](https://developers.google.com/gmail/api)
- [XOAUTH2 프로토콜](https://developers.google.com/gmail/imap/xoauth2-protocol)
