# Triggers

एक trigger किसी workflow का पहला block होता है — यह तय करता है कि workflow कब चलता है। हर workflow में ठीक एक trigger होता है। आप चार तरह में से एक चुनते हैं।

## Manual

**Builder** page पर **Run Workflow** पर क्लिक करके, trigger के fields भरकर, और **Run Workflow Manually** से confirm करके workflow को demand पर चलाएं। Manual trigger एक JSON payload लेता है जिसे workflow का बाकी हिस्सा पढ़ सकता है।

इसके लिए अच्छा है: वे one-click automations जिनके लिए आप एक button चाहते हैं, जैसे "इस key को rotate करो" या "एक test alert भेजो"।

**Output**: जो JSON आपने paste किया था, या अगर आपने नहीं किया तो एक empty object।

## Schedule

एक cron expression का उपयोग करके workflow को एक repeating schedule पर चलाएं।

इसके लिए अच्छा है: nightly cleanup, hourly sync, weekly reports।

**Setting**: एक cron expression। कुछ आम expressions:

- `0 * * * *` — हर घंटे, घंटे के शुरू में।
- `*/5 * * * *` — हर 5 मिनट में।
- `0 9 * * 1` — हर सोमवार सुबह 9:00 बजे।

अगर system थोड़ी देर के लिए unavailable है, तो recover होते ही run उठा लिया जाता है — छोटे outages के लिए missed ticks की चिंता करने की जरूरत नहीं है।

## Webhook

OneUptime एक unique URL बनाता है। उस URL पर जो कुछ भी hit करता है वह workflow शुरू कर देता है। incoming request के headers, query parameters, और body pass किए जाते हैं।

इसके लिए अच्छा है: किसी दूसरे tool से OneUptime में data receive करना — CI/CD callbacks, दूसरी monitoring से alerts, आपके CRM में signups।

**Output**:

- **Request Headers** — incoming request के सभी headers।
- **Request Query Params** — parsed query string।
- **Request Body** — parsed body (या अगर वह JSON नहीं है तो raw text)।

URL `GET` और `POST` दोनों accept करता है। caller को एक quick acknowledgement मिलता है — workflow खुद background में चलता है।

URL को password की तरह treat करें। जिसके पास भी यह हो वह आपका workflow शुरू कर सकता है।

## OneUptime event triggers

OneUptime में लगभग हर चीज़ — monitors, incidents, alerts, scheduled maintenance, status pages, on-call policies, teams — किसी workflow को trigger कर सकती है। हर एक तीन events offer करता है:

- **On Create** — जब कोई नया बनता है तब fire होता है।
- **On Update** — जब कोई बदला जाता है तब fire होता है।
- **On Delete** — जब कोई delete किया जाता है तब fire होता है।

इस तरह आप बिना किसी loop में चीज़ें check किए "जब OneUptime में X होता है, तो Y करो" बना सकते हैं।

पूरा record अगले block को pass किया जाता है। उदाहरण के लिए, **Incident → On Create** trigger नया incident pass करता है, ताकि अगला block उसका title, description, severity, और कोई भी दूसरा field पढ़ सके।

### सबसे ज्यादा इस्तेमाल होने वाले events

- **Incident** — जब कोई incident खुले, बदले (acknowledged, resolved), या delete हो तब react करें।
- **Alert** — alerts के लिए वही तीन।
- **Monitor** — जब कोई monitor जोड़ा जाए, edit हो, या हटाया जाए तब react करें।
- **Scheduled Maintenance** — जब maintenance window schedule हो तो अपने-आप उसकी घोषणा करें।
- **Status Page Subscriber** — किसी status page को subscribe करने वाले का स्वागत करें।
- **On-Call Duty Policy** — schedule में बदलाव किसी दूसरे roster system में sync करें।

जिसे आप ढूंढ रहे हैं उसे पाने के लिए **Add Trigger** panel को नाम से search करें।

## मुझे कौन सा trigger इस्तेमाल करना चाहिए?

| अगर आप चाहते हैं…                        | चुनें                |
| ------------------------------------------- | -------------------- |
| workflow चलाने के लिए एक button क्लिक करना   | **Manual**           |
| एक repeating schedule पर चलाना               | **Schedule**         |
| किसी दूसरे system को data push करने देना     | **Webhook**          |
| OneUptime के अंदर किसी चीज़ पर react करना    | **OneUptime event**  |

एक workflow में सिर्फ एक ही trigger हो सकता है। अगर आपको एक ही automation को शुरू करने के दो तरीके चाहिए, तो shared logic को एक workflow में बनाएं और उसे **Execute Workflow** component का उपयोग करके दो पतले "wrapper" workflows से call करें।

## आगे क्या पढ़ें

- [Components](/docs/workflows/components) — trigger के बाद आप जो actions जोड़ते हैं।
- [Variables](/docs/workflows/variables) — बाद के blocks से trigger का output पढ़ना।
- [Runs & Logs](/docs/workflows/runs-and-logs) — यह पुष्टि करना कि आपका trigger fire हुआ।
