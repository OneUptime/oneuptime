import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 أو أحدث مع إضافة Docker Compose v2، على جهاز يمكنه الوصول إلى خدمات mgr الخلفية في Ceph لديك عبر المنفذ 9283",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "سطر أوامر على عقدة إدارة في Ceph، حيث يعمل الأمر `ceph` بصلاحيات المسؤول",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "ثم اعرض قائمة خدمات mgr لديك؛ يحتاج الوكيل إليها **كلها**، النشطة منها والاحتياطية:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "لا يُرجع المقاييس إلا mgr **النشط** (تجيب الاحتياطية باستجابة فارغة)، لذا فإن جمعها من كل mgr يُبقي المقاييس متدفقة عندما يتولى mgr آخر مكان النشط.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "يسأل البرنامج النصي عن عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب، وكلاهما ظاهر في الخطوة 1 (اختر مفتاحًا هناك ليُملآ هنا)، ثم عن:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **اسم العنقود**: الاسم الذي يظهر به العنقود في OneUptime. امنح كل عنقود اسمه الخاص وأبقه ثابتًا: الاسم الجديد يسجّل عنقودًا جديدًا.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **نقاط نهاية mgr**: كل mgr من الخطوة السابقة بصيغة `host:port` مفصولة بفواصل، مثل `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. يضيف البرنامج النصي الأقواس المربعة.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **وكيل الذكاء الاصطناعي من OneUptime**: هل يُسمح له بتطبيق الإصلاحات؛ أجب بـ **N** لإبقائه للقراءة فقط. وحيث يعمل `ceph` بصلاحيات المسؤول، يعرض البرنامج النصي أيضًا إنشاء عميل Ceph خاص بوكيل الذكاء الاصطناعي.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "يُثبَّت في `/opt/oneuptime-ceph-agent`، ويكتب ملف `.env` بصلاحيات `0600`، ويشغّل الوكيل باستخدام Docker Compose. تشغيل البرنامج النصي مجددًا يعيد استخدام كل ما في ذلك الملف `.env` بدلًا من السؤال مرة أخرى، لذا فهو أيضًا طريقة الترقية.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "ابحث عن `Everything is ready. Begin running and processing data.` في السجلات. بعد ذلك يظهر العنقود تلقائيًا في قسم **Ceph**، عادةً خلال دقيقة تقريبًا.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "يشغّل Docker Compose أيضًا **`oneuptime-ceph-ai-agent`**، وهو وكيل الذكاء الاصطناعي من OneUptime. إذا أنشأ برنامج التثبيت النصي عميل Ceph الخاص به فهو يعمل بالفعل؛ وإلا فإنه ينتظر عميلًا؛ راجع **وكيل الذكاء الاصطناعي من OneUptime** ضمن متقدم.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**وكيل الذكاء الاصطناعي من OneUptime (مفعّل افتراضيًا، للقراءة فقط).** تحقيقات الذكاء الاصطناعي مفعّلة: بمجرد أن يحصل على عميل Ceph الخاص به، يتيح للذكاء الاصطناعي من OneUptime التحقيق في الحوادث والتنبيهات على هذا العنقود بأوامر `ceph` للقراءة فقط، ولا يغيّر شيئًا ما لم تسمح بالإصلاحات.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "يكتب برنامج التثبيت النصي هذه القيم في `/opt/oneuptime-ceph-agent/.env`. بعد تغيير أيٍّ منها، طبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |": "| المتغير | مطلوب | الوصف |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | نعم | عنوان URL لمثيل OneUptime لديك (مثل `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | نعم | مفتاح استيعاب القياس عن بُعد، المفتاح الذي اخترته في الخطوة 1 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | نعم | معرّف العنقود الظاهر في OneUptime. يُوسم به كل مقياس بوصفه سمة المورد `ceph.cluster.name`. أبقه ثابتًا: تغييره يسجّل عنقودًا جديدًا (الافتراضي: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | نعم | قائمة `host:port` مفصولة بفواصل لخدمات mgr **كلها**، بين أقواس مربعة، مثل `[ceph-mon-1:9283,ceph-mon-2:9283]`. يضيف برنامج التثبيت النصي الأقواس نيابةً عنك |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "إعدادات وكيل الذكاء الاصطناعي من OneUptime الخاصة به موجودة ضمن **وكيل الذكاء الاصطناعي من OneUptime**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **تُجمع المقاييس من كل خدمات mgr** (النشطة والاحتياطية)، لذا تصمد المقاييس أمام تبديل mgr النشط.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **كل 30 ثانية.** تخزّن وحدة prometheus في mgr نتيجة الجمع مؤقتًا لمدة `mgr/prometheus/scrape_interval` (15 ثانية افتراضيًا): لا تجمع أكثر من ذلك أبدًا، فلن تقرأ إلا الذاكرة المؤقتة مجددًا.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** يُبقي التسميات التي يصدّرها Ceph (`ceph_daemon`، `pool_id`) كما هي، لتبقى السلاسل متصلة عبر تبديلات mgr.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "هذا هو ملف `otel-collector-config.yaml` الكامل الذي يشغّله الوكيل؛ ويوفّر الملف `.env` قيم `${env:...}`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "يستطيع الوكيل متابعة `/var/log/ceph/ceph.log` وإرساله إلى OneUptime، فتمتلئ صفحة **سجل العنقود**. هذا معطّل افتراضيًا لأن الوكيل يجب أن يعمل على مضيف يوجد فيه سجل العنقود، وهو افتراضيًا مضيف mon.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. في `otel-collector-config.yaml`، أزل التعليق عن المستقبِل `filelog` وخط المعالجة `logs`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. في `docker-compose.yml`، أزل التعليق عن وحدة التخزين `/var/log/ceph:/var/log/ceph:ro`.",
  "3. Apply both:": "3. طبّق الاثنين:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "تُرسل الأسطر كما هي؛ يحلّل OneUptime تنسيق ceph.log (الطابع الزمني، الخدمة، مستوى INF/WRN/ERR، الرسالة) عند قراءتها، ويَسِم المعالج `resource` بالقيمة `ceph.cluster.name` ليصل السجل إلى هذا العنقود.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "أي سمة مورد تبدأ بالبادئة `oneuptime.label.` تصبح تسمية مشروع على العنقود: `oneuptime.label.<dimension>=<value>` هي التسمية `<dimension>:<value>`. أضفها إلى المعالج `resource` في `otel-collector-config.yaml`، بجوار `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "ثم أعد تشغيل المجمّع ليقرأ الإعدادات الجديدة:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "يظهر العنقود موسومًا بـ `team:storage` و`env:production`. تُطابق التسميات دون تمييز بين الأحرف الكبيرة والصغيرة، لذا يُعاد استخدام التسمية الموجودة `Production`؛ ولا يزيل الوكيل أبدًا التسميات المضافة في واجهة OneUptime.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "يرسل الوكيل كل ما تصدّره وحدة prometheus في mgr. تعتمد صفحات Ceph في OneUptime وفهرس المقاييس وقوالب التنبيهات على:",
  "| Category | Data |": "| الفئة | البيانات |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **صحة العنقود** | `ceph_health_status` (0 = OK، 1 = WARN، 2 = ERR)، نصاب المراقبات، والسعة الخام الإجمالية والمستخدمة |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | حالة up / in لكل OSD (حسب التسمية `ceph_daemon`، مثل `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **التجمّع** | البايتات المخزنة، والحد الأقصى المتاح، وعدد الكائنات، وعمليات القراءة والكتابة والإنتاجية لكل تجمّع |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **مجموعات التوزيع** | أعداد مجموعات PG النشطة والمتدهورة وناقصة الحجم |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "يشغّل `docker-compose.yml` أيضًا **`oneuptime-ceph-ai-agent`**. بينما يحقق الذكاء الاصطناعي من OneUptime في حادث أو تنبيه على هذا العنقود، يشغّل عبره أوامر `ceph`: `ceph health detail`، `ceph osd tree`، `ceph pg dump_stuck`، `ceph crash ls`. يُسجَّل بوصفه العنقود المسمّى `CEPH_CLUSTER_NAME` ويظهر في صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالعنقود.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "يتصل بوصفه عميل Ceph خاصًا به، `client.oneuptime-ai`، مع ملف `ceph.conf` المختصر للعنقود وحلقة مفاتيح ذلك العميل في مجلد `ceph/` بجوار `docker-compose.yml`. يعرض برنامج التثبيت النصي إنشاءهما عند التثبيت الجديد، حين يعمل `ceph` بصلاحيات المسؤول على الجهاز الذي تشغّله عليه. وإلا، أو لإضافتهما لاحقًا، على عقدة إدارة في Ceph:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "إذا كان الوكيل يعمل على جهاز آخر، فانسخ الملفين إلى مجلد `ceph/` الخاص به بالطريقة نفسها. **لا تضع حلقة مفاتيح المسؤول هناك أبدًا.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **صلاحيات caps الخاصة بالعميل هي الحد الصارم.** بهذه الصلاحيات للقراءة لا يستطيع أي شيء يشغّله تغيير العنقود. تحتاج الإصلاحات (إعادة OSD إلى حالة in، أو إزالة `noout`) أيضًا إلى `ONEUPTIME_AI_ALLOW_WRITES=true` في `.env` وصلاحيات الإصلاح من ملف README الخاص بالوكيل.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- تحقّق منه: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- لا تستخدم الذكاء الاصطناعي من OneUptime؟ احذف الخدمة `oneuptime-ceph-ai-agent` من `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "ما الذي يمكنه تشغيله وكيف تعمل الإصلاحات: [وكلاء الذكاء الاصطناعي للبنية التحتية](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**ترقية**: صورة المجمّع مثبّتة في `docker-compose.yml` وإعداداته ملف بجوارها، لذا فإن سحب الصورة وحده لا يحدّث الوكيل. شغّل برنامج التثبيت النصي مرة أخرى. فهو يعيد استخدام كل قيمة في ملف `.env` الحالي (لا يُسأل عن شيء مجددًا)، ويُنزّل أحدث `docker-compose.yml` و`otel-collector-config.yaml` (يُحتفظ بالملف الذي عدّلته بجوار الجديد باسم `<file>.bak.<timestamp>`)، ويسحب الصور ويعيد إنشاء الوكيل بها. ويبقى مجلد `ceph/` الخاص بوكيل الذكاء الاصطناعي كما هو:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "تُبلغ الإعدادات عن إصدار المجمّع الذي تثبّته بوصفه **إصدار الوكيل** للعنقود. عندما يثبّت OneUptime هذا إصدارًا أحدث، تفتح علامة تحذير بجواره هذه الأوامر.",
  "**Uninstall** the agent:": "**إلغاء التثبيت** للوكيل:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "إذا أنشأت عميل Ceph لوكيل الذكاء الاصطناعي، فأزله على عقدة إدارة: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "يفحص `troubleshoot.sh` السلسلة بأكملها (بيئة تشغيل الحاويات، وكل نقطة نهاية mgr بما في ذلك فخ النشط مقابل الاحتياطي، ووسم اسم العنقود، وشكل الرمز المميز، ومقاييس المجمّع نفسه) ويسأل OneUptime مباشرة عمّا إذا كان يقبل مفتاح الاستيعاب لديك. هذا الفحص الأخير هو الأهم: ترفض نقاط نهاية OTLP في OneUptime المفتاح الخاطئ بـ `401` أو `422`، وهو ما يسجّله المجمّع سطرًا واحدًا `Exporting failed` لكل دفعة يسهل أن يفوتك، لذا يطلب البرنامج النصي من `GET /otlp/v1/validate` حكمًا مباشرًا 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "وينتهي بحكم يسمّي السبب الأرجح.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. تحقّق من سجلات المجمّع: `docker logs oneuptime-ceph-agent`؛ ابحث عن أخطاء التصدير (`401` يعني مفتاح استيعاب خاطئًا، ورفض الاتصال يعني `ONEUPTIME_URL` خاطئًا).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. تحقّق من أن نقطة نهاية mgr تقدّم المقاييس: `curl http://<active-mgr>:9283/metrics | head`؛ يُفترض أن ترى أسطر مقاييس `ceph_*`. إن لم ترها، ففعّل الوحدة: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. تأكد من أن `CEPH_MGR_ENDPOINTS` محاط بأقواس مربعة: من دونها يعامل المجمّع السلسلة المفصولة بفواصل كلها هدفًا واحدًا (غير صالح).",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. تحقّق من أن الوكيل يعمل: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. افحص سجلات الوكيل بحثًا عن أخطاء: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. تحقّق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. تأكد من أن جهاز الوكيل يستطيع الوصول إلى مثيل OneUptime عبر الشبكة.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "على الأرجح أنت تجمع المقاييس من mgr النشط (سابقًا) فقط. أدرج **كل** خدمات mgr في `CEPH_MGR_ENDPOINTS`: الجمع من خدمات mgr الاحتياطية زهيد التكلفة ويُرجع استجابات فارغة.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "هذا متوقع إذا كان `mgr/prometheus/standby_behaviour` مضبوطًا على `error` في عنقودك: عندها تجيب الاحتياطية بـ HTTP 500. يظل الجمع من mgr النشط ناجحًا، لذا فهذه الأخطاء مجرد ضجيج؛ أعد السلوك إلى `default` لإسكاتها.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "تأتي هوية العنقود من `CEPH_CLUSTER_NAME`، الذي يُوسم به كل مقياس بوصفه `ceph.cluster.name`. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-ceph-agent`؛ ولاحظ أن الاسم الجديد يسجّل عنقودًا جديدًا.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **اسم العنقود**: أدخل **`ceph-1`** كما هو تمامًا؛ أي اسم آخر يسجّل عنقودًا جديدًا.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "تأتي هوية العنقود من `CEPH_CLUSTER_NAME`، الذي يُوسم به كل مقياس بوصفه `ceph.cluster.name`. هذا العنقود هو **`ceph-1`**. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-ceph-agent`؛ ولاحظ أن الاسم الجديد يسجّل عنقودًا جديدًا.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "يحمل الأمر بالفعل عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب. ويسأل البرنامج النصي عن الباقي:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "نزّل `docker-compose.yml` و`otel-collector-config.yaml` من OneUptime هذا إلى مجلد جديد:",
  "Create a `.env` file next to them:": "أنشئ ملف `.env` بجوارهما:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- استبدل `my-ceph-cluster` باسم لهذا العنقود، مثل `ceph-prod`. بهذا الاسم يظهر العنقود في OneUptime، لذا أبقه ثابتًا: الاسم الجديد يسجّل عنقودًا جديدًا.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- أدرج **كل** خدمات mgr في `CEPH_MGR_ENDPOINTS`، مفصولة بفواصل وبين أقواس مربعة: من دون الأقواس يقرأ المجمّع القائمة كلها هدفًا واحدًا غير صالح.",
  "Start the agent:": "شغّل الوكيل:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "يشغّل Docker Compose أيضًا **`oneuptime-ceph-ai-agent`**، وهو وكيل الذكاء الاصطناعي من OneUptime. وهو ينتظر عميل Ceph خاصًا به؛ راجع **وكيل الذكاء الاصطناعي من OneUptime** ضمن متقدم، أو احذف خدمته من `docker-compose.yml` إذا كنت لا تستخدم الذكاء الاصطناعي من OneUptime.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "يقرأ الوكيل هذه القيم من ملف `.env` بجوار `docker-compose.yml`. بعد تغيير أيٍّ منها، طبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | نعم | قائمة `host:port` مفصولة بفواصل لخدمات mgr **كلها**، بين أقواس مربعة، مثل `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "يتصل بوصفه عميل Ceph خاصًا به، `client.oneuptime-ai`، مع ملف `ceph.conf` المختصر للعنقود وحلقة مفاتيح ذلك العميل في مجلد `ceph/` بجوار `docker-compose.yml`. على عقدة إدارة في Ceph، في مجلد الوكيل:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "شغّل هذه الأوامر في مجلد الوكيل، وهو المجلد الذي فيه `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**ترقية**: صورة المجمّع مثبّتة في `docker-compose.yml` وإعداداته ملف بجوارها، لذا فإن سحب الصورة وحده لا يحدّث الوكيل. نزّل الملفين مجددًا؛ يبقى ملف `.env` لديك، وأي تغيير أجريته على أيٍّ من الملفين يجب إجراؤه مجددًا:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "ثم اسحب الصور وأعد إنشاء الوكيل، ليقرأ المجمّع إعداداته الجديدة:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "تأتي هوية العنقود من `CEPH_CLUSTER_NAME`، الذي يُوسم به كل مقياس بوصفه `ceph.cluster.name`. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`؛ ولاحظ أن الاسم الجديد يسجّل عنقودًا جديدًا.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- هذا يثبّت الوكيل للعنقود **`ceph-1`**: أبقِ `CEPH_CLUSTER_NAME` كما هو تمامًا، وإلا فستُسجَّل البيانات عنقودًا جديدًا.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "تأتي هوية العنقود من `CEPH_CLUSTER_NAME`، الذي يُوسم به كل مقياس بوصفه `ceph.cluster.name`. هذا العنقود هو **`ceph-1`**. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`؛ ولاحظ أن الاسم الجديد يسجّل عنقودًا جديدًا.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | لا | اسم حاوية المجمّع (الافتراضي: `oneuptime-ceph-agent`). يحتاج وكيل عنقود ثانٍ على الجهاز نفسه إلى أسماء خاصة به: يسمّي برنامج التثبيت النصي حاويات الوكيل الجديد باسم مجلده ما لم تضبطها بنفسك، ويحتفظ بها عند تشغيل البرنامج النصي مجددًا |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | لا | اسم حاوية وكيل الذكاء الاصطناعي (الافتراضي: `oneuptime-ceph-ai-agent`). يسمّي برنامج التثبيت النصي وكيل الذكاء الاصطناعي لعنقود ثانٍ باسم مجمّعه (`oneuptime-ceph-ai-agent-cluster2` بجوار `oneuptime-ceph-agent-cluster2`) ما لم تضبطه بنفسك، ويحتفظ به عند تشغيل البرنامج النصي مجددًا |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "يقرأ الوكيل الواحد عنقودًا واحدًا. ولعنقود ثانٍ، ثبّت وكيلًا ثانيًا في مجلد خاص به، مع أسماء حاويات خاصة به، إذ لا يمكن لحاويتين أن تتشاركا اسمًا:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "يسمّي البرنامج النصي الحاويات باسم المجلد، مثل `oneuptime-ceph-agent-cluster2`، ما لم تضبط متغيراتها، مثل `CEPH_AGENT_CONTAINER_NAME`. ويحتفظ بالأسماء في ملف `.env` الخاص بذلك الوكيل، لذا فإن تشغيل البرنامج النصي مجددًا بقيمة `INSTALL_DIR` نفسها لترقية الوكيل يُبقي عليها، والوكيل الذي عدّلت `container_name` الخاص به يومًا في `docker-compose.yml` يحتفظ بذلك الاسم.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "امنح كل مجلد اسمًا خاصًا به: يسمّي Docker Compose المشروع باسم مجلده وحده، لذا يرفض البرنامج النصي مجلدًا يحمل اسم مجلد آخر يشغّل وكيلًا في مكان آخر. مرّر المجلد إلى البرنامج النصي للتشخيص باستخدام `-d`.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | لا | اسم حاوية المجمّع (الافتراضي: `oneuptime-ceph-agent`). يحتاج وكيل عنقود ثانٍ على الجهاز نفسه إلى اسم خاص به |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | لا | اسم حاوية وكيل الذكاء الاصطناعي (الافتراضي: `oneuptime-ceph-ai-agent`). يحتاج وكيل عنقود ثانٍ على الجهاز نفسه إلى اسم خاص به |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "يقرأ الوكيل الواحد عنقودًا واحدًا. ولعنقود ثانٍ، أعدّ وكيلًا ثانيًا في مجلد خاص به، مع أسماء حاويات خاصة به، إذ لا يمكن لحاويتين أن تتشاركا اسمًا. اضبطها في ملف `.env` الخاص بذلك الوكيل:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "امنح كل مجلد اسمًا خاصًا به: يسمّي Docker Compose المشروع باسم مجلده وحده، لذا فإن مجلدًا ثانيًا بالاسم نفسه سيستبدل حاويات الوكيل الأول. لا تضع الأسماء في `docker-compose.yml`، الذي تستبدله الترقية.",
};

export default TRANSLATION;
