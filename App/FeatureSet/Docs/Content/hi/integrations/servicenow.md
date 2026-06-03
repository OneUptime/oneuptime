# ServiceNow Integration

जब भी OneUptime incident बनाया जाए तो स्वचालित रूप से एक [ServiceNow](https://www.servicenow.com) incident खोलें — ताकि ITSM और monitoring synchronized रहें।

यह इंटीग्रेशन **आउटबाउंड** है: OneUptime ServiceNow [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) को कॉल करता है। यह **Incident → On Create** trigger और **API component** के साथ OneUptime **[वर्कफ़्लो](/docs/workflows/index)** का उपयोग करता है।

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## पूर्वापेक्षाएँ

- एक ServiceNow instance (`https://your-instance.service-now.com`)।
- `rest_api_explorer` / `itil` roles (या `incident` records बनाने के लिए पर्याप्त rights) वाला एक ServiceNow user। इस user के credentials के साथ Basic auth शुरू करने का सबसे आसान तरीका है; production के लिए OAuth अनुशंसित है।
- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

## चरण 1 — credentials को secret के रूप में store करें

ServiceNow का Table API **Basic auth** accept करता है।

1. `username:password` को एक बार Base64-encode करें:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. OneUptime में, **Workflows → Global Variables → Create** पर जाएँ, इसे `SERVICENOW_AUTH` नाम दें, base64 string पेस्ट करें, और **Is Secret** चालू करें।

## चरण 2 — वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Incidents → ServiceNow` नाम दें, और **Builder** खोलें।
2. **On Create** पर सेट एक **Incident** trigger जोड़ें। इसे `Incident` नाम दें।
3. trigger से connected एक **API** ब्लॉक जोड़ें:
   - **Method**: `POST`
   - **URL**: `https://your-instance.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` OneUptime incident से एक link रखता है — यदि आप बाद में resolve step जोड़ते हैं तो उपयोगी। ServiceNow `urgency`/`impact` `1` (high), `2` (medium), `3` (low) इस्तेमाल करते हैं।
4. **सहेजें**, enable करें, और एक test incident बनाएँ। Workflow logs में `201 Created` response नए record का `sys_id` और `number` (उदाहरण `INC0012345`) return करती है।

## चरण 3 — OneUptime resolve पर resolve करें (वैकल्पिक)

1. **Incident → On Update** trigger और एक **Conditions** ब्लॉक के साथ एक **दूसरा** वर्कफ़्लो बनाएँ जो जाँचे कि incident resolved है।
2. सही ServiceNow record update करने के लिए आपको उसका `sys_id` चाहिए। या तो चरण 2 में OneUptime incident पर store करें (`{{CreateRecord.response-body.result.sys_id}}` पढ़ें और **Update Incident** के साथ label में लिखें), या `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}` पर `GET` से पहले record खोजें।
3. एक **API** ब्लॉक जोड़ें: **Method** `PATCH`, **URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`, body `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` = default ITIL workflow में Resolved)।

## समस्या निवारण

- **`401`** — `username:password` को `printf` से फिर से encode करें (`echo` नहीं, जो newline जोड़ता है) और `SERVICENOW_AUTH` अपडेट करें।
- **`403`** — user के पास `incident` table लिखने के rights नहीं हैं; `itil` role जोड़ें।
- **`400`** — आपके instance के customizations के लिए कोई field name या value गलत है। **System Definition → Tables → incident** में field names जाँचें।
- **Instance call reject करता है** — कुछ instances Table API को restrict करते हैं; पुष्टि करें कि REST enabled है और आपका IP किसी ACL द्वारा block नहीं है।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — patterns और auth cheat sheet।
- [Jira](/docs/integrations/jira) — Jira के लिए वही outbound pattern।
- [API component](/docs/workflows/components#api) — response body पढ़ना।
