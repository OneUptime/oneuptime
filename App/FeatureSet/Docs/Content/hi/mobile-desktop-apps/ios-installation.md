# iOS Installation Guide

अपने iPhone या iPad पर Apple App Store से **OneUptime On-Call** native iOS app install करें।

## आवश्यकताएं

- **iOS 15.0 या बाद का version** चलाने वाला iPhone या iPad
- एक active OneUptime account (या आपके self-hosted OneUptime instance का URL)
- sign-in के लिए और push notifications प्राप्त करने के लिए Internet connection

## App Store से Install करें

1. अपने iPhone या iPad पर **App Store** open करें।
2. **Search** tab पर tap करें और **"OneUptime On-Call"** search करें, या अपने device पर यह link open करें:
   [https://apps.apple.com/us/app/oneuptime-on-call/id6759615391](https://apps.apple.com/us/app/oneuptime-on-call/id6759615391)
3. **Get** पर tap करें, फिर Face ID, Touch ID, या अपने Apple ID password से authenticate करें।
4. एक बार install हो जाने पर, **Open** पर tap करें या अपनी home screen से **OneUptime On-Call** launch करें।

## पहला Launch और Sign-in

1. **Server URL**
   - यदि आप OneUptime Cloud का उपयोग कर रहे हैं, तो default `https://oneuptime.com` को छोड़ दें।
   - यदि आप self-hosting कर रहे हैं, तो अपने OneUptime instance का URL enter करें (उदाहरण के लिए, `https://oneuptime.example.com`)।
   - app आगे बढ़ने से पहले verify करता है कि server reachable है।
2. **Sign In**
   - अपने OneUptime account के लिए email और password enter करें।
   - बाद के launches पर तेज़ unlock के लिए वैकल्पिक रूप से **Face ID** या **Touch ID** enable करें।
3. **Notifications Allow करें**
   - prompt होने पर, **Allow** पर tap करें ताकि app on-call pages, incident alerts, और acknowledgements deliver कर सके।

## Push Notifications

Push notifications, Expo Push के माध्यम से Apple Push Notification service (APNs) के द्वारा deliver होते हैं। यह सुनिश्चित करने के लिए कि pages आपको reliably पहुंचें:

1. **Settings → Notifications → OneUptime On-Call** पर जाएं।
2. **Allow Notifications**, **Sounds**, **Badges**, और **Lock Screen / Banner / Notification Centre** delivery enable करें।
3. **Notification Grouping** को **Automatic** पर set करें।
4. यदि आप on-call हैं, तो अपनी shift के दौरान **Low Power Mode** disable करें और app को Force-Quit करने से बचें — यदि app force-closed हो तो iOS background delivery में delay कर सकता है।
5. किसी भी **Focus** mode में **OneUptime On-Call** add करें जहां आप अभी भी pages प्राप्त करना चाहते हैं।

## Updates

app को App Store के माध्यम से update किया जाता है:

- **App Store** open करें, अपनी profile picture पर tap करें, **OneUptime On-Call** तक scroll करें, और **Update** पर tap करें।
- या updates automatically install करने के लिए **Settings → App Store → App Updates** enable करें।

## Uninstall

1. अपनी home screen पर **OneUptime On-Call** icon को **Long-press** करें।
2. **Remove App → Delete App** पर tap करें।
3. **Delete** पर tap करके पुष्टि करें।

आपका OneUptime account और on-call schedules server-side stored होते हैं और जब आप app uninstall करते हैं तो हटाए नहीं जाते।

## Troubleshooting

**App Store कहता है कि app "Not Available in Your Region" है:**
- app global App Store पर publish है। यदि यह आपके region में नहीं दिखाई देता है, तो [support](mailto:support@oneuptime.com) से संपर्क करें।

**Sign in करते समय "Network Error":**
- verify करें कि **Server URL** सही है और आपके device से reachable है।
- यदि आप corporate network या VPN पर हैं, तो सुनिश्चित करें कि OneUptime instance accessible है।
- पुष्टि करें कि server HTTPS पर valid certificate के साथ serve हो रहा है।

**Push notifications प्राप्त नहीं हो रहे:**
- **Settings → Notifications → OneUptime On-Call** open करें और पुष्टि करें कि notifications allowed हैं।
- **Do Not Disturb** disable करें या OneUptime On-Call को अपने active Focus mode की allow list में add करें।
- server के साथ registered push token refresh करने के लिए sign out करें और फिर से sign in करें।
- Self-hosted users: पुष्टि करें कि push notifications आपके OneUptime instance पर configure हैं (self-hosted [Push Notifications](/docs/self-hosted/push-notifications) guide देखें)।

**Face ID / Touch ID काम नहीं कर रहा:**
- सुनिश्चित करें कि biometrics **Settings → Face ID & Passcode** या **Settings → Touch ID & Passcode** में enrolled हैं।
- OneUptime On-Call app के अंदर **Settings** screen से biometric unlock को फिर से enable करें।

**App launch पर crash होता है:**
- App Store से latest version पर update करें।
- अपना device restart करें।
- यदि समस्या बनी रहती है, तो app को delete करें और फिर से install करें, फिर sign in करें।

## Support

यदि आपको अभी भी सहायता चाहिए, तो अपने OneUptime dashboard के माध्यम से संपर्क करें या हमारे [GitHub repository](https://github.com/OneUptime/oneuptime) पर एक issue open करें।
