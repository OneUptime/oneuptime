# Telegram Integration

[Telegram](https://telegram.org) chat या group में incident updates भेजें। OneUptime में एक built-in **Telegram** workflow component है, इसलिए सेटअप जल्दी हो जाता है।

यह इंटीग्रेशन **आउटबाउंड** है: OneUptime Telegram bot के माध्यम से messages भेजता है।

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## चरण 1 — bot बनाएँ और उसका token लें

1. Telegram में, [@BotFather](https://t.me/BotFather) को message करें और `/newbot` भेजें।
2. prompts follow करें। BotFather आपको एक **bot token** देता है जैसे `123456789:AA...`।

## चरण 2 — अपना chat ID खोजें

1. Bot को group में जोड़ें (या उससे direct chat शुरू करें) और उसे कोई message भेजें।
2. Browser में `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` खोलें।
3. Response में `"chat":{"id":...}` खोजें — वह number आपका **chat ID** है (group IDs negative होते हैं)।

## चरण 3 — secrets store करें

1. OneUptime में, **Workflows → Global Variables → Create** पर जाएँ।
2. `TELEGRAM_BOT_TOKEN` (secret) और `TELEGRAM_CHAT_ID` बनाएँ।

## चरण 4 — वर्कफ़्लो बनाएँ

1. **Workflows → Create Workflow** खोलें, इसे `Incidents → Telegram` नाम दें, और **Builder** खोलें।
2. **On Create** पर सेट एक **Incident** trigger जोड़ें। इसे `Incident` नाम दें।
3. trigger से connected एक **Telegram** component जोड़ें:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **सहेजें**, enable करें, और एक test incident बनाएँ। Message आपके chat में पहुँचता है।

## वैकल्पिक: API component

एक **API** ब्लॉक भी काम करता है:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## टिप्स

- Bot messages केवल तब देखता है जब उसे group में जोड़ा गया हो और **privacy mode** उसे allow करे — यदि `getUpdates` खाली है, तो पहले bot को एक message भेजें, या BotFather से privacy mode disable करें।
- भेजने से पहले severity से filter करने के लिए **Conditions** इस्तेमाल करें।
- Bold और links के लिए API body में `"parse_mode": "Markdown"` जोड़ें (या component की formatting इस्तेमाल करें)।

## आगे क्या पढ़ें

- [इंटीग्रेशन अवलोकन](/docs/integrations/index) — outbound pattern।
- [Discord](/docs/integrations/discord) — Discord के लिए वही विचार।
- [कंपोनेंट → Telegram](/docs/workflows/components#telegram) — component reference।
