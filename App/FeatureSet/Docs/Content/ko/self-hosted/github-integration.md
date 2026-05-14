# GitHub 통합

자체 호스팅 OneUptime 인스턴스와 GitHub를 통합하려면 GitHub 앱을 생성하고 필요한 환경 변수를 구성해야 합니다. 이를 통해 OneUptime이 코드 저장소 관리를 위해 GitHub 저장소에 연결할 수 있습니다.

## 전제 조건

- 조직 저장소의 경우 조직 관리자 액세스 또는 개인 계정 액세스가 있는 GitHub 계정
- OneUptime 서버 구성에 대한 액세스

## 설정 지침

### 1단계: GitHub 앱 생성

1. GitHub로 이동하여 조직 또는 개인 설정으로 이동합니다:
   - **조직의 경우:** `https://github.com/organizations/YOUR_ORG/settings/apps`로 이동합니다
   - **개인 계정의 경우:** `https://github.com/settings/apps`로 이동합니다

2. **"New GitHub App"**을 클릭합니다

3. 등록 양식을 작성합니다:
   - **GitHub 앱 이름:** OneUptime (또는 고유한 이름) - **이 이름을 저장하십시오. `GITHUB_APP_NAME` 환경 변수에 필요합니다**
   - **홈페이지 URL:** `https://your-oneuptime-domain.com`
   - **콜백 URL:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **설정 URL:** `https://your-oneuptime-domain.com/api/github/auth/callback` - **중요: 이것은 앱 설치 후 GitHub가 사용자를 리디렉션하는 URL입니다. 리디렉션이 작동하려면 설정되어야 합니다.**
   - **업데이트 시 리디렉션:** 사용자가 앱 설치를 업데이트한 후 리디렉션하려면 이 옵션을 체크합니다
   - **웹훅 URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **웹훅 시크릿:** 보안 무작위 문자열 생성 (나중을 위해 저장)

### 2단계: 앱 권한 구성

"권한 및 이벤트" 섹션에서 다음 권한을 구성합니다:

**저장소 권한:**

| 권한 | 액세스 수준 | 목적 |
|------------|--------------|---------|
| 내용 | 읽기 및 쓰기 | 저장소 파일 읽기, 브랜치 푸시 (AI 에이전트에 필요) |
| 풀 리퀘스트 | 읽기 및 쓰기 | 풀 리퀘스트 생성 및 관리 |
| 이슈 | 읽기 및 쓰기 | 이슈 읽기 및 댓글 달기 |
| 커밋 상태 | 읽기 | 빌드/CI 상태 확인 |
| 작업 | 읽기 | GitHub Actions 워크플로 실행 및 로그 읽기 |
| 메타데이터 | 읽기 | 기본 저장소 메타데이터 (필수) |

**조직 권한 (조직과 함께 사용하는 경우):**

| 권한 | 액세스 수준 | 목적 |
|------------|--------------|---------|
| 구성원 | 읽기 | 조직 구성원 나열 |

**계정 권한:**

| 권한 | 액세스 수준 | 목적 |
|------------|--------------|---------|
| 이메일 주소 | 읽기 | 알림을 위한 사용자 이메일 읽기 |

### 3단계: 웹훅 이벤트 구독

OneUptime이 실시간 업데이트를 받으려면 다음 웹훅 이벤트를 구독합니다:

- **풀 리퀘스트** - PR이 열리거나, 닫히거나, 병합될 때 알림 수신
- **푸시** - 코드가 푸시될 때 알림 수신
- **워크플로 실행** - CI/CD 상태 업데이트 수신

### 4단계: 설치 액세스 설정

"이 GitHub 앱을 어디에 설치할 수 있나요?" 아래에서 선택합니다:
- **이 계정에만** - 프라이빗/내부 사용
- **모든 계정** - 다른 사람이 앱을 설치하도록 허용하려는 경우

### 5단계: GitHub 앱 생성

1. **"Create GitHub App"**을 클릭합니다
2. 앱의 설정 페이지로 리디렉션됩니다
3. 다음 값을 기록합니다:
   - **앱 ID** - 앱 설정 페이지 상단에서 찾을 수 있습니다
   - **클라이언트 ID** - "정보" 섹션에서 찾을 수 있습니다

### 6단계: 클라이언트 시크릿 생성

1. GitHub 앱 설정에서 "클라이언트 시크릿"으로 스크롤합니다
2. **"새 클라이언트 시크릿 생성"**을 클릭합니다
3. 즉시 시크릿을 복사합니다 - 다시 볼 수 없습니다

### 7단계: 개인 키 생성

1. "개인 키" 섹션으로 스크롤합니다
2. **"개인 키 생성"**을 클릭합니다
3. `.pem` 파일이 자동으로 다운로드됩니다
4. 이 파일을 안전하게 보관합니다 - GitHub 앱으로 인증하는 데 사용됩니다

### 8단계: OneUptime 환경 변수 구성

#### Docker Compose

Docker Compose를 사용하는 경우 `config.env` 파일에 다음 환경 변수를 추가합니다:

```bash
# GitHub 앱 구성
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # GitHub 앱의 정확한 이름 (예: "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**참고:** 개인 키의 경우 base64로 인코딩하고 환경이 멀티 라인 문자열을 지원하지 않는 경우 줄 바꿈 없이 붙여 넣습니다.

#### Kubernetes + Helm

Kubernetes + Helm을 사용하는 경우 `values.yaml` 파일에 다음을 추가합니다:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME"  # GitHub 앱의 정확한 이름
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**중요:** 이러한 환경 변수를 추가한 후 OneUptime 서버를 재시작하여 적용합니다.

### 9단계: GitHub 앱 설치

1. GitHub 앱의 공개 페이지로 이동합니다: `https://github.com/apps/YOUR_APP_NAME`
2. **"설치"** 또는 **"구성"**을 클릭합니다
3. 앱을 설치할 조직 또는 계정을 선택합니다
4. 앱이 액세스할 수 있는 저장소를 선택합니다:
   - **모든 저장소** - 현재 및 미래의 모든 저장소에 대한 액세스
   - **특정 저장소만** - 특정 저장소 선택
5. **"설치"**를 클릭합니다

### 10단계: OneUptime에서 저장소 연결

1. OneUptime 대시보드에 로그인합니다
2. **더보기** > **코드 저장소**로 이동합니다
3. **"저장소 생성"**을 클릭하거나 GitHub 앱 설치 흐름을 사용합니다
4. GitHub에서 리디렉션된 경우 설치 ID가 자동으로 캡처됩니다
5. 목록에서 연결할 저장소를 선택합니다
6. **"연결"**을 클릭하여 저장소를 OneUptime 프로젝트에 연결합니다

## 환경 변수 참조

| 변수 | 설명 | 필수 여부 |
|----------|-------------|----------|
| `GITHUB_APP_ID` | GitHub 앱 설정의 앱 ID | 예 |
| `GITHUB_APP_NAME` | GitHub 앱의 정확한 이름 (설치 URL에 사용) | 예 |
| `GITHUB_APP_CLIENT_ID` | GitHub 앱 설정의 클라이언트 ID | 예 |
| `GITHUB_APP_CLIENT_SECRET` | 생성한 클라이언트 시크릿 | 예 |
| `GITHUB_APP_PRIVATE_KEY` | 개인 키 (.pem 파일)의 내용 | 예 |
| `GITHUB_APP_WEBHOOK_SECRET` | 웹훅 페이로드 검증을 위한 웹훅 시크릿 | 아니요 (권장) |

## 문제 해결

### 일반적인 문제

**GitHub 앱 설치 후 OneUptime으로 리디렉션되지 않는 경우:**
- GitHub 앱 설정에서 **설정 URL**이 다음으로 구성되어 있는지 확인합니다: `https://your-oneuptime-domain.com/api/github/auth/callback`
- GitHub 앱 설정 > "포스트 설치" 섹션으로 이동하여 설정 URL이 올바르게 설정되어 있는지 확인합니다
- "업데이트 시 리디렉션" 옵션도 체크되어 있어야 합니다
- 참고: 설정 URL은 콜백 URL과 다릅니다 - 두 URL 모두 동일한 `/api/github/auth/callback` 엔드포인트를 가리켜야 합니다

**"GitHub 앱이 구성되지 않음" 오류:**
- `GITHUB_APP_CLIENT_ID` 환경 변수가 설정되어 있는지 확인합니다
- 환경 변수를 설정한 후 OneUptime 서버를 재시작합니다

**"잘못된 웹훅 서명" 오류:**
- `GITHUB_APP_WEBHOOK_SECRET`이 GitHub에 구성된 시크릿과 일치하는지 확인합니다
- 웹훅 URL이 올바르고 인터넷에서 액세스 가능한지 확인합니다

**"설치 액세스 토큰 가져오기 실패" 오류:**
- `GITHUB_APP_PRIVATE_KEY`가 올바르게 형식화되어 있는지 확인합니다
- 개인 키에 BEGIN/END 마커가 포함되어 있는지 확인합니다
- 앱 ID가 올바른지 확인합니다

**설치 후 저장소를 볼 수 없는 경우:**
- GitHub 앱이 연결하려는 저장소에 대한 액세스 권한이 있는지 확인합니다
- GitHub에서 설치 권한을 확인합니다 (설정 > 애플리케이션 > 설치된 GitHub 앱)

**웹훅 이벤트가 수신되지 않는 경우:**
- 웹훅 URL이 공개적으로 액세스 가능한지 확인합니다
- 앱 설정에서 GitHub 앱 웹훅 전달 로그를 확인합니다
- 웹훅 시크릿이 올바르게 구성되어 있는지 확인합니다

### 웹훅 전달 확인

1. GitHub 앱 설정으로 이동합니다
2. 사이드바에서 "고급"을 클릭합니다
3. "최근 전달"을 보고 웹훅 시도 및 응답을 확인합니다

## 보안 모범 사례

1. **시크릿을 정기적으로 교체** - 주기적으로 새 클라이언트 시크릿과 개인 키를 생성합니다
2. **웹훅 시크릿 사용** - 항상 웹훅 시크릿을 구성하여 페이로드 신뢰성을 검증합니다
3. **저장소 액세스 제한** - 연결해야 하는 저장소에만 액세스를 부여합니다
4. **웹훅 전달 모니터링** - 실패한 전달이나 의심스러운 활동을 정기적으로 확인합니다
5. **개인 키를 안전하게 보관** - 개인 키를 버전 제어에 절대 커밋하지 마십시오

## 지원

GitHub 통합에 문제가 발생한 경우:

1. 위의 문제 해결 섹션을 확인합니다
2. 자세한 오류 메시지에 대한 OneUptime 로그를 검토합니다
3. [hello@oneuptime.com](mailto:hello@oneuptime.com)으로 문의합니다

이 통합을 개선하기 위한 피드백을 환영합니다!
