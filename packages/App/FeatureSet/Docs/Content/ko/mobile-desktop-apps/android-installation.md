# Android 설치 가이드

Google Play Store에서 **OneUptime On-Call** 네이티브 Android 앱을 설치하거나, Google Play가 없는 기기에서는 APK를 직접 사이드로드하세요.

## 요구 사항

- **Android 8.0 (Oreo) 이상**을 실행하는 Android 휴대폰 또는 태블릿
- 활성 OneUptime 계정 (또는 자체 호스팅 OneUptime 인스턴스의 URL)
- 로그인 및 푸시 알림 수신을 위한 인터넷 연결

## 옵션 1: Google Play에서 설치 (권장)

1. 기기에서 **Google Play Store**를 엽니다.
2. **"OneUptime On-Call"**을 검색하거나, 기기에서 다음 링크를 엽니다:
   [https://play.google.com/store/apps/details?id=com.oneuptime.oncall](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)
3. **설치**를 누릅니다.
4. 설치가 완료되면 **열기**를 누르거나 앱 서랍에서 **OneUptime On-Call**을 실행합니다.

## 옵션 2: APK 직접 설치

Google Play가 없는 기기(예: GrapheneOS, /e/OS, Huawei 기기)에서는 GitHub Releases에서 공식 APK를 설치하세요:

1. Android 기기에서 다음 링크를 엽니다:
   [https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)
2. 요청이 표시되면 브라우저가 알 수 없는 앱을 설치하도록 허용합니다:
   **설정 → 앱 → \[사용 중인 브라우저\] → 알 수 없는 앱 설치 → 이 출처에서 허용**.
3. 다운로드한 APK를 열고 **설치**를 누릅니다.
4. 앱 서랍에서 **OneUptime On-Call**을 실행합니다.

APK는 Play Store 릴리스와 동일한 소스에서 OneUptime이 빌드하고 서명합니다. 사이드로드 시 앱 업데이트는 자동으로 이루어지지 않으므로, 새 버전이 릴리스될 때마다 위 링크에서 최신 APK를 다운로드하세요.

## 첫 실행 및 로그인

1. **서버 URL**
   - OneUptime Cloud를 사용하는 경우 기본값인 `https://oneuptime.com`을 그대로 두세요.
   - 자체 호스팅 중이라면 OneUptime 인스턴스의 URL을 입력하세요(예: `https://oneuptime.example.com`).
   - 앱은 계속 진행하기 전에 서버에 연결 가능한지 확인합니다.
2. **로그인**
   - OneUptime 계정의 이메일과 비밀번호를 입력합니다.
   - 이후 실행 시 더 빠른 잠금 해제를 위해 **생체 인증 잠금 해제**(지문)를 선택적으로 활성화하세요.
3. **알림 허용**
   - 요청이 표시되면 **허용**을 눌러 앱이 온콜 호출, 인시던트 알림, 확인을 전달할 수 있도록 합니다.

## 푸시 알림

푸시 알림은 Expo Push를 통해 Firebase Cloud Messaging(FCM)으로 전달됩니다. 온콜 근무 중 호출이 안정적으로 도달하도록 다음을 확인하세요:

1. **설정 → 앱 → OneUptime On-Call → 알림**을 열고 모든 카테고리가 활성화되어 있는지 확인합니다.
2. **설정 → 앱 → OneUptime On-Call → 배터리**를 열고 **제한 없음**을 선택하세요(또는 배터리 최적화를 비활성화하세요). 그러면 OS가 백그라운드 푸시를 지연시키지 않습니다.
3. 앱이 백그라운드에서 실행될 수 있도록 허용하고 "데이터 절약 모드" 제한을 해제하세요.
4. Samsung 기기를 사용하는 경우 OneUptime On-Call에 대해 **설정 → 디바이스 케어 → 배터리 → 백그라운드 사용 제한**도 해제하세요.
5. 온콜 근무 중에도 호출이 울리도록 OneUptime On-Call을 **방해 금지 모드(Do Not Disturb)** 예외 목록에 추가하세요.

## 업데이트

**Google Play:**

- 업데이트가 자동으로 설치됩니다. 수동으로 실행하려면 **Play Store → 프로필 → 앱 및 기기 관리 → 업데이트 사용 가능 → OneUptime On-Call → 업데이트**를 엽니다.

**APK 사이드로드:**

- 위 GitHub Releases 링크에서 최신 APK를 다시 다운로드하여 기존 앱 위에 설치하세요. 데이터, 서버 URL, 로그인 정보는 그대로 유지됩니다.

## 제거

1. **OneUptime On-Call** 아이콘을 **길게 누른** 다음 **제거**를 누릅니다.
2. 또는 **설정 → 앱 → OneUptime On-Call → 제거**를 엽니다.
3. 확인하여 앱을 제거합니다.

OneUptime 계정과 온콜 일정은 서버 측에 저장되며 앱을 제거해도 삭제되지 않습니다.

## 문제 해결

**로그인 시 "네트워크 오류"가 발생하는 경우:**

- **서버 URL**이 올바르고 기기에서 접근 가능한지 확인하세요.
- 회사 네트워크나 VPN을 사용 중이라면 OneUptime 인스턴스에 접근할 수 있는지 확인하세요.
- 서버가 유효한 인증서를 사용하여 HTTPS로 제공되는지 확인하세요.

**푸시 알림을 받지 못하는 경우:**

- **설정 → 앱 → OneUptime On-Call → 알림**에서 알림이 활성화되어 있는지 확인하세요.
- OneUptime On-Call의 배터리 최적화를 비활성화하세요(위의 푸시 알림 섹션 참조).
- 방해 금지 모드가 꺼져 있거나 OneUptime On-Call이 예외 목록에 있는지 확인하세요.
- 서버에 등록된 푸시 토큰을 새로 고치기 위해 로그아웃 후 다시 로그인하세요.
- 자체 호스팅 사용자: OneUptime 인스턴스에 푸시 알림이 구성되어 있는지 확인하세요(자체 호스팅 [Push Notifications](/docs/self-hosted/push-notifications) 가이드 참조).

**생체 인증 잠금 해제가 작동하지 않는 경우:**

- **설정 → 보안 → 지문**에서 지문을 등록하세요.
- OneUptime On-Call 앱 내부의 **설정** 화면에서 생체 인증 잠금 해제를 다시 활성화하세요.

**APK 설치가 차단되는 경우:**

- 브라우저에 알 수 없는 앱 설치 권한을 부여해야 합니다(위의 옵션 2 참조).
- 일부 통신사 또는 기업 기기 프로필은 사이드로드를 완전히 차단합니다. 이 경우 Google Play 버전을 대신 사용하세요.

**앱이 실행 시 충돌하는 경우:**

- Google Play의 최신 버전 또는 최신 APK로 업데이트하세요.
- 기기를 재시작하세요.
- 문제가 지속되면 앱을 제거하고 다시 설치한 다음 로그인하세요.

## 지원

여전히 도움이 필요하다면 OneUptime 대시보드를 통해 문의하거나 [GitHub 저장소](https://github.com/OneUptime/oneuptime)에 이슈를 등록하세요.
