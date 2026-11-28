import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 या उससे नया",
  "Access to `/var/run/docker.sock` on the host":
    "होस्ट पर `/var/run/docker.sock` तक पहुँच",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "जिन कंटेनरों के लॉग आप चाहते हैं, उन्हें `json-file` लॉग ड्राइवर इस्तेमाल करना होगा — यह Docker का डिफ़ॉल्ट है",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "फिर उसी URL, कुंजी और होस्ट नाम के साथ उसके बगल में OneUptime एआई एजेंट शुरू करें। **AI जाँचें डिफ़ॉल्ट रूप से चालू हैं**: जब OneUptime AI इस होस्ट पर किसी घटना या अलर्ट की जाँच करता है, तो वह AI एजेंट के ज़रिए केवल-पढ़ने वाले `docker` कमांड चलाता है, और जब तक आप सुधारों की अनुमति न दें, कुछ नहीं बदलता — उन्नत में **OneUptime एआई एजेंट** देखें। AI जाँचों के बिना कलेक्टर चलाने के लिए यह कमांड छोड़ दें।",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "`my-docker-host` को इस होस्ट के नाम से बदलें, जैसे `prod-docker-01`। OneUptime में होस्ट इसी नाम से दिखता है, इसलिए इसे स्थिर रखें: नया नाम नया होस्ट पंजीकृत करता है।",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "Look for this line in the logs:": "लॉग में यह पंक्ति खोजें:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "एजेंट के कनेक्ट होते ही होस्ट अपने आप **Docker** सेक्शन में दिखने लगता है — आमतौर पर लगभग एक मिनट में। OneUptime एआई एजेंट होस्ट के **एआई → AI एजेंट** पेज पर और उसके **अवलोकन** के नीचे कनेक्टेड दिखता है।",
  "| Variable | Required | Description |": "| वेरिएबल | ज़रूरी | विवरण |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | हाँ | आपके OneUptime इंस्टेंस का URL (जैसे `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | हाँ | चरण 1 की टेलीमेट्री इंजेशन कुंजी |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | नहीं | इस होस्ट का पहचानने लायक नाम। डिफ़ॉल्ट `docker-host` है |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | नहीं | Docker Engine API का वह संस्करण जो एजेंट इस्तेमाल करता है। डिफ़ॉल्ट रूप से खाली: एजेंट इसे डेमन के साथ तय करता है, इसलिए 20.10 से आगे का कोई भी Docker Engine काम करता है। इसे केवल संस्करण तय करने के लिए सेट करें (समस्या निवारण देखें) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` से `ONEUPTIME_LOG_OPERATOR_5` तक | नहीं | आपके अपने कलेक्टर ऑपरेटर, हर एक JSON के रूप में, ऐसे लॉग फ़ॉर्मेट के लिए जिसे एजेंट नहीं पढ़ता |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "हर एक को `docker run` में `-e NAME=value` के रूप में दें। बाद में किसी को बदलने के लिए, `docker rm -f oneuptime-docker-agent` से एजेंट हटाएँ और नए मान के साथ कमांड फिर से चलाएँ।",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "एजेंट `/var/lib/docker/containers/*/*-json.log` को पढ़ता रहता है, इसलिए वह केवल उन कंटेनरों के लॉग देखता है जो Docker का **`json-file`** लॉग ड्राइवर इस्तेमाल करते हैं। यह Docker का डिफ़ॉल्ट है, पर कुछ होस्ट `local` (बाइनरी फ़ाइलें जिन्हें एजेंट नहीं पढ़ सकता) या किसी रिमोट ड्राइवर (`journald`, `syslog`, `fluentd`, `gelf`, …) पर चले जाते हैं, जिनसे पढ़ने के लिए कोई फ़ाइल नहीं बचती।",
  "Check a container's log driver, and the daemon's default:":
    "किसी कंटेनर का लॉग ड्राइवर और डेमन का डिफ़ॉल्ट जाँचें:",
  "Switch a Compose service to `json-file`, with rotation:":
    "किसी Compose सर्विस को रोटेशन के साथ `json-file` पर बदलें:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "या `/etc/docker/daemon.json` में, बाद में बनने वाले हर कंटेनर के लिए डेमन का डिफ़ॉल्ट बदलें:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "फिर Docker को रीस्टार्ट करें और प्रभावित कंटेनरों को **फिर से बनाएँ** (सिर्फ़ रीस्टार्ट काफ़ी नहीं): कंटेनर वही लॉग ड्राइवर रखता है जिसके साथ वह बना था।",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, यानी चरण 2 से शुरू होने वाला दूसरा कंटेनर, वे `docker` कमांड चलाता है जो OneUptime AI इस होस्ट पर किसी घटना या अलर्ट की जाँच करते समय माँगता है। **AI जाँचें डिफ़ॉल्ट रूप से चालू हैं**: कनेक्ट होते ही OneUptime AI इसके साथ जाँच करता है, और होस्ट का **एआई → AI एजेंट** पेज और उसका **अवलोकन** इसकी स्थिति दिखाते हैं। जाँच बंद करने के लिए उस पेज पर **AI क्या कर सकता है** का इस्तेमाल करें; AI एजेंट के बिना कलेक्टर चलाने के लिए इसे `docker rm -f oneuptime-docker-ai-agent` से हटाएँ।",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **डिफ़ॉल्ट रूप से केवल-पढ़ने वाला।** यह `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` और `docker stats --no-stream` जैसे कमांड चलाता है — कभी `exec`, `run`, `rm` या `prune` नहीं। `docker inspect` के आउटपुट में एनवायरनमेंट मान होस्ट से कुछ भी बाहर जाने से पहले छिपा दिए जाते हैं।",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **सुधार आपकी मर्ज़ी से चालू होते हैं।** किसी नाम वाले कंटेनर को रीस्टार्ट, शुरू, बंद, रोकने, ख़त्म करने या उसकी सीमाएँ बदलने देने के लिए कमांड में `-e ONEUPTIME_AI_ALLOW_WRITES=true` जोड़ें। इसके बगल में `ONEUPTIME_AI_FIXES` बताता है कि हर सुधार को स्वीकृति चाहिए या नहीं (`ask-for-approval`, `automatic` या `bypass-approval`), और होस्ट का **एआई → AI एजेंट** पेज इसे दिखाता है। `ONEUPTIME_AI_WRITE_TARGETS` (कॉमा से अलग glob, जैसे `web-*,api-*`) तय करता है कि कौन-से कंटेनर; `ONEUPTIME_AI_PROTECTED_TARGETS` वे कंटेनर जोड़ता है जिन्हें यह कभी नहीं बदलेगा। यह खुद को या कलेक्टर को कभी नहीं बदलता।",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- यह root के रूप में चलता है क्योंकि Docker सॉकेट root का है। सॉकेट का `:ro` माउंट Docker API को केवल-पढ़ने वाला नहीं बनाता — सीमा एजेंट की कमांड नीति है।",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- इसके लॉग: `docker logs -f oneuptime-docker-ai-agent`। यह क्या चला सकता है और सुधार कैसे काम करते हैं: [इन्फ्रास्ट्रक्चर के लिए AI एजेंट](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts)।",
  "| Tag | Description |": "| टैग | विवरण |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | नवीनतम स्थिर रिलीज़ (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | नवीनतम स्थिर रिलीज़ (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | एक तय संस्करण, जैसे `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | वही इमेज, GHCR पर मिरर की गई |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "`docker run` कमांड के अंत में `oneuptime/docker-agent:release` की जगह इनमें से कोई एक इस्तेमाल करें।",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**अपग्रेड करें** — नवीनतम इमेज खींचें और चल रहे एजेंट को हटाएँ:",
  "Then run both `docker run` commands from step 2 again.":
    "फिर चरण 2 के दोनों `docker run` कमांड फिर से चलाएँ।",
  "**Uninstall:**": "**अनइंस्टॉल करें:**",
  "| Category | Data |": "| श्रेणी | डेटा |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU मेट्रिक्स** | कुल उपयोग, उपयोग प्रतिशत, थ्रॉटलिंग समय (हर कंटेनर के लिए) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **मेमोरी मेट्रिक्स** | उपयोग, सीमा, प्रतिशत, RSS, कैश (हर कंटेनर के लिए) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **नेटवर्क मेट्रिक्स** | मिले/भेजे गए बाइट और पैकेट (हर कंटेनर के लिए) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **ब्लॉक I/O मेट्रिक्स** | पढ़े/लिखे गए बाइट और ऑपरेशन (हर कंटेनर के लिए) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **कंटेनर जानकारी** | अपटाइम, रीस्टार्ट की संख्या, प्रोसेस की संख्या |",
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **कंटेनर लॉग** | सभी कंटेनरों के stdout/stderr लॉग |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'हर लॉग पंक्ति को उस स्तर से गंभीरता मिलती है जो वह बताती है (`[ERROR]`, `level=warn`, `{"level":"info"}`); बिना स्तर वाली पंक्ति अपनी स्ट्रीम पर निर्भर करती है — stderr `ERROR` है, stdout `INFO` है।',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "`/var/run/docker.sock` पढ़ने के लिए एजेंट को root के रूप में चलना होगा। पक्का करें कि आपके `docker run` कमांड में `--user 0:0` फ़्लैग है।",
  "The agent's logs show:": "एजेंट के लॉग दिखाते हैं:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "डेमन अपनी अधिकतम सीमा से नए क्लाइंट को अस्वीकार करता है, कलेक्टर उसी वजह से बंद हो जाता है, और कंटेनर बार-बार रीस्टार्ट होता है। एजेंट संस्करण तभी तय करता है जब `DOCKER_API_VERSION` कोई संस्करण बताए, और एक पुरानी एजेंट इमेज ने `1.44` तय किया था, जिसे Docker Engine 20.10 से 24 अस्वीकार करते हैं। एजेंट हटाएँ (`docker rm -f oneuptime-docker-agent`), नवीनतम इमेज खींचें (`docker pull oneuptime/docker-agent:release`) और `-e DOCKER_API_VERSION` के बिना चरण 2 का कमांड फिर से चलाएँ। तब एजेंट डेमन के साथ संस्करण तय करता है।",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "फिर भी संस्करण तय करना हो, तो डेमन की अधिकतम सीमा से ज़्यादा न रखें:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "इसे कमांड में जोड़ें, जैसे `-e DOCKER_API_VERSION=1.41`। नए डेमन अब भी पुराने API संस्करण चलाते हैं, इसलिए तय किया गया संस्करण Docker अपग्रेड करने के बाद भी काम करता रहता है।",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. जाँचें कि एजेंट चल रहा है: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. एजेंट के लॉग में त्रुटियाँ जाँचें: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. पुष्टि करें कि `docker run` कमांड में OneUptime URL और इंजेशन कुंजी सही हैं।",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. पक्का करें कि होस्ट नेटवर्क पर आपके OneUptime इंस्टेंस तक पहुँच सकता है।",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "जाँचें कि Docker सॉकेट एजेंट में माउंट है। इसकी इमेज में कोई शेल नहीं है, इसलिए किसी ऐसे अस्थायी कंटेनर से देखें जो इसके माउंट साझा करता हो:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "फिर एजेंट के लॉग में एक्सपोर्ट त्रुटियाँ खोजें (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) और पक्का करें कि इंजेशन कुंजी मान्य है और उसकी अवधि ख़त्म नहीं हुई है।",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "मेट्रिक्स आ रहे हैं पर **लॉग** टैब खाली है, या केवल एजेंट के अपने लॉग दिखाता है? आपके कंटेनर शायद `json-file` लॉग ड्राइवर इस्तेमाल नहीं कर रहे।",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "अगर चरण 1 `no files match the configured criteria` दिखाए, या चरण 3 आपके कंटेनरों की कोई फ़ाइल न दिखाए, तो वे `json-file` इस्तेमाल नहीं कर रहे। उन्हें बदलें (उन्नत में **हर कंटेनर से लॉग इकट्ठा करें (json-file लॉग ड्राइवर)** देखें), फिर हर एक को फिर से बनाएँ — कंटेनर वही लॉग ड्राइवर रखता है जिसके साथ वह बना था:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "किसी होस्ट का पेज वह डेटा दिखाता है जिसका होस्ट नाम उस होस्ट का पहचानकर्ता है, जिसे एजेंट `DOCKER_HOST_NAME` से लेता है। होस्ट पंजीकृत होने के बाद `DOCKER_HOST_NAME` बदलें, तो OneUptime नए नाम से दूसरा होस्ट पंजीकृत करता है — लॉग उसी पर होते हैं। एजेंट जो नाम बताता है, उसे जाँचें:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "होस्ट का नाम `DOCKER_HOST_NAME` से आता है। इसके बिना शुरू हुआ एजेंट `docker-host` बताता है, इसलिए इस तरह सेट किया गया हर होस्ट एक ही होस्ट जैसा दिखता है। हर होस्ट पर `DOCKER_HOST_NAME` को उसका अपना नाम दें और एजेंट फिर से बनाएँ — `docker rm -f oneuptime-docker-agent`, फिर नए नाम के साथ चरण 2 का कमांड चलाएँ।",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "यह **`web-1`** के लिए एजेंट इंस्टॉल करता है — `DOCKER_HOST_NAME` को बिल्कुल वैसा ही रखें, वरना डेटा नए होस्ट के रूप में पंजीकृत होगा।",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (`docker compose` कमांड)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "दूसरी सर्विस OneUptime एआई एजेंट है, उसी URL, कुंजी और होस्ट नाम के साथ। **AI जाँचें डिफ़ॉल्ट रूप से चालू हैं**: जब OneUptime AI इस होस्ट पर किसी घटना या अलर्ट की जाँच करता है, तो वह AI एजेंट के ज़रिए केवल-पढ़ने वाले `docker` कमांड चलाता है, और जब तक आप सुधारों की अनुमति न दें, कुछ नहीं बदलता — उन्नत में **OneUptime एआई एजेंट** देखें। AI जाँचों के बिना कलेक्टर चलाने के लिए `oneuptime-docker-ai-agent` सर्विस हटा दें।",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "हर एक को एजेंट की `environment:` सूची में सेट करें, फिर नए मानों के साथ उसे दोबारा बनाने के लिए `docker compose up -d` चलाएँ।",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, यानी docker-compose.yml की दूसरी सर्विस, वे `docker` कमांड चलाती है जो OneUptime AI इस होस्ट पर किसी घटना या अलर्ट की जाँच करते समय माँगता है। **AI जाँचें डिफ़ॉल्ट रूप से चालू हैं**: कनेक्ट होते ही OneUptime AI इसके साथ जाँच करता है, और होस्ट का **एआई → AI एजेंट** पेज और उसका **अवलोकन** इसकी स्थिति दिखाते हैं। जाँच बंद करने के लिए उस पेज पर **AI क्या कर सकता है** का इस्तेमाल करें; AI एजेंट के बिना कलेक्टर चलाने के लिए इसकी सर्विस हटाएँ और `docker compose up -d --remove-orphans` चलाएँ।",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **सुधार आपकी मर्ज़ी से चालू होते हैं।** किसी नाम वाले कंटेनर को रीस्टार्ट, शुरू, बंद, रोकने, ख़त्म करने या उसकी सीमाएँ बदलने देने के लिए इसकी `environment:` सूची में `- ONEUPTIME_AI_ALLOW_WRITES=true` जोड़ें। इसके बगल में `ONEUPTIME_AI_FIXES` बताता है कि हर सुधार को स्वीकृति चाहिए या नहीं (`ask-for-approval`, `automatic` या `bypass-approval`), और होस्ट का **एआई → AI एजेंट** पेज इसे दिखाता है। `ONEUPTIME_AI_WRITE_TARGETS` (कॉमा से अलग glob, जैसे `web-*,api-*`) तय करता है कि कौन-से कंटेनर; `ONEUPTIME_AI_PROTECTED_TARGETS` वे कंटेनर जोड़ता है जिन्हें यह कभी नहीं बदलेगा। यह खुद को या कलेक्टर को कभी नहीं बदलता।",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "एजेंट की `image:` पंक्ति पर `oneuptime/docker-agent:release` की जगह इनमें से कोई एक इस्तेमाल करें।",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**अपग्रेड करें** — docker-compose.yml वाले फ़ोल्डर में नवीनतम इमेज खींचें और कंटेनर फिर से बनाएँ:",
  "**Uninstall** — stop and remove everything the file started:":
    "**अनइंस्टॉल करें** — फ़ाइल ने जो कुछ शुरू किया, उसे बंद करके हटाएँ:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    '`/var/run/docker.sock` पढ़ने के लिए एजेंट को root के रूप में चलना होगा। पक्का करें कि docker-compose.yml में एजेंट की सर्विस में `user: "0:0"` है।',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "डेमन अपनी अधिकतम सीमा से नए क्लाइंट को अस्वीकार करता है, कलेक्टर उसी वजह से बंद हो जाता है, और कंटेनर बार-बार रीस्टार्ट होता है। एजेंट संस्करण तभी तय करता है जब `DOCKER_API_VERSION` कोई संस्करण बताए, और एक पुरानी एजेंट इमेज ने `1.44` तय किया था, जिसे Docker Engine 20.10 से 24 अस्वीकार करते हैं। एजेंट की `environment:` सूची से `DOCKER_API_VERSION` हटाएँ, फिर `docker compose pull` और `docker compose up -d` चलाएँ। तब एजेंट डेमन के साथ संस्करण तय करता है।",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "इसे एजेंट की `environment:` सूची में जोड़ें, जैसे `- DOCKER_API_VERSION=1.41`, और `docker compose up -d` चलाएँ। नए डेमन अब भी पुराने API संस्करण चलाते हैं, इसलिए तय किया गया संस्करण Docker अपग्रेड करने के बाद भी काम करता रहता है।",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. पुष्टि करें कि docker-compose.yml में OneUptime URL और इंजेशन कुंजी सही हैं।",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "होस्ट का नाम `DOCKER_HOST_NAME` से आता है। इसके बिना शुरू हुआ एजेंट `docker-host` बताता है, इसलिए इस तरह सेट किया गया हर होस्ट एक ही होस्ट जैसा दिखता है। हर होस्ट पर `DOCKER_HOST_NAME` को उसका अपना नाम दें और उसके साथ एजेंट फिर से बनाने के लिए `docker compose up -d` चलाएँ।",
};

export default TRANSLATION;
