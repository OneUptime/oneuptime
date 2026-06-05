# Discord Integration

[Discord](https://discord.com) चैनल पर incident updates पोस्ट करें। OneUptime में एक built-in **Discord** workflow component है, इसलिए यह सेटअप करने में सबसे तेज़ integrations में से एक है।

यह इंटीग्रेशन **आउटबाउंड** है: OneUptime एक incoming webhook URL के माध्यम से Discord चैनल पर post करता है।

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## चरण 1 — Discord webhook बनाएँ

1. Discord में, target channel का **Edit Channel → Integrations → Webhooks** खोलें।
2. **New Webhook** क्लिक करें, उसे एक नाम दें (जैसे `OneUptime`), channel चुनें, और **Copy Webhook URL** करें।

## चरण 2 — webhook URL store करें (वैकल्पिक लेकिन अनुशंसित)

1. OneUptime में, **Workflows → Global Variables → Create** पर जाएँ।
2. इसे `DISCORD_WEBHOOK_URL` नाम दें, URL पेस्ट करें, और **Is Secret** चालू करें।

इसे variable में रखने से आप इसे वर्कफ़्लो के पार reuse कर सकते हैं और एक जगह से rotate कर सकते हैं।

## चरण 3 — वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Incidents → Discord` नाम दें, और **Builder** खोलें।
2. **On Create** पर सेट एक **Incident** trigger जोड़ें। इसे `Incident` नाम दें।
3. trigger से connected एक **Discord** component जोड़ें:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (या सीधे पेस्ट करें)।
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **सहेजें**, enable करें, और एक test incident बनाएँ। Message आपके channel में दिखाई देता है।

## वैकल्पिक: API component

यदि आप dedicated component इस्तेमाल नहीं करना चाहते, तो एक **API** ब्लॉक वही काम करता है:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

यह तब उपयोगी है जब आप Discord के रिच [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) चाहते हैं — body में एक `embeds` array जोड़ें।

## टिप्स

- केवल कुछ severities के लिए post करने के लिए **Conditions** इस्तेमाल करें — Discord block से पहले `{{Incident.incidentSeverity.name}}` पर branch करें।
- acknowledgements और resolutions उसी channel में post करने के लिए **Incident → On Update** पर और वर्कफ़्लो जोड़ें।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — outbound pattern।
- [Telegram](/docs/integrations/telegram) — Telegram के लिए वही विचार।
- [कंपोनेंट → Discord](/docs/workflows/components#discord) — component reference।
