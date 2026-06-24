# Zabbix Integration

[Zabbix](https://www.zabbix.com) आपके सर्वर और नेटवर्क की निगरानी करता है; OneUptime आपकी incident response, on-call, और status pages चलाता है। दोनों को जोड़ें और हर Zabbix समस्या स्वचालित रूप से OneUptime incident बन जाती है — ताकि सही लोगों को पेज मिले और आपका status page सटीक रहे।

यह इंटीग्रेशन **इनबाउंड** है: Zabbix OneUptime को समस्याएँ भेजता है। यह एक तरफ Zabbix **webhook media type** और दूसरी तरफ OneUptime **[वर्कफ़्लो](/docs/workflows/index)** का उपयोग करता है। कोई प्लगइन नहीं, कोई अतिरिक्त सेवाएँ नहीं।

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## यह कैसे काम करता है

1. Zabbix trigger **PROBLEM** में बदल जाता है।
2. Zabbix **action** **OneUptime** media type को event भेजने के लिए कहता है।
3. Media type का script एक छोटा JSON payload OneUptime workflow URL पर POST करता है।
4. वर्कफ़्लो payload पढ़ता है और एक incident बनाता है (और वैकल्पिक रूप से, Zabbix recover होने पर इसे resolve करता है)।

## पूर्वापेक्षाएँ

- एक Zabbix server जिसे आप प्रबंधित करते हैं (यह गाइड **Zabbix 6.0 LTS / 7.0 LTS** के लिए लिखी गई है; webhook media type 5.0+ पर भी उसी तरह काम करती है)।
- आपका Zabbix server HTTPS के माध्यम से आपके OneUptime instance तक पहुँचने में सक्षम होना चाहिए।
- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

## भाग 1 — OneUptime वर्कफ़्लो बनाएँ

यह पहले करें, क्योंकि आपको उस webhook URL की ज़रूरत होगी जो यह generate करता है।

1. **Workflows → Create Workflow** खोलें। इसे `Zabbix → Incidents` नाम दें और **Builder** tab खोलें।
2. कैनवास पर एक **Webhook** trigger खींचें। उस पर क्लिक करें और **unique URL कॉपी करें** जो यह दिखाता है। इसे सुरक्षित रखें — जिसके पास भी यह है वह वर्कफ़्लो शुरू कर सकता है। ब्लॉक का नाम `Zabbix` रखें ताकि variables सुंदर दिखें।
3. कैनवास पर एक **Conditions** ब्लॉक खींचें और trigger का output उससे जोड़ें। कॉन्फ़िगर करें:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1` _(Zabbix समस्या के लिए `1` और recovery के लिए `0` भेजता है)_
4. एक **Create Incident** ब्लॉक खींचें और उसे Conditions ब्लॉक के **Yes** output से जोड़ें। भरें:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: वह OneUptime incident severity चुनें जो आप चाहते हैं (आप बाद में अधिक Conditions branches जोड़कर इसे बेहतर कर सकते हैं जो Zabbix severities को map करें)।
5. सहेजें। **Enabled** _बंद_ छोड़ें अभी के लिए — test के बाद आप इसे चालू करेंगे।

> **टिप:** description (या incident label) में Zabbix `event_id` रखने से आप बाद में इस incident को फिर से खोज सकते हैं यदि आप recovery पर auto-resolve करना चाहते हैं। [स्वचालित रूप से resolve करना](#स्वचालित-रूप-से-resolve-करना-वैकल्पिक) देखें।

## भाग 2 — Zabbix कॉन्फ़िगर करें

### चरण 1: OneUptime media type बनाएँ

1. Zabbix में, **Alerts → Media types** पर जाएँ (पुराने संस्करणों पर: **Administration → Media types**)।
2. **Create media type** क्लिक करें और **Type** को **Webhook** पर सेट करें।
3. **Name**: `OneUptime`।
4. ये **Parameters** जोड़ें (हर एक के लिए _Add_ क्लिक करें)। ये Zabbix [macros](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) को एक साफ़ payload में map करते हैं:

   | नाम              | मान                |
   | ---------------- | ------------------ |
   | `url`            | `{ALERT.SENDTO}`   |
   | `event_id`       | `{EVENT.ID}`       |
   | `event_name`     | `{EVENT.NAME}`     |
   | `event_value`    | `{EVENT.VALUE}`    |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host`           | `{HOST.NAME}`      |
   | `event_date`     | `{EVENT.DATE}`     |
   | `event_time`     | `{EVENT.TIME}`     |

5. **Script** फ़ील्ड में यह पेस्ट करें:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader("Content-Type: application/json");

   var payload = {
     source: "zabbix",
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time,
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw (
       "OneUptime responded with HTTP " + request.getStatus() + ": " + response
     );
   }

   return "OK";
   ```

6. **Message templates** tab क्लिक करें और **Problem** और **Problem recovery** के लिए एक template जोड़ें (body खाली हो सकती है — payload script में बनाया जाता है)। यह Zabbix के लिए उन event types के लिए media type इस्तेमाल करने के लिए ज़रूरी है।
7. Media type सहेजने के लिए **Add** करें।

### चरण 2: webhook ले जाने के लिए एक user बनाएँ

Zabbix notifications _एक user को_ भेजता है। एक समर्पित user बनाएँ ताकि इंटीग्रेशन ढूंढना और बंद करना आसान हो।

1. **Users → Users → Create user** पर जाएँ। इसे `OneUptime Webhook` नाम दें, इसे एक ऐसी role दें जो notifications प्राप्त कर सके (जैसे **User role**), और इसे एक user group में जोड़ें।
2. **Media** tab पर, **Add** क्लिक करें:
   - **Type**: `OneUptime`
   - **Send to**: भाग 1 में कॉपी किया गया **workflow webhook URL** पेस्ट करें।
   - **When active** / severities: डिफ़ॉल्ट छोड़ें (या उन severities तक सीमित करें जिनकी आपको परवाह है)।
3. **Add** और **Update** करें।

### चरण 3: action के साथ OneUptime को समस्याएँ भेजें

1. **Alerts → Actions → Trigger actions → Create action** पर जाएँ।
2. **Name**: `Notify OneUptime`।
3. **Conditions** (वैकल्पिक): इसे संकुचित करें — उदाहरण के लिए, _Trigger severity >= Warning_। सब कुछ भेजने के लिए खाली छोड़ें।
4. **Operations** tab पर, एक operation जोड़ें जो **OneUptime** media type के माध्यम से **User: OneUptime Webhook** को भेजे।
5. बाद में recovery पर incidents resolve करने के लिए, **Recovery operations** में भी उसी user/media से भरें।
6. सहेजें के लिए **Add** करें और सुनिश्चित करें कि action **Enabled** है।

## भाग 3 — परीक्षण करें

1. OneUptime वर्कफ़्लो में वापस जाएँ, **Enabled** चालू करें।
2. Zabbix में, एक परीक्षण समस्या trigger करें — उदाहरण के लिए, अस्थायी रूप से trigger threshold कम करें, या एक test item इस्तेमाल करें जो problem state में बदल जाए।
3. अपने वर्कफ़्लो का **Logs** tab खोलें। आपको Zabbix payload के साथ एक run दिखना चाहिए, Conditions ब्लॉक **Yes** path लेते हुए, और incident बनते हुए।
4. OneUptime में **Incidents** जाँचें — आपकी Zabbix समस्या अब एक incident है।

यदि कुछ नहीं पहुँचता है, तो [समस्या निवारण](#समस्या-निवारण) देखें।

## स्वचालित रूप से resolve करना (वैकल्पिक)

ऊपर का मुख्य वर्कफ़्लो incidents _खोलता_ है। Zabbix के recover होने पर उन्हें _बंद_ भी करने के लिए:

1. सुनिश्चित करें कि आपके Zabbix action में **Recovery operations** कॉन्फ़िगर हैं (ऊपर चरण 3) ताकि recovery events भी भेजे जाएँ। Recovery पर, `status` `0` के रूप में आता है।
2. वर्कफ़्लो में, एक दूसरा **Conditions** branch जोड़ें: left `{{Zabbix.Request Body.status}}`, operator `==`, right `0`।
3. उसके **Yes** output से, एक **Find Incident** ब्लॉक जोड़ें जो पहले बनाए गए open incident को खोजे — description या label में स्टोर किए गए Zabbix `event_id` पर match करें।
4. उसे एक **Update Incident** ब्लॉक से जोड़ें और incident को आपके _resolved_ state में ले जाएँ।

चूँकि resolution इस बात पर निर्भर करता है कि आप अपने project में incident states कैसे model करते हैं, **create** path को reliable core के रूप में रखें और resolve path बाद में जोड़ें जब आप पुष्टि कर लें कि events सही से flow हो रहे हैं। [कंपोनेंट → OneUptime data components](/docs/workflows/components#oneuptime-data-components) देखें।

## Zabbix severities mapping (वैकल्पिक)

Zabbix severities (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) `{{Zabbix.Request Body.severity}}` के रूप में आती हैं। उन्हें OneUptime incident severities से map करने के लिए, **Create Incident** से पहले **Conditions** branches जोड़ें — उदाहरण के लिए, `Disaster` और `High` को "Critical" incident में और बाकी सब को "Major" में route करें। प्रत्येक branch के लिए एक **Create Incident** ब्लॉक बनाएँ।

## समस्या निवारण

**वर्कफ़्लो कभी नहीं चलता।**

- पुष्टि करें कि वर्कफ़्लो का **Enabled** switch चालू है।
- Zabbix server से, पुष्टि करें कि वह URL तक पहुँच सकता है: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`। आपको एक त्वरित acknowledgement मिलना चाहिए।
- Zabbix में **Reports → Action log** जाँचें delivery errors के लिए।

**Zabbix एक script error रिपोर्ट करता है।**

- Media type खोलें और एक sample payload भेजने के लिए **Test** इस्तेमाल करें। Zabbix script का output या thrown error दिखाता है।
- OneUptime से non-2xx response script में `throw` द्वारा दिखाई जाती है — जाँचें कि workflow URL बिल्कुल सही है।

**Incident बनता है लेकिन fields खाली हैं।**

- वर्कफ़्लो का **Logs** tab खोलें और trigger output inspect करें। पुष्टि करें कि **Request Body** के अंतर्गत field names वही हैं जिन्हें आप reference कर रहे हैं (`name`, `host`, `severity`, `status`, `event_id`)।
- एक missing field error की बजाय empty string में resolve होता है — [Variables → Gotchas](/docs/workflows/variables#gotchas) देखें।

**सब कुछ दो बार fire होता है।**

- शायद आपके पास एक problem operation और एक escalation step दोनों हैं जो एक ही media को भेज रहे हैं। Action के **Operations** steps जाँचें।

## सुरक्षा नोट्स

- Workflow webhook URL को पासवर्ड की तरह मानें। यदि यह leak हो जाता है, तो trigger डिलीट करें और URL rotate करने के लिए नया बनाएँ।
- Zabbix action की conditions प्रतिबंधित करें ताकि आप केवल वे severities forward करें जो incident की ज़रूरत हों।
- यदि आप OneUptime self-hosted firewall के पीछे चला रहे हैं, तो अपने Zabbix server के egress IP को HTTPS के माध्यम से इस तक पहुँचने दें।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — inbound/outbound patterns।
- [Webhook trigger](/docs/workflows/triggers#webhook) — receiving URL कैसे काम करता है।
- [कंपोनेंट](/docs/workflows/components) — Conditions, Create Incident, और अधिक।
- [वेरिएबल](/docs/workflows/variables) — बाद के ब्लॉक्स में Zabbix payload पढ़ना।
