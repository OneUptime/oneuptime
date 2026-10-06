# OneUptime को Microsoft Teams से Connect करना

### OneUptime को Microsoft Teams से Connect करने के Steps

1. **OneUptime पर Account बनाएं**

   - [OneUptime.com](https://oneuptime.com) पर जाएं और account बनाएं।
   - Account बनने के बाद, एक नया project बनाएं।

2. **Microsoft Teams को OneUptime Project से Connect करें**

   - अपने OneUptime project में **प्रोजेक्ट सेटिंग्स** > **Microsoft Teams** पर जाएं।
   - अपने Microsoft Teams account को OneUptime project से connect करने के लिए prompts follow करें।

3. **Incident Notifications Configure करें**

   - अपना Microsoft Teams account connect करने के बाद, **Incidents Page** > **Microsoft Teams** पर जाएं।
   - Microsoft Teams पर incident notifications भेजने के लिए rules जोड़ें। उदाहरण के लिए, आप एक rule बना सकते हैं जो incident create होने पर Teams channel में messages post करे।

4. **Alerts और Scheduled Maintenance Notifications Configure करें**
   - Similar rules Alerts और Scheduled Maintenance पर भी apply किए जा सकते हैं, उनके respective pages पर navigate करके और desired rules configure करके।

## किसी नियम को परखना

किसी नियम की पंक्ति पर **Test Rule** उस नियम का एक test संदेश उन channels में भेजता है जिनका वह नाम लेता है, ताकि आप उसे पहुँचते देख सकें। अगर नियम हर event के लिए एक channel बनाता है, तो test भी एक channel बनाता है और नियम के लोगों को उसमें बुलाता है।

**Project Settings** > **Workspace** > **Microsoft Teams** में किसी channel के पास **Send Test** की तरह, इसके लिए notification नियम बनाने की अनुमति चाहिए: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, या किसी custom role में **Create Workspace Notification Rule**। जो केवल नियम देख सकता है, जैसे कोई **Viewer**, उसे बताया जाता है कि उसे test notification भेजने की अनुमति नहीं है। OneUptime Cloud पर किसी नियम को परखने के लिए, नियम जोड़ने की तरह, **Growth** plan चाहिए।

## सेल्फ़-होस्टेड डिप्लॉयमेंट के लिए नेटवर्क एक्सेस

आउटबाउंड कनेक्शन, इनबाउंड कॉलबैक और निजी डिप्लॉयमेंट के लिए [Microsoft Teams Integration](/docs/self-hosted/microsoft-teams-integration) में नेटवर्क एक्सेस वाला अनुभाग देखें।
