# GitHub Integration

जब OneUptime incident बनाया जाए तो स्वचालित रूप से एक [GitHub](https://github.com) issue खोलें — ताकि engineering follow-up उस repo में track हो जो affected service की मालिक है।

यह इंटीग्रेशन **आउटबाउंड** है: OneUptime [GitHub REST API](https://docs.github.com/en/rest/issues/issues) को कॉल करता है। यह **Incident → On Create** trigger और **API component** के साथ OneUptime **[वर्कफ़्लो](/docs/workflows/index)** का उपयोग करता है।

> **गहरा GitHub connection ढूंढ रहे हैं?** OneUptime के पास code repositories जोड़ने के लिए एक native **GitHub App** integration भी है (AI agent और code features द्वारा इस्तेमाल)। यह environment variables से configure होता है, workflows से नहीं — [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration) देखें। यह पेज विशेष रूप से _incidents से issues file करने_ के बारे में है।

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## पूर्वापेक्षाएँ

- एक GitHub repository जहाँ आप issues file करना चाहते हैं।
- एक token जो issues बना सके:

  - **Fine-grained PAT** उस repo के लिए scoped, **Issues: Read and write** के साथ, या
  - `repo` scope के साथ एक **classic PAT**।

  [github.com/settings/tokens](https://github.com/settings/tokens) पर एक बनाएँ।

- एक OneUptime project जहाँ आप वर्कफ़्लो बना सकते हैं।

## चरण 1 — token store करें

1. **Workflows → Global Variables → Create** पर जाएँ।
2. इसे `GITHUB_TOKEN` नाम दें, token पेस्ट करें, और **Is Secret** चालू करें।

## चरण 2 — वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Incidents → GitHub Issues` नाम दें, और **Builder** खोलें।
2. **On Create** पर सेट एक **Incident** trigger जोड़ें। इसे `Incident` नाम दें।
3. trigger से connected एक **API** ब्लॉक जोड़ें:

   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/your-org/your-repo/issues`
   - **Headers**:

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **सहेजें**, enable करें, और एक test incident बनाएँ। Workflow logs में `201 Created` का मतलब है issue बनाई गई; response body में उसका `number` और `html_url` है।

## टिप्स

- **GitHub Enterprise Server**: `https://your-host/api/v3/repos/{owner}/{repo}/issues` इस्तेमाल करें।
- **Assignees / milestone**: body में `"assignees": ["octocat"]` या `"milestone": 3` जोड़ें।
- **वापस link करें**: `{{CreateIssue.response-body.html_url}}` पढ़ें और इसे **Update Incident** ब्लॉक के साथ incident पर store करें।

## समस्या निवारण

- **`401`** — token गलत या expired है। Fine-grained tokens को explicitly repo और **Issues** permission grant करनी होती है।
- **`403` / rate limit** — `User-Agent` header शामिल करें (GitHub इसके बिना requests reject करता है) और जाँचें कि आप rate-limited तो नहीं हैं।
- **`404`** — `owner/repo` path गलत है, या token किसी private repo को नहीं देख सकता।
- **`422`** — एक label जो exist नहीं करता ठीक है (GitHub referenced labels बनाता है), लेकिन malformed body नहीं — अपना JSON जाँचें।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — patterns और auth cheat sheet।
- [GitLab](/docs/integrations/gitlab) — GitLab के लिए वही विचार।
- [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration) — native GitHub App connection।
