# FAQ और Troubleshooting

OneUptime mobile और desktop apps के लिए अक्सर पूछे जाने वाले प्रश्न और समाधान।

## OneUptime अपनी apps कैसे distribute करता है?

- **Mobile (iOS और Android):** OneUptime **OneUptime On-Call** नामक एक native app ship करता है। यह [Apple App Store](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391) और [Google Play](https://play.google.com/store/apps/details?id=com.oneuptime.oncall) पर publish किया गया है। Google Play के बिना Android devices के लिए एक signed [APK download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) भी उपलब्ध है।
- **Desktop (Windows, macOS, Linux):** OneUptime का web dashboard एक Progressive Web App (PWA) है। आप इसे सीधे Chromium-based browser या Safari से desktop application के रूप में install कर सकते हैं — किसी store account की आवश्यकता नहीं है।

## Mobile App FAQ

### कौन से devices supported हैं?

- **iOS:** iOS 15.0 या बाद का version चलाने वाला iPhone या iPad।
- **Android:** Android 8.0 (Oreo) या बाद का version चलाने वाले phones और tablets।

### क्या app मुफ्त है?

हां। OneUptime On-Call app install करने के लिए मुफ्त है। आप अपने मौजूदा OneUptime account से sign in करते हैं।

### क्या मैं self-hosted OneUptime instance के साथ app का उपयोग कर सकता हूं?

हां। पहले launch पर, app एक **Server URL** के लिए पूछता है। अपने self-hosted instance का URL enter करें (उदाहरण के लिए, `https://oneuptime.example.com`)। app sign in करने देने से पहले validate करता है कि server reachable है।

self-hosted instances पर push notifications के लिए, [Push Notifications](/docs/self-hosted/push-notifications) guide का पालन करें।

### Updates कैसे deliver होते हैं?

- **iOS:** App Store के माध्यम से। **Settings → App Store** में automatic updates enable करें, या अपनी App Store profile से manually update करें।
- **Android (Google Play):** Automatic updates default रूप से enabled हैं।
- **Android (APK sideload):** ऊपर दिए गए GitHub Releases link से latest APK download और install करें।

### मुझे push notifications क्यों नहीं मिल रहे?

Mobile push, Expo Push के माध्यम से APNs (iOS) और FCM (Android) का उपयोग करता है। निम्नलिखित check करें:

1. **OneUptime On-Call** के लिए OS level पर notifications enabled हैं।
2. Battery optimisation disabled है और background activity allowed है (Android)।
3. Do Not Disturb या Focus modes बंद हैं, या app exception list पर है।
4. आप sign in हैं — push token केवल आपके sign in करने के बाद ही server के साथ register होता है।
5. **केवल Self-hosted:** Push notifications आपके OneUptime instance पर configured हैं। [Push Notifications](/docs/self-hosted/push-notifications) guide देखें।

### क्या मेरे phone पर data सुरक्षित है?

- सभी API traffic HTTPS का उपयोग करता है।
- Access और refresh tokens device के secure keystore (iOS पर Keychain, Android पर Keystore) में stored होते हैं।
- आप in-app **Settings** screen से Face ID / Touch ID / fingerprint unlock आवश्यक कर सकते हैं।

### क्या मैं app को कई devices पर install कर सकता हूं?

हां। जितने भी devices आपको चाहिए, उन पर एक ही OneUptime account के साथ sign in करें। प्रत्येक device को अपने own push notifications प्राप्त होते हैं।

### मैं uninstall कैसे करूं?

- **iOS:** icon को long-press करें → **Remove App** → **Delete App**।
- **Android:** icon को long-press करें → **Uninstall**, या **Settings → Apps → OneUptime On-Call → Uninstall**।

आपका OneUptime account और data server पर stored होता है और जब आप app uninstall करते हैं तो हटाया नहीं जाता।

## Desktop App (PWA) FAQ

### Progressive Web App (PWA) क्या है?

एक Progressive Web App एक web application है जिसे एक native desktop app की तरह install किया जा सकता है। एक बार install होने के बाद, यह अपनी window में run करता है, आपके launcher में इसका अपना icon होता है, और यह desktop notifications deliver कर सकता है — Windows Store, Mac App Store, या किसी अन्य distribution channel से जाए बिना।

### Desktop app PWA technology का उपयोग क्यों करता है?

- **Instant updates** — जिस क्षण आप deploy करते हैं, app आपके OneUptime instance के साथ sync रहता है।
- **किसी store account की आवश्यकता नहीं** — किसी भी modern browser से सीधे install करें।
- **Single codebase** — वही dashboard Windows, macOS, और Linux पर चलता है।

### "Install" button क्यों नहीं दिखाई दे रहा?

1. Chromium-based browser (Chrome, Edge, Brave, Arc) या Safari (macOS Sonoma+) का उपयोग करें।
2. पुष्टि करें कि आपका OneUptime instance HTTPS पर valid certificate के साथ serve हो रहा है।
3. अपना browser cache clear करें और reload करें।
4. app पहले से ही installed हो सकता है — अपने Applications / Start Menu check करें।

### मैं desktop app कैसे update करूं?

जब भी आप online रहते हुए इसे open करते हैं तो PWA automatically update होता है। update को force करने के लिए, window को **Ctrl+R** (Windows/Linux) या **Cmd+R** (macOS) के साथ refresh करें।

### मैं desktop PWA को uninstall कैसे करूं?

- **Windows:** **Settings → Apps → OneUptime → Uninstall**, या Start Menu entry पर right-click करें।
- **macOS:** app को **Applications** से Trash में drag करें, या Dock icon पर right-click करें और **Remove** चुनें।
- **Linux:** अपने application launcher के uninstall option का उपयोग करें, या relevant `.desktop` file को हटाएं।

## Troubleshooting

### Mobile App Issues

**App sign in नहीं हो रहा / "Network Error":**
- पुष्टि करें कि **Server URL** सही है और आपके phone से reachable है।
- check करें कि आपका phone internet से connected है।
- VPN के पीछे self-hosted instances के लिए, सुनिश्चित करें कि VPN active है।

**Push notifications delayed या missing (Android):**
- Battery optimisation disable करें: **Settings → Apps → OneUptime On-Call → Battery → Unrestricted**।
- app के लिए Data Saver disable करें।
- Samsung devices पर, OneUptime On-Call के लिए **Device care → Battery → Background usage limits** बंद करें।

**Push notifications delayed या missing (iOS):**
- app को Force-Quit करने से बचें — iOS background delivery को pause कर सकता है।
- जब आप on-call हों तो Low Power Mode disable करें।
- OneUptime On-Call को किसी भी active Focus mode की allow list में add करें।

**Face ID / Touch ID / fingerprint काम नहीं कर रहा:**
- सुनिश्चित करें कि biometrics आपके OS settings में enrolled हैं।
- OneUptime On-Call app के अंदर **Settings** screen से biometric unlock को फिर से enable करें।

### Desktop App (PWA) Issues

**Install button गायब है:**
- एक supported browser का उपयोग करें (Chromium-based या macOS Sonoma+ पर Safari)।
- सुनिश्चित करें कि OneUptime instance HTTPS पर serve हो रहा है।
- page के पूरी तरह load होने का इंतजार करें, फिर install icon के लिए address bar check करें।

**Desktop notifications दिखाई नहीं दे रहे:**
- जब browser प्रॉम्प्ट करे तो notifications allow करें।
- OS notification settings check करें (Windows Focus Assist, macOS Notifications, Linux notification daemon)।
- self-hosted instances के लिए, सुनिश्चित करें कि [Push Notifications](/docs/self-hosted/push-notifications) configuration पूरा है।

**App latest data नहीं दिखा रहा:**
- **Ctrl+R** / **Cmd+R** से refresh करें।
- window को बंद करें और फिर से open करें।
- अपना network connection check करें।

## Support

यदि आपको अभी भी सहायता चाहिए:

- Mobile: [iOS](./ios-installation.md) या [Android](./android-installation.md) installation guides देखें।
- Desktop: [Windows](./windows-installation.md), [macOS](./macos-installation.md), या [Linux](./linux-installation.md) installation guides देखें।
- [OneUptime GitHub repository](https://github.com/OneUptime/oneuptime) पर एक issue open करें।
- अपने OneUptime dashboard के माध्यम से support से संपर्क करें।
