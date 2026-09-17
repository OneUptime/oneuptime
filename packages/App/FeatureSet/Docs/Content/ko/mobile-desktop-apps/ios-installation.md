# iOS 설치 가이드

iPhone 또는 iPad에 Apple App Store에서 **OneUptime On-Call** 네이티브 iOS 앱을 설치하세요.

## 요구 사항

- **iOS 15.0 이상**을 실행하는 iPhone 또는 iPad
- 활성 OneUptime 계정 (또는 자체 호스팅 OneUptime 인스턴스의 URL)
- 로그인 및 푸시 알림 수신을 위한 인터넷 연결

## App Store에서 설치하기

1. iPhone 또는 iPad에서 **App Store**를 엽니다.
2. **검색** 탭을 누르고 **"OneUptime On-Call"**을 검색하거나, 기기에서 다음 링크를 엽니다:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. **받기**를 누른 후 Face ID, Touch ID 또는 Apple ID 비밀번호로 인증합니다.
4. 설치가 완료되면 **열기**를 누르거나 홈 화면에서 **OneUptime On-Call**을 실행합니다.

## 첫 실행 및 로그인

1. **서버 URL**
   - OneUptime Cloud를 사용하는 경우 기본값인 `https://oneuptime.com`을 그대로 두세요.
   - 자체 호스팅 중이라면 OneUptime 인스턴스의 URL을 입력하세요(예: `https://oneuptime.example.com`).
   - 앱은 계속 진행하기 전에 서버에 연결 가능한지 확인합니다.
2. **로그인**
   - OneUptime 계정의 이메일과 비밀번호를 입력합니다.
   - 이후 실행 시 더 빠른 잠금 해제를 위해 **Face ID** 또는 **Touch ID**를 선택적으로 활성화하세요.
3. **알림 허용**
   - 요청이 표시되면 **허용**을 눌러 앱이 온콜 호출, 인시던트 알림, 확인을 전달할 수 있도록 합니다.

## 푸시 알림

푸시 알림은 Expo Push를 통해 Apple Push Notification 서비스(APNs)로 전달됩니다. 호출이 안정적으로 도달하도록 다음을 확인하세요:

1. **설정 → 알림 → OneUptime On-Call**로 이동합니다.
2. **알림 허용**, **사운드**, **배지**, **잠금 화면 / 배너 / 알림 센터** 전송을 활성화합니다.
3. **알림 그룹화**를 **자동**으로 설정합니다.
4. 온콜 근무 중이라면 근무 시간 동안 **저전력 모드**를 비활성화하고 앱을 강제 종료하지 마세요 — 앱이 강제 종료되면 iOS가 백그라운드 전송을 지연시킬 수 있습니다.
5. 호출을 계속 받고 싶은 **집중 모드(Focus)**에 **OneUptime On-Call**을 추가하세요.

## 업데이트

앱은 App Store를 통해 업데이트됩니다:

- **App Store**를 열고 프로필 사진을 누른 다음 **OneUptime On-Call**까지 스크롤하여 **업데이트**를 누릅니다.
- 또는 **설정 → App Store → 앱 업데이트**를 활성화하여 업데이트를 자동으로 설치합니다.

## 제거

1. 홈 화면에서 **OneUptime On-Call** 아이콘을 **길게 누릅니다**.
2. **앱 제거 → 앱 삭제**를 누릅니다.
3. **삭제**를 눌러 확인합니다.

OneUptime 계정과 온콜 일정은 서버 측에 저장되며 앱을 제거해도 삭제되지 않습니다.

## 문제 해결

**App Store에 "사용 중인 지역에서 이용할 수 없음"이라고 표시되는 경우:**

- 앱은 글로벌 App Store에 게시되어 있습니다. 사용 중인 지역에서 표시되지 않는다면 [지원팀](mailto:support@oneuptime.com)으로 문의하세요.

**로그인 시 "네트워크 오류"가 발생하는 경우:**

- **서버 URL**이 올바르고 기기에서 접근 가능한지 확인하세요.
- 회사 네트워크나 VPN을 사용 중이라면 OneUptime 인스턴스에 접근할 수 있는지 확인하세요.
- 서버가 유효한 인증서를 사용하여 HTTPS로 제공되는지 확인하세요.

**푸시 알림을 받지 못하는 경우:**

- **설정 → 알림 → OneUptime On-Call**을 열고 알림이 허용되어 있는지 확인하세요.
- **방해 금지 모드(Do Not Disturb)**를 비활성화하거나 활성 집중 모드의 허용 목록에 OneUptime On-Call을 추가하세요.
- 서버에 등록된 푸시 토큰을 새로 고치기 위해 로그아웃 후 다시 로그인하세요.
- 자체 호스팅 사용자: OneUptime 인스턴스에 푸시 알림이 구성되어 있는지 확인하세요(자체 호스팅 [Push Notifications](/docs/self-hosted/push-notifications) 가이드 참조).

**Face ID / Touch ID가 작동하지 않는 경우:**

- **설정 → Face ID 및 암호** 또는 **설정 → Touch ID 및 암호**에서 생체 인식이 등록되어 있는지 확인하세요.
- OneUptime On-Call 앱 내부의 **설정** 화면에서 생체 인증 잠금 해제를 다시 활성화하세요.

**앱이 실행 시 충돌하는 경우:**

- App Store에서 최신 버전으로 업데이트하세요.
- 기기를 재시작하세요.
- 문제가 지속되면 앱을 삭제하고 다시 설치한 다음 로그인하세요.

## 지원

여전히 도움이 필요하다면 OneUptime 대시보드를 통해 문의하거나 [GitHub 저장소](https://github.com/OneUptime/oneuptime)에 이슈를 등록하세요.
