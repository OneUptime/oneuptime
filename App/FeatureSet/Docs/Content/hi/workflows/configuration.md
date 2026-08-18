# Configuration & Safety

इस page में वे settings और safety limits बताई गई हैं जो किसी workflow को real traffic पर लगाने से पहले जान लेनी चाहिए।

## किसी workflow को on या off करना

हर workflow में **Settings** के अंदर एक **Enabled** switch होता है। जब यह off होता है, तो workflow नहीं चलता — webhook calls, scheduled times, और OneUptime events, सभी को ignore कर दिया जाता है। नए workflows disabled शुरू होते हैं।

इस switch को अपने "ready to go" gate के रूप में इस्तेमाल करें:

1. workflow बनाएं।
2. **Builder** पर realistic values के साथ **Run Workflow** पर क्लिक करें।
3. **Logs** check करें — पक्का करें कि हर block वहीं गया जहाँ आपने उम्मीद की थी।
4. **Enabled** on करें।

किसी workflow को off करना पहले से चल रहे runs को नहीं रोकता; यह सिर्फ नए runs को शुरू होने से रोकता है।

## Owners और labels

- **Owners** — owners के रूप में listed users और teams को workflow तक access मिलता है और वे इसके fail होने पर notifications के लिए opt in कर सकते हैं। इन्हें **Settings → Owners** के अंतर्गत set करें।
- **Labels** — workflows को group करने के लिए tags। workflow list आपको label के हिसाब से filter करने देती है, जिससे व्यस्त project में navigate करना काफी आसान हो जाता है। यह तब उपयोगी है जब आपके workflows team, integration, या environment के हिसाब से organize हों।
- **Label rules** — **Workflows → Settings → Label Rules** के अंतर्गत, नए workflows पर नाम या description patterns के आधार पर automatically labels लागू करें।
- **Owner rules** — **Workflows → Settings → Owner Rules** के अंतर्गत, नए workflows को automatically owners assign करें।

## Secrets

अगर किसी global variable में कुछ sensitive है, तो उसे **secret** के रूप में mark करें। save करने के बाद value normal API और UI reads से छिपा दी जाती है, और run log persist होने से पहले workflow logging resolved value को scrub कर देती है।

secret variables का उपयोग इनके लिए करें:

- बाहरी services के लिए API keys।
- Authentication tokens।
- Webhook signing keys।
- कोई भी ऐसी चीज़ जिसे read-only access वाला कोई व्यक्ति न देख पाए।

किसी secret को सीधे किसी block में paste न करें — `Authorization: Bearer eyJh...` जैसी values workflow और logs में दिखने लगती हैं। इसके बजाय `{{global.variables.MY_SECRET}}` का उपयोग करें।

## Workflows को export और import करना

आप किसी workflow को projects के बीच, या self-hosted install और OneUptime Cloud के बीच, एक JSON file के रूप में move कर सकते हैं।

- **Export** — workflow खोलें और **Settings** के अंतर्गत **Export Workflow** का उपयोग करें। workflow list से आप कई workflows चुनकर उन्हें एक ही file में export भी कर सकते हैं।
- **Import** — **Workflows** list पर, **Import JSON** पर क्लिक करें और किसी भी OneUptime project से export की गई file चुनें।

यह file workflow का नाम, description, enabled state, और उसका graph रखती है। यह जानबूझकर इन्हें नहीं रखती:

- **The webhook secret key.** workflow बनते समय एक नया secret generate होता है, इसलिए imported workflow का webhook URL अलग होता है। original को call करने वाली किसी भी चीज़ को दोबारा point करना होगा।
- **Global variables.** जो block `{{global.variables.MY_SECRET}}` पढ़ता है वह उस reference को रखता है, लेकिन value file में नहीं होती। imported workflow चलाने से पहले destination project में variables बनाएं।
- **Owners और labels.** आपके project के खुद के label और owner rules imported workflow पर वैसे ही चलते हैं जैसे आपने इसे हाथ से बनाया हो।

एक imported workflow हमेशा **disabled** बनाया जाता है, भले ही यह export होते समय enabled रहा हो — इसका graph उन monitors, on-call policies, या दूसरे workflows की ओर point कर सकता है जो destination project में मौजूद नहीं हैं। इसे review करें, enable करें, **Run Workflow** से test करें, और फिर इसे on छोड़ दें। किसी workflow को duplicate करने पर भी यही होता है, इसलिए कोई copy आपके edit करने से पहले original के साथ-साथ fire होना कभी शुरू नहीं करती।

चूंकि graph verbatim travel करता है, किसी block में सीधे type की गई कोई भी चीज़ उसके साथ travel करती है। यही practical वजह है credentials को secret variables में रखने की: hardcoded token वाले workflow को export करना वह token उसे दे देता है जो file receive करता है।

## एक run कितनी देर चल सकता है

हर execution attempt की एक wall-clock deadline होती है। runner इसे हर component से पहले और बाद में check करता है और control वापस आते ही किसी overdue run को **Timeout** mark कर देता है। जो components network या script का काम करते हैं उन्हें अपने खुद के timeouts की भी जरूरत होती है क्योंकि runner arbitrary component code को जबरदस्ती interrupt नहीं कर सकता।

AI component अपने provider-request timeout को बचे हुए workflow समय से derive करता है और इसे 60 seconds पर cap करता है, logging और cleanup के लिए थोड़ी सी margin छोड़ते हुए।

## दूसरे workflows को call करने की limit

**Execute Workflow** component एक workflow को दूसरे को call करने देता है। accidental loops से बचने के लिए जहाँ workflow A, B को call करे और B फिर से A को call करे, chain कितनी गहरी जा सकती है इस पर एक cap है। जो run इस limit से आगे जाता है वह एक साफ error के साथ खत्म होता है।

अगर आपको वाकई एक लंबी chain की जरूरत है (जैसे एक job जो हर run में एक item process करे), तो आमतौर पर एक ही workflow के अंदर **Custom Code** का उपयोग करके loop करना ज्यादा आसान होता है।

## Webhook security

Webhook triggers आपको एक unique URL देते हैं। जो कोई भी URL जानता है वह इसे hit कर सकता है। accidental या अनचाहे callers से बचाव के लिए:

- URL को password की तरह treat करें। इसे publicly share न करें या किसी public repo में commit न करें।
- sensitive workflows के लिए, calling system से एक shared token को header के रूप में भेजने को कहें (जैसे `X-Webhook-Token`) और कुछ भी महत्वपूर्ण करने से पहले इसे एक **Conditions** block से check करें। expected token को एक secret variable के रूप में save करें।
- बहुत sensitive workflows के लिए, public webhook की जगह OneUptime event trigger और एक manual import step को prefer करें।

## Outbound network access

API और दूसरे HTTP blocks अपने requests OneUptime से करते हैं। अगर आप self-host कर रहे हैं, तो पक्का करें कि आपकी installation उन services तक पहुँच सके जिन्हें आप call कर रहे हैं। अगर आप OneUptime Cloud इस्तेमाल करते हैं, तो हमारी outbound IP ranges [IP Addresses](/docs/configuration/ip-addresses) में listed हैं ताकि आप उन्हें दूसरी तरफ allow कर सकें।

## AI components

**Generate Text with AI** OneUptime के configured LLM gateway के जरिए एक request भेजता है। यह project के default LLM provider का उपयोग करता है, या जब project के पास अपना नहीं है तो installation के global provider का। providers को **Project Settings → AI → LLM Providers** के अंतर्गत configure करें; workflow में खुद कभी कोई provider API key या arbitrary model endpoint न डालें।

AI component की एक explicit egress boundary है:

- OneUptime एक fixed component-safety instruction के साथ-साथ resolved **System Instructions**, **Prompt**, और serialized **Context** configured provider को भेजता है। Context user message के अंत में एक explicit marker के बाद append किया जाता है; fixed instruction कहता है कि उस marker के बाद सब कुछ untrusted data ही रहता है, भले ही उसमें tags या instructions हों।
- यह trigger payload, workflow history, दूसरे component outputs, project records, telemetry, या secrets को automatically attach नहीं करता। data तभी बाहर जाता है जब आप इसे उन तीन inputs में से किसी में reference करते हैं।
- यह कोई tool definitions या provider-native capability fields नहीं भेजता। model इस component के जरिए OneUptime को query नहीं कर सकता, HTTP requests नहीं कर सकता, या project data mutate नहीं कर सकता। configured provider/model एक administrator trust boundary ही रहता है, इसलिए जिन installations को strictly offline generation चाहिए उन्हें intrinsic provider-managed retrieval के बिना कोई model चुनना चाहिए।
- Provider-level additional parameters सिर्फ generation-only tuning fields की एक allowlist तक सीमित हैं। ये workflow messages को replace नहीं कर सकते, tools या provider-native web search/data sources नहीं जोड़ सकते, non-text modalities enable नहीं कर सकते, कई choices request नहीं कर सकते, streaming enable नहीं कर सकते, provider storage flags के जरिए request को retain नहीं कर सकते, या इस component के output-token cap को नहीं बढ़ा सकते। अनजान future capability fields default रूप से drop कर दिए जाते हैं।
- System Instructions, Prompt, Context, और generated Response values को automatic workflow execution log में इस AI component की खुद की argument और return-value entries से redact किया जाता है। run चलते समय ये downstream components के लिए उपलब्ध रहते हैं। अगर आप इनमें से किसी को किसी और component में डालते हैं, तो उस component की logging policy लागू होती है और वह resolved value को record कर सकती है; इसे reuse को एक explicit disclosure मानें। Provider/model नाम, token counts, LLM Log ID, और safe error messages operations और billing के लिए visible रहते हैं। Raw provider error bodies workflow logs, LLM logs, application logs, और traces से बाहर रखे जाते हैं क्योंकि कोई provider request content को echo कर सकता है।

हर referenced variable को ऐसा data मानें जिसे आप जानबूझकर provider को भेज रहे हैं। खासकर, किसी secret global variable को prompt या context में तब तक न डालें जब तक वह disclosure जरूरी न हो और provider उसे receive करने के लिए approved न हो। Ollama जैसा एक self-hosted local provider request को आपके खुद के infrastructure के अंदर रख सकता है; एक hosted provider request को उस provider की data-processing terms के तहत receive करता है।

हर call **Project Settings → AI → AI Logs** में record होती है, जिसमें provider, model, status, tokens, cost, और billing information शामिल है। Prompt और response previews और raw provider error details AI log में store नहीं होते। किसी costed global provider के जरिए की गई calls project के AI credit balance से consume होती हैं। Workflow AI project के daily autonomous AI token budget में भी count होता है; जब budget खत्म हो जाता है, तो component model से contact किए बिना अपना **Error** path लेता है। Project AI enabled होना चाहिए। OneUptime Cloud पर, subscription paid होनी चाहिए और Growth plan (या Growth features वाला कोई plan) जरूरी है; billing disabled वाली self-hosted installations में यह plan gate नहीं होता।

Built-in bounds unattended calls को finite रखते हैं: System Instructions, Prompt, और serialized Context मिलाकर 50,000 characters तक cap हैं; Temperature `0` से `1` तक होना चाहिए; Maximum Output Tokens `1` से `4096` तक होना चाहिए (default `1024`); और provider request एक बार attempt होता है और ज्यादा से ज्यादा 60 seconds बाद timeout हो जाता है। प्रति project ज्यादा से ज्यादा तीन workflow AI calls concurrently चलती हैं; अतिरिक्त calls **Error** path लेती हैं और बाद के किसी workflow run से retry की जा सकती हैं। Validation, configuration, access, budget, balance, concurrency, provider, और timeout failures सभी **Error** path लेती हैं और **Error** output भरती हैं। किसी production workflow को enable करने से पहले उस path को connect करें।

## Permissions

Workflows आपके project के role-based access control का पालन करते हैं। संबंधित permissions:

- **Create / Read / Edit / Delete Workflow** — workflow पर ही basic permissions।
- **Run Workflow** — किसी workflow को हाथ से चलाने या API के जरिए trigger करने के लिए जरूरी।
- **Read Workflow Log** — runs देखने के लिए जरूरी।
- **Read / Create / Edit / Delete Workflow Variable** — global variables list पर control।

ज्यादातर engineers के पास workflows पर create/edit/read होना चाहिए लेकिन variables पर नहीं। variable edit access उन लोगों के लिए बचाकर रखें जो आपके project के secrets manage करते हैं।

## Plan limits

OneUptime Cloud छोटे plans पर हर महीने runs की संख्या को cap करता है। आपकी मौजूदा limit **Project Settings → Billing** के अंतर्गत दिखती है। जब आप इस तक पहुँच जाते हैं, तो अगले billing cycle तक नए triggers reject कर दिए जाते हैं। Self-hosted installations में यह limit नहीं होती।

## जब workflows सही tool नहीं हैं

कुछ मामले जहाँ आपको कोई और तरीका अपनाना चाहिए:

- **Heavy computation or large datasets** — workflows हल्के glue work के लिए बनाए गए हैं, number crunching के लिए नहीं। भारी काम अपनी खुद की infrastructure में चलाएं और उसे शुरू करने का काम एक workflow को दें।
- **Long-running active computation** — एक अकेला execution attempt जल्दी खत्म होने के लिए बना है। "A करो, दो घंटे wait करो, फिर B करो" जैसी passive delay के लिए, **Sleep** component का उपयोग करें; यह run को persist करता है और किसी worker को occupy किए बिना बाद में इसे resume करता है।
- **Step-by-step incident response with humans in the loop** — इसके लिए [Runbooks](/docs/runbooks/index) हैं। Workflows unattended automation के लिए हैं।

## आगे क्या पढ़ें

- [Workflows Overview](/docs/workflows/index) — बड़ी तस्वीर।
- [Components](/docs/workflows/components) — block-by-block reference।
- [Runbooks](/docs/runbooks/index) — कब runbook का उपयोग करना चाहिए।
