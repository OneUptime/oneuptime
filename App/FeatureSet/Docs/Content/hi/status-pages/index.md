# Status Pages Overview

एक status page आप जो कुछ भी monitor करते हैं उसका public चेहरा है: एक URL जिसे आपके customers यह पूछने के लिए email करने के बजाय खोल सकते हैं कि क्या यह सिर्फ उनके साथ हो रहा है। यह उन services की current status दिखाता है जिन्हें आप expose करना चुनते हैं, वे incidents जिन पर आप काम कर रहे हैं, वह maintenance जिसकी आपने योजना बनाई है, और कोई भी announcement जिसे आप ऊपर pin करना चाहते हैं।

जब सुबह 2 बजे कुछ टूटता है, तो status page पहली चीज है जिससे आपकी support queue link करती है। यह वह चीज भी है जिससे आपके subscribers को notify किया जाता है — इसलिए इसे outage के दौरान नहीं, बल्कि पहले से set up कर लेना ही बेहतर है।

Status pages dashboard की बाईं navigation में **essentials** group के तहत **Status Pages** के नीचे रहते हैं। इस पेज पर सब कुछ per-status-page है: एक project इनमें से जितने चाहे चला सकता है — customers के लिए एक public, internal audience के लिए एक private, किसी specific market के लिए एक per-region।

## एक नज़र में

- **दो fields से बनता है।** एक नया status page सिर्फ **Name** और **Description** माँगता है। Resources, branding और domains सब बाद में configure होते हैं।
- **Resources वह हैं जो visitors देखते हैं।** पेज पर हर row एक **Status Page Resource** है — अपने display name, tooltip और uptime options के साथ एक monitor (या monitor group)। Groups एक लंबे पेज को sections में बाँटते हैं और nested हो सकते हैं।
- **पहले दिन से एक preview URL।** हर status page को एक preview link मिलता है ताकि custom domain बनने से पहले आप इसे देख सकें।
- **Visitor-facing routes settings से gated हैं।** Incidents, announcements, scheduled events और subscribe page — हर एक तभी दिखता है जब **Advanced Settings** पर उसका toggle on हो।
- **इसे private बनाने के तीन तरीके।** Private users, एक master password, या SAML SSO / OIDC — साथ ही एक IP whitelist।
- **Subscribers को अपने आप बताया जाता है।** Email, SMS, Slack, Microsoft Teams और webhook subscribers सभी किसी पेज को follow कर सकते हैं, हर channel अपने toggle के पीछे।

## प्रमुख शब्द

| शब्द              | इसका मतलब                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Status page**   | एक public (या private) पेज, अपनी branding, domains, resources और subscribers के साथ। `StatusPage` model।                    |
| **Resource**      | एक row जिसे visitors देखते हैं — एक monitor या monitor group जो display name और uptime options के साथ पेज पर दिखाया गया है।                      |
| **Group**         | resources रखने वाला एक नामित section। Groups दूसरे groups के भीतर nest होते हैं, और हर level नीचे मौजूद हर चीज की status को roll up करता है। |
| **Announcement**  | एक message जिसे आप एक या अधिक status pages पर post करते हैं, एक start time और एक वैकल्पिक end time के साथ।                                         |
| **Subscriber**    | कोई (या कुछ) जो पेज को email, SMS, Slack, Microsoft Teams या एक webhook पर follow कर रहा है।                                                  |
| **Custom domain** | आपका अपना domain — `status.example.com` — एक CNAME और एक SSL certificate के साथ पेज पर pointed।                                     |
| **Private user**  | एक account जो private status page में log in कर सकता है। आपके OneUptime project users से अलग।                                    |

## Status page बनाना

1. **Status Pages → All Status Pages** खोलें और **Create Status Page** पर click करें।
2. **Create New Status Page** modal में, **Name** (आवश्यक, कम से कम दो characters) भरें और, वैकल्पिक रूप से, **Description**।
3. **Create Status Page** पर click करें।

यही पूरा create form है। जिस list पर आप वापस आते हैं वह **Name**, **Description**, **Labels** और **Owners** दिखाती है, और इसे **Status Page ID**, **Name** और **Description** से filter किया जा सकता है।

नया पेज खोलें और आप इसके **Overview** screen पर पहुँचते हैं, जो दो cards रखता है: **Status Page Preview URL** जिसमें पेज का ही link होता है, और **Status Page Details** जहाँ आप अभी set किए गए name, description और labels edit कर सकते हैं।

आगे, उपयोगिता के मोटे क्रम में:

- पेज पर कुछ रखने के लिए resources जोड़ें — देखें [Status Page Resources & Groups](/docs/status-pages/resources-and-groups)।
- पेज का title, favicon, logo और cover set करें, फिर एक custom domain जोड़ें — देखें [Status Page Branding & Domains](/docs/status-pages/branding-and-domains)।
- तय करें कि लोग किन channels पर subscribe कर सकते हैं — देखें [Subscribers & Announcements](/docs/status-pages/subscribers)।
- **Advanced Settings** के तहत पेज पर क्या दिखता है उसे tune करें।

## सब कुछ कहाँ रहता है

एक बार status page खुल जाए, इसका अपना बायाँ side menu नौ sections में बँटा होता है। इसे इस documentation group के बाकी हिस्से के लिए एक map की तरह इस्तेमाल करें।

| Section               | इसमें क्या है                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic**             | **Overview**, **Announcements**, **Owners**।                                                                                                   |
| **Resources**         | एक single **Resources** screen — बाईं ओर groups, दाईं ओर चुने गए group के monitors।                                                |
| **Subscribers**       | **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers**, **Webhook Subscribers**, **Subscriber Settings**। |
| **Notification Logs** | **Notification Logs** — subscribers को क्या भेजा गया।                                                                                          |
| **Audit**             | **Audit Logs**।                                                                                                                                |
| **Branding**          | **Essential Branding**, **HTML, CSS & JavaScript**, **Custom Domains**, **Header**, **Footer**, **Overview Page**, **Languages**।              |
| **Security**          | **Private Users**, **SSO**, **OIDC**, **SCIM**, **Authentication Settings**।                                                                   |
| **AI**                | **MCP**।                                                                                                                                       |
| **Advanced**          | **Monitor Rules**, **Embedded Status**, **Reports**, **Custom Fields**, **Advanced Settings**, **Delete Status Page**।                         |

देखने से पहले जानने लायक दो naming quirks:

- **Resources** item केवल तभी **Resources** नाम से दिखता है जब project पर monitor groups enabled हों। नहीं तो यह **Monitors** पढ़ता है। दोनों ही स्थिति में यह एक ही screen है।
- कोई अलग Groups page नहीं है। Groups और resources को merge कर दिया गया है, और पुराना `/groups` route अब resources screen पर redirect करता है।

किसी individual पेज के बाहर, **Status Pages** section में खुद एक **More** section है जिसमें **Announcements** है, और एक collapsed **Settings** section जिसमें **Announcement Templates**, **Subscriber Templates**, **Custom Fields**, **Owner Rules** और **Label Rules** हैं — ये project-wide हैं, हर status page में साझा।

## Visitors क्या देखते हैं

Public पेज अपनी ही एक app है, जिसमें routes का एक छोटा सा set है:

- `/` — **Overview**।
- `/incidents` और `/incidents/:id` — incident list और एक single incident।
- `/announcements` और `/announcements/:id`।
- `/scheduled-events` और `/scheduled-events/:id`।
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`।
- `/rss` — feed।
- `/login`, `/sso` और `/master-password` — केवल private पेज पर relevant।

Top nav bar हमेशा **Overview** दिखाता है; बाकी केवल तभी दिखते हैं जब enabled हों। **Incidents**, **Announcements** और **Scheduled Events** में से हर एक को अपना toggle on चाहिए; **Subscribe** को **Show Subscriber Page** और कम से कम एक subscriber channel enabled दोनों चाहिए। एक private पेज को एक **Logout** item भी मिलता है।

### Overview page

Overview वह पेज है जिसे ज्यादातर visitors देखते हैं। ऊपर से नीचे यह render करता है:

1. **कोई भी live announcements** — वे announcements जिनका start time बीत चुका है और end time नहीं आया।
2. **एक overall status banner** — एक single line जो summarize करती है कि सभी resources प्रभावित हैं या केवल कुछ।
3. **एक overall uptime percent**, अगर आपने इसे on किया है। डिफ़ॉल्ट रूप से off।
4. **Resource groups**, हर एक अपने resources, उनकी current status, और उनके uptime history bars के साथ।
5. **Active Incidents**।
6. **Scheduled Maintenance Events**।

कुछ भी न होने वाला बिल्कुल नया पेज एक empty state दिखाता है जो आपको dashboard से resources जोड़ने के लिए कहता है — जो आपका संकेत है **Resources** screen पर जाने का।

सबसे पहले किस चीज से कोई incident इस पेज पर आती है, और फिर से क्या उसे हटाती है, इसके लिए [Incident States & Severities](/docs/incidents/states-and-severities) देखें।

## तय करना कि पेज पर क्या दिखे

ज्यादातर display switches एक ही जगह रहते हैं: **Status Pages → आपका पेज → Advanced → Advanced Settings**। हर card का अपना **Edit Settings** बटन है।

**Incident Settings**:

- **Show Incidents** (`showIncidentsOnStatusPage`) — डिफ़ॉल्ट रूप से on। इसे off करने से **Incidents** nav item भी हट जाता है।
- **Show Incident History (in days)** (`showIncidentHistoryInDays`) — incident list कितनी दूर पीछे तक जाती है। डिफ़ॉल्ट 14।
- **Show Incident Labels** (`showIncidentLabelsOnStatusPage`) — डिफ़ॉल्ट रूप से off।

**Episode Settings** — incident episodes के लिए वही तीन switches: **Show Episodes** (`showEpisodesOnStatusPage`, डिफ़ॉल्ट रूप से on), **Show Episode History (in days)** (डिफ़ॉल्ट 14), और **Show Episode Labels** (डिफ़ॉल्ट रूप से off)। Episodes अपना खुद का model है अपने खुद के endpoints के साथ, incidents का view नहीं।

**Announcement Settings**:

- **Show Announcements** (`showAnnouncementsOnStatusPage`) — डिफ़ॉल्ट रूप से on।
- **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`) — डिफ़ॉल्ट 14।

**Scheduled Event Settings**:

- **Show Scheduled Maintenance Events** (`showScheduledMaintenanceEventsOnStatusPage`) — डिफ़ॉल्ट रूप से on।
- **Show Scheduled Event History (in days)** (`showScheduledEventHistoryInDays`) — डिफ़ॉल्ट 14।
- **Show Event Labels** (`showScheduledEventLabelsOnStatusPage`) — डिफ़ॉल्ट रूप से off।

**Uptime History Settings**:

- **Show Uptime History (in days)** (`showUptimeHistoryInDays`) — हर resource के बगल में uptime bar की लंबाई। डिफ़ॉल्ट 90 और 1 से 90 के बीच होना चाहिए। किसी resource या group पर हर **Show Uptime %** और **Show Status History Chart** option इसी संख्या को पढ़ता है।

**Subscriber Settings**:

- **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) — डिफ़ॉल्ट रूप से on, साथ ही पाँच per-channel enable toggles। वही channel toggles **Subscribers** section के तहत dedicated **Subscriber Settings** screen पर भी दिखते हैं; उसे इन्हें set करने की canonical जगह मानें।

**Powered By OneUptime Branding**:

- **Hide Powered By OneUptime Branding** — डिफ़ॉल्ट रूप से off, इसलिए जब तक आप इसे on नहीं करते visitor footer "Powered by OneUptime" पढ़ता रहता है।

**रंग कहाँ हैं।** Uptime bar के रंग यहाँ नहीं हैं — **Default Bar Color**, bar-color rules, **Downtime Monitor Statuses** और **Show Overall Uptime Percent** सभी **Status Pages → आपका पेज → Branding → Overview Page** पर रहते हैं। कहीं भी कोई theme या brand-color setting नहीं है; उन controls से आगे कुछ भी **Custom CSS** से किया जाता है।

## Live जाने से पहले preview करना

हर status page का **Overview** screen एक **Status Page Preview URL** card रखता है जिसमें सीधे पेज का link होता है। इसका उपयोग तब करें जब आप अभी भी resources जोड़ रहे हों और किसी custom domain के बनने से पहले।

पर्दे के पीछे, हर public route का `/status-page/{statusPageId}/...` के तहत एक preview twin होता है — एक preview overview, एक preview incident list, एक preview subscribe page, वगैरह। इसका मतलब है कि dashboard preview से लिया गया URL या screenshot उससे मेल नहीं खाएगा जो customer एक बार custom domain जुड़ने के बाद देखता है, इसलिए किसी runbook या email में paste करने से पहले किसी भी link को दोबारा जाँच लें।

## पेज को कौन देख सकता है यह सीमित करना

हर status page public के लिए नहीं होता। सभी controls **Security** section के तहत रहते हैं।

### Private users

**Status Pages → आपका पेज → Security → Authentication Settings** (`isPublicStatusPage` column) पर **Is Visible to Public** को off करें। Visitors तब `/login` पर पहुँचते हैं और उन्हें sign in करना पड़ता है।

जो लोग sign in कर सकते हैं उन्हें **Status Pages → आपका पेज → Security → Private Users** पर जोड़ें। एक **Add in Bulk** action है — email addresses की एक list paste करें और हर एक को एक invitation email मिलता है। Private users का अपना forgot-password और reset-password flow है, आपके OneUptime project accounts से अलग।

### Master password

**Authentication Settings** में एक **Master Password** card भी है जिसमें एक **Require Master Password** toggle और password खुद है। Visitors तब `/master-password` पर जाते हैं और एक single shared secret से पेज unlock करते हैं।

**Master password और private users साथ में stack नहीं होते।** जब master password on हो, private-user authentication disabled रहता है, और **Private Users** screen एक banner दिखाती है जो आपको यह बताती है।

### SSO और OIDC

आपके identity provider से जुड़े एक private पेज के लिए, **Status Pages → आपका पेज → Security → SSO** SAML configure करता है (sign-on URL, issuer, x509 certificate, signature और digest methods) और **Status Pages → आपका पेज → Security → OIDC** OpenID Connect configure करता है (discovery URL, issuer, client ID और secret, scopes, claim names)। **SCIM** IdP से automatically private users provision करता है। ये एक plan feature के पीछे gated हैं, इसलिए ये हर installation पर उपलब्ध नहीं हो सकते।

एक **SSO Settings** card **Force SSO for Login** (`requireSsoForLogin`, डिफ़ॉल्ट रूप से off) expose करता है। इसे on करने से पहले अपनी SSO configuration test करें — अगर यह काम नहीं करती तो आप खुद को status page से बाहर lock कर लेंगे।

### IP whitelist

**Authentication Settings** में एक **IP Whitelist** card भी है, `ipWhitelist` column पर आधारित, उन पेजों के लिए जिन्हें केवल known networks से जवाब देना चाहिए।

## Embeddable badge और RSS feed

पेज के अलावा कहीं और status दिखाने के दो तरीके।

**Embedded status badge।** **Status Pages → आपका पेज → Advanced → Embedded Status** पर **Embedded Status Badge** card में **Enable Embedded Status Badge** (`enableEmbeddedOverallStatus`, डिफ़ॉल्ट रूप से off) on करें। यह एक `embeddedOverallStatusToken` के साथ जोड़ी बनाता है और `/badge/:statusPageId` से badge serve करता है, ताकि आप current overall status को अपने docs, अपनी app के footer या किसी marketing page में डाल सकें।

**RSS feed।** हर status page `/rss` serve करता है — "{status page name} Updates" शीर्षक वाला एक feed जिसके items `Incident: `, `Announcement: ` और `Scheduled Maintenance: ` से prefixed होते हैं। उन लोगों के लिए उपयोगी जो email से subscribe करने के बजाय आपके updates को किसी reader या chat bot में pipe करना पसंद करेंगे।

अगर आप खुद data खींचना चाहते हैं, तो status page overview, incidents, scheduled maintenance events, announcements और episodes के लिए public read endpoints के पीछे है — देखें [Public API](/docs/status-pages/public-api)।

## आगे क्या पढ़ें

- [स्थिति पृष्ठ संसाधन और समूह](/docs/status-pages/resources-and-groups) — monitors को पेज पर डालना और उन्हें sections में organize करना।
- [स्थिति पृष्ठ ब्रांडिंग और डोमेन](/docs/status-pages/branding-and-domains) — logo, favicon, footer, custom code, और अपना खुद का domain पेज पर pointed करना।
- [सब्सक्राइबर और घोषणाएँ](/docs/status-pages/subscribers) — पाँच subscriber channels, double opt-in, और announcements post करना।
- [सार्वजनिक API](/docs/status-pages/public-api) — status page data को programmatically पढ़ना।
- [घटनाओं का अवलोकन](/docs/incidents/index) — वे events जो पेज पर दिखाई देते हैं।
- [घटना स्थितियाँ और गंभीरता](/docs/incidents/states-and-severities) — क्या किसी incident को status page पर दिखाता है और क्या उसे फिर से हटाता है।
