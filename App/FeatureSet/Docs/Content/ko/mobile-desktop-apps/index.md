# OneUptime 모바일 및 데스크톱 앱

OneUptime은 브라우저 외부에서 플랫폼을 사용할 수 있는 두 가지 방법을 제공합니다:

- **iOS 및 Android용 네이티브 모바일 앱**으로 **Apple App Store**와 **Google Play**에 게시되어 있습니다. 이 앱은 온콜 호출, 인시던트 알림, 확인(acknowledgement) 작업을 휴대폰으로 직접 전달합니다.
- **Windows, macOS, Linux용 설치 가능한 데스크톱 앱**은 브라우저에서 직접 설치하는 프로그레시브 웹 앱(PWA)으로 제공됩니다. 이를 통해 OneUptime 대시보드를 컴퓨터에서 독립된 창, 아이콘, 알림 영역으로 사용할 수 있습니다.

## 모바일 (네이티브 앱)

**OneUptime On-Call** 앱은 React Native로 구축된 네이티브 애플리케이션입니다. 공식 스토어를 통해 배포되므로 자동 업데이트, 푸시 알림, 생체 인증 잠금 해제를 사용할 수 있습니다.

- **iOS** — [App Store에서 다운로드](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391). iOS 15.0 이상이 필요합니다. [iOS 설치 가이드](./ios-installation.md)를 참조하세요.
- **Android** — [Google Play에서 받기](https://play.google.com/store/apps/details?id=com.oneuptime.oncall). Android 8.0 이상이 필요합니다. Google Play가 없는 기기를 위해 [APK 직접 다운로드](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk)도 제공됩니다. [Android 설치 가이드](./android-installation.md)를 참조하세요.

## 데스크톱 (프로그레시브 웹 앱)

OneUptime의 웹 대시보드는 프로그레시브 웹 앱이므로, 스토어를 거치지 않고도 최신 브라우저에서 데스크톱 애플리케이션으로 설치할 수 있습니다.

- [Windows 설치](./windows-installation.md)
- [macOS 설치](./macos-installation.md)
- [Linux 설치](./linux-installation.md)

### 데스크톱 시작하기

1. Chromium 기반 브라우저(Chrome, Edge) 또는 Safari에서 OneUptime 인스턴스를 엽니다.
2. 주소 표시줄의 **설치** 버튼을 찾거나 **파일 → Dock에 추가 / 앱 → 이 사이트를 앱으로 설치**를 선택합니다.
3. 시작 메뉴, Launchpad 또는 애플리케이션 런처에서 설치된 앱을 실행합니다.

### 데스크톱 문제 해결

**설치 옵션이 표시되지 않는 경우:**
- 지원되는 브라우저를 사용하고 있는지 확인하세요.
- OneUptime 인스턴스가 HTTPS로 제공되는지 확인하세요.
- 페이지를 새로 고치거나 브라우저 캐시를 지우세요.

**푸시 알림이 작동하지 않는 경우:**
- 브라우저가 요청할 때 알림 권한을 허용하세요.
- 운영 체제의 브라우저 알림 설정을 확인하세요.
- 자체 호스팅 사용자: OneUptime 인스턴스에 푸시 알림이 구성되어 있는지 확인하세요.

## 지원

- 모바일 관련 문제: [iOS](./ios-installation.md) 또는 [Android](./android-installation.md) 설치 가이드를 확인하세요.
- 데스크톱 관련 문제: [Windows](./windows-installation.md), [macOS](./macos-installation.md) 또는 [Linux](./linux-installation.md) 설치 가이드를 확인하세요.
- 일반적인 질문: [FAQ 및 문제 해결](./faq-troubleshooting.md) 페이지를 참조하세요.
- 버그 신고 또는 기능 요청은 [GitHub 저장소](https://github.com/OneUptime/oneuptime)에서 등록하세요.
