# GitLab Integration

जब OneUptime incident बनाया जाए तो स्वचालित रूप से एक [GitLab](https://gitlab.com) issue खोलें — ताकि engineering follow-up उस project में land हो जो affected service की मालिक है।

यह इंटीग्रेशन **आउटबाउंड** है: OneUptime [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html) को कॉल करता है। यह **Incident → On Create** trigger और **API component** के साथ OneUptime **[वर्कफ़्लो](/docs/workflows/index)** का उपयोग करता है। यह GitLab.com और self-managed GitLab दोनों पर एक ही तरह काम करता है।

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## पूर्वापेक्षाएँ

- एक GitLab project और उसका **Project ID** (project के overview page पर, project name के नीचे दिखाया जाता है)।
- एक access token जो issues बना सके — `api` scope के साथ एक **Project**, **Group**, या **Personal Access Token**: **Settings → Access Tokens**।
- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

## चरण 1 — token store करें

1. **Workflows → Global Variables → Create** पर जाएँ।
2. इसे `GITLAB_TOKEN` नाम दें, token पेस्ट करें, और **Is Secret** चालू करें।

## चरण 2 — वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Incidents → GitLab Issues` नाम दें, और **Builder** खोलें।
2. **On Create** पर सेट एक **Incident** trigger जोड़ें। इसे `Incident` नाम दें।
3. trigger से connected एक **API** ब्लॉक जोड़ें:

   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues` _(`12345678` को अपने Project ID से बदलें; self-managed के लिए, अपना host इस्तेमाल करें)_
   - **Headers**:

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **सहेजें**, enable करें, और एक test incident बनाएँ। Workflow logs में `201 Created` का मतलब है issue बनाई गई; response body में उसका `iid` और `web_url` है।

## टिप्स

- **Self-managed GitLab**: `https://gitlab.com` को अपने instance URL से बदलें; `/api/v4/...` path वही रहता है।
- **ID की बजाय Project path**: numeric ID की जगह आप path को URL-encode कर सकते हैं — जैसे `group%2Fproject`।
- **Assignee / due date**: body में `"assignee_ids": [42]` या `"due_date": "2026-01-31"` जोड़ें।
- **वापस link करें**: `{{CreateIssue.response-body.web_url}}` पढ़ें और इसे **Update Incident** ब्लॉक के साथ incident पर store करें।

## समस्या निवारण

- **`401`** — token invalid या expired है, या `api` scope नहीं है।
- **`404`** — Project ID गलत है, या token किसी private project को access नहीं कर सकता।
- **`400`** — कोई required field missing या malformed है; `title` ज़रूरी है।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — patterns और auth cheat sheet।
- [GitHub](/docs/integrations/github) — GitHub के लिए वही विचार।
- [API component](/docs/workflows/components#api) — response body पढ़ना।
