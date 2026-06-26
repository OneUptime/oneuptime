# Opsgenie Integration

जब भी OneUptime incident बनाया जाए तो एक [Opsgenie](https://www.atlassian.com/software/opsgenie) alert बनाएँ, और OneUptime resolve करने पर उसे बंद करें।

यह इंटीग्रेशन **आउटबाउंड** है: OneUptime [Opsgenie Alert API](https://docs.opsgenie.com/docs/alert-api) को कॉल करता है। यह **Incident → On Create** trigger और **API component** के साथ OneUptime **[वर्कफ़्लो](/docs/workflows/index)** का उपयोग करता है।

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## पूर्वापेक्षाएँ

- एक Opsgenie **API key** एक API integration से: **Settings → Integrations → Add → API**। Key कॉपी करें।
- अपना region जानें। Default API host `https://api.opsgenie.com` है; EU accounts `https://api.eu.opsgenie.com` इस्तेमाल करते हैं।
- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

## चरण 1 — API key store करें

1. **Workflows → Global Variables → Create** पर जाएँ।
2. इसे `OPSGENIE_KEY` नाम दें, API key पेस्ट करें, और **Is Secret** चालू करें।

## चरण 2 — "create alert" वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Incidents → Opsgenie` नाम दें, और **Builder** खोलें।
2. **On Create** पर सेट एक **Incident** trigger जोड़ें। इसे `Incident` नाम दें।
3. trigger से connected एक **API** ब्लॉक जोड़ें:

   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts` _(EU के लिए `api.eu.opsgenie.com` इस्तेमाल करें)_
   - **Headers**:

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   **`alias`** इस Opsgenie alert को OneUptime incident से बाँधता है ताकि आप बाद में alias द्वारा उसे बंद कर सकें। ध्यान दें Opsgenie auth scheme literal word `GenieKey` है जिसके बाद space और आपकी key है।

4. **सहेजें**, enable करें, और एक test incident बनाएँ। Workflow logs में `202 Accepted` response का मतलब है Opsgenie ने alert queue किया।

## चरण 3 — OneUptime resolve पर बंद करें (अनुशंसित)

1. **Incident → On Update** trigger के साथ `Close Opsgenie` नामक एक **दूसरा** वर्कफ़्लो बनाएँ।
2. एक **Conditions** ब्लॉक जोड़ें जो जाँचे कि incident अब resolved है (`{{Incident.currentIncidentState.name}}` पर branch करें)।
3. **Yes** से, एक **API** ब्लॉक जोड़ें:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: वही `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie alias द्वारा alert खोजता है और उसे बंद करता है।

## Priority mapping (वैकल्पिक)

Opsgenie priorities `P1`–`P5` चलते हैं। API block से पहले `{{Incident.incidentSeverity.name}}` पर **Conditions** branches के साथ OneUptime severities से map करें।

## समस्या निवारण

- **`401`/`403`** — गलत key, गलत region host, या integration में alert-create permission नहीं है। पुष्टि करें कि आप **API** integration key और matching `api`/`api.eu` host इस्तेमाल कर रहे हैं।
- **Close `404` return करता है** — close call पर `alias` create call से बिल्कुल match होनी चाहिए, और `identifierType=alias` query string में होना चाहिए।
- **कुछ नहीं होता** — पुष्टि करें कि वर्कफ़्लो **Enabled** है।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — patterns और auth cheat sheet।
- [PagerDuty](/docs/integrations/pagerduty) — PagerDuty के लिए वही विचार।
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime का built-in escalation।
