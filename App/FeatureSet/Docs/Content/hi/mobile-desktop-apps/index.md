# OneUptime Mobile और Desktop Apps

OneUptime आपके browser के बाहर platform का उपयोग करने के दो तरीके प्रदान करता है:

- **Native mobile apps** iOS और Android के लिए, जो **Apple App Store** और **Google Play** पर publish किए गए हैं। ये on-call pages, incident alerts, और acknowledgement actions को सीधे आपके phone पर deliver करते हैं।
- **Installable desktop apps** Windows, macOS, और Linux के लिए, जो Progressive Web App (PWA) के रूप में सीधे आपके browser से install किए जाते हैं। ये OneUptime dashboard को आपके computer पर अपनी window, icon, और notification surface प्रदान करते हैं।

## Mobile (Native Apps)

**OneUptime On-Call** app एक native application है जो React Native से बनी है। यह official stores के माध्यम से distribute की जाती है, इसलिए आपको automatic updates, push notifications, और biometric unlock मिलते हैं।

- **iOS** — [App Store से Download करें](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)। iOS 15.0 या बाद का version आवश्यक है। देखें [iOS Installation Guide](./ios-installation.md)।
- **Android** — [Google Play पर पाएं](https://play.google.com/store/apps/details?id=com.oneuptime.oncall)। Android 8.0 या बाद का version आवश्यक है। Google Play के बिना devices के लिए direct [APK download](https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk) भी उपलब्ध है। देखें [Android Installation Guide](./android-installation.md)।

## Desktop (Progressive Web App)

OneUptime का web dashboard एक Progressive Web App है, इसलिए आप इसे किसी भी store के माध्यम से जाए बिना एक modern browser से desktop application के रूप में install कर सकते हैं।

- [Windows Installation](./windows-installation.md)
- [macOS Installation](./macos-installation.md)
- [Linux Installation](./linux-installation.md)

### Desktop शुरुआत करना

1. अपने OneUptime instance को Chromium-based browser (Chrome, Edge) या Safari में open करें।
2. address bar में **Install** button देखें या **File → Add to Dock / Apps → Install this site as an app** में देखें।
3. installed app को अपने Start Menu, Launchpad, या applications launcher से launch करें।

### Desktop Troubleshooting

**Install option दिखाई नहीं दे रहा:**
- सुनिश्चित करें कि आप एक supported browser का उपयोग कर रहे हैं।
- पुष्टि करें कि आपका OneUptime instance HTTPS पर serve हो रहा है।
- page को refresh करें या अपना browser cache clear करें।

**Push notifications काम नहीं कर रहे:**
- जब browser prompt करे तो notification permissions grant करें।
- अपने operating system की browser के लिए notification settings check करें।
- Self-hosted users: पुष्टि करें कि push notifications आपके OneUptime instance पर configure हैं।

## Support

- Mobile-specific मुद्दे: [iOS](./ios-installation.md) या [Android](./android-installation.md) installation guides देखें।
- Desktop-specific मुद्दे: [Windows](./windows-installation.md), [macOS](./macos-installation.md), या [Linux](./linux-installation.md) installation guides देखें।
- सामान्य प्रश्न: [FAQ & Troubleshooting](./faq-troubleshooting.md) page देखें।
- bugs या feature requests हमारे [GitHub repository](https://github.com/OneUptime/oneuptime) पर file करें।
