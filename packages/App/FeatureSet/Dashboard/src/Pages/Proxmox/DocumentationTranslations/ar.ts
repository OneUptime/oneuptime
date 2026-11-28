import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 أو أحدث مع إضافة Docker Compose v2، على جهاز يمكنه الوصول إلى Proxmox VE API لكل عقدة عبر المنفذ 8006",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "صدفة root على أي عقدة PVE، أو واجهة الويب في Proxmox، لإنشاء رمز مميز لواجهة API للقراءة فقط",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "يُفضَّل جهاز خارج العنقود، أو آلة افتراضية يعيد Proxmox HA تشغيلها على عقدة أخرى: يقرأ الوكيل العنقود من عقدة أخرى عندما تتعطل إحدى العقد، لكنه لا يستطيع ذلك عندما يتعطل جهازه هو",
  "As root on any PVE node:": "بصفتك root على أي عقدة PVE:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- لا يفشل السطر الأول إلا إذا كان `monitoring@pam` موجودًا من قبل، ولا ضرر في ذلك. للرموز المميزة لواجهة API سرٌّ خاص بها، لذا لا يحتاج المستخدم إلى كلمة مرور ولا إلى حساب نظام.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- يطبع `pveum user token add` سر الرمز المميز: انسخه الآن، فهو لا يظهر إلا مرة واحدة. معرّف الرمز المميز هو `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- يُمنح الدور للمستخدم وللرمز المميز معًا، لأن الرمز المميز المفصول الصلاحيات لا ينال إلا الأذونات التي يملكها مستخدمه أيضًا. ويجب أن يكون على المسار الجذر `/`: يقرأ pve-exporter حالة العنقود كله، والرمز المميز المقصور على مسار فرعي يفشل مع `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. انتقل إلى *Datacenter → Permissions → API Tokens* وانقر **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. اختر مستخدمًا (أو أنشئه)، وأعطِ الرمز المميز معرّفًا مثل `oneuptime`، وتأكد من تحديد **Privilege Separation**، ثم انقر **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. انسخ معرّف الرمز المميز (`user@realm!tokenname`) والسر: لا يظهر السر إلا مرة واحدة.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. ضمن *Datacenter → Permissions*، انقر **Add** مرتين لتمنح المسار `/` الدور **PVEAuditor**: مرة بوصفه **API Token Permission** للرمز المميز، ومرة بوصفه **User Permission** لمستخدمه.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "الرمز المميز المفصول الصلاحيات لا ينال إلا الأذونات التي يملكها مستخدمه أيضًا، لذا يحتاج كلاهما إلى الدور. ويجب أن يكون على المسار الجذر `/`: يقرأ pve-exporter حالة العنقود كله، والرمز المميز المقصور على مسار فرعي يفشل مع `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "يسأل البرنامج النصي عن عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب، وكلاهما ظاهر في الخطوة 1 (اختر مفتاحًا هناك ليُملآ هنا)، ثم عن:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **اسم العنقود**: الاسم الذي يظهر به العنقود في OneUptime. امنح كل عنقود اسمه الخاص وأبقه ثابتًا: الاسم الجديد يسجّل عنقودًا جديدًا.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **مضيف Proxmox VE API**: أي عقدة، مثل `192.168.1.10`. ما دامت واجهة API لها لا تستجيب، يقرأ الوكيل العنقود من العقدة التالية في القائمة أدناه.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **prometheus-pve-exporter المرفق**: أجب بـ **Y** ما لم تكن تشغّل واحدًا بالفعل.",
  "- **API token** — the token id and secret from the previous step.":
    "- **الرمز المميز لواجهة API**: معرّف الرمز المميز وسره من الخطوة السابقة.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **عنوان كل عقدة**: العنوان الخاص بكل عقدة، مفصولًا بفواصل، وليس عنوان IP افتراضيًا أبدًا. ومع الرمز المميز يعرض البرنامج النصي قائمة العنقود نفسه: اضغط Enter لاعتمادها. ويقرأ الوكيل العنقود من هذه العقد أيضًا عندما تتعطل العقدة الأولى.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **وكيل الذكاء الاصطناعي من OneUptime**: هل يُسمح له بتطبيق الإصلاحات؛ أجب بـ **N** لإبقائه للقراءة فقط.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "يُثبَّت في `/opt/oneuptime-proxmox-agent`، ويكتب ملف `.env` بالأذونات `0600`، ويشغّل كل شيء باستخدام Docker Compose. وتشغيل البرنامج النصي مرة أخرى يعيد استخدام كل ما في ملف `.env` ذاك بدلًا من السؤال مجددًا، فهو أيضًا طريقة الترقية.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "يعرض `docker compose ps` المجمّع (`oneuptime-proxmox-agent`)، وتبديل العقد عند التعطل (`oneuptime-pve-api-failover`)، والمُصدِّر المرفق (`oneuptime-pve-exporter`، ما لم تستخدم مُصدِّرك الخاص)، ووكيل الذكاء الاصطناعي من OneUptime (`oneuptime-proxmox-ai-agent`). ابحث في سجلات المجمّع عن `Everything is ready. Begin running and processing data.` ثم يظهر العنقود تلقائيًا في قسم **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**وكيل الذكاء الاصطناعي من OneUptime (مفعّل افتراضيًا، للقراءة فقط).** تحقيقات الذكاء الاصطناعي مفعّلة: يتيح للذكاء الاصطناعي من OneUptime التحقيق في الحوادث والتنبيهات على هذا العنقود بطلبات `pvesh` للقراءة فقط، ولا يغيّر شيئًا ما لم تسمح بالإصلاحات؛ راجع **وكيل الذكاء الاصطناعي من OneUptime** ضمن متقدم.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "يتطلب Proxmox VE 8.3 أو أحدث. اختر مفتاح استيعاب في الخطوة 1 لإظهار الأمرين: يحملان المفتاح، ويحفظه Proxmox VE في هدف خطاف الويب الذي يضيفانه.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "تعرض صفحة كل ضيف بعد ذلك آخر نسخة احتياطية له، وتقترح **التوصيات** الخاصة بالعنقود التنبيهين **Backup Job Failed** و **Node Fenced**.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "يكتب برنامج التثبيت النصي هذه القيم في `/opt/oneuptime-proxmox-agent/.env`. بعد تغيير أيٍّ منها، طبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |": "| المتغير | مطلوب | الوصف |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | نعم | عنوان URL لمثيل OneUptime لديك (مثل `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | نعم | مفتاح استيعاب القياس عن بُعد، المفتاح الذي اخترته في الخطوة 1 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | نعم | معرّف العنقود الظاهر في OneUptime. يُوسم به كل مقياس بوصفه سمة المورد `proxmox.cluster.name`. أبقه ثابتًا: تغييره يسجّل عنقودًا جديدًا (الافتراضي: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | نعم | العقدة التي يقرأ المُصدِّر العنقود عبر Proxmox VE API الخاصة بها ويستعلم منها وكيل الذكاء الاصطناعي، مثل `192.168.1.10`. ما دامت واجهة API لها لا تستجيب، يستخدم كلاهما العقدة التالية المستجيبة في `PVE_NODES` |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | في العنقود | عنوان API الخاص بكل عقدة، مفصولًا بفواصل بين قوسين معقوفين، مثل `[192.168.1.10,192.168.1.11,192.168.1.12]`. القيمة الافتراضية `PVE_HOST` وحده، وهذا يكفي لعقدة واحدة. يقرأ المُصدِّر البدء عند الإقلاع (Guest Down) والنسخ المتماثل والاشتراك للعقدة التي يسألها فقط، لذا تُسأل كل عقدة بدورها؛ والعقدة المُسقطة من القائمة لا تُرى. ويقرأ الوكيل العنقود أيضًا من العقدة التالية منها عندما يتعطل `PVE_HOST`. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | لا | عنوان prometheus-pve-exporter (`host:port`، بلا مخطط). القيمة الافتراضية هي المُصدِّر المرفق (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | المُصدِّر المرفق ووكيل الذكاء الاصطناعي | المعرّف الكامل للرمز المميز لواجهة Proxmox API، مثل `monitoring@pam!oneuptime` (PVEAuditor، للقراءة فقط) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | المُصدِّر المرفق ووكيل الذكاء الاصطناعي | سر الرمز المميز لواجهة Proxmox API |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | لا | التحقق من شهادة TLS لواجهة Proxmox API (الافتراضي: `false`؛ يأتي PVE بشهادات موقّعة ذاتيًا) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | لا | اضبطه على `pve-exporter` لتشغيل حاوية المُصدِّر المرفق |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "إعدادات وكيل الذكاء الاصطناعي من OneUptime الخاصة به موجودة ضمن **وكيل الذكاء الاصطناعي من OneUptime**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "عندما يسأل برنامج التثبيت النصي **Run the bundled prometheus-pve-exporter?**، أجب بـ **n** وأدخل عنوان مُصدِّرك (`host:port`، بلا مخطط).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "استخدم عنوانًا تصل إليه حاوية الوكيل، أي عنوان IP للمضيف على الشبكة المحلية أو اسم DNS الخاص به: `localhost` داخل الحاوية هو الحاوية نفسها. أبقِ `PVE_API_TOKEN_ID` و`PVE_API_TOKEN_SECRET` في `.env` إن كنت تستخدم وكيل الذكاء الاصطناعي من OneUptime، فهو يقرأ واجهة API بذلك الرمز المميز.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "يجمع الوكيل بيانات المُصدِّر كل 30 ثانية: مجمّعات العنقود فيه مرة واحدة، على `PVE_HOST` (أو على العقدة التي يقرأ منها العنقود ما دام `PVE_HOST` متعطلًا)، ومجمّعات العقد فيه مرة لكل عقدة في `PVE_NODES`. تحمل كل سلسلة تسمية `id` تعرّف المورد: `node/<name>` أو `qemu/<vmid>` أو `lxc/<vmid>` أو `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| الفئة | المقاييس |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **التوفر** | `pve_up`، `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **العقدة** | `pve_node_info`، `pve_cpu_usage_ratio`، `pve_cpu_usage_limit`، `pve_memory_usage_bytes`، `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **الضيف (VM / LXC)** | `pve_guest_info`، إضافة إلى سلاسل CPU / الذاكرة / الشبكة على المعرّفات `qemu/*` و`lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **التخزين** | `pve_disk_usage_bytes`، `pve_disk_size_bytes`، `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |": "| **HA** (التوفر العالي) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **تغطية النسخ الاحتياطي** | `pve_not_backed_up_total`، `pve_not_backed_up_info`: الضيوف الذين لا تختارهم أي مهمة نسخ احتياطي (لا يُكشف هل جرت النسخ الاحتياطية أو نجحت) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **البدء عند الإقلاع** | `pve_onboot_status` لكل ضيف، ويقرؤه **Guest Down** |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **النسخ المتماثل** | سلاسل `pve_replication_*` لكل مهمة نسخ متماثل للتخزين: تسمية `id` فيها هي معرّف المهمة (مثل `100-0`)، لا مورد |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "يأتي البدء عند الإقلاع والنسخ المتماثل من مجمّعات العقد في المُصدِّر، وهي لا تقرأ إلا العقدة التي يسألها المُصدِّر: العقدة الغائبة عن `PVE_NODES` لا يتوفر لها أيٌّ منهما.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "يقسم المجمّع أيضًا التسمية `id` إلى ثلاث سمات لنقاط البيانات قابلة للتصفية بالمساواة (المعالج `transform/pve-identity`)؛ وعليها تطابق معايير المراقبات وعوامل تصفية لوحات المعلومات:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| السمة | القيم | مثال لـ `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`، `guest`، `storage`، `cluster` (يصبح كلٌّ من `qemu` و`lxc` بالقيمة `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | كل ما يلي أول `/` في `id` (`pve1`، `100`، `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "تبقى التسمية `id` الأصلية دون تغيير.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "يقرأ الوكيل العنقود كله عبر واجهة API لعقدة واحدة: واجهة `PVE_HOST` ما دامت تستجيب. كل 15 ثانية تفحص الحاوية `oneuptime-pve-api-failover` تلك العقدة، وعندما تتوقف واجهة API لها عن الاستجابة يقرأ المجمّع العنقود من العقدة التالية المستجيبة في `PVE_NODES`، حتى يستجيب `PVE_HOST` من جديد. ومع وجود الرمز المميز لواجهة API في `.env` يتخطى أيضًا عقدة تستجيب لكنها مقطوعة عن جزء العنقود الذي يملك النصاب، إذ تبدو منها كل العقد الأخرى متعطلة. ويفعل وكيل الذكاء الاصطناعي من OneUptime الشيء نفسه في كل استدعاء له. لذا عندما تتعطل عقدة، ينطلق **Node Offline** لها ويواصل باقي العنقود الإبلاغ.",
  "Its logs say which node the cluster is read from, and why.":
    "تذكر سجلاته العقدة التي يُقرأ منها العنقود، وسبب ذلك.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "ما لا يمكنه تغطيته هو الجهاز الذي يعمل عليه الوكيل: إذا تعطل، يصمت العنقود كله وينطلق **Cluster Stopped Reporting**. شغّل الوكيل خارج العنقود، أو في آلة افتراضية يعيد Proxmox HA تشغيلها على عقدة أخرى (`ha-manager add vm:<vmid>`، على تخزين مشترك)، وشغّل وكيلًا واحدًا لكل عنقود: كل وكيل يقرأ العنقود كله، لذا فإن وكيلًا ثانيًا يبلّغ عن كل مورد مرتين. راجع [عندما تتعطل عقدة](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "هذا هو ملف `otel-collector-config.yaml` الكامل الذي يشغّله الوكيل؛ ويوفّر ملف `.env` قيم `${env:...}`. يستخرج المعالج `transform/pve-identity` السمات `pve.scope` / `pve.type` / `pve.id` التي تعتمد عليها قوالب تنبيهات Proxmox المضمّنة وعوامل تصفية لوحات المعلومات؛ أبقِه في مكانه إن خصّصت الإعداد:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "افتراضيًا لا يشحن الوكيل إلا المقاييس، لذا تبقى علامة التبويب **السجلات** الخاصة بالعنقود فارغة. تكتب خدمات PVE سجلاتها في دفتر يومية systemd، ويتضمن الإعداد المرفق مستقبِل `journald` معطّلًا بتعليق لكل من `pveproxy` و`pvedaemon` و`pve-firewall` و`pve-ha-crm` و`pve-ha-lrm` و`pvescheduler` و`pvestatd` و`qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **شغّل الوكيل على عقدة PVE.** دفتر اليومية خاص بكل مضيف، فلا يستطيع وكيل بعيد قراءته، ولا تشحن كل عقدة إلا دفترها. ولإبقاء وكيل المقاييس خارج العنقود، شغّل بدلًا من ذلك مجمّعًا ثانيًا للسجلات فقط على كل عقدة.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. أزل التعليق عن المستقبِل `journald` وخط المعالجة `logs` في `otel-collector-config.yaml`، وعن وحدتي تخزين دفتر اليومية في `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **استبدل صورة المجمّع.** الصورة القياسية لا تحتوي على `journalctl` وتعمل بمستخدم لا يستطيع قراءة دفتر اليومية. ابنِ هذا الغلاف واجعل `image:` في `docker-compose.yml` يشير إليه:",
  "4. Apply it:": "4. طبّقه:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "تفضّل إبقاء الصورة القياسية؟ في الوثائق بديل بـ `filelog` يتابع `/var/log/syslog`: [شحن سجلات خدمات Proxmox](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "أي سمة مورد تبدأ بالبادئة `oneuptime.label.` تصبح تسمية مشروع على العنقود: `oneuptime.label.<dimension>=<value>` هي التسمية `<dimension>:<value>`. أضفها إلى المعالج `resource` في `otel-collector-config.yaml`، بجوار `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "ثم أعد تشغيل المجمّع ليقرأ الإعدادات الجديدة:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "يظهر العنقود موسومًا بـ `team:platform` و`env:production`. تُطابق التسميات دون تمييز بين الأحرف الكبيرة والصغيرة، لذا يُعاد استخدام التسمية الموجودة `Production`؛ ولا يزيل الوكيل أبدًا التسميات المضافة في واجهة OneUptime.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "يشغّل `docker-compose.yml` أيضًا **`oneuptime-proxmox-ai-agent`**. بينما يحقق الذكاء الاصطناعي من OneUptime في حادث أو تنبيه على هذا العنقود، يشغّل عبره أوامر `pvesh` للقراءة فقط: `pvesh get /cluster/status`، وحالة ضيف الحالية، والمهام الفاشلة لعقدة. لا يوجد فيه برنامج `pvesh`: يتحول كل أمر إلى استدعاء واحد لواجهة Proxmox VE API على `PVE_HOST`. يُسجَّل بوصفه العنقود المسمّى `PROXMOX_CLUSTER_NAME` ويظهر في صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالعنقود.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **الرمز المميز لواجهة API هو الحد الصارم.** يقرأ بالرمز المميز PVEAuditor الخاص بالمجمّع (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`)، وهو يستطيع القراءة ولا شيء غيرها. إن كنت تشغّل مُصدِّرك الخاص ولا يوجد رمز مميز في `.env`، فأضف واحدًا.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- هو **للقراءة فقط** ما لم تضبط `ONEUPTIME_AI_ALLOW_WRITES=true`. تحتاج الإصلاحات (تشغيل ضيف أو إعادة تشغيله) أيضًا إلى رمز مميز خاص به يُسمح له بتشغيل الضيوف وإيقافها، يُضبط بوصفه `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`؛ وفي ملف README الخاص بالوكيل أوامر `pveum`. إن كان الوكيل يعمل في ضيف من هذا العنقود، فضع VMID ذلك الضيف في `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- تحقّق منه: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- لا تستخدم الذكاء الاصطناعي من OneUptime؟ احذف الخدمة `oneuptime-proxmox-ai-agent` من `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "ما الذي يمكنه تشغيله وكيف تعمل الإصلاحات: [وكلاء الذكاء الاصطناعي للبنية التحتية](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**ترقية**: صورة المجمّع مثبّتة في `docker-compose.yml` وملف إعدادها بجوارها، لذا فإن سحب الصورة وحده لا يحدّث الوكيل. شغّل برنامج التثبيت النصي مرة أخرى. فهو يعيد استخدام كل قيمة في ملف `.env` الحالي (لا يُسأل عن شيء مجددًا)، ويُنزّل أحدث `docker-compose.yml` و`otel-collector-config.yaml` (يُحتفظ بالملف الذي عدّلته بجوار الجديد باسم `<file>.bak.<timestamp>`)، ويسحب الصور ويعيد إنشاء الوكيل بها:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "تُبلغ الإعدادات عن إصدار المجمّع الذي تثبّته بوصفه **إصدار الوكيل** للعنقود. عندما يثبّت OneUptime هذا إصدارًا أحدث، تفتح علامة تحذير بجواره هذه الأوامر.",
  "**Uninstall** the agent:": "**إلغاء التثبيت** للوكيل:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "ثم احذف الرمز المميز لواجهة API ضمن *Datacenter → Permissions → API Tokens* إن لم تعد تحتاج إليه.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "يفحص `troubleshoot.sh` السلسلة بأكملها (بيئة تشغيل الحاويات، وجمع بيانات المُصدِّر، ووسم اسم العنقود، وشكل الرمز المميز، ومقاييس المجمّع نفسه) ويسأل OneUptime مباشرة عمّا إذا كان يقبل مفتاح الاستيعاب لديك. هذا الفحص الأخير هو الأهم: ترفض نقاط نهاية OTLP في OneUptime المفتاح الخاطئ بـ `401` أو `422`، وهو ما يسجّله المجمّع سطرًا واحدًا `Exporting failed` لكل دفعة يسهل أن يفوتك، لذا يطلب البرنامج النصي من `GET /otlp/v1/validate` حكمًا مباشرًا 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "وينتهي بحكم يسمّي السبب الأرجح.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. تحقّق من أن الوكيل يعمل (في `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. افحص سجلات الوكيل بحثًا عن أخطاء: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. تحقّق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. تأكد من أن جهاز الوكيل يستطيع الوصول إلى مثيل OneUptime عبر الشبكة.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. تحقّق من أن المُصدِّر يستجيب. لا ينشر المُصدِّر المرفق منفذه على المضيف، لذا شغّل curl داخل مساحة أسماء الشبكة الخاصة به؛ يجب أن ترى أسطر مقاييس `pve_*` (لمُصدِّرك الخاص، استدعِ `host:9221` الخاص به مباشرة باستخدام curl):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. تحقّق من أن للرمز المميز لواجهة API الدور **PVEAuditor** على المسار `/`، على الرمز المميز وعلى مستخدمه.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. افحص سجلات المجمّع بحثًا عن أخطاء الجمع أو التصدير (في `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "الرمز المميز لواجهة API خاطئ أو تنقصه الأذونات. أعد التحقق من صيغة معرّف الرمز المميز (`user@realm!tokenname`)، والسر، ومن أن الدور **PVEAuditor** ممنوح على المسار `/` للرمز المميز ولمستخدمه. تعرض سجلات المُصدِّر نفسه ردّ واجهة API: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'تأتي سلاسل الضيوف (المعرّفات `qemu/*` و`lxc/*`) من مجمّع العنقود في المُصدِّر. يفعّله الإعداد المرفق (معامل الجمع `cluster=1`)؛ إن خصّصت الإعداد، فأعد المعامل `cluster: ["1"]`.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "تأتي علامات البدء عند الإقلاع ومهام النسخ المتماثل للضيوف من العقدة التي يعملون عليها، ولا يقرأ الوكيل إلا العقد الموجودة في `PVE_NODES`. اذكر هناك عنوان كل عقدة الخاص بها، مثل `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`، وطبّق ذلك بـ `docker compose up -d` في `/opt/oneuptime-proxmox-agent`. إذا توقف المجمّع عن البدء بعد تعديل، فقد فقدت القائمة قوسيها المعقوفين. يفحص `troubleshoot.sh` كل عقدة في القائمة.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "تأتي هوية العنقود من `PROXMOX_CLUSTER_NAME`، الذي يُوسم به كل مقياس بوصفه `proxmox.cluster.name`. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-proxmox-agent`؛ ولاحظ أن الاسم الجديد يسجّل عنقودًا جديدًا.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **اسم العنقود**: أدخل **`pve-1`** كما هو تمامًا؛ أي اسم آخر يسجّل عنقودًا جديدًا.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "تأتي هوية العنقود من `PROXMOX_CLUSTER_NAME`، الذي يُوسم به كل مقياس بوصفه `proxmox.cluster.name`. هذا العنقود هو **`pve-1`**. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-proxmox-agent`؛ ولاحظ أن الاسم الجديد يسجّل عنقودًا جديدًا.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "يحمل الأمر بالفعل عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب. ويسأل البرنامج النصي عن الباقي:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "يتطلب Proxmox VE 8.3 أو أحدث. يضيف الأمر الأول هدف خطاف ويب باسم `oneuptime`، يرسل كل إشعار إلى OneUptime بوصفه سجلًا لهذا العنقود ويحفظ المفتاح واسم العنقود في أسراره. ويرسل الأمر الثاني كل إشعار إليه. استبدل `my-proxmox-cluster` باسم العنقود الذي أعطيته للوكيل، حتى تصل الإشعارات إلى العنقود نفسه.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "تعرض صفحة كل ضيف بعد ذلك آخر نسخة احتياطية له، وتقترح **التوصيات** الخاصة بالعنقود التنبيهين **Backup Job Failed** و **Node Fenced**. لإيقاف إرسالها:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "يتطلب Proxmox VE 8.3 أو أحدث. يضيف الأمر الأول هدف خطاف ويب باسم `oneuptime`، يرسل كل إشعار إلى OneUptime بوصفه سجلًا لهذا العنقود ويحفظ المفتاح واسم العنقود في أسراره. ويرسل الأمر الثاني كل إشعار إليه. يذكر الأمر **`pve-1`** بالفعل، لذا تصل الإشعارات إلى هذا العنقود.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "نزّل `docker-compose.yml` و`otel-collector-config.yaml` من OneUptime هذا إلى مجلد جديد:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "أنشئ ملف `.env` بجوارهما؛ فهو يحمل سر الرمز المميز، لذا أبقِه خاصًا بـ `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- استبدل `my-proxmox-cluster` باسم لهذا العنقود، مثل `pve-prod`. بهذا الاسم يظهر العنقود في OneUptime، لذا أبقه ثابتًا: الاسم الجديد يسجّل عنقودًا جديدًا.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- اضبط `PVE_HOST` على أي عقدة في العنقود: ما دامت واجهة API لها لا تستجيب، يقرأ الوكيل العنقود من العقدة التالية في `PVE_NODES`، لذا لا يحتاج إلى عنوان IP افتراضي.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- اضبط `PVE_NODES` على العنوان الخاص بكل عقدة، بين قوسين معقوفين، وليس عنوان IP افتراضيًا أبدًا. يقرأ المُصدِّر البدء عند الإقلاع (Guest Down) والنسخ المتماثل والاشتراك للعقدة التي يسألها فقط، لذا تُسأل كل عقدة بدورها؛ والعقدة المُسقطة من القائمة لا تُرى.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- املأ الرمز المميز من الخطوة السابقة. يشغّل `COMPOSE_PROFILES=pve-exporter` أيضًا prometheus-pve-exporter المرفق، الذي يقرأ واجهة API به.",
  "Start the agent:": "شغّل الوكيل:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "يقرأ الوكيل هذه القيم من ملف `.env` بجوار `docker-compose.yml`. بعد تغيير أيٍّ منها، طبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "اترك `COMPOSE_PROFILES` خارج `.env` ووجّه الوكيل بدلًا من ذلك إلى مُصدِّرك (`host:port`، بلا مخطط):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "شغّل هذه الأوامر في مجلد الوكيل، وهو المجلد الذي فيه `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**ترقية**: صورة المجمّع مثبّتة في `docker-compose.yml` وإعداداته ملف بجوارها، لذا فإن سحب الصورة وحده لا يحدّث الوكيل. نزّل الملفين مجددًا؛ يبقى ملف `.env` لديك، وأي تغيير أجريته على أيٍّ من الملفين يجب إجراؤه مجددًا:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "ثم اسحب الصور وأعد إنشاء الوكيل، ليقرأ المجمّع إعداداته الجديدة:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. تحقّق من أن الوكيل يعمل (في مجلد الوكيل): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. افحص سجلات المجمّع بحثًا عن أخطاء الجمع أو التصدير (في مجلد الوكيل): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "تأتي علامات البدء عند الإقلاع ومهام النسخ المتماثل للضيوف من العقدة التي يعملون عليها، ولا يقرأ الوكيل إلا العقد الموجودة في `PVE_NODES`. اذكر هناك عنوان كل عقدة الخاص بها، مثل `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`، وطبّق ذلك بـ `docker compose up -d` في المجلد الذي يحتوي على `docker-compose.yml`. إذا توقف المجمّع عن البدء بعد تعديل، فقد فقدت القائمة قوسيها المعقوفين. يفحص `troubleshoot.sh` كل عقدة في القائمة.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "تأتي هوية العنقود من `PROXMOX_CLUSTER_NAME`، الذي يُوسم به كل مقياس بوصفه `proxmox.cluster.name`. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`؛ ولاحظ أن الاسم الجديد يسجّل عنقودًا جديدًا.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- هذا يثبّت الوكيل للعنقود **`pve-1`**: أبقِ `PROXMOX_CLUSTER_NAME` كما هو تمامًا، وإلا فستُسجَّل البيانات عنقودًا جديدًا.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "تأتي هوية العنقود من `PROXMOX_CLUSTER_NAME`، الذي يُوسم به كل مقياس بوصفه `proxmox.cluster.name`. هذا العنقود هو **`pve-1`**. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`؛ ولاحظ أن الاسم الجديد يسجّل عنقودًا جديدًا.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**بلا وكيل، لكن ببيانات أقل.** يدفع Proxmox VE 9.0 والإصدارات الأحدث مقاييس كل عقدة إلى OneUptime بنفسه. لا تُدفع حالة HA ولا البدء عند الإقلاع (الذي يستخدمه **Guest Down**) ولا تغطية النسخ الاحتياطي ولا النسخ المتماثل؛ استخدم برنامج التثبيت النصي أو Docker Compose إن احتجت إليها. استخدم أحدهما فقط للعنقود: تشغيل الاثنين معًا يبلّغ عن كل مورد مرتين.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 أو أحدث**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "واجهة الويب في Proxmox، لإضافة خادم مقاييس ضمن *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "يمكن لكل عقدة الوصول إلى `<YOUR_ONEUPTIME_HOST>` عبر المنفذ `443`",
  "| Field | Value |": "| الحقل | القيمة |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (الخادم) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (المنفذ) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (البروتوكول) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (المسار) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (الترويسات) | ملف JSON أدناه |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "أضفه مرة واحدة لمركز البيانات: تدفع بعدها كل عقدة في العنقود مقاييسها الخاصة.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "يحوّل OneUptime هذا الدفع إلى سلاسل `pve_*` نفسها التي يرسلها الوكيل. يسجّل العنقود نفسه باسم عنقود Proxmox الخاص بك (والعقدة المستقلة باسم عقدتها) ويظهر في قسم **Proxmox**، حيث تعمل صفحات العقد والضيوف والتخزين ومخططات النظرة العامة وكتالوج المقاييس وقوالب تنبيهات CPU / الذاكرة / التخزين كما تعمل مع الوكيل.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "تدفع كل عقدة حالتها فقط، لذا لا تستطيع العقدة المتعطلة أن تبلّغ بنفسها عن تعطلها؛ تبلّغ عنها العقد التي ما زالت تعمل:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- تظهر بحالة **غير متصل** في صفحات Proxmox بعد نحو دقيقتين من آخر تقرير لها، وينطلق **Node Offline** بعد نحو 5 دقائق.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- يعدّها **Cluster Quorum at Risk** أيضًا غير متصلة؛ وينطلق بعد نحو 7–9 دقائق من صمت العقدة، حين تكتمل التقارير في نافذته البالغة 5 دقائق.",
  "- Its next report brings it back.": "- يعيدها تقريرها التالي.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "تعني «غير متصل» «توقفت عن الإبلاغ»: يبدو تعليق `pvestatd` أو توقف `pmxcfs` أو انقطاع الشبكة إلى OneUptime كلها متشابهة. أما المضيف المستقل أو العنقود الذي يصمت كله فلا يبقى من يبلّغ عنه، لذا يصبح العنقود بدلًا من ذلك بحالة **منقطع الاتصال**. والعقدة الصامتة أكثر من 7 أيام لا يُبلَّغ عنها بعد ذلك. تحمل هذه التقارير العلامة `oneuptime.proxmox.inferred=not-reporting` في مستكشف المقاييس.",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "يُسجَّل العنقود باسم عنقود Proxmox الخاص به؛ وتُسجَّل العقدة المستقلة باسم عقدتها. وتبقى سمة المورد `proxmox.cluster.name` المضبوطة ضمن *Resource Attributes* في خادم المقاييس مستخدمة بدلًا من ذلك.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "يحوّل OneUptime هذا الدفع إلى سلاسل `pve_*` التي يرسلها الوكيل، لذا تعمل صفحات Proxmox وقوالب تنبيهات CPU / الذاكرة / التخزين دون تغيير. وتبقى سلاسل `proxmox_*` الأصلية متاحة في مستكشف المقاييس لكل ما يبلّغ عنه Proxmox VE غير ذلك.",
  "Some alert templates need data only the agent collects:":
    "تحتاج بعض قوالب التنبيهات إلى بيانات لا يجمعها إلا الوكيل:",
  "| Needs the agent | Why |": "| يحتاج إلى الوكيل | السبب |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| حالة HA | لا تُدفع: يحتاج القالب **HA Resource in Error State** إلى الوكيل |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| علامة البدء عند الإقلاع | لا تُدفع: يحتاج **Guest Down**، الذي لا ينبّه إلا للضيوف المضبوطين على البدء عند الإقلاع، إلى الوكيل |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| تغطية النسخ الاحتياطي والنسخ المتماثل | لا تُدفعان: يحتاج **Guest Not Backed Up** و **Replication Failing** إلى الوكيل |",
  "Every node has stopped reporting, or never started.":
    "توقفت كل العقد عن الإبلاغ، أو لم تبدأ قط.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. ضمن *Datacenter → Metric Server*، تحقّق من إدخال OpenTelemetry: الخادم `<YOUR_ONEUPTIME_HOST>`، والمنفذ `443`، والبروتوكول `https`، والمسار `/otlp/v1/metrics`، والترويسة `x-oneuptime-token` بمفتاح من الخطوة 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. تحقّق من أن العقد تصل إلى `<YOUR_ONEUPTIME_HOST>` عبر الشبكة.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "توقفت عن الإبلاغ: العقدة المتعطلة، أو تعليق `pvestatd`، أو توقف `pmxcfs`، أو انقطاع الشبكة إلى OneUptime، كلها تبدو متشابهة. يعيدها تقريرها التالي. إن أخرجت العقدة من العنقود، فاستخدم **إزالة العقدة** في صفحتها؛ وإلا فستبقى غير متصلة حتى 7 أيام.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "لا يرسل الدفع الأصلي حالة HA ولا البدء عند الإقلاع ولا تغطية النسخ الاحتياطي ولا النسخ المتماثل. اختر **برنامج التثبيت النصي** أو **Docker Compose** أعلى هذا الدليل لتشغيل الوكيل بدلًا من ذلك، واحذف خادم المقاييس، لأن تشغيل الاثنين معًا يبلّغ عن كل مورد مرتين.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "هذا العنقود هو **`pve-1`** في OneUptime. إن لم يكن هذا هو الاسم الخاص بعنقود Proxmox، فاضبط `proxmox.cluster.name` على `pve-1` ضمن *Resource Attributes* في خادم المقاييس، وإلا فسيسجّل الدفع عنقودًا جديدًا.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "يتطلب Proxmox VE 8.3 أو أحدث. يضيف الأمر الأول هدف خطاف ويب باسم `oneuptime`، يرسل كل إشعار إلى OneUptime بوصفه سجلًا لهذا العنقود ويحفظ المفتاح واسم العنقود في أسراره. ويرسل الأمر الثاني كل إشعار إليه. استبدل `my-proxmox-cluster` بالاسم الذي يظهر به العنقود في OneUptime: اسم عنقود Proxmox الخاص به، أو الاسم الخاص بعقدة مستقلة.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | لا | اسم حاوية المجمّع (الافتراضي: `oneuptime-proxmox-agent`). يحتاج وكيل عنقود ثانٍ على الجهاز نفسه إلى أسماء خاصة به: يسمّي برنامج التثبيت النصي حاويات الوكيل الجديد باسم مجلده ما لم تضبطها بنفسك، ويحتفظ بها عند تشغيل البرنامج النصي مجددًا |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | لا | اسم الحاوية الجانبية لتبديل واجهة API عند التعطل (الافتراضي: `oneuptime-pve-api-failover`). يسمّي برنامج التثبيت النصي الحاوية الجانبية لتبديل واجهة API عند التعطل لعنقود ثانٍ باسم مجمّعه (`oneuptime-pve-api-failover-cluster2` بجوار `oneuptime-proxmox-agent-cluster2`) ما لم تضبطها بنفسك، ويحتفظ بها عند تشغيل البرنامج النصي مجددًا |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية المُصدِّر المرفق (الافتراضي: `oneuptime-pve-exporter`). يسمّي برنامج التثبيت النصي المُصدِّر المرفق لعنقود ثانٍ باسم مجمّعه (`oneuptime-pve-exporter-cluster2` بجوار `oneuptime-proxmox-agent-cluster2`) ما لم تضبطه بنفسك، ويحتفظ به عند تشغيل البرنامج النصي مجددًا |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | لا | اسم حاوية وكيل الذكاء الاصطناعي (الافتراضي: `oneuptime-proxmox-ai-agent`). يسمّي برنامج التثبيت النصي وكيل الذكاء الاصطناعي لعنقود ثانٍ باسم مجمّعه (`oneuptime-proxmox-ai-agent-cluster2` بجوار `oneuptime-proxmox-agent-cluster2`) ما لم تضبطه بنفسك، ويحتفظ به عند تشغيل البرنامج النصي مجددًا |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "يقرأ الوكيل الواحد عنقودًا واحدًا. ولعنقود ثانٍ، ثبّت وكيلًا ثانيًا في مجلد خاص به، مع أسماء حاويات خاصة به، إذ لا يمكن لحاويتين أن تتشاركا اسمًا:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "يسمّي البرنامج النصي الحاويات باسم المجلد، مثل `oneuptime-proxmox-agent-cluster2`، ما لم تضبط متغيراتها، مثل `PROXMOX_AGENT_CONTAINER_NAME`. ويحتفظ بالأسماء في ملف `.env` الخاص بذلك الوكيل، لذا فإن تشغيل البرنامج النصي مجددًا بقيمة `INSTALL_DIR` نفسها لترقية الوكيل يُبقي عليها، والوكيل الذي عدّلت `container_name` الخاص به يومًا في `docker-compose.yml` يحتفظ بذلك الاسم.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "امنح كل مجلد اسمًا خاصًا به: يسمّي Docker Compose المشروع باسم مجلده وحده، لذا يرفض البرنامج النصي مجلدًا يحمل اسم مجلد آخر يشغّل وكيلًا في مكان آخر. مرّر المجلد إلى البرنامج النصي للتشخيص باستخدام `-d`.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | لا | اسم حاوية المجمّع (الافتراضي: `oneuptime-proxmox-agent`). يحتاج وكيل عنقود ثانٍ على الجهاز نفسه إلى اسم خاص به |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | لا | اسم الحاوية الجانبية لتبديل واجهة API عند التعطل (الافتراضي: `oneuptime-pve-api-failover`). يحتاج وكيل عنقود ثانٍ على الجهاز نفسه إلى اسم خاص به |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | لا | اسم حاوية المُصدِّر المرفق (الافتراضي: `oneuptime-pve-exporter`). يحتاج وكيل عنقود ثانٍ على الجهاز نفسه إلى اسم خاص به |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | لا | اسم حاوية وكيل الذكاء الاصطناعي (الافتراضي: `oneuptime-proxmox-ai-agent`). يحتاج وكيل عنقود ثانٍ على الجهاز نفسه إلى اسم خاص به |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "يقرأ الوكيل الواحد عنقودًا واحدًا. ولعنقود ثانٍ، أعدّ وكيلًا ثانيًا في مجلد خاص به، مع أسماء حاويات خاصة به، إذ لا يمكن لحاويتين أن تتشاركا اسمًا. اضبطها في ملف `.env` الخاص بذلك الوكيل:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "امنح كل مجلد اسمًا خاصًا به: يسمّي Docker Compose المشروع باسم مجلده وحده، لذا فإن مجلدًا ثانيًا بالاسم نفسه سيستبدل حاويات الوكيل الأول. لا تضع الأسماء في `docker-compose.yml`، الذي تستبدله الترقية.",
};

export default TRANSLATION;
