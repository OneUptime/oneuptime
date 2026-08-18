# स्थितियाँ और गंभीरता

हर घटना दो वर्गीकरण रखती है: एक **state** जो बताती है कि यह आपकी प्रतिक्रिया में कहाँ है, और एक **severity** जो बताती है कि यह कितनी हानिकारक है। डैशबोर्ड में ये एक जैसी दिखती हैं — दोनों incidents list पर रंगीन pills के रूप में render होती हैं, दोनों project-scoped lists हैं जिन्हें आप rename और recolor कर सकते हैं। लेकिन ये बहुत अलग काम करती हैं।

States व्यवहार को नियंत्रित करती हैं। state rows पर तीन boolean flags तय करते हैं कि कौन-सी incidents active मानी जाती हैं, incident header पर कौन-से buttons दिखाई देते हैं, SLA clock कब रुकती है, और incident आपके status page से कब हटती है। Severities अपने आप में कुछ नियंत्रित नहीं करतीं — ये ऐसे labels हैं जो impact का वर्णन करते हैं, और जिन पर बाकी rules match कर सकते हैं।

दोनों lists आपके project के बनते ही seed की जाती हैं, और दोनों को **Incidents → Settings** के अंतर्गत edit किया जाता है। Incidents side menu का वह भाग डिफ़ॉल्ट रूप से collapsed रहता है, इसलिए इसे खोजने से पहले **Settings** को expand करें।

## States व्यवहार रखती हैं, severities अर्थ रखती हैं

`IncidentState` model में `name`, `description`, `color` और `order` होते हैं, साथ ही तीन booleans: `isCreatedState`, `isAcknowledgedState` और `isResolvedState`। product states के साथ जो कुछ भी करता है वह इन्हीं booleans और `order` पर आधारित होता है — कभी भी state के नाम पर नहीं। यही कारण है कि आप **Resolved** का नाम बदलकर "Closed" कर सकते हैं और कुछ भी नहीं टूटता: flag row के साथ ही रहता है।

`IncidentSeverity` model में `name`, `description`, `color` और `order` होते हैं और बस इतना ही। इसमें कोई flags नहीं हैं। OneUptime में कुछ भी **Critical Incident** को **Minor Incident** से अपने आप अलग नहीं मानता — severity केवल वहीं मायने रखती है जहाँ आप कोई चीज़ इस पर point करते हैं, जैसे किसी on-call rule पर **Incident Severities** match criterion।

कुछ त्वरित नियम:

- **Impact बताने के लिए severity चुनें** — यह incidents list पर, incident के **Overview** पर दिखती है, और किसी incident को declare करते समय यह एक आवश्यक field है।
- **अपनी process को model करने के लिए states चुनें** — response के वे steps जिनसे आप वास्तव में गुज़रते हैं, उसी क्रम में जिसमें आप उनसे गुज़रते हैं।
- **states में urgency encode न करें** — "Critical" नाम की state किसी को page नहीं करेगी। Severity और on-call rule मिलकर यह काम करते हैं।

## Seed की गई states

Project के साथ तीन states इसी क्रम में बनाई जाती हैं। यह seeding idempotent है — कोई state तभी जोड़ी जाती है जब उस नाम की कोई state पहले से मौजूद न हो।

| State            | `order` | Flag                  | Color     | इसका क्या मतलब है                                  |
| ---------------- | ------- | --------------------- | --------- | -------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | वह state जिसमें नई incidents आती हैं।              |
| **Acknowledged** | `2`     | `isAcknowledgedState` | `#ffbf53` | किसी ने incident को उठा लिया है।                   |
| **Resolved**     | `3`     | `isResolvedState`     | `#2ab57d` | Incident समाप्त हो गई है और active गिनी जाना बंद हो जाती है। |

नाम पर ध्यान दें: पहली state **Identified** है, भले ही product के अंदर कई descriptions अब भी इसे "created" state कहती हैं। जब कोई doc या tooltip "created state" कहे, तो इसका मतलब है वह state जो `isCreatedState` रखती है — एक fresh project में, वह **Identified** होती है।

## प्रत्येक state flag वास्तव में क्या करता है

| Flag                  | उद्देश्य                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | वह state जो incident को तब मिलती है जब किसी ने कोई नहीं चुनी हो। यदि project में कोई भी state यह flag नहीं रखती, तो incident बनाना एक error के साथ विफल हो जाता है जो settings से एक created incident state जोड़ने को कहता है। |
| `isAcknowledgedState` | **Acknowledge** button और incident **Overview** पर "<state name> in" stat tile को सक्रिय करता है। इस state में state change होने पर, incident का SLA responded के रूप में चिह्नित होता है।                    |
| `isResolvedState`     | **Resolve** button और resolved stat tile को सक्रिय करता है, **Active Incidents** list को परिभाषित करता है, और यही status page के active section से incident को हटाता है। SLA को resolved चिह्नित करता है। |

प्रत्येक project में केवल एक state के पास प्रत्येक flag होने की अपेक्षा की जाती है — lookups एक ही row fetch करते हैं। तीनों flagged states का नाम बदला जा सकता है, रंग बदला जा सकता है और क्रम बदला जा सकता है, लेकिन settings page उन्हें delete करने से मना करता है और created, acknowledged तथा resolved states के नाम बताते हुए एक error दिखाता है।

चूंकि UI state names को dynamically पढ़ता है, किसी state का नाम बदलने से आपको हर जगह जो दिखता है वह बदल जाता है — stat tiles, confirmation modal titles, और incidents list पर pill, सभी उस नाम का अनुसरण करते हैं जो आपने row को दिया है।

## अपनी खुद की states जोड़ना

**Incidents → Settings → Incident State** पर जाएं। यह page `order` के आरोही क्रम में sorted एक ordered list है, और नई states अंत में जोड़ी जाती हैं। किसी row को उसकी position बदलने के लिए drag करें।

**State पर fields:**

- **Name** — आवश्यक, कम से कम दो characters। Placeholder "Investigating" जैसा कुछ सुझाता है।
- **Description** — वैकल्पिक free text जो बताता है कि incident इस state में कब रहती है।
- **Color** — आवश्यक। Color picker से चुना गया; `#fd625e` जैसे hex value के रूप में संग्रहित।

आप इस form से तीनों flags सेट नहीं कर सकते — वे seeded rows से संबंधित हैं। इसलिए जो state आप जोड़ते हैं वह एक unflagged state होती है, जिसके दो परिणाम होते हैं जिनकी योजना बनानी चाहिए:

- **यह active मानी जाती है।** **Active Incidents** को "current state resolved state नहीं है" के रूप में परिभाषित किया गया है, इसलिए resolved state के अलावा जो कुछ भी आप जोड़ते हैं वह incident को active list और sidebar count में रखता है।
- **इसका transition button generic होता है।** **Acknowledge** या **Resolve** के बजाय, confirmation modal का title **Mark Incident as `<state name>`** होता है और submit button **Mark as `<state name>`** होता है।

एक आम पैटर्न acknowledged और resolved states के बीच एक triage या mitigation step डालना है — उदाहरण के लिए, एक नई "Mitigated" state को drag करके ऐसी जगह रखें कि वह **Acknowledged** के बाद और **Resolved** से पहले आए।

## Order एक वास्तविक बाधा है, केवल display preference नहीं

`order` column को state change लिखे जाने पर enforce किया जाता है, केवल list draw होने पर नहीं:

- **Backward transitions को अस्वीकार किया जाता है।** किसी incident को ऐसी state में move करना जो उसकी current state से order में पहले आती है, दोनों states के नाम बताते हुए एक error के साथ विफल हो जाता है।
- **Current state को फिर से चुनना अस्वीकार किया जाता है।** किसी incident को उसी state पर सेट करना जिसमें वह पहले से है, "Incident state cannot be same as previous state." के साथ विफल हो जाता है।
- **एक backdated row अपने neighbor को duplicate नहीं कर सकती।** एक timeline row डालना जिसकी state उस row से मेल खाती है जो उसके बाद आती है, भी अस्वीकार किया जाता है।
- **Header buttons order में flagged states की position का अनुसरण करते हैं।** **Acknowledge** और **Resolve** इस आधार पर offer किए जाते हैं कि current state order-sorted list में कहाँ बैठती है। resolved state के *बाद* रखी गई एक custom state कभी **Resolve** button नहीं दिखाएगी, क्योंकि आगे बढ़ने के लिए कुछ बचा नहीं है।

इसलिए जब आप कोई state जोड़ें, तो उसे वहाँ रखें जहाँ से कोई incident वास्तव में गुज़रेगी। इसे गलत क्रम में रखना केवल अजीब नहीं दिखता — यह transitions को असंभव बना देता है।

## Seed की गई severities

Project के साथ तीन severities इसी क्रम में बनाई जाती हैं:

- **Critical Incident** (`order` 1, `#b70400`) — ऐसे issues जो customers पर बहुत अधिक impact डालते हैं, जिन्हें तुरंत response चाहिए। पूरी outage या data breach।
- **Major Incident** (`order` 2, `#fd625e`) — महत्वपूर्ण impact, आमतौर पर तुरंत response चाहिए, कभी-कभी एक workaround के साथ जो नुकसान सीमित करता है। कोई महत्वपूर्ण sub-system fail होना।
- **Minor Incident** (`order` 3, `#ffbf53`) — कम impact, आमतौर पर working hours के भीतर handle किया जाता है, और अधिकांश customers को इसका पता चलने की संभावना नहीं है। Application performance में हल्की गिरावट।

किसी incident को declare करते समय severity आवश्यक है, और monitor के criteria में हर incident spec पर भी यह आवश्यक है, इसलिए हर incident — manual हो या automatic — एक severity के साथ आती है। Declare flow के लिए [Declaring an Incident](/docs/incidents/declaring-incidents) देखें और monitor-driven path के लिए [Incident and Alert Templating](/docs/monitor/incident-alert-templating) देखें।

## Severities को edit करना

**Incidents → Settings → Incident Severity** पर जाएं। states page जैसा ही ढांचा — `order` के अनुसार sorted एक ordered list, reorder करने के लिए drag करें, नई severities अंत में जोड़ी जाती हैं, form पर **Name**, **Description** और **Color** के साथ।

States से दो अंतर:

- **कोई delete guard नहीं है।** किसी भी severity को delete किया जा सकता है, तीनों seeded severities सहित।
- **inherit करने के लिए कोई flags नहीं हैं।** नई severity बिल्कुल seeded severities जैसी ही व्यवहार करती है — यह एक रंग और एक position वाला label है।

**Placeholders पर एक नोट।** Severity form state form के example text को शब्दशः reuse करता है, इसलिए hints severities के बजाय incident states की बात करते हैं। उन्हें नज़रअंदाज़ करें और अपने खुद के severity names और descriptions लिखें।

जहाँ severity वर्णन से आगे बढ़कर कुछ करती है: **Incidents → Rules → On-Call Rules** पर, किसी rule का **Incident Severities** field एक match criterion है। वहाँ **Critical Incident** listing करना "किसी भी critical चीज़ के लिए database team को page करें" व्यक्त करने का तरीका है — on-call policy rule पर रहती है, severity पर नहीं।

## किसी incident को उसकी states के माध्यम से आगे बढ़ाना

किसी incident की state बदलने के चार तरीके हैं:

- **Header buttons।** किसी incident को खोलें। यदि इसकी current state acknowledged state से पहले है, तो आपको **Acknowledge** और **Resolve** मिलते हैं; यदि यह दोनों के बीच है, तो आपको **Resolve** मिलता है। हर एक एक confirmation modal खोलता है — **Acknowledge Incident** या **Resolve Incident** — जो **Select Note Template**, **Public Note** और **Notify Status Page Subscribers** भी offer करता है।
- **State timeline।** incident के **State Timeline** page से हाथ से **Incident Status**, **Starts At** और **Notify Status Page Subscribers** के साथ एक row जोड़ें।
- **Bulk change।** Incidents list में कई incidents को एक साथ move करने के लिए एक **Change State** bulk action है।
- **Automatically।** **Auto Resolve Incident** enabled वाला monitor criterion अपनी incident को तब resolve करता है जब criterion अब पूरा नहीं होता, और API `/api/incident-state-timeline` के माध्यम से state update कर सकता है।

इनमें से हर एक एक timeline row लिखता है। State change कुछ और चीज़ें भी करता है जिनके लिए आपको पूछना नहीं पड़ता: यह incident feed में एक entry post करता है, यदि incident के पास पहले से कोई Incident Commander नहीं है तो एक assign करता है, और SLA clock को update करता है। किसी resolved incident को reopen करने से reopen time से एक नया SLA record शुरू होता है।

## State timeline

Incident side menu में incident का **State Timeline** page हर उस state का audit trail है जिसमें incident रह चुकी है। उस page पर कार्ड का title **Status Timeline** है, और यह सबसे नए से पुराने क्रम में sorted है।

**Columns:**

- **Incident Status** — state के नाम और रंग वाला एक रंगीन pill।
- **Starts At** — incident इस state में कब दाखिल हुई।
- **Ends At** — यह कब छोड़ी गई। Current state `Currently Active` दिखाती है।
- **Duration** — state में बिताया गया समय, current के लिए अभी तक गिना जाता है।
- **Subscriber Notification Status** — क्या इस बदलाव के लिए status page notification भेजी गई, skip की गई या अभी pending है, एक **more details** link के साथ, और — जब भेजना विफल हो जाए — एक **Retry** action के साथ।

**Row actions:**

- **View Cause** — एक **Root Cause** modal खोलता है जो उस state change के साथ रिकॉर्ड किए गए markdown को render करता है।
- **View Logs** — एक modal खोलता है जो बताता है कि status क्यों बदला, एक **Incident State Log** viewer के साथ।

Timeline rows बनाई और delete की जा सकती हैं, पर edit नहीं की जा सकतीं। गलत row को delete करना incident के इतिहास को फिर से लिखता है, इसलिए इसे cleanup की आदत के बजाय एक correction tool के रूप में देखें।

## Active Incidents list

**Incidents → Active Incidents** वह list है जिसे आप shift के दौरान देखते हैं। इसकी परिभाषा ठीक एक condition है: incident की current state ऐसी state है जहाँ `isResolvedState` false है। और कुछ भी विचार में नहीं लिया जाता — न severity, न age, न ही यह कि किसी ने इसे acknowledge किया है या नहीं।

Side-menu item उसी query का उपयोग करते हुए एक red count badge रखता है, इसलिए badge और list हमेशा सहमत रहते हैं। जब देखने के लिए कुछ न हो, तो page यह बता देता है।

व्यावहारिक परिणाम: आपके द्वारा जोड़ी गई कोई भी custom state incidents को इस list में रखती है। यह आमतौर पर वही है जो आप चाहते हैं — "Mitigated" "done" नहीं है — लेकिन इसका मतलब है कि badge तभी साफ होता है जब incidents वास्तव में resolved state तक पहुँचती हैं।

## Status page subscribers को state change के बारे में बताना

State change आपके status page subscribers को email कर सकता है, लेकिन यह कई gates से गुज़रता है। इन्हें समझने से "किसी को notify क्यों नहीं किया गया" जैसी बहुत सारी debugging बच जाती है।

Notification को प्रति timeline row **Notify Status Page Subscribers** (`shouldStatusPageSubscribersBeNotified`) द्वारा request किया जाता है, जो state-change modal और manual timeline form पर checkbox है। जब यह off होता है, तो row skipped status और एक explanation के साथ संग्रहित होती है। जब यह on होता है, तो row queue की जाती है और एक background job इसे उठाता है — job हर मिनट चलती है, इसलिए delivery तेज़ है पर तुरंत नहीं।

**Queued row निम्न में से किसी भी स्थिति में skip हो जाती है:**

- **नई state created state है।** Subscribers को incident declare होने पर पहले ही बताया जा चुका था, इसलिए पहली timeline row जानबूझकर दूसरा message नहीं भेजती।
- **Incident से कोई monitors जुड़े नहीं हैं।** बिना किसी resources के, incident को map करने के लिए कोई status page नहीं है।
- **Incident status page पर visible नहीं है** (`isVisibleOnStatusPage` off है)।
- **Status page पर incidents off हैं** (`showIncidentsOnStatusPage` off है)। यह प्रति status page है — वही monitor दिखाने वाले बाकी pages को अब भी notify किया जाता है।

**एक और चीज़ जो परिणाम बदलती है।** यदि आप state-change modal में एक **Public Note** टाइप करते हैं, तो timeline row को queued के बजाय पहले से notified के रूप में चिह्नित किया जाता है। Note स्वयं ही subscribers तक पहुँचता है, इसलिए उन्हें दो के बजाय एक message मिलता है। सादे state-change message के पीछे event type `Subscriber Incident State Changed` है।

इन्हें कौन प्राप्त करता है और templates कैसे चुने जाते हैं, इसके लिए [Subscribers & Announcements](/docs/status-pages/subscribers) देखें।

## किसी incident को status page से बाहर रखना

तीन अलग-अलग चीज़ें तय करती हैं कि कोई incident public page पर बिल्कुल भी दिखे या नहीं, और तीनों का सही होना ज़रूरी है:

- Status page पर ही **Show Incidents** (`showIncidentsOnStatusPage`)।
- Incident पर **Visible on Status Page** (`isVisibleOnStatusPage`) — incident के **Settings** page पर एक toggle। यह डिफ़ॉल्ट रूप से true होता है और declare wizard पर नहीं है; एक monitor criterion इसे **Show Incident on Status Page** के साथ सेट कर सकता है।
- **Current state resolved state नहीं है।** यही किसी incident को active section से हटाता है: status page query उन incidents को fetch करती है जिनकी current state कोई भी unresolved state हो। आप कुछ भी archive या close नहीं करते — आप इसे resolve करते हैं, और यह history में चला जाता है।

**Private incidents कभी दिखाई नहीं देतीं।** **Private Incident** को on करना incident को हर status page से छुपाता है, ऊपर बताए गए toggles से बिना असर, और इसे इसके owners, project admins और owners तक सीमित करता है।

Page कितनी resolved history रखता है यह एक status page setting है, incident की नहीं। यह देखने के लिए कि page पर monitors यह कैसे तय करते हैं कि कौन-सी incidents बिल्कुल भी दिखें, [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) देखें।

## आगे क्या पढ़ें

- [घटनाओं का अवलोकन](/docs/incidents/index) — incident feature area किस तरह एक साथ फिट होता है।
- [घटना घोषित करना](/docs/incidents/declaring-incidents) — declare wizard, templates, और API।
- [घटना नोट्स, स्वामी और फ़ीड](/docs/incidents/notes-owners-and-feed) — public notes, private notes, और activity feed।
- [घटना सेटिंग्स और स्वचालन](/docs/incidents/settings) — templates, custom fields, rules, और workflow triggers।
- [सब्सक्राइबर और घोषणाएँ](/docs/status-pages/subscribers) — state change भेजी गई emails किसे मिलती हैं।
- [स्थिति पृष्ठ अवलोकन](/docs/status-pages/index) — status page क्या दिखाता है और किसे।
- [वर्कफ़्लो अवलोकन](/docs/workflows/index) — automation के साथ state changes पर प्रतिक्रिया देना।
