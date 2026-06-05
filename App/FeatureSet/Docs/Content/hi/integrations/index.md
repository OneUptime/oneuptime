# इंटीग्रेशन

OneUptime उन टूल्स से जुड़ता है जो आपकी टीम पहले से इस्तेमाल करती है — Zabbix, Jira, PagerDuty, Slack, और कई अन्य — **[वर्कफ़्लो](/docs/workflows/index)** के माध्यम से, जो बिल्ट-इन ऑटोमेशन इंजन है। कोई अलग प्लगइन इंस्टॉल करने की ज़रूरत नहीं है। आप एक ड्रैग-एंड-ड्रॉप कैनवास पर इंटीग्रेशन जोड़ते हैं, और यह जब भी कुछ होता है तब चलता है।

यह पेज दो पैटर्न बताता है जो हर इंटीग्रेशन इस्तेमाल करता है। एक बार जब आप इन्हें समझ लेते हैं, तो आप OneUptime को लगभग किसी भी चीज़ से जोड़ सकते हैं — यहाँ तक कि उन टूल्स से भी जिनका अपना पेज यहाँ नहीं है।

## दो पैटर्न

हर इंटीग्रेशन दो में से किसी एक दिशा में डेटा ले जाता है (और कई दोनों इस्तेमाल करते हैं)।

### इनबाउंड — कोई अन्य टूल OneUptime में डेटा भेजता है

इसे तब इस्तेमाल करें जब किसी बाहरी सिस्टम को *OneUptime में कुछ बनाना या अपडेट करना हो* — आमतौर पर जब वह कोई समस्या पहचाने तो एक incident या alert खोलना।

1. एक वर्कफ़्लो बनाएँ जो **[Webhook trigger](/docs/workflows/triggers#webhook)** से शुरू हो। OneUptime आपको एक यूनिक URL देता है।
2. दूसरे टूल में, एक webhook / notification action कॉन्फ़िगर करें जो कुछ होने पर उस URL पर POST करे।
3. वर्कफ़्लो में, आने वाला payload पढ़ें और इसे रिकॉर्ड करने के लिए **Create Incident** (या Create Alert) कंपोनेंट का उपयोग करें।

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### आउटबाउंड — OneUptime किसी अन्य टूल को डेटा भेजता है

इसे तब इस्तेमाल करें जब *OneUptime में जो होता है वह किसी अन्य टूल में दिखना चाहिए* — Jira टिकट खोलना, PagerDuty में किसी को पेज करना, Slack पर पोस्ट करना।

1. एक वर्कफ़्लो बनाएँ जो **[OneUptime event trigger](/docs/workflows/triggers#oneuptime-event-triggers)** से शुरू हो — उदाहरण के लिए **Incident → On Create**।
2. एक **[API component](/docs/workflows/components#api)** जोड़ें जो incident के विवरण के साथ दूसरे टूल के REST API को कॉल करे।
3. कोई भी API key को **secret [global variables](/docs/workflows/variables#global-variables)** के रूप में स्टोर करें ताकि वे वर्कफ़्लो या उसके लॉग में कभी न दिखें।

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## कैटलॉग

| टूल | दिशा | क्या करता है |
| --- | --- | --- |
| [Zabbix](/docs/integrations/zabbix) | इनबाउंड | Zabbix की समस्याओं को OneUptime incidents में बदलें (और recovery पर उन्हें resolve करें)। |
| [Jira](/docs/integrations/jira) | आउटबाउंड (+ इनबाउंड) | हर incident के लिए एक Jira issue खोलें; status वापस sync करें। |
| [PagerDuty](/docs/integrations/pagerduty) | आउटबाउंड (+ इनबाउंड) | OneUptime incidents से PagerDuty events trigger और resolve करें। |
| [Opsgenie](/docs/integrations/opsgenie) | आउटबाउंड (+ इनबाउंड) | Opsgenie alerts बनाएँ और बंद करें। |
| [ServiceNow](/docs/integrations/servicenow) | आउटबाउंड (+ इनबाउंड) | OneUptime से ServiceNow incidents खोलें। |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | इनबाउंड | Alertmanager notifications को incidents में बदलें। |
| [Grafana](/docs/integrations/grafana) | इनबाउंड | Grafana alerts को incidents में बदलें। |
| [Datadog](/docs/integrations/datadog) | इनबाउंड | Datadog monitor alerts को incidents में बदलें। |
| [GitHub](/docs/integrations/github) | आउटबाउंड | किसी incident के लिए एक GitHub issue खोलें। |
| [GitLab](/docs/integrations/gitlab) | आउटबाउंड | किसी incident के लिए एक GitLab issue खोलें। |
| [Discord](/docs/integrations/discord) | आउटबाउंड | Discord चैनल पर incident updates पोस्ट करें। |
| [Telegram](/docs/integrations/telegram) | आउटबाउंड | Telegram chat में incident updates भेजें। |
| [Slack](/docs/workspace-connections/slack) | दोनों | Native workspace connection — channels, alerts, और on-call। |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams) | दोनों | Native workspace connection। |

> **Slack और Microsoft Teams** का एक गहरा, native connection है जो वर्कफ़्लो से परे जाता है — automatic incident channels, two-way actions, और on-call notifications। उनके लिए वर्कफ़्लो बनाने की बजाय [Slack](/docs/workspace-connections/slack) और [Microsoft Teams](/docs/workspace-connections/microsoft-teams) workspace connections का उपयोग करें।

## सीक्रेट हैंडल करना

कभी भी किसी ब्लॉक में सीधे API key या token पेस्ट न करें। इसके बजाय:

1. **Workflows → Global Variables** पर जाएँ।
2. एक variable बनाएँ — उदाहरण के लिए `JIRA_AUTH` — और **Is Secret** चालू करें।
3. इसे कहीं भी `{{variable.JIRA_AUTH}}` से संदर्भित करें।

Secret variables सहेजने के बाद UI में छिपे रहते हैं और run logs से हटा दिए जाते हैं। [वेरिएबल](/docs/workflows/variables#global-variables) देखें।

## Authentication चीट शीट

अधिकांश आउटबाउंड इंटीग्रेशन को API block पर एक `Authorization` हेडर की ज़रूरत होती है। सामान्य फ़ॉर्म:

| स्कीम | हेडर मान | इस्तेमाल करने वाले |
| --- | --- | --- |
| Bearer token | `Bearer {{variable.TOKEN}}` | GitHub, कई आधुनिक APIs |
| Basic auth | `Basic {{variable.BASE64_USER_PASS}}` | Jira, ServiceNow |
| API key header | `GenieKey {{variable.OPSGENIE_KEY}}` | Opsgenie |
| Token in body | JSON body में `routing_key` फ़ील्ड | PagerDuty Events API |
| Private token header | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab |

Basic auth के लिए, `username:password` (या `email:api_token`) को **एक बार** base64-encode करें, फिर परिणाम को secret के रूप में स्टोर करें। macOS/Linux पर:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## आपका टूल नहीं दिखा?

लगभग हर टूल ऊपर के दो पैटर्न में से एक में फिट होता है:

- यदि टूल कुछ होने पर **webhook भेज सकता है**, तो **inbound** पैटर्न इस्तेमाल करें — उसके webhook को OneUptime Webhook trigger की ओर पॉइंट करें।
- यदि टूल के पास **REST API** है, तो **outbound** पैटर्न इस्तेमाल करें — इसे **API component** से कॉल करें।
- यदि दोनों के बीच डेटा को नया आकार देने की ज़रूरत है, तो एक **[Custom Code](/docs/workflows/components#custom-code)** ब्लॉक डालें।

यह लंबी सूची को कवर करता है — Zendesk, AWS CloudWatch (SNS के माध्यम से), New Relic, Splunk, StatusCake, और इसी तरह के अन्य। तरीका वही रहता है; केवल URL और payload बदलता है।

## आगे क्या पढ़ें

- [वर्कफ़्लो अवलोकन](/docs/workflows/index) — ऑटोमेशन इंजन कैसे काम करता है।
- [ट्रिगर](/docs/workflows/triggers) — Webhook और OneUptime event triggers विस्तार से।
- [कंपोनेंट](/docs/workflows/components) — API, Webhook, और data components।
- [वेरिएबल](/docs/workflows/variables) — सीक्रेट और ब्लॉक्स के बीच डेटा पास करना।
- [Zabbix](/docs/integrations/zabbix) और [Jira](/docs/integrations/jira) — पूरे काम के उदाहरण।
