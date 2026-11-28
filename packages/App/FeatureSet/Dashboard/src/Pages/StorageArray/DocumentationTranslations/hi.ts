import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Compose v2 प्लगइन के साथ Docker Engine 20.10 या नया, ऐसी मशीन पर जो HTTPS (TCP 443) पर FlashArray के प्रबंधन पते तक पहुँच सके",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "FlashArray पर एक एडमिनिस्ट्रेटर खाता, ताकि एजेंट का केवल-पढ़ने वाला उपयोगकर्ता बनाया जा सके",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "टोकन **बिना समाप्ति तिथि** के बनाएँ, नहीं तो जिस दिन टोकन की अवधि ख़त्म होगी उसी दिन एजेंट रुक जाएगा।",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "एडमिनिस्ट्रेटर के रूप में SSH से FlashArray पर जाएँ। पहली कमांड नए उपयोगकर्ता का पासवर्ड पूछती है; दूसरी उसका API टोकन दिखाती है:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. **Settings → Users and Policies** खोलें (पुराने रिलीज़ में **Settings → Access**)।",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. **Users** पैनल के ⋮ मेनू से **Create User…** चुनें, उसे `oneuptime` नाम दें और उसे **readonly** भूमिका दें।",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. नए उपयोगकर्ता के ⋮ मेनू से **Create API Token…** चुनें, **Expires In** खाली छोड़ें और टोकन कॉपी करें।",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "`purefa_info{...} 1` पंक्ति का मतलब है कि ऐरे अपने मेट्रिक्स ख़ुद देता है: आगे बढ़ें। **404** का मतलब है कि उसका Purity//FA पुराना है (Pure नेटिव एंडपॉइंट को 6.7.0 और उसके बाद के लिए दस्तावेज़ित करता है; उसके एक्सपोर्टर की डिप्रिकेशन सूचना 6.6.11 और उसके बाद बताती है) — इसके बजाय इस गाइड में सबसे ऊपर **FlashArray, पुराना Purity** चुनें।",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "पहली पंक्ति स्क्रिप्ट को `install.sh` के रूप में डाउनलोड करती है, ताकि आप उसे चलाने से पहले पढ़ सकें।",
  "The command carries the platform you picked above. The script asks for:":
    "कमांड में ऊपर चुना गया प्लेटफ़ॉर्म शामिल है। स्क्रिप्ट ये पूछती है:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- आपका **OneUptime URL** और **इंजेशन कुंजी**, दोनों चरण 1 में दिखते हैं (उन्हें यहाँ भरा पाने के लिए वहाँ एक कुंजी चुनें)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- एक **ऐरे का नाम**: OneUptime में ऐरे किस नाम से दिखे। हर ऐरे को उसका अपना नाम दें और उसे स्थिर रखें: नया नाम एक नया स्टोरेज ऐरे रजिस्टर करता है",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashArray का **प्रबंधन पता** (होस्ट नाम या IP, `https://` के बिना) और केवल-पढ़ने वाले उपयोगकर्ता का **API टोकन**, जिसे स्क्रिप्ट स्क्रीन पर दिखाए बिना पढ़ती है",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- ऐरे का सर्टिफ़िकेट सत्यापित करना है या नहीं: **N** जवाब दें, जब तक ऐरे पर आपके भरोसे वाले CA का सर्टिफ़िकेट न हो (ऐरे सेल्फ़-साइन्ड सर्टिफ़िकेट के साथ आते हैं)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "यह `/opt/oneuptime-storage-array-agent` में इंस्टॉल होता है, एक ऐसी `.env` फ़ाइल लिखता है जिसे सिर्फ़ आप पढ़ सकते हैं (उसमें API टोकन है) और Docker Compose से एजेंट शुरू करता है।",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "इस OneUptime से compose फ़ाइल और कलेक्टर कॉन्फ़िग एक नए फ़ोल्डर में डाउनलोड करें:",
  "Create a `.env` file next to them:": "उनके बगल में एक `.env` फ़ाइल बनाएँ:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- `my-storage-array` को इस ऐरे के किसी नाम से बदलें, जैसे `fa-prod-01`। OneUptime में ऐरे इसी नाम से दिखता है, इसलिए इसे स्थिर रखें: नया नाम एक नया स्टोरेज ऐरे रजिस्टर करता है।",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- `PURE_FA_ENDPOINT` को FlashArray के प्रबंधन पते पर सेट करें (होस्ट नाम या IP, `https://` के बिना) और `PURE_FA_API_TOKEN` को केवल-पढ़ने वाले उपयोगकर्ता के API टोकन पर। `chmod 600 .env` चलाएँ: इसमें टोकन है।",
  "Start the agent:": "एजेंट शुरू करें:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "लॉग में `Everything is ready. Begin running and processing data.` देखें। पहले स्क्रैप के बाद ऐरे अपने-आप **स्टोरेज ऐरे** सेक्शन में दिखता है, आमतौर पर एक-दो मिनट के भीतर।",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "इंस्टॉल स्क्रिप्ट इन्हें `/opt/oneuptime-storage-array-agent/.env` में लिखती है; Docker Compose वाली इंस्टॉलेशन इन्हें `docker-compose.yml` के बगल वाली `.env` फ़ाइल से पढ़ती है। किसी एक को बदलने के बाद उसे एजेंट के फ़ोल्डर में `docker compose up -d` से लागू करें।",
  "| Variable | Required | Description |": "| वेरिएबल | ज़रूरी | विवरण |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | हाँ | आपके OneUptime इंस्टेंस का URL (जैसे `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | हाँ | टेलीमेट्री इंजेशन कुंजी, वही जो चरण 1 में चुनी गई |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | हाँ | वह नाम जिससे यह ऐरे OneUptime में रजिस्टर होता है। हर मेट्रिक पर `storage.array.name` रिसोर्स एट्रिब्यूट के रूप में लगाया जाता है। इसे स्थिर रखें: इसे बदलने से एक नया स्टोरेज ऐरे रजिस्टर होता है |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | नहीं | प्लेटफ़ॉर्म, जो `storage.system` रिसोर्स एट्रिब्यूट के रूप में लगाया जाता है: `purestorage.flasharray` या `purestorage.flashblade` (डिफ़ॉल्ट: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | नहीं | कौन-सा साथ आया कॉन्फ़िग चलता है: `otel-collector-config.yaml` (FlashArray, नेटिव — डिफ़ॉल्ट), `otel-collector-config.flasharray-exporter.yaml` (पुराना FlashArray) या `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | नहीं | वह एक्सपोर्टर शुरू करता है जिसकी कॉन्फ़िग को ज़रूरत है: नेटिव FlashArray कॉन्फ़िग के लिए खाली, बाकी के लिए `flasharray-exporter` या `flashblade` |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | FlashArray का प्रबंधन पता — होस्ट नाम या IP, `https://` के बिना |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | readonly भूमिका वाले FlashArray उपयोगकर्ता का API टोकन |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | FlashBlade का प्रबंधन पता — होस्ट नाम या IP, `https://` के बिना |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | readonly भूमिका वाले FlashBlade उपयोगकर्ता का API टोकन |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | नहीं | `true` नेटिव एंडपॉइंट पर ऐरे का सेल्फ़-साइन्ड सर्टिफ़िकेट स्वीकार करता है; `false` उसे सत्यापित करता है (डिफ़ॉल्ट: `true`)। Pure के एक्सपोर्टर ऐरे का सर्टिफ़िकेट कभी सत्यापित नहीं करते, इसलिए यह उन पर लागू नहीं होता |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | नहीं | एजेंट के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-storage-array-agent`)। उसी मशीन पर दूसरे ऐरे के एजेंट को अपना अलग नाम चाहिए: अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट नए एजेंट का नाम उसके फ़ोल्डर पर रखती है, और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- कलेक्टर FlashArray के अपने OpenMetrics एंडपॉइंट को HTTPS पर पढ़ता है, टोकन को Bearer क्रेडेंशियल के रूप में भेजकर — कोई एक्सपोर्टर नहीं चलता।",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **हर एंडपॉइंट के लिए एक स्क्रैप जॉब**, हर एक उतनी बार पढ़ा जाता है जितना ज़रूरी हो: `/metrics/array` हर 60 सेकंड; `/metrics/volumes`, `/metrics/hosts` और `/metrics/pods` हर 2 मिनट; `/metrics/directories` हर 30 मिनट — डायरेक्टरी की जगह गिनना ऐरे के लिए महँगा है।",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **हर जॉब अपनी सीरीज़ पर `scrape_endpoint: <endpoint>` लेबल लगाता है**, ताकि OneUptime जाने कि कोई बैच किन ऑब्जेक्ट की पूरी सूची है — इसी तरह कोई हटाया गया ऑब्जेक्ट इन्वेंटरी से निकलता है। लेबल वैसे ही रखें जैसे वे आते हैं।",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **प्रति वॉल्यूम और प्रति होस्ट लेटेंसी तीन डायमेंशन रखती है** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); एक `metric_relabel_configs` नियम QoS, क्यू, SAN और सर्विस-टाइम वाला ब्यौरा हटा देता है, जो बड़े ऐरे की सीरीज़ की संख्या कई गुना कर देता है। पूरे ऐरे का ब्यौरा रखा जाता है।",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **कोई `send_batch_max_size` नहीं।** OneUptime एक पूरे स्क्रैप से इन्वेंटरी फिर से बनाता है, इसलिए `batch` प्रोसेसर कभी किसी स्क्रैप को नहीं बाँटता।",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "यह वह पूरी `otel-collector-config.yaml` है जिसे एजेंट चलाता है; `.env` फ़ाइल `${env:...}` मान देती है:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "एजेंट तब तक सिर्फ़ मेट्रिक्स भेजता है जब तक आप उसके syslog रिसीवर चालू नहीं करते। ऐरे अपने अलर्ट और ऑडिट इवेंट syslog के रूप में आगे भेजते हैं; एजेंट हर पंक्ति पर `storage.array.name` लगाता है, इसलिए वे इस ऐरे के **लॉग** पेज पर पहुँचते हैं।",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. `otel-collector-config.yaml` में `syslog/tcp` और `syslog/udp` रिसीवर और `logs` पाइपलाइन को अनकमेंट करें। क्लासिक BSD syslog टाइमस्टैम्प में टाइम ज़ोन नहीं होता: अगर ऐरे की घड़ी UTC पर नहीं चलती, तो `location` को ऐरे के टाइम ज़ोन पर सेट करें।",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. `docker-compose.yml` में वह `ports:` ब्लॉक अनकमेंट करें जो `5514/tcp` और `5514/udp` प्रकाशित करता है, और मशीन के फ़ायरवॉल में ऐरे के प्रबंधन नेटवर्क के लिए पोर्ट खोलें।",
  "3. Apply both:": "3. दोनों लागू करें:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. FlashArray पर एडमिनिस्ट्रेटर के रूप में **Settings → System → Syslog Servers** खोलें, `udp://<agent-host>:5514` (या `tcp://<agent-host>:5514`) जोड़ें और एक टेस्ट संदेश भेजें।",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "`oneuptime.label.` उपसर्ग वाला कोई भी रिसोर्स एट्रिब्यूट ऐरे पर एक प्रोजेक्ट लेबल बन जाता है: `oneuptime.label.<dimension>=<value>` लेबल `<dimension>:<value>` है। इन्हें आपके इस्तेमाल वाले कलेक्टर कॉन्फ़िग के `resource` प्रोसेसर में `storage.array.name` के बगल में जोड़ें:",
  "Then restart the collector so it reads the new config:":
    "फिर कलेक्टर को रीस्टार्ट करें ताकि वह नया कॉन्फ़िग पढ़े:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "ऐरे `team:storage` और `env:production` लेबल के साथ दिखता है। लेबल बड़े-छोटे अक्षरों का भेद किए बिना मिलाए जाते हैं, इसलिए मौजूदा `Production` लेबल फिर से इस्तेमाल होता है; OneUptime इंटरफ़ेस में जोड़े गए लेबल एजेंट कभी नहीं हटाता।",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "हर मान एक गेज है जिसे FlashArray ख़ुद गिनता है — लेटेंसी प्रति ऑपरेशन माइक्रोसेकंड में, थ्रूपुट प्रति सेकंड। OneUptime के स्टोरेज ऐरे पेज, मेट्रिक कैटलॉग और अलर्ट टेम्पलेट इन पर बने हैं:",
  "| Endpoint | Data |": "| एंडपॉइंट | डेटा |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **ऐरे** (`/metrics/array`) | `purefa_info`, क्षमता और डेटा रिडक्शन (`purefa_array_space_*`), परफ़ॉर्मेंस, खुले अलर्ट (`purefa_alerts_open`), हार्डवेयर कंपोनेंट, ड्राइव, कंट्रोलर और नेटवर्क इंटरफ़ेस |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **वॉल्यूम** (`/metrics/volumes`) | हर वॉल्यूम की लेटेंसी, IOPS, बैंडविड्थ, जगह और डेटा रिडक्शन |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **होस्ट** (`/metrics/hosts`) | हर होस्ट की कनेक्टिविटी, जुड़े वॉल्यूम, लेटेंसी, IOPS और जगह |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **पॉड** (`/metrics/pods`) | ActiveCluster और ActiveDR रेप्लिका लिंक की देरी, मीडिएटर स्थिति, परफ़ॉर्मेंस और जगह |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **डायरेक्टरी** (`/metrics/directories`) | FlashArray फ़ाइल सर्विसेज़ की प्रबंधित डायरेक्टरी की जगह और परफ़ॉर्मेंस |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "एक एजेंट एक ऐरे पढ़ता है। एक ही मशीन से कई ऐरे मॉनिटर करने के लिए, हर एक को उसकी अपनी `.env` और उसके अपने कंटेनर नाम के साथ उसके अपने फ़ोल्डर में इंस्टॉल करें — दो कंटेनर एक ही नाम नहीं रख सकते:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "`STORAGE_ARRAY_AGENT_CONTAINER_NAME` के बिना स्क्रिप्ट कंटेनर का नाम फ़ोल्डर के नाम पर रखती है। स्क्रिप्ट यह नाम उस एजेंट की `.env` में सहेज लेती है, इसलिए एजेंट अपग्रेड करने के लिए स्क्रिप्ट फिर से चलाने पर भी नाम बना रहता है, और जिस एजेंट का `container_name` आपने कभी `docker-compose.yml` में बदला था, वह वही नाम रखता है। Docker Compose के साथ, इसके बजाय हर एजेंट की `.env` में `STORAGE_ARRAY_AGENT_CONTAINER_NAME` सेट करें।",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "एजेंट के साथ एक systemd यूनिट आती है जो इंस्टॉल स्क्रिप्ट के फ़ोल्डर `/opt/oneuptime-storage-array-agent` को मानकर चलती है। इंस्टॉल स्क्रिप्ट इसे डाउनलोड नहीं करती, इसलिए इसे ख़ुद लाएँ:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**अपग्रेड करें**: कलेक्टर इमेज `docker-compose.yml` में पिन है और उसके कॉन्फ़िग उसके बगल की फ़ाइलें हैं, इसलिए सिर्फ़ इमेज पुल करने से एजेंट आगे नहीं बढ़ता। इंस्टॉल स्क्रिप्ट फिर से चलाएँ। यह आपकी मौजूदा `.env` का हर मान फिर से इस्तेमाल करती है (कुछ भी दोबारा नहीं पूछा जाता), नवीनतम `docker-compose.yml` और कलेक्टर कॉन्फ़िग डाउनलोड करती है (आपकी बदली हुई फ़ाइल नई फ़ाइल के बगल में `<file>.bak.<timestamp>` के रूप में रखी जाती है) और उनसे एजेंट को फिर से बनाती है:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "`/opt/oneuptime-storage-array-agent` के बाहर इंस्टॉल किए गए एजेंट (जैसे किसी दूसरे ऐरे का) को अपना फ़ोल्डर चाहिए: `INSTALL_DIR=<folder> bash install.sh`।",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "इसके बजाय Docker Compose से इंस्टॉल किया था? एजेंट के फ़ोल्डर में compose फ़ाइल और कलेक्टर कॉन्फ़िग फिर से डाउनलोड करें; आपकी `.env` बनी रहती है, और इनमें से किसी में किया गया बदलाव फिर से करना होगा:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "फिर इमेज पुल करें और एजेंट को फिर से बनाएँ, ताकि कलेक्टर अपना नया कॉन्फ़िग पढ़े:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "कॉन्फ़िग जिस कलेक्टर संस्करण को पिन करता है, उसे ऐरे के **एजेंट संस्करण** के रूप में बताता है। जब यह OneUptime कोई नया संस्करण पिन करता है, तो उसके बगल का चेतावनी चिह्न ये कमांड खोलता है।",
  "**Uninstall** the agent:": "एजेंट को **अनइंस्टॉल करें**:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "फिर अगर ज़रूरत न हो तो ऐरे पर केवल-पढ़ने वाला उपयोगकर्ता और उसका API टोकन हटा दें।",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` पूरी कड़ी जाँचता है (कंटेनर रनटाइम, ऐरे का एंडपॉइंट ठीक वैसे जैसे कलेक्टर उस तक पहुँचता है — नेटिव एंडपॉइंट या Pure का एक्सपोर्टर, DNS, TLS, API टोकन — ऐरे के नाम का लगना, कलेक्टर के अपने मेट्रिक्स) और OneUptime से सीधे पूछता है कि क्या वह आपकी इंजेशन कुंजी स्वीकार करता है। यह आख़िरी जाँच सबसे ज़्यादा मायने रखती है: OneUptime के OTLP एंडपॉइंट ग़लत कुंजी को `401` या `422` से ठुकराते हैं, जिसे कलेक्टर हर बैच के लिए `Exporting failed` की एक ही ऐसी पंक्ति के रूप में लॉग करता है जो आसानी से छूट जाती है, इसलिए स्क्रिप्ट `GET /otlp/v1/validate` से सीधा 200/401 फ़ैसला माँगती है।",
  "It ends with a verdict naming the most likely cause.":
    "यह सबसे संभावित कारण बताने वाले फ़ैसले के साथ ख़त्म होता है।",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. कलेक्टर के लॉग जाँचें: `docker logs oneuptime-storage-array-agent`। `server returned HTTP status 401` का मतलब है कि ऐरे ने API टोकन ठुकरा दिया, `404` का कि FlashArray के पास नेटिव एंडपॉइंट नहीं है, `x509` का कि ऐरे के सेल्फ़-साइन्ड सर्टिफ़िकेट के ख़िलाफ़ TLS सत्यापन चालू है, `no such host` या `connection refused` का कि `PURE_FA_ENDPOINT` ग़लत है, और एक्सपोर्ट में `401` का कि इंजेशन कुंजी ग़लत है।",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. पक्का करें कि `STORAGE_ARRAY_NAME` सेट है — डिस्कवरी `storage.array.name` रिसोर्स एट्रिब्यूट पर टिकी है, और इसके बिना कलेक्टर शुरू होने से मना कर देता है।",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. पक्का करें कि `STORAGE_ARRAY_COLLECTOR_CONFIG` और `COMPOSE_PROFILES` एक ही प्लेटफ़ॉर्म बताते हैं।",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "इसके Purity//FA में कोई नेटिव OpenMetrics एंडपॉइंट नहीं है। `.env` में `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` और `COMPOSE_PROFILES=flasharray-exporter` सेट करें और `docker compose up -d` चलाएँ — या पुराने Purity वाले विकल्प के साथ `install.sh` फिर से चलाएँ। ऐरे को Purity//FA 6.7 या उसके बाद के संस्करण पर अपग्रेड करने के बाद नेटिव कॉन्फ़िग पर लौटें और प्रोफ़ाइल हटा दें।",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "जाँचें कि आपने टोकन चिपकाया है, उपयोगकर्ता का पासवर्ड नहीं; कि उपयोगकर्ता अब भी मौजूद है और उसके पास readonly भूमिका है; और कि टोकन की अवधि ख़त्म नहीं हुई है। एक नया टोकन बनाएँ (FlashArray पर `pureadmin create --api-token oneuptime`), उसे `.env` में `PURE_FA_API_TOKEN` के रूप में रखें और `docker compose up -d` चलाएँ।",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "ऐरे डिफ़ॉल्ट रूप से एक सेल्फ़-साइन्ड सर्टिफ़िकेट दिखाते हैं, जिस पर कोई Docker इमेज भरोसा नहीं करती। `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` सेट करें (निजी प्रबंधन नेटवर्क पर व्यावहारिक विकल्प), या ऐरे पर ऐसे CA का सर्टिफ़िकेट इंस्टॉल करें जिस पर कलेक्टर इमेज भरोसा करती है।",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` या `pure-fb-exporter` नहीं चल रहा: `COMPOSE_PROFILES` को `STORAGE_ARRAY_COLLECTOR_CONFIG` से मेल खाना चाहिए — FlashArray एक्सपोर्टर कॉन्फ़िग के लिए `flasharray-exporter`, FlashBlade कॉन्फ़िग के लिए `flashblade`। `.env` ठीक करें और `docker compose up -d` चलाएँ; इसके बाद `docker compose ps` एक्सपोर्टर दिखाता है।",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. जाँचें कि एजेंट चल रहा है: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. एजेंट के लॉग में त्रुटियाँ जाँचें: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. पुष्टि करें कि आपका OneUptime URL और इंजेशन कुंजी सही हैं।",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. पक्का करें कि एजेंट की मशीन नेटवर्क पर OneUptime इंस्टेंस तक पहुँच सकती है।",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "ऐरे की पहचान `STORAGE_ARRAY_NAME` से आती है, जो हर मेट्रिक पर `storage.array.name` के रूप में लगाई जाती है। इसे `.env` में ठीक करें और एजेंट के फ़ोल्डर में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया स्टोरेज ऐरे रजिस्टर करता है।",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "यह ऐरे को **`array-1`** के रूप में रजिस्टर करता है — वह नाम जो इस ऐरे का OneUptime में पहले से है।",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- यह **`array-1`** के लिए एजेंट इंस्टॉल करता है: `STORAGE_ARRAY_NAME` को ठीक वैसा ही रहने दें, नहीं तो डेटा एक नए स्टोरेज ऐरे के रूप में रजिस्टर होगा।",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "ऐरे की पहचान `STORAGE_ARRAY_NAME` से आती है, जो हर मेट्रिक पर `storage.array.name` के रूप में लगाई जाती है। यह ऐरे **`array-1`** है। इसे `.env` में ठीक करें और एजेंट के फ़ोल्डर में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया स्टोरेज ऐरे रजिस्टर करता है।",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "कमांड में आपका OneUptime URL, इंजेशन कुंजी और ऊपर चुना गया प्लेटफ़ॉर्म पहले से हैं। स्क्रिप्ट ये पूछती है:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "उस मशीन से `quay.io` तक पहुँच, जहाँ से Docker Pure के एक्सपोर्टर की इमेज पुल करता है",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` कलेक्टर के बगल में `pure-fa-exporter`, यानी Pure का एक्सपोर्टर, शुरू करता है; दोनों का मेल खाना ज़रूरी है।",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "एजेंट के फ़ोल्डर में `docker compose ps` **`pure-fa-exporter`** भी दिखाता है, यानी Pure का एक्सपोर्टर, जिसके ज़रिए कलेक्टर FlashArray को पढ़ता है।",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- कलेक्टर FlashArray को `pure-fa-exporter`, यानी Pure के एक्सपोर्टर, के ज़रिए पढ़ता है, जो हर स्क्रैप पर कलेक्टर के भेजे टोकन से FlashArray के REST API में लॉग इन करता है। एक्सपोर्टर का पोर्ट compose नेटवर्क के भीतर ही रहता है।",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Compose v2 प्लगइन के साथ Docker Engine 20.10 या नया, ऐसी मशीन पर जो HTTPS (TCP 443) पर FlashBlade के प्रबंधन पते तक पहुँच सके",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "FlashBlade पर एक एडमिनिस्ट्रेटर खाता, ताकि एजेंट का केवल-पढ़ने वाला उपयोगकर्ता बनाया जा सके",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "FlashBlade पर एडमिनिस्ट्रेटर के रूप में **readonly** भूमिका के साथ `oneuptime` नाम का एक उपयोगकर्ता बनाएँ — FlashBlade GUI की उपयोगकर्ता सेटिंग्स में, या Purity//FB CLI में `pureadmin` से — और उसके लिए एक **API टोकन** बनाएँ। टोकन **बिना समाप्ति तिथि** के बनाएँ, नहीं तो जिस दिन टोकन की अवधि ख़त्म होगी उसी दिन एजेंट रुक जाएगा।",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "FlashBlade API टोकन `T-` से शुरू होते हैं। बिना लोकल उपयोगकर्ताओं वाला Purity//FB रिलीज़ इसके बजाय किसी डायरेक्टरी सर्विस (LDAP या Active Directory) का ऐसा खाता लेता है जिसका समूह readonly भूमिका से जुड़ा हो।",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashBlade का **प्रबंधन पता** (होस्ट नाम या IP, `https://` के बिना) और केवल-पढ़ने वाले उपयोगकर्ता का **API टोकन**, जिसे स्क्रिप्ट स्क्रीन पर दिखाए बिना पढ़ती है",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- `PURE_FB_ENDPOINT` को FlashBlade के प्रबंधन पते पर सेट करें (होस्ट नाम या IP, `https://` के बिना) और `PURE_FB_API_TOKEN` को केवल-पढ़ने वाले उपयोगकर्ता के API टोकन पर। `chmod 600 .env` चलाएँ: इसमें टोकन है।",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "एजेंट के फ़ोल्डर में `docker compose ps` **`pure-fb-exporter`** भी दिखाता है, यानी Pure का एक्सपोर्टर, जिसके ज़रिए कलेक्टर FlashBlade को पढ़ता है।",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- कलेक्टर FlashBlade को `pure-fb-exporter`, यानी Pure के एक्सपोर्टर, के ज़रिए पढ़ता है, जो हर स्क्रैप पर कलेक्टर के भेजे टोकन से FlashBlade के REST API में लॉग इन करता है। एक्सपोर्टर का पोर्ट compose नेटवर्क के भीतर ही रहता है।",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **हर एंडपॉइंट के लिए एक स्क्रैप जॉब**, हर एक उतनी बार पढ़ा जाता है जितना ज़रूरी हो: `/metrics/array` हर 60 सेकंड; `/metrics/filesystems` और `/metrics/objectstore` हर 5 मिनट — FlashBlade REST API हर फ़ाइल सिस्टम और बकेट की जल्दी रिपोर्ट करने के लिए नहीं बना है।",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. FlashBlade पर एडमिनिस्ट्रेटर के रूप में उसकी syslog सेटिंग्स में एक syslog सर्वर `udp://<agent-host>:5514` (या `tcp://`) जोड़ें।",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "हर मान एक गेज है जिसे FlashBlade ख़ुद गिनता है — लेटेंसी प्रति ऑपरेशन माइक्रोसेकंड में, थ्रूपुट प्रति सेकंड। OneUptime के स्टोरेज ऐरे पेज, मेट्रिक कैटलॉग और अलर्ट टेम्पलेट इन पर बने हैं:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **ऐरे** (`/metrics/array`) | `purefb_info`, क्षमता और डेटा रिडक्शन (`purefb_array_space_*`), प्रति प्रोटोकॉल परफ़ॉर्मेंस, खुले अलर्ट (`purefb_alerts_open`), हार्डवेयर की सेहत (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **फ़ाइल सिस्टम** (`/metrics/filesystems`) | हर फ़ाइल सिस्टम की जगह, डेटा रिडक्शन और परफ़ॉर्मेंस |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **ऑब्जेक्ट स्टोर** (`/metrics/objectstore`) | हर बकेट की जगह, कोटा, ऑब्जेक्ट की संख्या और परफ़ॉर्मेंस |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Compose v2 प्लगइन के साथ Docker Engine 20.10 या नया, ऐसी मशीन पर जो UDP 161 (SNMP) पर क्लस्टर के हर नोड तक पहुँच सके",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "क्लस्टर पर एक एडमिनिस्ट्रेटर खाता, ताकि SNMP चालू किया जा सके और एजेंट की केवल-पढ़ने वाली कम्युनिटी या SNMPv3 उपयोगकर्ता सेट किया जा सके",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "एडमिनिस्ट्रेटर के रूप में SSH से किसी भी नोड पर जाएँ: OneFS SNMP सेटिंग पूरे क्लस्टर पर लागू करता है। अगर क्लस्टर किसी दूसरे टूल के लिए पहले से SNMP का जवाब देता है, तो एजेंट को वही कम्युनिटी या उपयोगकर्ता दें और यह चरण छोड़ दें। वरना अपनी केवल-पढ़ने वाली कम्युनिटी के साथ SNMP v2c चालू करें, OneFS की डिफ़ॉल्ट `I$ilonpublic` के साथ नहीं:",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "या SNMPv3 चालू करें, जो हर पोल को प्रमाणित और एन्क्रिप्ट करता है। OneFS में SNMPv3 का एक ही केवल-पढ़ने वाला उपयोगकर्ता होता है, जिसका नाम बदलने तक वह `general` है: उसे कम से कम आठ अक्षरों के, बिना स्पेस वाले पासवर्ड दें:",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` सेटिंग दिखाता है, उपयोगकर्ता के प्रमाणीकरण और गोपनीयता प्रोटोकॉल के साथ। एजेंट की मशीन से हर नोड तक UDP 161 की अनुमति दें, और `isi network interfaces list` से नोड के पते सूचीबद्ध करें।",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- **सभी नोड के पते**, कॉमा से अलग किए हुए: हर नोड का अपना पता, कभी SmartConnect ज़ोन का नाम नहीं, क्योंकि कोई नोड सिर्फ़ अपनी ड्राइव, सेंसर और पोर्ट के लिए जवाब देता है",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- **SNMP वर्शन**, फिर केवल-पढ़ने वाली **कम्युनिटी**, या SNMPv3 **उपयोगकर्ता** और उसके दो पासवर्ड, जिनमें से हर एक को स्क्रिप्ट स्क्रीन पर दिखाए बिना पढ़ती है",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "जिस उपयोगकर्ता के प्रोटोकॉल SHA और AES नहीं हैं, उसे `bash install.sh` से पहले `POWERSCALE_SNMP_AUTH_PROTOCOL` और `POWERSCALE_SNMP_PRIVACY_PROTOCOL` चाहिए, और बिना गोपनीयता वाले उपयोगकर्ता को `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`।",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "यह `/opt/oneuptime-storage-array-agent` में इंस्टॉल होता है, एक ऐसी `.env` फ़ाइल लिखता है जिसे सिर्फ़ आप पढ़ सकते हैं (उसमें कम्युनिटी या SNMPv3 पासवर्ड हैं), जिसमें हर नोड के लिए एक पोल होता है, और Docker Compose से एजेंट शुरू करता है। जब क्लस्टर में कोई नोड जुड़े, तो उस फ़ाइल में `POWERSCALE_NODES` में उसका पता जोड़ें और `bash install.sh` फिर से चलाएँ।",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- `my-storage-array` को इस क्लस्टर के किसी नाम से बदलें, जैसे `ps-prod`। OneUptime में क्लस्टर इसी नाम से दिखता है, इसलिए इसे स्थिर रखें: नया नाम एक नया स्टोरेज ऐरे रजिस्टर करता है।",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- `POWERSCALE_NODES` में हर नोड सूचीबद्ध करें और हर एक को उसका अपना `POWERSCALE_NODE_<n>` और `POWERSCALE_SNMP_RECEIVERS` में `snmp/cluster` और `snmp/quotas` के बाद उसका अपना `snmp/node-<n>` दें, 252 तक। IPv6 पता ब्रैकेट में जाता है, जैसे `[fd00::11]`।",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- SNMPv3 के लिए, कम्युनिटी के बजाय `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` और `POWERSCALE_SNMP_PRIVACY_PASSWORD` सेट करें। `chmod 600 .env` चलाएँ: इसमें कम्युनिटी या पासवर्ड हैं।",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | हाँ | वह नाम जिससे यह क्लस्टर OneUptime में रजिस्टर होता है, हर मेट्रिक पर `storage.array.name` के रूप में लगाया जाता है। इसे स्थिर रखें: इसे बदलने से एक नया स्टोरेज ऐरे रजिस्टर होता है |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | हाँ | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | हाँ | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | हाँ | सभी नोड के पते, कॉमा से अलग किए हुए। इंस्टॉल स्क्रिप्ट इससे नीचे दिए पोल लिखती है |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | हाँ | वह नोड जिसके ज़रिए क्लस्टर का अपना स्वास्थ्य, क्षमता और कोटा पढ़े जाते हैं: `POWERSCALE_NODES` में पहला |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | हाँ | कलेक्टर जो पोल चलाता है: `snmp/cluster`, `snmp/quotas`, फिर हर नोड के लिए `snmp/node-<n>` |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | हाँ | नोड `<n>` का पता, 1 से 252 तक |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | नहीं | `v2c` (डिफ़ॉल्ट) या `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | क्लस्टर की केवल-पढ़ने वाली कम्युनिटी |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | क्लस्टर का SNMPv3 केवल-पढ़ने वाला उपयोगकर्ता |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | नहीं | `auth_priv` (डिफ़ॉल्ट), `auth_no_priv` या `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | नहीं | `SHA` (डिफ़ॉल्ट), `MD5`, `SHA224`, `SHA256`, `SHA384` या `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | SNMPv3 उपयोगकर्ता का प्रमाणीकरण पासवर्ड |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | नहीं | `AES` (डिफ़ॉल्ट), `DES`, `AES192`, `AES256`, `AES192C` या `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | SNMPv3 उपयोगकर्ता का गोपनीयता पासवर्ड |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **एक कलेक्टर, कोई एक्सपोर्टर नहीं।** कलेक्टर का अपना SNMP रिसीवर Dell का ISILON-MIB पढ़ता है; उसके बगल में और कुछ नहीं चलता।",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **क्लस्टर के ऑब्जेक्ट एक बार, `POWERSCALE_ENDPOINT` के ज़रिए:** उसका स्वास्थ्य, क्षमता, थ्रूपुट और नोड की गिनती हर 60 सेकंड (`snmp/cluster`), और उसके SmartQuotas हर 5 मिनट (`snmp/quotas`)।",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **हर नोड के ऑब्जेक्ट उसी नोड से:** उसका स्वास्थ्य, CPU, प्रोटोकॉल प्रदर्शन, ड्राइव, सेंसर और पोर्ट हर 60 सेकंड (`snmp/node-<n>`)।",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **हर पोल अपनी सीरीज़ पर `scrape_endpoint: <poll>` लेबल लगाता है**, ताकि OneUptime जाने कि कोई बैच किन ऑब्जेक्ट की पूरी सूची है — इसी तरह कोई हटाया गया कोटा इन्वेंटरी से निकलता है। लेबल वैसे ही रखें जैसे वे आते हैं।",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "पूरा कॉन्फ़िग, हर नोड स्लॉट के लिए एक SNMP रिसीवर के साथ, एजेंट के फ़ोल्डर में `otel-collector-config.powerscale.yaml` है:",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "फिर अगर कोई और उसे पोल नहीं करता, तो क्लस्टर पर SNMP बंद करें, या एजेंट की कम्युनिटी या SNMPv3 पासवर्ड बदल दें।",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "`troubleshoot.sh` पूरी कड़ी जाँचता है (कंटेनर रनटाइम, `.env` में नोड के पते और कम्युनिटी या SNMPv3 उपयोगकर्ता, मशीन पर `snmpget` हो तो उससे हर नोड, ऐरे के नाम का लगना, कलेक्टर के अपने मेट्रिक्स) और OneUptime से सीधे पूछता है कि क्या वह आपकी इंजेशन कुंजी स्वीकार करता है।",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`docker logs oneuptime-storage-array-agent` में `request timeout` के साथ `Error scraping metrics` ऐसे नोड का नाम बताता है जो इस मशीन से SNMP का जवाब नहीं देता: एजेंट जिस वर्शन का इस्तेमाल करता है उसके लिए SNMP बंद है, कम्युनिटी या SNMPv3 उपयोगकर्ता क्लस्टर का नहीं है, या रास्ते में UDP 161 ब्लॉक है। जो नोड जवाब देता है लेकिन क्लस्टर के नोड में नहीं दिखता, वह `POWERSCALE_NODES` में नहीं है: उसे जोड़ें और `bash install.sh` फिर से चलाएँ।",
};

export default TRANSLATION;
