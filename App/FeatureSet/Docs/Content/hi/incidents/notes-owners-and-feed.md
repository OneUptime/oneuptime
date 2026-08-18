# नोट्स, स्वामी और फ़ीड

काम करते समय हर incident एक लिखित record जमा करती है। इसमें से कुछ record आपके customers के लिए होता है — वह update जो 02:14 बजे status page पर यह कहते हुए जाता है कि आपको खराब deploy मिल गया है। बाकी आपकी team के लिए होता है — किसी ने paste किया हुआ stack trace, वह graph जिसने आखिरकार सब समझा दिया, failover करने का decision।

OneUptime इन दोनों audiences को अलग रखता है। **Public Notes** आपके status page पर publish होते हैं और subscribers को notify कर सकते हैं। **Private Notes** (`IncidentInternalNote` model) dashboard के अंदर ही रहते हैं। दोनों के नीचे **Incident Feed** होती है, एक append-only timeline जो incident के साथ हुई हर चीज़ को record करती है, और **Owners** list, जो तय करती है कि किसे बताया जाए।

यह सब incident के left side menu से जुड़ा है: **Notes → Public Notes**, **Notes → Private Notes**, और **Team → Owners**। Feed incident के **Overview** page पर रहती है।

## Public notes बनाम private notes

Dashboard में दोनों note types एक जैसे दिखते हैं पर बहुत अलग तरीके से व्यवहार करते हैं।

- **Public notes** — `IncidentPublicNote` model, जो incident timeline के हिस्से के रूप में status pages को दिए जाते हैं। ये एक **Posted At** date रखते हैं जिसे आप खुद सेट कर सकते हैं और एक **Notify Status Page Subscribers** checkbox।
- **Private notes** — `IncidentInternalNote` model। status page app में इन्हें कुछ भी नहीं पढ़ता। इनके पास कोई posted-at field नहीं है (list `createdAt` से stamp और sort होती है) और कोई भी subscriber fields नहीं हैं, इसलिए private note कभी भी subscriber notification trigger नहीं कर सकता।

**"Private" का असल मतलब क्या है।** इसका मतलब है "status page पर publish नहीं किया गया" — "लोगों के एक छोटे समूह तक सीमित" नहीं। दोनों note types समान read permissions साझा करते हैं, इसलिए जो कोई भी incident पढ़ सकता है वह इसके private notes भी पढ़ सकता है। यदि आपको यह restrict करना है कि incident को बिल्कुल कौन देख सकता है, तो incident पर ही **Private Incident** flag (`isPrivate`) का उपयोग करें, जो incident को हर status page से छुपा देता है और इसे incident के owner users, इसकी owner teams के members, और project admins तथा owners तक सीमित कर देता है।

**Owners दोनों देखते हैं।** owner notification job public और private दोनों notes को एक साथ query करती है। कोई private note आपके subscribers से private है, response करने वाले लोगों से नहीं।

| यदि आप चाहते हैं…                                        | चुनें             |
| ------------------------------------------------------ | ---------------- |
| Customers को बताएं कि आप क्या जानते हैं और कब और जानेंगे | **Public Note**  |
| पहले कहीं और भेजे गए update को backdate करें            | **Public Note**  |
| कोई hypothesis, चलाया गया command, या dead end record करें | **Private Note** |
| Heap dump या internal dashboard screenshot attach करें | **Private Note** |

## Public note post करना

Incident side menu में **Notes → Public Notes** खोलें और एक note बनाएं। कार्ड बताता है कि आप यहाँ जो लिखेंगे वह status page पर दिखेगा; empty state में लिखा होता है कि अब तक इस incident के लिए कोई public notes नहीं बनाए गए हैं।

| Field                              | उद्देश्य                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Public Incident Note**           | Body, Markdown में। आवश्यक। Form याद दिलाता है कि note आपके status page पर visible है और एक cheatsheet link करता है। |
| **Attachments**                    | status page पर subscribers के साथ साझा की गई files। वैकल्पिक।                                                          |
| **Notify Status Page Subscribers** | Checkbox, डिफ़ॉल्ट रूप से on। चुपचाप publish करने के लिए इसे off करें।                                                 |
| **Posted At**                      | आवश्यक date और time, डिफ़ॉल्ट रूप से अभी, आपके current timezone में दिखाया गया।                                        |

**Posted At ही note का असल timestamp है।** Status pages public notes को `postedAt` के अनुसार sort और display करते हैं, न कि आपने इन्हें कब टाइप किया — इसलिए यदि आप status page को 40 मिनट पहले भेजे गए किसी update के बारे में बता रहे हैं, तो **Posted At** को उस समय पर सेट करें जब वह वास्तव में हुआ था। यदि कोई note API के ज़रिए बिना किसी के आता है, तो OneUptime current time को stamp कर देता है।

List दिखाती है कि हर note किसने लिखा, इसका **Posted At**, rendered Markdown उसके attachments के साथ, और एक **Subscriber Notification Status** column। आप **Created By**, **Note**, और **Created At** से filter कर सकते हैं।

## Private note post करना

**Notes → Private Notes** जानबूझकर सादा रखा गया है। इसमें केवल दो fields हैं:

- **Private Incident Note** — Markdown body, आवश्यक। Form साफ कहता है कि यह आपकी team के लिए private है और status page पर visible नहीं है।
- **Attachments** — incident response team के लिए बनाई गई files।

कोई **Posted At** नहीं, कोई subscriber checkbox नहीं — note बनते ही stamp हो जाता है।

## Notes पर Attachments

दोनों note types एक **Attachments** field के माध्यम से file attachments स्वीकार करते हैं, और दोनों note body के नीचे एक attachment list render करते हैं जिसमें प्रति-file एक **Download attachment** link होती है।

जहाँ ये अलग होते हैं वह है फाइल कौन fetch कर सकता है:

- **Public note attachments** status page visitors द्वारा एक status page route के ज़रिए, note के साथ ही, download की जा सकती हैं।
- **Private note attachments** केवल authenticated dashboard API के ज़रिए ही पहुंच योग्य हैं। इनके लिए कोई status page route नहीं है।

इससे attachments भी note text जैसा ही public/private decision बन जाता है। customer-facing timeline image एक public note पर जाती है; config dump एक private note पर।

## AI से note generate करना

दोनों note pages पर एक **Generate with AI** button है। यह incident को आपके project के AI provider को भेजता है और generated Markdown को note editor में डाल देता है, जहाँ save करने से पहले आप इसे edit करते हैं — कुछ भी अपने आप publish नहीं होता।

- **Generate Public Note with AI** — customer-facing note बनाने के लिए incident data का analyze करने के रूप में वर्णित। Templates में **Status Update** और **Resolution Notice** शामिल हैं।
- **Generate Private Note with AI** — इसके बजाय एक internal technical note बनाता है। Templates में **Investigation Update** और **Technical Analysis** शामिल हैं।

Button के पीछे, dashboard चुने गए template और `public` या `internal` के note type के साथ `/incident/generate-note-from-ai/{incidentId}` पर post करता है।

## Note templates

यदि आपकी team हर outage में वही तीन updates लिखती है, तो उन्हें एक बार save कर लें। दोनों note pages पर एक **Create from Template** button है जो एक **Select Note Template** dropdown के साथ **Create Note from Template** picker खोलता है।

Templates public और private notes के बीच साझा किए जाते हैं: एक ही template list दोनों की सेवा करती है, और वही template किसी भी तरह के note में insert किया जा सकता है।

आप इन्हें **Incidents → Settings → Note Templates** पर manage करते हैं — कार्ड का title **Public or Private Note Templates for Incidents** है और इसके form में body के लिए एक **Template Info** step (**Template Name** और **Template Description**, दोनों आवश्यक) और एक **Note Details** step है। यदि आप कोई भी बनाने से पहले **Create from Template** क्लिक करते हैं, तो OneUptime बताता है कि अभी कोई मौजूद नहीं है; ध्यान दें कि message Project Settings की ओर इशारा करता है, लेकिन page वास्तव में **Incidents → Settings → Note Templates** के अंतर्गत रहता है।

## Slack या Microsoft Teams से notes post करना

यदि आपने कोई workspace connect किया है, तो responders को channel छोड़ने की ज़रूरत नहीं। Slack और Microsoft Teams दोनों एक add-note action offer करते हैं जो एक dropdown वाला modal खोलता है जिसमें **Public Note** या **Private Note** के साथ एक text box होता है, और result को सीधे incident पर लिख देता है।

जानने लायक दो बातें:

- **Duplicate protection** — हर note उस Slack message को record करता है जिससे यह आया (`postedFromSlackMessageId`, फॉर्मेट `channel_id:message_ts`), इसलिए एक ही message पर कई लोगों के react करने से एक note बनता है, पांच नहीं।
- **Notes echo back होते हैं** — दोनों तरह का note post करना connected incident channel में भी एक message push करता है, क्योंकि note के feed item को workspace notification enabled के साथ बनाया जाता है।

## Public note वास्तव में subscribers तक कब पहुंचता है

**Notify Status Page Subscribers** on रखकर public note बनाना अपने आप email जाने की गारंटी नहीं देता। Note को checks की एक श्रृंखला पार करनी होती है, और हर failure error देने के बजाय एक विशिष्ट कारण record करती है:

1. **Notify Status Page Subscribers** on होना चाहिए। यदि नहीं, तो note बनते ही skipped stamp हो जाता है।
2. Note उस incident से संबंधित होना चाहिए जो अभी भी मौजूद है।
3. Incident से कम से कम एक monitor जुड़ा होना चाहिए — बिना किसी monitors के note को route करने के लिए कोई status page resource नहीं है।
4. Incident का **Visible on Status Page** flag (`isVisibleOnStatusPage`) true होना चाहिए।
5. जिस भी status page तक incident पहुंचता है, उस हर status page पर **Show Incidents** (`showIncidentsOnStatusPage`) on होना चाहिए।
6. हर subscriber को अपनी preferences पास करनी होंगी — unsubscribed नहीं, और इस resource के लिए और `Incident` event type के लिए subscribed, जहाँ page subscribers को चुनने देता है।

**Notifications तुरंत नहीं होतीं।** इन्हें भेजने वाली job मिनट में एक बार चलती है, इसलिए note save करने और mail भेजे जाने के बीच लगभग एक मिनट तक की उम्मीद रखें। यही **Sending Soon** label का मतलब है।

**Subscriber Notification Status** column पूरी यात्रा को track करता है:

| Status                       | इसका क्या मतलब है                                       |
| ----------------------------- | -------------------------------------------------------- |
| **Notifications skipped.**   | ऊपर के gates में से कोई एक बंद हुआ। कारण record किया गया है। |
| **Sending Soon**             | Queued, send job के अगले run की प्रतीक्षा में।            |
| **Notifications Being Sent** | Job subscriber list के जरिए काम कर रही है।                |
| **Notifications Sent**       | हर subscriber notification भेजी जा चुकी है।               |
| **Failed**                   | Job में error आई; error note के साथ संग्रहित है।          |

Status पर **more details** क्लिक करके **Notification Status Details** खोलें। जहाँ resend करना उचित हो, उस modal का button **Retry** है, जो note को वापस pending state में डाल देता है ताकि अगला run इसे फिर उठाए।

Subscribers को मिलने वाला वास्तविक message प्रति status page और प्रति channel templated होता है — email, SMS, Slack और Microsoft Teams में से हर एक के पास **Subscriber Incident Note Created** event के लिए अपना template है, जिसमें status page name और URL, details link, प्रभावित resources, incident severity और title, note body, और प्रति-subscriber unsubscribe link के variables होते हैं। इन templates और channels को कैसे configure किया जाता है, इसके लिए [सब्सक्राइबर और घोषणाएँ](/docs/status-pages/subscribers) देखें।

## Incident feed

**Incident Feed** कार्ड incident के **Overview** page पर left column के नीचे रहता है। यह incident की क्रमबद्ध कहानी है: हर item में एक icon, जिसने इसे किया उसका avatar और नाम, hover करने पर exact local time दिखाने वाला relative timestamp, और एक Markdown body होता है। Items सबसे पुराने से sort किए गए हैं।

कुछ items में अतिरिक्त detail होता है — उदाहरण के लिए, एक owner notification उन सभी की list देता है जिन्हें mail किया गया। ये एक **More Information** button दिखाते हैं जो एक **More Information** panel खोलता है।

Card header में एक **Actions** menu भी है ताकि आप timeline छोड़े बिना कार्य कर सकें:

- **Execute Runbook** — इस incident पर एक [runbook](/docs/runbooks/index) चलाना शुरू करें।
- **Execute On-Call Policy** — demand पर एक policy को page करें।
- **Add Public Note** — Public Notes page जैसे ही चार fields, एक modal में।
- **Add Private Note** — केवल note body और attachments।

इसके बगल में, **Refresh** feed को फिर से fetch करता है।

**Feed append-only है, और यह आपका audit log नहीं है।** API feed items बनाने और पढ़ने की अनुमति देता है पर update या delete करने की नहीं, इसलिए कोई भी चुपचाप किसी incident के इतिहास को फिर से नहीं लिख सकता। यह स्थायी भी नहीं है: billed installations पर, तीन साल से पुरानी feed rows हटा दी जाती हैं। किसने क्या बदला इसका स्थायी record पाने के लिए, incident side menu में **Audit → Audit Logs** का उपयोग करें।

## Feed क्या record करता है

Feed items incident service द्वारा खुद, दोनों note services द्वारा, state timeline द्वारा, owner और member changes द्वारा, rule engines द्वारा, on-call execution द्वारा, AI investigation और postmortem runners द्वारा, और notification cron jobs द्वारा लिखे जाते हैं। Event types में शामिल हैं:

- **खुद incident** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`।
- **Notes और write-ups** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`।
- **लोग** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`।
- **Notifications** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`।
- **Automation** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`।

हर type का अपना icon होता है, इसलिए आप एक लंबी feed को scan करके state changes को chatter से अलग पहचान सकते हैं। AI-generated root cause analysis को अलग से चिह्नित किया जाता है और एक restricted Markdown mode में render किया जाता है।

Feeds incident privacy का सम्मान करते हैं: private incidents के लिए, feed reads उसी तरह filter की जाती हैं जैसे incident खुद।

## Owners

Owners वे लोग और teams हैं जो किसी incident के लिए जिम्मेदार हैं। वे इसके साथ होने वाली हर चीज़ के notification target हैं — और यही कारण है कि जब हर कोई यह मान लेता है कि कोई और इस पर है, तो भी incident अनदेखी नहीं रहती।

Incident side menu में **Team → Owners** खोलें। **Owners** कार्ड एक count badge दिखाता है और owners को उन लोगों और teams के रूप में describe करता है जो इस incident के लिए जिम्मेदार हैं और बदलावों के बारे में notify किए जाते हैं, साथ में "2 people · 1 team" जैसी चलती count के साथ। Owners overlapping avatars के रूप में render होते हैं; किसी पर hover करने से व्यक्ति का email दिखता है या entry को **Team** के रूप में चिह्नित किया जाता है।

- Search box वाला picker खोलने के लिए **Add owner** क्लिक करें, लोगों या teams के लिए।
- किसी avatar पर remove control क्लिक करने से **Remove owner** confirmation खुलता है, फिर **Remove**।
- अभी तक कोई owner न होने पर, कार्ड यह बता देता है और आपको किसी teammate या team को जोड़ने के लिए आमंत्रित करता है ताकि उन्हें बदलावों के बारे में notify किया जा सके।

Owner users और owner teams अलग-अलग records हैं — किसी team को जोड़ने से उस team का हर member notification purposes के लिए एक owner बन जाता है, बिना उन्हें अलग-अलग list किए।

## Owners कैसे assign होते हैं

Owners list पर पहुंचने के चार तरीके हैं:

- **किसी incident template से** — templates में **Owner - Teams** और **Owner - Users** fields होते हैं, जिन्हें उन teams और users के रूप में describe किया जाता है जो incident के owner हैं और इसके बनने या update होने पर notify किए जाएंगे। Template से incident बनाना इन्हें prefill कर देता है। [घटना घोषित करना](/docs/incidents/declaring-incidents) देखें।
- **Incident Owner Rules से** — matching rules creation time पर अपने आप owners जोड़ देते हैं।
- **API के जरिए creation पर** — create call के साथ पास किए गए owner users और teams तुरंत जोड़ दिए जाते हैं, एक flag के साथ जो नियंत्रित करता है कि उन्हें "you were added" email मिलेगा या नहीं।
- **हाथ से** — incident के दौरान किसी भी समय **Owners** page पर **Add owner** control।

एक ही व्यक्ति को दो बार जोड़ना safe है; पहले से assigned owners duplicate नहीं होते।

## Incident owner rules

**Incident Owner Rules** matching incidents के बनने पर owner users और teams को अपने आप assign करते हैं — यही routing layer है जिसकी वजह से database incident बिना किसी के सोचे database team पर पहुंच जाती है। ये [Incident Settings & Automation](/docs/incidents/settings) में बाकी incident automation के साथ मिलेंगे।

Rule form में तीन steps हैं — **Basic Info**, **Match Criteria** और **Owners** — और owners step में दो sections हैं:

- **Owners to Assign** — **Owner Teams** और **Owner Users** चुनें। जब rule match करता है, तो चुना गया हर user और team owner के रूप में जोड़ा जाता है, और पहले से assigned owners duplicate नहीं होते।
- **Inherit Owners** — owners को नाम देने के बजाय related entities से assign करें। **Inherit Owners From Monitors** incident के monitors के हर owner को incident का owner बना देता है, और **Inherit Owners From Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** और **… From Services** उन resources के लिए भी वही करते हैं।

एक **Notify Owners** toggle नियंत्रित करता है कि लोगों को पता चले या नहीं। असल routing के लिए इसे on रखें; चुपचाप owners जोड़ने के लिए इसे off करें — यह तब उपयोगी है जब कोई rule page करने के बजाय एक bookkeeping सुविधा हो।

हर rule execution incident feed में लिखा जाता है, इसलिए आप हमेशा बता सकते हैं कि किसी व्यक्ति को rule ने जोड़ा या किसी इंसान ने।

## Owners को किस बारे में notify किया जाता है

पांच jobs owners को notify करते हैं, हर एक मिनट में एक बार चलती है:

- **Incident created** — subject `[New Incident {number}] - {title}`।
- **कोई note post हुआ** — public *और* private दोनों notes के लिए, subject `[Update Incident {number}] - {title}`।
- **Incident की state बदली** — देखें [Incident States & Severities](/docs/incidents/states-and-severities)।
- **आपको owner के रूप में जोड़ा गया** — subject `You have been added as the owner of Incident {number} - {title}`।
- **अभी भी unresolved** — incident के next-reminder time द्वारा driven एक reminder, subject `[Reminder] Incident {number} is still {state} - {title}`।

हर notification email, SMS, voice call, push और WhatsApp के लिए बनाई जाती है और user की notification settings को सौंपी जाती है, जो तय करती हैं कि वास्तव में क्या भेजा जाए। हर receiver इनमें से हर एक को अलग-अलग off कर सकता है — per-user settings को incident created, note posted, state changed, owner added, member assigned, और still-open reminder notifications भेजने के रूप में लिखा गया है। जो कोई भी केवल state changes के लिए call चाहता है, उसे बिल्कुल वही मिल सकता है।

**Ownerless incidents चुप नहीं रहतीं।** यदि किसी incident के पास बिल्कुल कोई owner नहीं है, तो notification jobs project के owners पर fallback कर जाती हैं, ताकि कुछ भी नज़रअंदाज न हो। Notify किए गए हर person को matching feed item में भी जोड़ा जाता है, ताकि आप बाद में ठीक-ठीक देख सकें कि किसे और किस address पर बताया गया था।

## आगे क्या पढ़ें

- [घटनाओं का अवलोकन](/docs/incidents/index) — incident क्या है और इसके हिस्से कैसे साथ फिट होते हैं।
- [घटना घोषित करना](/docs/incidents/declaring-incidents) — hand से, templates से, और monitors से incidents बनाना।
- [घटना स्थितियाँ और गंभीरता](/docs/incidents/states-and-severities) — वह state machine जो आधी feed को चलाती है।
- [घटना सेटिंग्स और स्वचालन](/docs/incidents/settings) — owner rules, note templates, और बाकी automation।
- [सब्सक्राइबर और घोषणाएँ](/docs/status-pages/subscribers) — public notes कहाँ पहुंचते हैं और उन्हें कौन receive करता है।
- [स्थिति पृष्ठ अवलोकन](/docs/status-pages/index) — किसी incident का customer-facing हिस्सा।
