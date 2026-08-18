# Declaring an Incident

किसी incident को declare करना वह क्षण है जब OneUptime score रखना शुरू करता है। एक record बनता है, उस पर एक number stamp होता है, on-call policies चलती हैं, और — जब तक आप इसे मना नहीं करते — आपके status page subscribers को इसके बारे में पता चलता है। incident lifecycle में बाकी सब कुछ उस पहले write पर टिका होता है।

OneUptime में एक incident आने के चार तरीके हैं, और वे सब एक ही जगह पहुँचते हैं: `Incident` table में एक row जिसमें एक severity, एक current state, और affected resources की एक list होती है। फर्क बस इतना है कि fields कौन भरता है — आप रात 3 बजे, एक saved template, किसी monitor की criteria, या आपका अपना code जो API को call करता है।

यह page सभी चारों को field-by-field देखता है, और फिर यह बताता है कि server आपके लिए क्या भरता है और incident के बनते ही क्या चलता है।

## एक incident declare होने के चार तरीके

| अगर आप चाहते हैं…                                              | चुनें                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| एक incident हाथ से खोलना, सब कुछ खुद भरते हुए                    | **Declare Incident** wizard                                                 |
| एक repeating तरह का incident खोलना जिसमें fields pre-filled हों | **Create from Template**                                                    |
| किसी monitor की checks fail होने पर अपने-आप एक खोलना            | एक monitor criteria filter जिसमें **When filters match, declare an incident.** हो |
| अपने खुद के code, script, या किसी और tool से एक खोलना            | `POST /api/incident`                                                        |

चारों एक ही model पर write करते हैं, इसलिए किसी probe द्वारा खोला गया incident बिल्कुल वैसा ही दिखता है जैसा किसी responder द्वारा हाथ से खोला गया — बस automatic incidents पर server द्वारा set की गई कुछ bookkeeping columns को छोड़कर।

## हाथ से एक declare करना

**Incidents → All Incidents** खोलें और **Incidents** list के top right में **Declare Incident** पर क्लिक करें। इससे आप **Declare New Incident** शीर्षक वाले एक card पर पहुँचते हैं, जो form को पाँच steps में फैलाता है: **Incident Details**, **Resources Affected**, **Incident Roles**, **On-Call** और **More**। अंत में submit button भी **Declare Incident** पढ़ता है।

सिर्फ पहले step में required fields हैं। अगर आपको जल्दी है, तो **Incident Details** भरें और submit करें — आप बाद में incident के अपने pages से resources attach कर सकते हैं, roles assign कर सकते हैं और on-call policies जोड़ सकते हैं।

### Step 1 — Incident Details

- **Title** — required। वह एक-लाइन summary जो सभी को list में, Slack में, और (अगर incident visible है) आपके status page पर दिखेगी। Placeholder: `Incident Title`।
- **Description** — optional, Markdown में लिखा गया। यही वह field है जो status page पर render होता है, इसलिए इसे अपनी टीम के लिए नहीं बल्कि customers के लिए लिखें। आप इसे बाद में incident side menu में **Description** से edit कर सकते हैं।
- **Declared At** — form में required, डिफ़ॉल्ट रूप से अभी (now) पर सेट। यह वह timestamp है जिससे incident पर हर duration मापी जाती है, इसलिए अगर आप कुछ ऐसा रिकॉर्ड कर रहे हैं जो पहले शुरू हुआ था तो इसे back-date करें।
- **Incident Severity** — required। आपके project के लिए configure की गई severities में से एक; नए projects **Critical Incident**, **Major Incident** और **Minor Incident** के साथ seed होते हैं।
- **Incident State** — optional। इसे न छुएँ तो incident उस state में पहुँचता है जो `isCreatedState` से flag है, जिसे नए projects **Identified** के रूप में seed करते हैं। इसे तभी सेट करें जब आप ऐसा incident रिकॉर्ड कर रहे हों जो पहले ही उस point से आगे निकल चुका था।

**अगर state dropdown परेशानी दे।** अगर आपके project में कोई state `isCreatedState` flag नहीं रखता, तो create call fail हो जाता है और आपको settings से एक created incident state जोड़ने के लिए कहता है। यह आमतौर पर तभी होता है जब किसी project के states में बहुत बदलाव किया गया हो — देखें [Incident States & Severities](/docs/incidents/states-and-severities)।

### Step 2 — Resources Affected

- **Resources Affected** — एक ही search box जो monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts और services को attach करता है। Under the hood ये incident पर अलग-अलग relations हैं (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` और अन्य), लेकिन form इन्हें एक ही picker में समेट देता है।
- **Change Monitor Status to** — optional। एक monitor status चुनता है जो इस incident से जुड़े हर monitor पर लागू होता है, ताकि incident declare करना और monitors को degraded मार्क करना एक साथ एक ही action बन जाए।

**Monitors attach करें भले ही यह फालतू लगे।** किसी incident और status page के बीच link उस incident के monitors से होकर गुजरता है: एक status page किसी incident को तब दिखाता है जब उसके resources में से कोई एक उस incident के monitors में से एक हो। जब किसी incident से कोई monitor attached नहीं होता, तो subscribers को state-change notification बिल्कुल भेजी ही नहीं जाती। देखें [Status Page Resources & Groups](/docs/status-pages/resources-and-groups)।

### Step 3 — Incident Roles

- **Assign Incident Roles** — team members को आपके project द्वारा defined roles पर assign करें। कुछ roles एक से ज्यादा user स्वीकार करते हैं।

Roles खुद **Incidents → Settings → Incident Roles** पर configure होती हैं, जहाँ आप वे roles परिभाषित करते हैं जिन्हें response के दौरान assign किया जा सकता है — Incident Commander, Responder, और आपकी process को जो भी और चाहिए। अगर आप यह step skip करते हैं, तो अगर अभी तक कोई भी role नहीं रखता तो पहले state change पर एक Incident Commander अपने-आप assign हो जाता है।

### Step 4 — On-Call

- **On-Call Policy** — इस incident के बनने पर execute होने वाली on-call duty policies का एक multi-select। यह incident पर `onCallDutyPolicies` से mapped होता है।

यह इकलौती जगह है जहाँ कोई on-call policy किसी incident से सीधे attach होती है। Severities कोई on-call policy नहीं रखतीं — severity एक label है, और यह paging को सिर्फ एक on-call rule के अंदर *match criterion* के रूप में प्रभावित करती है। **Incidents → Rules → On-Call Rules** पर configure किए गए rules यहाँ आपके चुने हुए के ऊपर अपनी policies जोड़ते हैं; जो final set चलता है वह दोनों का deduplicated union होता है।

### Step 5 — More

- **Labels** — optional और एक advanced feature: इन labels तक access रखने वाले team members ही वे होते हैं जो incident को access कर सकते हैं।
- **Notify Status Page Subscribers** — checkbox, डिफ़ॉल्ट रूप से on। यह नियंत्रित करता है कि incident बनने पर subscribers को email किया जाए या नहीं (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`)। इसे उन internal चीज़ों के लिए off करें जिन्हें आप फिर भी record करना चाहते हैं।
- **Private Incident** — checkbox, डिफ़ॉल्ट रूप से off (`isPrivate`)। एक private incident सिर्फ उसके owner users, उसकी owner teams के members, project admins और project owners को दिखता है — और यह हर status page से छिपा रहता है, चाहे कोई भी दूसरी setting हो। incidents list इन्हें एक red **Private** pill से चिह्नित करती है।

**Should be visible on status page?** flag (`isVisibleOnStatusPage`) wizard पर नहीं है; यह डिफ़ॉल्ट रूप से true होता है। इसे बाद में incident side menu में **Settings** से बदलें, जहाँ इसे **Visible on Status Page** लेबल किया गया है।

## एक template से declare करना

अगर आप बार-बार एक जैसे shape का incident declare करते रहते हैं — वही title pattern, वही severity, वही on-call policy — तो इसे एक बार template के रूप में save कर लें।

**Declare Incident** के बगल में मौजूद outline button, **Create from Template** पर क्लिक करें और एक **Create Incident from Template** modal खुलता है, जिसमें एक **Select Incident Template** dropdown होता है। एक template चुनें और create form pre-filled खुल जाता है; submit करने से पहले आप फिर भी कुछ भी बदल सकते हैं। अगर आपके project में अभी तक कोई templates नहीं हैं, तो इसके बजाय आपको एक **No Incident Templates** modal मिलता है, जिसमें एक **Create Template** button होता है जो आपको **Incidents → Settings → Incident Templates** पर ले जाता है।

Templates अपने खुद के six-step wizard के साथ बनाए जाते हैं — **Template Info**, **Incident Details**, **Resources Affected**, **On-Call**, **Owners**, **Labels** — इन fields के साथ:

| Field                         | उद्देश्य                                                |
| ----------------------------- | ------------------------------------------------------ |
| **Template Name**             | picker में template को कैसे पहचाना जाता है।              |
| **Template Description**      | अपने भविष्य के खुद के लिए एक नोट कि इसे कब इस्तेमाल करें। |
| **Title**                     | incident पर pre-filled होने वाला title।                 |
| **Description**               | incident पर pre-filled होने वाला Markdown description।  |
| **Incident Severity**         | incident पर pre-filled होने वाली severity।              |
| **Initial Incident State**    | वह state जिसमें इस template से बने incidents शुरू होते हैं। |
| **Resources Affected**        | attach करने के लिए monitors, hosts, clusters और services। |
| **Change Monitor Status to**  | attached monitors पर लागू होने वाला monitor status।      |
| **On-Call Policy**            | incident बनने पर execute होने वाली policies।             |
| **Owner - Teams**             | इस template से बने incidents को owner करने वाली teams।   |
| **Owner - Users**             | इस template से बने incidents को owner करने वाले users।   |
| **Labels**                    | incident पर लागू किए जाने वाले labels।                    |

कुछ त्वरित नियम:

- Templates को templates list से edit नहीं किया जा सकता — आप एक बनाते हैं, फिर इसे बदलने के लिए इसे खोलते हैं।
- एक template सिर्फ उस field को भरता है जिसे आपने खाली छोड़ा था। create page पर template को एक pre-fill की तरह लागू किया जाता है जिसे आप overwrite कर सकते हैं; API पर, server किसी field को template से तभी भरता है जब request में वह field `undefined` छोड़ी गई हो। caller ने जो भी दिया हो वह हमेशा जीतता है।

## Monitor criteria से अपने-आप declare करना

ज्यादातर incidents को किसी इंसान द्वारा टाइप किए जाने की जरूरत नहीं होनी चाहिए। किसी monitor के criteria editor में, **When filters match, declare an incident.** toggle को on करें और एक **Add Incident** button के साथ एक **Create Incident** section दिखता है — एक criteria filter एक से ज्यादा incidents declare कर सकता है।

हर entry में होता है:

- **Incident Title** — templating को support करता है; placeholder कुछ ऐसा suggest करता है जैसे `{{monitorName}} is down`।
- **Severity** — required।
- **Incident Description** — यह भी templated है।
- **On-Call → On-Call Policies** — इस incident के बनने पर execute होने वाली policies।
- **Incident Roles** — team members को roles पर pre-assign करें।
- **Ownership & Labels → Owner Teams**, **Owner Users**, **Labels**।
- **Advanced Options → Auto Resolve Incident** (criteria मेल खाना बंद होने पर incident को अपने-आप resolve करता है), **Show Incident on Status Page**, **Private Incident** और **Remediation Notes**।

title, description और remediation notes में इस्तेमाल किए जा सकने वाले `{{variable}}` placeholders की पूरी list के लिए देखें [Incident & Alert Templating](/docs/monitor/incident-alert-templating)।

इस तरह बनाए गए incidents को server द्वारा tag किया जाता है: `isCreatedAutomatically` सेट होता है, `createdCriteriaId` यह रिकॉर्ड करता है कि कौन सा criteria filter चला, और `createdByProbe` यह रिकॉर्ड करता है कि किस probe ने इसे देखा। बाकी सब कुछ ठीक वैसे ही behave करता है जैसे हाथ से declare किया गया incident।

## API के जरिए declare करना

incident model एक standard CRUD endpoint expose करता है, इसलिए `POST /api/incident` एक बना देता है। **Project Settings → API Keys** पर generate की गई एक API key से authenticate करें, जिसे `apikey` header में भेजा जाता है — key ही project को पहचानती है, इसलिए आपको अलग से project id भेजने की जरूरत नहीं है।

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

request body पर उपयोगी fields:

- `title` — इकलौती field जो आपको वाकई देनी ही होगी।
- `declaredAt` — यहाँ optional है भले ही form इसे required रखता है। इसे छोड़ दें तो server current time का इस्तेमाल करता है।
- `incidentSeverityId` और `currentIncidentStateId` — server जाँचता है कि दोनों उसी project के हैं जिसका API key है, और अगर नहीं हैं तो request reject कर देता है। यही check **Change Monitor Status to** के पीछे मौजूद monitor status पर भी लागू होता है।
- `createdIncidentTemplateId` — एक saved template लागू करें। आप जो भी field छोड़ते हैं वह template से भर जाती है; आप जो भी field भेजते हैं वह वैसी ही रहती है।

Related endpoints हैं `/api/incident-state`, `/api/incident-severity` और `/api/incident-state-timeline`। generated [API reference](/reference) में इनमें से हर एक के exact request और response shapes हैं, जिसमें monitors जैसे relation fields को कैसे express किया जाता है यह भी शामिल है।

## Incident numbers और prefixes

हर incident को creation के समय server द्वारा assign किया गया एक sequential number मिलता है, जो per-project counter से आता है। इसे दो columns रखते हैं: `incidentNumber` (raw integer) और `incidentNumberWithPrefix` (जो आप असल में देखते हैं)। कोई prefix configure न होने पर, display value `#42` होती है।

इसे बदलने के लिए, **Incidents → Settings → More Settings** पर जाएँ। **Number Prefix** card में एक **Incident Number Prefix** field है (20 characters तक, placeholder `INC-`) — इसे सेट करें और वही incident `INC-42` के रूप में render होता है। डिफ़ॉल्ट `#` रखने के लिए इसे खाली छोड़ें। इस card में episode numbering के लिए **Incident Episode Number Prefix** भी है।

number incidents list के पहले column के रूप में दिखता है, incident से link करता है, और incident के **Overview** पर **Incident Number** के रूप में दिखता है।

## एक incident declare होते ही क्या होता है

create call सिर्फ एक row लिखने से ज्यादा करता है। इस क्रम में:

1. **server खाली जगहें भरता है।** `declaredAt` डिफ़ॉल्ट रूप से अभी (now) होता है, current state डिफ़ॉल्ट रूप से project के `isCreatedState` state पर सेट होता है, और incident number तथा prefixed number project counter से assign होते हैं।
2. **एक template लागू होता है**, अगर `createdIncidentTemplateId` दिया गया था — सिर्फ उन fields को भरते हुए जिन्हें caller ने undefined छोड़ा था।
3. **Privacy rules चलती हैं**, incident को private मार्क करती हैं जब कोई matching rule ऐसा कहती है। यह पहला rule engine है जो चलता है, इसलिए इसके बाद आने वाली हर चीज़ सही privacy setting देखती है।
4. **Owner rules चलती हैं**, matching rules द्वारा नामित owner users और teams जोड़ती हैं।
5. **Label rules चलती हैं**, incident से मेल खाने वाले labels जोड़ती हैं।
6. **On-call rules चलती हैं।** **Incidents → Rules → On-Call Rules** पर मौजूद हर enabled rule जिसकी criteria मेल खाती है, अपनी policies incident में जोड़ देता है। इसमें कोई priority order नहीं है और कोई short-circuit नहीं है — सभी matching rules चलते हैं और policies deduplicated होती हैं।
7. **Runbook rules चलती हैं**, matching runbooks को attach और start करती हैं। देखें [Runbooks](/docs/runbooks/index)।
8. **On-call policies execute होती हैं।** incident पर मौजूद हर policy — चाहे wizard में चुनी गई हो, किसी template से inherit हुई हो, या किसी rule द्वारा जोड़ी गई हो — event type `IncidentCreated` के साथ parallel में execute होती है। एक policy fail होने से बाकी नहीं रुकतीं।
9. **Subscribers queue होते हैं**, अगर **Notify Status Page Subscribers** on छोड़ा गया था और incident status page पर visible है। Delivery आपके request के साथ inline नहीं, बल्कि एक background job द्वारा handle की जाती है।
10. **Workflows चलते हैं।** **On Create Incident** trigger इस पर बना कोई भी workflow शुरू कर देता है। देखें [Workflows Overview](/docs/workflows/index)।

इसके बाद incident live हो जाता है: यह Incidents side menu में **Active Incidents** badge में गिना जाता है (कोई भी state जो `isResolvedState` flag नहीं रखता active माना जाता है), यह उन status pages पर दिखता है जो उसके किसी monitor को carry करते हैं, और इसकी **State Timeline** record करना शुरू कर देती है।

## आगे क्या पढ़ें

- [Incidents Overview](/docs/incidents/index) — incident model एक साथ कैसे fit होता है।
- [Incident States & Severities](/docs/incidents/states-and-severities) — state flags क्या करते हैं और अपने खुद के कैसे जोड़ें।
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — public notes, private notes, owners और activity feed।
- [Incident Settings & Automation](/docs/incidents/settings) — templates, custom fields, roles, rules और workflow triggers।
- [Subscribers & Announcements](/docs/status-pages/subscribers) — आपके अभी declare किए गए incident के बारे में किसे पता चलता है।
- [Incident & Alert Templating](/docs/monitor/incident-alert-templating) — auto-declared incidents के लिए उपलब्ध variables।
