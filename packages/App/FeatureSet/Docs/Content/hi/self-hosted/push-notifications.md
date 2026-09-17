# Push Notifications

Native push notifications (iOS/Android) **Expo Push** इस्तेमाल करती हैं। Self-hosted instances डिफ़ॉल्ट रूप से OneUptime push relay का उपयोग करते हैं और उन्हें उस तक outbound network पहुँच चाहिए।

## यह कैसे काम करता है

OneUptime mobile app backend में Expo Push Token register करती है। Backend OneUptime relay से notifications भेजता है; `EXPO_ACCESS_TOKEN` सेट होने पर सीधे Expo को भेजता है। Expo उन्हें Apple APNs या Google FCM तक भेजता है, जहाँ से वे device पर पहुँचती हैं।

Web push notifications VAPID keys और Web Push protocol उपयोग करना जारी रखती हैं।

## Self-Hosted Setup

Official mobile app और default relay के लिए server पर Expo credentials आवश्यक नहीं हैं। Direct delivery के लिए `EXPO_ACCESS_TOKEN` में अपने app के Expo project के उपयुक्त credentials सेट करें। Web push के लिए `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` और `VAPID_SUBJECT` चाहिए।

## नेटवर्क पहुँच

| दिशा | गंतव्य | Protocol / port | कब जरूरी है |
| --- | --- | --- | --- |
| OneUptime → default relay | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN` सेट न होने पर mobile push। |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN` सेट होने पर direct mobile push। |
| OneUptime → browser push service | Browser push subscription में सुरक्षित HTTPS endpoint | HTTPS / सामान्यतः TCP 443 | Web push। |
| Mobile app या browser → OneUptime | आपका OneUptime hostname | HTTPS / TCP 443 | Login, device registration और notification links खोलना। |

`PUSH_NOTIFICATION_RELAY_URL` बदलने पर उसके destination hostname और configured port की अनुमति दें। Custom relay को OneUptime relay API implement करनी होगी। Defaults और delivery mode का चुनाव [OneUptime configuration](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) और [push service](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts) में है; direct endpoint के लिए [Expo sending guide](https://docs.expo.dev/push-notifications/sending-notifications/) देखें।

Web push के लिए अपनी टीम के browsers की subscription के वास्तविक endpoint hosts की अनुमति दें। OneUptime `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` और `push.apple.com` तथा उनके subdomains स्वीकार करता है, जैसे `updates.push.services.mozilla.com` और `web.push.apple.com`। [Browser subscription](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) destination देती है; केवल Expo या relay की अनुमति देने से web push उपलब्ध नहीं होती।

Notifications भेजने वाली OneUptime process से DNS और outbound TLS की अनुमति दें। उसके trust store को destination certificate validate करना चाहिए और proxies को interactive authentication के बिना API requests भेजनी चाहिए। Push providers OneUptime server पर webhook call नहीं करते। Devices VPN या दूसरे private connection से पहुँच सकें तो server private रह सकता है। Relay या external push services तक पहुँच के बिना server ये notifications नहीं पहुँचा सकता।

Devices की connectivity अलग आवश्यकता है। iOS को APNs तक पहुँच चाहिए, सामान्यतः TCP 5223 और fallback के लिए TCP 443; ताजा destination ranges के लिए [Apple requirements](https://support.apple.com/en-us/102266) देखें। Android को TCP 5228–5230 और 443 पर FCM चाहिए; वर्तमान hosts और firewall rules के लिए [Google guidance](https://firebase.google.com/docs/cloud-messaging/network-configuration) देखें। इन device ports को OneUptime पर inbound खोलने की जरूरत नहीं है। Server mobile push के लिए relay या Expo इस्तेमाल करता है, सीधे APNs/FCM नहीं।

Notification भेजने वाले container या pod से चुने गए mode के destination तक DNS और HTTPS जाँचें। फिर **User Settings > Notification Methods > Push** से test भेजें और registered device पर प्राप्ति की पुष्टि करें। Web push के लिए हर browser अलग जाँचें। OneUptime logs में relay, Expo या web-push errors देखें; API submission सफल होने का अर्थ device delivery की पुष्टि नहीं है।

## समस्या निवारण

### Push notifications नहीं आ रहीं

- सुनिश्चित करें कि mobile app EAS Build के साथ built था (Expo Go push notifications support नहीं करता)
- सत्यापित करें कि device आपके database की `UserPush` table में registered है
- Expo Push API errors के लिए OneUptime server logs जांचें
- Confirm करें कि device में active internet connection और notification permissions enabled हैं

### Logs में "DeviceNotRegistered" errors

Expo Push Token अब valid नहीं है। इसका मतलब आमतौर पर है कि app uninstall हो गई या user ने notification permissions revoke कर दिए। Token automatically clean up होगा।

## Support

यदि आपको push notifications में कोई समस्या आती है, तो कृपया:

1. ऊपर troubleshooting section जांचें
2. विस्तृत error messages के लिए OneUptime logs review करें
3. [hello@oneuptime.com](mailto:hello@oneuptime.com) पर हमसे संपर्क करें
