# FAQ 및 문제 해결

OneUptime 모바일 및 데스크톱 앱에 대한 자주 묻는 질문과 해결 방법입니다.

## OneUptime은 앱을 어떻게 배포하나요?

- **모바일 (iOS 및 Android):** OneUptime은 **OneUptime On-Call**이라는 네이티브 앱을 제공합니다. [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)와 [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)에 게시되어 있습니다. Google Play가 없는 Android 기기를 위해 서명된 [APK 다운로드](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)도 제공됩니다.
- **데스크톱 (Windows, macOS, Linux):** OneUptime 웹 대시보드는 프로그레시브 웹 앱(PWA)입니다. Chromium 기반 브라우저 또는 Safari에서 직접 데스크톱 애플리케이션으로 설치할 수 있으며, 스토어 계정이 필요하지 않습니다.

## 모바일 앱 FAQ

### 어떤 기기가 지원되나요?

- **iOS:** iOS 15.0 이상을 실행하는 iPhone 또는 iPad.
- **Android:** Android 8.0 (Oreo) 이상을 실행하는 휴대폰 및 태블릿.

### 앱은 무료인가요?

네. OneUptime On-Call 앱은 무료로 설치할 수 있습니다. 기존 OneUptime 계정으로 로그인하면 됩니다.

### 자체 호스팅 OneUptime 인스턴스에서 앱을 사용할 수 있나요?

네. 첫 실행 시 앱이 **서버 URL**을 요청합니다. 자체 호스팅 인스턴스의 URL을 입력하세요(예: `https://oneuptime.example.com`). 앱은 로그인을 허용하기 전에 서버에 연결 가능한지 확인합니다.

자체 호스팅 인스턴스의 푸시 알림에 대해서는 [Push Notifications](/docs/self-hosted/push-notifications) 가이드를 따르세요.

### 업데이트는 어떻게 전달되나요?

- **iOS:** App Store를 통해서. **설정 → App Store**에서 자동 업데이트를 활성화하거나 App Store 프로필에서 수동으로 업데이트하세요.
- **Android (Google Play):** 자동 업데이트가 기본적으로 활성화되어 있습니다.
- **Android (APK 사이드로드):** 위 GitHub Releases 링크에서 최신 APK를 다운로드하여 설치하세요.

### 왜 푸시 알림을 받지 못하나요?

모바일 푸시는 Expo Push를 통해 APNs (iOS) 및 FCM (Android)을 사용합니다. 다음을 확인하세요:

1. OS 수준에서 **OneUptime On-Call**에 대한 알림이 활성화되어 있습니다.
2. 배터리 최적화가 비활성화되어 있고 백그라운드 활동이 허용됩니다 (Android).
3. 방해 금지 모드 또는 집중 모드가 꺼져 있거나 앱이 예외 목록에 있습니다.
4. 로그인되어 있습니다 — 푸시 토큰은 로그인 후에만 서버에 등록됩니다.
5. **자체 호스팅 전용:** OneUptime 인스턴스에 푸시 알림이 구성되어 있습니다. [Push Notifications](/docs/self-hosted/push-notifications) 가이드를 참조하세요.

### 휴대폰의 데이터는 안전한가요?

- 모든 API 트래픽은 HTTPS를 사용합니다.
- 액세스 및 갱신 토큰은 기기의 보안 키스토어(iOS의 Keychain, Android의 Keystore)에 저장됩니다.
- 앱 내 **설정** 화면에서 Face ID / Touch ID / 지문 잠금 해제를 요구하도록 설정할 수 있습니다.

### 앱을 여러 기기에 설치할 수 있나요?

네. 필요한 만큼 많은 기기에서 동일한 OneUptime 계정으로 로그인하세요. 각 기기는 자체 푸시 알림을 받습니다.

### 어떻게 제거하나요?

- **iOS:** 아이콘을 길게 누른 후 → **앱 제거** → **앱 삭제**.
- **Android:** 아이콘을 길게 누른 후 → **제거**, 또는 **설정 → 앱 → OneUptime On-Call → 제거**.

OneUptime 계정과 데이터는 서버에 저장되어 있으며 앱을 제거해도 삭제되지 않습니다.

## 데스크톱 앱 (PWA) FAQ

### 프로그레시브 웹 앱(PWA)이란 무엇인가요?

프로그레시브 웹 앱은 네이티브 데스크톱 앱처럼 설치할 수 있는 웹 애플리케이션입니다. 설치되면 자체 창에서 실행되고, 런처에 자체 아이콘이 있으며, 데스크톱 알림을 전달할 수 있습니다 — Windows Store, Mac App Store 또는 다른 배포 채널을 거치지 않고도요.

### 데스크톱 앱은 왜 PWA 기술을 사용하나요?

- **즉시 업데이트** — 배포하는 즉시 앱이 OneUptime 인스턴스와 동기화됩니다.
- **스토어 계정 불필요** — 최신 브라우저에서 직접 설치할 수 있습니다.
- **단일 코드베이스** — 동일한 대시보드가 Windows, macOS, Linux에서 실행됩니다.

### "설치" 버튼이 표시되지 않는 이유는 무엇인가요?

1. Chromium 기반 브라우저(Chrome, Edge, Brave, Arc) 또는 Safari(macOS Sonoma 이상)를 사용하세요.
2. OneUptime 인스턴스가 유효한 인증서를 사용하여 HTTPS로 제공되는지 확인하세요.
3. 브라우저 캐시를 지우고 다시 로드하세요.
4. 앱이 이미 설치되어 있을 수 있습니다 — 응용 프로그램 / 시작 메뉴를 확인하세요.

### 데스크톱 앱은 어떻게 업데이트하나요?

PWA는 온라인 상태에서 열 때마다 자동으로 업데이트됩니다. 업데이트를 강제로 적용하려면 **Ctrl+R** (Windows/Linux) 또는 **Cmd+R** (macOS)로 창을 새로 고치세요.

### 데스크톱 PWA는 어떻게 제거하나요?

- **Windows:** **설정 → 앱 → OneUptime → 제거**, 또는 시작 메뉴 항목을 마우스 오른쪽 버튼으로 클릭하세요.
- **macOS:** **응용 프로그램**에서 앱을 휴지통으로 드래그하거나, Dock 아이콘을 마우스 오른쪽 버튼으로 클릭하고 **제거**를 선택하세요.
- **Linux:** 애플리케이션 런처의 제거 옵션을 사용하거나 관련 `.desktop` 파일을 삭제하세요.

## 문제 해결

### 모바일 앱 문제

**앱이 로그인되지 않거나 "네트워크 오류"가 발생하는 경우:**
- **서버 URL**이 올바르고 휴대폰에서 접근 가능한지 확인하세요.
- 휴대폰이 인터넷에 연결되어 있는지 확인하세요.
- VPN 뒤에 있는 자체 호스팅 인스턴스의 경우 VPN이 활성화되어 있는지 확인하세요.

**푸시 알림이 지연되거나 누락되는 경우 (Android):**
- 배터리 최적화를 비활성화하세요: **설정 → 앱 → OneUptime On-Call → 배터리 → 제한 없음**.
- 앱에 대한 데이터 절약 모드를 비활성화하세요.
- Samsung 기기에서는 OneUptime On-Call에 대한 **디바이스 케어 → 배터리 → 백그라운드 사용 제한**을 해제하세요.

**푸시 알림이 지연되거나 누락되는 경우 (iOS):**
- 앱을 강제 종료하지 마세요 — iOS가 백그라운드 전송을 일시 중지할 수 있습니다.
- 온콜 근무 중에는 저전력 모드를 비활성화하세요.
- 활성 집중 모드의 허용 목록에 OneUptime On-Call을 추가하세요.

**Face ID / Touch ID / 지문이 작동하지 않는 경우:**
- OS 설정에서 생체 인식이 등록되어 있는지 확인하세요.
- OneUptime On-Call 앱 내부의 **설정** 화면에서 생체 인증 잠금 해제를 다시 활성화하세요.

### 데스크톱 앱 (PWA) 문제

**설치 버튼이 누락된 경우:**
- 지원되는 브라우저를 사용하세요(Chromium 기반 또는 macOS Sonoma 이상의 Safari).
- OneUptime 인스턴스가 HTTPS로 제공되는지 확인하세요.
- 페이지 로드가 완료될 때까지 기다린 다음 주소 표시줄에서 설치 아이콘을 확인하세요.

**데스크톱 알림이 표시되지 않는 경우:**
- 브라우저가 요청할 때 알림을 허용하세요.
- OS 알림 설정을 확인하세요(Windows의 집중 지원, macOS 알림, Linux 알림 데몬).
- 자체 호스팅 인스턴스의 경우 [Push Notifications](/docs/self-hosted/push-notifications) 구성이 완료되었는지 확인하세요.

**앱이 최신 데이터를 표시하지 않는 경우:**
- **Ctrl+R** / **Cmd+R**로 새로 고치세요.
- 창을 닫았다가 다시 여세요.
- 네트워크 연결을 확인하세요.

## 지원

여전히 도움이 필요하다면:

- 모바일: [iOS](./ios-installation.md) 또는 [Android](./android-installation.md) 설치 가이드를 참조하세요.
- 데스크톱: [Windows](./windows-installation.md), [macOS](./macos-installation.md) 또는 [Linux](./linux-installation.md) 설치 가이드를 참조하세요.
- [OneUptime GitHub 저장소](https://github.com/OneUptime/oneuptime)에 이슈를 등록하세요.
- OneUptime 대시보드를 통해 지원팀에 문의하세요.
