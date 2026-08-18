# Settings & Automation

Incident configuration Project Settings में नहीं रहती। यह Incidents product area के भीतर ही रहती है, **Incidents → Settings** और **Incidents → Rules** के अंतर्गत, `/dashboard/{projectId}/incidents/settings/` से शुरू होने वाले routes पर। यदि आप incident templates या custom fields के लिए **Project Settings** में ढूंढ रहे थे, तो यही कारण है कि आपको वे नहीं मिले।

Incidents side menu के **Rules** और **Settings** दोनों सेक्शन डिफ़ॉल्ट रूप से collapsed रहते हैं, इसलिए नीचे दिए गए items दिखने से पहले आपको उन्हें expand करना होगा। यहाँ सब कुछ project-scoped है: templates, roles, custom fields और rules एक project से संबंधित हैं और उसमें declare की गई हर incident पर लागू होते हैं।

यह पेज उस configuration के लिए reference है — हर पेज में क्या होता है, और उसमें से क्या incident बनते ही अपने आप चलता है।

## Incident settings कहाँ रहती हैं

बाईं navigation में **Incidents** खोलें, फिर side menu के नीचे **Settings** को expand करें।

| Page                     | आप वहाँ क्या करते हैं                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| **Incident State**       | उन states को जोड़ें, नाम बदलें, रंग बदलें और क्रम बदलें जिनसे होकर एक incident गुजरती है।                       |
| **Incident Severity**    | Severity levels जोड़ें, नाम बदलें, रंग बदलें और क्रम बदलें।                                            |
| **Incident Templates**   | पूरी incident को पहले से भरें — title, description, resources, on-call policies, owners, labels। |
| **Note Templates**       | Public और private notes के लिए reusable text।                                                  |
| **Postmortem Templates** | Reusable postmortem structures।                                                              |
| **Custom Fields**        | ऐसे extra fields परिभाषित करें जो हर incident पर दिखाई दें।                                           |
| **Incident Roles**       | वे roles परिभाषित करें जिन्हें आप responders को असाइन करते हैं, जैसे Incident Commander।                     |
| **More Settings**        | Incident और incident episode number prefixes।                                                |

**Incident State** और **Incident Severity** को [Incident States & Severities](/docs/incidents/states-and-severities) में विस्तार से बताया गया है — इस पेज का बाकी हिस्सा **Incident Templates** से शुरू होता है।

**Rules** को expand करें और आपको आठ और पेज मिलते हैं: **Grouping Rules**, **On-Call Rules**, **Owner Rules**, **Runbook Rules**, **Privacy Rules**, **Label Rules**, **SLA Rules** और **Reminder Rules**। इन्हें आगे कवर किया गया है।

## Incident templates

एक incident template एक saved incident का ढांचा है। हर बार जब payments cluster डगमगाता है तो वही title, वही monitor list और वही on-call policy दोबारा टाइप करने के बजाय, आप इसे एक बार save करते हैं और उससे declare करते हैं।

**Incidents → Settings → Incident Templates** (`/dashboard/{projectId}/incidents/settings/templates`) पर जाएं। Card का शीर्षक **Incident Templates** है। एक template बनाना आपको छह-चरणों वाले wizard से गुजारता है:

- **Template Info** — **Template Name** और **Template Description**। ये template को ही नाम देते हैं; ये incident पर कभी नहीं दिखते।
- **Incident Details** — **Title**, **Description** (Markdown), **Incident Severity** और **Initial Incident State**। **Initial Incident State** वैकल्पिक है और खाली शुरू होता है; इसके options state क्रम में सूचीबद्ध हैं। इसे खाली छोड़ें और इस template से बनी incidents project की created state में जाएंगी।
- **Resources Affected** — वे monitors, hosts, clusters और services जिनसे incident को जोड़ा जाना चाहिए, साथ ही **Change Monitor Status to**।
- **On-Call** — **On-Call Policy**, वे policies जो इस template से declare की गई incident बनने पर execute होती हैं।
- **Owners** — **Owner - Teams** और **Owner - Users**।
- **Labels** — **Labels**।

कुछ त्वरित नियम:

- Template list केवल **Name** और **Description** दिखाती है। Rows list से edit या delete नहीं की जा सकतीं — इसे बदलने के लिए एक template (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) खोलें।
- Templates JSON import और export को सपोर्ट करते हैं, ताकि आप एक को projects के बीच move कर सकें।
- Empty state में "No incident templates found." लिखा होता है।

### एक template कैसे apply होता है

इसके दो रास्ते हैं, और दोनों एक जैसा व्यवहार करते हैं।

- **Dashboard से** — incidents list पर **Create from Template** बटन एक **Select Incident Template** picker खोलता है, और declare page `incidentTemplateId` query string parameter से template पढ़ता है, फिर form को template के साथ-साथ उसकी owner teams और owner users से पहले से भर देता है।
- **API से** — `POST /api/incident` पर `createdIncidentTemplateId` पास करें और server template से incident को भर देता है।

महत्वपूर्ण हिस्सा merge rule है: **एक template केवल उसी field को भरता है जिसे आपने undefined छोड़ा हो**। Title, description, incident severity, initial incident state, **Change Monitor Status to** के पीछे की monitor status, monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts, services, on-call policies और labels template से तभी copy होते हैं जब caller या form ने कुछ नहीं दिया हो। जो कुछ भी आप स्पष्ट रूप से सेट करते हैं वह हमेशा जीतता है।

**Empty-state dialog गलत जगह इशारा करता है।** यदि आपके पास अभी तक कोई templates नहीं हैं, तो **Create from Template** बटन एक **No Incident Templates** dialog दिखाता है। इसका text Project Settings की ओर इशारा करता है, लेकिन बटन **Incidents → Settings → Incident Templates** पर route करता है — यही असली जगह है।

## Note templates

Note templates responders को incident updates के लिए तैयार text देते हैं, ताकि सुबह 3 बजे status page update आधी नींद में किसी के द्वारा शुरू से न लिखा जाए।

**Incidents → Settings → Note Templates** (`/dashboard/{projectId}/incidents/settings/note-templates`) पर जाएं। Card का शीर्षक **Public or Private Note Templates for Incidents** है — एक ही library दोनों note types की सेवा करती है। Create form में दो चरण हैं:

- **Template Info** — **Template Name** और **Template Description**, दोनों आवश्यक।
- **Note Details** — note body खुद, Markdown में, आवश्यक।

Incident templates की तरह ही, rows inline edit होने के बजाय बनाई और देखी जाती हैं; इसे बदलने के लिए एक template खोलें।

Note templates वहीं दिखते हैं जहाँ आपको वास्तव में उनकी जरूरत होती है: **Acknowledge Incident** और **Resolve Incident** confirmation dialogs दोनों **Public Note** field के बगल में **Select Note Template** प्रस्तुत करते हैं। Public और private notes कैसे अलग हैं, इसके लिए [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) देखें।

## Postmortem templates

एक postmortem template उस write-up का ढांचा है जो आप किसी incident के बाद तैयार करते हैं — आपकी headings, आपके prompts, आपके स्थायी सवाल — ताकि project में हर review एक जैसे आकार का हो।

**Incidents → Settings → Postmortem Templates** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`) पर जाएं। Card का शीर्षक **Postmortem Templates** है। Create form में दो चरण हैं:

- **Template Info** — **Template Name** और **Template Description**, दोनों आवश्यक।
- **Postmortem Details** — **Postmortem Template**, यानी body खुद, Markdown में, आवश्यक।

आप इसे settings से नहीं बल्कि incident से apply करते हैं। एक incident खोलें, उसके side menu में **Postmortem** चुनें (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`), और **Apply Template** का उपयोग करें। इससे एक **Select Template** dropdown वाला **Apply Postmortem Template** dialog खुलता है; एक चुनने पर template body **Postmortem Note** editor में लोड हो जाता है, जहाँ आप save करने से पहले इसे edit करते हैं। Incident episodes का भी वही **Postmortem** page है और वही template library इस्तेमाल करते हैं।

## Custom fields

Custom fields आपको हर incident पर अपना खुद का metadata रखने देते हैं — एक internal service name, एक change ticket reference, एक customer tier।

**Incidents → Settings → Custom Fields** (`/dashboard/{projectId}/incidents/settings/custom-fields`) पर जाएं। पेज का शीर्षक **Incident Custom Fields** है। हर definition में होता है:

- **Field Name** — आवश्यक, कम से कम दो characters। Placeholder `internal-service` जैसा slug-like नाम सुझाता है।
- **Field Description** — वैकल्पिक।
- **Field Type** — आवश्यक। यह चुनता है कि data कैसे enter किया जाता है। Dropdown types के लिए उनके options भी सूचीबद्ध होने चाहिए।
- **Dropdown Options** — dropdown में दिखने वाले values, हर एक के साथ एक वैकल्पिक रंग।

Definitions अपने खुद के model में रहती हैं; values incident पर ही `customFields` column में रहती हैं। किसी एक incident पर आप उन्हें incident side menu के **Custom Fields** (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`) से भरते हैं।

**जानने लायक एक कमी।** Incident custom field definitions incident family का इकलौता हिस्सा है जिसमें कोई workflow trigger नहीं है — नीचे workflow सेक्शन देखें।

## Incident roles

Incident roles वे नामित काम हैं जिन्हें आप response के दौरान लोगों को असाइन करते हैं। इन्हें **Incidents → Settings → Incident Roles** (`/dashboard/{projectId}/incidents/settings/roles`) पर परिभाषित करें; card का description उदाहरण के रूप में Incident Commander और Responder देता है।

Roles केवल definitions हैं। आप लोगों को प्रति incident इन्हें असाइन करते हैं — declare wizard में **Assign Incident Roles** field वाला एक **Incident Roles** चरण होता है, और हर incident के side menu में एक **Roles** page होता है।

## Number prefixes

हर incident को एक number मिलता है। डिफ़ॉल्ट रूप से यह `#42` के रूप में दिखता है। अगर आपकी team "INC-42" बोलती है, तो product को भी वही बोलने दें।

**Incidents → Settings → More Settings** (`/dashboard/{projectId}/incidents/settings/more`) पर जाएं। Card **Number Prefix** है और project पर दो fields रखता है:

- **Incident Number Prefix** — अधिकतम 20 characters, placeholder `INC-`। इसे सेट करें और incident `#42`, `INC-42` के रूप में दिखेगी।
- **Incident Episode Number Prefix** — incident episode numbers के लिए वही विचार, placeholder `IE-`।

डिफ़ॉल्ट `#` prefix रखने के लिए किसी भी field को खाली छोड़ें; unset field `# (default)` दिखाता है। **Update** से save करें। Prefixed value incident पर `incidentNumberWithPrefix` के रूप में stored होती है, जिसे incidents list और incident header render करते हैं।

## जो नियम incident बनने पर चलते हैं

**Incidents → Rules** में आठ rule engines हैं। ये सभी एक जैसा काम करते हैं — incident बनते ही उसे देखते हैं, और मेल खाने पर action लेते हैं — लेकिन ये अलग-अलग करते हैं और मेल खाने वाले कई rules कैसे resolve होते हैं इसमें भी अलग हैं।

- **Grouping Rules** — related incidents को episodes में group करते हैं। Rules priority order में evaluate होते हैं; कम priority numbers पहले जाते हैं।
- **On-Call Rules** — मेल खाने वाली incidents के लिए on-call duty policies execute करते हैं। नीचे विस्तार से कवर किया गया है।
- **Owner Rules** — automatically owners असाइन करते हैं।
- **Runbook Rules** — incident मेल खाने पर एक [runbook](/docs/runbooks/index) शुरू करते हैं।
- **Privacy Rules** — तय करते हैं कि मेल खाने वाली incident private है या नहीं।
- **Label Rules** — automatically labels लागू करते हैं।
- **SLA Rules** — response और resolution times track करते हैं। Rules क्रम में evaluate होते हैं; कम order numbers पहले जाते हैं।
- **Reminder Rules** — incident के खुले रहते हुए समय-समय पर incident owners को याद दिलाते हैं। Rules क्रम में evaluate होते हैं और पहला मेल खाने वाला rule जीतता है।

**Order semantics एक जैसे नहीं हैं।** Grouping Rules, SLA Rules और Reminder Rules order-evaluated हैं। On-Call Rules ऐसे नहीं हैं — मेल खाने वाला हर rule चलता है। यह न मान लें कि एक model सभी आठ पर लागू होता है।

**On-Call Rules**, **Owner Rules**, **Label Rules** और **Privacy Rules** पेज tabbed हैं — एक **Incident Rules** tab और एक **Episode Rules** tab, हर एक की अपनी table के साथ। जब तक आप specifically episodes का मतलब न रखें, **Incident Rules** tab को configure करें। **Grouping Rules**, **Runbook Rules**, **SLA Rules** और **Reminder Rules** single tables हैं।

## Incident on-call rules

**Incidents → Rules → On-Call Rules** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) वह जगह है जहाँ आप paging को automatic बनाते हैं। Card, **Incident On-Call Rules**, उन rules का वर्णन करता है जो मेल खाने वाली incidents बनने पर automatically on-call duty policies execute करते हैं। पेज में दो tabs हैं: **Incident Rules** और **Episode Rules**।

Create form में तीन चरण हैं:

- **Basic Info** — **Name** (placeholder किसी DB incident के लिए database team को page करने जैसा कुछ सुझाता है), **Description**, और एक **Enabled** toggle। List हर rule के लिए एक हरा **Enabled** या लाल **Disabled** pill render करती है।
- **Match Criteria** — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels**, साथ ही incident title, incident description, monitor name और monitor description के लिए case-insensitive regular expression fields।
- **On-Call Policies** — वे policies जो यह rule execute करता है।

### मेल कैसे resolve होता है

पेज के साथ आने वाले नियम खुद जानने लायक हैं:

- कोई rule तभी मेल खाता है जब आपके भरे हुए **सभी** criteria pass हों। जिन criteria को आपने खाली छोड़ा है वे skip होते हैं, fail नहीं।
- एक single list criterion के भीतर — **Monitors**, **Incident Severities**, **Incident Labels**, **Monitor Labels** — matching any-of है।
- Pattern fields case-insensitive regular expressions हैं।
- **मेल खाने वाले सभी rules चलते हैं।** कोई priority नहीं है और कोई short-circuit नहीं है।
- जो policies वास्तव में execute होती हैं वह हर मेल खाने वाले rule की policies का union है, साथ ही manually या किसी template द्वारा incident से जुड़ी कोई भी policy, deduplicated ताकि हर policy अधिकतम एक बार चले।

Severity यहाँ match criterion है और कहीं और नहीं। किसी incident severity पर कोई on-call field नहीं है — "Critical Incident" चुनने से अपने आप किसी को page नहीं किया जाता। यदि आप चाहते हैं कि severity paging चलाए, तो एक on-call rule लिखें जो उस पर मेल खाता हो।

## On-call policies सीधे जोड़ना

Rules ही एकमात्र रास्ता नहीं हैं। हर incident की अपनी on-call policy list होती है, जो declare wizard के **On-Call** चरण और incident template के **On-Call** चरण पर **On-Call Policy** field के रूप में दिखती है। Field का description इसे साफ-साफ कहता है: ये वे on-call duty policies हैं जो इस incident के बनने पर execute होती हैं।

जब कोई incident बनती है, OneUptime पहले label rules, फिर on-call rules (जो अपनी मेल खाने वाली policies को incident की list में merge करते हैं), फिर runbook rules चलाता है — और अगर resulting list खाली नहीं है, तो उसमें मौजूद हर policy execute होती है। Executions parallel में चलते हैं और स्वतंत्र रूप से settle होते हैं, इसलिए एक policy के fail होने से बाकी नहीं रुकतीं। हर execution incident के साथ tag की जाती है जिसने उसे trigger किया, और incident-created notification event type के साथ।

क्या हुआ यह देखने के लिए, incident खोलें और उसके side menu में **On-Call Executions** (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`) चुनें।

## Workflows से incidents चलाना

Incidents के लिए workflow triggers हाथ से नहीं लिखे गए हैं — OneUptime इन्हें data models से generate करता है, इसलिए incident-family के हर model को model के singular name से नामित **On Create X**, **On Update X** और **On Delete X** components मिलते हैं। मुख्य तीन हैं **On Create Incident**, **On Update Incident** और **On Delete Incident**, और ये `/dashboard/{projectId}/workflows` पर workflow component palette के **Incident** category में रहते हैं।

वही generation आपको configuration के लिए भी triggers देता है: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** और और भी बहुत कुछ। हर model को matching action components भी मिलते हैं — **Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** और उनके कई-row equivalents — इसलिए मिलते-जुलते नामों वाला एक trigger और एक action एक ही category में साथ-साथ रहते हैं। **On Create Incident** एक workflow शुरू करता है; **Create One Incident** एक खोलता है।

कुछ बातें जो इन्हें wire करते समय मायने रखती हैं:

- **On Update X** एक वैकल्पिक **Listen on** argument लेता है जो trigger को specific fields को छूने वाले updates तक सीमित करता है। किसी भी बदलाव पर चलने के लिए इसे खाली छोड़ें। अगर कोई update बिना यह record किए आता है कि कौन से fields बदले, तो filter skip हो जाता है और workflow फिर भी चलता है।
- **On Create X** और **On Update X** दोनों एक आवश्यक **Select Fields** argument लेते हैं; **On Delete X** कोई argument नहीं लेता।
- तीनों एक single **Success** out-port expose करते हैं, और हर एक एक ID argument स्वीकार करता है ताकि आप workflow को हाथ से किसी एक record के खिलाफ चला सकें।
- नाम model के singular name से आते हैं, उसके table name से नहीं — यही कारण है कि आपको table-shaped नामों की बजाय **On Create Incident Team Owner** और **On Create Incident User Owner** दिखते हैं।
- Incident custom field definitions के लिए कोई triggers नहीं हैं। यह model incident family का इकलौता सदस्य है जिसमें workflows disabled हैं।

बाकी workflow बनाने के लिए, [Authoring a Workflow](/docs/workflows/authoring) और [Variables](/docs/workflows/variables) देखें।

## आगे क्या पढ़ें

- [घटनाओं का अवलोकन](/docs/incidents/index) — incident feature एक साथ कैसे काम करता है।
- [घटना घोषित करना](/docs/incidents/declaring-incidents) — declare wizard, templates और API।
- [घटना स्थितियाँ और गंभीरता](/docs/incidents/states-and-severities) — state और severity settings pages और flags क्या करते हैं।
- [घटना नोट्स, स्वामी और फ़ीड](/docs/incidents/notes-owners-and-feed) — note templates कहाँ इस्तेमाल होते हैं।
- [सब्सक्राइबर और घोषणाएँ](/docs/status-pages/subscribers) — आपकी team के बाहर किसी incident के बारे में कौन सुनता है।
- [वर्कफ़्लो अवलोकन](/docs/workflows/index) — incident triggers के ऊपर automation।
- [Runbook का अवलोकन](/docs/runbooks/index) — वे procedures जिन्हें runbook rules जोड़ते हैं।
