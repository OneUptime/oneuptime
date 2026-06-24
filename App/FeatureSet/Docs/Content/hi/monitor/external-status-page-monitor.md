# External Status Page Monitor

External Status Page monitoring आपको third-party status pages monitor करने और उन services से alert प्राप्त करने की अनुमति देता है जिन पर आप depend करते हैं जब वे outages या degraded performance का अनुभव करती हैं। OneUptime समय-समय पर external status pages (जैसे AWS, GCP, Azure, GitHub, OpenAI, Anthropic और अधिक) जांचता है और उनकी status evaluate करता है।

## Overview

External Status Page monitors उन services की health जांचते हैं जिन पर आप निर्भर हैं, उनके public status pages query करके। यह आपको सक्षम बनाता है:

- आपके application जिन third-party services पर depend करता है उनकी availability monitor करें
- upstream providers के outages का अनुभव होने पर alert प्राप्त करें
- individual component statuses track करें (जैसे "AWS EC2 us-east-1")
- monitoring को एक single component group तक scope करें (जैसे केवल OpenAI के "APIs"), ताकि page पर अन्यत्र होने वाले असंबंधित incidents आपके monitor को trip न करें
- degraded performance को आपके users को प्रभावित करने से पहले detect करें
- upstream provider issues के साथ अपने incidents को correlate करें

## समर्थित Providers

OneUptime निम्नलिखित methods के माध्यम से status pages monitoring का समर्थन करता है:

| Provider Type            | विवरण                                                       |
| ------------------------ | ----------------------------------------------------------- |
| **Auto** (default)       | status page format automatically detect करता है             |
| **Atlassian Statuspage** | Atlassian Statuspage (JSON API) द्वारा संचालित Status pages |
| **incident.io**          | incident.io द्वारा संचालित Status pages (जैसे `https://status.openai.com`) |
| **RSS**                  | RSS feed प्रदान करने वाले Status pages                      |
| **Atom**                 | Atom feed प्रदान करने वाले Status pages                     |

### Auto-Detection

**Auto** पर सेट होने पर, OneUptime status page format automatically detect करने की कोशिश करेगा, इस क्रम में:

1. पहले, यह Atlassian Statuspage JSON API (`/api/v2/status.json`, `/api/v2/components.json`, और `/api/v2/incidents/unresolved.json`) आज़माता है
2. इसके बाद, यह incident.io status page API (`/proxy/<host>`) आज़माता है
3. यदि वे fail हो जाएं, तो यह page को RSS या Atom feed के रूप में parse करने की कोशिश करता है
4. final fallback के रूप में, यह basic HTTP reachability check करता है

## External Status Page Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **External Status Page** चुनें
4. वह status page URL दर्ज करें जिसे आप monitor करना चाहते हैं
5. वैकल्पिक रूप से एक specific provider type चुनें (या **Auto** के रूप में छोड़ दें)
6. वैकल्पिक रूप से "APIs" जैसे किसी group तक scope करने के लिए एक **component group** दर्ज करें
7. वैकल्पिक रूप से एक single component तक filter करने के लिए एक **component name** दर्ज करें (यदि group सेट है, तो उस group के भीतर)
8. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### Status Page URL

वह external status page का URL दर्ज करें जिसे आप monitor करना चाहते हैं। Atlassian Statuspage और incident.io-powered sites के लिए, यह आमतौर पर root URL है (जैसे `https://status.example.com`)। RSS/Atom feeds के लिए, feed URL directly दर्ज करें।

### Provider Type

status page के लिए provider type चुनें। format automatically detect करने के लिए **Auto** (default) उपयोग करें, या यदि आप जानते हैं तो **Atlassian Statuspage**, **incident.io**, **RSS**, या **Atom** निर्दिष्ट करें।

### Component Group Filter

यदि status page अपने components को groups में व्यवस्थित करती है, तो आप monitor को एक single group तक scope कर सकते हैं। उदाहरण के लिए, `https://status.openai.com` पर, `APIs` दर्ज करने से monitor OpenAI की API services तक scope हो जाता है।

जब कोई component group सेट होती है, तो **active incident count** और **overall status** केवल उस group के components का उपयोग करके compute किए जाते हैं — एक असंबंधित group (उदाहरण के लिए, ChatGPT) को प्रभावित करने वाला incident "APIs" group तक scoped monitor को trip नहीं करेगा।

Component group filtering **Atlassian Statuspage** और **incident.io** providers के लिए समर्थित है। (RSS/Atom feeds component groups expose नहीं करते।)

### Component Name Filter

यदि status page कई components पर report करती है, तो आप वैकल्पिक रूप से केवल उस specific component को monitor करने के लिए component name निर्दिष्ट कर सकते हैं। उदाहरण के लिए, केवल us-east-1 में AWS EC2 monitor करने के लिए, आप `EC2 us-east-1` दर्ज करेंगे (status page पर दिखाई देने वाला exact component name)।

जब कोई component group भी सेट होती है, तो component name filter उस group के **भीतर** लागू होता है, जिससे आप किसी बड़े group के अंदर एक single component को target कर सकते हैं। जब कोई भी filter निर्दिष्ट नहीं होता, तो scope में सभी components monitor किए जाते हैं।

### Advanced Options

#### Timeout

status page से response के लिए प्रतीक्षा करने का maximum time (milliseconds में)। Default 10000ms (10 seconds) है।

#### Retries

यदि request fail हो जाए तो retry करने की संख्या। Default 3 retries है।

## Monitoring Criteria

आप criteria configure कर सकते हैं जो निम्न के आधार पर यह निर्धारित करे कि external service operational मानी जाए या down:

- **Is Online** – status page reachable है और status data लौटा रही है
- **Overall Status** – status page का overall status indicator (जैसे `operational`, `degraded_performance`, `partial_outage`, `major_outage`)
- **Component Status** – scope में components की status (component group / component name filters का सम्मान करते हुए)
- **Active Incidents** – status page पर report किए गए currently active incidents की संख्या (filter सेट होने पर component group / component तक scoped)
- **Response Time** – status page data fetch करने में कितना समय लगता है

### Default Criteria

डिफ़ॉल्ट रूप से, OneUptime criteria को उस आधार पर seed करता है जो किसी status page के लिए वास्तव में मायने रखता है — इसके active incidents और component health, न कि केवल reachability:

- monitor को **Operational** चिह्नित किया जाता है जब scope में कोई active incidents नहीं होते।
- monitor को **Down** चिह्नित किया जाता है (और एक incident बनाया जाता है) जब scope में कम से कम एक active incident होता है, या जब scope में कोई component `degraded_performance`, `partial_outage`, `major_outage`, या `full_outage` report करता है।

चूँकि active incident count और component statuses component group / component name filters का सम्मान करते हैं, ये default criteria automatically केवल उन components को target करते हैं जिनकी आप परवाह करते हैं।

## लोकप्रिय Status Page URLs

यहाँ उन लोकप्रिय service status page URLs की एक curated list है जिन्हें आप monitor कर सकते हैं:

| Service                      | Status Page URL                               |
| ---------------------------- | --------------------------------------------- |
| AWS                          | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform        | `https://status.cloud.google.com`             |
| Microsoft Azure              | `https://status.azure.com`                    |
| GitHub                       | `https://www.githubstatus.com`                |
| OpenAI                       | `https://status.openai.com`                   |
| Anthropic                    | `https://status.anthropic.com`                |
| Cloudflare                   | `https://www.cloudflarestatus.com`            |
| Datadog                      | `https://status.datadoghq.com`                |
| PagerDuty                    | `https://status.pagerduty.com`                |
| Twilio                       | `https://status.twilio.com`                   |
| Stripe                       | `https://status.stripe.com`                   |
| Slack                        | `https://status.slack.com`                    |
| Atlassian (Jira, Confluence) | `https://status.atlassian.com`                |
| Vercel                       | `https://www.vercel-status.com`               |
| Netlify                      | `https://www.netlifystatus.com`               |
| DigitalOcean                 | `https://status.digitalocean.com`             |
| Heroku                       | `https://status.heroku.com`                   |
| MongoDB Atlas                | `https://status.cloud.mongodb.com`            |
| Fastly                       | `https://status.fastly.com`                   |
| New Relic                    | `https://status.newrelic.com`                 |
| Sentry                       | `https://status.sentry.io`                    |
| CircleCI                     | `https://status.circleci.com`                 |

> **नोट:** इनमें से कई Atlassian Statuspage या incident.io उपयोग करते हैं, इसलिए **Auto** provider type उन्हें automatically detect कर लेगा।

## Incident और Alert Templating

External Status Page monitors से incidents या alerts बनाते समय, आप निम्नलिखित template variables उपयोग कर सकते हैं:

| Variable                  | विवरण                                                       |
| ------------------------- | ----------------------------------------------------------- |
| `{{isOnline}}`            | status page online है (true/false)                          |
| `{{responseTimeInMs}}`    | milliseconds में Response time                              |
| `{{failureCause}}`        | failure का कारण, यदि कोई है                                 |
| `{{overallStatus}}`       | overall status indicator value                              |
| `{{activeIncidentCount}}` | active incidents की संख्या (filter तक scoped, यदि कोई हो)   |
| `{{componentStatuses}}`   | component statuses का JSON array (`name`, `status`, `description`, `groupName`) |
| `{{provider}}`            | Detected provider (Atlassian Statuspage, incident.io, RSS, Atom) |
| `{{componentGroup}}`      | वह component group जिस तक monitor scoped है, यदि कोई हो     |
| `{{componentName}}`       | वह component जिस तक monitor scoped है, यदि कोई हो           |

## सर्वोत्तम प्रथाएं

- **Auto provider type उपयोग करें** जब तक आप exact format नहीं जानते — Auto detection अधिकांश status pages के लिए अच्छी तरह काम करता है
- **एक component group तक scope करें** यदि आप किसी provider के केवल एक हिस्से पर depend करते हैं (जैसे केवल OpenAI के "APIs"), ताकि असंबंधित incidents noise न बनाएं
- **specific components monitor करें** यदि आप केवल certain services पर depend करते हैं (जैसे एक specific AWS region)
- **incident correlation सेट अप करें** — जब आपके monitors issues detect करें और upstream status page भी problems दिखाए, तो root causes तेजी से identify करने में मदद मिलती है
- **अन्य monitors के साथ combine करें** — comprehensive visibility के लिए External Status Page monitors को अपने API/Website monitors के साथ pair करें
