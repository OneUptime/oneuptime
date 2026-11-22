import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Hindi (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Hindi. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "एक वेब ऐप जिसका कोड आप बदलकर फिर से डिप्लॉय कर सकते हैं, और जिसकी डिपेंडेंसी npm से इंस्टॉल होती हैं",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "वे ऑरिजिन जिनसे आपकी साइट सर्व होती है, जैसे `https://app.example.com` — ब्राउज़र कुंजी केवल उन्हीं ऑरिजिन से अनुरोध स्वीकार करती है जिन्हें आप उस पर सूचीबद्ध करते हैं",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "फिर इसे अपने ऐप का **पहला** आयात बनाएँ, ताकि कुछ और चलने से पहले इंस्ट्रुमेंटेशन `fetch` को पैच कर दें:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "`storefront-web` को अपने एप्लिकेशन के नाम से बदलें। OneUptime में ऐप इसी नाम से दिखता है, इसलिए इसे स्थिर रखें: नया नाम एक नया एप्लिकेशन दर्ज करता है।",
  "> **Keep `browserDetector`.** Everything a Browser key sends is filed as this application, but the OpenTelemetry browser SDKs add no `browser.*` attributes unless you enable the browser resource detector or set them yourself — and without `browser.platform` the **Clients** tab lists no platforms.":
    "> **`browserDetector` बनाए रखें।** ब्राउज़र कुंजी जो कुछ भी भेजती है, वह इसी एप्लिकेशन के रूप में दर्ज होता है, लेकिन OpenTelemetry ब्राउज़र SDK तब तक `browser.*` एट्रिब्यूट नहीं जोड़ते जब तक आप ब्राउज़र रिसोर्स डिटेक्टर चालू न करें या उन्हें खुद सेट न करें — और `browser.platform` के बिना **क्लाइंट्स** टैब कोई प्लेटफ़ॉर्म सूचीबद्ध नहीं करता।",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "इसे अपने मौजूदा `connect-src` डायरेक्टिव में मिला दें। आपकी साइट में Content Security Policy नहीं है? यह चरण छोड़ दें।",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200` और `"valid": true` का मतलब है कि OneUptime कुंजी स्वीकार करता है — ब्राउज़र कुंजी के लिए संदेश यह भी जोड़ता है कि यह केवल ब्राउज़र से, उसके किसी अनुमत ऑरिजिन से काम करती है। `401` का मतलब है कि कुंजी अज्ञात, रद्द, अक्षम या समाप्त है।',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "फिर अपनी साइट का कोई पेज लोड करें। एक मिनट के भीतर एप्लिकेशन **वास्तविक उपयोगकर्ता मॉनिटरिंग** में दिखता है, जिसका नाम उसके `service.name` से आता है, और साथ में पेज व्यू, त्रुटि दर और p95 अवधि।",
  "Everything a Browser key sends is filed as this browser app, whatever its resource says. The key keeps only what a page says about itself on the resource — such as its `service.*`, `browser.*`, `user_agent.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "ब्राउज़र कुंजी जो कुछ भी भेजती है, वह इसी ब्राउज़र ऐप के रूप में दर्ज होता है, चाहे उसका रिसोर्स कुछ भी कहे। कुंजी रिसोर्स में से केवल वही रखती है जो कोई पेज अपने बारे में बताता है — जैसे उसके `service.*`, `browser.*`, `user_agent.*` और `telemetry.*` एट्रिब्यूट और उसके `oneuptime.label.*` लेबल — और बाकी हटा देती है, ताकि कॉपी की गई कुंजी अपनी टेलीमेट्री को किसी होस्ट, क्लस्टर या बैकएंड सेवा की टेलीमेट्री के रूप में न दिखा सके।",
  "With any other key, OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "किसी भी दूसरी कुंजी के साथ, OneUptime टेलीमेट्री को **RUM** के रूप में वर्गीकृत करता है जब उसके रिसोर्स में क्लाइंट एट्रिब्यूट होते हैं — वेब के लिए `browser.platform`, `browser.language` या खाली न होने वाला `browser.brands` में से कोई भी। एप्लिकेशन की पहचान `service.name` (केस-असंवेदनशील) से होती है, और उसकी टेलीमेट्री इसी RUM एप्लिकेशन की होती है — इसे कभी बैकएंड सेवा के रूप में दोबारा दर्ज नहीं किया जाता।",
  "| Attribute | Required | What it does |":
    "| एट्रिब्यूट | आवश्यक | यह क्या करता है |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **हाँ** | एप्लिकेशन की पहचान, जैसे `storefront-web`। बाद में इसका नाम बदलने से नया एप्लिकेशन बनता है। |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **इनमें से एक** | टेलीमेट्री को ब्राउज़र RUM के रूप में चिह्नित करता है। `browser.platform` **क्लाइंट्स** टैब भी भरता है। |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | नहीं | अवलोकन में दिखता है |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` इन्हें ब्राउज़र से सेट करता है। यह UA Client Hints API पढ़ता है, जो केवल Chromium ब्राउज़र में होता है, इसलिए Safari और Firefox पर यह `browser.language` सेट करता है लेकिन `browser.platform` नहीं। एट्रिब्यूट खुद सेट करने के लिए — डिटेक्टर के बिना, या हर ब्राउज़र को प्लेटफ़ॉर्म देने के लिए — रिसोर्स को ऐसे बनाएँ:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "`browser.platform` को मोटे स्तर पर रखें: हर अलग मान **क्लाइंट्स** टैब की एक पंक्ति बन जाता है।",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "ब्राउज़र स्निपेट की हर चीज़ आपके उपयोगकर्ताओं तक पहुँचती है। उसमें मौजूद टोकन सार्वजनिक है — सोर्स देखने वाला, devtools खोलने वाला या आपका बंडल पढ़ने वाला कोई भी इसे कॉपी कर सकता है। इसलिए यह गाइड केवल **ब्राउज़र** प्रकार की इंजेशन कुंजियाँ सूचीबद्ध करती है और बनाती है, हर एक उन ऑरिजिन के साथ जिनसे आपकी साइट सर्व होती है:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- यह केवल उन्हीं ऑरिजिन से स्वीकार की जाती है, इसलिए कॉपी की गई कुंजी किसी और के पेज पर काम नहीं करती;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- यह केवल ट्रेस, लॉग, मेट्रिक्स, सेशन रीप्ले और Sentry ब्राउज़र SDK रिपोर्ट लिख सकती है — प्रोफ़ाइल, source maps, syslog, Fluent, Pyroscope या सुरक्षा इवेंट नहीं;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- इस पर प्रति-कुंजी रेट लिमिट होती है, इसे एक ही बदलाव से बंद किया जा सकता है, और इसकी समाप्ति तिथि हो सकती है।",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "ऑरिजिन में स्कीम और पोर्ट (यदि कोई हो) शामिल होते हैं, और यह एक होस्ट वाइल्डकार्ड `*.` से शुरू हो सकता है — `https://app.example.com`, `https://*.example.com`। कुंजी पर **पिन किया गया सेवा नाम** भी सेट करने से उसके लिखे हर चीज़ पर `service.name` लागू हो जाता है, ताकि कॉपी की गई कुंजी अपनी टेलीमेट्री को आपकी किसी बैकएंड सेवा की टेलीमेट्री के रूप में न दिखा सके। दोनों **प्रोजेक्ट सेटिंग्स > टेलीमेट्री और APM > इंजेशन कुंजियाँ** में कुंजी के पेज पर हैं।",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **सर्वर इंजेशन कुंजी को कभी ब्राउज़र तक न भेजें।** सर्वर कुंजी को बिना ऑरिजिन जाँच के, कहीं से भी पूरी इंजेशन पहुँच होती है। पेज के सोर्स में आने के बाद, उसे ढूँढने वाला कोई भी इस प्रोजेक्ट में नकली स्पैन, लॉग और मेट्रिक्स लिख सकता है — डैशबोर्ड बिगाड़ सकता है, झूठे अलर्ट चला सकता है और आपका बिल किया गया उपयोग बढ़ा सकता है — जब तक आप ध्यान देकर उसे बदल नहीं देते।",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` तय करता है कि किन क्रॉस-ऑरिजिन अनुरोधों को W3C `traceparent` हेडर मिलेगा, जो ब्राउज़र स्पैन को उस बैकएंड ट्रेस से जोड़ता है जिसे उसने शुरू किया। समान-ऑरिजिन अनुरोध बिना किसी कॉन्फ़िगरेशन के प्रोपेगेट होते हैं।",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**इसे `/.*/` पर सेट न करें।** हेडर जोड़ने से एक साधारण क्रॉस-ऑरिजिन अनुरोध preflight वाला अनुरोध बन जाता है, और कोई भी थर्ड-पार्टी API जो अपने `Access-Control-Allow-Headers` में `traceparent` सूचीबद्ध नहीं करता, विफल होने लगेगा। केवल वे ऑरिजिन सूचीबद्ध करें जिन्हें आप नियंत्रित करते हैं और जिन्हें आपने कॉन्फ़िगर किया है:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "`fetch` के बजाय `XMLHttpRequest` से किए गए अनुरोधों को उसी विकल्प के साथ `@opentelemetry/instrumentation-xml-http-request` और उसका `XMLHttpRequestInstrumentation` चाहिए।",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "OpenTelemetry ब्राउज़र SDK अनहैंडल्ड त्रुटियों को अपने आप नहीं पकड़ता। उन्हें स्पष्ट रूप से रिपोर्ट करें ताकि वे आपकी बैकएंड त्रुटियों के साथ **अपवाद** व्यू में पहुँचें:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "अवलोकन भरने के लिए ट्रेस काफ़ी हैं। अगर आप OneUptime में खोजने योग्य ब्राउज़र लॉग या Core Web Vitals चाहते हैं, तो लॉग और मेट्रिक्स पाइपलाइन जोड़ें:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object, so their logs and metrics are filed under this application too.":
    "उनके एक्सपोर्टर उसी `x-oneuptime-token` हेडर के साथ `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` और `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` पर भेजते हैं — कोड [ब्राउज़र सेटअप](/docs/rum/browser-setup) में है। उन्हें उसी `resource` ऑब्जेक्ट से बनाएँ, ताकि उनके लॉग और मेट्रिक्स भी इसी एप्लिकेशन के तहत दर्ज हों।",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "**Core Web Vitals** कार्ड — LCP, INP, CLS, FCP और TTFB — केवल उन मेट्रिक्स से भरता है जिन्हें आपका ऐप `web_vital.lcp` जैसे नामों से रिपोर्ट करता है। [Core Web Vitals](/docs/rum/web-vitals) उन नामों को सूचीबद्ध करता है जिन्हें OneUptime पढ़ता है, और `web-vitals` लाइब्रेरी को जोड़ना दिखाता है।",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "`oneuptime.label.` उपसर्ग वाला कोई भी रिसोर्स एट्रिब्यूट एप्लिकेशन पर प्रोजेक्ट लेबल बन जाता है — `oneuptime.label.env` को `production` पर सेट करने से `env:production` लेबल जुड़ता है:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "हर ऐप के लिए एक `service.name` रखें, हर एनवायरनमेंट के लिए नहीं, और एनवायरनमेंट को लेबल से अलग करें, ताकि हर ऐप का एक ही एप्लिकेशन और एक ही इतिहास रहे।",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "नाम के आधार पर एप्लिकेशन को लेबल करने या स्वामी तय करने के लिए **वास्तविक उपयोगकर्ता मॉनिटरिंग → सेटिंग्स → लेबल नियम** और **स्वामी नियम** का उपयोग करें। नियम तब चलते हैं जब कोई एप्लिकेशन बनता है, ऑटो-डिस्कवरी से भी; वे मौजूदा एप्लिकेशन को फिर से लेबल नहीं करते।",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **अवलोकन** — चुनी जा सकने वाली समय सीमा में पेज व्यू, त्रुटि दर और p95 अवधि, ट्रेंड चार्ट के साथ। ये आपके इंस्ट्रुमेंटेशन से निकलने वाले स्पैन से बनते हैं, इसलिए पेज व्यू वही है जो वह रिपोर्ट करता है: डॉक्यूमेंट लोड, रूट बदलाव, इंटरैक्शन।",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP, INP, CLS, FCP और TTFB, जब आपका ऐप उन्हें मेट्रिक्स के रूप में रिपोर्ट करता है।",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **लॉग**, **ट्रेस** और **मेट्रिक्स** — टेलीमेट्री एक्सप्लोरर, इसी एप्लिकेशन तक सीमित।",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **क्लाइंट्स** — वे ब्राउज़र प्लेटफ़ॉर्म जिन पर एप्लिकेशन देखा गया है, `browser.platform` से। प्लेटफ़ॉर्म के स्तर पर, कभी हर अंतिम उपयोगकर्ता के स्तर पर नहीं।",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **सेशन रीप्ले** — एक अलग, वैकल्पिक रिकॉर्डर, जिसका अपना स्क्रिप्ट टैग और गोपनीयता नियंत्रण हैं: [सेशन रीप्ले](/docs/telemetry/session-replay)।",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "जब तक टेलीमेट्री आती रहती है, एप्लिकेशन **डेटा मिल रहा है** दिखाता है, और 15 मिनट तक कुछ न आने पर **हाल में कोई ट्रैफ़िक नहीं**, जो तब सामान्य है जब कोई ऐप का उपयोग नहीं कर रहा।",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "DevTools → **Network** खोलें और `otlp` से फ़िल्टर करें: आप `POST /otlp/v1/traces` ढूँढ रहे हैं। कोई अनुरोध न होने का मतलब है कि SDK कभी शुरू ही नहीं हुआ:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` सबसे पहले आयात नहीं हो रहा। इंस्ट्रुमेंटेशन `fetch` को पैच करते हैं; उनसे पहले आयात हुई चीज़ ट्रेस नहीं होती, और अगर tree-shaking आयात हटा दे, तो कुछ भी नहीं चलता।",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- बैच प्रोसेसर ने अभी फ़्लश नहीं किया है। `BatchSpanProcessor` बफ़र करता है — यह मानने से पहले कि कुछ नहीं भेजा जा रहा, लगभग 30 सेकंड प्रतीक्षा करें या किसी दूसरे पेज पर जाएँ।",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- कोई बिल्ड-टाइम एनवायरनमेंट वेरिएबल `undefined` निकला, इसलिए एक्सपोर्टर URL गलत है। स्टार्टअप पर उसे एक बार लॉग करें।",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Content Security Policy ने ब्लॉक किया** — कंसोल यह बताता है। `connect-src 'self' <YOUR_ONEUPTIME_URL>;` जोड़ें (चरण 4)।",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **CORS ने ब्लॉक किया** — OneUptime के OTLP एंडपॉइंट किसी भी ऑरिजिन और `x-oneuptime-token` हेडर को अनुमति देते हैं, इसलिए CORS विफलता का लगभग हमेशा मतलब है कि अनुरोध OneUptime तक पहुँच ही नहीं रहा: कोई कॉर्पोरेट प्रॉक्सी, ऐड-ब्लॉकर या होस्ट में टाइपो।",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — अपनी साइट का सटीक ऑरिजिन (स्कीम, होस्ट और पोर्ट) **प्रोजेक्ट सेटिंग्स > टेलीमेट्री और APM > इंजेशन कुंजियाँ** में कुंजी के **अनुमत ऑरिजिन** में जोड़ें।",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — वहाँ कुंजी को फिर से चालू करें, या चरण 1 में दूसरी कुंजी चुनें।",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — कुंजी अज्ञात, रद्द या समाप्त है। चरण 5 में कुंजी जाँच चलाएँ, और चरण 1 में एक मान्य ब्राउज़र कुंजी चुनें या बनाएँ।",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — URL गलत है। ट्रेस एक्सपोर्टर को पूरा पाथ चाहिए, `/otlp/v1/traces`।",
  "The telemetry was sent with a key other than a Browser key, and its resource carries no browser attribute, so it was filed as a backend Service. Send with a Browser key (step 1), which files everything it sends as this app, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "टेलीमेट्री ब्राउज़र कुंजी के अलावा किसी दूसरी कुंजी से भेजी गई थी, और उसके रिसोर्स में कोई ब्राउज़र एट्रिब्यूट नहीं है, इसलिए वह बैकएंड सेवा के रूप में दर्ज हुई। ब्राउज़र कुंजी (चरण 1) से भेजें, जो अपनी भेजी हर चीज़ को इसी ऐप के रूप में दर्ज करती है, या `browser.*` एट्रिब्यूट खुद सेट करें (उन्नत में **OneUptime ब्राउज़र ऐप को कैसे पहचानता है**)।",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "DevTools → **Network** → OTLP अनुरोध → **Payload** में देखें कि आप क्या भेज रहे हैं: `resourceSpans[0].resource.attributes` वह सूची है जो यह तय करती है।",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "जो सेवा पहले ही बन चुकी है, वह RUM एप्लिकेशन में नहीं बदलती — ये दो अलग रिकॉर्ड हैं — इसलिए RUM टेलीमेट्री आने पर उसे हटा दें।",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "क्लाइंट पंक्तियाँ `browser.platform` से आती हैं। `browserDetector` UA Client Hints API पढ़ता है, जो केवल Chromium ब्राउज़र में होता है: Safari और Firefox पर यह `browser.language` सेट करता है — टेलीमेट्री को RUM के रूप में वर्गीकृत करने के लिए काफ़ी — लेकिन `browser.platform` नहीं। उन क्लाइंट्स को सूचीबद्ध करने के लिए `browser.platform` खुद सेट करें (उन्नत में **OneUptime ब्राउज़र ऐप को कैसे पहचानता है**)।",
  "The card is filled only from metrics your app emits. Check, in order:":
    "कार्ड केवल उन मेट्रिक्स से भरता है जिन्हें आपका ऐप भेजता है। इस क्रम में जाँचें:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. आपके पास **मेट्रिक्स** पाइपलाइन है भी — केवल ट्रेस से यह कार्ड कभी नहीं भरता।",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. मेट्रिक नाम वही हैं जिन्हें OneUptime पढ़ता है — देखें [Core Web Vitals](/docs/rum/web-vitals)।",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. मेट्रिक्स एप्लिकेशन के **मेट्रिक्स** टैब में दिखते हैं। अगर दिखते हैं, तो एक्सपोर्ट काम कर रहा है और समस्या नाम या चुनी गई समय सीमा में है।",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP और CLS तब रिपोर्ट होते हैं जब पेज छिप जाता है, इसलिए छोटी विज़िट अगले एक्सपोर्ट से पहले खत्म हो सकती है।",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **समय सीमा जाँचें।** अवलोकन डिफ़ॉल्ट रूप से पिछला घंटा दिखाता है, इसलिए आज सुबह का टेस्ट उससे बाहर रहता है।",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **एक मिनट प्रतीक्षा करें।** इंजेशन एक क्यू से होकर जाता है, और किसी एक टेस्ट स्पैन को दिखने में एक मिनट तक लग सकता है।",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **प्रोजेक्ट जाँचें।** टेलीमेट्री किस प्रोजेक्ट में जाएगी, यह कुंजी तय करती है।",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "15 मिनट तक कोई टेलीमेट्री न आने पर स्थिति **हाल में कोई ट्रैफ़िक नहीं** हो जाती है। जब कोई ऐप का उपयोग नहीं कर रहा, तब ऐसा होना अपेक्षित है। अगर आपके ऐप पर ट्रैफ़िक है:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- हो सकता है कोई **सैंपलर** सब कुछ हटा रहा हो — जाँचें कि आपने हमेशा बंद रहने वाला या बहुत कम अनुपात वाला सैंपलर सेट नहीं किया है।",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- हो सकता है ऐप केवल उन इंटरैक्शन पर भेजता हो जो उस अवधि में किसी ने नहीं किए।",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- हो सकता है डिप्लॉय के बाद कुंजी रद्द कर दी गई हो — चरण 5 में कुंजी जाँच चलाएँ।",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` **`storefront-web`** है, जो इस एप्लिकेशन की पहचान है — इसे वैसा ही रखें, वरना डेटा एक नए एप्लिकेशन के रूप में दर्ज होगा।",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "OpenTelemetry SDK वाला एक iOS, Android या React Native ऐप — opentelemetry-swift, OpenTelemetry Android या OpenTelemetry JavaScript SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "आपका ऐप जो `service.name` रिपोर्ट करता है — चरण 1 की **मोबाइल** कुंजी उसी पर पिन है",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "ये मानक OpenTelemetry सेटिंग्स हैं: जो SDK इन्हें अपने एनवायरनमेंट से पढ़ता है, वह इन्हें जैसे का तैसा लेता है। नहीं तो कोड में SDK के OTLP एक्सपोर्टर और रिसोर्स पर वही एंडपॉइंट, `x-oneuptime-token` हेडर और रिसोर्स एट्रिब्यूट सेट करें — [मोबाइल सेटअप](/docs/rum/mobile-setup) Android, iOS और React Native के लिए यह दिखाता है।",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "ज़्यादातर मोबाइल SDK आपके लिए `device.*` एट्रिब्यूट सेट करते हैं। `device.model.identifier` **क्लाइंट्स** टैब भरता है, इसलिए अगर आपका SDK इसे सेट नहीं करता, तो ऊपर की तरह सेट करें।",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    '`200` और `"valid": true` का मतलब है कि OneUptime कुंजी स्वीकार करता है, और मोबाइल कुंजी के लिए संदेश यह भी जोड़ता है कि यह केवल मोबाइल ऐप से काम करती है। `401` का मतलब है कि कुंजी अज्ञात, रद्द, अक्षम या समाप्त है, और कोई भी SDK कॉन्फ़िगरेशन इसे ठीक नहीं करेगा।',
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "फिर ऐप शुरू करें। यह टेलीमेट्री के अपने पहले बैच के साथ **वास्तविक उपयोगकर्ता मॉनिटरिंग** में दिखता है, उसी सेवा नाम से जिस पर कुंजी पिन है।",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "मोबाइल कुंजी जो कुछ भी भेजती है, वह इसी मोबाइल ऐप के रूप में, उसी सेवा नाम के तहत दर्ज होता है जिस पर कुंजी पिन है, चाहे उसका रिसोर्स कुछ भी कहे। कुंजी रिसोर्स में से केवल वही रखती है जो कोई ऐप अपने बारे में बताता है — जैसे उसके `service.*`, `device.*`, `os.*` और `telemetry.*` एट्रिब्यूट और उसके `oneuptime.label.*` लेबल — और बाकी हटा देती है, ताकि कॉपी की गई कुंजी अपनी टेलीमेट्री को किसी होस्ट, क्लस्टर या बैकएंड सेवा की टेलीमेट्री के रूप में न दिखा सके।",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "किसी भी दूसरी कुंजी के साथ, OneUptime टेलीमेट्री को **मोबाइल RUM** के रूप में वर्गीकृत करता है जब उसके रिसोर्स में `device.id` या `device.model.identifier` होता है। एप्लिकेशन की पहचान `service.name` (केस-असंवेदनशील) से होती है, और उसकी टेलीमेट्री इसी RUM एप्लिकेशन की होती है — इसे कभी बैकएंड सेवा के रूप में दोबारा दर्ज नहीं किया जाता।",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **इनमें से एक** | टेलीमेट्री को मोबाइल RUM के रूप में चिह्नित करता है। `device.model.identifier` **क्लाइंट्स** टैब भी भरता है। |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` भी किसी बैच को मोबाइल के रूप में चिह्नित करता है, लेकिन केवल ऐसे रिसोर्स पर जिसमें `host.name` या `host.id` न हो — यह किसी होस्ट की इन्वेंटरी प्रविष्टि में भौतिक मशीन का निर्माता भी बताता है। `device.id` या `device.model.identifier` भी सेट करें, तो यह अंतर कभी सामने नहीं आता।",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` हर इंस्टॉल का पहचानकर्ता होना चाहिए, कोई विज्ञापन ID या ऐसी कोई चीज़ नहीं जो किसी व्यक्ति की पहचान करे।",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs, metrics and session replays, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **आपका ऐप रखने वाला कोई भी उसकी कुंजी कॉपी कर सकता है।** इसीलिए यह मोबाइल कुंजी है: कॉपी केवल इसी ऐप के ट्रेस, लॉग, मेट्रिक्स और सेशन रीप्ले भेज सकती है, जो उसी सेवा नाम के तहत दर्ज होते हैं जिस पर कुंजी पिन है, और कभी किसी वेब पेज से नहीं। फिर भी वह कुंजी की सीमा तक इस ऐप के लिए गढ़ा हुआ डेटा भेज सकती है, इसलिए समाप्ति तिथि तय करें, हर रिलीज़ के साथ कुंजी बदलें, और दुरुपयोग होने पर उसे बंद कर दें।",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "ये सब **प्रोजेक्ट सेटिंग्स > टेलीमेट्री और APM > इंजेशन कुंजियाँ** में कुंजी के पेज पर हैं: **पिन किया गया सेवा नाम** वह ऐप है जिसके तहत कुंजी की भेजी हर चीज़ दर्ज होती है, **प्रति मिनट अनुरोध सीमा** आपके ऐप की सभी कॉपियों पर कुंजी को सीमित करती है, **इस समय समाप्त होता है** किसी तिथि के बाद उसका स्वीकार होना बंद कर देता है, और **सक्षम** उसे तुरंत बंद कर देता है।",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "इसके बजाय कभी किसी ऐप में **सर्वर** कुंजी न भेजें: यह कहीं से भी, किसी भी सेवा के रूप में, इस प्रोजेक्ट में हर तरह की टेलीमेट्री लिख सकती है।",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) एजेंट (`io.opentelemetry.android:android-agent`) अपने रिसोर्स पर `device.model.identifier`, `device.model.name` और `device.manufacturer` सेट करता है, इसलिए वर्गीकरण बिना अतिरिक्त कॉन्फ़िगरेशन के काम करता है, और यह क्रैश, ANR, धीमे और जमे हुए फ़्रेम, ऐप स्टार्ट और सेशन खुद रिपोर्ट करता है। जब तक आप `service.name` सेट न करें, यह ऐप का नाम उसके लॉन्चर लेबल से रखता है, और यह `device.id` नहीं भेजता। [Android सेटअप](/docs/rum/android-setup) में Gradle डिपेंडेंसी, कोड, और OneUptime में हर एक क्या बनता है, दिया है।",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) के साथ, रिसोर्स पर `device.model.identifier` और `device.manufacturer` खुद सेट करें: SDK का कोई संस्करण जो रिसोर्स जोड़ता है, वह रिलीज़ के बीच बदलता रहा है।",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app, and so do its [session replays](/docs/telemetry/session-replay#install-in-react-native): give the replay SDK the same key, with the key's pinned service name as `appIdentifier`.":
    "- **React Native / Expo** — JavaScript SDK चलाता है, इसलिए सेटअप [ब्राउज़र सेटअप](/docs/rum/browser-setup) वाला ब्राउज़र सेटअप ही है, दो अंतरों के साथ: कोई `browserDetector` नहीं है, और आप `device.manufacturer` और `device.model.identifier` खुद सेट करते हैं ताकि **क्लाइंट्स** टैब डिवाइस सूचीबद्ध करे। यह किसी भी मोबाइल ऐप की तरह **मोबाइल** कुंजी से भेजता है, और इसके [सेशन रीप्ले](/docs/telemetry/session-replay#install-in-react-native) भी: रीप्ले SDK को वही कुंजी दें, और कुंजी के पिन किए गए सेवा नाम को `appIdentifier` के रूप में दें।",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **कुछ और** — Flutter, Unity, .NET MAUI या हाथ से लिखा OTLP राइटर भी इसी तरह काम करते हैं, जब तक रिसोर्स में `service.name` के साथ एक `device.*` एट्रिब्यूट हो।",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "OpenTelemetry मोबाइल SDK रिलीज़ के बीच अपने बिल्डर API बदलते रहते हैं। [मोबाइल सेटअप](/docs/rum/mobile-setup) में हर एक के लिए कोड है; मेथड के नाम उस संस्करण से मिलाकर देखें जिसे आप पिन करते हैं।",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "`oneuptime.label.` उपसर्ग वाला कोई भी रिसोर्स एट्रिब्यूट एप्लिकेशन पर प्रोजेक्ट लेबल बन जाता है — `oneuptime.label.env=production` से `env:production` लेबल जुड़ता है:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **अवलोकन** — चुनी जा सकने वाली समय सीमा में इवेंट, त्रुटि दर और p95 अवधि, ट्रेंड चार्ट के साथ, जो आपके इंस्ट्रुमेंटेशन से निकलने वाले स्पैन से बनते हैं।",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **अपवाद** — आपका ऐप जो क्रैश और ANR रिपोर्ट करता है, वे अनहैंडल्ड अपवादों के रूप में अवलोकन में और **अपवाद** में दिखते हैं। OpenTelemetry Android दोनों खुद रिपोर्ट करता है; ANR `ANR` प्रकार के साथ सूचीबद्ध होता है।",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **क्लाइंट्स** — वे डिवाइस मॉडल जिन पर एप्लिकेशन देखा गया है, `device.model.identifier` से। मॉडल के स्तर पर, कभी हर अंतिम उपयोगकर्ता के स्तर पर नहीं।",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "`401` का मतलब है कि कुंजी अज्ञात, रद्द, अक्षम या समाप्त है: चरण 1 में मोबाइल कुंजी चुनें या बनाएँ और उसके साथ ऐप फिर से बिल्ड करें।",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and its session replays, and never from a web page: an SDK that exports over gRPC, a request that carries an `Origin` header, or another app's recording, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "`422` बताता है कि क्या अस्वीकार हुआ। मोबाइल कुंजी केवल ऐप के OTLP ट्रेस, लॉग और मेट्रिक्स HTTP पर, और उसके सेशन रीप्ले भेजती है, और कभी किसी वेब पेज से नहीं: gRPC पर एक्सपोर्ट करने वाला SDK, `Origin` हेडर वाला अनुरोध, या किसी दूसरे ऐप की रिकॉर्डिंग अस्वीकार होती है। ब्राउज़र कुंजी जाँच पास कर लेती है लेकिन मोबाइल ऐप से अस्वीकार होती है, क्योंकि उसे `Origin` हेडर चाहिए और मोबाइल SDK कोई नहीं भेजते।",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "टेलीमेट्री सर्वर कुंजी से भेजी गई थी, और उसके रिसोर्स में न `device.id` है न `device.model.identifier`, इसलिए वह बैकएंड सेवा के रूप में दर्ज हुई। मोबाइल कुंजी (चरण 1) से भेजें, जो अपनी भेजी हर चीज़ को इसी ऐप के रूप में दर्ज करती है, या चरण 2 की तरह उन्हें SDK के रिसोर्स पर सेट करें।",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "क्लाइंट पंक्तियाँ खास तौर पर `device.model.identifier` से आती हैं। जो SDK केवल `device.manufacturer` सेट करता है, वह मोबाइल के रूप में वर्गीकृत होता है लेकिन कोई क्लाइंट सूचीबद्ध नहीं करता — `device.model.identifier` भी सेट करें।",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "15 मिनट तक कोई टेलीमेट्री न आने पर स्थिति **हाल में कोई ट्रैफ़िक नहीं** हो जाती है। जब कोई ऐप का उपयोग नहीं कर रहा, तब ऐसा होना अपेक्षित है। अगर आपका ऐप उपयोग में है:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- हो सकता है रिलीज़ के बाद कुंजी रद्द कर दी गई हो — चरण 3 में कुंजी जाँच चलाएँ।",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` **`Storefront Mobile`** है, जो इस एप्लिकेशन की पहचान है — इसे वैसा ही रखें, वरना डेटा एक नए एप्लिकेशन के रूप में दर्ज होगा। `OTEL_RESOURCE_ATTRIBUTES` में यह percent-encoded होता है, और SDK इसे डिकोड करता है।",
};

export default TRANSLATION;
