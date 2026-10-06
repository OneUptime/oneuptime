# OneUptime को Slack से Connect करना

### OneUptime को Slack से Connect करने के Steps

1. **OneUptime पर Account बनाएं**

   - [OneUptime.com](https://oneuptime.com) पर जाएं और account बनाएं।
   - Account बनने के बाद, एक नया project बनाएं।

2. **Slack को OneUptime Project से Connect करें**

   - अपने OneUptime project में **प्रोजेक्ट सेटिंग्स** > **Slack** पर जाएं।
   - अपने Slack account को OneUptime project से connect करने के लिए prompts follow करें।

3. **Incident Notifications Configure करें**

   - अपना Slack account connect करने के बाद, **Incidents Page** > **Slack** पर जाएं।
   - Slack पर incident notifications भेजने के लिए rules जोड़ें। उदाहरण के लिए, आप एक rule बना सकते हैं जो incident create होने पर एक नया Slack channel बनाए और incident owners को invite करे।

4. **Alerts और Scheduled Maintenance Notifications Configure करें**
   - Similar rules Alerts और Scheduled Maintenance पर भी apply किए जा सकते हैं, उनके respective pages पर navigate करके और desired rules configure करके।

## किसी नियम को परखना

किसी नियम की पंक्ति पर **परीक्षण नियम** उस नियम का एक test संदेश उन channels में भेजता है जिनका वह नाम लेता है, ताकि आप उसे पहुँचते देख सकें। अगर नियम हर event के लिए एक channel बनाता है, तो test भी एक channel बनाता है और नियम के लोगों को उसमें बुलाता है।

**Project Settings** > **Workspace** > **Slack** में किसी channel के पास **परीक्षण भेजें** की तरह, इसके लिए notification नियम बनाने की अनुमति चाहिए: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, या किसी custom role में **Create Workspace Notification Rule** और **Read Workspace Notification Rule**। जो केवल नियम देख सकता है, जैसे कोई **Viewer**, उसके लिए **परीक्षण नियम** बंद रहता है और उसका tooltip बताता है कि क्या चाहिए; API उसका test "You do not have permission to send test notifications in this project." कहकर अस्वीकार करता है। OneUptime Cloud पर किसी नियम को परखने के लिए, नियम जोड़ने की तरह, **Growth** plan चाहिए।

## सारांश

**घटनाएं** > **Workspace** > **Slack** (और **अलर्ट**) का **Summary** टैब आपके बताए चैनलों में नियमित सारांश पोस्ट करता है: कितनी घटनाएं या अलर्ट हुए, उन्हें कितनी जल्दी स्वीकार और हल किया गया, और लिंक वाली एक सूची। नया सारांश हर हफ़्ते भेजा जाता है और पिछले 7 दिनों को कवर करता है। **पहली रिपोर्ट इस समय भेजें** खाली छोड़ दें, तो पहला सारांश अगले सप्ताह, दिन या महीने की शुरुआत में 09:00 बजे भेजा जाता है; फ़ॉर्म बताता है कि कब।

सारांश अपने **टाइमज़ोन** की घड़ी से भेजा जाता है, जो शुरुआत में आपका टाइमज़ोन होता है। वहाँ वह पूरे साल अपना समय बनाए रखता है: बर्लिन में 09:00 बजे के लिए सेट किया गया सारांश घड़ियाँ बदलने के बाद भी बर्लिन समय से 09:00 बजे ही भेजा जाता है, और उसके संदेश की तारीखें भी बर्लिन की होती हैं। API से `timezone` को IANA टाइमज़ोन नाम के रूप में भेजें, जैसे `Europe/Berlin`। बिना टाइमज़ोन के बनाया गया सारांश अपने निर्माता की प्रोफ़ाइल का टाइमज़ोन लेता है, या API कुंजी से बनाए जाने पर UTC।

## सेल्फ़-होस्टेड डिप्लॉयमेंट के लिए नेटवर्क एक्सेस

आउटबाउंड कनेक्शन, इनबाउंड कॉलबैक और निजी डिप्लॉयमेंट के लिए [Slack Integration](/docs/self-hosted/slack-integration) में नेटवर्क एक्सेस वाला अनुभाग देखें।
