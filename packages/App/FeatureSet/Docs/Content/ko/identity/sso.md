# SSO

SSO(Single Sign-On)를 사용하면 프로젝트 구성원이 조직의 ID 공급자(IdP)를 통해 SAML 2.0 또는 OpenID Connect로 OneUptime에 로그인할 수 있습니다. 액세스, 비밀번호, 다단계 인증을 한곳에서 관리하고, 프로젝트의 모든 사람에게 SSO를 필수로 지정할 수 있습니다.

> [!NOTE]
> **에디션:** "Require SSO to sign in"을 포함한 SSO는 모든 OneUptime 에디션에 포함됩니다. 자체 호스팅 설치에서는 Community Edition에서 라이선스 없이 사용할 수 있습니다. OneUptime Cloud에서는 **Scale** 플랜 이상에서 사용할 수 있습니다. 각 에디션에 포함된 기능은 [엔터프라이즈 에디션](/docs/self-hosted/enterprise)을 참고하세요.

:::cards
- [SAML 공급자 설정](#sso-설정): OneUptime에서 만들고 IdP에 URL 두 개를 넘겨줍니다.
- [ID 공급자별 가이드](#id-공급자별-가이드): Keycloak, Microsoft Entra ID, Okta를 단계별로 안내합니다.
- [OpenID Connect](#openid-connect-oidc): 대신 OIDC 앱으로 로그인합니다.
- [SSO 필수](#프로젝트에-sso-필수-지정): SSO를 프로젝트에 들어오는 유일한 방법으로 만듭니다.
:::

## SAML 로그인 작동 방식

SAML 공급자는 하나의 프로젝트를 ID 공급자의 애플리케이션 하나에 연결합니다. 로그인하는 사람은 OneUptime의 **SSO로 로그인** 페이지에서 프로젝트를 고르고, IdP에서 로그인한 뒤 로그인된 상태로 돌아옵니다.

```mermaid title="SAML 로그인 단계별 흐름"
sequenceDiagram
    actor U as 사용자
    participant O as OneUptime
    participant I as ID 공급자
    U->>O: SSO로 로그인,<br/>프로젝트 선택
    O->>I: 로그인 URL로 SAML 요청
    I->>U: 로그인 페이지
    U->>I: 자격 증명과 MFA
    I->>O: Reply URL로 서명된 어설션
    Note over O: 서명과 발급자를 확인하고<br/>Name ID에서 이메일을 읽음
    O->>U: 프로젝트에 로그인됨
```

OneUptime은 IdP가 보내는 어설션에서 몇 가지만 읽습니다.

| 어설션의 항목 | OneUptime이 하는 일 |
| --- | --- |
| 서명 | 공급자의 **공개 인증서**와 대조합니다. 응답은 서명되어 있어야 하며 암호화되어 있으면 안 됩니다. |
| Issuer | 공급자의 **발급자**와 정확히 일치해야 합니다. |
| Audience | 공급자의 **식별자(Entity ID)** 값이어야 합니다. IdP가 다른 애플리케이션용으로 만든 응답은 거부됩니다. |
| Recipient 및 Destination | 공급자의 **회신 URL**, 곧 응답을 보낸 주소여야 합니다. |
| `NotBefore` 및 `NotOnOrAfter` | 응답은 이 값들이 허용하는 동안에만, 그리고 발급 후 10분 이내에만 받아들여지며, 서로 맞지 않는 시계를 위해 3분의 여유가 있습니다. |
| Name ID | 그 사람의 이메일 주소입니다. 유효한 이메일 주소여야 합니다. |
| 이름 특성 | 그 사람의 이름으로, OneUptime이 계정을 만들 때 사용합니다. 표시 이름(`displayName` 또는 `http://schemas.microsoft.com/identity/claims/displayname`)이나 이름과 성(`firstName`과 `lastName`, 또는 Microsoft Entra ID가 기본으로 보내는 `givenname` 및 `surname` 클레임)입니다. 선택 사항입니다. |
| `http://schemas.microsoft.com/identity/claims/objectidentifier` | 그 사람의 개체 ID로, Microsoft Entra ID가 기본으로 보냅니다. 공급자를 통한 첫 로그인에서 계정이 이 개체 ID에 연결되며, 이후 계정의 이메일 주소를 다른 개체 ID와 함께 보내는 로그인은 거부됩니다. 선택 사항입니다. |

각 응답으로는 한 번만 로그인할 수 있습니다. 로그인한 뒤 브라우저에서 뒤로 가는 등으로 다시 보낸 응답은 거부됩니다. 다시 로그인하세요.

처음 로그인하는 사람은 공급자의 **팀**에 합류하며, 이 팀이 그 사람이 할 수 있는 일을 결정합니다. [SSO 사용자의 역할과 팀](#sso-사용자의-역할과-팀)을 참고하세요.

> [!NOTE]
> OneUptime Cloud에서는 누군가가 프로젝트의 SAML 또는 OIDC 공급자로 그 프로젝트에 처음 로그인할 때, OneUptime이 바로 로그인시키는 대신 이메일로 링크를 보냅니다. 그 사람은 링크를 열어 프로젝트의 SSO(Single Sign-On)가 자신을 로그인시켜도 된다고 확인한 뒤 로그인을 계속합니다. 링크는 24시간 동안 유효합니다. 이 과정은 프로젝트마다 한 번 진행되며, 프로젝트를 떠났다가 돌아오면 다시 진행됩니다. 초대한 사람의 로그인을 SSO가 관리하면, 이미 OneUptime 계정이 있든 없든 이런 이메일은 가지 않습니다. 초대로 열리는 페이지에서 프로젝트의 공급자 중 하나를 고르면, 초대 링크가 이미 그 사람의 메일함임을 증명했으므로 바로 로그인됩니다. 자체 호스팅 설치에서는 바로 로그인됩니다. OneUptime Cloud에서는 바로 로그인되지 않는 모든 로그인이 주소에 계정이 있든 없든 같은 응답을 받습니다. 아직 계정이 없는 사람도 같은 이메일을 받으며, 확인하면 계정이 만들어집니다. 차단된 계정이나 OneUptime 관리자는 이메일을 받지 않습니다. 자체 호스팅 설치에서는 대신 그 둘을 같은 메시지로 거부합니다.

OneUptime Cloud에서는 SSO로 프로젝트에 참여한 사람도 초대한 사람과 마찬가지로 좌석을 사용합니다. 플랜의 좌석 수가 정해져 있고 모두 사용 중이면, 좌석이 빌 때까지 새로운 사람은 SSO로 참여할 수 없습니다.

## SSO 설정

SSO 공급자를 추가할 권한(**프로젝트 소유자**, **프로젝트 관리자** 또는 **Create Project SSO**)이 필요하며, OneUptime Cloud에서는 **Scale** 플랜도 필요합니다. ID 공급자 쪽 설정은 [ID 공급자별 가이드](#id-공급자별-가이드)를 참고하세요.

:::steps
1. **프로젝트 설정으로 이동**

   - OneUptime 프로젝트로 이동합니다
   - **프로젝트 설정** > **보안** > **SSO**로 이동합니다

2. **SSO 구성 만들기**

   - **SAML 공급자 추가**를 클릭합니다
   - SSO 구성의 **이름**을 입력합니다(예: "Keycloak SAML" 또는 "Okta SAML")
   - ID 공급자의 **로그인 URL**을 입력합니다
   - ID 공급자의 **발급자**(엔티티 ID)를 입력합니다
   - ID 공급자의 **공개 인증서**를 붙여 넣습니다
   - **로그인** 단계에서 **팀**은 프로젝트의 멤버 팀으로 시작합니다. 처음 로그인하는 사람은 이 팀에 합류합니다. 내가 다른 사람을 초대할 수 있는 팀만 허용됩니다. 내가 가진 것보다 더 많은 액세스 권한을 주는 팀은 **팀** 아래에 표시됩니다
   - 나머지는 **추가 필드**에 이미 채워져 있습니다. **서명 방법**(`RSA-SHA256`), **다이제스트 방법**(`SHA256`), 설명("Sign in with"와 이름)입니다. ID 공급자에서 필요한 경우에만 변경하세요

3. **OneUptime SSO 메타데이터 가져오기**
   - 저장하면 **SSO 구성** 대화 상자가 열립니다. **SSO 구성 보기** 버튼으로 다시 열 수 있습니다
   - **식별자(Entity ID)** 값을 복사합니다. 예를 들면 `https://oneuptime.com/<project-id>/<provider-id>`이며, IdP 구성에 필요합니다
   - **회신 URL(Assertion Consumer Service URL)** 값을 복사합니다. 예를 들면 `https://oneuptime.com/identity/idp-login/<project-id>/<provider-id>`이며, IdP 구성에 필요합니다
   - 새 공급자는 꺼진 상태로 시작합니다. IdP에 이 두 값을 등록한 후 공급자를 편집하여 **활성화됨**을 켜세요

4. **공급자 테스트**
   - **SSO 로그인 링크** 카드의 링크를 열고, 열리는 페이지에서 공급자를 고릅니다. ID 공급자의 로그인 페이지로 이동했다가 로그인된 상태로 OneUptime에 돌아옵니다
   - 제대로 작동하면 프로젝트에 [SSO를 필수로 지정](#프로젝트에-sso-필수-지정)할 수 있습니다
:::

## ID 공급자별 가이드

사용하는 ID 공급자를 고르세요. 각 가이드는 IdP의 값을 가져와 OneUptime에서 공급자를 만든 다음, OneUptime의 **식별자(Entity ID)** 값과 **회신 URL** 값을 IdP에 넘겨줍니다.

:::tabs
@tab Keycloak
Keycloak은 널리 쓰이는 오픈 소스 ID 및 액세스 관리 솔루션입니다. 렐름이 있는 실행 중인 Keycloak 인스턴스와 Keycloak, OneUptime 모두에 대한 관리자 액세스가 필요합니다.

:::steps
1. **렐름의 값 모으기**

   - **로그인 URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **발급자**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **인증서**: 렐름의 서명 인증서입니다. `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml/descriptor`를 열어 `X509Certificate` 값을 복사하거나, **Realm settings** > **Keys**를 열고 RS256 키의 **Certificate**를 클릭합니다

   Keycloak 17 이상에서는 이 URL에 `/auth` 접두사가 없습니다. 인증서는 다음과 같이 전용 줄 사이에 넣습니다.

   ```text
   -----BEGIN CERTIFICATE-----
   MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
   -----END CERTIFICATE-----
   ```

2. **OneUptime에서 공급자 만들기**

   **프로젝트 설정** > **보안** > **SSO**로 이동하여 **SAML 공급자 추가**를 클릭하고 다음을 입력합니다.
   - **이름**: 알아보기 쉬운 이름(예: `my-project-oneuptime`)
   - **로그인 URL**과 **발급자**: 위의 값
   - **공개 인증서**: 전용 `BEGIN CERTIFICATE` 줄과 `END CERTIFICATE` 줄 사이에 넣은 인증서
   - **서명 방법**과 **다이제스트 방법**: **추가 필드**에 이미 설정되어 있습니다(`RSA-SHA256`과 `SHA256`)

   저장한 다음, 열리는 대화 상자에서 **식별자(Entity ID)** 값과 **회신 URL(Assertion Consumer Service URL)** 값을 복사합니다.

3. **Keycloak 클라이언트 만들기**

   Keycloak에서 렐름의 **Clients**를 열고 클라이언트를 만들거나 기존 클라이언트를 편집합니다.
   - **Client Protocol**(클라이언트 유형): `saml`
   - **Client ID**: OneUptime의 **식별자(Entity ID)** 값
   - **Root URL**과 **Valid Redirect URIs**: OneUptime URL
   - **Assertion Consumer Service POST Binding URL**: OneUptime의 **회신 URL(Assertion Consumer Service URL)** 값

4. **클라이언트 설정 조정**

   - **Name ID Format**을 `email`로 설정하고 **Force Name ID Format**을 켜서 Keycloak이 항상 이메일을 Name ID로 보내도록 합니다
   - 클라이언트의 **Keys** 탭에서 **Client signature required**(**Signing keys config** 안)를 끕니다. OneUptime은 로그인 요청에 서명하지 않습니다

5. **공급자를 켜고 테스트**

   OneUptime에서 공급자를 편집하여 **활성화됨**을 켠 다음, **SSO 로그인 링크** 카드의 링크를 열고 공급자를 고릅니다. Keycloak 로그인 페이지로 이동했다가 OneUptime으로 돌아와야 합니다.
:::
@tab Microsoft Entra ID
Microsoft Entra ID(이전 이름 Azure AD / Active Directory)는 Microsoft의 클라우드 ID 서비스입니다. SAML SSO를 사용하는 엔터프라이즈 애플리케이션을 지원하는 테넌트와 Entra ID, OneUptime 모두에 대한 관리자 액세스가 필요합니다. OneUptime Cloud에서는 Microsoft Entra 애플리케이션 갤러리에 OneUptime이 있으면 그곳에서 추가하세요. OneUptime이 읽는 클레임과 OneUptime URL의 패턴이 미리 설정되어 있습니다.

:::steps
1. **Entra ID에서 엔터프라이즈 애플리케이션 만들기**

   - [Microsoft Entra admin center](https://entra.microsoft.com)에 로그인합니다
   - **Identity** > **Applications** > **Enterprise applications**로 이동하여 **+ New application**을 클릭합니다
   - 갤러리에서 추가하는 경우: OneUptime을 검색하여 선택하고 **Create**를 클릭합니다
   - 그 밖의 경우: **+ Create your own application**을 클릭하고, 이름(예: "OneUptime")을 입력한 다음 **Integrate any other application you don't find in the gallery (Non-gallery)** 옵션을 선택하고 **Create**를 클릭합니다

2. **Entra ID의 SAML 값 복사**

   - 애플리케이션에서 **Single sign-on**으로 이동하여 **SAML**을 선택합니다
   - **SAML Certificates**에서 **Certificate (Base64)** 파일을 다운로드하고, 텍스트 편집기로 열어 내용을 복사합니다
   - **Set up OneUptime**에서 **Login URL**과 **Microsoft Entra Identifier**(이전 테넌트에서는 **Azure AD Identifier**)를 복사합니다

3. **OneUptime에서 공급자 만들기**

   **프로젝트 설정** > **보안** > **SSO**로 이동하여 **SAML 공급자 추가**를 클릭하고 다음을 입력합니다.
   - **이름**: 알아보기 쉬운 이름(예: `Azure AD SAML`)
   - **로그인 URL**: **Login URL**
   - **발급자**: **Microsoft Entra Identifier**
   - **공개 인증서**: `BEGIN CERTIFICATE` 줄과 `END CERTIFICATE` 줄을 포함한 Base64 인증서
   - **서명 방법**과 **다이제스트 방법**: **추가 필드**에 이미 설정되어 있습니다(`RSA-SHA256`과 `SHA256`)

   저장한 다음, 열리는 대화 상자에서 **식별자(Entity ID)** 값과 **회신 URL(Assertion Consumer Service URL)** 값을 복사합니다.

4. **Entra ID에 OneUptime의 URL 넘겨주기**

   **Basic SAML Configuration**에서 **Edit**를 클릭하고 다음을 설정합니다.
   - **Identifier (Entity ID)**: OneUptime의 **식별자(Entity ID)** 값
   - **Reply URL (Assertion Consumer Service URL)**: OneUptime의 **회신 URL** 값

   **Save**를 클릭합니다.

5. **이메일을 Name ID로 보내기**

   **Attributes & Claims**에서 **Edit**를 클릭합니다. 갤러리에서 추가한 애플리케이션에는 아래 항목이 이미 설정되어 있으니 확인만 하세요.
   - **Unique User Identifier (Name ID)** 항목을 사용자의 이메일 주소로 설정합니다. `user.mail`이나, 이메일 주소인 경우 `user.userprincipalname`을 사용합니다
   - **Name identifier format**을 `Email address`로 설정합니다
   - Entra ID의 기본 클레임은 그대로 두세요. 새 계정은 `givenname`과 `surname`에서 그 사람의 이름을 가져오고, 계정은 그 사람의 개체 ID인 `objectidentifier`에 연결됩니다. 선택적으로, 이름이 `http://schemas.microsoft.com/identity/claims/displayname`이고 원본 특성이 `user.displayname`인 클레임을 추가하면 새 계정에 대신 표시 이름이 들어갑니다. OneUptime은 다른 클레임을 무시합니다

6. **사용자와 그룹 할당**

   애플리케이션의 **Users and groups**에서 **+ Add user/group**을 클릭하고, SSO 액세스를 줄 사용자와 그룹을 선택한 다음 **Assign**을 클릭합니다.

7. **공급자를 켜고 테스트**

   OneUptime에서 공급자를 편집하여 **활성화됨**을 켠 다음, **SSO 로그인 링크** 카드의 링크를 열고 공급자를 고릅니다. Microsoft 로그인 페이지로 이동했다가 OneUptime으로 돌아와야 합니다.
:::
@tab Okta
Okta는 SAML SSO를 지원하는 널리 쓰이는 ID 플랫폼입니다. 관리자 액세스가 있는 Okta 조직과 OneUptime에 대한 관리자 액세스가 필요합니다. OneUptime Cloud에서는 Okta Integration Network에 OneUptime이 있으면 그곳에서 추가하세요. 이 애플리케이션을 쓰면 OneUptime의 **SSO로 로그인** 페이지와 Okta 대시보드 모두에서 로그인할 수 있고, 처음 로그인할 때 계정이 만들어지며, OneUptime의 URL 대신 ID 두 개만 입력하면 됩니다.

:::steps
1. **Okta에 OneUptime 추가**

   - Okta Admin Console에서 **Applications** > **Applications**로 이동합니다
   - Okta Integration Network에서 추가하는 경우: **Browse App Catalog**를 클릭하고 OneUptime을 검색한 다음 **Add Integration**을 클릭합니다. Okta는 **OneUptime Project ID**와 **OneUptime SSO Provider ID**를 묻지만, 이 시점에는 아직 OneUptime에서 이 값을 확인할 수 없습니다. 우선 둘 다 `0`을 입력하세요. 4단계에서 바꿉니다. **Done**을 클릭하고 2단계로 넘어갑니다
   - 그 밖의 경우: **Create App Integration**을 클릭하고 **SAML 2.0**을 선택한 다음 **Next**를 클릭하고, **App name**에 "OneUptime"을 입력한 다음 **Next**를 클릭합니다
   - Okta는 자신의 URL을 보여 주기 전에 OneUptime의 URL을 묻습니다. 우선 OneUptime 주소(예: `https://oneuptime.com`)를 **Single sign-on URL** 필드와 **Audience URI (SP Entity ID)** 필드에 입력하세요. 두 값 모두 4단계에서 바꿉니다
   - **Name ID format**을 `EmailAddress`로, **Application username**을 `Email`로 설정합니다
   - **Next**를 클릭하고 **I'm an Okta customer adding an internal app**을 선택한 다음 **Finish**를 클릭합니다

2. **Okta의 SAML 값 복사**

   애플리케이션의 **Sign On** 탭에 있는 **SAML Signing Certificates**에서 활성 인증서를 찾습니다.
   - **Actions** > **View IdP metadata**를 클릭하고 **로그인 URL**(Identity Provider Single Sign-On URL)과 **발급자**(Identity Provider Issuer)를 복사합니다
   - **Actions** > **Download certificate**를 클릭하고 `.cert` 파일을 텍스트 편집기로 열어 내용을 복사합니다

3. **OneUptime에서 공급자 만들기**

   **프로젝트 설정** > **보안** > **SSO**로 이동하여 **SAML 공급자 추가**를 클릭하고 다음을 입력합니다.
   - **이름**: 알아보기 쉬운 이름(예: `Okta SAML`)
   - **로그인 URL**과 **발급자**: Okta의 값
   - **공개 인증서**: `BEGIN CERTIFICATE` 줄과 `END CERTIFICATE` 줄을 포함한 인증서
   - **서명 방법**과 **다이제스트 방법**: **추가 필드**에 이미 설정되어 있습니다(`RSA-SHA256`과 `SHA256`)

   저장한 다음, 열리는 대화 상자에서 **식별자(Entity ID)** 값과 **회신 URL(Assertion Consumer Service URL)** 값을 복사합니다.

4. **Okta에 OneUptime의 URL 넘겨주기**

   Okta Integration Network에서 추가한 애플리케이션이라면 **General** 탭의 **App Settings**에서 **Edit**를 클릭하고 다음을 설정합니다.
   - **OneUptime Project ID**와 **OneUptime SSO Provider ID**: OneUptime의 **식별자(Entity ID)** 값인 `https://oneuptime.com/<project-id>/<provider-id>`에 들어 있는 두 ID

   **Save**를 클릭하고, **Sign On** 탭에서 **Application username format**이 `Email`인지 확인합니다.

   직접 만든 애플리케이션이라면 **General** 탭에서 **SAML Settings**의 **Edit**와 **Next**를 클릭한 다음 다음을 설정합니다.
   - **Single sign-on URL**: OneUptime의 **회신 URL(Assertion Consumer Service URL)** 값
   - **Audience URI (SP Entity ID)**: OneUptime의 **식별자(Entity ID)** 값

   선택적으로, 이름이 `firstName`이고 값이 `user.firstName`인 attribute statement와 이름이 `lastName`이고 값이 `user.lastName`인 attribute statement를 추가하면 새 계정에 그 사람의 이름이 들어갑니다. **Next**를 클릭한 다음 **Finish**를 클릭합니다.

5. **사람 할당**

   **Assignments** 탭에서 **Assign** > **Assign to People** 또는 **Assign to Groups**를 클릭하고, SSO 액세스를 줄 사람을 선택하여 각각 **Assign**을 클릭한 다음 **Done**을 클릭합니다.

6. **공급자를 켜고 테스트**

   OneUptime에서 공급자를 편집하여 **활성화됨**을 켠 다음, **SSO 로그인 링크** 카드의 링크를 열고 공급자를 고릅니다. Okta 로그인 페이지로 이동했다가 OneUptime으로 돌아와야 합니다.
:::
@tab 기타
OneUptime의 SSO는 SAML 2.0을 사용하며 규격을 준수하는 모든 ID 공급자와 함께 작동합니다.

:::steps
1. ID 공급자의 **로그인 URL**(SSO 엔드포인트), **발급자**(엔티티 ID), **공개 인증서**(X.509 서명 인증서)를 가져옵니다. 애플리케이션을 만들어야만 IdP가 이 값을 보여 준다면, OneUptime 주소를 임시 URL로 사용해 애플리케이션을 만드세요.
2. OneUptime에서 이 값으로 공급자를 만들고, **SSO 구성** 대화 상자(또는 **SSO 구성 보기**)에서 **식별자(Entity ID)** 값과 **회신 URL(Assertion Consumer Service URL)** 값을 복사합니다.
3. ID 공급자의 SAML 애플리케이션에서 **Assertion Consumer Service URL / Reply URL**과 **Entity ID / Audience URI**를 OneUptime의 값으로, **Name ID Format**을 이메일 주소로 설정합니다.
4. **서명 방법**(`RSA-SHA256`)과 **다이제스트 방법**(`SHA256`)은 **추가 필드**에 이미 설정되어 있습니다. ID 공급자가 다른 방식으로 서명하는 경우에만 변경하세요
5. 공급자의 **활성화됨**을 켜고 **SSO 로그인 링크** 카드의 링크로 테스트합니다.
:::
:::

## OpenID Connect (OIDC)

프로젝트는 Google Workspace, Okta, Microsoft Entra ID, Auth0, Keycloak 같은 OpenID Connect 공급자로도 로그인할 수 있습니다. OIDC 공급자를 추가할 권한(**프로젝트 소유자**, **프로젝트 관리자** 또는 **Create Project OIDC**)이 필요하며, OneUptime Cloud에서는 **Scale** 플랜도 필요합니다.

:::steps
1. ID 공급자에 PKCE를 사용하는 인증 코드 흐름을 쓸 수 있는 앱(OIDC 클라이언트)을 등록하고, 그 앱의 **발급자 URL**, **클라이언트 ID**, **클라이언트 시크릿**을 복사합니다.
2. OneUptime에서 **프로젝트 설정** > **보안** > **SSO**로 이동하여 SAML 공급자 아래의 **OIDC 공급자 추가**를 클릭합니다.
3. **이름**(로그인 페이지에 표시되는 이름), **발급자 URL**, **클라이언트 ID**, **클라이언트 시크릿**을 입력합니다. **발급자 URL**에 공급자의 검색 URL을 붙여 넣어도 됩니다.
4. **로그인** 단계에서 **팀**은 프로젝트의 멤버 팀으로 시작합니다. 처음 로그인하는 사람은 이 팀에 합류합니다. 나머지는 **추가 필드**에 이미 채워져 있습니다. **검색 URL**(발급자 뒤에 `/.well-known/openid-configuration`을 붙인 값), **범위**(`openid email profile`), `email`과 `name` 클레임 이름, 설명("Sign in with"와 이름)입니다. 공급자에서 필요한 경우에만 변경하세요. 내가 다른 사람을 초대할 수 있는 팀만 허용됩니다. 내가 가진 것보다 더 많은 액세스 권한을 주는 팀은 **팀** 아래에 표시됩니다.
5. 저장합니다. **OIDC 구성** 대화 상자가 열리고 **Redirect URI**가 표시됩니다. 이 값을 앱의 허용된 리디렉션 URI에 추가하세요. 새 공급자는 꺼진 상태로 시작하므로, 그다음 공급자를 편집하여 **활성화됨**을 켭니다.
6. 프로젝트에 SSO를 필수로 지정하기 전에 **SSO 로그인 링크** 카드의 링크를 열고 공급자를 골라 그 공급자로 로그인해 보세요.
:::

## ID 공급자에서도 로그아웃

OneUptime에서 로그아웃해도 ID 공급자에는 로그인된 상태로 남습니다. 그래서 NOC 화면이나 키오스크 같은 공용 컴퓨터에서는 다음에 로그인 페이지에서 그 공급자를 고른 사람이 떠난 사람으로 들어가게 됩니다. OneUptime에서 로그아웃할 때 공급자의 세션도 끝내려면 SAML 또는 OIDC 공급자의 **추가 필드**에서 **ID 공급자에서도 로그아웃**을 켜세요. 기본값은 꺼짐입니다. 개인 노트북에서는 그 공급자를 쓰는 다른 모든 앱에서도 로그아웃되기 때문입니다. 켠 뒤 브라우저로 로그인한 사람에게 적용되며, 모바일 앱은 OneUptime에서만 로그아웃합니다.

:::tabs
@tab SAML
ID 공급자의 로그아웃 URL을 **추가 필드**에서 공급자의 **로그아웃 URL**로 입력하세요. 이 값이 없으면 스위치를 켤 수 없습니다. 그런 다음 **SSO 구성** 대화 상자의 **단일 로그아웃 URL**과, OneUptime이 로그아웃 요청에 서명하는 인증서를 ID 공급자에 등록하세요. 인증서는 같은 대화 상자의 **서명 인증서 다운로드**에서 받을 수 있습니다.

| ID 공급자 | 로그아웃 URL | 단일 로그아웃 URL과 인증서를 넣는 곳 |
| --- | --- | --- |
| Okta | **Sign On** 탭의 **View SAML setup instructions**에 있는 **Identity Provider Single Logout URL** | **General** 탭에서 **SAML Settings**를 편집하고 **Show Advanced Settings**를 클릭한 뒤 **Allow application to initiate Single Logout**를 선택하세요. **Single Logout URL**에는 단일 로그아웃 URL을, **SP Issuer**에는 식별자(Entity ID)를 설정하고 인증서를 **Signature Certificate**로 업로드하세요. |
| Microsoft Entra ID | **Set up OneUptime**에 있는 **Logout URL** | **Basic SAML Configuration**에서 **Logout Url (Optional)** 항목을 단일 로그아웃 URL로 설정하세요. Entra ID에는 인증서가 필요하지 않습니다. |
| Keycloak | 렐름의 SAML 엔드포인트로, 로그인 URL과 같습니다 | 클라이언트의 **Advanced** 탭에서 **Logout Service Redirect Binding URL**을 단일 로그아웃 URL로 설정하세요. **Front channel logout**은 켠 상태로 두세요. 위에서 설정한 대로 **Client signature required**가 꺼져 있는 동안 Keycloak에는 인증서가 필요하지 않습니다. |

그곳에서 로그아웃하면 ID 공급자가 브라우저를 단일 로그아웃 URL로 돌려보내고, 로그인 페이지가 열리거나 ID 공급자가 로그아웃을 확인하지 않았다는 안내가 표시됩니다. 사용자가 ID 공급자나 그 공급자를 쓰는 다른 앱에서 로그아웃하면, Keycloak과 Microsoft Entra ID처럼 자신의 앱에 로그아웃 요청을 보내는 ID 공급자는 OneUptime에서도 로그아웃시킵니다. OneUptime은 ID 공급자가 서명한 요청만 받아들입니다.
@tab OpenID Connect
OneUptime이 로그아웃시킨 뒤 브라우저가 공급자 자체의 로그아웃으로 가고, 공급자가 OneUptime 로그인 페이지로 돌려보냅니다. 그 페이지를 공급자에 등록하세요. **OIDC 구성** 대화 상자에 로그아웃 후 리디렉션 URI로 표시되며, 공급자는 이를 post-logout redirect URI라고 부릅니다. Google처럼 검색 문서에 `end_session_endpoint`가 없는 공급자는 이 설정을 켤 수 없습니다.

| ID 공급자 | 로그아웃 후 리디렉션 URI를 등록하는 곳 |
| --- | --- |
| Okta | 앱 통합의 **General** 탭에서 **General Settings**의 **Edit**를 클릭하고 **Sign-out redirect URIs**에 추가하세요. |
| Microsoft Entra ID | 앱 등록의 **Authentication**에서 **Web** 플랫폼의 **Redirect URIs**에 추가하세요. **Front-channel logout URL**은 OneUptime이 쓰지 않는 다른 설정입니다. |
| Auth0 | 애플리케이션의 **Settings**에서 **Allowed Logout URLs**에 추가하세요. 2023년 11월 14일 이전에 만든 테넌트는 검색 문서에 `end_session_endpoint`가 나오도록 테넌트의 **Advanced** 설정에서 **RP-Initiated Logout End Session Endpoint Discovery**도 켜야 합니다. |
| Keycloak | 클라이언트 설정에서 **Valid post logout redirect URIs**에 추가하세요(Keycloak 19 이상). |

등록하지 않은 공급자는 OneUptime에서 로그아웃한 사람을 돌려보내지 않고 자체 오류 페이지를 보여 줍니다. 그래도 OneUptime에서는 로그아웃된 상태입니다.
:::

## SSO 사용자의 역할과 팀

OneUptime은 ID 공급자의 역할이나 그룹을 가져오지 않습니다. 사람이 할 수 있는 일은 그 사람이 속한 팀에서 결정됩니다. 공급자는 새로 온 사람을 자신의 **팀**에 추가하고, 팀과 그 권한은 [사용자, 팀 및 권한](/docs/permissions/index)에서 설명하는 대로 OneUptime에서 관리합니다. 팀 멤버 구성을 ID 공급자와 맞춰 두려면 [SCIM](/docs/identity/scim)을 사용하세요. 로그인할 때 참여하는 각 팀은 해당 팀의 **감사 로그** 페이지에 로그인한 사람의 변경으로 기록됩니다.

공급자의 팀이 그 공급자로 로그인하는 사람이 할 수 있는 일을 결정하므로, 공급자는 저장하는 사람이 다른 사람을 초대할 수 있는 팀으로만 저장할 수 있습니다. 저장할 때마다 팀을 다시 확인합니다. 내가 가진 것보다 더 많은 액세스 권한을 주는 팀이 있는 공급자는 프로젝트 소유자처럼 그 팀을 포괄하는 액세스 권한을 가진 사람만 변경할 수 있습니다. 이 확인이 도입되기 전에 저장된 공급자는 계속 사람들을 자신의 팀으로 로그인시킵니다. 공급자를 편집할 수 있는 사람은 누구나 여전히 공급자를 끌 수 있으므로 즉시 멈출 수 있습니다.

## 도메인

**SSO로 로그인**은 이메일 주소를 묻고, 그 주소의 도메인을 담당하는 공급자를 제시합니다. 계정은 읽지 않습니다. 프로젝트에 계정이 있는 주소와 계정이 전혀 없는 주소가 같은 답을 받으므로, 이 페이지는 누가 계정을 가지고 있는지 아무것도 알려 주지 않습니다. 여기에서 제시되려면 공급자에 담당하는 도메인을 지정합니다.

1. **프로젝트 설정** > **고급** > **도메인**에서 도메인을 추가하고, 해당 행의 **도메인 인증**을 클릭한 뒤 표시된 TXT 레코드를 도메인의 DNS에 추가합니다. 레코드가 확인되면 도메인이 인증됩니다.
2. 공급자를 편집하고 **로그인** 단계의 **도메인**에서 도메인을 선택합니다. 프로젝트의 인증된 도메인만 나열됩니다.

그러면 **SSO로 로그인**은 누가 입력하든 그 도메인의 모든 주소에 공급자를 제시합니다. 도메인은 정확히 일치해야 합니다. `acme.com`은 `eu.acme.com`을 포함하지 않으므로, 사람들이 로그인할 때 쓰는 도메인을 각각 추가하세요.

도메인 기능이 생기기 전에 설정한 공급자는 OneUptime을 업그레이드할 때 프로젝트의 인증된 도메인을 받았습니다. 프로젝트가 인증한 모든 도메인이지만, 다른 프로젝트도 인증한 도메인은 제외됩니다. 그런 도메인이 내 것이라면 직접 선택하세요. 추가했지만 인증하지 않은 도메인은 어떤 공급자에게도 주어지지 않았습니다.

인증된 도메인이 없는 공급자는 그곳에서 누구에게도 제시되지 않습니다. 해당 공급자의 **도메인** 열에는 **인증된 도메인 없음**이 표시되고, 공급자 위의 알림이 그 공급자를 알려 주고 해야 할 일을 안내합니다. 프로젝트에 인증된 도메인이 없는 동안에는 알림의 **도메인 인증**이 **도메인**을 엽니다.

이메일이 다른 도메인에 있는 사람(예: 외부 협력자)도 그곳에서 공급자를 찾지 못합니다. 프로젝트의 SSO 로그인 링크를 공유하세요. 공급자 아래의 **SSO 로그인 링크** 카드에서 복사할 수 있습니다. 이 링크는 프로젝트의 공급자를 보여 주고 이메일 주소를 묻지 않으므로, 누가 계정을 가지고 있는지 아무것도 알려 주지 않습니다. ID 공급자에서 시작하는 로그인도 도메인과 관계없이 작동합니다.

## 프로젝트에 SSO 필수 지정

공급자를 설정해도 비밀번호로 로그인하는 것을 막지는 않습니다. SSO를 프로젝트에 들어오는 유일한 방법으로 만들려면 **프로젝트 설정** > **보안** > **SSO**의 공급자 아래에 있는 **로그인에 SSO 필수** 스위치를 사용하세요.

:::steps
1. 먼저 **SSO 로그인 링크** 카드의 링크로 공급자를 테스트합니다.
2. **로그인에 SSO 필수**를 켭니다. OneUptime은 저장하기 전에 확인을 요청합니다. 이후로는 나를 포함한 프로젝트의 모든 사람이 프로젝트를 열려면 SSO로 로그인해야 하며, 비밀번호로 로그인한 사람은 SSO로 로그인할 때까지 프로젝트에서 차단됩니다.
3. **SSO 필수로 설정**을 클릭하여 확인합니다. 스위치는 바로 저장되며, 별도의 저장 버튼은 없습니다.
:::

**로그인에 SSO 필수**를 켜려면 프로젝트에 사람을 로그인시키는 공급자가 있어야 합니다. 켜져 있는 프로젝트 자체의 SAML 또는 OIDC 공급자이거나, 켜져 있고 그 프로젝트에 사람을 로그인시키는 글로벌 공급자입니다. 그런 공급자가 없으면 OneUptime은 거부하고, 먼저 프로젝트의 공급자를 켜고 테스트하라고 안내합니다. 프로젝트가 필수로 지정할 공급자를 고른다면 그중 하나여야 하며, 나중에 다른 공급자를 필수로 지정할 때도 같은 확인을 거칩니다.

이미 켜져 있는 **로그인에 SSO 필수**를 켜진 상태로 보내는 저장이나, 프로젝트가 이미 필수로 지정한 공급자를 지정하는 저장도 같은 방식으로 확인됩니다. API, Terraform 등의 도구는 저장할 때마다 모든 설정을 보내는 경우가 많기 때문입니다. 따라서 프로젝트에 사람을 로그인시키는 공급자가 없거나 필수 공급자가 그 뒤에 꺼졌다면, 그런 저장은 다른 무엇을 변경하든 같은 문구로 거부됩니다. 먼저 공급자를 켜거나, 다른 공급자를 필수로 지정하거나, **로그인에 SSO 필수**를 끄세요.

새 프로젝트에도 같은 규칙이 적용됩니다. 새 프로젝트에는 아직 자체 공급자가 없으므로, **로그인에 SSO 필수**를 켠 상태로 만들려면(마스터 관리자만 가능) 켜져 있고 모든 프로젝트에 사람을 로그인시키는 글로벌 공급자가 필요하며, 없으면 같은 문구로 거부됩니다. 프로젝트를 만들고, 그 공급자를 설정하고 테스트한 다음 스위치를 켜세요.

서버 전체에서 SSO가 필수인 동안(**Admin** > **설정** > **SSO** > **로그인에 SSO 필수**)에는 어떤 프로젝트를 만들 때도 그런 글로벌 공급자가 필요합니다. 그렇지 않으면 만든 사람을 포함해 아무도 프로젝트를 열 수 없기 때문입니다. 없으면 프로젝트 생성이 거부되고, 메시지는 서버 관리자에게 공급자를 켜 달라고 요청합니다. 마스터 관리자는 계속 프로젝트를 만들 수 있습니다.

**로그인에 SSO 필수**를 끄면 스위치를 바꾸는 즉시 저장되고 멤버가 바로 비밀번호로 다시 들어올 수 있습니다. 단, 바로 그 순간에 누군가가 다시 켜면 앱 서버가 따라오는 데 최대 1분이 걸릴 수 있습니다. 프로젝트 소유자, 프로젝트 관리자, **Edit Project** 권한이 있는 멤버가 변경할 수 있습니다. 그 밖의 사람에게는 스위치가 잠긴 상태로 필요한 권한과 함께 표시됩니다.

> [!NOTE]
> OneUptime Cloud에서 SSO를 필수로 지정하려면 **Scale** 플랜이 필요하지만, 끄는 것은 모든 플랜에서 할 수 있습니다. Scale 미만에서는 **프로젝트 설정** > **보안** > **SSO**에 플랜 업그레이드 안내가 표시됩니다. Scale 체험 기간이 끝나 SSO가 필수인 채로 남은 프로젝트에서는 끌 수 있도록 안내 아래에 **로그인에 SSO 필수**도 표시됩니다. 다시 켜려면 **Scale**이 필요합니다.

### SSO로 멤버의 로그인 관리

SSO를 필수로 지정하면 프로젝트의 데이터가 ID 공급자 뒤에서 보호되지만, 멤버는 여전히 OneUptime에서 비밀번호, 패스키, 2단계 인증을 설정할 수 있습니다. 이는 프로젝트가 결코 요구하지 않는 것입니다. **로그인에 SSO 필수**가 켜져 있는 동안에는 그 아래의 두 번째 스위치인 **SSO로 로그인 관리**로 이를 막을 수 있습니다.

초대받은 프로젝트를 포함해 어떤 사람이 속한 모든 프로젝트가 SSO를 요구하고 **SSO로 로그인 관리**를 켜 두었다면, 그 사람의 로그인은 SSO가 관리합니다. 그러면 그 사람은 비밀번호, 패스키, 보안 키, 인증 앱, 백업 코드, 2단계 인증을 설정할 수 없고, 로그인 페이지의 **비밀번호를 잊으셨나요?** 링크도 이메일을 보내지 않으며, **사용자 프로필**에는 그런 설정 대신 ID 공급자가 표시됩니다. 로그인 자체는 달라지지 않습니다. 그 사람의 비밀번호로 여전히 OneUptime에 로그인되고, 프로젝트는 전처럼 SSO를 요구합니다.

이 규칙은 매번 확인되므로 다음과 같습니다.

- **로그인을 관리하지 않는 프로젝트에 속한 사람**: SSO를 요구하지 않거나 **SSO로 로그인 관리**를 켜 두지 않은 프로젝트의 멤버가 되거나 초대를 받는 즉시 설정이 돌아오고, **사용자 프로필**에는 그 이유로 그 프로젝트가 표시됩니다. 그 프로젝트를 떠나면 로그인이 다시 관리됩니다. 계정은 여러 조직에 속할 수 있으므로, 한 조직이 다른 조직의 프로젝트를 대신 결정하는 일은 없습니다.
- **공급자가 다른 프로젝트**: 각자의 ID 공급자로 로그인을 관리하는 두 프로젝트에 속한 사람은 관리 대상이 되며, 프로필에는 두 공급자가 모두 표시됩니다.
- **마스터 관리자**는 항상 자신의 설정을 유지합니다.
- **멤버가 전에 설정한 것**은 지워질 때까지 보관되지만 프로젝트에서 쓰이지 않습니다. 프로젝트 소유자(아래 참고)가 지우거나, 서버 관리자가 Admin Dashboard에서 그 사람의 **인증** 페이지에 있는 **로그인 설정 지우기**로 지울 수 있습니다.

**SSO로 로그인 관리**는 스위치를 바꾸는 즉시 저장되고, 아무것도 삭제하지 않으며, 끄면 모든 사람의 설정이 바로 돌아옵니다. **로그인에 SSO 필수**를 변경할 수 있는 사람이 같은 플랜에서 이것도 변경할 수 있습니다. **로그인에 SSO 필수**가 꺼져 있으면 숨겨지며 아무것도 바꾸지 않습니다.

### 멤버가 전에 저장한 것 지우기

**SSO로 로그인 관리**가 켜져 있는 동안, 프로젝트 소유자에게는 그 아래에 OneUptime에 비밀번호나 2단계 인증을 아직 저장해 둔 멤버의 수가 표시됩니다. **로그인 설정 지우기**는 확인을 받은 뒤 그들의 비밀번호와 재설정 링크나 로그인 링크, 패스키, 보안 키, 인증 앱, 백업 코드를 삭제하고, 2단계 인증을 끄고, SSO 없이 로그인한 세션을 끝냅니다. 되돌릴 수 없습니다.

계정은 여러 조직에 속할 수 있으므로, 조직이 책임지는 사람의 설정만 지울 수 있습니다. 조직이란 직접 소유한 프로젝트를 말합니다. 초대받은 프로젝트를 포함해 어떤 사람이 속한 모든 프로젝트가 본인이 **프로젝트 소유자**인 프로젝트이고 **SSO로 로그인 관리**를 켜 둔 프로젝트일 때만 그 사람의 설정이 지워집니다. 그 밖의 사람은 모두 자신의 설정을 유지합니다.

- 직접 소유하지 않은 프로젝트나 SSO로 로그인을 관리하지 않는 프로젝트의 멤버이거나 그런 프로젝트에 초대받은 사람
- 이 프로젝트에 초대만 받고 아직 참여하지 않은 사람
- 마스터 관리자와 본인: 본인의 설정은 **사용자 프로필**에서 바꾸세요.

설정이 지워진 각 사람에게는 삭제된 항목과 이제 SSO로 로그인한다는 내용이 이메일로 발송되며, 프로젝트의 감사 로그에는 본인이 지운 것으로 기록됩니다. **프로젝트 소유자**만 대시보드에 로그인한 상태에서 지울 수 있으며, API 키로는 지울 수 없습니다.

## 공급자 끄기 또는 삭제

| 변경 내용 | 그 공급자로 로그인한 사람 |
| --- | --- |
| 끄거나 삭제 | SSO가 필수인 곳에서는 다음 요청 때 SSO로 다시 로그인 |
| 새 인증서나 클라이언트 시크릿, 다른 URL, 새 이름 또는 다른 팀 | 로그인 상태 유지 |
| 켜기 | 바로 그 공급자로 로그인 가능 |

SAML 또는 OIDC 공급자를 끄거나 삭제하면 그 공급자로 이루어진 로그인이 끝납니다. 프로젝트 자체가 SSO를 필수로 지정했거나 서버 전체가 필수로 지정해서 SSO가 필수인 프로젝트에서는 다음과 같습니다.

- 그 공급자로 로그인한 사람은 모두 다음 요청 때 SSO로 다시 로그인해야 하며, 열어 둔 페이지는 즉시 실시간 업데이트를 받지 않게 됩니다.
- 누군가가 그 공급자로 로그인한 뒤 연결한 MCP 클라이언트는 그 프로젝트에서 작동하지 않게 됩니다. SSO로 로그인한 뒤 다시 연결하세요.
- 공급자를 다시 켜도 그 로그인은 돌아오지 않습니다. 그 공급자로 다시 로그인해야 합니다.

공급자의 다른 부분을 변경하면 모두 로그인 상태가 유지됩니다. 새 인증서나 클라이언트 시크릿, 다른 URL, 새 이름 또는 다른 팀이 그렇습니다. 로그인은 이루어질 때 확인되었으며, 다음 로그인부터 새 설정이 사용됩니다.

프로젝트에서 SSO가 필수인 동안 OneUptime은 들어올 길을 남겨 둡니다. 사람이 프로젝트에 로그인할 수 있는 마지막 공급자(그 프로젝트에 사람을 로그인시키는 글로벌 공급자 포함)나 프로젝트가 필수로 지정한 공급자는 끄거나 삭제할 수 없습니다. 먼저 **로그인에 SSO 필수**를 끄세요.

공급자를 켜면 바로 그 공급자로 로그인할 수 있습니다.

서버 전체에서 SSO가 필수일 때(**Admin** > **설정** > **SSO** > **로그인에 SSO 필수**)는 프로젝트 자체가 SSO를 필수로 지정하지 않았더라도 모든 프로젝트가 같은 방식으로 들어올 길을 유지합니다. 먼저 그 프로젝트의 다른 공급자를 켜세요.

글로벌 공급자에도 같은 규칙이 적용됩니다. 글로벌 공급자나 그 공급자에 연결된 프로젝트를 변경해 SSO가 필수인 프로젝트에 공급자가 하나도 남지 않게 된다면, 그 변경은 프로젝트를 명시하며 거부됩니다. [글로벌 SSO](/docs/identity/global-sso#공급자-끄기-또는-삭제)를 참고하세요.

프로젝트도 서버도 SSO를 필수로 지정하지 않은 곳에서는 공급자를 끄면 그 공급자로 새로 로그인하는 것만 멈춥니다. 이미 로그인한 사람은 비밀번호로 로그인한 사람과 마찬가지로 로그인 상태가 유지됩니다.

## Scale 플랜 미만에 남은 공급자

프로젝트에 남아 있는 SAML 또는 OIDC 공급자는 Scale 체험 기간이 끝나거나 플랜이 낮아진 뒤에도 계속 사람을 로그인시킵니다. 그래서 Scale 미만에서는 **SSO** 페이지의 업그레이드 안내 아래에 프로젝트의 공급자가 나열됩니다(**아직 설정되어 있는 SAML 공급자**, **아직 설정되어 있는 OIDC 공급자**).

- **끄기**는 공급자를 즉시 멈춥니다. OneUptime이 먼저 확인을 요청합니다.
- **삭제**는 공급자를 삭제합니다.

공급자를 추가하거나 변경하거나 다시 켜려면 **Scale**이 필요합니다. 각 작업을 할 수 있는 사람은 Scale에서와 같습니다. 공급자를 끄려면 편집 권한이, 삭제하려면 삭제 권한이 필요합니다.

프로젝트에서 아직 SSO가 필수인 동안에는 **SSO** 페이지에 **로그인에 SSO 필수**도 표시됩니다. 마지막 공급자를 끄기 전에 이것을 끄세요. 그때까지는 사람이 로그인할 수 있는 마지막 공급자를 끄거나 삭제할 수 없으므로, 아무도 프로젝트에서 차단되지 않습니다.

상태 페이지의 **싱글 사인온** 페이지도 **SAML** 탭과 **OIDC** 탭에서 같은 방식으로 상태 페이지 자체의 공급자를 나열합니다. 상태 페이지에서 아직 SSO가 필수인 동안에는 두 탭 모두 **로그인에 SSO 필수**도 표시합니다. 공급자를 끄기 전에 이것을 끄세요. 그렇지 않으면 상태 페이지의 비공개 사용자가 아예 로그인할 수 없습니다.

## 문제 해결

:::details "SSO Config not found"
공급자가 꺼져 있거나, 링크가 더 이상 존재하지 않는 공급자를 가리킵니다. 새 공급자는 꺼진 상태로 시작합니다. 공급자를 편집하여 **활성화됨**을 켜세요.
:::

:::details "No teams added."
그 사람은 아직 프로젝트에 속해 있지 않고, 공급자에는 그 사람을 추가할 **팀**이 없습니다. 공급자를 편집하여 프로젝트의 멤버 팀 같은 팀을 하나 이상 고르세요.
:::

:::details "Issuer URL does not match"
IdP 어설션의 발급자가 공급자의 **발급자**와 다릅니다. IdP에서 다시 복사하세요(Keycloak 렐름 URL, **Microsoft Entra Identifier** 또는 Okta의 Identity Provider Issuer). 두 값이 정확히 일치해야 합니다.
:::

:::details "SAML Audience does not match"
응답의 audience가 이 공급자의 **식별자(Entity ID)** 값이 아닙니다. IdP가 다른 애플리케이션용으로 응답을 만들었습니다. IdP에서 애플리케이션의 entity ID를 **SSO 구성 보기**의 **식별자(Entity ID)** 값으로 설정하세요. Keycloak에서는 **Client ID**, Entra ID에서는 **Identifier (Entity ID)** 항목, Okta에서는 **Audience URI (SP Entity ID)** 항목입니다. OneUptime 주소만(예: `https://oneuptime.com`) entity ID로 설정된 IdP는 계속 작동합니다.
:::

:::details "SAML Recipient does not match"
응답의 recipient가 이 공급자의 **회신 URL**이 아닙니다. 응답이 다른 주소로 보내졌습니다. IdP에서 애플리케이션의 reply URL을 **SSO 구성 보기**의 **회신 URL(Assertion Consumer Service URL)** 값으로 설정하세요. Keycloak에서는 **Assertion Consumer Service POST Binding URL**, Entra ID에서는 **Reply URL (Assertion Consumer Service URL)** 항목, Okta에서는 **Single sign-on URL** 항목입니다. "SAML Destination does not match"도 원인과 해결 방법이 같습니다.
:::

:::details "SAML response has expired"
응답이 IdP가 허용하는 것보다 늦게, 또는 발급 후 10분이 넘어서 OneUptime에 도착했습니다. 다시 로그인하세요. 계속 반복된다면 IdP나 OneUptime 서버의 시계가 틀린 것입니다. OneUptime은 둘 사이에 3분까지의 차이를 허용합니다. "SAML response is not valid yet"은 같은 문제가 반대 방향으로 생긴 것입니다.
:::

:::details "SAML response was already used"
IdP의 각 응답으로는 한 번만 로그인할 수 있습니다. 로그인한 뒤 브라우저에서 뒤로 가거나, IdP가 거쳐 보낸 페이지를 새로 고치면 같은 응답이 다시 전송됩니다. OneUptime에서 또는 IdP에서 다시 로그인하세요.
:::

:::details "This account is linked to someone else."
Microsoft Entra ID가 이 공급자를 통해 다른 개체 ID에 연결된 계정의 이메일 주소로 누군가를 로그인시켰습니다. 지금은 Entra ID에서 다른 사람이 그 주소를 쓰고 있거나, 그 사람의 Entra ID 계정이 다시 만들어진 경우입니다. OneUptime은 이 로그인을 거부하므로, 다음에 그 주소를 갖게 된 사람은 그 계정을 사용할 수 없습니다. 계정이 그 사람의 것이라면 그 사람을 프로젝트에서 제거했다가 다시 추가하세요. 다음 로그인 때 계정이 그 사람의 새 개체 ID에 연결됩니다.
:::

:::details 서명 또는 인증서 오류로 로그인에 실패함
IdP의 현재 서명 인증서를 `BEGIN CERTIFICATE` 줄과 `END CERTIFICATE` 줄을 포함해 **공개 인증서**에 붙여 넣으세요. Entra ID에서는 원시 인증서가 아니라 **Base64** 인증서를, Okta에서는 활성 서명 인증서를, Keycloak에서는 올바른 렐름의 인증서를 내려받습니다.
:::

:::details "Encrypted SAML Responses are not supported"
OneUptime은 어설션을 복호화하지 않습니다. IdP에서 애플리케이션의 어설션 암호화를 꺼서, 암호화되지 않은 서명된 어설션을 보내도록 하세요.
:::

:::details "SAML response did not include a valid email address"
OneUptime은 Name ID에서 이메일 주소를 읽습니다. Name ID를 사용자의 이메일로 설정하세요. Keycloak에서는 **Name ID Format** `email`과 **Force Name ID Format**, Entra ID에서는 **Unique User Identifier (Name ID)** 항목, Okta에서는 **Name ID format** `EmailAddress`와 **Application username** `Email`입니다. 주소는 그 사람의 OneUptime 계정과 일치해야 합니다.
:::

:::details Entra ID: AADSTS700016
Entra ID의 **Identifier (Entity ID)** 값이 OneUptime의 값과 일치하지 않습니다. **SSO 구성 보기**에서 다시 복사하세요. 두 값은 동일해야 합니다.
:::

:::details Okta: 404 또는 audience 불일치
Okta의 **Single sign-on URL**은 OneUptime의 **회신 URL**과, **Audience URI**는 OneUptime의 **식별자(Entity ID)** 값과 정확히 같아야 합니다. 두 값 모두 임시 값을 대체했는지 확인하세요.
:::

:::details 사용자가 애플리케이션에 할당되지 않음
Entra ID와 Okta는 애플리케이션에 할당된 사람만 로그인시킵니다. 사용자나 그 사용자가 속한 그룹을 할당하세요.
:::

:::details Keycloak: 리디렉션 루프
올바른 렐름의 클라이언트에서 **Valid Redirect URIs**와 **Assertion Consumer Service POST Binding URL**이 위와 같이 설정되어 있는지 확인하세요.
:::

## 다음 단계

:::cards
- [글로벌 SSO](/docs/identity/global-sso): 자체 호스팅 인스턴스의 모든 프로젝트에 하나의 ID 공급자를 사용합니다.
- [SCIM](/docs/identity/scim): ID 공급자가 사람을 자동으로 추가하고 제거하게 합니다.
- [사용자, 팀 및 권한](/docs/permissions/index): 새로 온 사람이 합류하는 팀으로 할 수 있는 일을 알아봅니다.
:::
