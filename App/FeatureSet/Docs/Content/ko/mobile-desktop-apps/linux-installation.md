# Linux 설치 가이드

포괄적인 모니터링 및 인시던트 관리를 위해 Linux 배포판에 OneUptime을 데스크탑 애플리케이션으로 설치합니다.

## 설치 방법

### 방법 1: Google Chrome/Chromium (권장)

Chrome과 Chromium은 네이티브 데스크탑 통합으로 최상의 Linux PWA 경험을 제공합니다.

#### PWA 설치 단계:
1. **Chrome/Chromium에서 OneUptime 열기**
   - 브라우저를 실행합니다
   - OneUptime 인스턴스 URL로 이동합니다
   - OneUptime 계정에 로그인합니다
   - 페이지가 완전히 로드될 때까지 기다립니다

2. **PWA 설치**
   - 주소 표시줄에서 **설치 아이콘** (⊞)을 찾습니다
   - **"OneUptime 설치"**를 클릭합니다
   - 또는 **Chrome 메뉴** (⋮) → **추가 도구** → **바로 가기 만들기**를 사용합니다

3. **설치 옵션**
   - 네이티브 앱 경험을 위해 **"창으로 열기"**를 체크합니다
   - 원하는 경우 앱 이름을 커스터마이징합니다
   - 데스크탑 바로 가기 생성 선택
   - **"설치"** 또는 **"만들기"**를 클릭합니다

4. **앱 실행**
   - 애플리케이션 런처에서 OneUptime을 찾습니다
   - 또는 데스크탑 바로 가기를 사용합니다
   - 앱이 전용 창으로 열립니다

### 방법 2: Firefox

Firefox는 기본 데스크탑 통합과 함께 Linux에서 PWA 설치를 지원합니다.

1. **PWA 설치**:
   - Firefox에서 OneUptime을 엽니다
   - 설치 배너 또는 프롬프트를 찾습니다
   - 사용 가능한 경우 **"설치"**를 클릭합니다
   - 참고: Chrome에 비해 데스크탑 통합이 제한적입니다

### 방법 3: Microsoft Edge

Edge는 Linux에서 사용 가능하며 좋은 PWA 지원을 제공합니다.

1. **PWA 설치**: Chrome 방법과 동일한 단계를 따릅니다




## 업데이트 및 유지 관리

### 자동 업데이트
OneUptime PWA는 자동으로 업데이트됩니다:
- 브라우저가 앱을 새로 고침할 때 업데이트가 적용됩니다
- 중요한 보안 업데이트가 즉시 배포됩니다
- 수동 개입이 필요하지 않습니다


## 제거


### 브라우저별 제거
```bash
# Chrome PWA 관리
google-chrome chrome://apps/

# OneUptime 관련 브라우저 데이터 모두 제거
rm -rf ~/.config/google-chrome/Default/Local\ Storage/leveldb/
rm -rf ~/.cache/google-chrome/Default/
```

## 업데이트 및 유지 관리

### 자동 업데이트
OneUptime PWA는 자동으로 업데이트됩니다:
- 브라우저가 앱을 새로 고침할 때 업데이트가 적용됩니다
- 중요한 보안 업데이트가 즉시 배포됩니다
- 수동 개입이 필요하지 않습니다
