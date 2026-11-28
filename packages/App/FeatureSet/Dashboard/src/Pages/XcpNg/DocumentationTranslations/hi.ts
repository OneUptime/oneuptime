import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 या नया, जो उन पूल से जुड़ा हो जिनकी आप निगरानी करना चाहते हैं। XOA पर इसके OpenMetrics प्लगइन के लिए Premium लाइसेंस चाहिए; सोर्स से बने Xen Orchestra में यह पहले से शामिल है",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Compose v2 प्लगइन के साथ Docker Engine 20.10 या नया, ऐसी मशीन पर जो HTTPS पर Xen Orchestra तक पहुँच सके",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Xen Orchestra पर एक प्रमाणपत्र जो उस पते का नाम देता हो जिससे एजेंट जुड़ता है। Xen Orchestra अपने लिए जो सेल्फ़-साइन्ड प्रमाणपत्र बनाता है, वह कोई नाम नहीं देता, इसलिए कोई भी मौजूदा TLS क्लाइंट उसे जाँच नहीं सकता — उन्नत में **Xen Orchestra का प्रमाणपत्र** देखें",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. Xen Orchestra में *Settings → Plugins* खोलें और **openmetrics** ढूँढें।",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. इसे चालू करें। पहली बार शुरू होने पर यह एक सीक्रेट बनाता है और उसे रखता है, और Xen Orchestra उसे रीस्टार्ट के बाद भी बनाए रखता है।",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. प्लगइन की सेटिंग्स खोलें और उसका **Prometheus secret** कॉपी करें — इसे आप अगले चरण में एजेंट को देंगे। आप वहाँ अपना खुद का सीक्रेट टाइप करके सहेज भी सकते हैं।",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "प्लगइन Xen Orchestra के अपने पते और प्रमाणपत्र पर, `/openmetrics/metrics` पर जवाब देता है, और सिर्फ़ उस अनुरोध को जिसमें उसका सीक्रेट हो। यह हर उस पूल को देता है जिससे Xen Orchestra जुड़ा है, इसलिए एक ही एजेंट सबको कवर करता है।",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "स्क्रिप्ट आपका OneUptime URL और इंजेशन कुंजी पूछती है, दोनों चरण 1 में दिखते हैं (उन्हें यहाँ भरा पाने के लिए वहाँ एक कुंजी चुनें), और फिर ये पूछती है:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Xen Orchestra का पता** — जैसे आप उसे ब्राउज़र में खोलते हैं, जैसे `https://xo.example.com` या `https://10.0.0.5:8443`।",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **OpenMetrics प्लगइन का सीक्रेट** — पिछले चरण से। टाइप करते समय यह दिखता नहीं है।",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **इस Xen Orchestra को क्या कहें** — वह नाम जो इसका हर पूल अपनी सेटिंग्स में दिखाता है। इसका पता इस्तेमाल करने के लिए Enter दबाएँ।",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "फिर स्क्रिप्ट Xen Orchestra का प्रमाणपत्र पढ़ती है। अगर यह मशीन उस पर पहले से भरोसा करती है, तो एजेंट उसी CA बंडल पर भरोसा करता है। अगर नहीं, तो स्क्रिप्ट प्रमाणपत्र का SHA-256 फ़िंगरप्रिंट दिखाती है: इसे Xen Orchestra की मशीन वाले फ़िंगरप्रिंट से मिलाएँ और सिर्फ़ उसी प्रमाणपत्र पर भरोसा करने के लिए **y** जवाब दें। यह जाँच को कभी बंद नहीं करती। कुछ भी इंस्टॉल करने से पहले यह सीक्रेट के साथ प्लगइन से उसके मेट्रिक्स माँगती है और बताती है कि Xen Orchestra कौन-से पूल रिपोर्ट करता है।",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "यह `/opt/oneuptime-xcp-ng-agent` में इंस्टॉल होती है, `0600` वाली एक `.env` फ़ाइल लिखती है और Docker Compose से एजेंट शुरू करती है। स्क्रिप्ट दोबारा चलाने पर वह फिर से पूछने के बजाय उस `.env` की हर चीज़ फिर से इस्तेमाल करती है, इसलिए अपग्रेड भी इसी तरह होता है।",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` में `oneuptime-xcp-ng-agent` दिखता है। उसके लॉग में `Everything is ready. Begin running and processing data.` देखें। एजेंट हर मिनट Xen Orchestra को पढ़ता है, और वह जिस भी पूल की रिपोर्ट करता है, वह फिर **XCP-ng** सेक्शन में उस नाम से दिखता है जो Xen Orchestra उसे देता है, अपने होस्ट, VM और स्टोरेज के साथ।",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "इंस्टॉल स्क्रिप्ट इन्हें `/opt/oneuptime-xcp-ng-agent/.env` में लिखती है। किसी एक को बदलने के बाद उसे `/opt/oneuptime-xcp-ng-agent` में `docker compose up -d` से लागू करें।",
  "| Variable | Required | Description |": "| वेरिएबल | ज़रूरी | विवरण |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | हाँ | आपके OneUptime इंस्टेंस का URL (जैसे `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | हाँ | टेलीमेट्री इंजेशन कुंजी, वही जो चरण 1 में चुनी गई |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | हाँ | Xen Orchestra का `host` या `host:port`, बिना स्कीम के |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | नहीं | `https` (डिफ़ॉल्ट)। `http` सिर्फ़ लैब में: तब सीक्रेट नेटवर्क पर बिना एन्क्रिप्शन के जाता है |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | हाँ | OpenMetrics प्लगइन का सीक्रेट, Bearer टोकन के रूप में भेजा जाता है। इसमें हर `$` को `$$` लिखा जाता है |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | नहीं | OneUptime में इस Xen Orchestra को क्या कहें, जो इसके हर पूल की सेटिंग्स में दिखता है (डिफ़ॉल्ट: इसका पता) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | नहीं | वह नाम जिससे Xen Orchestra का प्रमाणपत्र जाँचा जाता है, जब `XO_ADDRESS` ऐसा पता हो जो प्रमाणपत्र में नहीं है |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | नहीं | एजेंट के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-xcp-ng-agent`)। उसी मशीन पर दूसरे Xen Orchestra के एजेंट को अपना अलग नाम चाहिए: अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट नए एजेंट का नाम उसके फ़ोल्डर पर रखती है, और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | इंस्टॉल स्क्रिप्ट | Xen Orchestra का पता जैसा टाइप किया गया; स्क्रिप्ट इसी से `XO_SCHEME` और `XO_ADDRESS` निकालती है |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | इंस्टॉल स्क्रिप्ट | Xen Orchestra के अपने प्रमाणपत्र का SHA-256 फ़िंगरप्रिंट, जब एजेंट सिर्फ़ उसी प्रमाणपत्र पर भरोसा करता है |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | इंस्टॉल स्क्रिप्ट | Xen Orchestra का प्रमाणपत्र जारी करने वाला CA बंडल, जिसे स्क्रिप्ट `xo-ca.pem` में कॉपी करती है |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | नहीं | ऐसे Xen Orchestra उपयोगकर्ता का टोकन जिसके पास बिल्ट-इन **Read only** भूमिका की एक कॉपी हो और कुछ नहीं: इसके सेट होने पर XCP-ng AI एजेंट चलता है, और इसी से पढ़ता है |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | नहीं | केवल सुधारों के लिए: किसी दूसरे उपयोगकर्ता का टोकन, जिसकी भूमिका उनकी अनुमति देती है। इसके बिना AI एजेंट कुछ नहीं बदलता |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | नहीं | उस पूल का XAPI UUID जिसे AI एजेंट सेवा देता है (डिफ़ॉल्ट: वह एकमात्र पूल जिसे उसका पढ़ने वाला टोकन देख सकता है) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | नहीं | `XCP_NG_POOL_ID` को उस पूल के रूप में ओवरराइड करता है जिसके रूप में AI एजेंट रजिस्टर होता है |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | नहीं | `true` या `false`: क्या OneUptime AI जाँच के दौरान AI एजेंट के केवल-पढ़ने वाले कमांड चला सकता है (डिफ़ॉल्ट: चालू) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | नहीं | `off`, `ask-for-approval`, `automatic` या `bypass-approval`: OneUptime AI कोई सुधार कैसे लागू कर सकता है |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | नहीं | `true` AI एजेंट को बदलावों वाले टोकन के साथ सुधार लागू करने देता है। कोई भी दूसरा मान उसे केवल-पढ़ने वाला रखता है |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | नहीं | वे `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` या `schedule/<uuid>` जिन्हें कोई सुधार छू सकता है, कॉमा से अलग (डिफ़ॉल्ट: सभी) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | नहीं | वही, उसके लिए जिसे OneUptime AI को कभी नहीं बदलना चाहिए: वह VM जिसमें AI एजेंट चलता है, और Xen Orchestra का अपना VM |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | नहीं | AI एजेंट का लॉग स्तर: `debug`, `info` (डिफ़ॉल्ट), `warn` या `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | नहीं | `xcp-ng-ai-agent` AI एजेंट को शुरू करता है; इंस्टॉल स्क्रिप्ट पढ़ने वाला टोकन सेट होने पर इसे लिखती है |",
  "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-xcp-ng-ai-agent`). The install script names a second Xen Orchestra's AI agent after its collector (`oneuptime-xcp-ng-ai-agent-lab` beside `oneuptime-xcp-ng-agent-lab`) unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | नहीं | AI एजेंट के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-xcp-ng-ai-agent`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे Xen Orchestra के AI एजेंट का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-xcp-ng-ai-agent-lab`, `oneuptime-xcp-ng-agent-lab` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "एजेंट Xen Orchestra के प्रमाणपत्र को `docker-compose.yml` के बगल वाली `xo-ca.pem` से जाँचता है।",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "एजेंट हर बार पढ़ते समय Xen Orchestra के प्रमाणपत्र को सिर्फ़ `xo-ca.pem` से जाँचता है। इस फ़ाइल में इन तीन में से एक चीज़ होती है:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Xen Orchestra का अपना प्रमाणपत्र**, उसके SHA-256 फ़िंगरप्रिंट (`XO_TLS_FINGERPRINT`) से पिन किया हुआ: एजेंट सिर्फ़ उसी प्रमाणपत्र पर भरोसा करता है।",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **उसे जारी करने वाला CA** (`XO_CA_FILE`), आपके अपने CA के प्रमाणपत्र के लिए।",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **इस मशीन का CA बंडल**, उस प्रमाणपत्र के लिए जिस पर यह मशीन पहले से भरोसा करती है।",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "हर हाल में प्रमाणपत्र को उस पते का नाम देना होगा जिससे एजेंट जुड़ता है: हर मौजूदा TLS क्लाइंट की तरह एजेंट उन नामों को जाँचता है जिनके लिए प्रमाणपत्र जारी हुआ है, उसके सब्जेक्ट को नहीं। Xen Orchestra अपने लिए जो सेल्फ़-साइन्ड प्रमाणपत्र बनाता है, वह कोई नाम नहीं देता, इसलिए पिन हो या न हो, एजेंट उस पर भरोसा नहीं कर सकता और `x509: certificate is not valid for any names` के साथ विफल होता है। Xen Orchestra को ऐसा प्रमाणपत्र दें जो उसके पते का नाम देता हो — आपके CA से, या सब्जेक्ट ऑल्टरनेटिव नेम (subject alternative name) वाला सेल्फ़-साइन्ड प्रमाणपत्र — जैसा [Xen Orchestra का प्रमाणपत्र](/docs/telemetry/xcp-ng#xen-orchestras-certificate) बताता है।",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "जब प्रमाणपत्र Xen Orchestra को `XO_ADDRESS` के पते से अलग नाम से बताता है, तो `XO_TLS_SERVER_NAME` को वही नाम सेट करें। जब कोई पिन किया गया प्रमाणपत्र नवीनीकृत होता है, तो एजेंट तब तक Xen Orchestra को पढ़ना बंद कर देता है जब तक वह नए पर भरोसा न करे। इंस्टॉल स्क्रिप्ट फिर से चलाएँ: यह नया फ़िंगरप्रिंट दिखाती है और कुछ भी बदले बिना रुक जाती है। उस फ़िंगरप्रिंट को Xen Orchestra की मशीन पर जाँचें, फिर उसके साथ स्क्रिप्ट एक बार और चलाएँ: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`।",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "एजेंट हर मिनट प्लगइन को पढ़ता है, जो हर होस्ट के XAPI राउंड-रॉबिन डेटाबेस 60 सेकंड के रिज़ॉल्यूशन पर पढ़ता है। एजेंट `xcp_*` सीरीज़ रखता है, और हर सीरीज़ के पूल को अपने भेजे जाने वाले बैच पर ले जाता है, `xcp_ng.pool.id` (पूल का UUID, जो कभी नहीं बदलता) और `xcp_ng.pool.name` के रूप में:",
  "| Category | Series |": "| श्रेणी | सीरीज़ |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **पूल** | `xcp_pool_connected` — तब तक मौजूद रहती है जब तक Xen Orchestra पूल से जुड़ा है |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **होस्ट** | `xcp_host_status` (पावर स्थिति और क्या यह सक्षम है), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, हर इंटरफ़ेस के लिए `xcp_host_network_*`, हर स्टोरेज रिपॉजिटरी के लिए `xcp_host_disk_*` |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU की होड़), `xcp_vm_memory_*`, हर इंटरफ़ेस के लिए `xcp_vm_network_*`, हर डिस्क के लिए `xcp_vm_disk_*`, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **स्टोरेज** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, उन पूल पर जो XOSTOR चलाते हैं |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'कंट्रोल डोमेन `is_control_domain="true"` वाले VM के रूप में रिपोर्ट होते हैं; जब तक आप न माँगें, पेज उन्हें छिपाए रखते हैं।',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra आठ थ्रूपुट सीरीज़ को काउंटर के रूप में टाइप करता है, जबकि हर एक में XAPI की प्रति सेकंड दर होती है: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, और VM की नेटवर्क, नेटवर्क त्रुटि तथा डिस्क पढ़ने और लिखने की सीरीज़। एजेंट उनके मान छुए बिना उन्हें गेज में बदल देता है, ताकि OneUptime उन्हें उन्हीं दरों के रूप में सहेजे जो वे हैं, बाइट या त्रुटि प्रति सेकंड में।",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime हर पूल के लिए चार 0/1 सीरीज़ जोड़ता है, जिन्हें अलर्ट टेम्पलेट पढ़ते हैं: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` और `xcp_ng.vm.stopped_after_running` (रुका हुआ या पॉज़ किया हुआ VM जो पिछले एक दिन में चला था)। यह हर पॉइंट पर `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` या `xostor`) और `xcp_ng.id` (उस ऑब्जेक्ट का UUID) भी लगाता है, जिन पर मॉनिटर और डैशबोर्ड फ़िल्टर करते हैं।",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "नहीं रखा जाता: Xen Orchestra की अपनी प्रोसेस सीरीज़ (`xo_*`), जो किसी पूल की नहीं हैं, और IPMI से पढ़ी गई होस्ट की पावर, जिसे प्लगइन उसके पूल के बिना भेजता है। उसमें हर VM का अनुमानित हिस्सा रखा जाता है।",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "एक एजेंट एक Xen Orchestra और उसके प्रबंधित हर पूल को पढ़ता है। दूसरे Xen Orchestra के लिए, दूसरा एजेंट उसके अपने फ़ोल्डर में, उसके अपने कंटेनर नाम के साथ इंस्टॉल करें — दो कंटेनर एक ही नाम नहीं रख सकते:",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "`XCP_NG_AGENT_CONTAINER_NAME` के बिना स्क्रिप्ट कंटेनर का नाम फ़ोल्डर के नाम पर रखती है। स्क्रिप्ट यह नाम उस एजेंट की `.env` में सहेज लेती है, इसलिए एजेंट अपग्रेड करने के लिए स्क्रिप्ट फिर से चलाने पर भी नाम बना रहता है, और जिस एजेंट का `container_name` आपने कभी `docker-compose.yml` में बदला था, वह वही नाम रखता है। Docker Compose के साथ, इसके बजाय हर एजेंट की `.env` में `XCP_NG_AGENT_CONTAINER_NAME` सेट करें।",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "एक ही पूल को प्रबंधित करने वाले दो Xen Orchestra दोनों को पढ़ा न जाने दें: अपने UUID से वह पूल OneUptime में एक ही पूल है, और उसकी रिपोर्ट दो बार आएगी।",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "`oneuptime.label.` उपसर्ग वाला कोई भी रिसोर्स एट्रिब्यूट एजेंट के पढ़े हर पूल पर एक प्रोजेक्ट लेबल बन जाता है: `oneuptime.label.<dimension>=<value>` लेबल `<dimension>:<value>` है। इन्हें `otel-collector-config.yaml` के `resource` प्रोसेसर में `oneuptime.agent.version` के बगल में जोड़ें:",
  "Then restart the collector so it reads the new config:":
    "फिर कलेक्टर को रीस्टार्ट करें ताकि वह नया कॉन्फ़िग पढ़े:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "पूल `team:platform` और `env:production` लेबल के साथ दिखते हैं। लेबल बड़े-छोटे अक्षरों का भेद किए बिना मिलाए जाते हैं, इसलिए मौजूदा `Production` लेबल फिर से इस्तेमाल होता है; OneUptime इंटरफ़ेस में जोड़े गए लेबल एजेंट कभी नहीं हटाता। इंस्टॉल स्क्रिप्ट दोबारा चलाने से बदली हुई `otel-collector-config.yaml` बदल दी जाती है और आपकी फ़ाइल उसके बगल में `otel-collector-config.yaml.bak.<timestamp>` के रूप में रखी जाती है।",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**अपग्रेड करें** — कलेक्टर इमेज `docker-compose.yml` में पिन है और उसका कॉन्फ़िग उसके बगल की एक फ़ाइल है, इसलिए सिर्फ़ इमेज पुल करने से एजेंट आगे नहीं बढ़ता। इंस्टॉल स्क्रिप्ट फिर से चलाएँ। यह आपकी मौजूदा `.env` का हर मान फिर से इस्तेमाल करती है (कुछ भी दोबारा नहीं पूछा जाता), Xen Orchestra के प्रमाणपत्र को उसी तरह जाँचती है, नवीनतम `docker-compose.yml` और `otel-collector-config.yaml` डाउनलोड करती है — आपकी बदली हुई फ़ाइल नई फ़ाइल के बगल में `<file>.bak.<timestamp>` के रूप में रखी जाती है —, इमेज पुल करती है और उससे एजेंट को फिर से बनाती है:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "कॉन्फ़िग अपने पिन किए कलेक्टर संस्करण को हर पूल के **एजेंट संस्करण** के रूप में बताता है। जब यह OneUptime कोई नया संस्करण पिन करता है, तो उसके बगल का चेतावनी चिह्न ये कमांड खोलता है।",
  "**Uninstall** the agent:": "एजेंट को **अनइंस्टॉल करें**:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "फिर अगर कुछ और इसे नहीं पढ़ता, तो Xen Orchestra में OpenMetrics प्लगइन बंद कर दें।",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` पूरी कड़ी जाँचती है — कंटेनर, `xo-ca.pem` से Xen Orchestra का प्रमाणपत्र, प्लगइन और उसका सीक्रेट, उसके रिपोर्ट किए पूल — और सीधे OneUptime से पूछती है कि क्या वह आपकी इंजेशन कुंजी स्वीकार करता है। यही आख़िरी जाँच सबसे अहम है: OneUptime के OTLP एंडपॉइंट ग़लत कुंजी को `401` या `422` से अस्वीकार करते हैं, जिसे कलेक्टर हर बैच पर एक ही `Exporting failed` पंक्ति के रूप में लॉग करता है जो आसानी से छूट जाती है।",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "यह सबसे संभावित कारण बताने वाले फ़ैसले के साथ ख़त्म होती है। यह सीक्रेट कभी प्रिंट नहीं करती।",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "जब किसी पूल के लिए 15 मिनट तक कुछ नहीं पढ़ा जाता, तो OneUptime उसे डिस्कनेक्टेड चिह्नित करता है।",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. अगर इस Xen Orchestra के सभी पूल डिस्कनेक्टेड हैं, तो एजेंट जाँचें (`/opt/oneuptime-xcp-ng-agent` में): `docker compose ps` और `docker compose logs oneuptime-xcp-ng-agent | grep -i error`।",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. अगर सिर्फ़ एक है, तो Xen Orchestra ने उसकी रिपोर्ट करना बंद कर दिया है: Xen Orchestra में *Settings → Servers* के अंतर्गत पूल का सर्वर जुड़ा होना चाहिए। पूल के होस्ट, VM और स्टोरेज वैसे ही रहते हैं जैसे Xen Orchestra ने आख़िरी बार रिपोर्ट किए थे।",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "कलेक्टर `server returned HTTP status 401 Unauthorized` लॉग करता है। *Settings → Plugins → openmetrics* से सीक्रेट फिर से कॉपी करें, `.env` में `XO_OPENMETRICS_SECRET` को उस पर सेट करें — सिंगल कोट्स के बीच, हर `$` को `$$` लिखकर — और उसे `/opt/oneuptime-xcp-ng-agent` में `docker compose up -d` से लागू करें। 6.8 से पहले Xen Orchestra हर रीस्टार्ट पर एक नया सीक्रेट बनाता था।",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra जवाब देता है, लेकिन उसका OpenMetrics प्लगइन नहीं। *Settings → Plugins → openmetrics* में प्लगइन चालू करें (XOA पर इसके लिए Premium लाइसेंस चाहिए), और जाँचें कि Xen Orchestra 6.9 या नया है। प्लगइन चलते समय `/openmetrics/health` बिना सीक्रेट के `{"status":"ok"}` जवाब देता है।',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — प्रमाणपत्र किसी पते का नाम नहीं देता, जैसे Xen Orchestra का अपना सेल्फ़-साइन्ड प्रमाणपत्र। Xen Orchestra को ऐसा प्रमाणपत्र दें जो उसके पते का नाम देता हो।",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — उनमें से किसी एक नाम से जुड़ें, या `XO_TLS_SERVER_NAME` को उनमें से किसी एक पर सेट करें।",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` में न यह प्रमाणपत्र है, न उसे जारी करने वाला CA। प्रमाणपत्र नवीनीकृत हुआ है, या फ़ाइल में ग़लत प्रमाणपत्र है: उसे फिर से लिखें, जैसा उन्नत में **Xen Orchestra का प्रमाणपत्र** बताता है।",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra सिर्फ़ उन पूल की रिपोर्ट करता है जिनसे वह जुड़ा है, और एजेंट सिर्फ़ उसी Xen Orchestra को पढ़ता है। Xen Orchestra में *Settings → Servers* के अंतर्गत पूल का सर्वर जोड़ें; अगली बार पढ़ने पर पूल OneUptime में दिखेगा। किसी दूसरे Xen Orchestra से पढ़े जाने वाले पूल के लिए उस Xen Orchestra के बगल में अलग एजेंट चाहिए।",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **इस Xen Orchestra को क्या कहें** — कमांड में इसका नाम पहले से **`xo-paris`** है, जैसा इस पूल की सेटिंग्स दिखाती हैं।",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "कमांड में आपका OneUptime URL और इंजेशन कुंजी पहले से हैं। बाकी स्क्रिप्ट पूछती है:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "इस OneUptime से `docker-compose.yml` और `otel-collector-config.yaml` एक नए फ़ोल्डर में डाउनलोड करें:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "उनके बगल में एक `.env` फ़ाइल बनाएँ: इसमें प्लगइन का सीक्रेट होता है, इसलिए इसे `chmod 600 .env` से निजी रखें:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- `XO_ADDRESS` को Xen Orchestra के `host` या `host:port` पर सेट करें, बिना `https://` के।",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- प्लगइन का सीक्रेट सिंगल कोट्स के बीच रखें। अगर उसमें `$` है, तो हर एक को `$$` लिखें: कलेक्टर मान को एक बार और पढ़ता है।",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` वह है जो हर पूल की सेटिंग्स इस Xen Orchestra को कहती हैं।",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "फिर एजेंट को Xen Orchestra का प्रमाणपत्र दें, `docker-compose.yml` के बगल में `xo-ca.pem` के रूप में — एजेंट Xen Orchestra को सिर्फ़ इसी फ़ाइल से जाँचता है। Xen Orchestra के अपने प्रमाणपत्र पर भरोसा करने के लिए उसे पढ़ें और उसका फ़िंगरप्रिंट Xen Orchestra की मशीन वाले फ़िंगरप्रिंट से मिलाएँ:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "अगर आपके अपने CA ने इसे जारी किया है, तो इसके बजाय उस CA का प्रमाणपत्र `xo-ca.pem` में कॉपी करें; अगर किसी सार्वजनिक CA ने, तो इस मशीन का CA बंडल कॉपी करें (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`)।",
  "Start the agent:": "एजेंट शुरू करें:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "एजेंट इन्हें `docker-compose.yml` के बगल वाली `.env` फ़ाइल से पढ़ता है। किसी एक को बदलने के बाद उसे `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें।",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "जब प्रमाणपत्र Xen Orchestra को `XO_ADDRESS` के पते से अलग नाम से बताता है, तो `XO_TLS_SERVER_NAME` को वही नाम सेट करें। जब `xo-ca.pem` का प्रमाणपत्र नवीनीकृत हो, तो उसे चरण 3 की तरह फिर से पढ़ें, फिर `docker compose up -d --force-recreate` चलाएँ।",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "इन्हें एजेंट के फ़ोल्डर में चलाएँ, जिसमें `docker-compose.yml` है।",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**अपग्रेड करें** — कलेक्टर इमेज `docker-compose.yml` में पिन है और उसका कॉन्फ़िग उसके बगल की एक फ़ाइल है, इसलिए सिर्फ़ इमेज पुल करने से एजेंट आगे नहीं बढ़ता। दोनों फ़ाइलें फिर से डाउनलोड करें; आपकी `.env` और `xo-ca.pem` बनी रहती हैं, और किसी भी फ़ाइल में किया गया आपका बदलाव फिर से करना होगा:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "फिर इमेज पुल करें और एजेंट को फिर से बनाएँ, ताकि कलेक्टर अपना नया कॉन्फ़िग पढ़े:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. अगर इस Xen Orchestra के सभी पूल डिस्कनेक्टेड हैं, तो एजेंट जाँचें (एजेंट के फ़ोल्डर में): `docker compose ps` और `docker compose logs oneuptime-xcp-ng-agent | grep -i error`।",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "कलेक्टर `server returned HTTP status 401 Unauthorized` लॉग करता है। *Settings → Plugins → openmetrics* से सीक्रेट फिर से कॉपी करें, `.env` में `XO_OPENMETRICS_SECRET` को उस पर सेट करें — सिंगल कोट्स के बीच, हर `$` को `$$` लिखकर — और उसे `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें। 6.8 से पहले Xen Orchestra हर रीस्टार्ट पर एक नया सीक्रेट बनाता था।",
};

export default TRANSLATION;
