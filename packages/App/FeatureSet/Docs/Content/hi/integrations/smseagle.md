# SMSEagle Integration

[SMSEagle](https://www.smseagle.eu) के ज़रिए अलर्ट की सूचनाएँ SMS या फ़ोन कॉल के रूप में भेजें। SMSEagle एक हार्डवेयर SMS गेटवे है, जो आपके अपने नेटवर्क में लगाया जाता है। OneUptime में **SMSEagle** वर्कफ़्लो कंपोनेंट पहले से मौजूद हैं, इसलिए सेटअप जल्दी हो जाता है।

यह इंटीग्रेशन **आउटबाउंड** है: OneUptime [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/) के ज़रिए संदेश भेजता है।

```text
OneUptime अलर्ट → On Create  ──►  SMSEagle कंपोनेंट  ──►  फ़ोन पर SMS या कॉल
```

## चरण 1: API कुंजी बनाएँ

1. SMSEagle के वेब GUI में **Settings → API → API v2** पर जाएँ और **Create API key** पर क्लिक करें।
2. **Permissions** में **Send SMS** की अनुमति दें और, अगर कॉल चाहिए, तो **Make a TTS Advanced Call** की भी।
3. कुंजी कॉपी करें। OneUptime इसे **SMSEagle Access Token** कहता है।

## चरण 2: OneUptime को डिवाइस तक पहुँचने दें

1. अपने OneUptime सर्वर से डिवाइस के पते, जैसे `https://192.168.0.100`, तक का कनेक्शन दोनों के बीच के फ़ायरवॉल और VPN में अनुमत करें।
2. SMSEagle डिवाइस का पता आम तौर पर निजी होता है, जिसे वर्कफ़्लो डिफ़ॉल्ट रूप से ब्लॉक करते हैं। सेल्फ़-होस्टेड इंस्टेंस पर, API सर्वर के `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` में डिवाइस का IP पता या होस्टनेम जोड़ें, जैसे `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`, और उसे रीस्टार्ट करें। [निजी नेटवर्क एक्सेस](/docs/self-hosted/private-network-access) देखें।

## चरण 3: सीक्रेट सहेजें

1. OneUptime में **वर्कफ़्लो → ग्लोबल वेरिएबल → बनाएँ** पर जाएँ।
2. `SMSEAGLE_URL`, `SMSEAGLE_ACCESS_TOKEN` (सीक्रेट) और `ONCALL_PHONE` बनाएँ।

## चरण 4: वर्कफ़्लो बनाएँ

1. **वर्कफ़्लो → वर्कफ़्लो बनाएं** खोलें, उसका नाम `Alerts → SMSEagle` रखें और **बिल्डर** खोलें।
2. **On Create** पर सेट किया गया एक **Alert** ट्रिगर जोड़ें। उसका नाम बदलकर `Alert` करें।
3. ट्रिगर से जुड़ा एक **Send SMS via SMSEagle** कंपोनेंट जोड़ें:
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. **सहेजें** पर क्लिक करें, वर्कफ़्लो चालू करें और एक टेस्ट अलर्ट बनाएँ। फ़ोन पर SMS आ जाता है।

टेम्पलेट **Text a phone via SMSEagle when an alert fires** यही वर्कफ़्लो बनाता है।

## SMS की जगह कॉल

इसके बजाय **Make a Call via SMSEagle** इस्तेमाल करें। इसमें वही सेटिंग्स हैं, साथ में **Voice ID**, यानी डिवाइस पर टेक्स्ट-टू-स्पीच आवाज़, और यह **Text to Read Out** पढ़कर सुनाता है। API कुंजी को **Make a TTS Advanced Call** की अनुमति चाहिए।

टेम्पलेट **Call a phone via SMSEagle when an alert fires** यही वर्कफ़्लो कॉल के साथ बनाता है।

## विकल्प: API कंपोनेंट

**API** ब्लॉक भी काम करता है:

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## सुझाव

- अगर डिवाइस संदेश अस्वीकार करता है, तो कारण कंपोनेंट की **Error** वैल्यू में होता है। उसे **त्रुटि** आउटपुट पर लॉग करें।
- भेजने से पहले गंभीरता के आधार पर छाँटने के लिए **शर्तें** इस्तेमाल करें।
- कई लोगों तक पहुँचने के लिए कई SMSEagle कंपोनेंट जोड़ें, हर नंबर के लिए एक।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index): आउटबाउंड पैटर्न।
- [Components → SMSEagle](/docs/workflows/components#smseagle): कंपोनेंट का संदर्भ।
