# ब्रांडिंग और कस्टम डोमेन

एक status page वह अकेली OneUptime surface है जिसे आपके customers असल में देखते हैं, इसलिए इसे आपका जैसा दिखना चाहिए और आपके अपने domain पर रहना चाहिए। ये दोनों चीज़ें status page के side menu के **Branding** section से, और **Advanced Settings** में छिपी एक setting से configure होती हैं।

शुरू करने से पहले जान लेने वाली बात: branding सात अलग-अलग screens में बंटी है, और यह बँटवारा हमेशा वहाँ नहीं होता जहाँ आप अंदाज़ा लगाएंगे। Logo और cover image **Essential Branding** पर नहीं हैं — वे **Header** पर हैं। Favicon **Essential Branding** पर है। Colors **Overview Page** पर हैं। बाकी जो कुछ भी आप "theming" समझते होंगे वह Custom CSS है।

यह page हर screen को बारी-बारी से देखता है, फिर आपको page को `status.yourcompany.com` पर रखने के लिए पूरे CNAME-फिर-SSL sequence से गुज़ारता है।

## हर branding control कहाँ रहता है

कोई status page खोलें, और side menu के **Branding** section में सात items हैं। यहाँ एक map है, ताकि आपको खोजना न पड़े।

| Page                        | आप वहाँ क्या सेट करते हैं                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| **Essential Branding**        | Page title, page description, search engine indexing, favicon।                                  |
| **Header**                    | Logo, cover image, उनका alt text, और header link bar।                                            |
| **Footer**                    | Copyright line और footer link bar।                                                               |
| **Overview Page**             | Overview description, history chart की bar colors, downtime statuses, overall uptime percent।   |
| **HTML, CSS & JavaScript**    | Header HTML, footer HTML, custom CSS, custom JavaScript।                                         |
| **Custom Domains**            | आपका अपना domain, CNAME verification, और SSL।                                                     |
| **Languages**                 | डिफ़ॉल्ट language और footer switcher में दी जाने वाली languages।                                 |

## Essential branding

**Status Pages → आपका page → Branding → Essential Branding** (`{id}/branding`) में तीन cards हैं।

- **Title and Description** — card बताता है कि इसका इस्तेमाल SEO के लिए भी होता है। **Edit** **Page Title** (placeholder `Please enter page title here.`) और **Page Description** खोलता है। यही वह है जो search engines और link previews दिखाते हैं, इसलिए इसे अपनी team के लिए नहीं, एक customer के लिए लिखें।
- **Search Engine Indexing** — एक अकेला toggle, **Allow Search Engines to Index this Status Page**, product में इसे इस तरह बताया गया है कि यह नियंत्रित करता है कि Google और Bing page को अपने results में list कर सकें या नहीं। यह डिफ़ॉल्ट रूप से on है। इसे off करने पर page `noindex, nofollow` के साथ serve होता है।
- **Favicon** — **Edit Favicon** **Favicon** image upload खोलता है। यह browser tab में दिखने वाला छोटा icon है।

इसका इस्तेमाल तब करें जब: page internal-only हो या अभी setup हो रहा हो। एक आधा-अधूरा page आपके brand name के लिए rank करना शुरू न करे, इसके लिए **Allow Search Engines to Index this Status Page** को off कर दें।

## Header screen

**Status Pages → आपका page → Branding → Header** (`{id}/header-style`)। side-menu के नाम के बावजूद, आपके दो सबसे बड़े brand assets यहीं रहते हैं।

पहला card **Logo, Cover and Favicon** शीर्षक रखता है, एक **Edit Images** button के साथ:

- **Logo** — image upload, placeholder `Upload logo`।
- **Logo Alt Text** — placeholder `Logo of My Company`। अगर आप इसे खाली छोड़ते हैं, तो इसकी जगह status page का title इस्तेमाल होता है।
- **Cover** — image upload, placeholder `Upload cover image`। यह header के पीछे का चौड़ा banner है।
- **Cover Image Alt Text** — cover के लिए वही idea।

इसके नीचे एक **Header Links** table है ("Header Links for your status page")। हर link का एक **Title** और एक **Link** (एक URL, placeholder `https://link.com`) होता है, और rows को drag करके reorder किया जाता है। कुछ भी configure न होने पर table "No status header link for this status page." पढ़ता है।

इसके लिए अच्छा: visitors को बिना URL अंदाज़ा लगवाए आपकी marketing site, आपके docs, या एक support portal पर वापस भेजना।

## Footer screen

**Status Pages → आपका page → Branding → Footer** (`{id}/footer-style`) **Header** जैसी ही shape है, एक card और एक table।

- **Copyright Info** — **Edit Copyright** एक अकेला field खोलता है, **Copyright Info**, placeholder `Acme, Inc.` के साथ।
- **Footer Links** — वही **Title** और **Link** जोड़ी, drag-ordered, empty message "No status footer link for this status page."।

Legal, privacy और terms links यहीं आते हैं। Header links navigation के लिए हैं; footer links छोटे print के लिए।

## Overview page branding

**Status Pages → आपका page → Branding → Overview Page** (`{id}/overview-page-branding`) वह अकेला screen है जहाँ colors configurable हैं, और यह यह भी तय करता है कि chart पर "down" का क्या मतलब है।

- **Overview Page** — **Edit Branding** एक markdown field, **Overview Page Description.**, खोलता है जो resource list के ऊपर render होता है। इसका इस्तेमाल थोड़े context के लिए करें: यह page क्या cover करता है, और support के लिए कहाँ जाना है।
- **Rules for Bar Colors of History Chart** — rules की एक ordered, drag-sortable table। हर rule में **When uptime % is greater than or equal to** और **Then, use this bar color** होता है; table के columns `When Uptime Percent >=` और `Then, Bar Color is` पढ़ते हैं। Order मायने रखता है, इसलिए इन्हें उस क्रम में arrange करें जिस क्रम में आप चाहते हैं कि वे evaluate हों।
- **Downtime Monitor Statuses** — **Edit Statuses** एक multi-select खोलता है जिसे "These monitor statuses are considered as down" बताया गया है। इसी से आप तय करते हैं कि, मान लीजिए, एक degraded status इस page पर uptime के खिलाफ गिनी जाए या नहीं।
- **Default Bar Color of the History Chart** — **Edit Default Bar Color** **Default Bar Color** picker खोलता है, वह color जो तब इस्तेमाल होता है जब कोई rule match नहीं करता।
- **Overall Uptime Percent** — **Edit Settings** **Show Overall Uptime Percent** toggle और एक **Select Uptime Precision** dropdown खोलता है, जो डिफ़ॉल्ट रूप से दो decimals (`99.99% (Two Decimal)`) पर होता है।

**Chart कितने दिन cover करता है, यह यहाँ सेट नहीं होता।** वह **Status Pages → आपका page → Advanced → Advanced Settings** (`{id}/settings`) पर **Show Uptime History (in days)** है, जो 1 से 90 तक valid है।

## Custom HTML, CSS और JavaScript

**Status Pages → आपका page → Branding → HTML, CSS & JavaScript** (`{id}/custom-code`) में चार स्वतंत्र रूप से editable cards हैं, जो status page के `headerHTML`, `footerHTML`, `customCSS` और `customJavaScript` columns से backed हैं:

- **Header HTML** — placeholder `Insert Custom HTML here.`, page header में inject होता है।
- **Footer HTML** — वही, footer के लिए।
- **Custom CSS** — placeholder `Insert Custom CSS here.`
- **Custom JavaScript** — placeholder `Insert Custom JavaScript here.`

**कोई theme picker नहीं है।** OneUptime status pages में कोई theme या brand-color setting नहीं है: कहीं भी मौजूद अकेले built-in color controls **Overview Page** screen पर **Default Bar Color** और history chart की bar color rules हैं। Fonts, background colors, accent colors और layout tweaks — यह सब यहाँ **Custom CSS** के ज़रिए होता है। अगर आप एक "brand color" field खोज रहे थे, तो यही जवाब है — ऐसा कोई field नहीं है, और यह box ही escape hatch है।

> Custom JavaScript आपके visitors के browsers में एक ऐसे page पर चलता है जिसे लोग तब load करते हैं जब उन्हें ठीक-ठीक चिंता होती है कि कुछ टूटा हुआ है। इसे छोटा रखें, जहाँ हो सके self-hosted रखें, और भरोसा करने से पहले इसे test करें।

## Language settings

**Status Pages → आपका page → Branding → Languages** (`{id}/languages`) में दो cards हैं, और दोनों page के footer में visitors को मिलने वाले language switcher के बारे में हैं।

- **Default Language** — **Edit Default Language** एक dropdown खोलता है जो हर supported language को उसके native name और English name (`Deutsch (German)`) से list करता है। Card इसे उस language के रूप में describe करता है जो first-time visitors देखते हैं; visitors हमेशा footer से switch कर सकते हैं। यह डिफ़ॉल्ट रूप से English है।
- **Enabled Languages** — **Edit Enabled Languages** एक multi-select खोलता है, placeholder `All languages`। इसे खाली छोड़ने पर हर supported language offer की जाती है। कुछ चुनें और footer switcher सिर्फ़ उन्हें ही list करता है।

OneUptime के साथ सोलह languages आती हैं: English, German, French, Spanish, Italian, Portuguese, Dutch, Danish, Norwegian, Swedish, Russian, Japanese, Korean, Chinese (Simplified), Chinese (Traditional) और Hindi।

## Custom domains

डिफ़ॉल्ट रूप से एक status page अपनी **Overview** screen पर दिखने वाले preview URL पर पहुँचा जा सकता है। इसे अपने hostname पर रखने के लिए, **Status Pages → आपका page → Branding → Custom Domains** (`{id}/domains`) पर जाएं।

Card का शीर्षक **Custom Domains** है और इसका description सीधे requirement बताता है: इसके काम करने के लिए इन domains के CNAME के रूप में अपनी installation का status page CNAME record जोड़ें। कुछ भी configure न होने पर table "No custom domains found." पढ़ता है। Table में दो columns हैं, **Domain** और **Status**, और **Domain**, **CNAME Valid** और **SSL Provisioned** के लिए filters हैं।

### शुरू करने से पहले

दो prerequisites, और इनमें से किसी एक को छोड़ना ही आमतौर पर वजह होती है कि यह काम नहीं करता:

- **Parent domain पहले से verified होना चाहिए।** **Domain** dropdown केवल project settings से verified domains list करता है — field का अपना help text आपको एक पहले जोड़ने के लिए **More → Project Settings → Custom Domains** की ओर इशारा करता है।
- **Installation में एक status page CNAME record configure होना चाहिए।** Self-hosted deployments पर वह Docker Compose में `STATUS_PAGE_CNAME_RECORD` environment variable है, या Helm के `values.yaml` में `statusPage.cnameRecord`। इसके बिना, **Add CNAME** और **Order Free SSL** दोनों modals instructions के बजाय एक "Custom Domains not enabled for this OneUptime installation" message दिखाते हैं।

### Domain जोड़ना

**Create Status Page Domain** पर क्लिक करें। Modal (**Create New Status Page Domain**) में दो steps हैं:

**Basic**

- **Subdomain** — सिर्फ़ label, placeholder `status (leave blank for root)`। सिर्फ़ `status` डालें, पूरा hostname नहीं। root/apex domain इस्तेमाल करने के लिए इसे खाली छोड़ें या `@` डालें।
- **Domain** — verified domains का एक dropdown, placeholder `Select domain`।

**More**

- **Upload Custom Certificate** — एक toggle, डिफ़ॉल्ट रूप से off। इसे off छोड़ दें और OneUptime आपके लिए एक free certificate order करता है। इसे on करें और आपको अपने खुद के PEM material के लिए **Certificate** और **Certificate Private Key** fields मिलते हैं।

## CNAME verify करना

जब तक domain unverified है, row एक **Add CNAME** action दिखाती है। यह **Add CNAME** शीर्षक वाला एक modal खोलता है जो बिल्कुल वही देता है जिसे आपको अपने DNS provider में paste करना है:

- **Record Type** — `CNAME`
- **Name** — वह पूरा domain जो आपने अभी बनाया, उदाहरण के लिए `status.yourcompany.com`
- **Content** — आपकी installation का status page CNAME record

Modal बताता है कि record के जगह पर आने के बाद, automatic verification में 24 घंटे तक लग सकते हैं। आपको इसके लिए इंतज़ार करने की ज़रूरत नहीं है: modal का submit button **Verify CNAME** है, जो record को demand पर check करता है।

पहले DNS record बनाएं, फिर **Verify CNAME** पर क्लिक करें। record के मौजूद होने से पहले इसे क्लिक करना बस विफल हो जाता है।

## एक SSL certificate order करना

एक बार CNAME verify हो जाने पर — और केवल तब जब आपने अपना खुद का certificate upload नहीं किया — row पर एक **Order Free SSL** action दिखाई देता है। इसका modal, **Order Free SSL Certificate for this Status Page**, बताता है कि OneUptime LetsEncrypt इस्तेमाल करता है, कि process secure और free है, और order देने के बाद provisioning में कुछ घंटे लगते हैं। Submit button **Order Free SSL** है।

**बताई गई timings screens के बीच अलग-अलग हैं**, इसलिए किसी एक number पर बहुत भरोसा न करें: order modal तीन घंटे कहता है, **Status** column एक घंटा कहता है, और एक custom certificate तीस मिनट कहता है। इन सबको "आज बाद में वापस देखें" के रूप में लें, और अगर तब तक कुछ नहीं हुआ तो support से contact करें।

एक बार provision हो जाने पर, renewal automatic है। आपके लिए कुछ भी recurring करने को नहीं है।

## Domain के Status column को पढ़ना

**Status** column एक ही cell में पूरा setup state machine है। हर message या तो बताता है कि आगे क्या करना है या यह कि आप पूरा कर चुके हैं।

| Status column क्या कहता है                            | इसका क्या मतलब है                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.             | CNAME अभी verify नहीं हुआ है। Record जोड़ें, फिर **Verify CNAME**।                       |
| Action Required: Please order SSL certificate.              | CNAME verified है पर कोई certificate order पर नहीं है। **Order Free SSL** पर क्लिक करें। |
| No action is required, allow 30 minutes to provision.       | आपने एक custom certificate upload किया है और यह install हो रहा है।                       |
| No action is required, this will be provisioned soon.       | Free certificate order पर है और in flight है। अगर यह कभी न पहुँचे तो support से contact करें। |
| Certificate Provisioned. No action required.                | पूरा हो गया। OneUptime certificate को automatically renew करता है।                       |

अगर आपके DNS entry बनाने के काफ़ी बाद भी कोई row "Action Required: Please add your CNAME record." पर टिकी रहे, तो जाँचें कि record का name पूरा domain है और उसकी content आपकी installation के CNAME record से बिल्कुल match करती है।

## Powered by OneUptime

"Powered by OneUptime" line branding-section की setting नहीं है। यह **Status Pages → आपका page → Advanced → Advanced Settings** (`{id}/settings`) पर, **Powered By OneUptime Branding** card में, एक अकेले toggle के रूप में रहती है: **Hide Powered By OneUptime Branding**। उस page के बाकी हर card की तरह, **Edit Settings** इसे खोलता है।

## आगे क्या पढ़ें

- [स्थिति पृष्ठ अवलोकन](/docs/status-pages/index) — status page क्या है और टुकड़े कैसे साथ फिट होते हैं।
- [स्थिति पृष्ठ संसाधन और समूह](/docs/status-pages/resources-and-groups) — visitors page पर असल में क्या देखते हैं यह चुनना।
- [सब्सक्राइबर और घोषणाएँ](/docs/status-pages/subscribers) — email, SMS, Slack और webhook subscribers, साथ ही announcements।
- [सार्वजनिक API](/docs/status-pages/public-api) — status page data को programmatically पढ़ना।
- [घटना स्थितियाँ और गंभीरता](/docs/incidents/states-and-severities) — page पर कोई incident कब दिखती है और कब गायब होती है।
