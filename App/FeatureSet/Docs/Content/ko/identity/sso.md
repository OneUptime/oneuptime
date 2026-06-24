# SSO (Single Sign-On)

OneUptime는 엔터프라이즈 인증을 위한 SAML 2.0 기반 싱글 사인온(SSO)을 지원합니다. SSO를 통해 팀 구성원이 조직의 ID 공급자(IdP)를 사용하여 OneUptime에 로그인할 수 있어 중앙화된 액세스 관리와 향상된 보안을 제공합니다.

## 개요

SSO 통합은 다음과 같은 이점을 제공합니다:

- **중앙화된 인증**: 사용자가 기존 회사 자격 증명으로 로그인합니다
- **향상된 보안**: IdP의 다단계 인증 및 보안 정책을 활용합니다
- **간소화된 사용자 관리**: 기존 ID 관리 시스템에서 액세스를 관리합니다
- **비밀번호 피로 감소**: 사용자가 별도의 OneUptime 비밀번호를 기억할 필요가 없습니다

## SSO 설정

1. **프로젝트 설정으로 이동**

   - OneUptime 프로젝트로 이동합니다
   - **프로젝트 설정** > **인증** > **SSO**로 이동합니다

2. **SSO 구성 생성**

   - **SSO 생성**을 클릭합니다
   - SSO 구성의 **이름**을 입력합니다 (예: "Keycloak SAML" 또는 "Okta SAML")
   - ID 공급자의 **로그온 URL**을 입력합니다
   - ID 공급자의 **발급자** (엔티티 ID)를 입력합니다
   - ID 공급자의 **공개 인증서**를 붙여 넣습니다
   - **서명 알고리즘**을 선택합니다 (예: `RSA-SHA-256`)
   - **다이제스트 알고리즘**을 선택합니다 (예: `SHA256`)

3. **OneUptime SSO 메타데이터 가져오기**
   - 저장 후 **SSO 구성 보기** 버튼을 클릭합니다
   - **식별자 (엔티티 ID)**를 복사합니다 — IdP 구성에 필요합니다
   - **회신 URL (어설션 소비자 서비스 URL)**을 복사합니다 — IdP 구성에 필요합니다

## Keycloak SAML 구성

Keycloak은 널리 사용되는 오픈 소스 ID 및 액세스 관리 솔루션입니다. OneUptime의 SAML ID 공급자로 Keycloak을 구성하는 단계를 따르십시오.

### 전제 조건

- 구성된 렐름이 있는 실행 중인 Keycloak 인스턴스
- Keycloak와 OneUptime 모두에 대한 관리자 액세스
- SSO를 지원하는 OneUptime 계정

### 1단계: OneUptime SSO 구성

1. OneUptime 대시보드에 로그인합니다
2. **프로젝트 설정** > **인증** > **SSO**로 이동합니다
3. **SSO 생성**을 클릭하고 다음을 입력합니다:
   - **이름**: 설명적인 이름 (예: `my-project-oneuptime`)
   - **로그온 URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **발급자**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **인증서**: 아래 [2단계](#step-2-get-the-keycloak-certificate)를 참조하십시오
   - **서명 알고리즘**: `RSA-SHA-256`
   - **다이제스트 알고리즘**: `SHA256`
4. 구성을 저장합니다

### 2단계: Keycloak 인증서 가져오기

1. Keycloak에서 클라이언트 구성으로 이동합니다
2. **내보내기**를 클릭합니다 (또는 Keycloak 버전에 따라 **키** 탭으로 이동)
3. 내보낸 JSON 파일에서 이름에 `certificate`가 있는 키를 찾습니다
4. 인증서 값을 복사하여 다음 형식으로 OneUptime에 붙여 넣습니다:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### 3단계: Keycloak 클라이언트 구성

1. Keycloak에서 렐름의 **클라이언트**로 이동합니다
2. 새 클라이언트를 만들거나 기존 클라이언트를 편집합니다
3. **클라이언트 프로토콜**을 `saml`로 설정합니다
4. **클라이언트 ID**를 OneUptime의 **SSO 구성 보기**에서 **식별자 (엔티티 ID)** 값으로 설정합니다
5. **유효한 리디렉션 URI**를 OneUptime URL로 설정합니다
6. **루트 URL**을 OneUptime 기본 URL로 설정합니다
7. OneUptime의 **회신 URL (어설션 소비자 서비스 URL)**을 **어설션 소비자 서비스 POST 바인딩 URL** 필드에 붙여 넣습니다

### 4단계: Keycloak 클라이언트 설정 구성

1. **서명 키 구성**을 비활성화합니다 (키 탭 아래)
2. **이름 ID 형식**을 `email`로 설정합니다
3. Keycloak이 항상 이메일을 이름 ID로 전송하도록 **이름 ID 형식 강제** 옵션이 활성화되어 있는지 확인합니다

### 5단계: 구성 확인

1. Keycloak과 OneUptime 모두에서 모든 설정을 저장합니다
2. SSO를 사용하여 OneUptime에 로그인해 봅니다
3. Keycloak 로그인 페이지로 리디렉션된 후 인증 성공 시 OneUptime으로 돌아와야 합니다

### Keycloak 문제 해결

- **서명 오류로 로그인 실패**: `BEGIN CERTIFICATE` 및 `END CERTIFICATE` 줄을 포함하여 인증서가 올바르게 복사되었는지 확인합니다
- **이름 ID 오류**: Keycloak에서 **이름 ID 형식**이 `email`로 설정되어 있는지 확인합니다
- **리디렉션 루프**: **유효한 리디렉션 URI**와 **어설션 소비자 서비스 POST 바인딩 URL**이 올바르게 구성되어 있는지 확인합니다
- **인증서를 찾을 수 없음**: 올바른 렐름의 올바른 클라이언트에서 내보내고 있는지 확인합니다

---

## Microsoft Entra ID (이전 Azure AD / Active Directory) SAML 구성

Microsoft Entra ID는 Microsoft의 클라우드 기반 ID 및 액세스 관리 서비스입니다. OneUptime의 SAML ID 공급자로 Entra ID를 구성하는 단계를 따르십시오.

### 전제 조건

- Microsoft Entra ID 테넌트 (SAML SSO를 사용하는 엔터프라이즈 애플리케이션을 지원하는 모든 티어)
- Microsoft Entra ID와 OneUptime 모두에 대한 관리자 액세스
- SSO를 지원하는 OneUptime 계정

### 1단계: OneUptime SSO 구성

1. OneUptime 대시보드에 로그인합니다
2. **프로젝트 설정** > **인증** > **SSO**로 이동합니다
3. **SSO 생성**을 클릭하고 다음을 입력합니다:
   - **이름**: 설명적인 이름 (예: `Azure AD SAML`)
   - **로그온 URL**: [3단계](#step-3-copy-entra-id-saml-metadata-to-oneuptime)에서 Entra ID로부터 가져옵니다
   - **발급자**: [3단계](#step-3-copy-entra-id-saml-metadata-to-oneuptime)에서 Entra ID로부터 가져옵니다
   - **인증서**: [3단계](#step-3-copy-entra-id-saml-metadata-to-oneuptime)에서 Entra ID로부터 가져옵니다
   - **서명 알고리즘**: `RSA-SHA-256`
   - **다이제스트 알고리즘**: `SHA256`
4. **SSO 구성 보기**를 클릭하고 **식별자 (엔티티 ID)**와 **회신 URL (어설션 소비자 서비스 URL)**을 복사합니다 — Entra ID에 필요합니다

### 2단계: Microsoft Entra ID에서 엔터프라이즈 애플리케이션 생성

1. [Microsoft Entra 관리 센터](https://entra.microsoft.com)에 로그인합니다
2. **ID** > **애플리케이션** > **엔터프라이즈 애플리케이션**으로 이동합니다
3. **+ 새 애플리케이션**을 클릭합니다
4. **+ 자체 애플리케이션 만들기**를 클릭합니다
5. 이름을 입력합니다 (예: "OneUptime")
6. **갤러리에서 찾을 수 없는 다른 애플리케이션 통합 (비갤러리)**을 선택합니다
7. **만들기**를 클릭합니다

### 3단계: Entra ID에서 SAML SSO 구성

1. 새 엔터프라이즈 애플리케이션에서 **싱글 사인온**으로 이동합니다
2. 싱글 사인온 방법으로 **SAML**을 선택합니다
3. **기본 SAML 구성**에서 **편집**을 클릭하고 다음을 설정합니다:
   - **식별자 (엔티티 ID)**: OneUptime의 **SSO 구성 보기**에서 **식별자 (엔티티 ID)** 붙여 넣기
   - **회신 URL (어설션 소비자 서비스 URL)**: OneUptime의 **SSO 구성 보기**에서 **회신 URL** 붙여 넣기
4. **저장**을 클릭합니다
5. **SAML 인증서** 섹션에서:
   - **인증서 (Base64)** 다운로드
   - 다운로드된 인증서 파일을 텍스트 편집기로 열고 내용 복사
6. **OneUptime 설정** 섹션에서 다음을 복사합니다:
   - **로그인 URL** — OneUptime의 **로그온 URL**로 붙여 넣기
   - **Azure AD 식별자** — OneUptime의 **발급자**로 붙여 넣기
7. OneUptime으로 돌아가 인증서와 URL을 붙여 넣고 저장합니다

### 4단계: 사용자 속성 및 클레임 구성

1. SAML 구성 페이지에서 **속성 및 클레임**의 **편집**을 클릭합니다
2. 다음 클레임이 구성되어 있는지 확인합니다:

| 클레임 이름                                                          | 값                                        |
| -------------------------------------------------------------------- | ----------------------------------------- |
| `Unique User Identifier (Name ID)`                                   | `user.userprincipalname` 또는 `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail`                               |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`    | `user.givenname`                          |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`      | `user.surname`                            |

3. **이름 식별자 형식**을 `이메일 주소`로 설정합니다
4. **저장**을 클릭합니다

### 5단계: 사용자 및 그룹 할당

1. 엔터프라이즈 애플리케이션에서 **사용자 및 그룹**으로 이동합니다
2. **+ 사용자/그룹 추가**를 클릭합니다
3. SSO 액세스를 부여할 사용자 및/또는 그룹을 선택합니다
4. **할당**을 클릭합니다

### 6단계: 구성 확인

1. Entra ID와 OneUptime 모두에서 모든 설정을 저장합니다
2. SSO를 사용하여 OneUptime에 로그인해 봅니다
3. Microsoft 로그인 페이지로 리디렉션된 후 인증 성공 시 OneUptime으로 돌아와야 합니다

### Microsoft Entra ID 문제 해결

- **AADSTS700016 오류**: Entra ID의 식별자 (엔티티 ID)가 OneUptime과 일치하지 않음 — 두 값이 동일한지 확인합니다
- **인증서 오류**: **Base64** 인증서 (원시/이진 형식이 아님)를 다운로드했고 `BEGIN CERTIFICATE` / `END CERTIFICATE` 줄이 포함되어 있는지 확인합니다
- **사용자 할당 안 됨**: SSO로 로그인하기 전에 사용자를 엔터프라이즈 애플리케이션에 명시적으로 할당해야 합니다
- **이름 ID 불일치**: 이름 ID 클레임이 OneUptime의 사용자 이메일과 일치하는 이메일 주소로 설정되어 있는지 확인합니다

---

## Okta SAML 구성

Okta는 강력한 SAML SSO 기능을 제공하는 널리 사용되는 ID 플랫폼입니다. OneUptime의 SAML ID 공급자로 Okta를 구성하는 단계를 따르십시오.

### 전제 조건

- 관리자 액세스가 있는 Okta 조직
- SSO를 지원하는 OneUptime 계정

### 1단계: OneUptime SSO 구성

1. OneUptime 대시보드에 로그인합니다
2. **프로젝트 설정** > **인증** > **SSO**로 이동합니다
3. **SSO 생성**을 클릭하고 다음을 입력합니다:
   - **이름**: 설명적인 이름 (예: `Okta SAML`)
   - **로그온 URL**: [3단계](#step-3-copy-okta-saml-metadata-to-oneuptime)에서 Okta로부터 가져옵니다
   - **발급자**: [3단계](#step-3-copy-okta-saml-metadata-to-oneuptime)에서 Okta로부터 가져옵니다
   - **인증서**: [3단계](#step-3-copy-okta-saml-metadata-to-oneuptime)에서 Okta로부터 가져옵니다
   - **서명 알고리즘**: `RSA-SHA-256`
   - **다이제스트 알고리즘**: `SHA256`
4. **SSO 구성 보기**를 클릭하고 **식별자 (엔티티 ID)**와 **회신 URL (어설션 소비자 서비스 URL)**을 복사합니다 — Okta에 필요합니다

### 2단계: Okta에서 SAML 애플리케이션 생성

1. Okta 관리 콘솔에 로그인합니다
2. **애플리케이션** > **애플리케이션**으로 이동합니다
3. **앱 통합 만들기**를 클릭합니다
4. **SAML 2.0**을 선택하고 **다음**을 클릭합니다
5. **앱 이름**으로 "OneUptime"을 입력하고 **다음**을 클릭합니다
6. **SAML 설정** 섹션에서 다음을 구성합니다:
   - **싱글 사인온 URL**: OneUptime의 **SSO 구성 보기**에서 **회신 URL (어설션 소비자 서비스 URL)** 붙여 넣기
   - **대상 URI (SP 엔티티 ID)**: OneUptime의 **SSO 구성 보기**에서 **식별자 (엔티티 ID)** 붙여 넣기
   - **이름 ID 형식**: `EmailAddress` 선택
   - **애플리케이션 사용자 이름**: `Email` 선택
7. **다음**을 클릭한 후 **나는 내 앱을 추가하는 Okta 고객입니다**를 선택하고 **마침**을 클릭합니다

### 3단계: Okta SAML 메타데이터를 OneUptime에 복사

1. Okta 애플리케이션에서 **로그온** 탭으로 이동합니다
2. **SAML 서명 인증서** 섹션에서 활성 인증서를 찾고 **작업** > **IdP 메타데이터 보기**를 클릭합니다
3. 메타데이터 XML 또는 **로그온** 탭 세부 정보에서:
   - **로그온 URL** (Identity Provider Single Sign-On URL이라고도 함)을 복사하여 OneUptime의 **로그온 URL**로 붙여 넣기
   - **발급자** (Identity Provider Issuer라고도 함)를 복사하여 OneUptime의 **발급자**로 붙여 넣기
4. 서명 인증서 다운로드:
   - **SAML 서명 인증서** 섹션에서 활성 인증서에 대해 **작업** > **인증서 다운로드**를 클릭합니다
   - 다운로드된 `.cert` 파일을 텍스트 편집기로 열고 내용을 복사합니다
   - `BEGIN CERTIFICATE` 및 `END CERTIFICATE` 줄을 포함하여 OneUptime에 인증서를 붙여 넣습니다
5. OneUptime SSO 구성을 저장합니다

### 4단계: 속성 설명 구성 (선택 사항)

1. Okta 애플리케이션에서 **일반** 탭으로 이동합니다
2. **SAML 설정** 섹션에서 **편집**을 클릭하고 **다음**을 클릭하여 SAML 설정으로 이동합니다
3. **속성 설명** 섹션에서 다음을 추가합니다:

| 이름        | 값               |
| ----------- | ---------------- |
| `email`     | `user.email`     |
| `firstName` | `user.firstName` |
| `lastName`  | `user.lastName`  |

4. **다음**을 클릭한 후 **마침**을 클릭합니다

### 5단계: 사용자 및 그룹 할당

1. Okta 애플리케이션에서 **할당** 탭으로 이동합니다
2. **할당** > **사람에게 할당** 또는 **그룹에 할당**을 클릭합니다
3. SSO 액세스를 부여할 사용자 또는 그룹을 선택합니다
4. 각 선택에 대해 **할당**을 클릭한 후 **완료**를 클릭합니다

### 6단계: 구성 확인

1. Okta와 OneUptime 모두에서 모든 설정을 저장합니다
2. SSO를 사용하여 OneUptime에 로그인해 봅니다
3. Okta 로그인 페이지로 리디렉션된 후 인증 성공 시 OneUptime으로 돌아와야 합니다

### Okta 문제 해결

- **404 또는 잘못된 SSO URL**: Okta의 **싱글 사인온 URL**이 OneUptime의 **회신 URL**과 정확히 일치하는지 확인합니다
- **대상 불일치**: Okta의 **대상 URI**가 OneUptime의 **식별자 (엔티티 ID)**와 정확히 일치하는지 확인합니다
- **인증서 오류**: 비활성 인증서가 아닌 **활성** 서명 인증서에 대한 인증서를 다운로드했는지 확인합니다
- **사용자 할당 안 됨**: SSO로 로그인하기 전에 사용자를 Okta 애플리케이션에 할당해야 합니다
- **이름 ID 오류**: **이름 ID 형식**이 `EmailAddress`로 설정되어 있고 **애플리케이션 사용자 이름**이 `Email`로 설정되어 있는지 확인합니다

---

## 기타 ID 공급자

OneUptime의 SSO 구현은 SAML 2.0 프로토콜을 사용하며 호환 가능한 모든 ID 공급자와 함께 작동해야 합니다. 일반 구성 단계:

1. OneUptime에서 SSO 구성을 생성하고 **SSO 구성 보기** 버튼에서 **식별자 (엔티티 ID)**와 **회신 URL (어설션 소비자 서비스 URL)**을 기록합니다
2. ID 공급자에서 다음을 사용하여 SAML 애플리케이션을 생성합니다:
   - **어설션 소비자 서비스 URL / 회신 URL**: OneUptime SSO 구성에서
   - **엔티티 ID / 대상 URI**: OneUptime SSO 구성에서
   - **이름 ID 형식**: 이메일 주소
3. ID 공급자에서 다음을 OneUptime에 복사합니다:
   - **로그온 URL** (SSO 엔드포인트)
   - **발급자** (IdP의 엔티티 ID)
   - **공개 인증서** (X.509 서명 인증서)
4. **서명 알고리즘**을 `RSA-SHA-256`으로, **다이제스트 알고리즘**을 `SHA256`으로 설정합니다

## SSO 및 역할에 대한 참고사항

OneUptime은 현재 ID 공급자의 SAML 역할 매핑을 지원하지 않습니다. 역할 기반 액세스는 **프로젝트 설정** > **SSO** 설정 내에서 OneUptime에서 별도로 구성해야 하며, 여기서 SSO 사용자에게 기본 역할을 할당할 수 있습니다.
