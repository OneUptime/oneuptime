# PagerDuty Integration

जब भी OneUptime incident बनाया जाए तो एक [PagerDuty](https://www.pagerduty.com) incident trigger करें, और OneUptime resolve करने पर उसे resolve करें। उपयोगी जब PagerDuty आपके escalation और on-call schedules का मालिक हो और आप OneUptime की monitoring को उसे feed करना चाहते हों।

यह इंटीग्रेशन **आउटबाउंड** है: OneUptime PagerDuty के [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) को कॉल करता है। यह **Incident → On Create** trigger और **API component** के साथ OneUptime **[वर्कफ़्लो](/docs/workflows/index)** का उपयोग करता है।

> OneUptime का अपना on-call और escalation built in है — [On Call](/docs/on-call/incoming-call-policy) देखें। इस इंटीग्रेशन का उपयोग केवल तब करें जब आप विशेष रूप से PagerDuty में भी events land कराना चाहते हों।

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## पूर्वापेक्षाएँ

- **Events API v2** integration के साथ एक PagerDuty service। PagerDuty में: **Service → Integrations → Add integration → Events API v2**। **Integration Key** कॉपी करें (इसे _routing key_ भी कहते हैं)।
- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

## चरण 1 — routing key store करें

1. **Workflows → Global Variables → Create** पर जाएँ।
2. इसे `PAGERDUTY_ROUTING_KEY` नाम दें, integration key पेस्ट करें, और **Is Secret** चालू करें।

## चरण 2 — "trigger" वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Incidents → PagerDuty` नाम दें, और **Builder** खोलें।
2. **On Create** पर सेट एक **Incident** trigger जोड़ें। इसे `Incident` नाम दें।
3. trigger से connected एक **API** ब्लॉक जोड़ें:

   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   **`dedup_key`** इस PagerDuty incident को OneUptime incident से बाँधता है ताकि आप बाद में उसे resolve कर सकें। OneUptime incident id इस्तेमाल करना इसे unique और predictable रखता है।

4. **सहेजें**, enable करें, और एक test incident बनाएँ। Workflow logs में `202` response का मतलब है PagerDuty ने event accept किया।

## चरण 3 — OneUptime resolve पर resolve करें (अनुशंसित)

1. **उसी** वर्कफ़्लो में, एक दूसरा **Incident** trigger जोड़ें? नहीं — एक वर्कफ़्लो में एक trigger होता है। इसके बजाय **Incident → On Update** trigger के साथ `Resolve PagerDuty` नामक एक **दूसरा** वर्कफ़्लो बनाएँ।
2. यह जाँचने के लिए एक **Conditions** ब्लॉक जोड़ें कि incident अब resolved है (incident के state/`{{Incident.currentIncidentState.name}}` को अपने resolved state name से match करें)।
3. **Yes** से, **उसी `dedup_key`** और `event_action` `resolve` पर सेट के साथ PagerDuty के लिए एक **API** ब्लॉक जोड़ें:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty `dedup_key` से match करता है और original incident बंद करता है।

## Severity mapping (वैकल्पिक)

PagerDuty का `severity` `critical`, `error`, `warning`, या `info` accept करता है। OneUptime severities से map करने के लिए, API block से पहले `{{Incident.incidentSeverity.name}}` पर **Conditions** branches जोड़ें और हर से अलग body भेजें।

## इनबाउंड (वैकल्पिक)

दूसरी दिशा में जाने के लिए — PagerDuty event से OneUptime incident खोलें — एक **Webhook** trigger वर्कफ़्लो जोड़ें और उसके URL पर एक PagerDuty [V3 webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/) (या Events Orchestration) point करें, फिर **Create Incident** इस्तेमाल करें। [inbound pattern](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime) देखें।

## समस्या निवारण

- **`400` with `"invalid routing key"`** — integration **Events API v2** होना चाहिए, पुराना Events API v1 या कोई अलग integration type नहीं। Key फिर से कॉपी करें।
- **Resolve कुछ भी बंद नहीं करता** — resolve call पर `dedup_key` trigger call से बिल्कुल match होनी चाहिए।
- **Logs में कुछ नहीं** — पुष्टि करें कि वर्कफ़्लो **Enabled** है और trigger **On Create** पर है।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — patterns और auth cheat sheet।
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime का built-in escalation।
- [Opsgenie](/docs/integrations/opsgenie) — Opsgenie के लिए वही विचार।
