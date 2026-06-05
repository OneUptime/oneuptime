# Grafana Integration

[Grafana](https://grafana.com) alerts को OneUptime incidents में बदलें। Grafana आपके dashboards पर alert rules evaluate करता है; OneUptime उन्हें record, escalate, और track करता है।

यह इंटीग्रेशन **इनबाउंड** है: Grafana की alerting एक OneUptime **[वर्कफ़्लो](/docs/workflows/index)** में post करती है जो **Webhook trigger** से शुरू होता है, Grafana **Webhook contact point** का उपयोग करके।

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## पूर्वापेक्षाएँ

- [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) enabled के साथ Grafana 9+ (आधुनिक Grafana पर default)।
- Grafana HTTPS के माध्यम से आपके OneUptime instance तक पहुँचने में सक्षम होना चाहिए।
- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

## चरण 1 — OneUptime वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Grafana → Incidents` नाम दें, और **Builder** खोलें।
2. एक **Webhook** trigger जोड़ें और **उसका URL कॉपी करें**। ब्लॉक का नाम `Grafana` रखें।
3. trigger से connected एक **Conditions** ब्लॉक जोड़ें:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **Yes** से, एक **Create Incident** ब्लॉक जोड़ें:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: कोई एक चुनें (या `{{Grafana.Request Body.commonLabels.severity}}` पर branch करें)।
5. **सहेजें** (test होने तक disabled छोड़ें)।

Grafana का webhook payload Alertmanager shape follow करता है — इसमें `status`, एक `alerts` array, `commonLabels`, और `commonAnnotations` शामिल हैं, साथ ही सुविधाजनक top-level `title` और `message` fields।

## चरण 2 — Grafana contact point कॉन्फ़िगर करें

1. Grafana में, **Alerting → Contact points → Add contact point** पर जाएँ।
2. **Name**: `OneUptime`। **Integration**: **Webhook**।
3. **URL**: अपने वर्कफ़्लो का webhook URL पेस्ट करें। **HTTP Method**: `POST`।
4. Contact point सहेजें।
5. **Alerting → Notification policies** पर जाएँ और जो alerts आप चाहते हैं (या default policy) उन्हें **OneUptime** contact point पर route करें।

## चरण 3 — परीक्षण करें

1. वर्कफ़्लो enable करें।
2. Contact point screen में, एक sample notification भेजने के लिए **Test** इस्तेमाल करें, या कोई real alert rule fire होने दें।
3. वर्कफ़्लो का **Logs** tab और अपना **Incidents** list जाँचें।

## Recovery पर resolve करना (वैकल्पिक)

जब alert clear होता है, Grafana `status: resolved` के साथ एक और notification भेजता है। एक दूसरा **Conditions** branch जोड़ें (`status == resolved`), matching incident खोजें, और इसे **Update Incident** के साथ आपके resolved state में ले जाएँ।

## नोट्स

- **Legacy alerting (Grafana 8 और पहले)** एक अलग payload (`ruleName`, `state`, `evalMatches`) भेजता है। यदि आप legacy alerting पर हैं, तो `{{Grafana.Request Body.ruleName}}` और `{{Grafana.Request Body.state}}` reference करें, और `state == alerting` पर branch करें।
- आप Grafana की alerting को पूरी तरह skip भी कर सकते हैं और OneUptime को सीधे वही metrics monitor करने दे सकते हैं — [Metrics Monitor](/docs/monitor/metrics-monitor) देखें।

## समस्या निवारण

- **कोई run नहीं दिखता** — पुष्टि करें कि Grafana URL तक पहुँच सकता है (Grafana के server logs जाँचें) और वर्कफ़्लो **Enabled** है।
- **खाली fields** — **Logs** tab में trigger output inspect करें; अपने alerting version के लिए जो fields exist करते हैं उन्हें reference करें।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — inbound pattern।
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — closely related payload।
- [Metrics Monitor](/docs/monitor/metrics-monitor) — OneUptime में directly metrics monitor करें।
