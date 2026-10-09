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
| OneUptime → 기본 릴레이 | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN`이 없는 모바일 푸시. |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN`을 설정한 직접 모바일 푸시. |
| OneUptime → 브라우저 푸시 서비스 | 푸시 구독에 저장된 HTTPS 엔드포인트 | HTTPS / 일반적으로 TCP 443 | 웹 푸시. |
| 모바일 앱 또는 브라우저 → OneUptime | OneUptime 호스트 이름 | HTTPS / TCP 443 | 로그인, 기기 등록, 알림 링크 열기. |

`PUSH_NOTIFICATION_RELAY_URL`을 변경하면 해당 호스트 이름과 설정한 포트를 허용하세요. 사용자 지정 릴레이는 OneUptime 릴레이 API를 구현해야 합니다. 기본값과 전달 방식 선택은 [OneUptime 설정](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) 및 [푸시 서비스](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts), 직접 엔드포인트는 [Expo 전송 안내](https://docs.expo.dev/push-notifications/sending-notifications/)를 참고하세요. OneUptime은 `/send` 대신 `/receipts`를 붙인 같은 주소에서 릴레이로부터 전달 영수증을 읽습니다. 이 경로가 없는 릴레이도 푸시는 계속 전달하지만, 이 경우 앱이 삭제된 기기는 그 기기로 보낸 이후 푸시가 거부될 때에야 확인됩니다.

웹 푸시는 팀이 사용하는 브라우저 구독의 실제 엔드포인트 호스트를 허용해야 합니다. OneUptime은 `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com`, `push.apple.com`과 하위 도메인을 허용합니다. 예로 `updates.push.services.mozilla.com`, `web.push.apple.com`이 있습니다. [브라우저 구독](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription)이 대상을 제공하므로 Expo나 릴레이만 허용해서는 웹 푸시를 사용할 수 없습니다.

알림을 보내는 OneUptime 프로세스의 DNS와 아웃바운드 TLS를 허용하세요. 신뢰 저장소가 대상 인증서를 검증할 수 있어야 하고, 프록시는 대화형 인증 없이 API 요청을 전달해야 합니다. 푸시 제공자는 OneUptime의 웹훅을 호출하지 않습니다. 기기가 VPN 등 비공개 연결로 접근할 수 있다면 서버를 비공개로 유지할 수 있습니다. 릴레이나 외부 푸시 서비스에 접근할 수 없는 서버는 알림을 전달할 수 없습니다.

기기 연결은 별도 요구 사항입니다. iOS는 보통 TCP 5223과 대체 포트 TCP 443으로 APNs에 접근합니다. 최신 대상 대역은 [Apple 안내](https://support.apple.com/en-us/102266)를 참고하세요. Android는 TCP 5228–5230과 443으로 FCM에 접근합니다. 최신 호스트와 규칙은 [Google 안내](https://firebase.google.com/docs/cloud-messaging/network-configuration)를 참고하세요. 이러한 기기 포트를 OneUptime의 인바운드로 열 필요는 없습니다. 서버의 모바일 푸시는 APNs/FCM 직접 연결 대신 릴레이나 Expo를 사용합니다.

전송 컨테이너 또는 Pod에서 선택한 전달 방식의 대상으로 DNS와 HTTPS 연결을 확인하세요. **User Settings > Notification Methods > Push**에서 테스트를 보내 등록한 기기에 도착했는지 확인하세요. 웹 푸시는 브라우저별로 테스트하세요. OneUptime 로그에서 릴레이, Expo 또는 web-push 오류를 확인하세요. API가 요청을 수락했다고 해서 기기 수신이 확인되는 것은 아닙니다. 모바일 푸시의 경우 OneUptime은 각 푸시 후 약 15분 뒤에 Expo의 전달 영수증도 읽습니다. 기기에 도달하지 못한 푸시는 푸시 로그와, 온콜 알림이라면 온콜 타임라인에 미전달로 표시됩니다.

## 문제 해결

### 푸시 알림이 도착하지 않는 경우

- 모바일 앱이 EAS Build로 빌드되었는지 확인합니다 (Expo Go는 푸시 알림을 지원하지 않음)
- 기기가 데이터베이스의 `UserPush` 테이블에 등록되어 있는지 확인합니다
- Expo Push API 오류에 대한 OneUptime 서버 로그를 확인합니다
- 기기에 활성 인터넷 연결과 알림 권한이 활성화되어 있는지 확인합니다
- **User Settings > Notification Methods > Push**를 확인합니다. **알림을 받지 못하고 있습니다**로 표시된 기기는 알림 수신이 중단되었으므로 다시 등록해야 합니다(아래 참조)

### "미전달"로 표시된 푸시

Expo가 푸시를 수락했다고 해서 기기에 도달한 것은 아닙니다. Apple이나 Google이 여전히 거부할 수 있습니다. OneUptime은 각 모바일 푸시의 전달 영수증을 전송 후 약 15분 뒤에 읽으며, `EXPO_ACCESS_TOKEN`이 설정되지 않은 경우 푸시 릴레이를 통해 읽습니다. 영수증이 오류를 보고하면 해당 알림의 푸시 로그와 온콜 타임라인이 전송됨에서 **Push notification not delivered**로 바뀌고, Expo의 오류 코드가 함께 표시됩니다.

- `DeviceNotRegistered`: 모바일 앱이 기기에서 삭제되었거나 푸시 토큰이 더 이상 유효하지 않습니다. 다음 섹션을 참조하세요.
- `MessageRateExceeded`: 짧은 시간에 기기로 너무 많은 알림이 전송되었습니다. 이후 해당 기기로의 푸시는 평소대로 전송됩니다.
- `MessageTooBig`: 알림이 푸시 서비스가 허용하는 크기보다 컸습니다. OneUptime은 알림이 맞도록 줄이므로 발생하지 않아야 합니다. 발생하면 알려 주세요.
- `InvalidCredentials` 또는 `MismatchSenderId`: 푸시를 보낸 Expo 프로젝트의 푸시 자격 증명이 유효하지 않습니다. `EXPO_ACCESS_TOKEN`을 사용한다면 Expo 프로젝트의 푸시 자격 증명을 확인하고, 기본 릴레이를 사용한다면 OneUptime 지원팀에 문의하세요.

Expo가 푸시를 즉시 거부하면 푸시 로그에 그 이유가 바로 표시됩니다. 푸시 릴레이를 통해서도 마찬가지입니다. 릴레이는 서버 오류로 응답하는 대신 Expo의 오류 코드를 전달합니다.

### 로그에서 "DeviceNotRegistered" 오류

모바일 앱이 기기에서 삭제되었거나 기기의 푸시 토큰이 더 이상 유효하지 않으면 Expo는 `DeviceNotRegistered`를 보고합니다. 보통 OneUptime이 전송 후 약 15분 뒤에 읽는 푸시의 전달 영수증에서 보고되며, 때로는 푸시가 즉시 거부되기도 합니다. 어느 경우든 OneUptime은 해당 기기로의 전송을 중단합니다. 기기는 삭제되지 않고 알림을 받지 못하는 것으로 표시되므로 알림 규칙은 그대로 유지되며, 도착하지 않은 알림의 푸시 로그와 온콜 타임라인에 그 이유가 표시됩니다. **User Settings > Notification Methods > Push**에는 **알림을 받지 못하고 있습니다**로 표시됩니다. 소유자의 다른 기기와 알림 방법으로는 계속 알림이 전달됩니다.

기기를 복구하려면 로그인한 상태에서 해당 기기의 모바일 앱을 여세요. 앱이 다시 등록되면서 Expo에서 푸시 토큰이 갱신되고, 기기는 규칙을 그대로 유지한 채 다시 알림을 받습니다. 앱을 삭제했다면 다시 설치하고 로그인하세요. 앱이 다시 등록되기 전에 보낸 푸시의 영수증으로는 기기가 표시되지 않습니다. 최신 모바일 앱을 이전 휴대폰의 백업으로 새 휴대폰에 설정하면, 앱이 이전 푸시 토큰을 OneUptime에 알리고 이전 휴대폰의 기기가 규칙과 함께 새 휴대폰으로 옮겨집니다.

푸시 릴레이(`EXPO_ACCESS_TOKEN` 없음)를 통해서도 똑같이 동작합니다. 릴레이는 푸시를 보낼 때 `DeviceNotRegistered`를 알리고, 인스턴스가 요청한 전달 영수증을 읽어 줍니다.

## 지원

푸시 알림에 문제가 발생한 경우:

1. 위의 문제 해결 섹션을 확인합니다
2. 자세한 오류 메시지에 대한 OneUptime 로그를 검토합니다
3. [hello@oneuptime.com](mailto:hello@oneuptime.com)으로 문의합니다
