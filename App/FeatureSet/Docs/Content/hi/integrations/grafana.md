# Grafana Integration

[Grafana](https://grafana.com) के alerts को OneUptime incidents में बदलें। Grafana आपके dashboards पर alert rules का मूल्यांकन करता है; OneUptime उन्हें रिकॉर्ड करता है, escalate करता है और ट्रैक करता है।

यह integration **inbound** है: Grafana का **Webhook contact point** OneUptime पर POST करता है। इसे प्राप्त करने के दो तरीके हैं।

| तरीका                                                                             | कब इस्तेमाल करें                                                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **[Incoming Request Monitor](/docs/monitor/incoming-request-monitor)** (अनुशंसित) | आप चाहते हैं कि alerts on-call escalation वाले incidents बनें, हर alert के लिए एक incident बने, और recovery पर वे अपने आप resolve हो जाएँ। |
| **[Workflow](/docs/workflows/index) के साथ Webhook trigger**                      | आपको ऐसी routing logic चाहिए जो OneUptime मूल रूप से नहीं करता — दूसरे systems को कॉल करना, payloads का रूप बदलना, conditional branching।  |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Grafana का webhook payload Alertmanager shape follow करता है — `status`, एक `alerts` array, `commonLabels`, और `commonAnnotations`, साथ ही सुविधाजनक top-level `title` और `message` fields।

## पूर्वापेक्षाएँ

- Grafana 9+ जिसमें [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) चालू हो (आधुनिक Grafana में डिफ़ॉल्ट)।
- Grafana आपके OneUptime instance तक HTTPS से पहुँच सके।
- ऐसा OneUptime project जहाँ आप monitors (या workflows) बना सकें।

## विकल्प 1 — Incoming Request Monitor

1. **Monitors → Create Monitor** पर जाएँ और **Incoming Request** चुनें। इसे खोलें और URL कॉपी करने के लिए बाएँ मेनू में **Documentation** पर क्लिक करें।
2. monitor के **Criteria** खोलें और **Filter Type** को `JavaScript Expression` तथा **Value** को `"{{requestBody.status}}" === "firing"` पर सेट करें।
3. मेल खाने पर incident घोषित करें, पेज करने के लिए **On-Call Policies** चुनें, और **Advanced Options** में **Auto Resolve Incident** चालू करें।
4. **Settings** के अंतर्गत **Group incidents and alerts by a payload field** चालू करें और यह सेट करें:

   | Field                              | मान                                 |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. incident का title `{{requestBody.commonLabels.alertname}}` रखें और उसका विवरण `{{requestBody.message}}` या `{{requestBody.commonAnnotations.summary}}` से दें। (`{{fingerprint}}` में grouping key ही होती है, पर वह एक hash है — किसी responder को दिखाने लायक नहीं।)
6. Grafana contact point को monitor के URL पर लक्षित करें (नीचे contact point वाले चरण देखें)।

हर **अलग** grouping मान अपना अलग incident बनता है, और Grafana के resolved बताते ही हर एक बंद हो जाता है। Grafana का प्रति-alert `fingerprint` किसी alert के label set के लिए अनोखा होता है, इसीलिए ऊपर उसे grouping path बनाया गया है। [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) पेज इसी सेटअप को और विस्तार से समझाता है — payload का रूप वही है, इसलिए वहाँ का हर चरण यहाँ भी लागू होता है।

> **Warning:** ऐसे label से group न करें जो पूरे notification में एक-सा रहता है। Grafana की डिफ़ॉल्ट notification policy `grafana_folder` और `alertname` से group करती है, इसलिए एक ही webhook के सभी alerts का alertname एक जैसा होता है — `requestBody.alerts[*].labels.alertname` से grouping करने पर पूरा payload एक ही incident में सिमट जाएगा। साथ ही grouping paths की शुरुआत अक्षरशः `requestBody.` से होनी चाहिए, और किसी path में केवल पहला `[*]` ही wildcard होता है। ये सभी गलतियाँ चुपचाप विफल होती हैं।

## विकल्प 2 — Workflow

जब आपको "alert से incident बने" से आगे की logic चाहिए, तब इसका उपयोग करें।

### चरण 1 — OneUptime वर्कफ़्लो बनाएँ

1. **वर्कफ़्लो → वर्कफ़्लो बनाएं** खोलें, इसे `Grafana → Incidents` नाम दें, और **बिल्डर** खोलें।
2. एक **वेबहुक** trigger जोड़ें और **उसका URL कॉपी करें**। ब्लॉक का नाम `Grafana` रखें।
3. trigger से connected एक **शर्तें** ब्लॉक जोड़ें:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **हाँ** से, एक **घटना बनाएं** ब्लॉक जोड़ें:
   - **शीर्षक**: `{{Grafana.Request Body.title}}`
   - **विवरण**: `{{Grafana.Request Body.message}}`
   - **गंभीरता**: कोई एक चुनें (या `{{Grafana.Request Body.commonLabels.severity}}` पर branch करें)।
5. **सहेजें** (test होने तक disabled छोड़ें)।

## Grafana contact point कॉन्फ़िगर करें

1. Grafana में **Alerting → Contact points → Add contact point** पर जाएँ।
2. **Name**: `OneUptime`। **Integration**: **Webhook**।
3. **URL**: विकल्प 1 का monitor URL, या विकल्प 2 के workflow का webhook URL चिपकाएँ। **HTTP Method**: `POST`।
4. contact point सहेजें।
5. **Alerting → Notification policies** पर जाएँ और अपने इच्छित alerts (या डिफ़ॉल्ट policy) को **OneUptime** contact point पर route करें।

## परीक्षण करें

1. यदि आपने workflow बनाया है तो उसे सक्षम करें।
2. contact point स्क्रीन पर **Test** से एक नमूना notification भेजें, या किसी असली alert rule को fire होने दें।
3. अपनी **Incidents** सूची देखें — और यदि आपने विकल्प 2 इस्तेमाल किया है तो workflow का **Logs** टैब भी।

## Recovery पर resolve करना

जब alert शांत हो जाता है, Grafana `status: resolved` के साथ एक और notification भेजता है।

**विकल्प 1** में, ऊपर कॉन्फ़िगर किए गए recovery field और मान मेल खाते incident को अपने आप बंद कर देते हैं — बशर्ते **Auto Resolve Incident** चालू हो।

**विकल्प 2** में, एक दूसरी **शर्तें** शाखा (`status == resolved`) जोड़ें, मेल खाता incident ढूँढें, और उसे **Update Incident** से अपनी resolved स्थिति में ले जाएँ।

## नोट्स

- **Legacy alerting (Grafana 8 और उससे पहले)** एक अलग payload भेजता है (`ruleName`, `state`, `evalMatches`)। यदि आप legacy alerting पर हैं तो इसके बजाय `{{Grafana.Request Body.ruleName}}` और `{{Grafana.Request Body.state}}` संदर्भित करें, और `state == alerting` पर branch करें।
- आप Grafana की alerting पूरी तरह छोड़कर OneUptime से सीधे वही metrics monitor भी करा सकते हैं — देखें [मेट्रिक्स मॉनिटर](/docs/monitor/metrics-monitor)।

## समस्या निवारण

- **कुछ भी नहीं पहुँच रहा** — पुष्टि करें कि Grafana उस URL तक पहुँच सकता है (Grafana के server logs देखें), और विकल्प 2 के लिए कि workflow **Enabled** है। OneUptime हर incoming request को validate करने से पहले ही खाली `200` लौटा देता है, इसलिए Grafana के logs में `200` इस बात की पुष्टि नहीं करता कि payload स्वीकार हुआ।
- **Incidents खुलते हैं पर कभी बंद नहीं होते** — criteria पर recovery field और मान जाँचें, और यह भी कि incident के **Advanced Options** में **Auto Resolve Incident** चालू है। तुलना case-sensitive है।
- **alerts से भरे payload के लिए सिर्फ़ एक incident** — आपने ऐसे label से group किया जो notification के भीतर नहीं बदलता। इसके बजाय `requestBody.alerts[*].fingerprint` से group करें।
- **Incident के text में कच्चे `{{...}}` placeholders दिखते हैं** — path resolve नहीं हुआ, और unresolved placeholders खाली होने के बजाय वैसे ही छोड़ दिए जाते हैं। ऐसे fields संदर्भित करें जो आपके alerting version में मौजूद हों; यदि आपने विकल्प 2 इस्तेमाल किया है तो **Logs** टैब में trigger का output देखें।

## आगे क्या पढ़ें

- [Incoming Request Monitor](/docs/monitor/incoming-request-monitor) — यह monitor type, इसके criteria, और पूरी incident grouping।
- [इंटिग्रेशन अवलोकन](/docs/integrations/index) — inbound पैटर्न।
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — बहुत मिलता-जुलता payload।
- [मेट्रिक्स मॉनिटर](/docs/monitor/metrics-monitor) — OneUptime में सीधे metrics monitor करें।
