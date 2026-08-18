# सब्सक्राइबर और घोषणाएँ

एक status page एक ऐसी जगह है जहाँ लोग जाते हैं। सब्सक्राइबर वे लोग हैं जो वहाँ बार-बार जाने के बजाय एक बार अपना email address, phone number, Slack webhook या HTTP endpoint आपको दे देते हैं, और उसके बाद आपके updates खुद उन तक पहुँच जाते हैं।

घोषणाएँ (Announcements) उसी काम का दूसरा हिस्सा हैं। कोई monitor आपके visitors को यह बता सकता है कि checkout 500s दे रहा है; लेकिन कोई भी monitor उन्हें यह नहीं बता सकता कि आप शनिवार को databases migrate कर रहे हैं, कि कोई third-party provider का दिन खराब चल रहा है, या कि कल पढ़ी गई incident अब पूरी तरह बंद हो चुकी है। घोषणाएँ उस सब कुछ के लिए free-text channel हैं जिसे आपके checks नहीं देख सकते, और वे उसी subscriber list तक पहुँचती हैं।

यह page दोनों को cover करता है: पाँच subscription channels और visitors कैसे sign up करते हैं, subscribers क्या-क्या सुनना चुन सकते हैं, double opt-in और unsubscribe flows, और घोषणाएँ कैसे लिखी, scheduled और templated की जाती हैं।

## Subscription channels

एक status page पाँच channels को support करता है, हर एक का status page पर अपना toggle होता है। **Status Pages → your page → Subscribers → Subscriber Settings** पर जाएँ:

- **Enable Email Subscribers** (`enableEmailSubscribers`) — डिफ़ॉल्ट रूप से on। बाकी सब तब तक off रहता है जब तक आप इसे on नहीं करते।
- **Enable SMS Subscribers** (`enableSmsSubscribers`) — डिफ़ॉल्ट रूप से off।
- **Enable Slack Subscribers** (`enableSlackSubscribers`) — डिफ़ॉल्ट रूप से off।
- **Enable Microsoft Teams Subscribers** (`enableMicrosoftTeamsSubscribers`) — डिफ़ॉल्ट रूप से off।
- **Enable Webhook Subscribers** (`enableWebhookSubscribers`) — डिफ़ॉल्ट रूप से off।

हर channel को status page के side menu में **Subscribers** के अंतर्गत अपनी अलग list भी मिलती है: **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers** और **Webhook Subscribers**। यहीं आप देखते हैं कि कौन sign up है, किसी को हाथ से add करते हैं, या किसी particular subscriber पर अपने लिए **Notes** (`internalNote`) entry छोड़ते हैं।

**सिर्फ एक toggle काफी नहीं है।** status page nav bar में **Subscribe** item तभी दिखता है जब **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) on हो *और* कम से कम एक channel enabled हो। अगर आप **Enable Email Subscribers** on करते हैं लेकिन **Show Subscriber Page** off छोड़ देते हैं, तो visitors के पास form तक पहुँचने का कोई रास्ता नहीं होता।

यही पाँचों toggles **Advanced Settings** पर मौजूद **Subscriber Settings** card के अंदर दूसरी बार दिखते हैं, **Show Subscriber Page** के साथ। नीचे से ये वही columns हैं — एक screen चुनें और उसी पर टिके रहें, और dedicated **Subscriber Settings** page को prefer करें क्योंकि बाकी सारी subscriber configuration वहीं रहती है।

## Subscribe page पर visitor को क्या दिखता है

**Subscribe** page में हर enabled channel के लिए एक tab वाला sub-menu होता है — **Email**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — जो `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` और `/subscribe/webhooks` से mapped हैं। हर tab को बस उतना ही चाहिए जितना जरूरी है:

- **Email** — heading **Subscribe by Email**, एक field **Your Email** placeholder `subscriber@company.com` के साथ।
- **SMS** — heading **Subscribe by SMS**, एक field **Your Phone Number** placeholder `+11234567890` के साथ।
- **Slack** — heading **Subscribe by Slack**, इसमें **Slack Workspace Name** (validation के लिए इस्तेमाल होता है) और **Slack Incoming Webhook URL**, placeholder `https://hooks.slack.com/services/...`।
- **MS Teams** — heading **Subscribe by Microsoft Teams**, इसमें **Microsoft Teams Workspace Name** और **Microsoft Teams Incoming Webhook URL**, placeholder `https://outlook.office.com/webhook/...`।
- **Webhooks** — heading **Subscribe by Webhook**, एक field **Webhook URL**। हर status page event पर इसे एक JSON `POST` request भेजी जाती है।

Submit button पर **Subscribe** लिखा होता है, और सफल signup पर *You have been subscribed successfully.* दिखता है। page पर एक **New Subscription** / **Manage Existing Subscription** split भी होता है, ताकि जो पहले से subscribe कर चुका है वह पुराना email ढूँढे बिना अपनी preferences तक वापस पहुँच सके।

## Subscribers को resources और event types चुनने देना

डिफ़ॉल्ट रूप से एक subscriber को page पर मौजूद सब कुछ मिलता है। **Advanced Subscriber Settings** card में दो toggles इसे बदल देते हैं:

- **Allow Subscribers to Choose Resources** (`allowSubscribersToChooseResources`) — डिफ़ॉल्ट रूप से off। इसे on करने पर subscribe form में **Subscribe to All Resources** toggle जुड़ जाता है; इसे clear करने पर **Select Resources to Subscribe** दिखता है ताकि visitor individual resources चुन सके।
- **Allow Subscribers to Choose Event Types** (`allowSubscribersToChooseEventTypes`) — डिफ़ॉल्ट रूप से off। वही structure: एक **Subscribe to All Event Types** toggle, और इसे clear करने पर नीचे **Select Event Types to Subscribe**।

Event types हैं `Incident`, `Announcement` और `Scheduled Event`।

ये चुनाव subscriber record पर **Is Subscribed to All Resources** (`isSubscribedToAllResources`, डिफ़ॉल्ट true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, डिफ़ॉल्ट true), **Subscribed to Resources** और **Subscribed to Event Types** के रूप में दर्ज होते हैं।

किसके लिए उपयोगी: ऐसा page जो कई products को cover करता हो। जो customer सिर्फ आपका API इस्तेमाल करता है वह हर बार page नहीं चाहेगा जब marketing site में हल्की गड़बड़ी हो — उन्हें पूरी तरह unsubscribe होते देखने के बजाय list खुद संकुचित करने दें।

इसी card में **Subscriber Timezones** भी होता है।

## Email double opt-in

Email subscribers हमेशा confirm करते हैं। जब कोई subscriber email address के साथ बनाया जाता है और पहले से confirmed बनाकर नहीं बनाया गया, तो **Is Subscription Confirmed** (`isSubscriptionConfirmed`) को force करके `false` किया जाता है और एक छह-अंकों का **Subscription Confirmation Token** generate होता है। फिर OneUptime एक confirmation link वाला email भेजता है जिसका shape होता है `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`। visitor **Confirm Subscription** page पर पहुँचता है और, प्रक्रिया पूरी होने पर, *Subscription confirmed successfully* देखता है।

SMS, Slack, Microsoft Teams और webhook subscribers इसे skip कर देते हैं — वे पहले से `isSubscriptionConfirmed` को `true` सेट करके बनाए जाते हैं।

**Unconfirmed का मतलब silent है।** notification के लिए subscribers fetch करने वाली query `isUnsubscribed: false` और `isSubscriptionConfirmed: true` पर filter करती है। जिस email address ने कभी link पर click नहीं किया वह आपकी **Email Subscribers** list में बैठा रहेगा और कुछ भी नहीं पाएगा। अगर कोई कहता है कि वह subscribed है लेकिन उसे कुछ नहीं मिल रहा, तो सबसे पहले यही column check करें।

email confirmation को बंद करने के लिए कोई toggle नहीं है — यह status page के जरिए sign up करने वाले हर किसी के लिए unconditional है। एक अलग per-subscriber column, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, डिफ़ॉल्ट true), उस "you have subscribed" email को control करता है जो subscriber confirm होने के बाद भेजा जाता है।

## Subscription को manage और cancel करना

हर subscriber email में इस रूप का एक unsubscribe link होता है `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`। उस page का title **Update Subscription** है और यह visitor को बताता है कि वे वहाँ अपनी preferences update कर सकते हैं या unsubscribe कर सकते हैं। इसमें होता है:

- page जो भी resource और event-type pickers allow करता है।
- एक **Unsubscribe** toggle, जिसे सभी resources से unsubscribe करने के रूप में बताया गया है। यह **Is Unsubscribed** (`isUnsubscribed`, डिफ़ॉल्ट false) लिखता है।
- एक submit button जिस पर **Update Subscription** लिखा है; save करने पर *Your changes have been saved.* दिखता है।

जिसका link खो गया हो वह **Subscribe** page पर **Manage Existing Subscription** का इस्तेमाल करता है और **Send Management Link** दबाता है। OneUptime जवाब देता है कि link वाला email भेज दिया गया है और अगर वह न आए तो spam folder check करने को कहता है।

इन सबके पीछे के endpoints हैं `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` और `PUT .../update-subscription/:statusPageId/:subscriberId`।

Unsubscribe करने पर row delete नहीं होती बल्कि एक flag पलट जाता है, इसलिए record **Is Unsubscribed** set होने के साथ channel list में बना रहता है — यह तब काम आता है जब बाद में यह बताना हो कि कोई particular address क्यों mail पाना बंद कर चुका था।

## Subscribers को किस बारे में notify किया जाता है

Subscribers ऊपर बताए गए तीनों event types के बारे में सुनते हैं, लेकिन हर source का अपना switch है, ताकि गलती से कुछ न भेजा जाए।

### Announcement notifications

घोषणा में खुद **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`) होता है, जो create form पर **Notify Status Page Subscribers** checkbox के रूप में दिखता है और डिफ़ॉल्ट रूप से on रहता है। अगर घोषणा **Monitors affected (Optional)** के अंतर्गत monitors बताती है, तो notification उन्हीं monitors तक सीमित रहती है; इसे खाली छोड़ने पर सभी subscribers को notify किया जाता है।

### Scheduled maintenance events

एक scheduled maintenance event के अपने subscriber columns का सेट होता है: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, साथ ही advance warnings के लिए **Subscriber notifications before the event** और **Next subscriber notification before the event at?**। event पर **Status Pages** यह तय करता है कि यह किन pages पर दिखेगा, और **Should be visible on status page?** यह तय करता है कि यह दिखेगा भी या नहीं।

### Incidents

`Incident` तीसरा event type है। किसी incident को status page तक पहुँचाने में सबसे पहले क्या मायने रखता है — यह किन resources को touch करता है और कौन-सी states इसे visible रखती हैं — यह [Incident States & Severities](/docs/incidents/states-and-severities) में cover किया गया है।

status page के side menu में **Notification Logs** section (`{id}/notification-logs`) वहाँ है जहाँ आप यह देखने जाते हैं कि page ने वास्तव में क्या भेजा।

## Notification templates को customize करना

**Subscriber Settings** पर मौजूद **Notification Templates** card इस status page द्वारा इस्तेमाल किए जाने वाले templates को list करता है, इसके columns हैं **Template Name**, **Event Type** और **Notification Method** — ताकि सब कुछ के लिए एक ही house message स्वीकार करने के बजाय आप हर event type और हर channel के लिए wording अलग-अलग रख सकें।

Project-wide templates एक level ऊपर रहते हैं, **Status Pages → Settings → Subscriber Templates** पर, **Announcement Templates** के बगल में।

## Email footer, custom SMTP और Twilio

**Subscriber Settings** पर तीन और cards यह control करते हैं कि subscriber messages आपके project से कैसे बाहर जाते हैं:

- **Email Footer Settings** — **Enable Custom Email Footer Text** और **Subscriber Email Notification Footer Text** subscriber emails पर आपका अपना footer डालते हैं।
- **Custom SMTP** — **Custom SMTP Config** subscriber email को default के बजाय आपके अपने mail server से भेजता है।
- **Twilio Config** — **Twilio Config** वही Twilio account है जो SMS subscribers के लिए इस्तेमाल होता है।

अगर आपके पास email subscribers हैं तो Custom SMTP जल्दी करना worth है: आपके अपने domain से आने वाला mail filter होने की संभावना बहुत कम होती है, और रात 2 बजे उसे पढ़ने वाले customer के लिए trust किए जाने की संभावना कहीं ज्यादा होती है।

## घोषणाएँ (Announcements)

एक announcement एक project-level record है (`StatusPageAnnouncement` model) जिसे आप एक या अधिक status pages पर fan out करते हैं, चाहें तो specific monitors तक scoped, एक ऐसी window के साथ जिसके दौरान यह दिखाई जाती है।

आप इसे **Status Pages → More → Announcements** से बनाते हैं, या किसी individual status page के side menu में **Announcements** से। create form एक चार-step wizard है:

1. **Basic Information** — **Announcement Title** (required, कम से कम दो characters), **Description** (Markdown, optional) और **Attachments** उन files के लिए जिन्हें status page पर घोषणा के साथ उपलब्ध होना चाहिए।
2. **Status Pages** — **Show announcement on these status pages**, एक required multi-select। एक announcement एक साथ कई pages को target कर सकती है।
3. **Resources Affected** — **Monitors affected (Optional)**। अगर आप कोई नहीं चुनते, तो सभी subscribers को notify किया जाता है।
4. **Schedule & Settings** — **Start Showing Announcement At** (required, डिफ़ॉल्ट अभी), **End Showing Announcement At** (optional) और **Notify Status Page Subscribers** (डिफ़ॉल्ट रूप से on)।

Visitors घोषणाएँ `/announcements` पर पढ़ते हैं, जो **Active Announcements** और **Past Announcements** में बँटी होती हैं, हर एक पर **Announced at** की मुहर होती है। जो घोषणाएँ अभी live हैं वे overview page के top पर भी pin रहती हैं। जब दिखाने के लिए कुछ न हो, तो page पर *No Announcement* के साथ यह note दिखता है कि अब तक कोई पोस्ट नहीं की गई।

Attachments `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId` से serve होते हैं, उसी read check के पीछे जो status page पर ही लागू होता है — इसलिए private page पर मौजूद attachment private ही रहता है।

## Announcement scheduling कैसे काम करती है

**Show At** (`showAnnouncementAt`) और **End At** (`endAnnouncementAt`) सब कुछ चलाते हैं, लेकिन overview page और announcements list अलग-अलग सवाल पूछते हैं, और यही अंतर लोगों को उलझा देता है।

- **overview page** एक announcement तब दिखाता है जब `showAnnouncementAt` past में हो और `endAnnouncementAt` या तो future में हो या खाली हो।
- **`/announcements` list** उन announcements को दिखाती है जिनका `showAnnouncementAt` **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`, डिफ़ॉल्ट 14) के अंदर आता है, फिर उन्हें client-side पर active और past में बाँट देती है।

दो परिणाम जिनके लिए plan करना जरूरी है:

- **बिना end date वाली announcement कभी expire नहीं होती।** **End Showing Announcement At** को खाली छोड़ें और यह overview page पर हमेशा के लिए pinned रहेगी। जो भी time-bound हो उस पर end date सेट करें।
- **कोई पुरानी लेकिन अब भी active announcement list से गायब हो सकती है।** अगर यह `showAnnouncementHistoryInDays` से ज्यादा पहले शुरू हुई थी तो यह overview पर बनी रहते हुए भी `/announcements` से हट जाती है। अगर आप लंबे समय तक चलने वाले notices रखते हैं तो history window बढ़ाएँ।

घोषणाएँ बिल्कुल दिखेंगी या नहीं यह **Advanced Settings** पर मौजूद **Announcement Settings** card control करता है: **Show Announcements** (`showAnnouncementsOnStatusPage`, डिफ़ॉल्ट true) और **Show Announcement History (in days)** (डिफ़ॉल्ट 14)। **Show Announcements** off होने पर announcements endpoint request को सीधे मना कर देता है।

## Announcement templates

अगर आप एक ही तरह का notice बार-बार post करते हैं — एक monthly maintenance heads-up, कोई recurring third-party degradation — तो उसे pre-can कर लें। **Status Pages → Settings → Announcement Templates** `StatusPageAnnouncementTemplate` model को store करता है, और इसका form **Template Name**, **Template Description**, **Announcement Title**, **Description**, **Show announcement on these status pages**, **Monitors affected (Optional)** और **Notify Subscribers** माँगता है, ताकि fan-out और notify का फैसला हर बार के बजाय एक ही बार लिया जाए।

## Webhook subscribers और SSRF protection

Webhook subscribers हर status page event पर एक JSON `POST` request पाते हैं, जो उन्हें status page updates को आपके अपने किसी system में — chatbot, internal dashboard, ticketing queue — pipe करने का सबसे आसान तरीका बनाता है।

चूँकि subscribe करना एक public page पर public operation है, OneUptime target को guard करता है:

- एक generic **Webhook URL** को accept करने से पहले validate किया जाता है, और private, loopback, link-local और cloud-metadata addresses reject कर दिए जाते हैं। आप किसी subscription को OneUptime deployment के अपने network के अंदर मौजूद किसी चीज़ की तरफ point नहीं कर सकते।
- **Slack Incoming Webhook URL** का शुरुआत `https://hooks.slack.com/services/` से होनी ही चाहिए।

अगर signup पर कोई webhook subscription reject हो जाए, तो सबसे पहले किसी internal या malformed URL की जाँच करें।

## आगे क्या पढ़ें

- [Status Pages Overview](/docs/status-pages/index) — status page क्या है और यह कैसे बना होता है।
- [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) — वे monitors और groups जिनके बीच subscribers चुन सकते हैं।
- [Status Page Branding & Domains](/docs/status-pages/branding-and-domains) — custom domains, logos और उस page का look जिससे आपके emails link करते हैं।
- [Public API](/docs/status-pages/public-api) — status page data को programmatically पढ़ना।
- [Incident States & Severities](/docs/incidents/states-and-severities) — किसी incident को status page पर क्या डालता है और क्या हटाता है।
- [Incident Settings & Automation](/docs/incidents/settings) — incident communication के पीछे project-level नियम।
