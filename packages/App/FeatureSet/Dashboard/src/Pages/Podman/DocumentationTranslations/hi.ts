import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 या उससे नया",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "`/run/podman/podman.sock` पर Podman का Docker-संगत API सॉकेट — इसे `sudo systemctl enable --now podman.socket` से चालू करें",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "जिन कंटेनरों के लॉग आप चाहते हैं, उन्हें `k8s-file` लॉग ड्राइवर इस्तेमाल करना होगा — rootful Podman डिफ़ॉल्ट रूप से `journald` इस्तेमाल करता है, जिसे एजेंट नहीं पढ़ सकता",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "फिर उसी URL, कुंजी और होस्ट नाम के साथ उसके बगल में OneUptime एआई एजेंट शुरू करें। **AI जाँचें डिफ़ॉल्ट रूप से चालू हैं**: जब OneUptime AI इस होस्ट पर किसी घटना या अलर्ट की जाँच करता है, तो वह AI एजेंट के ज़रिए Podman के Docker-संगत सॉकेट पर केवल-पढ़ने वाले `docker` कमांड चलाता है, और जब तक आप सुधारों की अनुमति न दें, कुछ नहीं बदलता — उन्नत में **OneUptime एआई एजेंट** देखें। AI जाँचों के बिना कलेक्टर चलाने के लिए यह कमांड छोड़ दें।",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "`my-podman-host` को इस होस्ट के नाम से बदलें, जैसे `prod-podman-01`। OneUptime में होस्ट इसी नाम से दिखता है, इसलिए इसे स्थिर रखें: नया नाम नया होस्ट पंजीकृत करता है।",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "Look for this line in the logs:": "लॉग में यह पंक्ति खोजें:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "एजेंट के कनेक्ट होते ही होस्ट अपने आप **Podman** सेक्शन में दिखने लगता है — आमतौर पर लगभग एक मिनट में। OneUptime एआई एजेंट होस्ट के **एआई → AI एजेंट** पेज पर और उसके **अवलोकन** के नीचे कनेक्टेड दिखता है।",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**मेट्रिक्स हैं पर लॉग नहीं?** rootful Podman डिफ़ॉल्ट रूप से कंटेनर लॉग `journald` में लिखता है, जिसे एजेंट नहीं पढ़ सकता। अपने कंटेनर `--log-driver k8s-file` के साथ चलाएँ — उन्नत में **हर कंटेनर से लॉग इकट्ठा करें (k8s-file लॉग ड्राइवर)** देखें।",
  "| Variable | Required | Description |": "| वेरिएबल | ज़रूरी | विवरण |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | हाँ | आपके OneUptime इंस्टेंस का URL (जैसे `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | हाँ | चरण 1 की टेलीमेट्री इंजेशन कुंजी |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | नहीं | इस होस्ट का पहचानने लायक नाम। डिफ़ॉल्ट `podman-host` है |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | नहीं | Docker API का वह संस्करण जिससे एजेंट Podman सॉकेट से बात करता है। डिफ़ॉल्ट रूप से खाली: एजेंट इसे सॉकेट के साथ तय करता है। इसे केवल संस्करण तय करने के लिए सेट करें (समस्या निवारण देखें) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` से `ONEUPTIME_LOG_OPERATOR_5` तक | नहीं | आपके अपने कलेक्टर ऑपरेटर, हर एक JSON के रूप में, ऐसे लॉग फ़ॉर्मेट के लिए जिसे एजेंट नहीं पढ़ता |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "हर एक को `podman run` में `-e NAME=value` के रूप में दें। बाद में किसी को बदलने के लिए, `podman rm -f oneuptime-podman-agent` से एजेंट हटाएँ और नए मान के साथ कमांड फिर से चलाएँ।",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "एजेंट वे फ़ाइलें पढ़ता है जो Podman का **`k8s-file`** लॉग ड्राइवर लिखता है (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`), इसलिए वह केवल उन कंटेनरों के लॉग देखता है जो इसे (या `json-file` को, जिसे Podman उसी फ़ाइल-आधारित ड्राइवर की तरह मानता है) इस्तेमाल करते हैं। rootful Podman का डिफ़ॉल्ट **`journald`** है, जिसे एजेंट नहीं पढ़ सकता, और न ही वह `syslog` जैसे किसी रिमोट ड्राइवर को पढ़ सकता है।",
  "Check a container's log driver, and Podman's default:":
    "किसी कंटेनर का लॉग ड्राइवर और Podman का डिफ़ॉल्ट जाँचें:",
  "Run a single container with `k8s-file`:":
    "एक कंटेनर `k8s-file` के साथ चलाएँ:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "किसी Compose सर्विस को रोटेशन के साथ `k8s-file` पर बदलें:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "या `containers.conf` में (rootful के लिए `/etc/containers/containers.conf`, rootless के लिए `~/.config/containers/containers.conf`), बाद में बनने वाले हर कंटेनर का डिफ़ॉल्ट बदलें:",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "फिर प्रभावित कंटेनरों को **फिर से बनाएँ** (सिर्फ़ रीस्टार्ट काफ़ी नहीं): कंटेनर वही लॉग ड्राइवर रखता है जिसके साथ वह बना था। `journald` रखना ज़रूरी है? एजेंट फिर भी सॉकेट से मेट्रिक्स इकट्ठा करता है; फ़ाइल-आधारित ड्राइवर केवल कंटेनर लॉग के लिए चाहिए।",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, यानी चरण 2 से शुरू होने वाला दूसरा कंटेनर, वे `docker` कमांड Podman के Docker-संगत सॉकेट के ज़रिए चलाता है जो OneUptime AI इस होस्ट पर किसी घटना या अलर्ट की जाँच करते समय माँगता है। **AI जाँचें डिफ़ॉल्ट रूप से चालू हैं**: कनेक्ट होते ही OneUptime AI इसके साथ जाँच करता है, और होस्ट का **एआई → AI एजेंट** पेज और उसका **अवलोकन** इसकी स्थिति दिखाते हैं। जाँच बंद करने के लिए उस पेज पर **AI क्या कर सकता है** का इस्तेमाल करें; AI एजेंट के बिना कलेक्टर चलाने के लिए इसे `podman rm -f oneuptime-podman-ai-agent` से हटाएँ।",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **डिफ़ॉल्ट रूप से केवल-पढ़ने वाला।** यह `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` और `docker stats --no-stream` जैसे कमांड चलाता है — कभी `exec`, `run`, `rm` या `prune` नहीं। `docker inspect` के आउटपुट में एनवायरनमेंट मान होस्ट से कुछ भी बाहर जाने से पहले छिपा दिए जाते हैं।",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **सुधार आपकी मर्ज़ी से चालू होते हैं।** किसी नाम वाले कंटेनर को रीस्टार्ट, शुरू, बंद, रोकने, ख़त्म करने या उसकी सीमाएँ बदलने देने के लिए कमांड में `-e ONEUPTIME_AI_ALLOW_WRITES=true` जोड़ें। इसके बगल में `ONEUPTIME_AI_FIXES` बताता है कि हर सुधार को स्वीकृति चाहिए या नहीं (`ask-for-approval`, `automatic` या `bypass-approval`), और होस्ट का **एआई → AI एजेंट** पेज इसे दिखाता है। `ONEUPTIME_AI_WRITE_TARGETS` (कॉमा से अलग glob, जैसे `web-*,api-*`) तय करता है कि कौन-से कंटेनर; `ONEUPTIME_AI_PROTECTED_TARGETS` वे कंटेनर जोड़ता है जिन्हें यह कभी नहीं बदलेगा। यह खुद को या कलेक्टर को कभी नहीं बदलता।",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- इसे कलेक्टर वाला ही सॉकेट चाहिए, और यह root के रूप में चलता है क्योंकि सॉकेट root का है। सॉकेट का `:ro` माउंट API को केवल-पढ़ने वाला नहीं बनाता — सीमा एजेंट की कमांड नीति है।",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- इसके लॉग: `podman logs -f oneuptime-podman-ai-agent`। यह क्या चला सकता है और सुधार कैसे काम करते हैं: [इन्फ्रास्ट्रक्चर के लिए AI एजेंट](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts)।",
  "| Tag | Description |": "| टैग | विवरण |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | नवीनतम स्थिर रिलीज़ (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | नवीनतम स्थिर रिलीज़ (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | एक तय संस्करण, जैसे `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | वही इमेज, GHCR पर मिरर की गई |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "`podman run` कमांड के अंत में `oneuptime/podman-agent:release` की जगह इनमें से कोई एक इस्तेमाल करें।",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**अपग्रेड करें** — नवीनतम इमेज खींचें और चल रहे एजेंट को हटाएँ:",
  "Then run both `podman run` commands from step 2 again.":
    "फिर चरण 2 के दोनों `podman run` कमांड फिर से चलाएँ।",
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
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **कंटेनर लॉग** | उन सभी कंटेनरों के stdout/stderr लॉग जो `k8s-file` लॉग ड्राइवर इस्तेमाल करते हैं |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'मेट्रिक्स कलेक्टर के `docker_stats` रिसीवर से, Podman के Docker-संगत सॉकेट के ज़रिए आते हैं, इसलिए उनके नाम Docker एजेंट वाले ही हैं। हर लॉग पंक्ति को उस स्तर से गंभीरता मिलती है जो वह बताती है (`[ERROR]`, `level=warn`, `{"level":"info"}`); बिना स्तर वाली पंक्ति अपनी स्ट्रीम पर निर्भर करती है — stderr `ERROR` है, stdout `INFO` है।',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "`/run/podman/podman.sock` पढ़ने के लिए एजेंट को root के रूप में चलना होगा। पक्का करें कि आपके `podman run` कमांड में `--user 0:0` फ़्लैग है, और सॉकेट चालू है:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "यह rootful Podman का सॉकेट है, वही जिसे एजेंट पढ़ता है। Podman rootless चला रहे हैं? तब इसका सॉकेट `/run/user/<uid>/podman/podman.sock` है (इसे `systemctl --user enable --now podman.socket` से चालू करें) और इसका स्टोरेज `~/.local/share/containers/storage`: इसके बजाय इन्हें एजेंट के कंटेनर में `/run/podman/podman.sock` और `/var/lib/containers/storage` पर माउंट करें — Podman एजेंट का दस्तावेज़ देखें।",
  "The agent's logs show:": "एजेंट के लॉग दिखाते हैं:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "अधिकतम सीमा लागू करने वाला सर्वर नए क्लाइंट को अस्वीकार करता है, कलेक्टर उसी वजह से बंद हो जाता है, और कंटेनर बार-बार रीस्टार्ट होता है। एजेंट Docker API संस्करण तभी तय करता है जब `DOCKER_API_VERSION` कोई संस्करण बताए, और एक पुरानी एजेंट इमेज ने `1.44` तय किया था। एजेंट हटाएँ (`podman rm -f oneuptime-podman-agent`), नवीनतम इमेज खींचें (`podman pull oneuptime/podman-agent:release`) और `-e DOCKER_API_VERSION` के बिना चरण 2 का कमांड फिर से चलाएँ। तब एजेंट सॉकेट के साथ संस्करण तय करता है।",
  "To pin a version anyway, use no more than the version the socket reports:":
    "फिर भी संस्करण तय करना हो, तो सॉकेट जो संस्करण बताता है उससे ज़्यादा न रखें:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "इसे कमांड में जोड़ें, जैसे `-e DOCKER_API_VERSION=1.41`। नए सर्वर अब भी पुराने API संस्करण चलाते हैं, इसलिए तय किया गया संस्करण अपग्रेड के बाद भी काम करता रहता है।",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. जाँचें कि एजेंट चल रहा है: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. एजेंट के लॉग में त्रुटियाँ जाँचें: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. पुष्टि करें कि `podman run` कमांड में OneUptime URL और इंजेशन कुंजी सही हैं।",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. पक्का करें कि होस्ट नेटवर्क पर आपके OneUptime इंस्टेंस तक पहुँच सकता है।",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "जाँचें कि Podman सॉकेट एजेंट में माउंट है। इसकी इमेज में कोई शेल नहीं है, इसलिए किसी ऐसे अस्थायी कंटेनर से देखें जो इसके माउंट साझा करता हो:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "फिर एजेंट के लॉग में एक्सपोर्ट त्रुटियाँ खोजें (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) और पक्का करें कि इंजेशन कुंजी मान्य है और उसकी अवधि ख़त्म नहीं हुई है।",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "मेट्रिक्स आ रहे हैं पर **लॉग** टैब खाली है, या केवल एजेंट के अपने लॉग दिखाता है? आपके कंटेनर शायद कोई फ़ाइल-आधारित लॉग ड्राइवर (`k8s-file` या `json-file`) इस्तेमाल नहीं कर रहे — rootful Podman डिफ़ॉल्ट रूप से `journald` इस्तेमाल करता है, जिसे एजेंट नहीं पढ़ सकता।",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "अगर चरण 1 `no files match the configured criteria` दिखाए, या चरण 3 आपके कंटेनरों की कोई फ़ाइल न दिखाए, तो वे `k8s-file` इस्तेमाल नहीं कर रहे। उन्हें बदलें (उन्नत में **हर कंटेनर से लॉग इकट्ठा करें (k8s-file लॉग ड्राइवर)** देखें), फिर हर एक को फिर से बनाएँ — कंटेनर वही लॉग ड्राइवर रखता है जिसके साथ वह बना था:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "किसी होस्ट का पेज वह डेटा दिखाता है जिसका होस्ट नाम उस होस्ट का पहचानकर्ता है, जिसे एजेंट `PODMAN_HOST_NAME` से लेता है। होस्ट पंजीकृत होने के बाद `PODMAN_HOST_NAME` बदलें, तो OneUptime नए नाम से दूसरा होस्ट पंजीकृत करता है — लॉग उसी पर होते हैं। एजेंट जो नाम बताता है, उसे जाँचें:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "होस्ट का नाम `PODMAN_HOST_NAME` से आता है। इसके बिना शुरू हुआ एजेंट `podman-host` बताता है, इसलिए इस तरह सेट किया गया हर होस्ट एक ही होस्ट जैसा दिखता है। हर होस्ट पर `PODMAN_HOST_NAME` को उसका अपना नाम दें और एजेंट फिर से बनाएँ — `podman rm -f oneuptime-podman-agent`, फिर नए नाम के साथ चरण 2 का कमांड चलाएँ।",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "यह **`web-1`** के लिए एजेंट इंस्टॉल करता है — `PODMAN_HOST_NAME` को बिल्कुल वैसा ही रखें, वरना डेटा नए होस्ट के रूप में पंजीकृत होगा।",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "`podman compose` के लिए एक Compose प्रोवाइडर: `podman-compose` या Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "दूसरी सर्विस OneUptime एआई एजेंट है, उसी URL, कुंजी और होस्ट नाम के साथ। **AI जाँचें डिफ़ॉल्ट रूप से चालू हैं**: जब OneUptime AI इस होस्ट पर किसी घटना या अलर्ट की जाँच करता है, तो वह AI एजेंट के ज़रिए Podman के Docker-संगत सॉकेट पर केवल-पढ़ने वाले `docker` कमांड चलाता है, और जब तक आप सुधारों की अनुमति न दें, कुछ नहीं बदलता — उन्नत में **OneUptime एआई एजेंट** देखें। AI जाँचों के बिना कलेक्टर चलाने के लिए `oneuptime-podman-ai-agent` सर्विस हटा दें।",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "हर एक को एजेंट की `environment:` सूची में सेट करें, फिर नए मानों के साथ उसे दोबारा बनाने के लिए `podman compose up -d` चलाएँ।",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, यानी docker-compose.yml की दूसरी सर्विस, वे `docker` कमांड Podman के Docker-संगत सॉकेट के ज़रिए चलाती है जो OneUptime AI इस होस्ट पर किसी घटना या अलर्ट की जाँच करते समय माँगता है। **AI जाँचें डिफ़ॉल्ट रूप से चालू हैं**: कनेक्ट होते ही OneUptime AI इसके साथ जाँच करता है, और होस्ट का **एआई → AI एजेंट** पेज और उसका **अवलोकन** इसकी स्थिति दिखाते हैं। जाँच बंद करने के लिए उस पेज पर **AI क्या कर सकता है** का इस्तेमाल करें; AI एजेंट के बिना कलेक्टर चलाने के लिए इसकी सर्विस हटाएँ और `podman compose up -d --remove-orphans` चलाएँ।",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **सुधार आपकी मर्ज़ी से चालू होते हैं।** किसी नाम वाले कंटेनर को रीस्टार्ट, शुरू, बंद, रोकने, ख़त्म करने या उसकी सीमाएँ बदलने देने के लिए इसकी `environment:` सूची में `- ONEUPTIME_AI_ALLOW_WRITES=true` जोड़ें। इसके बगल में `ONEUPTIME_AI_FIXES` बताता है कि हर सुधार को स्वीकृति चाहिए या नहीं (`ask-for-approval`, `automatic` या `bypass-approval`), और होस्ट का **एआई → AI एजेंट** पेज इसे दिखाता है। `ONEUPTIME_AI_WRITE_TARGETS` (कॉमा से अलग glob, जैसे `web-*,api-*`) तय करता है कि कौन-से कंटेनर; `ONEUPTIME_AI_PROTECTED_TARGETS` वे कंटेनर जोड़ता है जिन्हें यह कभी नहीं बदलेगा। यह खुद को या कलेक्टर को कभी नहीं बदलता।",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "एजेंट की `image:` पंक्ति पर `oneuptime/podman-agent:release` की जगह इनमें से कोई एक इस्तेमाल करें।",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**अपग्रेड करें** — docker-compose.yml वाले फ़ोल्डर में नवीनतम इमेज खींचें और कंटेनर फिर से बनाएँ:",
  "**Uninstall** — stop and remove everything the file started:":
    "**अनइंस्टॉल करें** — फ़ाइल ने जो कुछ शुरू किया, उसे बंद करके हटाएँ:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    '`/run/podman/podman.sock` पढ़ने के लिए एजेंट को root के रूप में चलना होगा। पक्का करें कि docker-compose.yml में एजेंट की सर्विस में `user: "0:0"` है, और सॉकेट चालू है:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "अधिकतम सीमा लागू करने वाला सर्वर नए क्लाइंट को अस्वीकार करता है, कलेक्टर उसी वजह से बंद हो जाता है, और कंटेनर बार-बार रीस्टार्ट होता है। एजेंट Docker API संस्करण तभी तय करता है जब `DOCKER_API_VERSION` कोई संस्करण बताए, और एक पुरानी एजेंट इमेज ने `1.44` तय किया था। एजेंट की `environment:` सूची से `DOCKER_API_VERSION` हटाएँ, फिर `podman compose pull` और `podman compose up -d` चलाएँ। तब एजेंट सॉकेट के साथ संस्करण तय करता है।",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "इसे एजेंट की `environment:` सूची में जोड़ें, जैसे `- DOCKER_API_VERSION=1.41`, और `podman compose up -d` चलाएँ। नए सर्वर अब भी पुराने API संस्करण चलाते हैं, इसलिए तय किया गया संस्करण अपग्रेड के बाद भी काम करता रहता है।",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. पुष्टि करें कि docker-compose.yml में OneUptime URL और इंजेशन कुंजी सही हैं।",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "होस्ट का नाम `PODMAN_HOST_NAME` से आता है। इसके बिना शुरू हुआ एजेंट `podman-host` बताता है, इसलिए इस तरह सेट किया गया हर होस्ट एक ही होस्ट जैसा दिखता है। हर होस्ट पर `PODMAN_HOST_NAME` को उसका अपना नाम दें और उसके साथ एजेंट फिर से बनाने के लिए `podman compose up -d` चलाएँ।",
};

export default TRANSLATION;
