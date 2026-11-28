import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Compose v2 प्लगइन के साथ Docker Engine 20.10 या नया, ऐसी मशीन पर जो पोर्ट 9283 पर आपके Ceph mgr डेमॉन तक पहुँच सके",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Ceph एडमिन नोड पर एक शेल, जहाँ `ceph` CLI एडमिन अधिकारों के साथ चलता हो",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "फिर अपने mgr डेमॉन की सूची बनाएँ। एजेंट को उनमें से **सभी** चाहिए, सक्रिय भी और स्टैंडबाय भी:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "केवल **सक्रिय** mgr मेट्रिक्स लौटाता है (स्टैंडबाय खाली जवाब देते हैं), इसलिए हर mgr को स्क्रैप करने से सक्रिय mgr के फ़ेलओवर होने पर भी मेट्रिक्स आते रहते हैं।",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "स्क्रिप्ट आपका OneUptime URL और इंजेशन कुंजी पूछती है, दोनों चरण 1 में दिखते हैं (उन्हें यहाँ भरा पाने के लिए वहाँ एक कुंजी चुनें), और फिर ये पूछती है:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **क्लस्टर का नाम**: OneUptime में क्लस्टर किस नाम से दिखे। हर क्लस्टर को उसका अपना नाम दें और उसे स्थिर रखें: नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr एंडपॉइंट**: पिछले चरण का हर mgr, अल्पविराम से अलग किए गए `host:port` के रूप में, जैसे `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`। वर्गाकार कोष्ठक स्क्रिप्ट जोड़ती है।",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime AI एजेंट**: क्या वह सुधार लागू कर सकता है; उसे केवल-पढ़ने वाला रखने के लिए **N** जवाब दें। जहाँ `ceph` एडमिन अधिकारों के साथ चलता है, वहाँ स्क्रिप्ट AI एजेंट का अपना Ceph क्लाइंट बनाने की पेशकश भी करती है।",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "यह `/opt/oneuptime-ceph-agent` में इंस्टॉल होती है, `0600` वाली एक `.env` फ़ाइल लिखती है और Docker Compose से एजेंट शुरू करती है। स्क्रिप्ट दोबारा चलाने पर वह फिर से पूछने के बजाय उस `.env` की हर चीज़ फिर से इस्तेमाल करती है, इसलिए अपग्रेड भी इसी तरह होता है।",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "लॉग में `Everything is ready. Begin running and processing data.` देखें। इसके बाद क्लस्टर अपने-आप **Ceph** सेक्शन में दिखता है, आमतौर पर लगभग एक मिनट के भीतर।",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose **`oneuptime-ceph-ai-agent`** भी चलाता है, जो OneUptime AI एजेंट है। अगर इंस्टॉल स्क्रिप्ट ने उसका Ceph क्लाइंट बनाया है तो वह पहले से काम कर रहा है; नहीं तो वह एक क्लाइंट का इंतज़ार करता है; उन्नत में **OneUptime AI एजेंट** देखें।",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI एजेंट (डिफ़ॉल्ट रूप से चालू, केवल-पढ़ने वाला)।** AI जाँच चालू है: अपना Ceph क्लाइंट मिलते ही वह OneUptime AI को केवल-पढ़ने वाली `ceph` कमांड से इस क्लस्टर की घटनाओं और अलर्ट की जाँच करने देता है, और जब तक आप सुधारों की अनुमति न दें, कुछ नहीं बदलता।",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "इंस्टॉल स्क्रिप्ट इन्हें `/opt/oneuptime-ceph-agent/.env` में लिखती है। किसी एक को बदलने के बाद उसे `/opt/oneuptime-ceph-agent` में `docker compose up -d` से लागू करें।",
  "| Variable | Required | Description |": "| वेरिएबल | ज़रूरी | विवरण |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | हाँ | आपके OneUptime इंस्टेंस का URL (जैसे `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | हाँ | टेलीमेट्री इंजेशन कुंजी, वही जो चरण 1 में चुनी गई |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | हाँ | OneUptime में दिखने वाला क्लस्टर पहचानकर्ता। हर मेट्रिक पर `ceph.cluster.name` रिसोर्स एट्रिब्यूट के रूप में लगाया जाता है। इसे स्थिर रखें: इसे बदलने से एक नया क्लस्टर रजिस्टर होता है (डिफ़ॉल्ट: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | हाँ | **सभी** mgr डेमॉन की अल्पविराम से अलग `host:port` सूची, वर्गाकार कोष्ठकों में, जैसे `[ceph-mon-1:9283,ceph-mon-2:9283]`। इंस्टॉल स्क्रिप्ट आपके लिए कोष्ठक जोड़ती है |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI एजेंट की अपनी सेटिंग **OneUptime AI एजेंट** में हैं।",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **सभी mgr स्क्रैप किए जाते हैं** (सक्रिय और स्टैंडबाय), इसलिए मेट्रिक्स सक्रिय mgr के फ़ेलओवर के बाद भी बने रहते हैं।",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **हर 30 सेकंड।** mgr का prometheus मॉड्यूल एक स्क्रैप को `mgr/prometheus/scrape_interval` (डिफ़ॉल्ट रूप से 15 सेकंड) तक कैश करता है: इससे ज़्यादा बार स्क्रैप न करें, आप बस कैश दोबारा पढ़ेंगे।",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** Ceph के निर्यात किए लेबल (`ceph_daemon`, `pool_id`) जैसे के तैसे रखता है, ताकि mgr फ़ेलओवर के दौरान सीरीज़ लगातार बनी रहें।",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "यह वह पूरी `otel-collector-config.yaml` है जिसे एजेंट चलाता है; `.env` फ़ाइल `${env:...}` मान देती है:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "एजेंट `/var/log/ceph/ceph.log` को फ़ॉलो करके उसे OneUptime को भेज सकता है, जिससे **क्लस्टर लॉग** पेज भरता है। यह डिफ़ॉल्ट रूप से बंद है, क्योंकि एजेंट को ऐसे होस्ट पर चलना होगा जिस पर क्लस्टर लॉग हो, डिफ़ॉल्ट रूप से एक mon होस्ट।",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. `otel-collector-config.yaml` में `filelog` रिसीवर और `logs` पाइपलाइन को अनकमेंट करें।",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. `docker-compose.yml` में `/var/log/ceph:/var/log/ceph:ro` वॉल्यूम को अनकमेंट करें।",
  "3. Apply both:": "3. दोनों लागू करें:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "पंक्तियाँ जैसी हैं वैसी भेजी जाती हैं; OneUptime उन्हें पढ़ते समय ceph.log फ़ॉर्मैट (टाइमस्टैम्प, डेमॉन, INF/WRN/ERR स्तर, संदेश) पार्स करता है, और `resource` प्रोसेसर `ceph.cluster.name` लगाता है ताकि लॉग इसी क्लस्टर पर पहुँचे।",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "`oneuptime.label.` उपसर्ग वाला कोई भी रिसोर्स एट्रिब्यूट क्लस्टर पर एक प्रोजेक्ट लेबल बन जाता है: `oneuptime.label.<dimension>=<value>` लेबल `<dimension>:<value>` है। इन्हें `otel-collector-config.yaml` के `resource` प्रोसेसर में `ceph.cluster.name` के बगल में जोड़ें:",
  "Then restart the collector so it reads the new config:":
    "फिर कलेक्टर को रीस्टार्ट करें ताकि वह नया कॉन्फ़िग पढ़े:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "क्लस्टर `team:storage` और `env:production` लेबल के साथ दिखता है। लेबल बड़े-छोटे अक्षरों का भेद किए बिना मिलाए जाते हैं, इसलिए मौजूदा `Production` लेबल फिर से इस्तेमाल होता है; OneUptime इंटरफ़ेस में जोड़े गए लेबल एजेंट कभी नहीं हटाता।",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "एजेंट वह सब भेजता है जो mgr का prometheus मॉड्यूल निर्यात करता है। OneUptime के Ceph पेज, मेट्रिक कैटलॉग और अलर्ट टेम्पलेट इन पर बने हैं:",
  "| Category | Data |": "| श्रेणी | डेटा |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **क्लस्टर स्वास्थ्य** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), मॉनिटर कोरम, कुल और इस्तेमाल हुई रॉ क्षमता |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | हर OSD की up / in स्थिति (हर `ceph_daemon` लेबल के अनुसार, जैसे `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **पूल** | हर पूल के सहेजे गए बाइट, अधिकतम उपलब्ध, ऑब्जेक्ट की गिनती, पढ़ने/लिखने के ऑपरेशन और थ्रूपुट |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | सक्रिय, डिग्रेडेड और कम आकार वाले PG की गिनती |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` **`oneuptime-ceph-ai-agent`** भी चलाता है। जब OneUptime AI इस क्लस्टर की किसी घटना या अलर्ट की जाँच करता है, तो वह इसके ज़रिए `ceph` कमांड चलाता है: `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`। यह `CEPH_CLUSTER_NAME` नाम वाले क्लस्टर के रूप में रजिस्टर होता है और क्लस्टर के **एआई → AI एजेंट** पेज पर दिखता है।",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "यह अपने Ceph क्लाइंट `client.oneuptime-ai` के रूप में जुड़ता है, क्लस्टर की न्यूनतम `ceph.conf` और उस क्लाइंट की कीरिंग के साथ, जो `docker-compose.yml` के बगल में एक `ceph/` फ़ोल्डर में होती हैं। नए इंस्टॉल पर, जब आप जिस मशीन पर इसे चलाते हैं वहाँ `ceph` एडमिन अधिकारों के साथ चलता हो, तो इंस्टॉल स्क्रिप्ट उन्हें बनाने की पेशकश करती है। नहीं तो, या उन्हें बाद में जोड़ने के लिए, किसी Ceph एडमिन नोड पर:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "अगर एजेंट किसी दूसरी मशीन पर चलता है, तो दोनों फ़ाइलें उसी तरह उसके `ceph/` फ़ोल्डर में कॉपी करें। **एडमिन कीरिंग वहाँ कभी न रखें।**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **क्लाइंट की caps ही पक्की सीमा हैं।** इन पढ़ने वाली caps के साथ वह जो भी चलाए, क्लस्टर को नहीं बदल सकता। सुधारों (किसी OSD को फिर से in करना, `noout` हटाना) के लिए `.env` में `ONEUPTIME_AI_ALLOW_WRITES=true` और एजेंट के README में दी गई सुधार caps भी चाहिए।",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- इसे जाँचें: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- OneUptime AI इस्तेमाल नहीं करते? `docker-compose.yml` से `oneuptime-ceph-ai-agent` सर्विस हटा दें।",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "यह क्या चला सकता है और सुधार कैसे काम करते हैं: [इन्फ़्रास्ट्रक्चर AI एजेंट](/docs/ai/infrastructure-ai-agents#ceph-clusters)।",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**अपग्रेड करें**: कलेक्टर इमेज `docker-compose.yml` में पिन है और उसका कॉन्फ़िग उसके बगल की एक फ़ाइल है, इसलिए सिर्फ़ इमेज पुल करने से एजेंट आगे नहीं बढ़ता। इंस्टॉल स्क्रिप्ट फिर से चलाएँ। यह आपकी मौजूदा `.env` का हर मान फिर से इस्तेमाल करती है (कुछ भी दोबारा नहीं पूछा जाता), नवीनतम `docker-compose.yml` और `otel-collector-config.yaml` डाउनलोड करती है (आपकी बदली हुई फ़ाइल नई फ़ाइल के बगल में `<file>.bak.<timestamp>` के रूप में रखी जाती है), इमेज पुल करती है और उनसे एजेंट को फिर से बनाती है। AI एजेंट का `ceph/` फ़ोल्डर जैसा है वैसा रहता है:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "कॉन्फ़िग जिस कलेक्टर संस्करण को पिन करता है, उसे क्लस्टर के **एजेंट संस्करण** के रूप में बताता है। जब यह OneUptime कोई नया संस्करण पिन करता है, तो उसके बगल का चेतावनी चिह्न ये कमांड खोलता है।",
  "**Uninstall** the agent:": "एजेंट को **अनइंस्टॉल करें**:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "अगर आपने AI एजेंट का Ceph क्लाइंट बनाया था, तो उसे किसी एडमिन नोड पर हटाएँ: `ceph auth del client.oneuptime-ai`।",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` पूरी कड़ी जाँचता है (कंटेनर रनटाइम, हर mgr एंडपॉइंट, सक्रिय और स्टैंडबाय वाली उलझन सहित, क्लस्टर के नाम का लगना, टोकन का रूप, कलेक्टर के अपने मेट्रिक्स) और OneUptime से सीधे पूछता है कि क्या वह आपकी इंजेशन कुंजी स्वीकार करता है। यह आख़िरी जाँच सबसे ज़्यादा मायने रखती है: OneUptime के OTLP एंडपॉइंट ग़लत कुंजी को `401` या `422` से ठुकराते हैं, जिसे कलेक्टर हर बैच के लिए `Exporting failed` की एक ही ऐसी पंक्ति के रूप में लॉग करता है जो आसानी से छूट जाती है, इसलिए स्क्रिप्ट `GET /otlp/v1/validate` से सीधा 200/401 फ़ैसला माँगती है।",
  "It ends with a verdict naming the most likely cause.":
    "यह सबसे संभावित कारण बताने वाले फ़ैसले के साथ ख़त्म होता है।",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. कलेक्टर के लॉग जाँचें: `docker logs oneuptime-ceph-agent`; निर्यात की त्रुटियाँ देखें (`401` का मतलब ग़लत इंजेशन कुंजी है, कनेक्शन अस्वीकार होने का मतलब ग़लत `ONEUPTIME_URL` है)।",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. पुष्टि करें कि कोई mgr एंडपॉइंट मेट्रिक्स देता है: `curl http://<active-mgr>:9283/metrics | head`; आपको `ceph_*` मेट्रिक की पंक्तियाँ दिखनी चाहिए। अगर नहीं, तो मॉड्यूल चालू करें: `ceph mgr module enable prometheus`।",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. पक्का करें कि `CEPH_MGR_ENDPOINTS` वर्गाकार कोष्ठकों में है: उनके बिना कलेक्टर अल्पविराम से अलग पूरी स्ट्रिंग को एक ही (अमान्य) टारगेट मानता है।",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. जाँचें कि एजेंट चल रहा है: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. एजेंट के लॉग में त्रुटियाँ जाँचें: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. पुष्टि करें कि आपका OneUptime URL और इंजेशन कुंजी सही हैं।",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. पक्का करें कि एजेंट की मशीन नेटवर्क पर OneUptime इंस्टेंस तक पहुँच सकती है।",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "आप शायद सिर्फ़ (पहले वाले) सक्रिय mgr को स्क्रैप कर रहे हैं। `CEPH_MGR_ENDPOINTS` में **हर** mgr डेमॉन की सूची दें: स्टैंडबाय mgr के स्क्रैप सस्ते होते हैं और खाली जवाब लौटाते हैं।",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "अगर आपके क्लस्टर पर `mgr/prometheus/standby_behaviour` को `error` पर सेट किया गया है, तो यह अपेक्षित है: तब स्टैंडबाय HTTP 500 से जवाब देते हैं। सक्रिय mgr का स्क्रैप फिर भी सफल होता है, इसलिए ये त्रुटियाँ शोर हैं; उन्हें शांत करने के लिए व्यवहार को वापस `default` पर कर दें।",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "क्लस्टर की पहचान `CEPH_CLUSTER_NAME` से आती है, जो हर मेट्रिक पर `ceph.cluster.name` के रूप में लगाई जाती है। इसे `.env` में ठीक करें और `/opt/oneuptime-ceph-agent` में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **क्लस्टर का नाम**: ठीक **`ceph-1`** डालें; कोई दूसरा नाम एक नया क्लस्टर रजिस्टर करता है।",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "क्लस्टर की पहचान `CEPH_CLUSTER_NAME` से आती है, जो हर मेट्रिक पर `ceph.cluster.name` के रूप में लगाई जाती है। यह क्लस्टर **`ceph-1`** है। इसे `.env` में ठीक करें और `/opt/oneuptime-ceph-agent` में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "कमांड में आपका OneUptime URL और इंजेशन कुंजी पहले से हैं। बाकी स्क्रिप्ट पूछती है:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "इस OneUptime से `docker-compose.yml` और `otel-collector-config.yaml` एक नए फ़ोल्डर में डाउनलोड करें:",
  "Create a `.env` file next to them:": "उनके बगल में एक `.env` फ़ाइल बनाएँ:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- `my-ceph-cluster` को इस क्लस्टर के किसी नाम से बदलें, जैसे `ceph-prod`। OneUptime में क्लस्टर इसी नाम से दिखता है, इसलिए इसे स्थिर रखें: नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- `CEPH_MGR_ENDPOINTS` में **हर** mgr डेमॉन की सूची दें, अल्पविराम से अलग और वर्गाकार कोष्ठकों में: कोष्ठकों के बिना कलेक्टर पूरी सूची को एक अमान्य टारगेट के रूप में पढ़ता है।",
  "Start the agent:": "एजेंट शुरू करें:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose **`oneuptime-ceph-ai-agent`** भी शुरू करता है, जो OneUptime AI एजेंट है। यह अपने ख़ुद के Ceph क्लाइंट का इंतज़ार करता है; उन्नत में **OneUptime AI एजेंट** देखें, या अगर आप OneUptime AI इस्तेमाल नहीं करते तो `docker-compose.yml` से इसकी सर्विस हटा दें।",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "एजेंट इन्हें `docker-compose.yml` के बगल वाली `.env` फ़ाइल से पढ़ता है। किसी एक को बदलने के बाद उसे `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें।",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | हाँ | **सभी** mgr डेमॉन की अल्पविराम से अलग `host:port` सूची, वर्गाकार कोष्ठकों में, जैसे `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "यह अपने Ceph क्लाइंट `client.oneuptime-ai` के रूप में जुड़ता है, क्लस्टर की न्यूनतम `ceph.conf` और उस क्लाइंट की कीरिंग के साथ, जो `docker-compose.yml` के बगल में एक `ceph/` फ़ोल्डर में होती हैं। किसी Ceph एडमिन नोड पर, एजेंट के फ़ोल्डर में:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "इन्हें एजेंट के फ़ोल्डर में चलाएँ, जिसमें `docker-compose.yml` है।",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**अपग्रेड करें**: कलेक्टर इमेज `docker-compose.yml` में पिन है और उसका कॉन्फ़िग उसके बगल की एक फ़ाइल है, इसलिए सिर्फ़ इमेज पुल करने से एजेंट आगे नहीं बढ़ता। दोनों फ़ाइलें फिर से डाउनलोड करें; आपकी `.env` बनी रहती है, और किसी भी फ़ाइल में किया गया आपका बदलाव फिर से करना होगा:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "फिर इमेज पुल करें और एजेंट को फिर से बनाएँ, ताकि कलेक्टर अपना नया कॉन्फ़िग पढ़े:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "क्लस्टर की पहचान `CEPH_CLUSTER_NAME` से आती है, जो हर मेट्रिक पर `ceph.cluster.name` के रूप में लगाई जाती है। इसे `.env` में ठीक करें और `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- यह **`ceph-1`** के लिए एजेंट इंस्टॉल करता है: `CEPH_CLUSTER_NAME` को ठीक वैसा ही रहने दें, नहीं तो डेटा एक नए क्लस्टर के रूप में रजिस्टर होगा।",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "क्लस्टर की पहचान `CEPH_CLUSTER_NAME` से आती है, जो हर मेट्रिक पर `ceph.cluster.name` के रूप में लगाई जाती है। यह क्लस्टर **`ceph-1`** है। इसे `.env` में ठीक करें और `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | नहीं | कलेक्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-ceph-agent`)। उसी मशीन पर दूसरे क्लस्टर के एजेंट को अपने अलग नाम चाहिए: अगर आप इन्हें सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट नए एजेंट के कंटेनरों के नाम उसके फ़ोल्डर पर रखती है, और स्क्रिप्ट फिर से चलाने पर उन्हें बनाए रखती है |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | नहीं | AI एजेंट के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-ceph-ai-agent`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे क्लस्टर के AI एजेंट का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-ceph-ai-agent-cluster2`, `oneuptime-ceph-agent-cluster2` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "एक एजेंट एक क्लस्टर पढ़ता है। दूसरे क्लस्टर के लिए, दूसरा एजेंट उसके अपने फ़ोल्डर में, उसके अपने कंटेनर नामों के साथ इंस्टॉल करें — दो कंटेनर एक ही नाम नहीं रख सकते:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "अगर आप उनके वेरिएबल सेट नहीं करते, जैसे `CEPH_AGENT_CONTAINER_NAME`, तो स्क्रिप्ट कंटेनरों के नाम फ़ोल्डर पर रखती है, जैसे `oneuptime-ceph-agent-cluster2`। स्क्रिप्ट ये नाम उस एजेंट की `.env` में सहेज लेती है, इसलिए एजेंट अपग्रेड करने के लिए उसी `INSTALL_DIR` के साथ स्क्रिप्ट फिर से चलाने पर भी नाम बने रहते हैं, और जिस एजेंट का `container_name` आपने कभी `docker-compose.yml` में बदला था, वह वही नाम रखता है।",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "हर फ़ोल्डर को अपना अलग नाम दें: Docker Compose किसी प्रोजेक्ट का नाम सिर्फ़ उसके फ़ोल्डर पर रखता है, इसलिए स्क्रिप्ट ऐसे फ़ोल्डर को अस्वीकार करती है जिसका नाम उस फ़ोल्डर जैसा हो जो पहले से कहीं और एजेंट चला रहा है। फ़ोल्डर को डायग्नोस्टिक स्क्रिप्ट को `-d` से दें।",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | नहीं | कलेक्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-ceph-agent`)। उसी मशीन पर दूसरे क्लस्टर के एजेंट को अपना अलग नाम चाहिए |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | नहीं | AI एजेंट के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-ceph-ai-agent`)। उसी मशीन पर दूसरे क्लस्टर के एजेंट को अपना अलग नाम चाहिए |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "एक एजेंट एक क्लस्टर पढ़ता है। दूसरे क्लस्टर के लिए, दूसरा एजेंट उसके अपने फ़ोल्डर में, उसके अपने कंटेनर नामों के साथ सेट अप करें — दो कंटेनर एक ही नाम नहीं रख सकते। नाम उस एजेंट की `.env` में सेट करें:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "हर फ़ोल्डर को अपना अलग नाम दें: Docker Compose किसी प्रोजेक्ट का नाम सिर्फ़ उसके फ़ोल्डर पर रखता है, इसलिए उसी नाम का दूसरा फ़ोल्डर पहले एजेंट के कंटेनरों की जगह ले लेगा। नाम `docker-compose.yml` में न रखें, जिसे अपग्रेड बदल देता है।",
};

export default TRANSLATION;
