# Datadog Integration

[Datadog](https://www.datadoghq.com) monitor alerts को OneUptime incidents में बदलें, ताकि Datadog की detection OneUptime की incident response और status pages को feed करे।

यह इंटीग्रेशन **इनबाउंड** है: Datadog का [Webhooks integration](https://docs.datadoghq.com/integrations/webhooks/) एक OneUptime **[वर्कफ़्लो](/docs/workflows/index)** में post करता है जो **Webhook trigger** से शुरू होता है।

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## पूर्वापेक्षाएँ

- एक Datadog account जहाँ आप integrations और monitors configure कर सकते हैं।
- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

## चरण 1 — OneUptime वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Datadog → Incidents` नाम दें, और **Builder** खोलें।
2. एक **Webhook** trigger जोड़ें और **उसका URL कॉपी करें**। ब्लॉक का नाम `Datadog` रखें।
3. trigger से connected एक **Conditions** ब्लॉक जोड़ें:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. **Yes** से, एक **Create Incident** ब्लॉक जोड़ें:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: कोई एक चुनें।
5. **सहेजें** (test होने तक disabled छोड़ें)।

## चरण 2 — Datadog webhook बनाएँ

1. Datadog में, **Integrations → Webhooks** पर जाएँ (यदि आपने नहीं किया है तो **Webhooks** integration install करें)।
2. **एक webhook जोड़ें**:

   - **Name**: `oneuptime` (यह `@webhook-oneuptime` बन जाता है)।
   - **URL**: आपके वर्कफ़्लो का webhook URL।
   - **Payload** — Datadog आपको [template variables](https://docs.datadoghq.com/integrations/webhooks/#usage) का उपयोग करके JSON body define करने देता है:

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Webhook सहेजें।

## चरण 3 — Monitor के alerts webhook पर भेजें

Webhook handle उन monitors में जोड़ें जिन्हें आप forward करना चाहते हैं। हर monitor के **notification message** में शामिल करें:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

यह alert और recovery दोनों OneUptime को भेजता है। (सब कुछ forward करने के लिए, आप unconditionally `@webhook-oneuptime` भी monitor में जोड़ सकते हैं।)

## चरण 4 — परीक्षण करें

1. वर्कफ़्लो enable करें।
2. किसी monitor से, **Test Notifications → Alert** इस्तेमाल करें, या कोई real monitor trip होने दें।
3. वर्कफ़्लो का **Logs** tab और अपना **Incidents** list जाँचें।

## Recovery पर resolve करना (वैकल्पिक)

`$ALERT_TRANSITION` monitor clear होने पर `Recovered` होता है। एक दूसरा **Conditions** branch जोड़ें (`transition == Recovered`), matching incident खोजें (भेजे गए `id` पर match करें), और इसे **Update Incident** के साथ आपके resolved state में ले जाएँ।

## समस्या निवारण

- **कोई run नहीं दिखता** — पुष्टि करें कि monitor के message में `@webhook-oneuptime` शामिल है और वर्कफ़्लो **Enabled** है।
- **Fields खाली हैं** — Datadog केवल event पर लागू होने वाले template variables substitute करता है। **Logs** tab में trigger output inspect करें और अपना webhook payload adjust करें।
- **Duplicate incidents** — एक monitor जो re-alert करता है (renotify) कई `Triggered` events भेजता है; create करने से पहले `id` पर **Find Incident** check से dedupe करें।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — inbound pattern।
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) और [Grafana](/docs/integrations/grafana) — अन्य inbound sources।
- [Webhook trigger](/docs/workflows/triggers#webhook) — receiving URL कैसे काम करता है।
