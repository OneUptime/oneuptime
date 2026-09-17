# 푸시 알림

네이티브 푸시 알림(iOS/Android)은 **Expo Push**를 사용합니다. 자체 호스팅 인스턴스는 기본적으로 OneUptime 푸시 릴레이를 사용하며 해당 릴레이로의 아웃바운드 네트워크 접근이 필요합니다.

## 작동 방식

OneUptime 모바일 앱은 백엔드에 Expo Push Token을 등록합니다. 백엔드는 OneUptime 릴레이를 통해 전송하며, `EXPO_ACCESS_TOKEN`을 설정하면 Expo에 직접 전송합니다. Expo는 Apple APNs 또는 Google FCM으로 전달하여 기기에 알림을 배달합니다.

웹 푸시 알림은 VAPID 키와 Web Push 프로토콜을 계속 사용합니다.

## 자체 호스팅 설정

공식 모바일 앱과 기본 릴레이를 사용할 때는 서버에 Expo 자격 증명이 필요하지 않습니다. 직접 전송하려면 앱의 Expo 프로젝트에 맞는 자격 증명을 `EXPO_ACCESS_TOKEN`에 설정하세요. 웹 푸시에는 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`가 필요합니다.

## 네트워크 접근

| 방향 | 대상 | 프로토콜 / 포트 | 필요한 경우 |
| --- | --- | --- | --- |
| OneUptime → 기본 릴레이 | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN`이 없는 모바일 푸시. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN`을 설정한 직접 모바일 푸시. |
| OneUptime → 브라우저 푸시 서비스 | 푸시 구독에 저장된 HTTPS 엔드포인트 | HTTPS / 일반적으로 TCP 443 | 웹 푸시. |
| 모바일 앱 또는 브라우저 → OneUptime | OneUptime 호스트 이름 | HTTPS / TCP 443 | 로그인, 기기 등록, 알림 링크 열기. |

`PUSH_NOTIFICATION_RELAY_URL`을 변경하면 해당 호스트 이름과 설정한 포트를 허용하세요. 사용자 지정 릴레이는 OneUptime 릴레이 API를 구현해야 합니다. 기본값과 전달 방식 선택은 [OneUptime 설정](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) 및 [푸시 서비스](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts), 직접 엔드포인트는 [Expo 전송 안내](https://docs.expo.dev/push-notifications/sending-notifications/)를 참고하세요.

웹 푸시는 팀이 사용하는 브라우저 구독의 실제 엔드포인트 호스트를 허용해야 합니다. OneUptime은 `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com`, `push.apple.com`과 하위 도메인을 허용합니다. 예로 `updates.push.services.mozilla.com`, `web.push.apple.com`이 있습니다. [브라우저 구독](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription)이 대상을 제공하므로 Expo나 릴레이만 허용해서는 웹 푸시를 사용할 수 없습니다.

알림을 보내는 OneUptime 프로세스의 DNS와 아웃바운드 TLS를 허용하세요. 신뢰 저장소가 대상 인증서를 검증할 수 있어야 하고, 프록시는 대화형 인증 없이 API 요청을 전달해야 합니다. 푸시 제공자는 OneUptime의 웹훅을 호출하지 않습니다. 기기가 VPN 등 비공개 연결로 접근할 수 있다면 서버를 비공개로 유지할 수 있습니다. 릴레이나 외부 푸시 서비스에 접근할 수 없는 서버는 알림을 전달할 수 없습니다.

기기 연결은 별도 요구 사항입니다. iOS는 보통 TCP 5223과 대체 포트 TCP 443으로 APNs에 접근합니다. 최신 대상 대역은 [Apple 안내](https://support.apple.com/en-us/102266)를 참고하세요. Android는 TCP 5228–5230과 443으로 FCM에 접근합니다. 최신 호스트와 규칙은 [Google 안내](https://firebase.google.com/docs/cloud-messaging/network-configuration)를 참고하세요. 이러한 기기 포트를 OneUptime의 인바운드로 열 필요는 없습니다. 서버의 모바일 푸시는 APNs/FCM 직접 연결 대신 릴레이나 Expo를 사용합니다.

전송 컨테이너 또는 Pod에서 선택한 전달 방식의 대상으로 DNS와 HTTPS 연결을 확인하세요. **User Settings > Notification Methods > Push**에서 테스트를 보내 등록한 기기에 도착했는지 확인하세요. 웹 푸시는 브라우저별로 테스트하세요. OneUptime 로그에서 릴레이, Expo 또는 web-push 오류를 확인하세요. API가 요청을 수락했다고 해서 기기 수신이 확인되는 것은 아닙니다.

## 문제 해결

### 푸시 알림이 도착하지 않는 경우

- 모바일 앱이 EAS Build로 빌드되었는지 확인합니다 (Expo Go는 푸시 알림을 지원하지 않음)
- 기기가 데이터베이스의 `UserPush` 테이블에 등록되어 있는지 확인합니다
- Expo Push API 오류에 대한 OneUptime 서버 로그를 확인합니다
- 기기에 활성 인터넷 연결과 알림 권한이 활성화되어 있는지 확인합니다

### 로그에서 "DeviceNotRegistered" 오류

Expo 푸시 토큰이 더 이상 유효하지 않습니다. 일반적으로 앱이 제거되었거나 사용자가 알림 권한을 취소했음을 의미합니다. 토큰은 자동으로 정리됩니다.

## 지원

푸시 알림에 문제가 발생한 경우:

1. 위의 문제 해결 섹션을 확인합니다
2. 자세한 오류 메시지에 대한 OneUptime 로그를 검토합니다
3. [hello@oneuptime.com](mailto:hello@oneuptime.com)으로 문의합니다
