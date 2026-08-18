# Prometheus Alertmanager Integration

[Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) की notifications को OneUptime incidents में बदलें। Prometheus आपके alerting rules का मूल्यांकन करता है, Alertmanager उन्हें route करता है, और OneUptime उन्हें रिकॉर्ड कर escalate करता है।

यह integration **inbound** है, और इसे बनाने के दो तरीके हैं:

| तरीका                                                                             | कब इस्तेमाल करें                                                                                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Incoming Request Monitor](/docs/monitor/incoming-request-monitor)** (अनुशंसित) | आप चाहते हैं कि alerts on-call escalation वाले incidents बनें, हर alert के लिए एक incident बने, और recovery पर वे अपने आप resolve हो जाएँ। कोई custom logic संभालनी नहीं पड़ती। |
| **[Workflow](/docs/workflows/index) के साथ Webhook trigger**                      | आपको ऐसी routing logic चाहिए जो OneUptime मूल रूप से नहीं करता — दूसरे systems को कॉल करना, payloads का रूप बदलना, conditional branching।                                       |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## पूर्वापेक्षाएँ

- ऐसा Prometheus + Alertmanager सेटअप जहाँ आप `alertmanager.yml` संपादित कर सकें।
- Alertmanager आपके OneUptime instance तक HTTPS से पहुँच सके।
- ऐसा OneUptime project जहाँ आप monitors (या workflows) बना सकें।

## विकल्प 1 — Incoming Request Monitor

### चरण 1 — Monitor बनाएँ

1. **Monitors → Create Monitor** पर जाएँ और **Incoming Request** चुनें।
2. monitor खोलें और बाएँ मेनू में **Documentation** पर क्लिक करें। URL कॉपी करें:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   self-hosted होने पर अपना host इस्तेमाल करें। path में मौजूद secret key ही एकमात्र credential है।

### चरण 2 — Alertmanager को इस पर लक्षित करें

`alertmanager.yml` में:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` अनिवार्य है — यही OneUptime को बताता है कि कोई alert recover हो गया। `curl -X POST http://localhost:9093/-/reload` से Alertmanager को reload करें, या उसे restart करें।

Alertmanager `Content-Type: application/json` भेजता है, जो OneUptime को payload से fields पढ़ने के लिए चाहिए।

### चरण 3 — Criteria कॉन्फ़िगर करें

monitor के **Criteria** खोलें और पहले criteria को संपादित करें।

**Filter**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  string तुलना के लिए placeholder के चारों ओर quotes ज़रूरी हैं। यदि आप expression नहीं चाहते तो `Request Body` / `Contains` / `"status":"firing"` वाला filter भी काम करता है।

**Actions**

- _When filters match, change monitor status_ चालू करें और इसे **Offline** (या Degraded) पर सेट करें।
- _When filters match, declare an incident_ चालू करें। **Title**, **Severity** और जिन **On-Call Policies** को पेज करना है, वे सेट करें।
- उस incident के **Advanced Options** में **Auto Resolve Incident** चालू करें। इसके बिना recovery notifications अनदेखी रह जाती हैं और incidents हमेशा खुले रहते हैं।

**Settings → Group incidents and alerts by a payload field**

इसे चालू करें ताकि एक ही endpoint हर notification के लिए एक incident के बजाय एक साथ कई incidents — हर alert के लिए एक — संभाल सके।

| Field                              | मान                                 |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` Alertmanager के `alerts` array पर फैलता है और हर **अलग** निकाले गए मान के लिए एक incident खोलता है। चूँकि दोनों paths `[*]` इस्तेमाल करते हैं, recovery हर alert के हिसाब से तय होती है: जिस payload में एक alert resolved है और दो अब भी firing हैं, उसमें केवल resolved वाला बंद होता है।

> **Warning:** ऐसी चीज़ से group करें जो हर alert के लिए वाक़ई अनोखी हो। Alertmanager का `fingerprint` alert के पूरे label set का hash है, इसलिए वह हमेशा अनोखा रहता है। कोई label तभी काम आता है जब वह एक ही notification के **भीतर** बदलता हो — और आपके route के `group_by` में सूचीबद्ध कोई भी label कभी नहीं बदलता, क्योंकि वही तो aggregation group को परिभाषित करता है। ऊपर दिए `group_by: ["alertname", "instance"]` के साथ, `requestBody.alerts[*].labels.alertname` से grouping करने पर payload के हर alert से वही मान निकलता है, इसलिए वे सब एक ही incident में सिमट जाते हैं। इससे भी बुरा: दोहराए गए मानों में से केवल **पहली** बार वाला रखा जाता है, इसलिए जिस payload का पहला alert `resolved` है वह उस incident को बंद कर देगा जबकि बाकी अब भी firing हैं।

### चरण 4 — Incident का title और description लिखें

grouping key path के आख़िरी segment के नाम वाले variable के रूप में उपलब्ध होती है, इसलिए `requestBody.alerts[*].fingerprint` से आपको `{{fingerprint}}` मिलता है। वह एक hash है, किसी responder को दिखाने लायक नहीं — इसके बजाय incident का title पूरे notification में साझा labels से बनाएँ। `commonLabels` में आपके route के `group_by` का हर label होता है, इसलिए ऊपर की configuration के साथ `alertname` और `instance` दोनों उपलब्ध हैं:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` और `commonAnnotations` में वे fields होते हैं जो पूरे notification में साझा हैं। `requestBody.alerts[0].annotations.summary` जैसा प्रति-alert path हमेशा payload का _पहला_ alert पढ़ता है, वह नहीं जिसके लिए यह विशेष incident खोला गया था — इसलिए यदि आप चाहते हैं कि हर incident अपना annotation text रखे तो `group_by` को कसकर रखें। जो path resolve नहीं होता वह खाली रहने के बजाय ब्रेसेज़ समेत ज्यों का त्यों छप जाता है। पूरी variable सूची के लिए देखें [घटना और अलर्ट डायनामिक टेम्पलेट](/docs/monitor/incident-alert-templating)।

### चरण 5 — Monitor को वापस Operational करें (वैकल्पिक)

Criteria तभी काम करते हैं जब वे मेल खाते हैं, इसलिए एक दूसरा criteria जोड़ें ताकि सब शांत होने के बाद monitor Offline न बना रहे:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, और कोई incident घोषित न करें।

### चरण 6 — परीक्षण करें

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

आपको दो incidents मिलने चाहिए — हर `fingerprint` के लिए एक। दोनों alerts का `status` `resolved` करके फिर से भेजें, और दोनों बंद हो जाने चाहिए।

आप `amtool` से एक असली alert भी fire कर सकते हैं:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## विकल्प 2 — Workflow

जब आपको "alert से incident बने" से आगे की logic चाहिए, तब इसका उपयोग करें।

1. **वर्कफ़्लो → वर्कफ़्लो बनाएं** खोलें, इसे `Alertmanager → Incidents` नाम दें, और **बिल्डर** खोलें।
2. एक **वेबहुक** trigger जोड़ें और **उसका URL कॉपी करें**। ब्लॉक का नाम `Alertmanager` रखें।
3. trigger से connected एक **शर्तें** ब्लॉक जोड़ें:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **हाँ** से, एक **घटना बनाएं** ब्लॉक जोड़ें:
   - **शीर्षक**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **विवरण**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **गंभीरता**: कोई एक चुनें (या पहले `{{Alertmanager.Request Body.commonLabels.severity}}` पर branch करें)।
5. **सहेजें**, और फिर ऊपर चरण 2 के `webhook_configs` URL को workflow के URL पर लक्षित कर दें।

हर alert के लिए एक incident चाहिए तो एक [Custom Code](/docs/workflows/components#custom-code) ब्लॉक जोड़ें जो `Request Body.alerts` पर loop करे। `send_resolved: true` के साथ, `status == resolved` पर एक दूसरी **शर्तें** शाखा जोड़ें जो मेल खाता incident ढूँढे और उसे **Update Incident** से आपकी resolved स्थिति में ले जाए।

## Dead man's switch

दोनों में से कोई भी विकल्प यह नहीं बताता कि Prometheus खुद कब काम करना बंद कर देता है — कोई alert न आना ठीक वैसा ही दिखता है जैसे कुछ गड़बड़ ही न हो। इसका सामान्य उत्तर है एक हमेशा-firing alert, जिसे ऐसे monitor पर route किया जाए जो उसे निर्धारित समय पर आने की उम्मीद रखता हो। [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) में `Watchdog` नाम का ऐसा एक alert पहले से है; सादे Prometheus पर हमेशा सत्य रहने वाले expression (`vector(1)`) के साथ एक alerting rule जोड़ें।

एक **दूसरा** Incoming Request Monitor बनाएँ, छोटे `repeat_interval` के साथ `Watchdog` को उस पर route करें, और उस monitor को **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes** criteria दें। यही एकमात्र स्थिति है जहाँ request न आने वाला criteria किसी alert receiver पर उचित है।

नीचे चरण 2 की वही configuration है जिसमें watchdog का route और receiver जोड़ दिए गए हैं — sub-route की जाँच parent route के अपने receiver से पहले होती है, इसलिए `Watchdog` दूसरे monitor पर जाता है और बाकी सब पहले पर ही जाता रहता है:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## समस्या निवारण

- **कुछ भी नहीं पहुँच रहा** — पुष्टि करें कि Alertmanager उस URL तक पहुँच सकता है; delivery errors के लिए उसके logs देखें। OneUptime कुछ भी validate करने से पहले हर request को खाली `200` लौटा देता है, इसलिए `200` इस बात की पुष्टि नहीं करता कि payload स्वीकार हुआ। इसके बजाय monitor की timeline देखें।
- **Incidents खुलते हैं पर कभी बंद नहीं होते** — Alertmanager में `send_resolved: true`, criteria पर recovery field और मान (तुलना case-sensitive है), तथा incident के **Advanced Options** में **Auto Resolve Incident** जाँचें। दो और सूक्ष्म कारण: जिस payload में **Max incidents per request** से अधिक अलग keys हों, उसमें सीमा से आगे की keys recovery से भी छिप जाती हैं; और यदि ingest coalescing (नीचे) से जो notification गिरा वह `resolved` वाला ही था, तो incident हमेशा के लिए अटक जाता है, क्योंकि Alertmanager firing notifications दोहराता है, resolved वाले नहीं। ऐसे incidents हाथ से बंद करें।
- **कोई incident ही नहीं, monitor status भी अपरिवर्तित** — grouping path की शुरुआत अक्षरशः `requestBody.` से होनी चाहिए, और किसी path में केवल पहला `[*]` ही wildcard होता है। दोनों गलतियाँ चुपचाप विफल होती हैं।
- **Incident के text में कच्चे `{{...}}` placeholders दिखते हैं** — path resolve नहीं हुआ, और OneUptime unresolved placeholders को खाली करने के बजाय वैसा ही छोड़ देता है। अलग-अलग rules अलग annotations सेट करते हैं, इसलिए ऐसे fields संदर्भित करें जो आपके rules में सचमुच मौजूद हों (`commonAnnotations` बनाम प्रति-alert `annotations`)।
- **alerts से भरे payload के लिए सिर्फ़ एक incident** — आपने ऐसे label से group किया जो notification के भीतर नहीं बदलता, अक्सर वही जो आपके route के `group_by` में भी है। इसके बजाय `requestBody.alerts[*].fingerprint` से group करें।
- **बहुत ज़्यादा incidents** — `group_by` / `group_interval` को चौड़ा करें ताकि Alertmanager संबंधित alerts को साथ भेजे। **Max incidents per request** घटाने से संख्या सीमित होती है, पर सीमा से आगे की keys recovery से भी छिप जाती हैं।
- **तेज़ bursts में कुछ notifications छूटती दिखती हैं** — एक ही monitor पर आने वाली requests ingest पर मिला दी जाती हैं ताकि कोई एक भेजने वाला monitor को दबा न दे, जिससे notifications लगातार आने पर बीच का कोई payload गिर सकता है। `group_wait` और `group_interval` बढ़ाने से वे दूर-दूर हो जाती हैं। यह coalescing app container के `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` environment variable से नियंत्रित होती है, जो डिफ़ॉल्ट रूप से चालू है; जिन self-hosted operators को हर payload का मूल्यांकन चाहिए, वे उसे उस container पर `false` कर सकते हैं।

## आगे क्या पढ़ें

- [Incoming Request Monitor](/docs/monitor/incoming-request-monitor) — यह monitor type, इसके criteria, और पूरी incident grouping।
- [इंटिग्रेशन अवलोकन](/docs/integrations/index) — inbound और outbound पैटर्न।
- [Grafana](/docs/integrations/grafana) — वही विचार, Grafana alerting के साथ।
- [Webhook trigger](/docs/workflows/triggers#webhook) — workflow का receiving URL कैसे काम करता है।
