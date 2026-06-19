# Global SSO (인스턴스 전체 싱글 사인온)

Global SSO를 사용하면 OneUptime **인스턴스 관리자**(마스터 관리자)가 단일 SAML 2.0 또는 OpenID Connect(OIDC) ID 공급자를 **인스턴스 수준에서 한 번만** 구성하고 이를 서버의 모든 프로젝트에 연결할 수 있습니다. 이는 프로젝트별 SSO에 대응하는 인스턴스 전체 기능입니다. 모든 프로젝트 소유자가 각자의 ID 공급자를 구성하는 대신, 마스터 관리자가 전체 인스턴스에 사용할 수 있는 하나를 설정합니다.

Global SSO는 **OneUptime Enterprise Edition** 기능이며 Enterprise Edition 빌드를 실행하는 인스턴스에서만 사용할 수 있습니다.

## Global SSO와 Project SSO 비교

| | Project SSO | Global SSO |
|---|---|---|
| 구성 주체 | 프로젝트 소유자/관리자 (프로젝트 설정) | 인스턴스 마스터 관리자 (Admin Dashboard) |
| 범위 | 단일 프로젝트 | 전체 인스턴스 — 모든 프로젝트에 연결 가능 |
| 로그인 결과 | 해당 단일 프로젝트에 대한 액세스 | 사용자가 접근할 수 있는 모든 프로젝트에 대한 액세스 |

## Global SSO 설정

1. **Admin Dashboard 열기**
   - 마스터 관리자로 로그인한 후 **Admin** > **Settings** > **Global SSO**(SAML의 경우) 또는 **Global OIDC**(OpenID Connect의 경우)를 엽니다.

2. **공급자 생성**
   - **Create Global SSO**를 클릭합니다.
   - SAML의 경우: **Name**, ID 공급자의 **Sign On URL** 및 **Issuer**를 입력하고 **Public Certificate**를 붙여 넣습니다. **Signature** 및 **Digest** 방법을 선택합니다(확실하지 않은 경우 기본값 — `RSA-SHA256` / `SHA256` — 을 그대로 둡니다).
   - OIDC의 경우: **Discovery URL**, **Issuer**, **Client ID**, **Client Secret**, **Scopes**(반드시 `openid`을 포함해야 함), 그리고 **email** / **name** 클레임 이름을 입력합니다.

3. **OneUptime URL을 ID 공급자에 복사**
   - 공급자를 열어(목록에서 해당 행을 클릭) **Identity Provider URLs** 카드를 표시합니다.
   - SAML의 경우, **ACS URL (Reply URL)**과 **Issuer (Entity ID)**를 IdP(Okta, Azure AD, OneLogin, JumpCloud 등)에 복사합니다.
   - OIDC의 경우, **Redirect URI**를 IdP의 허용된 리디렉션 목록에 복사합니다.

4. **공급자 테스트**
   - 공급자 페이지의 **Test this SSO provider** 링크를 사용하여 ID 공급자를 통한 종단 간 로그인을 실행합니다. 링크가 작동하려면 공급자가 **활성화**되어 있어야 합니다. 전역 공급자를 활성화하면 로그인 페이지에 "Sign in with SSO" 옵션만 추가될 뿐, SSO를 강제하거나 누군가를 잠그지 않으므로 필요한 경우 활성화하고 테스트한 후 다시 비활성화해도 안전합니다.

## 사용자 로그인 방식

전역 공급자의 동작 방식은 여기에 프로젝트를 연결하는지 여부에 따라 달라집니다:

- **연결된 프로젝트 없음 (default-all / 초대 우선):** 사용자는 공급자로 로그인하여 **이미 구성원으로 속해 있는 모든 프로젝트**에 접근할 수 있습니다. 신규 사용자는 자동으로 생성되지 **않습니다** — 사용자는 먼저 프로젝트에 초대되어야 합니다. 구성원 관리가 다른 곳에서 이루어지는 회사 전체 SSO에 이 방식을 사용하십시오.

- **연결된 프로젝트 있음 (자동 프로비저닝):** 공급자를 열고 **Attached Projects** 테이블을 사용하여 각각 기본 팀 집합과 함께 하나 이상의 프로젝트를 연결합니다. 로그인하는 사용자는 해당 프로젝트에 **자동 프로비저닝**되며 첫 로그인 시 기본 팀에 추가됩니다. 목록을 구성하려면 한 번에 하나의 프로젝트 + 팀을 추가하십시오. 연결을 변경하려면 삭제한 후 다시 추가하십시오.

프로젝트가 연결되어 있더라도 자동 계정 생성을 모두 방지하려면 공급자에서 **Disable Sign Up with SSO**를 활성화하십시오 — 그러면 사용자는 로그인하기 전에 초대를 받아야 합니다.

## SSO 적용 강제

전역 공급자를 구성한다고 해서 누군가에게 그것을 사용하도록 강제하지는 않습니다. 비밀번호 로그인은 여전히 작동합니다. SSO를 요구하려면 **Require SSO for Login** 컨트롤을 사용하십시오:

- **프로젝트별:** 프로젝트는 SSO를 요구할 수 있으며, 선택적으로 *특정* 공급자(프로젝트 또는 전역)를 요구할 수 있습니다.
- **인스턴스 전체:** **Admin** > **Settings** > **Authentication**에는 인스턴스의 모든 사용자에게 SSO를 강제하는 **Require SSO for Login** 토글이 있습니다. 마스터 관리자는 잠기지 않도록 예외로 유지됩니다.

## 관련 항목

- [SSO (Project SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
