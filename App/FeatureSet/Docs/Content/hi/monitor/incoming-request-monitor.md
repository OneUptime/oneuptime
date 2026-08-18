# Incoming Request Monitor

Incoming Request Monitor आपको एक URL देता है जिस पर दूसरे सिस्टम HTTP requests भेजते हैं। OneUptime हर request को आपके criteria के अनुसार परखता है, और monitor की status बदल सकता है, incidents घोषित कर सकता है, और आपकी on-call rotation को पेज कर सकता है।

यह दो अलग-अलग काम संभालता है:

- **Heartbeat monitoring** — कोई cron job, worker या device निर्धारित समय पर URL को ping करता है, और ping आना बंद हो जाने पर OneUptime एक incident खोल देता है।
- **किसी दूसरे सिस्टम से alerts प्राप्त करना** — Prometheus Alertmanager, Grafana, या कोई भी ऐसा सिस्टम जो JSON POST कर सके, alerts भेजता है, और OneUptime उनमें से हर एक को on-call escalation और recovery पर स्वतः resolve होने वाले incident में बदल देता है।

दोनों एक ही monitor type का उपयोग करते हैं। इन्हें अलग करते हैं वे criteria जो आप कॉन्फ़िगर करते हैं।

## Overview

Incoming Request Monitors एक यूनिक URL देते हैं जिसे आपकी services कॉल करती हैं। इससे आप ये कर सकते हैं:

- cron jobs और scheduled tasks को monitor करना
- background workers चल रहे हैं या नहीं, इसकी पुष्टि करना
- firewalls के पीछे मौजूद ऐसी services को monitor करना जिन तक बाहर से पहुँचा नहीं जा सकता
- Prometheus Alertmanager, Grafana और अन्य alerting systems से alerts प्राप्त करना
- किसी भी HTTP-सक्षम सिस्टम से heartbeat signals ट्रैक करना

## Incoming Request Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएँ
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Incoming Request** चुनें
4. इस monitor के लिए एक **Secret Key** और URL बनाए जाते हैं
5. monitor खोलें और URL कॉपी करने के लिए बाएँ मेनू में **Documentation** पर क्लिक करें
6. अपनी service को उसी URL पर requests भेजने के लिए कॉन्फ़िगर करें
7. नीचे बताए अनुसार monitoring criteria कॉन्फ़िगर करें

## Request URL

आपके monitor का एक यूनिक URL इस format में होता है:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

यदि आप self-hosted हैं तो `https://oneuptime.com` को अपने OneUptime instance के URL से बदल दें।

इस URL पर **GET** या **POST** requests भेजें। HEAD स्वीकार किया जाता है और GET की तरह ही माना जाता है। बाकी methods 404 लौटाते हैं। path में मौजूद secret key ही एकमात्र credential है — किसी header या token की ज़रूरत नहीं।

> **Warning:** जो भी इस URL को जानता है वह monitor को healthy मार्क कर सकता है, इसलिए इसे गुप्त रखें। आप जो भी header भेजते हैं वह monitor पर सहेजा जाता है और उसे पढ़ने वाले हर व्यक्ति को दिखता है — इस endpoint पर headers में API keys या tokens न भेजें।

OneUptime तुरंत एक खाली `200` लौटाता है और request को queue पर process करता है। वह response किसी भी validation से पहले लिख दिया जाता है, इसलिए `200` इस बात की पुष्टि **नहीं** है कि request स्वीकार हो गई — गलत secret key, हटाया गया monitor, और disabled monitor भी `200` ही लौटाते हैं। requests पहुँच रही हैं या नहीं, यह जाँचने के लिए monitor की अपनी timeline देखें।

### Request body भेजना

यदि आप body के अंदर के fields को संदर्भित करना चाहते हैं — incident title में `{{requestBody.status}}`, incident grouping में कोई JSON path, या JavaScript Expression criteria — तो `Content-Type: application/json` भेजें; यह दस्तावेज़ हर जगह इसी format को मानकर चलता है। `application/x-www-form-urlencoded` body भी parse होती है, लेकिन केवल सपाट top-level fields में। कोई भी दूसरा content type, या कोई भी नहीं, parse नहीं होता और हर `requestBody` reference कुछ भी resolve नहीं करता।

50 MB तक की bodies स्वीकार की जाती हैं। body को `Content-Encoding: gzip` से compress न करें; वह बिना parse हुए सहेजी जाती है और उसके अंदर के paths resolve नहीं होंगे।

### Heartbeat भेजना

#### curl का उपयोग करके

```bash
# Simple GET request
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# Custom body के साथ POST request
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### cron job से

```bash
# हर 5 minutes में heartbeat भेजने के लिए crontab में जोड़ें
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### application code से

```javascript
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python example
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## Monitoring Criteria

आप criteria कॉन्फ़िगर करके तय कर सकते हैं कि आपकी service कब online, degraded या offline मानी जाए। हर criteria filter में एक **Filter Type** (किस चीज़ को देखना है), एक **Filter Condition** (उसकी तुलना कैसे करनी है) और एक **Value** होती है।

### उपलब्ध Filter Types

| Filter Type           | क्या जाँचता है                                         | नोट्स                                                                                     |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Incoming Request      | किसी समय-सीमा के भीतर request मिली या नहीं             | एकमात्र जाँच जो तब भी fire हो सकती है जब कुछ भी न आए                                      |
| Request Body          | request body                                           | Substring मिलान। object bodies की तुलना compact JSON के रूप में होती है                   |
| Request Header        | request headers के नाम                                 | lower-case किए गए header नाम से पूर्ण मिलान                                               |
| Request Header Value  | request headers के मान                                 | lower-case किए गए header मान से पूर्ण मिलान                                               |
| JavaScript Expression | `requestBody` और `requestHeaders` पर कोई भी expression | सबसे लचीला विकल्प — देखें [JavaScript अभिव्यक्तियाँ](/docs/monitor/javascript-expression) |

### Filter Conditions

हर Filter Type के अपने conditions होते हैं।

**Incoming Request** के लिए (यहाँ dashboard की वर्तनी के साथ ही दिया गया है):

- **Recieved In Minutes** — बताए गए मिनटों के भीतर कोई request मिली
- **Not Recieved In Minutes** — बताए गए मिनटों के भीतर कोई request नहीं मिली

**Request Body**, **Request Header** और **Request Header Value** के लिए: **Contains** और **Not Contains**।

**JavaScript Expression** के लिए: **Evaluates To True**।

> **Note:** header नाम और header मान तुलना से पहले lower-case कर दिए जाते हैं, और मिलान पूरे नाम या मान से होता है, किसी substring से नहीं। `Content-Type` नहीं, `content-type` लिखें; और `application/JSON` नहीं, `application/json` लिखें। असली substring मिलान केवल **Request Body** करता है।

object bodies की तुलना बिना spaces वाले compact JSON के रूप में होती है, इसलिए **Request Body** / **Contains** filter को `"status":"firing"` लिखना होगा — किसी सुंदर ढंग से formatted payload से `"status": "firing"` कॉपी करने पर वह कभी मेल नहीं खाएगा।

### उदाहरण Criteria

#### 10 minutes में कोई heartbeat नहीं होने पर offline mark करें

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### request body content के आधार पर degraded mark करें

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** किसी monitor का background में पुनर्मूल्यांकन तभी होता है जब उसका कम से कम एक criteria **Incoming Request** पर जाँच करता हो। जिस monitor के criteria केवल Request Body, Request Header या JavaScript Expression जाँचते हैं, उसका मूल्यांकन तभी होता है जब कोई request आती है, और किसी और समय नहीं — यानी वह अपने आप कभी offline नहीं हो सकता। यदि आपको heartbeat न आने का अलार्म चाहिए, तो एक **Incoming Request** criteria ज़रूरी है।

यह भी ध्यान रखें कि जिस monitor को कभी कोई request नहीं मिली, उसे ऐसा माना जाता है मानो उसका बनने का समय ही अंतिम request हो। बिलकुल नए monitor पर "Not Recieved In Minutes: 10" criteria बनाने के 10 minutes बाद fire हो जाएगा, भले ही भेजने वाला सिस्टम कभी जोड़ा ही न गया हो।

## किसी दूसरे सिस्टम से alerts प्राप्त करना

Alertmanager, Grafana और इसी तरह के tools एक JSON document POST करते हैं जिसमें एक या अधिक alerts का विवरण होता है। डिफ़ॉल्ट रूप से एक criteria **एक** incident खोलता है, इसलिए पाँच alerts वाले payload से भी एक ही incident बनता। Incident grouping इसे बदल देती है: यह payload से एक मान निकालती है और **हर अलग मान के लिए अलग incident** खोलती है, और ये सभी एक साथ खुले रह सकते हैं।

### Incident grouping चालू करना

criteria खोलें, **Settings** को फैलाएँ, और **Group incidents and alerts by a payload field** चालू करें। चार fields दिखाई देते हैं:

| Field                              | उदाहरण                                   | यह क्या करता है                                                        |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | वह path जिसके अलग-अलग मान incidents को बाँटते हैं                      |
| Field that signals recovery        | `requestBody.alerts[*].status`           | वह path जिसे देखकर तय होता है कि कोई alert recover हो गया है           |
| Value that means recovered         | `resolved`                               | वह सटीक मान जो recovery दर्शाता है                                     |
| Max incidents per request          | `100` (डिफ़ॉल्ट)                         | सुरक्षा सीमा, ताकि उच्च cardinality वाला field असीमित incidents न खोले |

### Path syntax

Paths की शुरुआत अनिवार्य रूप से `requestBody.` उपसर्ग से होनी चाहिए। इसके बिना कोई path — `alerts[*].labels.alertname` — किसी से मेल नहीं खाता, और चुपचाप विफल हो जाता है। `{{ }}` लपेटना वैकल्पिक है: `requestBody.status` और `{{requestBody.status}}` एक जैसा ही व्यवहार करते हैं।

- `[*]` किसी array पर फैल जाता है — हर **अलग** मान के लिए एक incident। एक ही मान देने वाले दो elements एक ही incident में मिल जाते हैं, और उस incident की firing/resolved स्थिति **पहले** मेल खाने वाले element से ली जाती है। **किसी path में केवल पहला `[*]` ही wildcard होता है**; `requestBody.groups[*].alerts[*].name` किसी से मेल नहीं खाता।
- `[0]` और `[last]` एक ही element चुनते हैं, और `[*]` के बाद आ सकते हैं।
- object और array मान, खाली strings और nulls छोड़ दिए जाते हैं। `0` और `false` मान्य keys हैं।

### Resolution event-आधारित है

कोई webhook केवल उसी payload की बात बताता है, इसलिए OneUptime किसी incident को इसलिए resolve नहीं करता कि उसकी key दिखनी बंद हो गई। incident तभी resolve होता है जब कोई payload स्पष्ट रूप से कहे कि वह key recover हो गई। दो बातें एक साथ सही होनी चाहिए:

1. **Field that signals recovery** और **Value that means recovered** सेट हों और payload से मेल खाते हों। तुलना सटीक है और case का ध्यान रखती है — `Resolved` का `resolved` से मेल नहीं होता।
2. criteria के incident में **Auto Resolve Incident** चालू हो, जो incident form में **Advanced Options** के नीचे है। इसके बिना मेल खाने वाले recovery events अनदेखे रह जाते हैं और incidents खुले ही रहते हैं। (alerts और **Auto Resolve Alert** पर भी यही लागू होता है।)

**Max incidents per request** केवल creation को नहीं, extraction को भी सीमित करता है। सीमा से आगे की keys recovery के लिए भी अदृश्य रहती हैं, इसलिए जिस payload में सीमा से अधिक अलग keys हों, उसमें सीमा से आगे `resolved` बताने वाला alert अपना incident बंद नहीं करेगा।

> **Warning:** यदि **Field that signals recovery** में `[*]` है लेकिन **Open a separate incident for each…** में नहीं, तो कभी कुछ resolve नहीं होगा। या तो दोनों में `[*]` इस्तेमाल करें, या किसी में नहीं। `[*]` रहित recovery path का मूल्यांकन पूरे payload पर होता है, इसलिए payload-स्तर का `status: resolved` उस payload की हर key को resolve कर देता है — उन alerts को भी जिनकी अपनी स्थिति अब भी firing है।

### Incidents के नाम रखना

grouping key incident और alert templates को एक variable के रूप में मिलती है, जिसका नाम **path के आख़िरी segment** पर रखा जाता है:

| Path                                     | Variable          |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

पूरा payload भी साथ में उपलब्ध रहता है, इसलिए `{{alertname}}` वाला incident title और `{{requestBody.commonAnnotations.summary}}` का उल्लेख करने वाला description, दोनों काम करते हैं। देखें [घटना और अलर्ट डायनामिक टेम्पलेट](/docs/monitor/incident-alert-templating)।

> **Warning:** variable का नाम उस पहचान का हिस्सा है जिससे OneUptime किसी recovery event को खुले incident से मिलाता है। grouping path को किसी ऐसे path में बदलने पर जिसका आख़िरी segment अलग हो, पुराने path के अंतर्गत अभी खुले सभी incidents अनाथ हो जाते हैं — उन्हें अपने आप resolve नहीं किया जा सकता और हाथ से बंद करना पड़ता है।

ध्यान रखें कि `[*]` **केवल** दोनों grouping path fields में काम करता है। बाकी जगह यह resolve नहीं होता, और unresolved placeholder खाली होने के बजाय **ज्यों का त्यों** छप जाता है — `{{requestBody.alerts[*].labels.alertname}}` वाला title ब्रेसेज़ समेत दिखता है। `{{requestBody.alerts[0].annotations.summary}}` वाला title resolve तो होता है, पर हमेशा payload का पहला alert पढ़ता है, वह नहीं जिसके लिए यह incident खोला गया था। इसके बजाय grouping variable और payload के साझा `commonAnnotations` fields को प्राथमिकता दें।

### पूरा उदाहरण

Alertmanager की पूरी configuration के लिए देखें [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager)। Grafana के लिए देखें [Grafana](/docs/integrations/grafana)।

## सर्वोत्तम प्रथाएं

1. **समय-सीमा उचित रखें** — यदि आपका cron job हर 5 minutes में चलता है, तो "Not Recieved In Minutes" की सीमा 10–15 minutes रखें ताकि कभी-कभार की देरी सह ली जाए
2. **सार्थक data भेजें** — request body में status की जानकारी भेजें ताकि आप बारीक criteria बना सकें
3. **POST के साथ `Content-Type: application/json` इस्तेमाल करें** — body के अंदर पढ़ने वाली हर सुविधा इसी पर निर्भर है
4. **एक ही monitor पर दोनों काम न मिलाएँ** — event-आधारित alerts पाने वाले monitor की कोई नियमित लय नहीं होती, इसलिए उस पर "Not Recieved In Minutes" criteria बार-बार बदलता रहेगा। dead-man's switch के लिए अलग monitor रखें
5. **Monitor को monitor करें** — सुनिश्चित करें कि requests भेजने वाली service में सही error handling हो, ताकि विफल requests किसी की नज़र से न छूटें

## आगे क्या पढ़ें

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — inbound alerting का पूरा सेटअप
- [Grafana](/docs/integrations/grafana) — वही चीज़, Grafana alerting के लिए
- [घटना और अलर्ट डायनामिक टेम्पलेट](/docs/monitor/incident-alert-templating) — titles और descriptions में उपलब्ध हर variable
- [JavaScript अभिव्यक्तियाँ](/docs/monitor/javascript-expression) — expression syntax और quoting के नियम
