# Components

Components trigger के बाद जोड़े जाने वाले building blocks हैं। हर एक एक काम करता है — message भेजना, API call करना, कोई condition check करना — और आगे जो भी हो उससे connect होता है।

यह page catalog है। इन्हें canvas पर add और connect कैसे करें, इसके लिए देखें [Authoring a Workflow](/docs/workflows/authoring)।

## API

किसी भी URL पर एक HTTP request बनाएं।

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, या `DELETE`।
- **URL** — call करने का address।
- **Headers** — भेजने के लिए कोई भी headers।
- **Body** — `POST` / `PUT` / `PATCH` के लिए request body।

**Outputs**:

- **Success** — call काम करने पर (2xx response) fire होता है। status, headers, और body आगे पास करता है।
- **Error** — किसी network failure या non-2xx response पर fire होता है। error message आगे पास करता है।

इसे इसके लिए इस्तेमाल करें: कोई भी external API, आपके अपने admin endpoints, या कोई भी integration जिसका अपना component नहीं है।

## AI

### Generate Text with AI

किसी prompt और optional JSON context से एक text response generate करें। यह component project के configured default LLM provider का इस्तेमाल करता है, और उपलब्ध होने पर installation के global provider पर fall back करता है। Provider credentials और endpoints centrally configure होते हैं; ये workflow arguments नहीं हैं।

**Settings**:

- **System Instructions** — model की role, tone, और constraints के लिए optional guidance।
- **Prompt** — required task। इसमें workflow variables और पहले वाले components के outputs शामिल हो सकते हैं।
- **Context** — optional JSON जिसे आप जानबूझकर request के साथ शामिल करते हैं। यह एक explicit end-of-message trust marker के बाद append होता है और message के बाकी हिस्से में untrusted data की तरह treat होता है।
- **Temperature** — `0` से `1` तक variation। predictable automation के लिए default `0.2` है।
- **Maximum Output Tokens** — `1` से `4096` तक। default `1024` है।

मिलकर System Instructions, Prompt, और serialized Context 50,000 characters तक सीमित हैं। provider request की एक 60-second maximum duration है और यह एक बार attempt होता है। हर project में एक साथ ज़्यादा से ज़्यादा तीन workflow AI requests चल सकते हैं।

**Outputs**:

- **Response** — generated text।
- **Provider** और **Model** — call के लिए इस्तेमाल की गई configuration।
- **Total Tokens** और **Completion Tokens** — provider द्वारा report किया गया usage।
- **LLM Log ID** — call के लिए metered AI log entry।
- **Error** — validation, access, provider, budget, billing, या timeout error, जब मौजूद हो।

**Success** को उन components से connect करें जिन्हें response इस्तेमाल करनी चाहिए। **Error** को किसी explicit fallback, alert, या log path से connect करें। यह component बिना tool definitions या provider-native capability fields के एक model request करता है: यह अपने-आप OneUptime को query नहीं कर सकता, APIs call नहीं कर सकता, या project data नहीं बदल सकता। OneUptime के fixed component-safety instructions के अलावा, सिर्फ आपके configure किए हुए System Instructions, Prompt, और Context ही provider को भेजे जाते हैं, वह भी उन fields में workflow variables resolve होने के बाद। configured provider/model फिर भी एक trust boundary बना रहता है क्योंकि किसी model में intrinsic provider-managed capabilities हो सकती हैं।

Model output untrusted text है। customer-facing communications भेजने से पहले इसे review करें, और किसी destructive workflow action को authorize करने के लिए अकेले free-form AI text का इस्तेमाल न करें। provider, egress, logging, और cost details के लिए देखें [Configuration & Safety](/docs/workflows/configuration)।

## Webhook (outbound)

"fire and forget" cases के लिए API component का एक simpler version। किसी URL पर एक JSON body post करता है।

अगर आपको response पढ़नी है तो **API** इस्तेमाल करें। अगर आप सिर्फ एक notification भेजकर आगे बढ़ना चाहते हैं तो **Webhook** इस्तेमाल करें।

## Slack

किसी Slack channel पर एक message post करें।

**Settings**:

- **Channel** — channel का नाम। bot पहले से उस channel में होना चाहिए।
- **Message** — भेजने के लिए text। Slack formatting support करता है।

पहले अपने project को **Project Settings → Workspace → Slack** के तहत Slack से connect करें। देखें [Slack Workspace Connection](/docs/workspace-connections/slack)।

## Microsoft Teams

किसी Microsoft Teams channel पर एक message post करें।

**Settings**:

- **Team and channel** — कहाँ post करना है।
- **Message** — भेजने के लिए text।

Setup के लिए देखें [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams)।

## Discord

किसी incoming webhook URL के ज़रिए किसी Discord channel पर एक message post करें।

## Telegram

एक bot token और chat ID इस्तेमाल करके किसी Telegram chat पर एक message भेजें।

## Email

OneUptime के ज़रिए एक email भेजें।

**Settings**:

- **To** — recipient का email address।
- **Subject** — subject line।
- **Body** — Markdown या HTML में message।

email आपके project के configured sender से बाहर जाता है — देखें [SMTP](/docs/emails/smtp)।

## Custom Code

जब बाकी blocks कुछ न कर पाएं तो थोड़ा-सा JavaScript चलाएं।

**Settings**:

- **Code** — आपका JavaScript। last value (या किसी async function से आप जो return करते हैं) block का output बन जाती है।
- **Arguments** — named values जिन्हें आप pass कर सकते हैं।

**Outputs**: success (आपकी return value) और error (कोई भी exception)।

इसे इसके लिए इस्तेमाल करें: दो systems के बीच data को reshape करना, कोई छोटी calculation करना, कुछ भी जो अपना खुद का block deserve नहीं करता। heavier scripting के लिए, इसकी बजाय एक [Runbook](/docs/runbooks/index) इस्तेमाल करें।

## JSON

text और JSON के बीच convert करें।

- **JSON → Text** — किसी JSON object को एक string में बदलें। तब useful जब अगला block text की उम्मीद रखता हो।
- **Text → JSON** — किसी string को एक JSON object में parse करें। तब useful जब कुछ text के रूप में आया हो और आपको एक field पढ़नी हो।

## Conditions

किसी comparison के आधार पर branch करें। **Add Component** panel में इस block को **If / Else** कहा जाता है, Conditions category के तहत।

**Settings**:

- **Left value** — आमतौर पर किसी पहले वाले block की एक value।
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`।
- **Right value** — किसके against compare करना है।

**Outputs**: **Yes** और **No**। अगले blocks को जिस branch पर चाहें उससे connect करें।

## Delay

आगे बढ़ने से पहले workflow को कुछ समय के लिए रोक दें। तब useful जब आपको किसी दूसरे system को catch up करने का एक पल देना हो।

## Log

run log में एक line लिखें। इसका कोई external effect नहीं है — यह सिर्फ workflow के logs में आपके पढ़ने के लिए दिखता है। debugging के लिए handy है।

## Execute Workflow

इस workflow से किसी दूसरे workflow को call करें। called workflow अपने-आप चलता है — आपका workflow इसके खत्म होने का इंतज़ार किए बिना आगे बढ़ता रहता है।

common logic share करने के लिए इसे इस्तेमाल करें। एक "post to incident channel" workflow एक बार बनाएं, फिर इसे किसी भी दूसरे workflow से call करें जिसे channel को notify करना है।

एक safety limit है ताकि workflows एक loop में एक-दूसरे को बार-बार call न करते रहें। देखें [Configuration & Safety](/docs/workflows/configuration)।

## OneUptime data components

OneUptime में हर तरह के record के लिए (monitors, incidents, alerts, status pages, on-call policies, और कई और), **Add Component** panel में ये components हैं — type के नाम से search करें। हर title record type से generate होता है, इसलिए Monitor set इस तरह पढ़ता है:

- **Find One Monitor** — matching query वाला एक record पढ़ें।
- **Find Many Monitors** — matching query वाले records की एक list पढ़ें।
- **Create One Monitor** — एक JSON object से एक record जोड़ें।
- **Create Many Monitors** — एक JSON array से कई records जोड़ें।
- **Update One Monitor** — एक matching record पर write payload लागू करें।
- **Update Many Monitors** — matching records पर write payload लागू करें, Limit तक।
- **Delete One Monitor** — एक matching record delete करें।
- **Delete Many Monitors** — matching records delete करें, Limit तक।

वही set आपको तीन triggers देता है — **On Create Monitor**, **On Update Monitor**, और **On Delete Monitor**। देखें [Triggers](/docs/workflows/triggers)।

कोई type सिर्फ वे components offer करता है जिनकी उसका model अनुमति देता है। कोई read-only type सिर्फ दो Find components रखता है और कुछ नहीं, इसलिए अगर आपको panel में **Delete One Monitor** नहीं मिलता, तो वह type इसकी अनुमति नहीं देता।

इसी तरह कोई workflow OneUptime data को पढ़ और बदल सकता है। उदाहरण के लिए: आपके CI tool से आया एक webhook failure details के साथ एक incident खोलने के लिए **Create One Incident** इस्तेमाल कर सकता है।

## Records के साथ काम करना

किसी data component पर हर field record के अपने **column** names पर keyed है — वही names जो API इस्तेमाल करता है, dashboard form पर मौजूद labels नहीं। ID column `_id` है। `id` spelling को कहीं भी alias के रूप में स्वीकार किया जाता है जहाँ आप कोई column name टाइप कर सकते हैं, लेकिन कोई record वापस `_id` ही देता है, इसलिए बाहर आते समय यही पढ़ना है:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** तय करता है कि component किन records पर काम करता है। keys columns हैं, values वह हैं जिनसे match करना है:

```json
{ "monitorType": "Website", "isEnabled": true }
```

कोई query हमेशा उस project तक scoped होता है जिसमें workflow चलता है। आप किसी दूसरे project के records तक नहीं पहुँच सकते, और आपको query में खुद project जोड़ने की ज़रूरत नहीं है।

Create One पर **JSON Object**, Create Many पर **JSON Array**, और Update components पर **Data (JSON Object)** लिखने के लिए fields carry करते हैं, वही keyed तरीके से:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

कोई key जो कोई column नहीं है reject होने की बजाय ignore हो जाती है — run log उन नामों को बताता है जिन्हें इसने drop किया, इसलिए जब कोई field नहीं land करती तो वहाँ जाँचें। **Select Fields**, Find components और triggers पर, `true` values के साथ वही column keys इस्तेमाल करता है: `{"_id": true, "name": true}`।

**Skip** और **Limit** Find Many, Update Many, और Delete Many पर दो number fields हैं — `Skip: 0` के साथ `Limit: 100` पहले सौ matches लेता है। Limit default रूप से `10` है, और Update Many और Delete Many पर यह सीमित करता है कि वास्तव में कितने records write हुए, सिर्फ कितने वापस आए यह नहीं। तो `Items Deleted: 10` का मतलब है दस records delete हुए, यह नहीं कि दस match हुए। दस से ज़्यादा बदलने का इरादा हो तो Limit बढ़ाएं।

**Success** और **Error** यह report करते हैं कि query चली या नहीं, इसने क्या पाया नहीं। कुछ भी match न करने वाली query `0` return करती है और फिर भी Success से निकलती है — यह कोई failure नहीं है। कुछ match हुआ या नहीं इस पर branch करने के लिए, किसी **If / Else** block में returned count पढ़ें।

## मुझे कौन सा component इस्तेमाल करना चाहिए?

कुछ त्वरित नियम:

- अगर आप जो चाहते हैं उसके लिए एक dedicated block है (Slack, Email, कोई OneUptime record), उसे इस्तेमाल करें — आपको बेहतर error handling और साफ़ logs मिलते हैं।
- किसी भी दूसरे external API के लिए, **API** इस्तेमाल करें।
- explicitly select की गई workflow data से text summarize, classify, या draft करने के लिए, **Generate Text with AI** इस्तेमाल करें।
- blocks के बीच data reshape करने के लिए, **Custom Code** या **JSON** इस्तेमाल करें।
- किसी value के आधार पर अलग actions लेने के लिए, **Conditions** इस्तेमाल करें।

## आगे क्या पढ़ें

- [Variables](/docs/workflows/variables) — blocks के बीच data pass करना।
- [Runs & Logs](/docs/workflows/runs-and-logs) — किसी run पर हर block ने क्या किया यह जाँचना।
- [Configuration & Safety](/docs/workflows/configuration) — limits, owners, और secrets।
