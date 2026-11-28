import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Compose v2 प्लगइन के साथ Docker Engine 20.10 या नया, ऐसी मशीन पर जो पोर्ट 8006 पर हर नोड के Proxmox VE API तक पहुँच सके",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "केवल-पढ़ने वाला API टोकन बनाने के लिए किसी भी PVE नोड पर root शेल, या Proxmox का वेब UI",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "बेहतर हो कि क्लस्टर के बाहर की मशीन, या ऐसी VM जिसे Proxmox HA किसी दूसरे नोड पर फिर से शुरू करता है: कोई नोड बंद होने पर एजेंट क्लस्टर को दूसरे नोड से पढ़ता है, पर एजेंट की अपनी मशीन बंद होने पर ऐसा नहीं कर सकता",
  "As root on any PVE node:": "किसी भी PVE नोड पर root के रूप में:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- पहली पंक्ति सिर्फ़ तभी विफल होती है, और वह भी बिना नुक़सान के, जब `monitoring@pam` पहले से मौजूद हो। API टोकन का अपना सीक्रेट होता है, इसलिए उपयोगकर्ता को न पासवर्ड चाहिए, न सिस्टम खाता।",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` टोकन का सीक्रेट दिखाता है: उसे अभी कॉपी करें, वह सिर्फ़ एक बार दिखता है। टोकन ID `monitoring@pam!oneuptime` है।",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- भूमिका उपयोगकर्ता और टोकन दोनों को दी जाती है, क्योंकि अलग किए गए विशेषाधिकारों वाले टोकन को सिर्फ़ वही अनुमतियाँ मिलती हैं जो उसके उपयोगकर्ता के पास भी हैं। भूमिका रूट पाथ `/` पर होनी चाहिए: pve-exporter पूरे क्लस्टर की स्थिति पढ़ता है, और किसी सब-पाथ तक सीमित टोकन `Permission check failed (/, Sys.Audit)` के साथ विफल होता है।",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. *Datacenter → Permissions → API Tokens* पर जाएँ और **Add** पर क्लिक करें।",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. कोई उपयोगकर्ता चुनें (या बनाएँ), टोकन को `oneuptime` जैसा ID दें, पक्का करें कि **Privilege Separation** चुना हुआ है, और **Add** पर क्लिक करें।",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. टोकन ID (`user@realm!tokenname`) और सीक्रेट कॉपी करें: सीक्रेट सिर्फ़ एक बार दिखता है।",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. *Datacenter → Permissions* में **Add** पर दो बार क्लिक करके पाथ `/` को **PVEAuditor** भूमिका दें: एक बार टोकन के लिए **API Token Permission** के रूप में, और एक बार उसके उपयोगकर्ता के लिए **User Permission** के रूप में।",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "अलग किए गए विशेषाधिकारों वाले टोकन को सिर्फ़ वही अनुमतियाँ मिलती हैं जो उसके उपयोगकर्ता के पास भी हैं, इसलिए दोनों को भूमिका चाहिए। भूमिका रूट पाथ `/` पर होनी चाहिए: pve-exporter पूरे क्लस्टर की स्थिति पढ़ता है, और किसी सब-पाथ तक सीमित टोकन `Permission check failed (/, Sys.Audit)` के साथ विफल होता है।",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "स्क्रिप्ट आपका OneUptime URL और इंजेशन कुंजी पूछती है, दोनों चरण 1 में दिखते हैं (उन्हें यहाँ भरा पाने के लिए वहाँ एक कुंजी चुनें), और फिर ये पूछती है:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **क्लस्टर का नाम**: OneUptime में क्लस्टर किस नाम से दिखे। हर क्लस्टर को उसका अपना नाम दें और उसे स्थिर रखें: नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox VE API होस्ट**: कोई भी नोड, जैसे `192.168.1.10`। जब तक उसका API जवाब नहीं देता, एजेंट नीचे की सूची के अगले नोड से क्लस्टर पढ़ता है।",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **साथ आने वाला prometheus-pve-exporter**: अगर आप पहले से कोई नहीं चलाते, तो **Y** जवाब दें।",
  "- **API token** — the token id and secret from the previous step.":
    "- **API टोकन**: पिछले चरण का टोकन ID और सीक्रेट।",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **हर नोड का पता**: हर नोड का अपना पता, कॉमा से अलग किया हुआ, कभी भी वर्चुअल IP नहीं। टोकन होने पर स्क्रिप्ट क्लस्टर की अपनी सूची सुझाती है: उसे लेने के लिए Enter दबाएँ। पहला नोड बंद होने पर भी एजेंट इन्हीं नोड से क्लस्टर पढ़ता है।",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI एजेंट**: क्या वह सुधार लागू कर सकता है; उसे केवल-पढ़ने वाला रखने के लिए **N** जवाब दें।",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "यह `/opt/oneuptime-proxmox-agent` में इंस्टॉल होती है, `0600` अनुमति वाली `.env` फ़ाइल लिखती है और Docker Compose से सब कुछ शुरू करती है। स्क्रिप्ट दोबारा चलाने पर वह फिर से पूछने के बजाय उस `.env` की हर चीज़ दोबारा इस्तेमाल करती है, इसलिए अपग्रेड भी इसी तरह होता है।",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` कलेक्टर (`oneuptime-proxmox-agent`), नोड फ़ेलओवर (`oneuptime-pve-api-failover`), साथ आने वाले एक्सपोर्टर (`oneuptime-pve-exporter`, अगर आप अपना एक्सपोर्टर नहीं चलाते) और OneUptime AI एजेंट (`oneuptime-proxmox-ai-agent`) को दिखाता है। कलेक्टर के लॉग में `Everything is ready. Begin running and processing data.` खोजें। इसके बाद क्लस्टर अपने आप **Proxmox** सेक्शन में दिखता है।",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**OneUptime AI एजेंट (डिफ़ॉल्ट रूप से चालू, केवल-पढ़ने वाला)।** AI जाँच चालू है: यह OneUptime AI को केवल-पढ़ने वाले `pvesh` अनुरोधों से इस क्लस्टर की घटनाओं और अलर्ट की जाँच करने देता है, और जब तक आप सुधारों की अनुमति न दें, कुछ नहीं बदलता; उन्नत में **OneUptime AI एजेंट** देखें।",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Proxmox VE 8.3 या नया चाहिए। दोनों कमांड दिखाने के लिए चरण 1 में एक इंजेशन कुंजी चुनें: इनमें कुंजी होती है, जिसे Proxmox VE उस वेबहुक टारगेट में रखता है जिसे ये कमांड जोड़ती हैं।",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "इसके बाद हर गेस्ट के पेज पर उसका पिछला बैकअप दिखता है, और क्लस्टर के **सुझाव** में **Backup Job Failed** और **Node Fenced** अलर्ट दिखते हैं।",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "इंस्टॉल स्क्रिप्ट इन्हें `/opt/oneuptime-proxmox-agent/.env` में लिखती है। किसी एक को बदलने के बाद उसे `/opt/oneuptime-proxmox-agent` में `docker compose up -d` से लागू करें।",
  "| Variable | Required | Description |": "| वेरिएबल | ज़रूरी | विवरण |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | हाँ | आपके OneUptime इंस्टेंस का URL (जैसे `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | हाँ | टेलीमेट्री इंजेशन कुंजी, वही जो चरण 1 में चुनी गई |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | हाँ | OneUptime में दिखने वाला क्लस्टर पहचानकर्ता। हर मेट्रिक पर `proxmox.cluster.name` रिसोर्स एट्रिब्यूट के रूप में लगाया जाता है। इसे स्थिर रखें: इसे बदलने से एक नया क्लस्टर रजिस्टर होता है (डिफ़ॉल्ट: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | हाँ | वह नोड जिसके Proxmox VE API से एक्सपोर्टर क्लस्टर पढ़ता है और जिससे AI एजेंट पूछताछ करता है, जैसे `192.168.1.10`। जब तक उसका API जवाब नहीं देता, दोनों `PVE_NODES` में जवाब देने वाले अगले नोड का इस्तेमाल करते हैं |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | क्लस्टर होने पर | हर नोड का अपना API पता, कॉमा से अलग करके वर्ग कोष्ठकों में, जैसे `[192.168.1.10,192.168.1.11,192.168.1.12]`। डिफ़ॉल्ट रूप से सिर्फ़ `PVE_HOST`, जो एक अकेले नोड के लिए काफ़ी है। एक्सपोर्टर बूट पर शुरू (Guest Down), रेप्लिकेशन और सब्सक्रिप्शन सिर्फ़ उसी नोड के लिए पढ़ता है जिससे वह पूछता है, इसलिए हर नोड से बारी-बारी से पूछा जाता है; छूटा हुआ नोड दिखता ही नहीं। `PVE_HOST` बंद होने पर एजेंट इनमें से अगले नोड से भी क्लस्टर पढ़ता है। |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | नहीं | prometheus-pve-exporter का पता (`host:port`, बिना स्कीम के)। डिफ़ॉल्ट रूप से साथ आने वाला एक्सपोर्टर (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | साथ आने वाला एक्सपोर्टर और AI एजेंट | Proxmox API टोकन का पूरा ID, जैसे `monitoring@pam!oneuptime` (PVEAuditor, केवल-पढ़ने वाला) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | साथ आने वाला एक्सपोर्टर और AI एजेंट | Proxmox API टोकन का सीक्रेट |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | नहीं | Proxmox API का TLS प्रमाणपत्र जाँचें (डिफ़ॉल्ट: `false`; PVE सेल्फ़-साइन्ड प्रमाणपत्रों के साथ आता है) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | नहीं | साथ आने वाले एक्सपोर्टर का कंटेनर शुरू करने के लिए इसे `pve-exporter` पर सेट करें |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI एजेंट की अपनी सेटिंग **OneUptime AI एजेंट** में हैं।",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "जब इंस्टॉल स्क्रिप्ट पूछे **Run the bundled prometheus-pve-exporter?**, तो **n** जवाब दें और अपने एक्सपोर्टर का पता (`host:port`, बिना स्कीम के) दें।",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "ऐसा पता इस्तेमाल करें जिस तक एजेंट का कंटेनर पहुँच सके, यानी होस्ट का LAN IP या DNS नाम: कंटेनर के अंदर `localhost` ख़ुद कंटेनर है। अगर आप OneUptime AI एजेंट इस्तेमाल करते हैं, तो `PVE_API_TOKEN_ID` और `PVE_API_TOKEN_SECRET` को `.env` में रहने दें, क्योंकि AI एजेंट उसी टोकन से API पढ़ता है।",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "एजेंट हर 30 सेकंड में एक्सपोर्टर को स्क्रेप करता है: उसके क्लस्टर कलेक्टर एक बार, `PVE_HOST` पर (या, जब तक `PVE_HOST` बंद है, उस नोड पर जिससे वह क्लस्टर पढ़ता है), और उसके नोड कलेक्टर `PVE_NODES` के हर नोड के लिए एक बार। हर सीरीज़ पर संसाधन की पहचान करने वाला `id` लेबल होता है: `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` या `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| श्रेणी | मेट्रिक्स |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **उपलब्धता** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **नोड** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **गेस्ट (VM / LXC)** | `pve_guest_info`, साथ ही `qemu/*` और `lxc/*` ID पर CPU / मेमोरी / नेटवर्क सीरीज़ |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **स्टोरेज** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (हाई अवेलेबिलिटी) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **बैकअप कवरेज** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: वे गेस्ट जिन्हें कोई बैकअप जॉब नहीं चुनता (बैकअप चले या सफल हुए, यह नहीं बताया जाता) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **बूट पर शुरू** | हर गेस्ट का `pve_onboot_status`, जिसे **Guest Down** पढ़ता है |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **रेप्लिकेशन** | हर स्टोरेज रेप्लिकेशन जॉब की `pve_replication_*` सीरीज़: उनका `id` लेबल जॉब ID (जैसे `100-0`) है, कोई संसाधन नहीं |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "बूट पर शुरू और रेप्लिकेशन एक्सपोर्टर के नोड कलेक्टर से आते हैं, जो सिर्फ़ उसी नोड को पढ़ते हैं जिससे एक्सपोर्टर पूछता है: `PVE_NODES` में न होने वाले नोड के पास इनमें से कुछ नहीं होता।",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "कलेक्टर `id` लेबल को बराबरी से फ़िल्टर किए जा सकने वाले तीन डेटा पॉइंट एट्रिब्यूट में भी बाँटता है (`transform/pve-identity` प्रोसेसर); मॉनिटर की शर्तें और डैशबोर्ड फ़िल्टर इन्हीं से मिलान करते हैं:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| एट्रिब्यूट | मान | `qemu/100` का उदाहरण |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` और `lxc` दोनों `guest` बन जाते हैं) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | `id` के पहले `/` के बाद का सब कुछ (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "मूल `id` लेबल जैसा है वैसा ही रखा जाता है।",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "एजेंट पूरे क्लस्टर को एक नोड के API से पढ़ता है: जब तक `PVE_HOST` जवाब देता है, उसी के API से। हर 15 सेकंड में `oneuptime-pve-api-failover` कंटेनर उस नोड को जाँचता है, और जब उसका API जवाब देना बंद कर देता है, तो कलेक्टर `PVE_NODES` में जवाब देने वाले अगले नोड से क्लस्टर पढ़ता है, जब तक `PVE_HOST` फिर से जवाब न दे। `.env` में API टोकन होने पर वह ऐसे नोड को भी छोड़ देता है जो जवाब तो देता है, पर क्लस्टर के कोरम वाले हिस्से से कटा हुआ है, क्योंकि उसकी नज़र से बाकी सभी नोड बंद दिखेंगे। OneUptime AI एजेंट भी अपनी हर कॉल पर यही करता है। इसलिए जब कोई नोड विफल होता है, तो उसके लिए **Node Offline** ट्रिगर होता है और बाकी क्लस्टर रिपोर्ट करता रहता है।",
  "Its logs say which node the cluster is read from, and why.":
    "इसके लॉग बताते हैं कि क्लस्टर किस नोड से पढ़ा जा रहा है, और क्यों।",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "यह उस मशीन को नहीं सँभाल सकता जिस पर एजेंट चलता है: अगर वह बंद हो जाए, तो पूरा क्लस्टर चुप हो जाता है और **Cluster Stopped Reporting** ट्रिगर होता है। एजेंट को क्लस्टर के बाहर चलाएँ, या ऐसी VM में जिसे Proxmox HA किसी दूसरे नोड पर फिर से शुरू करता है (`ha-manager add vm:<vmid>`, साझा स्टोरेज पर), और हर क्लस्टर के लिए एक ही एजेंट चलाएँ: हर एजेंट पूरा क्लस्टर पढ़ता है, इसलिए दूसरा एजेंट हर संसाधन को दो बार रिपोर्ट करेगा। [जब कोई नोड बंद हो जाए](/docs/telemetry/proxmox#when-a-node-goes-down) देखें।",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "यह वह पूरा `otel-collector-config.yaml` है जिसे एजेंट चलाता है; `.env` फ़ाइल `${env:...}` के मान देती है। `transform/pve-identity` प्रोसेसर वे `pve.scope` / `pve.type` / `pve.id` एट्रिब्यूट बनाता है जिन पर बिल्ट-इन Proxmox अलर्ट टेम्पलेट और डैशबोर्ड फ़िल्टर निर्भर हैं: कॉन्फ़िग को अपने हिसाब से बदलें तो भी इसे बनाए रखें:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "डिफ़ॉल्ट रूप से एजेंट सिर्फ़ मेट्रिक्स भेजता है, इसलिए क्लस्टर का **लॉग** टैब ख़ाली रहता है। PVE सेवाएँ systemd जर्नल में लॉग लिखती हैं, और साथ आने वाले कॉन्फ़िग में `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` और `qmeventd` के लिए एक कमेंट-आउट किया हुआ `journald` रिसीवर है।",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **एजेंट को किसी PVE नोड पर चलाएँ।** जर्नल हर होस्ट का अलग होता है, इसलिए रिमोट एजेंट उसे नहीं पढ़ सकता, और हर नोड सिर्फ़ अपना जर्नल भेजता है। मेट्रिक्स एजेंट को क्लस्टर के बाहर रखना हो, तो इसके बजाय हर नोड पर सिर्फ़ लॉग के लिए एक दूसरा कलेक्टर चलाएँ।",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. `otel-collector-config.yaml` में `journald` रिसीवर और `logs` पाइपलाइन को, और `docker-compose.yml` में दोनों जर्नल वॉल्यूम को अनकमेंट करें।",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **कलेक्टर इमेज बदलें।** मानक इमेज में `journalctl` नहीं है और वह ऐसे उपयोगकर्ता के रूप में चलती है जो जर्नल नहीं पढ़ सकता। यह रैपर बिल्ड करें और `docker-compose.yml` में `image:` को उसकी ओर करें:",
  "4. Apply it:": "4. इसे लागू करें:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "मानक इमेज ही रखना चाहते हैं? दस्तावेज़ में `filelog` वाला एक विकल्प है जो `/var/log/syslog` को पढ़ता रहता है: [Proxmox सेवा लॉग भेजें](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs)।",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "`oneuptime.label.` उपसर्ग वाला कोई भी रिसोर्स एट्रिब्यूट क्लस्टर पर एक प्रोजेक्ट लेबल बन जाता है: `oneuptime.label.<dimension>=<value>` लेबल `<dimension>:<value>` है। इन्हें `otel-collector-config.yaml` के `resource` प्रोसेसर में `proxmox.cluster.name` के बगल में जोड़ें:",
  "Then restart the collector so it reads the new config:":
    "फिर कलेक्टर को रीस्टार्ट करें ताकि वह नया कॉन्फ़िग पढ़े:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "क्लस्टर `team:platform` और `env:production` लेबल के साथ दिखता है। लेबल बड़े-छोटे अक्षरों का भेद किए बिना मिलाए जाते हैं, इसलिए मौजूदा `Production` लेबल फिर से इस्तेमाल होता है; OneUptime इंटरफ़ेस में जोड़े गए लेबल एजेंट कभी नहीं हटाता।",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` **`oneuptime-proxmox-ai-agent`** भी चलाता है। जब OneUptime AI इस क्लस्टर की किसी घटना या अलर्ट की जाँच करता है, तो वह इसके ज़रिए केवल-पढ़ने वाली `pvesh` कमांड चलाता है: `pvesh get /cluster/status`, किसी गेस्ट की मौजूदा स्थिति, किसी नोड के विफल टास्क। इसमें कोई `pvesh` बाइनरी नहीं है: हर कमांड `PVE_HOST` पर Proxmox VE API की एक कॉल बन जाती है। यह `PROXMOX_CLUSTER_NAME` नाम वाले क्लस्टर के रूप में रजिस्टर होता है और क्लस्टर के **एआई → AI एजेंट** पेज पर दिखता है।",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **API टोकन ही पक्की सीमा है।** यह कलेक्टर के PVEAuditor टोकन (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`) से पढ़ता है, जो पढ़ सकता है और कुछ नहीं। अगर आप अपना एक्सपोर्टर चलाते हैं और `.env` में कोई टोकन नहीं है, तो एक जोड़ें।",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- जब तक आप `ONEUPTIME_AI_ALLOW_WRITES=true` सेट नहीं करते, यह **केवल-पढ़ने वाला** है। सुधारों (किसी गेस्ट को शुरू या रीबूट करना) के लिए एक अलग टोकन भी चाहिए जो गेस्ट को चालू और बंद कर सके, जिसे `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET` के रूप में सेट किया जाता है; `pveum` कमांड एजेंट की README में हैं। अगर एजेंट इसी क्लस्टर के किसी गेस्ट में चलता है, तो उस गेस्ट का VMID `ONEUPTIME_AI_PROTECTED_TARGETS` में डालें।",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- इसे जाँचें: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- OneUptime AI इस्तेमाल नहीं करते? `docker-compose.yml` से `oneuptime-proxmox-ai-agent` सर्विस हटा दें।",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "यह क्या चला सकता है और सुधार कैसे काम करते हैं: [इन्फ़्रास्ट्रक्चर AI एजेंट](/docs/ai/infrastructure-ai-agents#proxmox-clusters)।",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**अपग्रेड करें**: कलेक्टर इमेज `docker-compose.yml` में पिन है और उसका कॉन्फ़िग उसके बगल की एक फ़ाइल है, इसलिए सिर्फ़ इमेज पुल करने से एजेंट आगे नहीं बढ़ता। इंस्टॉल स्क्रिप्ट फिर से चलाएँ। यह आपकी मौजूदा `.env` का हर मान फिर से इस्तेमाल करती है (कुछ भी दोबारा नहीं पूछा जाता), नवीनतम `docker-compose.yml` और `otel-collector-config.yaml` डाउनलोड करती है (आपकी बदली हुई फ़ाइल नई फ़ाइल के बगल में `<file>.bak.<timestamp>` के रूप में रखी जाती है), इमेज पुल करती है और उनसे एजेंट को फिर से बनाती है:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "कॉन्फ़िग जिस कलेक्टर संस्करण को पिन करता है, उसे क्लस्टर के **एजेंट संस्करण** के रूप में बताता है। जब यह OneUptime कोई नया संस्करण पिन करता है, तो उसके बगल का चेतावनी चिह्न ये कमांड खोलता है।",
  "**Uninstall** the agent:": "एजेंट को **अनइंस्टॉल करें**:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "फिर अगर API टोकन की ज़रूरत न रहे, तो उसे *Datacenter → Permissions → API Tokens* में मिटा दें।",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` पूरी कड़ी जाँचता है (कंटेनर रनटाइम, एक्सपोर्टर का स्क्रेप, क्लस्टर के नाम का लगना, टोकन का रूप, कलेक्टर के अपने मेट्रिक्स) और OneUptime से सीधे पूछता है कि क्या वह आपकी इंजेशन कुंजी स्वीकार करता है। यह आख़िरी जाँच सबसे ज़्यादा मायने रखती है: OneUptime के OTLP एंडपॉइंट ग़लत कुंजी को `401` या `422` से ठुकराते हैं, जिसे कलेक्टर हर बैच के लिए `Exporting failed` की एक ही ऐसी पंक्ति के रूप में लॉग करता है जो आसानी से छूट जाती है, इसलिए स्क्रिप्ट `GET /otlp/v1/validate` से सीधा 200/401 फ़ैसला माँगती है।",
  "It ends with a verdict naming the most likely cause.":
    "यह सबसे संभावित कारण बताने वाले फ़ैसले के साथ ख़त्म होता है।",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. जाँचें कि एजेंट चल रहा है (`/opt/oneuptime-proxmox-agent` में): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. एजेंट के लॉग में त्रुटियाँ जाँचें: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. पुष्टि करें कि आपका OneUptime URL और इंजेशन कुंजी सही हैं।",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. पक्का करें कि एजेंट की मशीन नेटवर्क पर OneUptime इंस्टेंस तक पहुँच सकती है।",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. जाँचें कि एक्सपोर्टर जवाब देता है। साथ आने वाला एक्सपोर्टर अपना पोर्ट होस्ट पर प्रकाशित नहीं करता, इसलिए curl को उसके नेटवर्क नेमस्पेस के अंदर चलाएँ: आपको `pve_*` मेट्रिक पंक्तियाँ दिखनी चाहिए (अपने एक्सपोर्टर के लिए, उसके `host:9221` पर सीधे curl करें):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. पुष्टि करें कि API टोकन के पास पाथ `/` पर **PVEAuditor** भूमिका है, टोकन पर भी और उसके उपयोगकर्ता पर भी।",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. कलेक्टर के लॉग में स्क्रेप या एक्सपोर्ट की त्रुटियाँ जाँचें (`/opt/oneuptime-proxmox-agent` में): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "API टोकन ग़लत है या उसके पास अनुमतियाँ नहीं हैं। टोकन ID का फ़ॉर्मैट (`user@realm!tokenname`), सीक्रेट, और यह फिर से जाँचें कि **PVEAuditor** भूमिका पाथ `/` पर टोकन और उसके उपयोगकर्ता को दी गई है। एक्सपोर्टर के अपने लॉग API का जवाब दिखाते हैं: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'गेस्ट सीरीज़ (`qemu/*`, `lxc/*` ID) एक्सपोर्टर के क्लस्टर कलेक्टर से आती हैं। साथ आने वाला कॉन्फ़िग इसे चालू रखता है (`cluster=1` स्क्रेप पैरामीटर): अगर आपने कॉन्फ़िग बदला है, तो `cluster: ["1"]` पैरामीटर वापस लगाएँ।',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "उनके बूट पर शुरू वाले फ़्लैग और रेप्लिकेशन जॉब उस नोड से आते हैं जिस पर वे चलते हैं, और एजेंट सिर्फ़ `PVE_NODES` के नोड पढ़ता है। वहाँ हर नोड का अपना पता लिखें, जैसे `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, और `/opt/oneuptime-proxmox-agent` में `docker compose up -d` से इसे लागू करें। अगर किसी बदलाव के बाद कलेक्टर शुरू होना बंद हो जाए, तो सूची के वर्ग कोष्ठक हट गए हैं। `troubleshoot.sh` सूची के हर नोड को जाँचता है।",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "क्लस्टर की पहचान `PROXMOX_CLUSTER_NAME` से आती है, जो हर मेट्रिक पर `proxmox.cluster.name` के रूप में लगाई जाती है। इसे `.env` में ठीक करें और `/opt/oneuptime-proxmox-agent` में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **क्लस्टर का नाम**: ठीक **`pve-1`** डालें; कोई दूसरा नाम एक नया क्लस्टर रजिस्टर करता है।",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "क्लस्टर की पहचान `PROXMOX_CLUSTER_NAME` से आती है, जो हर मेट्रिक पर `proxmox.cluster.name` के रूप में लगाई जाती है। यह क्लस्टर **`pve-1`** है। इसे `.env` में ठीक करें और `/opt/oneuptime-proxmox-agent` में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "कमांड में आपका OneUptime URL और इंजेशन कुंजी पहले से हैं। बाकी स्क्रिप्ट पूछती है:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Proxmox VE 8.3 या नया चाहिए। पहली कमांड `oneuptime` नाम का एक वेबहुक टारगेट जोड़ती है, जो हर सूचना को इस क्लस्टर के लॉग के रूप में OneUptime को भेजता है और कुंजी व क्लस्टर का नाम अपने सीक्रेट में रखता है। दूसरी कमांड हर सूचना उसी को भेजती है। `my-proxmox-cluster` को उस क्लस्टर नाम से बदलें जो आपने एजेंट को दिया था, ताकि सूचनाएँ उसी क्लस्टर तक पहुँचें।",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "इसके बाद हर गेस्ट के पेज पर उसका पिछला बैकअप दिखता है, और क्लस्टर के **सुझाव** में **Backup Job Failed** और **Node Fenced** अलर्ट दिखते हैं। इन्हें भेजना बंद करने के लिए:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Proxmox VE 8.3 या नया चाहिए। पहली कमांड `oneuptime` नाम का एक वेबहुक टारगेट जोड़ती है, जो हर सूचना को इस क्लस्टर के लॉग के रूप में OneUptime को भेजता है और कुंजी व क्लस्टर का नाम अपने सीक्रेट में रखता है। दूसरी कमांड हर सूचना उसी को भेजती है। कमांड में पहले से **`pve-1`** है, इसलिए सूचनाएँ इसी क्लस्टर तक पहुँचती हैं।",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "इस OneUptime से `docker-compose.yml` और `otel-collector-config.yaml` एक नए फ़ोल्डर में डाउनलोड करें:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "उनके बगल में एक `.env` फ़ाइल बनाएँ: इसमें टोकन का सीक्रेट होता है, इसलिए इसे `chmod 600 .env` से निजी रखें:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- `my-proxmox-cluster` को इस क्लस्टर के किसी नाम से बदलें, जैसे `pve-prod`। OneUptime में क्लस्टर इसी नाम से दिखता है, इसलिए इसे स्थिर रखें: नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- `PVE_HOST` को क्लस्टर के किसी भी नोड पर सेट करें: जब तक उसका API जवाब नहीं देता, एजेंट `PVE_NODES` के अगले नोड से क्लस्टर पढ़ता है, इसलिए उसे किसी वर्चुअल IP की ज़रूरत नहीं होती।",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- `PVE_NODES` को वर्ग कोष्ठकों में हर नोड के अपने पते पर सेट करें, कभी भी वर्चुअल IP नहीं। एक्सपोर्टर बूट पर शुरू (Guest Down), रेप्लिकेशन और सब्सक्रिप्शन सिर्फ़ उसी नोड के लिए पढ़ता है जिससे वह पूछता है, इसलिए हर नोड से बारी-बारी से पूछा जाता है; छूटा हुआ नोड दिखता ही नहीं।",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- पिछले चरण का टोकन भरें। `COMPOSE_PROFILES=pve-exporter` साथ आने वाला prometheus-pve-exporter भी शुरू करता है, जो उसी टोकन से API पढ़ता है।",
  "Start the agent:": "एजेंट शुरू करें:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "एजेंट इन्हें `docker-compose.yml` के बगल वाली `.env` फ़ाइल से पढ़ता है। किसी एक को बदलने के बाद उसे `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें।",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "`COMPOSE_PROFILES` को `.env` से बाहर रखें और इसके बजाय एजेंट को अपने एक्सपोर्टर की ओर करें (`host:port`, बिना स्कीम के):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "इन्हें एजेंट के फ़ोल्डर में चलाएँ, जिसमें `docker-compose.yml` है।",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**अपग्रेड करें**: कलेक्टर इमेज `docker-compose.yml` में पिन है और उसका कॉन्फ़िग उसके बगल की एक फ़ाइल है, इसलिए सिर्फ़ इमेज पुल करने से एजेंट आगे नहीं बढ़ता। दोनों फ़ाइलें फिर से डाउनलोड करें; आपकी `.env` बनी रहती है, और किसी भी फ़ाइल में किया गया आपका बदलाव फिर से करना होगा:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "फिर इमेज पुल करें और एजेंट को फिर से बनाएँ, ताकि कलेक्टर अपना नया कॉन्फ़िग पढ़े:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. जाँचें कि एजेंट चल रहा है (एजेंट के फ़ोल्डर में): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. कलेक्टर के लॉग में स्क्रेप या एक्सपोर्ट की त्रुटियाँ जाँचें (एजेंट के फ़ोल्डर में): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "उनके बूट पर शुरू वाले फ़्लैग और रेप्लिकेशन जॉब उस नोड से आते हैं जिस पर वे चलते हैं, और एजेंट सिर्फ़ `PVE_NODES` के नोड पढ़ता है। वहाँ हर नोड का अपना पता लिखें, जैसे `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, और `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से इसे लागू करें। अगर किसी बदलाव के बाद कलेक्टर शुरू होना बंद हो जाए, तो सूची के वर्ग कोष्ठक हट गए हैं। `troubleshoot.sh` सूची के हर नोड को जाँचता है।",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "क्लस्टर की पहचान `PROXMOX_CLUSTER_NAME` से आती है, जो हर मेट्रिक पर `proxmox.cluster.name` के रूप में लगाई जाती है। इसे `.env` में ठीक करें और `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- यह **`pve-1`** के लिए एजेंट इंस्टॉल करता है: `PROXMOX_CLUSTER_NAME` को ठीक वैसा ही रहने दें, नहीं तो डेटा एक नए क्लस्टर के रूप में रजिस्टर होगा।",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "क्लस्टर की पहचान `PROXMOX_CLUSTER_NAME` से आती है, जो हर मेट्रिक पर `proxmox.cluster.name` के रूप में लगाई जाती है। यह क्लस्टर **`pve-1`** है। इसे `.env` में ठीक करें और `docker-compose.yml` वाले फ़ोल्डर में `docker compose up -d` से लागू करें; ध्यान दें कि नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**कोई एजेंट नहीं, पर डेटा कम।** Proxmox VE 9.0 और नए संस्करण हर नोड के मेट्रिक्स ख़ुद OneUptime को पुश करते हैं। HA की स्थिति, बूट पर शुरू (जिसे **Guest Down** इस्तेमाल करता है), बैकअप कवरेज और रेप्लिकेशन पुश नहीं होते: अगर आपको इनकी ज़रूरत है, तो इंस्टॉल स्क्रिप्ट या Docker Compose इस्तेमाल करें। किसी क्लस्टर के लिए इनमें से एक ही तरीका अपनाएँ: दोनों चलाने पर हर संसाधन दो बार रिपोर्ट होता है।",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 या नया**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "*Datacenter → Metric Server* में मेट्रिक सर्वर जोड़ने के लिए Proxmox का वेब UI",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "हर नोड पोर्ट `443` पर `<YOUR_ONEUPTIME_HOST>` तक पहुँच सके",
  "| Field | Value |": "| फ़ील्ड | मान |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (सर्वर) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (पोर्ट) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (प्रोटोकॉल) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (पाथ) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (हेडर) | नीचे दिया गया JSON |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "इसे डेटासेंटर के लिए एक बार जोड़ें: इसके बाद क्लस्टर का हर नोड अपने मेट्रिक्स पुश करता है।",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime इस पुश को उन्हीं `pve_*` सीरीज़ में बदलता है जो एजेंट भेजता है। क्लस्टर आपके Proxmox क्लस्टर नाम से अपने आप रजिस्टर होता है (स्टैंडअलोन नोड अपने नोड नाम से) और **Proxmox** सेक्शन में दिखता है, जहाँ नोड, गेस्ट और स्टोरेज पेज, अवलोकन के चार्ट, मेट्रिक कैटलॉग और CPU / मेमोरी / स्टोरेज अलर्ट टेम्पलेट वैसे ही काम करते हैं जैसे एजेंट के साथ।",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "हर नोड सिर्फ़ अपनी स्थिति पुश करता है, इसलिए बंद हुआ नोड ख़ुद अपने बंद होने की रिपोर्ट नहीं कर सकता; जो नोड अब भी चल रहे हैं, वे उसकी ओर से रिपोर्ट करते हैं:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- अपनी आख़िरी रिपोर्ट के लगभग 2 मिनट बाद वह Proxmox पेजों पर **ऑफ़लाइन** दिखता है, और लगभग 5 मिनट बाद **Node Offline** ट्रिगर होता है।",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** भी उसे ऑफ़लाइन गिनता है; यह नोड के चुप होने के लगभग 7–9 मिनट बाद ट्रिगर होता है, जब उसकी पूरी 5 मिनट की विंडो में रिपोर्ट आ जाती हैं।",
  "- Its next report brings it back.":
    "- उसकी अगली रिपोर्ट उसे वापस ले आती है।",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    'ऑफ़लाइन का मतलब है "रिपोर्ट करना बंद किया": अटका हुआ `pvestatd`, रुका हुआ `pmxcfs` या OneUptime तक कटा हुआ नेटवर्क, सब एक जैसे दिखते हैं। कोई स्टैंडअलोन होस्ट या पूरा क्लस्टर चुप हो जाए, तो उसकी रिपोर्ट करने वाला कोई नहीं बचता, इसलिए इसके बजाय क्लस्टर **डिस्कनेक्टेड** हो जाता है। 7 दिन से ज़्यादा चुप रहने वाले नोड की रिपोर्ट अब नहीं होती। ये रिपोर्ट मेट्रिक एक्सप्लोरर में `oneuptime.proxmox.inferred=not-reporting` से चिह्नित होती हैं।',
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "क्लस्टर अपने Proxmox क्लस्टर नाम से रजिस्टर होता है; स्टैंडअलोन नोड अपने नोड नाम से रजिस्टर होता है। मेट्रिक सर्वर के *Resource Attributes* में सेट किया गया `proxmox.cluster.name` रिसोर्स एट्रिब्यूट इसके बजाय इस्तेमाल होता रहता है।",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime इस पुश को उन `pve_*` सीरीज़ में बदलता है जो एजेंट भेजता है, इसलिए Proxmox पेज और CPU / मेमोरी / स्टोरेज अलर्ट टेम्पलेट बिना बदलाव के काम करते हैं। मूल `proxmox_*` सीरीज़ भी मेट्रिक एक्सप्लोरर में उपलब्ध रहती हैं, उन बाकी चीज़ों के लिए जिनकी रिपोर्ट Proxmox VE करता है।",
  "Some alert templates need data only the agent collects:":
    "कुछ अलर्ट टेम्पलेट को ऐसे डेटा की ज़रूरत होती है जिसे सिर्फ़ एजेंट इकट्ठा करता है:",
  "| Needs the agent | Why |": "| एजेंट चाहिए | क्यों |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA की स्थिति | पुश नहीं होती: **HA Resource in Error State** टेम्पलेट को एजेंट चाहिए |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| बूट पर शुरू वाला फ़्लैग | पुश नहीं होता: **Guest Down** को, जो सिर्फ़ बूट पर शुरू होने के लिए सेट गेस्ट के लिए अलर्ट करता है, एजेंट चाहिए |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| बैकअप कवरेज और रेप्लिकेशन | पुश नहीं होते: **Guest Not Backed Up** और **Replication Failing** को एजेंट चाहिए |",
  "Every node has stopped reporting, or never started.":
    "हर नोड ने रिपोर्ट करना बंद कर दिया है, या कभी शुरू ही नहीं किया।",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. *Datacenter → Metric Server* में OpenTelemetry एंट्री जाँचें: सर्वर `<YOUR_ONEUPTIME_HOST>`, पोर्ट `443`, प्रोटोकॉल `https`, पाथ `/otlp/v1/metrics`, और चरण 1 की किसी कुंजी के साथ `x-oneuptime-token` हेडर।",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. जाँचें कि नोड नेटवर्क पर `<YOUR_ONEUPTIME_HOST>` तक पहुँच सकते हैं।",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "इसने रिपोर्ट करना बंद कर दिया है: बंद नोड, अटका हुआ `pvestatd`, रुका हुआ `pmxcfs` या OneUptime तक कटा हुआ नेटवर्क, सब एक जैसे दिखते हैं। इसकी अगली रिपोर्ट इसे वापस ले आती है। अगर आपने नोड को क्लस्टर से हटा दिया है, तो उसके पेज पर **नोड हटाएं** इस्तेमाल करें; वरना वह 7 दिन तक ऑफ़लाइन रहता है।",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "नेटिव पुश HA की स्थिति, बूट पर शुरू, बैकअप कवरेज या रेप्लिकेशन नहीं भेजता। इसके बजाय एजेंट चलाने के लिए इस गाइड के ऊपर **इंस्टॉल स्क्रिप्ट** या **Docker Compose** चुनें, और मेट्रिक सर्वर हटा दें, क्योंकि दोनों चलाने पर हर संसाधन दो बार रिपोर्ट होता है।",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "OneUptime में यह क्लस्टर **`pve-1`** है। अगर यह Proxmox क्लस्टर का अपना नाम नहीं है, तो मेट्रिक सर्वर के *Resource Attributes* में `proxmox.cluster.name` को `pve-1` पर सेट करें, वरना पुश एक नया क्लस्टर रजिस्टर करेगा।",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Proxmox VE 8.3 या नया चाहिए। पहली कमांड `oneuptime` नाम का एक वेबहुक टारगेट जोड़ती है, जो हर सूचना को इस क्लस्टर के लॉग के रूप में OneUptime को भेजता है और कुंजी व क्लस्टर का नाम अपने सीक्रेट में रखता है। दूसरी कमांड हर सूचना उसी को भेजती है। `my-proxmox-cluster` को उस नाम से बदलें जिससे क्लस्टर OneUptime में दिखता है: उसका Proxmox क्लस्टर नाम, या किसी स्टैंडअलोन नोड का अपना नाम।",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | नहीं | कलेक्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-proxmox-agent`)। उसी मशीन पर दूसरे क्लस्टर के एजेंट को अपने अलग नाम चाहिए: अगर आप इन्हें सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट नए एजेंट के कंटेनरों के नाम उसके फ़ोल्डर पर रखती है, और स्क्रिप्ट फिर से चलाने पर उन्हें बनाए रखती है |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | नहीं | API फ़ेलओवर sidecar के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-pve-api-failover`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे क्लस्टर के API फ़ेलओवर sidecar का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-pve-api-failover-cluster2`, `oneuptime-proxmox-agent-cluster2` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | नहीं | साथ आने वाले एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-pve-exporter`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे क्लस्टर के साथ आने वाले एक्सपोर्टर का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-pve-exporter-cluster2`, `oneuptime-proxmox-agent-cluster2` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | नहीं | AI एजेंट के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-proxmox-ai-agent`)। अगर आप इसे सेट नहीं करते, तो इंस्टॉल स्क्रिप्ट दूसरे क्लस्टर के AI एजेंट का नाम उसके कलेक्टर के नाम पर रखती है (`oneuptime-proxmox-ai-agent-cluster2`, `oneuptime-proxmox-agent-cluster2` के बगल में), और स्क्रिप्ट फिर से चलाने पर उसे बनाए रखती है |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "एक एजेंट एक क्लस्टर पढ़ता है। दूसरे क्लस्टर के लिए, दूसरा एजेंट उसके अपने फ़ोल्डर में, उसके अपने कंटेनर नामों के साथ इंस्टॉल करें — दो कंटेनर एक ही नाम नहीं रख सकते:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "अगर आप उनके वेरिएबल सेट नहीं करते, जैसे `PROXMOX_AGENT_CONTAINER_NAME`, तो स्क्रिप्ट कंटेनरों के नाम फ़ोल्डर पर रखती है, जैसे `oneuptime-proxmox-agent-cluster2`। स्क्रिप्ट ये नाम उस एजेंट की `.env` में सहेज लेती है, इसलिए एजेंट अपग्रेड करने के लिए उसी `INSTALL_DIR` के साथ स्क्रिप्ट फिर से चलाने पर भी नाम बने रहते हैं, और जिस एजेंट का `container_name` आपने कभी `docker-compose.yml` में बदला था, वह वही नाम रखता है।",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "हर फ़ोल्डर को अपना अलग नाम दें: Docker Compose किसी प्रोजेक्ट का नाम सिर्फ़ उसके फ़ोल्डर पर रखता है, इसलिए स्क्रिप्ट ऐसे फ़ोल्डर को अस्वीकार करती है जिसका नाम उस फ़ोल्डर जैसा हो जो पहले से कहीं और एजेंट चला रहा है। फ़ोल्डर को डायग्नोस्टिक स्क्रिप्ट को `-d` से दें।",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | नहीं | कलेक्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-proxmox-agent`)। उसी मशीन पर दूसरे क्लस्टर के एजेंट को अपना अलग नाम चाहिए |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | नहीं | API फ़ेलओवर sidecar के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-pve-api-failover`)। उसी मशीन पर दूसरे क्लस्टर के एजेंट को अपना अलग नाम चाहिए |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | नहीं | साथ आने वाले एक्सपोर्टर के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-pve-exporter`)। उसी मशीन पर दूसरे क्लस्टर के एजेंट को अपना अलग नाम चाहिए |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | नहीं | AI एजेंट के कंटेनर का नाम (डिफ़ॉल्ट: `oneuptime-proxmox-ai-agent`)। उसी मशीन पर दूसरे क्लस्टर के एजेंट को अपना अलग नाम चाहिए |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "एक एजेंट एक क्लस्टर पढ़ता है। दूसरे क्लस्टर के लिए, दूसरा एजेंट उसके अपने फ़ोल्डर में, उसके अपने कंटेनर नामों के साथ सेट अप करें — दो कंटेनर एक ही नाम नहीं रख सकते। नाम उस एजेंट की `.env` में सेट करें:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "हर फ़ोल्डर को अपना अलग नाम दें: Docker Compose किसी प्रोजेक्ट का नाम सिर्फ़ उसके फ़ोल्डर पर रखता है, इसलिए उसी नाम का दूसरा फ़ोल्डर पहले एजेंट के कंटेनरों की जगह ले लेगा। नाम `docker-compose.yml` में न रखें, जिसे अपग्रेड बदल देता है।",
};

export default TRANSLATION;
