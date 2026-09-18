# Jira Integration

जब भी कोई OneUptime incident घोषित हो तो एक [Jira](https://www.atlassian.com/software/jira) issue खोलें, incident के आगे बढ़ने के साथ उसे भी साथ रखें, और Jira को status बदलाव वापस OneUptime में भेजने दें — यह सब एक [वर्कफ़्लो](/docs/workflows/index) से। इंस्टॉल करने के लिए कोई Jira-विशिष्ट ब्लॉक नहीं है: OneUptime [API component](/docs/workflows/components#api) से Jira के REST API को कॉल करता है, और Jira वापस एक [Webhook trigger](/docs/workflows/triggers#webhook) को कॉल करता है।

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

यह पेज दोनों दिशाएँ बनाता है। inbound सेक्शन तक सब कुछ **Jira Cloud** के लिए लिखा गया है; अंत के पास एक सेक्शन बताता है कि **Jira Data Center** पर क्या बदलता है।

> Atlassian Jira Cloud में चीज़ों के नाम बदलता रहा है: UI के बड़े हिस्से में अब **project** को **space** कहा जाता है, और **issue** को **work item**। अलग-अलग tenants दोनों शब्दावलियों पर हैं, इसलिए नीचे जहाँ शब्द मायने रखते हैं वहाँ आपको दोनों मिलेंगे।

## पूर्वापेक्षाएँ

- एक Jira Cloud site (`https://your-domain.atlassian.net`) और issues file करने के लिए एक project। उसका **project key** नोट करें — `OPS-1234` में जो `OPS` है, वही।
- एक Jira account जो उस project में issues बना सके, और उसके लिए [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) से एक **API token**। किसी व्यक्ति के account की बजाय service account इस्तेमाल करें — इस तरह बनाई गई issues का श्रेय token के मालिक को जाता है।
- inbound हिस्से के लिए, उस project में automation rules बनाने की अनुमति।
- एक OneUptime project जहाँ आप वर्कफ़्लो और ग्लोबल वेरिएबल बना सकें।

## चरण 1 — Jira credentials को secret के रूप में स्टोर करें

Jira Cloud का REST API **Basic auth** लेता है, जो आपके Atlassian account email और एक API token से बनता है, दोनों को साथ में base64-encode करके।

1. `email:api_token` को एक बार encode करें:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   `echo` नहीं, `printf` इस्तेमाल करें। `echo` एक newline जोड़ देता है, वह newline भी बाकी सब के साथ encode हो जाता है, और Jira `401` लौटाता है — ऐसे कारण से जो आपके पेस्ट किए हुए string में दिखता ही नहीं।

2. OneUptime में, **वर्कफ़्लो → ग्लोबल वेरिएबल → बनाएँ** पर जाएँ। इसे `JIRA_AUTH` नाम दें, base64 string को **Content** के रूप में पेस्ट करें, और **Secret** चालू करें।
3. एक दूसरा, non-secret variable `JIRA_URL` जोड़ें जिसमें `https://your-domain.atlassian.net` हो, बिना अंत के slash के।

अब कोई भी ब्लॉक अपने `Authorization` हेडर के रूप में `Basic {{global.variables.JIRA_AUTH}}` इस्तेमाल कर सकता है, और token वर्कफ़्लो या उसके run logs में कभी नहीं दिखता। [वेरिएबल](/docs/workflows/variables) देखें।

Atlassian API tokens के बारे में दो बातें, जो देर-सबेर ऐसे इंटीग्रेशन को काट लेंगी जिस पर कोई नज़र नहीं रख रहा:

- **ये expire होते हैं।** Tokens एक दिन से एक साल तक की अवधि के साथ बनते हैं, डिफ़ॉल्ट रूप से एक साल, और कोई refresh नहीं होता — expire हो चुके token को उसी पेज पर हाथ से बदलना पड़ता है और फिर से `JIRA_AUTH` में encode करना पड़ता है। expiry की तारीख कहीं calendar में डाल दें। जो वर्कफ़्लो महीनों से चल रहा था वह अचानक `401` लौटाने लगे, तो वजह यही है।
- **scoped token को एक अलग base URL चाहिए।** token पेज पर क्लासिक **Create API token** के साथ-साथ **Create API token with scopes** भी मिलता है। Scoped tokens ज़्यादा सुरक्षित विकल्प हैं, लेकिन वे आपकी site को संबोधित नहीं होते: वे `https://api.atlassian.com/ex/jira/<cloudId>` पर जाते हैं, इसलिए `JIRA_URL` अब वही बन जाता है, और नीचे दिया हर path बिना बदले उसी से जुड़ जाता है। आपका `cloudId` `https://your-domain.atlassian.net/_edge/tenant_info` पर मौजूद JSON में है। `your-domain.atlassian.net` पर भेजा गया scoped token बस विफल हो जाता है।

यदि आपका संगठन Atlassian के centralized user management पर है, तो एक तीसरा विकल्प भी है जो expiry की समस्या से बच निकलता है: [service account के लिए OAuth 2.0 credential](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/)। यह आपको token की बजाय एक client id और secret देता है, और वर्कफ़्लो हर run की शुरुआत में उन्हें एक अल्पकालिक access token से बदल लेता है — वही दो-ब्लॉक वाला आकार जो [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) पेज इस्तेमाल करता है, जिसमें एक **API Post (JSON)** ब्लॉक token लाता है और उसके बाद का हर ब्लॉक `Bearer <token>` भेजता है। एक साल बाद हाथ से कुछ बदलने की ज़रूरत नहीं पड़ती। Atlassian के पेज पर token request का सटीक रूप दिया है; API base URL `https://api.atlassian.com` है।

## चरण 2 — हर incident के लिए एक Jira issue खोलें

1. **वर्कफ़्लो → वर्कफ़्लो बनाएं** खोलें, इसे `Incidents → Jira` नाम दें, और **बिल्डर** खोलें।
2. डैश वाले placeholder ब्लॉक पर क्लिक करें और **On Create Incident** trigger जोड़ें। उसके **Select Fields** में वे columns माँगें जो आप भेजना चाहते हैं:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   इसका **Identifier** `incident-on-create-1` ही रहने दें — बाद के ब्लॉक इसी नाम से इसे संदर्भित करते हैं।

3. **घटक जोड़ें (Add Component)** पर क्लिक करें, एक **API Post (JSON)** ब्लॉक जोड़ें, और trigger के **सफलता** डॉट से नए ब्लॉक के input डॉट तक खींचें। इसे खोलें, इसका **Identifier** `create-issue` सेट करें, और भरें:

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   `OPS` को अपने project key से और `Bug` को उस project में मौजूद किसी issue type से बदलें। दोनों को id से भी दिया जा सकता है — `{"id": "10000"}` — Atlassian के अपने उदाहरण यही इस्तेमाल करते हैं, और यदि आपकी site में दो issue types के नाम एक जैसे हैं तो आपको यही चुनना चाहिए। नीचे दिए `createmeta` कॉल आपको वे ids दे देते हैं।

description भारी लगता है क्योंकि Jira Cloud का v3 API rich text को **Atlassian Document Format** के रूप में लेता है — एक document tree, न कि string। ऊपर दिखाया गया आकार सबसे छोटा वैध document है: एक paragraph जिसमें एक text node है। यही बात `environment` पर और किसी भी multi-line text custom field पर लागू होती है; single-line text custom fields अब भी सादा string लेते हैं।

अब **अवलोकन → Edit Workflow → सक्षम** से वर्कफ़्लो चालू करें, एक test incident घोषित करें, और **रन और लॉग** खोलें। `create-issue` ब्लॉक को `201` और ऐसा body दिखाना चाहिए जिसमें नई issue का `id`, `key` और `self` हो। कैनवास पर किए गए बदलाव अपने-आप सहेजे जाते हैं — कोई Save बटन नहीं है, और बंद पड़ा वर्कफ़्लो बिल्कुल नहीं चल सकता, हाथ से भी नहीं।

नई issue की key इसके बाद के किसी भी ब्लॉक को उपलब्ध रहती है:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### और fields भरना

`fields` के अंदर कुछ सामान्य जोड़:

- **Priority** — `"priority": { "id": "20000" }`, अपनी site का कोई priority id इस्तेमाल करके। OneUptime severities को Jira priorities से map करने के लिए, trigger और API ब्लॉक के बीच एक **If / Else** ब्लॉक रखें और `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` पर branch करें।
- **Assignee** — `"assignee": { "id": "<accountId>" }`। Jira Cloud लोगों की पहचान Atlassian account id से करता है; `username` और `userKey` को Cloud API से सालों पहले हटा दिया गया था।
- **Labels** — `"labels": ["oneuptime", "sev1"]`, strings की एक सपाट array। Labels में spaces नहीं हो सकते।
- **Components** — `"components": [{ "id": "10000" }]`।
- **Custom fields** — `"customfield_10034": "..."`, field की अपनी id इस्तेमाल करके। मान का आकार field के प्रकार पर निर्भर करता है: single-select `{"value": "red"}` लेता है, multi-select ids की एक array, और multi-line text field एक Atlassian Document Format document।

किसी project को वाक़ई क्या चाहिए यह जानने के लिए, अंदाज़ा लगाने की बजाय Jira से पूछें। पहले project के issue types सूचीबद्ध करें, फिर उनमें से किसी एक के fields:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

दूसरा कॉल हर उस field को सूचीबद्ध करता है जिसे वह issue type स्वीकार करता है, उनमें से कौन-से ज़रूरी हैं, और सटीक `customfield_NNNNN` ids। पहले से मौजूद किसी issue से ids पढ़ने के लिए, उसे `?expand=names` के साथ fetch करें।

## चरण 3 — incident id को Jira तक ले जाएँ

two-way sync के दोनों हिस्सों के लिए ज़रूरी है कि एक सिस्टम दूसरे का identifier रखे, और उसे रखने के लिए Jira बेहतर जगह है: OneUptime का `customFields` column एक ही JSON blob है, इसलिए वर्कफ़्लो से एक मान लिखने पर उस incident के सारे custom fields बदल जाते हैं।

**Jira admin के साथ।** project की create screen में एक छोटा text custom field जोड़ें — इसे *OneUptime Incident ID* नाम दें — `createmeta` से उसकी id पता करें, और बाकी सब के साथ उसे भी सेट करें:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Admin के बिना।** इसे इसकी जगह एक label में रखें। Labels में spaces नहीं चलते, और OneUptime id एक सादा UUID है, इसलिए `oneuptime-<id>` एक वैध label है:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

फिर inbound वर्कफ़्लो को उस label को सूची में से चुनना पड़ता है, जो एक **Run Custom JavaScript** ब्लॉक में दो-चार लाइनों का काम है। यदि custom field मिल सके तो वह ज़्यादा साफ़-सुथरा है।

जब आप यहाँ हैं ही, तो Jira issue पर incident तक वापस जाने वाला एक link जोड़ना फ़ायदेमंद है। `create-issue` के बाद एक **API Post (JSON)** ब्लॉक, जो `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink` की ओर इशारा करता हो, इसके साथ:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

Jira में सबको एक-क्लिक में वापस लौटने का रास्ता दे देता है। इसके लिए trigger के **Select Fields** में `projectId` जोड़ें। `globalId` ही इस कॉल को बार-बार करने लायक सुरक्षित बनाता है: Jira दूसरा link जोड़ने की बजाय उसी id वाले मौजूदा link को अपडेट कर देता है। चूँकि update उन सब चीज़ों को null भी कर देता है जिन्हें आप छोड़ देते हैं, इसलिए हमेशा पूरा `object` भेजें, उसका कोई हिस्सा नहीं।

## चरण 4 — incident आगे बढ़ने पर comment और transition करें

इसे एक **दूसरे** वर्कफ़्लो के रूप में बनाएँ, ताकि यहाँ की कोई विफलता issues खुलने को कभी न रोके।

1. **वर्कफ़्लो बनाएं**, इसे `Incident updates → Jira` नाम दें, और **On Update Incident** trigger जोड़ें।
2. **Listen on** में `{"currentIncidentStateId": true}` डालें। तब trigger हर edit की बजाय सिर्फ़ state बदलने पर चलता है। **Select Fields** में `{"_id": true, "currentIncidentState": {"name": true}}` माँगें।
3. एक **If / Else** ब्लॉक जोड़ें: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — या आपके project में resolved state का जो भी नाम हो। [घटना स्थितियाँ और गंभीरता](/docs/incidents/states-and-severities) देखें।

**Yes** शाखा से आपको पहले वह issue ढूँढनी होगी जो आपने चरण 2 में खोली थी। चरण 3 में स्टोर की गई id से Jira से उसे माँगें, एक **API Post (JSON)** ब्लॉक के साथ जिसका **Identifier** `find-issue` हो:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  यदि आपने label की बजाय कोई custom field इस्तेमाल किया है, तो यह clause आपकी अपनी field id के साथ `cf[10050] ~ \"...\"` बन जाता है।

तब issue id `{{local.components.find-issue.returnValues.response-body.issues[0].id}}` होती है, और नीचे दिया हर endpoint key की तरह ही सहजता से id भी लेता है।

इस endpoint के बारे में तीन बातें जानने लायक हैं। **JQL को POST करें, उसे URL में न डालें** — जिस query string के किसी मान के अंदर `=` हो, वह वर्कफ़्लो से बाहर जाते समय कट जाती है, और JQL तो `=` चिह्नों के अलावा कुछ है ही नहीं। **query सीमित होनी चाहिए**: अकेला `order by key desc` `400` के साथ reject हो जाता है, इसीलिए वहाँ `project =` clause है। और `/rest/api/3/search/jql` मौजूदा endpoint है — पुराना `/rest/api/3/search` deprecated है और हटने की राह पर है, इसलिए उसकी तरफ़ हाथ न बढ़ाएँ।

**Comment छोड़ना** एक अकेला **API Post (JSON)** ब्लॉक है जो `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment` पर जाता है, description की तरह ही एक Atlassian Document Format body के साथ:

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**Issue को आगे बढ़ाने** में दो कॉल लगते हैं, क्योंकि transition की पहचान एक ऐसी id से होती है जो एक workflow से दूसरे workflow में, और कुछ boards पर एक issue से दूसरी issue में भी, बदल जाती है।

1. `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` पर एक **API Get (JSON)** ब्लॉक वे transitions लौटाता है जो *issue की मौजूदा status से* उपलब्ध हैं, हर एक के साथ एक `id` और एक `name`, और एक `to` object जो बताता है कि वह किस status तक ले जाती है।
2. उसी URL पर एक **API Post (JSON)** ब्लॉक उनमें से एक को अंजाम देता है:

   ```json
   { "transition": { "id": "31" } }
   ```

सफल transition बिना body के `204` लौटाता है। यदि आप runtime पर सूची नहीं पढ़ना चाहते, तो सही status वाली किसी issue के लिए इसे एक बार हाथ से कॉल करें और id को hard-code कर दें — बस याद रखें कि वह उस workflow से बँधी है, इसलिए Jira workflow संपादित करने वाला कोई admin उसे चुपचाप तोड़ सकता है।

## इनबाउंड — Jira से OneUptime तक

अब दूसरी दिशा: कोई issue को Done पर ले जाता है, और OneUptime incident को भी उसके पीछे चलना चाहिए।

### पहले receiving वर्कफ़्लो बनाएँ

1. **वर्कफ़्लो बनाएं**, इसे `Jira → OneUptime` नाम दें, और **Webhook** trigger जोड़ें।
2. उस वर्कफ़्लो की **सेटिंग्स** खोलें और **Webhook Secret Key** कॉपी करें। आपका URL है:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Self-hosted installs अपना खुद का host इस्तेमाल करते हैं। इस URL को password की तरह समझें — जिसके पास यह है वह वर्कफ़्लो शुरू कर सकता है — और लीक हो जाए तो उसी पेज से key रीसेट कर दें।

3. एक **If / Else** ब्लॉक जोड़ें जो बाकी कुछ भी चलने से पहले एक shared secret जाँचे। **Input 1** है `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** है `{{global.variables.JIRA_WEBHOOK_SECRET}}` — एक मान जो आप खुद तय करते हैं और एक secret ग्लोबल वेरिएबल के रूप में सहेजते हैं।
4. **Yes** शाखा से, एक **Update One Incident** ब्लॉक जोड़ें:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: Jira के बदलाव का यहाँ जो मतलब होना चाहिए — आमतौर पर एक state बदलाव।

   किसी incident को आगे बढ़ाने के लिए लक्ष्य state की id चाहिए, जो `{"name": "Resolved"}` query वाला एक **Find One Incident State** ब्लॉक आपको `{{local.components.incident-state-find-one-1.returnValues.model._id}}` के रूप में देगा। उसे `currentIncidentStateId` में लिखें।

वर्कफ़्लो को सक्षम रहने दें। अब Jira को कॉल करने के लिए कुछ दें।

### Jira automation rule से event भेजें

1. Jira में, project के automation rules खोलें: नए tenants पर **Space settings → Automation**, पुराने पर **Project settings → Automation**। कई projects में फैले rule के लिए **Settings → System → Global automation** इस्तेमाल करें, जिसके लिए *Administer Jira* global permission चाहिए।
2. **Create rule** करें, और **Work item transitioned** trigger चुनें — पुराने tenants पर **Issue transitioned**। इसे तब चलने के लिए सेट करें जब status **Done** *पर* पहुँचे।

   यही trigger इस्तेमाल करें, *Work item updated* नहीं: update trigger जानबूझकर status बदलावों को छोड़ देता है।

3. **Send web request** action जोड़ें और उसे कॉन्फ़िगर करें:

   - **Web request URL**: ऊपर दिया OneUptime webhook URL।
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, और `X-OneUptime-Secret` / आपका shared secret। secret के मान पर **Hide** विकल्प इस्तेमाल करें ताकि दूसरे rule editors उसे न पढ़ सकें — ध्यान रखें कि उस मान के लिए छिपाना अपरिवर्तनीय है, और rule को export या duplicate करने पर छिपाए गए मान खो जाते हैं।
   - **Web request body**: **Custom format**, ताकि आकार आपके नियंत्रण में रहे:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     यदि आपने चरण 3 में custom field की बजाय label इस्तेमाल किया है, तो `"labels": "{{issue.labels}}"` भेजें और OneUptime की तरफ़ एक **Run Custom JavaScript** ब्लॉक से id निकाल लें।

4. rule चालू करें, किसी test issue को Done पर ले जाएँ, और दोनों तरफ़ जाँचें: Jira में rule का अपना audit log, और OneUptime में **रन और लॉग**।

इस पर भरोसा करने से पहले जानने लायक बातें:

- **गंतव्य port सीमित है।** Send web request केवल ports 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 और 9900 तक पहुँचता है। OneUptime Cloud 443 पर है; किसी असामान्य port पर चल रहे self-hosted install को इस तरह कॉल नहीं किया जा सकता।
- **कोई request signing नहीं है।** इस action में HMAC का विकल्प नहीं है, इसलिए HTTPS पर एक हेडर में shared secret ही वह तरीका है जिसे Atlassian दस्तावेज़ित करता है। receiving वर्कफ़्लो के चरण 3 वाली **If / Else** जाँच ही उसे उपयोगी बनाती है।
- **Rule runs गिने जाते हैं।** Jira Cloud सफल rule executions को एक मासिक सीमा में गिनता है जो आपके plan पर निर्भर करती है — Free पर 100, Standard पर 1,700, Premium पर 1,000 × users, Enterprise पर असीमित। किसी व्यस्त project में हर transition पर चलने वाला rule जल्दी जुड़ जाता है।
- **मान आपके लिए URL-encode नहीं किए जाते।** यह तभी मायने रखता है जब आप form-encoded body भेजें; ऊपर दिया JSON ठीक है।
- **Atlassian अपनी egress ranges प्रकाशित करता है** — [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com) पर — यदि आपका OneUptime install किसी allow list के पीछे है। ये बदलती रहती हैं, इसलिए पतों को पिन करने की बजाय feed को समय-समय पर पढ़ते रहें।

### या इसकी जगह Jira webhook इस्तेमाल करें

कोई Jira admin सीधे **Settings → System → Advanced → WebHooks** के नीचे एक webhook register कर सकता है, वहाँ भेजे जाने वाले events चुनकर और वैकल्पिक रूप से एक JQL query देकर जो सीमित करे कि कौन-सी issues इसे चलाएँ। automation rule की तुलना में:

- payload Jira का अपना होता है, आपका नहीं: `webhookEvent`, `issue_event_type_name`, पूरी `issue`, और एक `changelog` जिसकी `items` array हर बदले हुए field का पहले-और-बाद रखती है। status बदलाव के लिए आपको वह entry चाहिए जिसमें `field` `status` है। वर्कफ़्लो के अंदर उसे पढ़ने का मतलब आमतौर पर एक **Run Custom JavaScript** ब्लॉक होता है।
- Webhooks पर signature लग **सकती** है — webhook को एक secret दें और Jira एक `X-Hub-Signature` हेडर भेजता है जिसमें request body का HMAC होता है — लेकिन वर्कफ़्लो उसे जाँच नहीं सकता। signature ठीक उन्हीं bytes पर बनती है जो Jira ने भेजे थे, और Webhook trigger वर्कफ़्लो को ऐसी body देता है जो पहले ही JSON में parse हो चुकी है, इसलिए hash करने को कुछ बचता ही नहीं। यदि आप request को authenticated चाहते हैं, तो इसकी जगह shared-secret हेडर वाला automation rule इस्तेमाल करें।
- URL को Jira की अपनी सूची के किसी port पर HTTPS होना चाहिए, और वह सूची automation action वाली सूची जैसी *नहीं* है — यहाँ port 80 की अनुमति नहीं है।
- delivery को पाँच से पंद्रह मिनट के backoff के साथ पाँच बार तक दोहराया जाता है, इसलिए आपके वर्कफ़्लो को वही event दो बार आने पर भी सह लेना चाहिए।

किसी app द्वारा `/rest/api/3/webhook` से register किए गए webhooks एक अलग ही चीज़ हैं: refresh न किए जाएँ तो वे registration के 30 दिन बाद expire हो जाते हैं। ऊपर बताए गए admin-registered webhooks expire नहीं होते।

## Jira Data Center

Self-managed Jira कुछ प्रतिस्थापनों के साथ उसी तरह काम करता है। **Jira Server** का समर्थन फ़रवरी 2024 में समाप्त हो गया और उसे कोई fixes नहीं मिलते, इसलिए self-managed लक्ष्य के रूप में Data Center को ही मानें।

| Cloud                                                        | Data Center                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `/rest/api/3/...`                                            | `/rest/api/2/...` — Data Center पर कोई v3 नहीं है                               |
| Atlassian Document Format document के रूप में `description`  | wiki markup में सादा string के रूप में `description`                            |
| `Authorization: Basic base64(email:api_token)`               | `Authorization: Bearer <personal access token>`                                 |
| id.atlassian.com से API token                                | अपने Jira account पर **Profile → Personal access tokens → Create token**        |
| Automation action **Send web request**                       | Automation action **Send outgoing web request**                                 |

तो create-issue ब्लॉक `/rest/api/2/issue` पर एक `POST` बन जाता है, इसके साथ:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

जिसे template करना आसान है — कोई document tree नहीं।

और जिन अंतरों की योजना बनानी है:

- **Personal access tokens** Jira Core और Jira Software 8.14 तथा Jira Service Management 4.15 से मौजूद हैं। ये expire होते हैं — डिफ़ॉल्ट रूप से 365 दिन — और UI पाँच दिन पहले उन्हें *Expires soon* के रूप में चिह्नित कर देता है। Data Center पर username और password वाला Basic auth अब भी काम करता है, लेकिन कुछ विफल logins एक CAPTCHA चला देते हैं जो account को REST API से पूरी तरह बाहर कर देता है, जब तक कोई इंसान browser में उसे हल न कर दे — किसी typo का पता लगाने का यह बुरा तरीका है। token को प्राथमिकता दें।
- **Automation साथ में आता है** — Jira Data Center 10.0 से। उससे पहले यह अलग से इंस्टॉल किया जाने वाला Automation for Jira app था। इसके outgoing request का डिफ़ॉल्ट timeout 3000 ms है, जिसे `outgoing.webhook.timeout.ms` property से बदला जा सकता है।
- **Webhooks** **Administration → System → Advanced → WebHooks** पर register होते हैं, और JQL scoping समर्थित है। उन filters को संकीर्ण रखें: Jira हर register किए गए webhook की JQL उसी thread पर मूल्यांकित करता है जिसने event उठाया था, इसलिए एक दर्जन ढीले filters उसी user action को धीमा कर देते हैं जिसने उन्हें चलाया।
- **Data Center 10.0 से webhook delivery asynchronous है** और कोई synchronous विकल्प नहीं है, इसलिए events क्रम से बाहर आ सकते हैं। receiving वर्कफ़्लो को idempotent बनाएँ।
- **Jira 10 ने webhook URL variables से `$` हटा दिया** — `${issue.id}` `{issue.id}` बन गया — और webhook REST resource को `/rest/webhooks/1.0/webhook` से `/rest/jira-webhook/1.0/webhooks` पर ले गया।

## alerts के लिए भी वही करना

ऊपर सब कुछ incidents के इर्द-गिर्द लिखा गया है क्योंकि वही आम स्थिति है, लेकिन alerts भी बिल्कुल वैसे ही काम करते हैं — record type बदल दें, और कुछ नहीं बदलता:

| Incident                                 | Alert                                       |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

किसी वर्कफ़्लो में ठीक एक trigger होता है, इसलिए incidents और alerts के लिए एक-एक अलग वर्कफ़्लो चाहिए। यदि दोनों को एक ही काम करना है, तो Jira वाला हिस्सा एक बार बनाएँ और दोनों से **Execute Workflow** कंपोनेंट के ज़रिए उसे बुलाएँ।

## समस्या निवारण

पहले **रन और लॉग** में विफल ब्लॉक खोलें। Jira एक JSON body लौटाता है जो ठीक-ठीक बताती है कि उसने क्या reject किया, और API कंपोनेंट उसे `response-body` में रखता है।

**`401 Unauthorized`।** `email:api_token` को `printf` से फिर से encode करें और `JIRA_AUTH` अपडेट करें; `echo` से आया trailing newline आम कारण है। फिर पुष्टि करें कि token का मालिक account उस project में issues बना सकता है। Data Center पर जाँचें कि आप `Basic` नहीं, `Bearer` भेज रहे हैं।

**किसी field का नाम लेता `400 Bad Request`।** वह issue type project में मौजूद नहीं है, या project में कोई ज़रूरी field है जिसे आप नहीं भेज रहे। उस project और issue type पर ऊपर दिए `createmeta` कॉल चलाएँ और तुलना करें।

**`description` की शिकायत करता `400`।** Cloud v3 पर description को Atlassian Document Format document होना चाहिए, string नहीं। या तो ऊपर दिखाया गया document भेजें, या उस ब्लॉक को `/rest/api/2/issue` पर स्विच करें और सादा text भेजें।

**`404 Not Found`।** base URL और API version जाँचें — Cloud पर `/rest/api/3/...`, Data Center पर `/rest/api/2/...`।

**`429 Too Many Requests`।** Jira rate limiting कर रहा है। response सेकंडों में `Retry-After` लाता है और एक `RateLimit-Reason` जो बताता है कि आपने कौन-सी सीमा छुई। किसी एक issue पर writes पर कड़ी सीमा है — करीब दो सेकंड में बीस — इसलिए जो वर्कफ़्लो तेज़ी से comment और transition करता है वह अकेली एक issue पर ही यह सीमा छू सकता है। कॉल्स के बीच एक **Delay** ब्लॉक रखें, या थोक काम को किसी scheduled वर्कफ़्लो में ले जाएँ।

**transition कॉल `400` लौटाता है।** वह transition id issue की *मौजूदा* status से वैध नहीं है। उस issue के लिए `/transitions` fetch करें और response में से कोई id इस्तेमाल करें।

**automation rule सफल दिखता है लेकिन OneUptime तक कुछ नहीं पहुँचता।** पहले port जाँचें — ऊपर दी प्रतिबंधित सूची देखें। फिर खुद `curl` से webhook URL पर एक request भेजें और देखें कि वह **रन और लॉग** में दिखती है या नहीं; यदि आपकी request पहुँचती है और Jira की नहीं, तो समस्या Jira की तरफ़ है।

**वर्कफ़्लो चलता है लेकिन incident बदलता नहीं।** जब **Update One Incident** ब्लॉक की query से कुछ मेल नहीं खाता तो वह `Items Updated: 0` रिपोर्ट करता है, और यह सफलता गिनी जाती है, त्रुटि नहीं। जाँचें कि payload में दी गई id वाक़ई OneUptime incident id है और आप `_id` पर query कर रहे हैं।

**कोई `{{...}}` reference Jira issue में ज्यों का त्यों दिखता है।** जो reference resolve नहीं होता उसे खाली करने की बजाय text के रूप में आगे भेज दिया जाता है। run log हर उस reference का नाम बताता है जो resolve नहीं हुआ — आमतौर पर कोई गलत लिखा block identifier या नाम बदला हुआ variable।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — inbound और outbound पैटर्न, और auth चीट शीट।
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — Dynamics के विरुद्ध वही दो-दिशा वाला निर्माण।
- [वर्कफ़्लो अवलोकन](/docs/workflows/index) और [वर्कफ़्लो बनाना](/docs/workflows/authoring) — कैनवास, identifiers, और वर्कफ़्लो चालू करना।
- [कंपोनेंट](/docs/workflows/components) — API ब्लॉक, If / Else, और OneUptime data components।
- [वेरिएबल](/docs/workflows/variables) — सीक्रेट, और एक ब्लॉक का output अगले ब्लॉक में पढ़ना।
- [कॉन्फ़िगरेशन और सुरक्षा](/docs/workflows/configuration) — webhook सुरक्षा और आउटबाउंड network access।
- [ServiceNow](/docs/integrations/servicenow) और [PagerDuty](/docs/integrations/pagerduty) — अन्य टूल्स के लिए वही outbound pattern।
