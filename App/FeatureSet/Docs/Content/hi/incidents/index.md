# Incidents Overview

OneUptime में एक incident वह रिकॉर्ड है जिसके इर्द-गिर्द आपकी टीम तब इकट्ठा होती है जब कुछ टूटता है। इसमें एक number, एक title, एक severity, एक current state, प्रभावित होने वाले resources, और वह सब कुछ होता है जो आपकी टीम response करते समय लिखती है — notes, root cause, remediation steps, और किसने क्या किया इसकी एक append-only feed।

Incidents वही चीज़ हैं जो किसी monitor के red होने को एक coordinated response में बदल देती हैं। किसी incident को declare करने से सही on-call rotation को page किया जाता है, owners जोड़े जाते हैं जिन्हें हर बदलाव की सूचना मिलती है, runbooks शुरू होते हैं, और — अगर आप चाहें — outage को आपके public status page पर post कर दिया जाता है ताकि customers यह पूछने के लिए tickets खोलना बंद कर दें कि क्या आपको पहले से पता है।

आप रात 3 बजे हाथ से एक incident declare कर सकते हैं, या किसी monitor को उसकी criteria मेल खाते ही आपकी ओर से इसे declare करने दे सकते हैं। दोनों ही स्थितियों में incident एक ही object होता है, उसी lifecycle के साथ, और अंत में उसी paper trail के साथ।

## एक नज़र में

- **Top-level feature** — dashboard के left navigation में **Incidents**, `/dashboard/{projectId}/incidents` पर।
- **तीन seeded states** — हर नए project के लिए **Identified**, **Acknowledged** और **Resolved** बनाए जाते हैं। आप अपने खुद के states जोड़ सकते हैं; तीन seeded states का नाम और रंग बदला जा सकता है लेकिन उन्हें कभी हटाया नहीं जा सकता।
- **तीन seeded severities** — **Critical Incident**, **Major Incident** और **Minor Incident**। Severity एक color और order वाला एक लेबल है — इसका अपना कोई behavior नहीं होता।
- **अंदर आने के चार रास्ते** — **Declare Incident** wizard, **Create from Template**, एक monitor criteria rule, या `POST /api/incident`।
- **हर project के लिए नंबर वाला** — हर incident को एक incident number मिलता है, जो डिफ़ॉल्ट रूप से `#42` की तरह दिखता है या आपके अपने prefix के साथ, जैसे `INC-42`।
- **दो तरह के notes** — आपकी टीम के लिए private notes (internal notes), और status page subscribers के लिए public notes।
- **Settings, Project Settings में नहीं बल्कि Incidents के अंतर्गत रहती हैं** — states, severities, templates, custom fields और rule engines सब **Incidents → Settings** और **Incidents → Rules** पर हैं।

## मुख्य शब्द

इस section के लगभग हर दूसरे page पर कुछ शब्द बार-बार आते हैं। पहले इन्हें अच्छी तरह समझ लें।

| Term                    | इसका मतलब                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incident**            | रिकॉर्ड खुद — title, description, severity, current state, affected resources, और response के दौरान इस पर लिखी गई हर चीज़।              |
| **Incident state**      | incident अपने lifecycle में कहाँ है। एक project-scoped row जिसमें name, color और `order` होता है, साथ ही वे flags जो इसे अर्थ देते हैं।                   |
| **Incident severity**   | यह कितना बुरा है। एक project-scoped row जिसमें name, color और `order` होता है। यह सिर्फ एक classification है — product में कुछ भी किसी एक severity को खास तरीके से नहीं treat करता। |
| **Incident number**     | एक per-project counter जो `#42` के रूप में दिखता है, या आपके configure किए गए prefix के साथ, जैसे `INC-42`।                                                  |
| **Resources affected**  | monitors, hosts, Kubernetes clusters, Docker hosts, services और अन्य infrastructure जिन्हें आप incident से जोड़ते हैं।                               |
| **Public note**         | status page पाठकों और subscribers के लिए लिखा गया update। यह status page timeline पर render होता है।                                                  |
| **Private note**        | responding team के लिए एक internal note (`IncidentInternalNote` model)। यह कभी status page तक नहीं पहुँचता।                                        |
| **Owner**                | incident के लिए जिम्मेदार एक user या team। जब incident बनता है, notes post होते हैं, और जब state बदलता है, तो owners को सूचना मिलती है।             |
| **Incident feed**       | incident के **Overview** पर मौजूद append-only activity timeline, जो state changes, notes, owner changes, rule executions और notifications दर्ज करती है। |
| **State timeline**      | यह रिकॉर्ड कि incident किस state में, कब और कितनी देर तक रहा — साथ ही हर transition के लिए subscriber notification status।                                |

## तीन states जो OneUptime हर project के लिए seed करता है

जब एक project बनता है, तो OneUptime ठीक तीन incident states seed करता है, इस क्रम में:

| State             | Order | Color               | इसका मतलब                                                              |
| ------------------ | ----- | -------------------- | -------------------------------------------------------------------------- |
| **Identified**     | 1     | Red (`#fd625e`)      | वह state जिसमें एक बिल्कुल नया incident आता है। यह created state है।           |
| **Acknowledged**   | 2     | Yellow (`#ffbf53`)   | किसी ने incident को उठाया है और उस पर काम कर रहा है।                                |
| **Resolved**       | 3     | Green (`#2ab57d`)    | incident खत्म हो चुका है। इसे resolve करना ही इसे आपके status page से हटाता है। |

नाम सिर्फ labels हैं — behavior को असल में तीन booleans चलाते हैं जो state row पर होते हैं: `isCreatedState`, `isAcknowledgedState` और `isResolvedState`। प्रत्येक project में हर एक flag सिर्फ एक ही state के पास होने की उम्मीद की जाती है।

यह अंतर सुनने से ज्यादा मायने रखता है:

- `isCreatedState` तय करता है कि एक नया incident कहाँ से शुरू होता है। यदि create करते समय कोई state explicitly नहीं चुना जाता, तो OneUptime project के created state को ढूँढकर उसका उपयोग करता है।
- `isAcknowledgedState` और `isResolvedState` incident header में **Acknowledge** और **Resolve** buttons को, incident **Overview** पर मौजूद दो stat tiles को, और side menu में **Active Incidents** count badge को चलाते हैं।
- **Active Incidents** को केवल इस तरह परिभाषित किया गया है कि "current state, resolved state नहीं है"। इसलिए आपके द्वारा जोड़ा गया कोई भी custom state तब तक active रहता है जब तक वह resolved state न हो।

**नामकरण पर ध्यान दें।** पहले seeded state का नाम **Identified** है, भले ही product के अंदर कई जगह इसे अब भी created state कहा जाता है। यदि आप अपने project की state list में "Created" ढूँढ रहे हैं, तो वह **Identified** नाम वाला row है।

आप अपने खुद के states **Incidents → Settings → Incident State** पर जोड़ सकते हैं। नए states ordered list के अंत में जोड़े जाते हैं और आप उन्हें drag करके reorder कर सकते हैं। तीन flagged states को हटाया नहीं जा सकता — OneUptime इसे block कर देता है — लेकिन आप उनका नाम और रंग बदल सकते हैं, यही वजह है कि UI state names को dynamically पढ़ता है।

Order लागू होता है, यह सिर्फ cosmetic नहीं है: कोई incident उस state में नहीं जा सकता जो order में उसके current state से पहले आता है।

पूरी जानकारी [Incident States & Severities](/docs/incidents/states-and-severities) में है।

## तीन severities जो OneUptime हर project के लिए seed करता है

हर नए project को तीन severities भी मिलती हैं:

| Severity               | Order | Color               | इसका मतलब                                              |
| ----------------------- | ----- | -------------------- | ------------------------------------------------------ |
| **Critical Incident**   | 1     | Maroon (`#b70400`)   | बहुत ज्यादा customer impact, जिसमें तुरंत response चाहिए।       |
| **Major Incident**      | 2     | Red (`#fd625e`)      | महत्वपूर्ण impact, जिसमें आमतौर पर तुरंत response चाहिए।         |
| **Minor Incident**      | 3     | Yellow (`#ffbf53`)   | कम impact, जिसे आमतौर पर working hours में handle किया जाता है। |

पूरे seeded descriptions [Incident States & Severities](/docs/incidents/states-and-severities) में हैं।

Severities में `name`, `description`, `color` और `order` होता है और कुछ नहीं। इनमें कोई flags नहीं होते, और कोई code path "Critical Incident" को किसी दूसरे row से अलग तरीके से treat नहीं करता। Severity यह है कि इंसान कैसे triage करते हैं, और जब आप on-call rules लिखते हैं तो यह एक match criterion के रूप में उपलब्ध होती है — लेकिन एक severity चुनने भर से अपने-आप किसी को page नहीं किया जाता।

Severities को **Incidents → Settings → Incident Severity** पर edit या add करें।

## एक incident का जीवन

### 1. यह declare होता है

चार routes एक ही object पर पहुँचते हैं:

- **हाथ से** — Incidents list से, **Declare Incident** पर क्लिक करें। इससे **Declare New Incident** wizard खुलता है, जो पाँच steps लंबा है: **Incident Details**, **Resources Affected**, **Incident Roles**, **On-Call**, **More**।
- **एक template से** — **Create from Template** पर क्लिक करें और एक saved **Incident Template** चुनें। Templates title, description, severity, initial state, resources, on-call policies, owners और labels को pre-fill करते हैं।
- **एक monitor से** — "declare an incident" toggle enabled वाला एक monitor criteria rule, उसके filters मेल खाते ही अपने-आप incident बना देता है। यहाँ titles और descriptions `{{variable}}` templating को support करते हैं।
- **API के ज़रिए** — एक API key के साथ `POST /api/incident`। server आपके लिए `declaredAt`, created state, और incident number भर देता है।

field-by-field walkthrough के लिए [Declaring an Incident](/docs/incidents/declaring-incidents) देखें।

### 2. सही लोगों को पता चलता है

creation पर OneUptime आपकी configure की हुई automation चलाता है: label rules, on-call rules, owner rules और runbook rules। incident से जुड़ी कोई भी on-call duty policies — चाहे manually attach की गई हों, किसी template से आई हों, या किसी matching on-call rule से merge हुई हों — parallel में execute होती हैं।

Owners को email, SMS, call, push और WhatsApp के जरिए सूचित किया जाता है, यह हर user की अपनी notification preferences पर निर्भर करता है। यदि किसी incident का कोई owner नहीं है, तो notification drop होने के बजाय project owners तक fall back हो जाती है।

अगर incident status page पर visible है और subscriber notifications enabled हैं, तो subscribers को भी बताया जाता है। Notifications cron-driven हैं और हर minute चलती हैं, इसलिए instant send के बजाय लगभग एक minute तक की देरी की उम्मीद करें।

### 3. आपकी टीम इस पर काम करती है

Responders incident को acknowledge करते हैं, affected resources जोड़ते हैं, runbooks चलाते हैं, incident roles assign करते हैं, और जैसे-जैसे उन्हें चीज़ें पता चलती हैं, उन्हें लिखते जाते हैं — टीम के लिए private notes, customers के लिए public notes, और जब तस्वीर साफ हो जाए तो **Root Cause** और **Remediation** pages। वे जो कुछ भी करते हैं वह **Overview** page पर मौजूद **Incident Feed** में दर्ज होता है।

### 4. यह resolve होता है

**Resolve** पर क्लिक करने से incident resolved state में चला जाता है, state timeline पर stamp लगता है, duration clock रुक जाता है, और incident को उस किसी भी status page के active section से हटा दिया जाता है जिस पर वह दिख रहा था। ऐसा होने के लिए और कुछ बदलने की जरूरत नहीं है — resolved state flag ही वह चीज़ है जिसे status page query देखती है।

इसके बाद आप एक postmortem लिख सकते हैं और चाहें तो उसे status page पर publish कर सकते हैं।

## Dashboard में incidents कहाँ रहते हैं

left navigation में **Incidents** खोलें। इसका side menu sections में बँटा है:

| Section       | आप वहाँ क्या करते हैं                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**  | **All Incidents** और **Active Incidents** — बाद वाले पर एक red badge होता है जिसमें उन incidents की संख्या होती है जो resolved state में नहीं हैं।                |
| **Episodes**  | Incident episodes, अपने खुद के pages वाला एक अलग grouping feature।                                                                                              |
| **AI**        | **Investigation** और **Remediation** — automatic investigation और auto-remediation settings।                                                                    |
| **Workspace** | incidents के लिए **Slack** और **Microsoft Teams** connections।                                                                                                  |
| **Rules**     | rule engines: **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules**, **Reminder Rules**। |
| **Settings**  | **Incident State**, **Incident Severity**, **Incident Templates**, **Note Templates**, **Postmortem Templates**, **Custom Fields**, **Incident Roles**, **More Settings**। |

**Rules** और **Settings** डिफ़ॉल्ट रूप से collapsed रहती हैं — इन docs में जिन pages का ज़िक्र किया गया है उन्हें ढूँढने के लिए इन्हें expand करें। Incident configuration Project Settings के अंतर्गत नहीं है; यह सब यहीं रहता है।

incidents list खुद **Incident Number**, **Title**, **State**, **Severity**, **Resources Affected**, **Declared**, **Duration**, **Labels** और **Owners** दिखाती है, साथ ही एक साथ कई को बंद करने के लिए एक **Change State** bulk action।

## एक incident पर हर page क्या दिखाता है

किसी incident को खोलें तो आपको एक left side menu मिलता है, इस तरह समूहित:

- **Overview** — **Incident Details** card (title, severity, labels, incident number, declared at, declared by, on-call policies), एक **Affected Resources** card, और **Incident Feed**। इनके ऊपर, time to acknowledge, time to resolve, और कुल **Duration** के लिए stat tiles।
- **State Timeline** — incident जिन-जिन states में रहा है, हर एक के लिए **Starts At**, **Ends At**, **Duration** और subscriber notification status। **View Cause** और **View Logs** बताते हैं कि हर बदलाव क्यों हुआ।
- **SLA** — इस incident के लिए SLA tracking।
- **Description**, **Root Cause**, **Remediation** — तीन markdown pages। Description वही है जो आपके status page पर दिखता है।
- **Runbooks** — इस incident से जुड़े runbook executions।
- **Postmortem** — write-up, जिसे आप चाहें तो status page पर publish कर सकते हैं।
- **Roles**, **On-Call Executions**, **Owners** — कौन इस पर है, कौन-सी policies चलीं, और किसे सूचित किया जाता है।
- **Notification Logs**, **AI Logs**, **Audit Logs** — क्या भेजा गया और क्या बदला।
- **Private Notes** और **Public Notes** — side menu के **Notes** section के अंतर्गत।
- **Custom Fields**, **Settings**, **Delete Incident** — **Advanced** के अंतर्गत। **Settings** page में **Visible on Status Page**, **Private Incident** और **Reminders** card होते हैं।

collaboration pages के बारे में विस्तार से [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) में बताया गया है।

## Incidents बाकी OneUptime के साथ कैसे fit होते हैं

- **Monitors समस्या को पहचानते हैं; incidents उसे रिकॉर्ड करते हैं।** एक monitor criteria rule title, severity, on-call policies, owners, labels और remediation notes को pre-fill करते हुए अपने-आप एक incident declare कर सकता है। वहाँ उपलब्ध variables के लिए [Incident and Alert Templating](/docs/monitor/incident-alert-templating) देखें।
- **On-call policies paging का काम करती हैं।** declare wizard के **On-Call** step पर, किसी template पर, या **Incidents → Rules → On-Call Rules** के जरिए policies attach करें। हर matching rule चलती है — executed set सभी matches और सीधे attach की गई किसी भी चीज़ का union होता है, deduplicated।
- **Runbooks लोगों को बताते हैं क्या करना है।** जब कोई matching incident बनता है, तो runbook rules अपने-आप एक procedure attach कर देते हैं, और responders incident से खुद हाथ से भी एक शुरू कर सकते हैं। [Runbooks Overview](/docs/runbooks/index) देखें।
- **Status pages customers को बताते हैं।** एक incident status page की active list में तब दिखता है जब page पर incidents enabled हों, incident status page पर visible के रूप में चिह्नित हो, और उसका current state resolved state न हो। Private incidents हर status page से हमेशा छिपे रहते हैं। [Status Pages Overview](/docs/status-pages/index) देखें।
- **Workflows इसके इर्द-गिर्द automate करते हैं।** **On Create Incident**, **On Update Incident** और **On Delete Incident** triggers आपको incident lifecycle के ऊपर no-code automation बनाने देते हैं। [Workflows Overview](/docs/workflows/index) देखें।

## आगे क्या पढ़ें

- [Declaring an Incident](/docs/incidents/declaring-incidents) — wizard, templates, monitor criteria और API।
- [Incident States & Severities](/docs/incidents/states-and-severities) — state flags, custom states और severity classification।
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — public और private notes, owners, और activity feed।
- [Incident Settings & Automation](/docs/incidents/settings) — templates, custom fields, number prefixes और rule engines।
- [Status Pages Overview](/docs/status-pages/index) — incidents आपके customers तक कैसे पहुँचते हैं।
- [Subscribers & Announcements](/docs/status-pages/subscribers) — जब कोई incident बदलता है तो किसे सूचित किया जाता है।
