# Push Notifications

Native push notifications (iOS/Android) **Expo Push** द्वारा powered हैं और self-hosted instances के लिए **कोई server-side configuration आवश्यक नहीं है**।

## यह कैसे काम करता है

OneUptime mobile app backend के साथ एक Expo Push Token register करता है। जब backend को notification भेजनी होती है तो वह public Expo Push API पर POST करता है, जो app की ओर से Apple APNs या Google FCM पर message route करता है।

Web push notifications VAPID keys और Web Push protocol उपयोग करना जारी रखती हैं।

## Self-Hosted Setup

कोई push notification configuration आवश्यक नहीं है। Mobile app binary, Expo के push infrastructure के माध्यम से सभी platform registration automatically handle करती है।

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
