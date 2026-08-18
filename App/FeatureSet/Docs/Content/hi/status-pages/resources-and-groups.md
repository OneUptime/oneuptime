# संसाधन और समूह

एक resource आपके status page पर एक row है — एक monitor (या एक monitor group) जिसका नाम visitors समझ सकें, एक current status, और वैकल्पिक रूप से एक uptime number और एक history chart। एक group एक section है जो resources को होल्ड करता है, ताकि चालीस monitors वाला page एक अंतहीन list के बजाय "API", "Web app" और "Data pipeline" जैसा दिखे।

आप दोनों को एक ही screen पर बनाते हैं। कोई status page खोलें और side menu में **संसाधन** चुनें (जिन projects में monitor groups enabled नहीं हैं, वहाँ यह item **मॉनिटर** पढ़ता है)। Groups पहले अपने खुद के page पर रहते थे; अब वे नहीं रहते, और पुराना `/groups` URL अब सीधे यहीं redirect होता है।

इस हिस्से को सही करें और status page का बाकी हिस्सा बस सजावट है। Visitors इन rows से "यह मेरी वजह से है या उनकी?" तय करते हैं, इसलिए उनके नाम वैसे रखें जैसे customers आपके product की बात करते हैं — **Checkout API**, न कि `prod-checkout-lb-healthcheck-us-east-1`।

## Resources screen

Screen दो हिस्सों में बंटी है। बाईं ओर एक navigator है जो page पर मौजूद हर group की listing देता है; दाईं ओर आपने जो group चुना है उसकी contents हैं।

- **Group navigator (बाईं ओर)** — groups का एक tree, ऊपर एक search box (**Search groups...**) और नीचे एक running count के साथ, जैसे `3 groups · 12 resources`। जब page पर fit होने से ज़्यादा groups हों, तो एक **Show N more of M** button बाकी दिखाता है।
- **Top of page** — navigator की पहली row। इसमें वे resources होते हैं जो किसी group में नहीं हैं, और इसका tooltip बिल्कुल बताता है कि इसका क्या मतलब है: visitors इन्हें सबसे पहले देखते हैं, हर group के ऊपर। यदि page पर कोई group ही नहीं है, तो दायाँ pane इसके बजाय **All resources** शीर्षक रखता है।
- **Resource pane (दाईं ओर)** — जिस group को आपने चुना है उसके शीर्षक के साथ। इसके header में **Edit Group**, primary **Add Monitor** button, और एक **More actions** overflow होता है।

Card के header में ही दो buttons रहते हैं: **New Group**, और एक three-dot overflow जिसमें **Import groups from CSV** और **Refresh** होते हैं।

Card का description आपके page के आकार के साथ बदलता है। Groups के साथ, यह बताता है कि यही सब कुछ है जो visitors देखते हैं और बाईं ओर से कोई group चुनकर उसमें मौजूद चीज़ें edit करें। अभी तक कोई group न होने पर, यह आपको एक बनाने के लिए प्रेरित करता है ताकि एक लंबे page को sections में बाँटा जा सके।

**Empty states आपको बताते हैं कि क्या करना है।** एक खाली group **No monitors here yet** के साथ **Add Monitor**, **Add Multiple**, और — केवल तब जब status page पर बिल्कुल कोई group न हो — **Create a Group** दिखाता है। एक search जो कुछ match नहीं करती वह **No resources match your search** दिखाती है। एक खाली navigator कहता है कि groups एक लंबे status page को sections में बाँटते हैं और उन्हें nest भी किया जा सकता है।

## एक monitor जोड़ना

वह group चुनें जिसमें आप resource रखना चाहते हैं (या एक ungrouped row के लिए **Top of page**), फिर **Add Monitor** पर क्लिक करें। Modal का शीर्षक **Add a monitor to {group}** है और इसमें दो steps हैं: **Monitor Details** और **Advanced**।

**Monitor Details** पर:

- **Monitor** — आपके project के monitors का dropdown, placeholder **Select Monitor**। आवश्यक।
- **Display Name** — आवश्यक। यह वह text है जिसे visitors पढ़ते हैं, और यह monitor के अपने नाम से अलग store होता है, इसलिए आप monitoring को छुए बिना इसे यहाँ rename कर सकते हैं।
- **Description** — वैकल्पिक markdown जो row के नीचे दिखता है। यह बताने के लिए अच्छा है कि service असल में क्या करती है।

अगर आपके project में monitor groups enabled हैं, तो dropdown के नीचे एक link **Add a Monitor Group instead.** पढ़ता है — इस पर क्लिक करें और **Monitor** dropdown की जगह एक **Monitor Group** dropdown (**Select Monitor Group**) आ जाता है। फिर link पलटकर **Add a Monitor instead.** हो जाता है ताकि आप वापस जा सकें। एक monitor group का उपयोग तब करें जब आप चाहते हों कि page पर एक row कई checks को एक साथ मिलाकर represent करे।

### एक साथ कई जोड़ना

**Add Multiple** (**More actions** menu में भी **Add multiple monitors** के रूप में) **Add Multiple Monitors** खोलता है। इसमें वही दो steps हैं, पर पहला step एक single dropdown के बजाय एक **Monitors** multi-select है, और **Advanced** पर आप जो display options चुनते हैं वे आपके चुने हर monitor पर लागू होते हैं। एक नया page seed करने का यह सबसे तेज़ तरीका है।

## किसी resource पर display options

**Advanced** step single-add form और bulk modal दोनों पर एक जैसा है। यहाँ सब कुछ per-resource है — एक ही group की दो rows को अलग-अलग तरह से configure किया जा सकता है।

| Field                                                     | उद्देश्य                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Tooltip** (`displayTooltip`)                              | आपके status page पर resource के बगल में दिखने वाला अतिरिक्त text। इसे scope के लिए इस्तेमाल करें: "US and EU customers"। |
| **Show Current Resource Status** (`showCurrentStatus`)      | डिफ़ॉल्ट रूप से on। row के बगल में live status दिखाता है — operational, degraded, offline।          |
| **Show Uptime %** (`showUptimePercent`)                     | डिफ़ॉल्ट रूप से off। resource के बगल में एक uptime percentage दिखाता है।                            |
| **Select Uptime Precision** (`uptimePercentPrecision`)      | केवल **Show Uptime %** on होने पर दिखता है। आवश्यक, डिफ़ॉल्ट रूप से एक decimal।                     |
| **Show Status History Chart** (`showStatusHistoryChart`)    | डिफ़ॉल्ट रूप से on। resource के लिए day-by-day uptime history bar chart दिखाता है।                |

पहले step से **Display Name** (`displayName`) और **Description** (`displayDescription`) भी सिर्फ display के लिए हैं — वे कभी monitor को खुद नहीं बदलते।

## Uptime percentages और history charts

**Show Uptime %** और **Show Status History Chart** दोनों एक ऐसी setting पर निर्भर करते हैं जो कहीं और रहती है। वे जिस window को cover करते हैं वह **Status Pages → आपका page → Advanced → Advanced Settings** के अंतर्गत, **Uptime History Settings** card में **Show Uptime History (in days)** है। यह 1 से 90 दिनों तक स्वीकार करता है और डिफ़ॉल्ट रूप से 90 है।

तो क्रम यह है: per resource toggles on करें, फिर पूरे page के लिए एक बार window सेट करें।

**Precision एक judgment call है।** **Select Uptime Precision** dropdown `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` और `99.999% (Three Decimal)` देता है। ज़्यादा decimals precise लगते हैं और तीसरे वाले पर बहस को न्योता देते हैं; अगर आप three nines पर एक SLA publish करते हैं, तो उतना ही match करें, ज़्यादा नहीं।

Groups के पास इन toggles की अपनी अलग copies हैं — नीचे देखें — इसलिए एक group एक rolled-up percentage दिखा सकता है जबकि उसके अंदर के individual monitors चुप रहें, या इसका उल्टा।

History chart की bars के रंग, और कौन-सी monitor statuses "down" गिनी जाती हैं, यह **Overview Page** branding screen पर सेट होता है, जिसे [स्थिति पृष्ठ ब्रांडिंग और डोमेन](/docs/status-pages/branding-and-domains) में कवर किया गया है।

## Groups

**New Group** पर क्लिक करके **Create New Status Page Group** खोलें। Form में तीन steps हैं: **Group Details**, **Layout** और **Advanced**।

**Group Details**:

- **Group Name** (`name`) — आवश्यक। यह वह section heading है जो visitors देखते हैं।
- **Group Description** (`description`) — वैकल्पिक markdown, heading के नीचे दिखता है।
- **Parent Group** (`parentStatusPageGroupId`) — वैकल्पिक। group को top level पर रखने के लिए इसे **No parent group (top level)** पर छोड़ दें।
- **Expand on Status Page by Default** (`isExpandedByDefault`) — क्या section visitors के लिए खुला शुरू होता है या collapsed।

**Advanced** group स्तर पर resource toggles को mirror करता है:

- **Show Current Group Status** (`showCurrentStatus`) — डिफ़ॉल्ट रूप से on। group heading के बगल में एक status दिखाता है।
- **Show Uptime %** (`showUptimePercent`) — डिफ़ॉल्ट रूप से off, on होने पर **Select Uptime Precision** दिखता है।

Editing उसी तरह काम करती है: pane header में **Edit Group**, या navigator की row menu में **Edit group**, **Edit Status Page Group** खोलता है जिसमें एक **Save Changes** button है।

Pane header उन settings के लिए chips दिखाता है जो अभी on हैं — **Grid**, **Collapsed by default**, **Uptime %** — ताकि आप form खोले बिना देख सकें कि group कैसे configure है।

### किसी group को manage करना

Navigator की per-row menu में **Edit group**, **Move up**, **Move down**, **Show ID** और **Delete group** होते हैं। Pane का **More actions** overflow इनके लंबे-form equivalents रखता है — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Refresh** और **Delete this group**। बिना नाम के save किया गया group **Untitled group** के रूप में render होता है, जो एक अच्छा संकेत है कि आप कुछ type करना चाहते थे।

## Groups को nest करना

Groups nest किए जा सकते हैं: child पर **Parent Group** सेट करें, या navigator के **Add a sub group inside this group** action का उपयोग करें। Form का अपना help text उस shape का वर्णन करता है जिसके लिए यह बना है — Corporate Units › Region › Market जैसा कुछ — और बताता है कि हर level अपने नीचे मौजूद हर चीज़ का rolled-up status और uptime दिखाता है।

जब किसी group के children होते हैं, तो resource pane एक **Sub groups** chip row दिखाता है जो सीधे हर child में link करता है, ताकि आप navigator पर वापस गए बिना hierarchy में चल सकें।

बड़े pages पर nesting अपनी कमाई कर लेती है: एक hosting provider जिसके products के अंदर regions हों, या एक retailer जिसके business units के अंदर markets हों। बारह monitors वाले page पर, एक flat level ज़्यादा दोस्ताना है।

## List layout बनाम grid layout

**Layout** step group के लिए **View Mode** (`viewMode`) सेट करता है, और यह तय करता है कि group publicly कैसे render होता है।

| अगर आप चाहते हैं…                                                   | चुनें                    |
| --------------------------------------------------------------------- | -------------------------- |
| services की एक साधारण vertical list दिखाना, एक row प्रति service    | **List** (डिफ़ॉल्ट)        |
| एक ही service को कई regions या tenants में एक matrix की तरह दिखाना  | **Grid**                   |

**Grid** चुनें और चार और fields दिखाई देते हैं:

- **Row Axis Label** — row dimension का नाम, placeholder `Service`।
- **Row Axis Values** — rows खुद, **Add Row** के साथ एक-एक करके जोड़ी जाती हैं (placeholder `e.g. Auth`)।
- **Column Axis Label** — column dimension, placeholder `Region`।
- **Column Axis Values** — **Add Column** के साथ जोड़ी जाती हैं (placeholder `e.g. US-East`)।

Grid group का हर monitor फिर एक cell में रखा जाता है, इसलिए bulk modal monitors के साथ-साथ row और column भी पूछता है, आपके अपने axis labels का उपयोग करते हुए।

**Monitors जोड़ने से पहले axes सेट करें।** बिना rows या columns वाला grid group एक amber notice दिखाता है जो कहता है कि axes बनने तक monitor रखने के लिए कहीं जगह नहीं है, साथ में एक **Set up the grid** button — और जब तक आप ऐसा नहीं करते, **Add Monitor** button वापस ले लिया जाता है।

## Visitors क्या देखते हैं, इसका order

Order स्पष्ट रूप से तय होता है, alphabetically नहीं, और इसे तीन जगहों पर सेट किया जाता है:

- **किसी group के अंदर के resources** — किसी row को drag करें। Pane यही कहता है: **Drag a row to change the order visitors see**।
- **एक-दूसरे के सापेक्ष groups** — navigator की row menu में **Move up** / **Move down**, या pane के overflow में **Move group up** / **Move group down**।
- **Ungrouped resources** — ये **Top of page** में रहते हैं और हमेशा हर group के ऊपर render होते हैं, इसलिए वह एक चीज़ जिसे हर कोई सबसे पहले check करता है, उसे वहाँ रखें।

**दो मामलों में dragging off होती है।** **Search in {group}...** box से pane filter करने पर reordering disable हो जाता है — pane आपको बताता है `N of M shown · drag to reorder is off while filtering`, इसलिए पहले search साफ़ करें। और grid groups कभी drag ordering support नहीं करते, क्योंकि position row और column axes से आती है।

अपनी सबसे ज़्यादा पूछी जाने वाली service को सबसे ऊपर रखें। जो visitors किसी outage के दौरान page पर आते हैं, वे आमतौर पर पहली screen के बाद पढ़ना बंद कर देते हैं।

## CSV से groups import करना

हाथ से एक गहरी hierarchy बनाना थकाऊ है। Card header का three-dot overflow **Import groups from CSV** रखता है, जो **Import Groups from CSV** modal खोलता है।

Flow यह है: `status-page-groups-template.csv` पाने के लिए **Download CSV Template**, इसे भरें, **Choose CSV File**, फिर कुछ भी लिखे जाने से पहले यह जाँचने के लिए कि क्या बनेगा, **Preview Import**। नतीजा **Groups Imported** और **Some Groups Could Not Be Imported** में बंटता है, ताकि एक गलत row चुपचाप गायब न हो जाए।

केवल `name` आवश्यक है। स्वीकृत columns ये हैं:

| Column                    | यह क्या सेट करता है                                    |
| --------------------------- | --------------------------------------------------------- |
| `name`                      | Group का नाम। आवश्यक।                                     |
| `parentName`                | उस group का नाम जिसके अंदर यह nest होता है।              |
| `description`               | Group का description।                                     |
| `isExpandedByDefault`       | क्या section visitors के लिए खुला शुरू होता है।           |
| `showCurrentStatus`         | क्या group heading के बगल में status दिखता है।            |
| `showUptimePercent`         | क्या group के बगल में uptime percentage दिखता है।         |
| `uptimePercentPrecision`    | वह percentage कितने decimal places इस्तेमाल करता है।     |
| `viewMode`                  | `List` या `Grid`।                                          |
| `rowAxisLabel`              | Grid group के लिए row dimension का नाम।                   |
| `rowAxisValues`             | Grid group के लिए row values।                              |
| `columnAxisLabel`           | Grid group के लिए column dimension का नाम।                |
| `columnAxisValues`          | Grid group के लिए column values।                           |

Import groups बनाता है, resources नहीं — बाद में **Add Monitor** या **Add Multiple** से monitors जोड़ें।

## आगे क्या पढ़ें

- [स्थिति पृष्ठ अवलोकन](/docs/status-pages/index) — status page क्या है और टुकड़े कैसे साथ फिट होते हैं।
- [स्थिति पृष्ठ ब्रांडिंग और डोमेन](/docs/status-pages/branding-and-domains) — logo, favicon, chart colors, और page को अपने खुद के domain पर रखना।
- [सब्सक्राइबर और घोषणाएँ](/docs/status-pages/subscribers) — जब ये resources बदलते हैं तो किसे बताया जाता है।
- [सार्वजनिक API](/docs/status-pages/public-api) — status page data को programmatically पढ़ना।
- [घटना स्थितियाँ और गंभीरता](/docs/incidents/states-and-severities) — page पर कोई incident कब दिखती है, और कब गायब होती है।
