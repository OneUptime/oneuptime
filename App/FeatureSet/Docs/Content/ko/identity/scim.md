# SCIM (System for Cross-domain Identity Management)

OneUptime는 자동화된 사용자 프로비저닝 및 디프로비저닝을 위한 SCIM v2.0 프로토콜을 지원합니다. SCIM을 사용하면 Azure AD, Okta 및 기타 엔터프라이즈 ID 시스템과 같은 ID 공급자(IdP)가 OneUptime 프로젝트 및 상태 페이지에 대한 사용자 액세스를 자동으로 관리할 수 있습니다.

## 개요

SCIM 통합은 다음과 같은 이점을 제공합니다:

- **자동화된 사용자 프로비저닝**: IdP에서 사용자가 할당될 때 OneUptime에서 자동으로 사용자 생성
- **자동화된 사용자 디프로비저닝**: IdP에서 사용자가 할당 해제될 때 OneUptime에서 자동으로 사용자 제거
- **사용자 속성 동기화**: IdP와 OneUptime 간의 사용자 정보를 동기화 상태로 유지
- **중앙화된 액세스 관리**: 기존 ID 관리 시스템에서 OneUptime 액세스 관리

## 프로젝트용 SCIM

프로젝트 SCIM은 ID 공급자가 OneUptime 프로젝트 내의 팀 구성원을 관리할 수 있게 합니다.

### 프로젝트 SCIM 설정

1. **프로젝트 설정으로 이동**
   - OneUptime 프로젝트로 이동합니다
   - **프로젝트 설정** > **팀** > **SCIM**으로 이동합니다

2. **SCIM 설정 구성**
   - IdP에서 사용자가 할당될 때 자동으로 사용자를 추가하려면 **자동 사용자 프로비저닝**을 활성화합니다
   - IdP에서 사용자가 할당 해제될 때 자동으로 사용자를 제거하려면 **자동 사용자 디프로비저닝**을 활성화합니다
   - 새 사용자가 추가될 **기본 팀**을 선택합니다
   - IdP 구성을 위한 **SCIM 기본 URL** 및 **Bearer 토큰**을 복사합니다

3. **ID 공급자 구성**
   - SCIM 기본 URL 사용: `https://oneuptime.com/scim/v2/{scimId}`
   - 제공된 토큰으로 bearer 토큰 인증 구성
   - 사용자 속성 매핑 (이메일 필수)

### 프로젝트 SCIM 엔드포인트

- **서비스 공급자 구성**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **스키마**: `GET /scim/v2/{scimId}/Schemas`
- **리소스 유형**: `GET /scim/v2/{scimId}/ResourceTypes`
- **사용자 목록**: `GET /scim/v2/{scimId}/Users`
- **사용자 가져오기**: `GET /scim/v2/{scimId}/Users/{userId}`
- **사용자 생성**: `POST /scim/v2/{scimId}/Users`
- **사용자 업데이트**: `PUT /scim/v2/{scimId}/Users/{userId}` 또는 `PATCH /scim/v2/{scimId}/Users/{userId}`
- **사용자 삭제**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **그룹 목록**: `GET /scim/v2/{scimId}/Groups`
- **그룹 가져오기**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **그룹 생성**: `POST /scim/v2/{scimId}/Groups`
- **그룹 업데이트**: `PUT /scim/v2/{scimId}/Groups/{groupId}` 또는 `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **그룹 삭제**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### 프로젝트 SCIM 사용자 라이프사이클

1. **IdP에서 사용자 할당**: IdP에서 사용자가 OneUptime에 할당될 때
2. **SCIM 프로비저닝**: IdP가 OneUptime SCIM API를 호출하여 사용자 생성
3. **팀 구성원 자격**: 사용자가 구성된 기본 팀에 자동으로 추가됨
4. **액세스 부여**: 사용자가 이제 OneUptime 프로젝트에 액세스 가능
5. **사용자 할당 해제**: IdP에서 사용자가 할당 해제될 때
6. **SCIM 디프로비저닝**: IdP가 OneUptime SCIM API를 호출하여 사용자 제거
7. **액세스 취소**: 사용자가 프로젝트에 대한 액세스 권한을 잃음

## 상태 페이지용 SCIM

상태 페이지 SCIM은 ID 공급자가 비공개 상태 페이지의 구독자를 관리할 수 있게 합니다.

### 상태 페이지 SCIM 설정

1. **상태 페이지 설정으로 이동**
   - OneUptime 상태 페이지로 이동합니다
   - **상태 페이지 설정** > **비공개 사용자** > **SCIM**으로 이동합니다

2. **SCIM 설정 구성**
   - IdP에서 사용자가 할당될 때 자동으로 구독자를 추가하려면 **자동 사용자 프로비저닝**을 활성화합니다
   - IdP에서 사용자가 할당 해제될 때 자동으로 구독자를 제거하려면 **자동 사용자 디프로비저닝**을 활성화합니다
   - IdP 구성을 위한 **SCIM 기본 URL** 및 **Bearer 토큰**을 복사합니다

3. **ID 공급자 구성**
   - SCIM 기본 URL 사용: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - 제공된 토큰으로 bearer 토큰 인증 구성
   - 사용자 속성 매핑 (이메일 필수)

### 상태 페이지 SCIM 엔드포인트

- **서비스 공급자 구성**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **스키마**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **리소스 유형**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **사용자 목록**: `GET /status-page-scim/v2/{scimId}/Users`
- **사용자 가져오기**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **사용자 생성**: `POST /status-page-scim/v2/{scimId}/Users`
- **사용자 업데이트**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` 또는 `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **사용자 삭제**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### 상태 페이지 SCIM 사용자 라이프사이클

1. **IdP에서 사용자 할당**: IdP에서 사용자가 OneUptime 상태 페이지에 할당될 때
2. **SCIM 프로비저닝**: IdP가 OneUptime SCIM API를 호출하여 구독자 생성
3. **액세스 부여**: 사용자가 이제 비공개 상태 페이지에 액세스 가능
4. **사용자 할당 해제**: IdP에서 사용자가 할당 해제될 때
5. **SCIM 디프로비저닝**: IdP가 OneUptime SCIM API를 호출하여 구독자 제거
6. **액세스 취소**: 사용자가 상태 페이지에 대한 액세스 권한을 잃음

## ID 공급자 구성

### Microsoft Entra ID (이전 Azure AD)

Microsoft Entra ID는 강력한 SCIM 프로비저닝 기능을 갖춘 엔터프라이즈급 ID 관리를 제공합니다. OneUptime으로 SCIM 프로비저닝을 구성하는 상세한 단계를 따르십시오.

#### 전제 조건

- Premium P1 또는 P2 라이선스가 있는 Microsoft Entra ID 테넌트 (자동 프로비저닝에 필요)
- Scale 플랜 이상의 OneUptime 계정
- Microsoft Entra ID와 OneUptime 모두에 대한 관리자 액세스

#### 1단계: OneUptime에서 SCIM 구성 가져오기

1. OneUptime 대시보드에 로그인합니다
2. **프로젝트 설정** > **팀** > **SCIM**으로 이동합니다
3. **SCIM 구성 생성**을 클릭합니다
4. 친숙한 이름을 입력합니다 (예: "Microsoft Entra ID 프로비저닝")
5. 다음 옵션을 구성합니다:
   - **자동 사용자 프로비저닝**: 사용자를 자동으로 생성하려면 활성화
   - **자동 사용자 디프로비저닝**: 사용자를 자동으로 제거하려면 활성화
   - **기본 팀**: 새 사용자가 추가될 팀 선택
   - **그룹 푸시 활성화**: Entra ID 그룹을 통해 팀 구성원 자격을 관리하려면 활성화
6. 구성을 저장합니다
7. **SCIM 기본 URL**과 **Bearer 토큰**을 복사합니다 - Entra ID에 필요합니다

#### 2단계: Microsoft Entra ID에서 엔터프라이즈 애플리케이션 생성

1. [Microsoft Entra 관리 센터](https://entra.microsoft.com)에 로그인합니다
2. **ID** > **애플리케이션** > **엔터프라이즈 애플리케이션**으로 이동합니다
3. **+ 새 애플리케이션**을 클릭합니다
4. **+ 자체 애플리케이션 만들기**를 클릭합니다
5. 이름을 입력합니다 (예: "OneUptime")
6. **갤러리에서 찾을 수 없는 다른 애플리케이션 통합 (비갤러리)**을 선택합니다
7. **만들기**를 클릭합니다

#### 3단계: SCIM 프로비저닝 구성

1. OneUptime 엔터프라이즈 애플리케이션에서 **프로비저닝**으로 이동합니다
2. **시작하기**를 클릭합니다
3. **프로비저닝 모드**를 **자동**으로 설정합니다
4. **관리자 자격 증명** 아래:
   - **테넌트 URL**: OneUptime의 SCIM 기본 URL 입력 (예: `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **시크릿 토큰**: OneUptime의 Bearer 토큰 입력
5. **연결 테스트**를 클릭하여 구성을 확인합니다
6. **저장**을 클릭합니다

#### 4단계: 속성 매핑 구성

1. 프로비저닝 섹션에서 **매핑**을 클릭합니다
2. **Azure Active Directory 사용자 프로비저닝**을 클릭합니다
3. 다음 속성 매핑을 구성합니다:

| Azure AD 속성 | OneUptime SCIM 속성 | 필수 여부 |
|-------------------|-------------------------|----------|
| `userPrincipalName` | `userName` | 예 |
| `mail` | `emails[type eq "work"].value` | 권장 |
| `displayName` | `displayName` | 권장 |
| `givenName` | `name.givenName` | 선택 사항 |
| `surname` | `name.familyName` | 선택 사항 |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | 권장 |

4. 불필요한 매핑을 제거하여 프로비저닝을 단순화합니다
5. **저장**을 클릭합니다

#### 5단계: 그룹 프로비저닝 구성 (선택 사항)

OneUptime에서 **그룹 푸시**를 활성화한 경우:

1. **매핑**으로 돌아갑니다
2. **Azure Active Directory 그룹 프로비저닝**을 클릭합니다
3. **사용**을 **예**로 설정하여 그룹 프로비저닝을 활성화합니다
4. 다음 속성 매핑을 구성합니다:

| Azure AD 속성 | OneUptime SCIM 속성 |
|-------------------|-------------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. **저장**을 클릭합니다

#### 6단계: 사용자 및 그룹 할당

1. OneUptime 엔터프라이즈 애플리케이션에서 **사용자 및 그룹**으로 이동합니다
2. **+ 사용자/그룹 추가**를 클릭합니다
3. OneUptime에 프로비저닝하려는 사용자 및/또는 그룹을 선택합니다
4. **할당**을 클릭합니다

#### 7단계: 프로비저닝 시작

1. **프로비저닝** > **개요**로 이동합니다
2. **프로비저닝 시작**을 클릭합니다
3. 초기 프로비저닝 주기가 시작됩니다 (첫 번째 동기화는 최대 40분이 걸릴 수 있음)
4. **프로비저닝 로그**에서 오류를 모니터링합니다

#### Microsoft Entra ID 문제 해결

- **연결 테스트 실패**: SCIM 기본 URL에 `/api/identity` 접두사가 포함되어 있고 Bearer 토큰이 올바른지 확인합니다
- **사용자가 프로비저닝되지 않음**: 사용자가 애플리케이션에 할당되어 있고 속성 매핑이 올바른지 확인합니다
- **프로비저닝 오류**: Entra ID의 프로비저닝 로그에서 특정 오류 메시지를 검토합니다
- **동기화 지연**: 초기 프로비저닝은 최대 40분이 걸릴 수 있으며 이후 동기화는 40분마다 발생합니다

---

### Okta

Okta는 훌륭한 SCIM 지원을 갖춘 유연한 ID 관리를 제공합니다. OneUptime으로 SCIM 프로비저닝을 구성하는 상세한 단계를 따르십시오.

#### 전제 조건

- 프로비저닝 기능이 있는 Okta 테넌트 (라이프사이클 관리 기능)
- Scale 플랜 이상의 OneUptime 계정
- Okta와 OneUptime 모두에 대한 관리자 액세스

#### 1단계: OneUptime에서 SCIM 구성 가져오기

1. OneUptime 대시보드에 로그인합니다
2. **프로젝트 설정** > **팀** > **SCIM**으로 이동합니다
3. **SCIM 구성 생성**을 클릭합니다
4. 친숙한 이름을 입력합니다 (예: "Okta 프로비저닝")
5. 다음 옵션을 구성합니다:
   - **자동 사용자 프로비저닝**: 사용자를 자동으로 생성하려면 활성화
   - **자동 사용자 디프로비저닝**: 사용자를 자동으로 제거하려면 활성화
   - **기본 팀**: 새 사용자가 추가될 팀 선택
   - **그룹 푸시 활성화**: Okta 그룹을 통해 팀 구성원 자격을 관리하려면 활성화
6. 구성을 저장합니다
7. **SCIM 기본 URL**과 **Bearer 토큰**을 복사합니다 - Okta에 필요합니다

#### 2단계: Okta 애플리케이션 생성 또는 구성

**기존 SSO 애플리케이션이 있는 경우:**
1. Okta 관리 콘솔에 로그인합니다
2. **애플리케이션** > **애플리케이션**으로 이동합니다
3. 기존 OneUptime 애플리케이션을 찾아 선택합니다

**새 애플리케이션 생성 시:**
1. Okta 관리 콘솔에 로그인합니다
2. **애플리케이션** > **애플리케이션**으로 이동합니다
3. **앱 통합 만들기**를 클릭합니다
4. **SAML 2.0**을 선택하고 **다음**을 클릭합니다
5. 앱 이름으로 "OneUptime"을 입력합니다
6. SAML 구성을 완료합니다 (SSO 문서 참조)
7. **마침**을 클릭합니다

#### 3단계: SCIM 프로비저닝 활성화

1. OneUptime 애플리케이션에서 **일반** 탭으로 이동합니다
2. **앱 설정** 섹션에서 **편집**을 클릭합니다
3. **프로비저닝** 아래에서 **SCIM**을 선택합니다
4. **저장**을 클릭합니다
5. 새 **프로비저닝** 탭이 나타납니다

#### 4단계: SCIM 연결 구성

1. **프로비저닝** 탭으로 이동합니다
2. 왼쪽 사이드바에서 **통합**을 클릭합니다
3. **API 통합 구성**을 클릭합니다
4. **API 통합 활성화**를 체크합니다
5. 다음을 구성합니다:
   - **SCIM 커넥터 기본 URL**: OneUptime의 SCIM 기본 URL 입력 (예: `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **사용자의 고유 식별자 필드**: `userName` 입력
   - **지원되는 프로비저닝 작업**: 활성화할 작업 선택:
     - 새 사용자 및 프로필 업데이트 가져오기
     - 새 사용자 푸시
     - 프로필 업데이트 푸시
     - 그룹 푸시 (그룹 기반 프로비저닝 사용 시)
   - **인증 모드**: **HTTP 헤더** 선택
   - **권한 부여**: `Bearer {your-bearer-token}` 입력 (실제 토큰으로 교체)
6. **API 자격 증명 테스트**를 클릭하여 연결을 확인합니다
7. **저장**을 클릭합니다

#### 5단계: 앱으로의 프로비저닝 구성

1. **프로비저닝** 탭에서 왼쪽 사이드바의 **앱으로**를 클릭합니다
2. **편집**을 클릭합니다
3. 다음 옵션을 활성화합니다:
   - **사용자 생성**: 새 사용자를 프로비저닝하려면 활성화
   - **사용자 속성 업데이트**: 속성 변경 사항을 동기화하려면 활성화
   - **사용자 비활성화**: 할당 해제 시 사용자를 디프로비저닝하려면 활성화
4. **저장**을 클릭합니다

#### 6단계: 속성 매핑 구성

1. **속성 매핑**으로 스크롤합니다
2. 다음 매핑을 확인하거나 구성합니다:

| Okta 속성 | OneUptime SCIM 속성 | 방향 |
|---------------|-------------------------|-----------|
| `userName` | `userName` | Okta에서 앱으로 |
| `user.email` | `emails[primary eq true].value` | Okta에서 앱으로 |
| `user.firstName` | `name.givenName` | Okta에서 앱으로 |
| `user.lastName` | `name.familyName` | Okta에서 앱으로 |
| `user.displayName` | `displayName` | Okta에서 앱으로 |

3. 불필요한 매핑을 제거합니다
4. 변경 사항이 있으면 **저장**을 클릭합니다

#### 7단계: 그룹 푸시 구성 (선택 사항)

OneUptime에서 **그룹 푸시**를 활성화한 경우:

1. **그룹 푸시** 탭으로 이동합니다
2. **+ 그룹 푸시**를 클릭합니다
3. **이름으로 그룹 찾기** 또는 **규칙으로 그룹 찾기**를 선택합니다
4. 푸시할 그룹을 검색하고 선택합니다
5. **저장**을 클릭합니다

#### 8단계: 사용자 할당

1. **할당** 탭으로 이동합니다
2. **할당** > **사람에게 할당** 또는 **그룹에 할당**을 클릭합니다
3. 프로비저닝할 사용자 또는 그룹을 선택합니다
4. 각 선택에 대해 **할당**을 클릭합니다
5. **완료**를 클릭합니다

#### 9단계: 프로비저닝 확인

1. Okta 관리 콘솔의 **보고서** > **시스템 로그**로 이동합니다
2. OneUptime 애플리케이션과 관련된 이벤트를 필터링합니다
3. 프로비저닝 이벤트가 성공했는지 확인합니다
4. OneUptime을 확인하여 사용자가 생성되었는지 확인합니다

#### Okta 문제 해결

- **API 자격 증명 테스트 실패**: SCIM 기본 URL과 Bearer 토큰이 올바른지 확인합니다
- **사용자가 프로비저닝되지 않음**: 사용자가 애플리케이션에 할당되어 있고 프로비저닝이 활성화되어 있는지 확인합니다
- **중복 사용자**: `userName` 속성이 고유하고 이메일에 올바르게 매핑되는지 확인합니다
- **그룹 푸시 실패**: 그룹이 존재하고 올바른 구성원이 있는지 확인합니다
- **오류: 401 Unauthorized**: OneUptime에서 Bearer 토큰을 재생성하고 Okta를 업데이트합니다

---

### 기타 ID 공급자

OneUptime의 SCIM 구현은 SCIM v2.0 사양을 따르며 호환 가능한 모든 ID 공급자와 함께 작동해야 합니다. 일반 구성 단계:

1. **SCIM 기본 URL**: 프로젝트의 경우 `https://oneuptime.com/api/identity/scim/v2/{scim-id}`, 상태 페이지의 경우 `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}`
2. **인증**: HTTP Bearer 토큰
3. **필수 사용자 속성**: `userName` (유효한 이메일 주소여야 함)
4. **지원되는 작업**: 사용자 및 그룹에 대한 GET, POST, PUT, PATCH, DELETE

#### 지원되는 SCIM 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|----------|---------|-------------|
| `/ServiceProviderConfig` | GET | SCIM 서버 기능 |
| `/Schemas` | GET | 사용 가능한 리소스 스키마 |
| `/ResourceTypes` | GET | 사용 가능한 리소스 유형 |
| `/Users` | GET, POST | 사용자 목록 조회 및 생성 |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | 개별 사용자 관리 |
| `/Groups` | GET, POST | 그룹/팀 목록 조회 및 생성 (프로젝트 SCIM만) |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | 개별 그룹 관리 (프로젝트 SCIM만) |

#### SCIM 사용자 스키마

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true
}
```

#### SCIM 그룹 스키마

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-id-here",
      "display": "user@example.com"
    }
  ]
}
```

## 자주 묻는 질문

### 사용자가 디프로비저닝되면 어떻게 되나요?

사용자가 디프로비저닝되면 (DELETE 요청 또는 `active: false` 설정에 의해) SCIM 설정에서 구성된 팀에서 제거됩니다. 사용자 계정 자체는 OneUptime에 남아 있지만 프로젝트에 대한 액세스 권한을 잃습니다.

### SSO 없이 SCIM을 사용할 수 있나요?

예, SCIM과 SSO는 독립적인 기능입니다. SSO로 로그인을 허용하면서 사용자 프로비저닝에 SCIM을 사용할 수 있습니다.

### OneUptime에 이미 존재하는 사용자를 어떻게 처리하나요?

SCIM이 이미 존재하는 사용자(이메일로 일치)를 생성하려고 할 때 OneUptime은 중복 사용자를 생성하지 않고 단순히 구성된 기본 팀에 추가합니다.

### 기본 팀과 그룹 푸시의 차이점은 무엇인가요?

- **기본 팀**: SCIM을 통해 프로비저닝된 모든 사용자가 동일한 사전 정의된 팀에 추가됩니다
- **그룹 푸시**: 팀 구성원 자격은 ID 공급자에 의해 관리되어 IdP 그룹 구성원 자격을 기반으로 다른 사용자가 다른 팀에 있을 수 있습니다

### 프로비저닝 동기화는 얼마나 자주 발생하나요?

이는 ID 공급자에 따라 다릅니다:
- **Microsoft Entra ID**: 초기 동기화는 최대 40분이 걸릴 수 있으며 이후 동기화는 40분마다 발생합니다
- **Okta**: 대부분의 작업은 거의 실시간으로 이루어지며 주기적인 전체 동기화가 있습니다
