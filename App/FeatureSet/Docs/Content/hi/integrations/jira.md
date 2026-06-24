# Jira Integration

जब भी OneUptime में एक incident बनाया जाए तो स्वचालित रूप से एक [Jira](https://www.atlassian.com/software/jira) issue खोलें — ताकि engineering work वहाँ track हो जहाँ आपके developers पहले से रहते हैं, incident के वापस link के साथ।

यह इंटीग्रेशन **आउटबाउंड** है: OneUptime Jira के REST API को कॉल करता है। यह **Incident → On Create** trigger और **API component** के साथ OneUptime **[वर्कफ़्लो](/docs/workflows/index)** का उपयोग करता है। आप वैकल्पिक रूप से एक **inbound** path जोड़ सकते हैं ताकि Jira issue बंद करने पर OneUptime incident resolve हो।

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## पूर्वापेक्षाएँ

- एक Jira Cloud site (`https://your-domain.atlassian.net`) और issues file करने के लिए एक project — उसका **project key** नोट करें (जैसे `OPS`)।
- एक Jira account जो issues बना सके, और उसके लिए [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) से एक **API token**।
- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

> **Jira Data Center / Server** (self-managed) इस्तेमाल कर रहे हैं? flow वही है — अपना base URL इस्तेमाल करें और Basic auth की बजाय `Bearer` auth header के साथ एक [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) इस्तेमाल करें। `/rest/api/2/issue` endpoint plain-text description accept करता है, जो templating को आसान बनाता है।

## चरण 1 — अपनी Jira credentials को secret के रूप में स्टोर करें

Jira Cloud आपके email और API token के साथ **Basic auth** इस्तेमाल करता है, base64-encoded।

1. `email:api_token` को एक बार Base64-encode करें। macOS/Linux पर:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. OneUptime में, **Workflows → Global Variables → Create** पर जाएँ।
3. इसे `JIRA_AUTH` नाम दें, base64 string value के रूप में पेस्ट करें, और **Is Secret** चालू करें।

अब आप auth header के रूप में `Basic {{variable.JIRA_AUTH}}` इस्तेमाल कर सकते हैं और token वर्कफ़्लो या उसके logs में कभी नहीं दिखेगा।

## चरण 2 — वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Incidents → Jira` नाम दें, और **Builder** खोलें।
2. कैनवास पर एक **Incident** trigger खींचें और **On Create** event चुनें। इसे `Incident` नाम दें।
3. एक **API** ब्लॉक खींचें और trigger से जोड़ें। कॉन्फ़िगर करें:

   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 description के लिए Atlassian Document Format इस्तेमाल करता है):

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   `OPS` को अपने project key से और `Bug` को उस project में मौजूद issue type से बदलें।

4. **सहेजें।** वर्कफ़्लो तब तक disabled छोड़ें जब तक आप इसे test नहीं कर लेते।

## चरण 3 — परीक्षण करें

1. वर्कफ़्लो **Enabled** चालू करें।
2. OneUptime में एक test incident बनाएँ (या monitor से एक trigger करें)।
3. वर्कफ़्लो का **Logs** tab खोलें। **API** ब्लॉक को `201` status और नई issue के `key` वाली response body दिखानी चाहिए (उदाहरण `OPS-1234`)।
4. Jira जाँचें — issue वहाँ है।

यदि API block error return करता है, तो इसे logs में expand करें — Jira की response बताती है कि उसने किस field को reject किया। [समस्या निवारण](#समस्या-निवारण) देखें।

## चरण 4 — incident को issue से वापस link करें (अनुशंसित)

Jira issue key को incident पर store करना उपयोगी है ताकि लोग उनके बीच jump कर सकें।

- API block की response `{{CreateIssue.response-body.key}}` के रूप में उपलब्ध है (यदि आपने ब्लॉक का नाम `CreateIssue` रखा है)।
- उसके बाद एक **Update Incident** ब्लॉक जोड़ें और key को incident पर एक label, custom field, या note में लिखें।

यह नीचे दिए वैकल्पिक two-way sync को भी संभव बनाता है।

## Two-way sync (वैकल्पिक)

जब कोई Jira issue बंद करे तो OneUptime incident resolve करने के लिए, एक **inbound** वर्कफ़्लो जोड़ें:

1. एक दूसरा वर्कफ़्लो बनाएँ जो **Webhook** trigger से शुरू हो और उसका URL कॉपी करें।
2. Jira में, **Project settings → Automation → Create rule** पर जाएँ:

   - **Trigger**: _Issue transitioned_ to **Done** (या _Issue resolved_)।
   - **Action**: _Send web request_ → method `POST`, URL = आपका workflow webhook URL, body में issue key और OneUptime incident id शामिल करें, जैसे:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. वर्कफ़्लो में, stored key द्वारा incident locate करने के लिए **Find Incident** ब्लॉक इस्तेमाल करें, फिर उसे आपके resolved state में ले जाने के लिए **Update Incident** ब्लॉक।

यदि आपने चरण 4 में Jira key incident पर store की है, तो matching सीधी है। [कंपोनेंट → OneUptime data components](/docs/workflows/components#oneuptime-data-components) देखें।

## Issue को customize करना

API block की body में कुछ सामान्य बदलाव:

- **Priority** — `fields` के अंदर `"priority": { "name": "High" }` जोड़ें। OneUptime severities को Jira priorities से map करने के लिए API block से पहले `{{Incident.incidentSeverity.name}}` पर **Conditions** से branch कर सकते हैं।
- **Labels** — `"labels": ["oneuptime", "incident"]` जोड़ें।
- **Assignee** — `"assignee": { "id": "<accountId>" }` जोड़ें (Jira Cloud usernames की बजाय account IDs इस्तेमाल करता है)।
- **Custom fields** — अपने Jira admin से field के ID का उपयोग करके `"customfield_XXXXX": "..."` जोड़ें।

किसी project में अपेक्षित exact field names discover करने के लिए, अपने browser या `curl` से एक बार Jira के `GET /rest/api/3/issue/createmeta` endpoint को कॉल करें।

## समस्या निवारण

**`401 Unauthorized`।**

- `email:api_token` को फिर से encode करें और `JIRA_AUTH` variable अपडेट करें। Trailing newline सबसे आम कारण है — encoding करते समय `echo` की बजाय `printf` इस्तेमाल करें।
- पुष्टि करें कि API token का मालिक account project में issues बना सकता है।

**`400 Bad Request` में कोई field का उल्लेख।**

- Issue type या कोई required field गलत है। Project का **issue type** नाम जाँचें और देखें कि उसके required custom fields हैं या नहीं। क्या mandatory है यह देखने के लिए `createmeta` (ऊपर) इस्तेमाल करें।

**`404 Not Found`।**

- Base URL दोबारा जाँचें और सुनिश्चित करें कि आप `/rest/api/3/issue` (Cloud) या `/rest/api/2/issue` (Server/Data Center) hit कर रहे हैं।

**Description एक single line में दिखती है / अजीब लगती है।**

- v3 ऊपर दिखाया गया Atlassian Document Format ज़रूरी है। यदि आप plain text भेजना चाहते हैं, तो `/rest/api/2/issue` endpoint इस्तेमाल करें और `"description": "{{Incident.description}}"` को plain string के रूप में दें।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — inbound/outbound patterns और auth cheat sheet।
- [API component](/docs/workflows/components#api) — methods, headers, और response पढ़ना।
- [वेरिएबल](/docs/workflows/variables) — secrets और incident fields।
- [PagerDuty](/docs/integrations/pagerduty) और [ServiceNow](/docs/integrations/servicenow) — अन्य टूल्स के लिए वही outbound pattern।
