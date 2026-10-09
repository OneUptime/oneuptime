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
| OneUptime → default relay | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN` सेट न होने पर mobile push। |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN` सेट होने पर direct mobile push। |
| OneUptime → browser push service | Browser push subscription में सुरक्षित HTTPS endpoint | HTTPS / सामान्यतः TCP 443 | Web push। |
| Mobile app या browser → OneUptime | आपका OneUptime hostname | HTTPS / TCP 443 | Login, device registration और notification links खोलना। |

`PUSH_NOTIFICATION_RELAY_URL` बदलने पर उसके destination hostname और configured port की अनुमति दें। Custom relay को OneUptime relay API implement करनी होगी। Defaults और delivery mode का चुनाव [OneUptime configuration](https://github.com/OneUptime/oneuptime/blob/master/config.example.env) और [push service](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts) में है; direct endpoint के लिए [Expo sending guide](https://docs.expo.dev/push-notifications/sending-notifications/) देखें। OneUptime उसी address पर, `/send` की जगह `/receipts` के साथ, relay से delivery receipts पढ़ता है। जिस relay में यह route नहीं है, वह push अब भी deliver करता है; तब जिस device से app हटा दिया गया हो, उसका पता तभी चलता है जब उसे भेजा गया कोई बाद का push अस्वीकार हो जाए।

Web push के लिए अपनी टीम के browsers की subscription के वास्तविक endpoint hosts की अनुमति दें। OneUptime `fcm.googleapis.com`, `android.googleapis.com`, `push.services.mozilla.com`, `notify.windows.com` और `push.apple.com` तथा उनके subdomains स्वीकार करता है, जैसे `updates.push.services.mozilla.com` और `web.push.apple.com`। [Browser subscription](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription) destination देती है; केवल Expo या relay की अनुमति देने से web push उपलब्ध नहीं होती।

Notifications भेजने वाली OneUptime process से DNS और outbound TLS की अनुमति दें। उसके trust store को destination certificate validate करना चाहिए और proxies को interactive authentication के बिना API requests भेजनी चाहिए। Push providers OneUptime server पर webhook call नहीं करते। Devices VPN या दूसरे private connection से पहुँच सकें तो server private रह सकता है। Relay या external push services तक पहुँच के बिना server ये notifications नहीं पहुँचा सकता।

Devices की connectivity अलग आवश्यकता है। iOS को APNs तक पहुँच चाहिए, सामान्यतः TCP 5223 और fallback के लिए TCP 443; ताजा destination ranges के लिए [Apple requirements](https://support.apple.com/en-us/102266) देखें। Android को TCP 5228–5230 और 443 पर FCM चाहिए; वर्तमान hosts और firewall rules के लिए [Google guidance](https://firebase.google.com/docs/cloud-messaging/network-configuration) देखें। इन device ports को OneUptime पर inbound खोलने की जरूरत नहीं है। Server mobile push के लिए relay या Expo इस्तेमाल करता है, सीधे APNs/FCM नहीं।

Notification भेजने वाले container या pod से चुने गए mode के destination तक DNS और HTTPS जाँचें। फिर **User Settings > Notification Methods > Push** से test भेजें और registered device पर प्राप्ति की पुष्टि करें। Web push के लिए हर browser अलग जाँचें। OneUptime logs में relay, Expo या web-push errors देखें; API submission सफल होने का अर्थ device delivery की पुष्टि नहीं है। Mobile push के लिए OneUptime हर push के लगभग 15 मिनट बाद Expo की delivery receipt भी पढ़ता है: जो push कभी device तक नहीं पहुँचा, वह push log में और, on-call page के लिए, on-call timeline पर not delivered दिखता है।

## समस्या निवारण

### Push notifications नहीं आ रहीं

- सुनिश्चित करें कि mobile app EAS Build के साथ built था (Expo Go push notifications support नहीं करता)
- सत्यापित करें कि device आपके database की `UserPush` table में registered है
- Expo Push API errors के लिए OneUptime server logs जांचें
- Confirm करें कि device में active internet connection और notification permissions enabled हैं
- **User Settings > Notification Methods > Push** check करें: **सूचनाएँ नहीं मिल रहीं** के रूप में marked device को notifications मिलना बंद हो गया है और उसे फिर से register करना होगा (नीचे देखें)

### "not delivered" के रूप में marked push

Expo का push स्वीकार करना यह नहीं बताता कि वह device तक पहुँच गया: Apple या Google उसे अब भी अस्वीकार कर सकते हैं। OneUptime हर mobile push की delivery receipt भेजने के लगभग 15 मिनट बाद पढ़ता है; `EXPO_ACCESS_TOKEN` set न होने पर push relay के ज़रिए। जब receipt कोई error बताती है, तो उस page का push log और on-call timeline sent से बदलकर **Push notification not delivered** हो जाते हैं, Expo के error code के साथ:

- `DeviceNotRegistered`: mobile app device से हटा दिया गया है, या उसका push token अब valid नहीं है। अगला section देखें।
- `MessageRateExceeded`: कम समय में device को बहुत सारे notifications भेजे गए। उसे बाद के push सामान्य रूप से भेजे जाते हैं।
- `MessageTooBig`: notification push services की सीमा से बड़ा था। OneUptime notifications को छोटा करके फिट करता है, इसलिए ऐसा नहीं होना चाहिए; अगर हो, तो कृपया report करें।
- `InvalidCredentials` या `MismatchSenderId`: push भेजने वाले Expo project के push credentials valid नहीं हैं। `EXPO_ACCESS_TOKEN` के साथ अपने Expo project के push credentials जाँचें; default relay के साथ OneUptime support से संपर्क करें।

जब Expo किसी push को तुरंत अस्वीकार करता है, तो push log तुरंत कारण बताता है। Push relay के ज़रिए भी ऐसा ही होता है: relay server error के बजाय Expo का error code आगे भेजता है।

### Logs में "DeviceNotRegistered" errors

जब mobile app device से हटा दिया गया हो या device का push token अब valid न हो, तो Expo `DeviceNotRegistered` बताता है। आमतौर पर यह push की delivery receipt में होता है, जिसे OneUptime push के लगभग 15 मिनट बाद पढ़ता है, और कभी-कभी Expo push को तुरंत अस्वीकार कर देता है। दोनों ही स्थितियों में OneUptime उस device पर भेजना बंद कर देता है। Device को delete करने के बजाय notifications न पाने वाले के रूप में marked किया जाता है, इसलिए उसके notification rules बने रहते हैं, और न पहुँचे page का push log तथा on-call timeline कारण बताते हैं। **User Settings > Notification Methods > Push** में यह **सूचनाएँ नहीं मिल रहीं** के रूप में दिखता है। इसके owner के बाकी devices और notification methods पर अब भी notifications जाते हैं।

Device को वापस लाने के लिए, sign in रहते हुए उस पर mobile app खोलें। App फिर से register होता है, जिससे Expo के साथ उसका push token renew हो जाता है, और device अपने rules के साथ फिर से notifications पाने लगता है। अगर app हटा दिया गया था, तो उसे फिर से install करें और sign in करें। App के फिर से register होने से पहले भेजे गए push की receipt device को marked नहीं करती। जब up-to-date mobile app को पुराने phone के backup से नए phone पर set up किया जाता है, तो वह OneUptime को अपना पिछला push token बताता है; अगर पुराने phone का device अब notifications नहीं पा रहा, तो नया phone उसे उसके rules के साथ ले लेता है।

Push relay के ज़रिए (बिना `EXPO_ACCESS_TOKEN` के) भी यह इसी तरह काम करता है: push भेजते समय relay `DeviceNotRegistered` बताता है, और आपका instance जिन delivery receipts के बारे में पूछता है, उन्हें पढ़ता है।

## Support

यदि आपको push notifications में कोई समस्या आती है, तो कृपया:

1. ऊपर troubleshooting section जांचें
2. विस्तृत error messages के लिए OneUptime logs review करें
3. [hello@oneuptime.com](mailto:hello@oneuptime.com) पर हमसे संपर्क करें
