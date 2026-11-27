import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 أو أحدث مع إضافة Docker Compose v2، على جهاز يمكنه الوصول إلى عنوان الإدارة في FlashArray عبر HTTPS (المنفذ TCP 443)",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "حساب مسؤول على FlashArray، لإنشاء مستخدم الوكيل للقراءة فقط",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "أنشئ الرمز **بلا تاريخ انتهاء**، وإلا فسيتوقف الوكيل في اليوم الذي تنتهي فيه صلاحيته.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "اتصل بـ FlashArray عبر SSH بصفتك مسؤولًا. يطلب الأمر الأول كلمة مرور المستخدم الجديد؛ ويطبع الثاني رمز API الخاص به:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. افتح **Settings → Users and Policies** (أو **Settings → Access** في الإصدارات الأقدم).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. من القائمة ⋮ في لوحة **Users** اختر **Create User…**، وسمِّه `oneuptime` وامنحه الدور **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. من القائمة ⋮ للمستخدم الجديد اختر **Create API Token…**، واترك **Expires In** فارغًا، ثم انسخ الرمز.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "يعني ظهور سطر `purefa_info{...} 1` أن المصفوفة تقدم مقاييسها أصلًا: تابع. ويعني الرد **404** أن إصدار Purity//FA لديها أقدم (توثّق Pure نقطة النهاية الأصلية للإصدار 6.7.0 والأحدث؛ ويذكر إشعار الإيقاف الخاص بمُصدِّرها 6.6.11 والأحدث): اختر بدلًا من ذلك **FlashArray، إصدار Purity أقدم** في أعلى هذا الدليل.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "يُنزّل السطر الأول البرنامج النصي باسم `install.sh`، لتتمكن من قراءته قبل تشغيله.",
  "The command carries the platform you picked above. The script asks for:":
    "يحمل الأمر المنصة التي اخترتها أعلاه. ويسأل البرنامج النصي عن:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- **عنوان URL الخاص بـ OneUptime** إلى جانب **مفتاح الاستيعاب**، وكلاهما ظاهر في الخطوة 1 (اختر مفتاحًا هناك ليُملآ هنا)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- **اسم المصفوفة**: الاسم الذي تظهر به المصفوفة في OneUptime. امنح كل مصفوفة اسمها الخاص وأبقه ثابتًا: الاسم الجديد يسجّل مصفوفة تخزين جديدة",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- **عنوان الإدارة** في FlashArray (اسم المضيف أو IP، بلا `https://`) إلى جانب **رمز API** للمستخدم المخصص للقراءة فقط، ويقرؤه البرنامج النصي دون عرضه على الشاشة",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- ما إذا كان سيتحقق من شهادة المصفوفة: أجب بـ **N** ما لم تحمل المصفوفة شهادة من جهة إصدار CA تثق بها (تُشحن المصفوفات بشهادة موقّعة ذاتيًا)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "يُثبَّت في `/opt/oneuptime-storage-array-agent`، ويكتب ملف `.env` لا يقرؤه سواك (فيه رمز API)، ويشغّل الوكيل باستخدام Docker Compose.",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "نزّل ملف compose وملفات إعداد المجمّع من OneUptime هذا إلى مجلد جديد:",
  "Create a `.env` file next to them:": "أنشئ ملف `.env` بجوارهما:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- استبدل `my-storage-array` باسم لهذه المصفوفة، مثل `fa-prod-01`. بهذا الاسم تظهر المصفوفة في OneUptime، لذا أبقه ثابتًا: الاسم الجديد يسجّل مصفوفة تخزين جديدة.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- اضبط `PURE_FA_ENDPOINT` على عنوان الإدارة في FlashArray (اسم المضيف أو IP، بلا `https://`) و`PURE_FA_API_TOKEN` على رمز API للمستخدم المخصص للقراءة فقط. شغّل `chmod 600 .env`: فالملف يحوي الرمز.",
  "Start the agent:": "شغّل الوكيل:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "ابحث عن `Everything is ready. Begin running and processing data.` في السجلات. بعد أول عملية جمع تظهر المصفوفة تلقائيًا في قسم **مصفوفات التخزين**، عادةً خلال دقيقة أو دقيقتين.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "يكتب برنامج التثبيت النصي هذه القيم في `/opt/oneuptime-storage-array-agent/.env`؛ أما التثبيت باستخدام Docker Compose فيقرؤها من ملف `.env` بجوار `docker-compose.yml`. بعد تغيير أيٍّ منها، طبّقه باستخدام `docker compose up -d` في مجلد الوكيل.",
  "| Variable | Required | Description |": "| المتغير | مطلوب | الوصف |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | نعم | عنوان URL لمثيل OneUptime لديك (مثل `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | نعم | مفتاح استيعاب القياس عن بُعد، المفتاح الذي اخترته في الخطوة 1 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | نعم | الاسم الذي تُسجَّل به هذه المصفوفة في OneUptime. يُوسم به كل مقياس بوصفه سمة المورد `storage.array.name`. أبقه ثابتًا: تغييره يسجّل مصفوفة تخزين جديدة |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | لا | المنصة، وتُوسم بوصفها سمة المورد `storage.system`: `purestorage.flasharray` أو `purestorage.flashblade` (الافتراضي: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | لا | أي ملف إعداد مرفق يعمل: `otel-collector-config.yaml` (FlashArray، أصلي، وهو الافتراضي)، أو `otel-collector-config.flasharray-exporter.yaml` (FlashArray أقدم)، أو `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | لا | يشغّل المُصدِّر الذي يحتاجه الإعداد: فارغ لإعداد FlashArray الأصلي، و`flasharray-exporter` أو `flashblade` للبقية |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | عنوان الإدارة في FlashArray: اسم المضيف أو IP، بلا `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | رمز API لمستخدم FlashArray صاحب الدور readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | عنوان الإدارة في FlashBlade: اسم المضيف أو IP، بلا `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | رمز API لمستخدم FlashBlade صاحب الدور readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | لا | `true` يقبل شهادة المصفوفة الموقّعة ذاتيًا على نقطة النهاية الأصلية؛ و`false` يتحقق منها (الافتراضي: `true`). لا تتحقق مُصدِّرات Pure أبدًا من شهادة المصفوفة، لذا لا ينطبق عليها هذا المتغير |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- يقرأ المجمّع نقطة نهاية OpenMetrics الخاصة بـ FlashArray نفسه عبر HTTPS، مستخدمًا الرمز بوصفه بيانات اعتماد Bearer، دون تشغيل أي مُصدِّر.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **مهمة جمع واحدة لكل نقطة نهاية**، تُقرأ كلٌّ منها بالوتيرة التي تستحقها: `/metrics/array` كل 60 ثانية؛ و`/metrics/volumes` و`/metrics/hosts` و`/metrics/pods` كل دقيقتين؛ و`/metrics/directories` كل 30 دقيقة، لأن حساب مساحة الأدلة مكلف للمصفوفة.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **تضع كل مهمة على سلاسلها التسمية `scrape_endpoint: <endpoint>`**، ليعرف OneUptime أي الكائنات تمثّل الدفعة قائمتها الكاملة؛ وبهذا يغادر الكائن المحذوف الجرد. أبقِ التسميات كما شُحنت.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **يحتفظ زمن الاستجابة لكل وحدة تخزين ولكل مضيف بثلاثة أبعاد** (`usec_per_read_op`، `usec_per_write_op`، `usec_per_mirrored_write_op`)؛ وتُسقط قاعدة في `metric_relabel_configs` تفصيل QoS والطابور وSAN وزمن الخدمة، الذي يضاعف عدد السلاسل في المصفوفة الكبيرة. ويبقى التفصيل على مستوى المصفوفة كلها.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **بلا `send_batch_max_size`.** يعيد OneUptime بناء الجرد من عملية جمع كاملة واحدة، لذا لا يقسم المعالج `batch` أي عملية جمع.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "هذا هو ملف `otel-collector-config.yaml` الكامل الذي يشغّله الوكيل؛ ويوفّر الملف `.env` قيم `${env:...}`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "لا يرسل الوكيل سوى المقاييس إلى أن تشغّل مستقبِلات syslog فيه. تعيد المصفوفات توجيه تنبيهاتها وأحداث التدقيق فيها بصيغة syslog؛ ويسم الوكيل كل سطر بـ `storage.array.name`، فتصل إلى صفحة **السجلات** لهذه المصفوفة.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. في `otel-collector-config.yaml`، ألغِ التعليق عن المستقبِلين `syslog/tcp` و`syslog/udp` وعن خط المعالجة `logs`. لا تحمل الطوابع الزمنية في syslog بصيغة BSD الكلاسيكية منطقة زمنية: اضبط `location` على المنطقة الزمنية للمصفوفة ما لم تعمل ساعتها بتوقيت UTC.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. في `docker-compose.yml`، ألغِ التعليق عن كتلة `ports:` التي تنشر `5514/tcp` و`5514/udp`، وافتح المنفذ في جدار الحماية على الجهاز لشبكة إدارة المصفوفة.",
  "3. Apply both:": "3. طبّق الاثنين:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. على FlashArray، وبصفتك مسؤولًا، افتح **Settings → System → Syslog Servers**، وأضف `udp://<agent-host>:5514` (أو `tcp://<agent-host>:5514`) وأرسل رسالة اختبار.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "أي سمة مورد تبدأ بالبادئة `oneuptime.label.` تصبح تسمية مشروع على المصفوفة: `oneuptime.label.<dimension>=<value>` هي التسمية `<dimension>:<value>`. أضفها إلى المعالج `resource` في إعداد المجمّع الذي تستخدمه، بجوار `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "ثم أعد تشغيل المجمّع ليقرأ الإعدادات الجديدة:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "تظهر المصفوفة موسومةً بـ `team:storage` و`env:production`. تُطابق التسميات دون تمييز بين الأحرف الكبيرة والصغيرة، لذا يُعاد استخدام التسمية الموجودة `Production`؛ ولا يزيل الوكيل أبدًا التسميات المضافة في واجهة OneUptime.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "كل قيمة مقياسٌ لحظي يحسبه FlashArray بنفسه: زمن الاستجابة لكل عملية بالميكروثانية، والإنتاجية في الثانية. وعليها تُبنى صفحات مصفوفة التخزين في OneUptime وفهرس المقاييس وقوالب التنبيهات:",
  "| Endpoint | Data |": "| نقطة النهاية | البيانات |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **المصفوفة** (`/metrics/array`) | `purefa_info`، والسعة وتقليل البيانات (`purefa_array_space_*`)، والأداء، والتنبيهات المفتوحة (`purefa_alerts_open`)، ومكونات الأجهزة، ومحركات الأقراص، ووحدات التحكم، وواجهات الشبكة |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **وحدات التخزين** (`/metrics/volumes`) | زمن الاستجابة وIOPS وعرض النطاق والمساحة وتقليل البيانات لكل وحدة تخزين |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **المضيفون** (`/metrics/hosts`) | الاتصال، ووحدات التخزين المتصلة، وزمن الاستجابة، وIOPS، والمساحة لكل مضيف |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pods** (`/metrics/pods`) | تأخر روابط النسخ المتماثل في ActiveCluster وActiveDR، وحالة الوسيط، والأداء، والمساحة |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **الأدلة** (`/metrics/directories`) | مساحة الأدلة المُدارة في خدمات الملفات على FlashArray وأداؤها |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env`, and give each its own `container_name` in its `docker-compose.yml` (for example `oneuptime-storage-array-agent-fa02`) — two containers cannot share a name:":
    "يقرأ الوكيل الواحد مصفوفة واحدة. لمراقبة عدة مصفوفات من الجهاز نفسه، ثبّت كلًّا منها في مجلده الخاص مع ملف `.env` خاص به، وامنح كلًّا منها `container_name` خاصًا في ملف `docker-compose.yml` الخاص به (مثل `oneuptime-storage-array-agent-fa02`)، إذ لا يمكن لحاويتين أن تتشاركا اسمًا:",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "يأتي الوكيل مع وحدة systemd تفترض مجلد برنامج التثبيت النصي، `/opt/oneuptime-storage-array-agent`. لا يُنزّلها برنامج التثبيت النصي، لذا نزّلها بنفسك:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**ترقية**: صورة المجمّع مثبّتة في `docker-compose.yml` وملفات إعداده بجوارها، لذا فإن سحب الصورة وحده لا يحدّث الوكيل. شغّل برنامج التثبيت النصي مرة أخرى. فهو يعيد استخدام كل قيمة في ملف `.env` الحالي (لا يُسأل عن شيء مجددًا)، ويُنزّل أحدث `docker-compose.yml` وملفات إعداد المجمّع (يُحتفظ بالملف الذي عدّلته بجوار الجديد باسم `<file>.bak.<timestamp>`)، ويعيد إنشاء الوكيل بها:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "يحتاج الوكيل المثبّت خارج `/opt/oneuptime-storage-array-agent` (وكيل مصفوفة ثانية مثلًا) إلى مجلده: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "هل ثبّته باستخدام Docker Compose بدلًا من ذلك؟ في مجلد الوكيل، نزّل ملف compose وملفات إعداد المجمّع مرة أخرى؛ يبقى ملف `.env` لديك، أما التغيير الذي أجريته على أيٍّ منها فعليك إعادته:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "ثم اسحب الصور وأعد إنشاء الوكيل، ليقرأ المجمّع إعداداته الجديدة:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "تُبلغ الإعدادات عن إصدار المجمّع الذي تثبّته بوصفه **إصدار الوكيل** للمصفوفة. عندما يثبّت OneUptime هذا إصدارًا أحدث، تفتح علامة تحذير بجواره هذه الأوامر.",
  "**Uninstall** the agent:": "**إلغاء التثبيت** للوكيل:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "ثم احذف المستخدم المخصص للقراءة فقط ورمز API الخاص به على المصفوفة إن لم تعد بحاجة إليهما.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "يفحص `troubleshoot.sh` السلسلة بأكملها (بيئة تشغيل الحاويات، ونقطة نهاية المصفوفة تمامًا كما يصل إليها المجمّع، أي نقطة النهاية الأصلية أو مُصدِّر Pure مع DNS وTLS ورمز API، ووسم اسم المصفوفة، ومقاييس المجمّع نفسه) ويسأل OneUptime مباشرة عمّا إذا كان يقبل مفتاح الاستيعاب لديك. هذا الفحص الأخير هو الأهم: ترفض نقاط نهاية OTLP في OneUptime المفتاح الخاطئ بـ `401` أو `422`، وهو ما يسجّله المجمّع سطرًا واحدًا `Exporting failed` لكل دفعة يسهل أن يفوتك، لذا يطلب البرنامج النصي من `GET /otlp/v1/validate` حكمًا مباشرًا 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "وينتهي بحكم يسمّي السبب الأرجح.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. افحص سجلات المجمّع: `docker logs oneuptime-storage-array-agent`. يعني `server returned HTTP status 401` أن المصفوفة رفضت رمز API، ويعني `404` أن FlashArray لا يملك نقطة نهاية أصلية، ويعني `x509` أن التحقق من TLS مفعّل في مواجهة شهادة المصفوفة الموقّعة ذاتيًا، ويعني `no such host` أو `connection refused` أن `PURE_FA_ENDPOINT` خاطئ، ويعني `401` عند التصدير أن مفتاح الاستيعاب خاطئ.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. تأكد من ضبط `STORAGE_ARRAY_NAME`: يعتمد الاكتشاف على سمة المورد `storage.array.name`، ويرفض المجمّع البدء من دونها.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. تأكد من أن `STORAGE_ARRAY_COLLECTOR_CONFIG` و`COMPOSE_PROFILES` يسمّيان المنصة نفسها.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "لا يملك Purity//FA على هذا FlashArray نقطة نهاية OpenMetrics أصلية. اضبط `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` و`COMPOSE_PROFILES=flasharray-exporter` في `.env` وشغّل `docker compose up -d`، أو أعد تشغيل `install.sh` مع خيار Purity الأقدم. بعد ترقية المصفوفة إلى Purity//FA 6.7 أو أحدث، عُد إلى الإعداد الأصلي واحذف ملف التعريف.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "تحقّق من أنك لصقت الرمز لا كلمة مرور المستخدم؛ ومن أن المستخدم ما زال موجودًا ويحمل الدور readonly؛ ومن أن الرمز لم تنتهِ صلاحيته. أنشئ رمزًا جديدًا (`pureadmin create --api-token oneuptime` على FlashArray)، وضعه في `.env` بوصفه `PURE_FA_API_TOKEN` وشغّل `docker compose up -d`.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "تقدّم المصفوفات افتراضيًا شهادة موقّعة ذاتيًا لا تثق بها أي صورة Docker. اضبط `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (الخيار العملي على شبكة إدارة خاصة)، أو ثبّت على المصفوفة شهادة من جهة إصدار CA تثق بها صورة المجمّع.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "لا يعمل `pure-fa-exporter` أو `pure-fb-exporter`: يجب أن يطابق `COMPOSE_PROFILES` قيمة `STORAGE_ARRAY_COLLECTOR_CONFIG`، أي `flasharray-exporter` لإعداد مُصدِّر FlashArray، و`flashblade` لإعداد FlashBlade. صحّح `.env` وشغّل `docker compose up -d`؛ وبعدها يعرض `docker compose ps` المُصدِّر.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. تحقّق من أن الوكيل يعمل: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. افحص سجلات الوكيل بحثًا عن أخطاء: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. تحقّق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. تأكد من أن جهاز الوكيل يستطيع الوصول إلى مثيل OneUptime عبر الشبكة.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "تأتي هوية المصفوفة من `STORAGE_ARRAY_NAME`، الذي يُوسم به كل مقياس بوصفه `storage.array.name`. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في مجلد الوكيل؛ ولاحظ أن الاسم الجديد يسجّل مصفوفة تخزين جديدة.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "يسجّل المصفوفة باسم **`array-1`**، وهو الاسم الذي تحمله هذه المصفوفة في OneUptime بالفعل.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- هذا يثبّت الوكيل للمصفوفة **`array-1`**: أبقِ `STORAGE_ARRAY_NAME` كما هو تمامًا، وإلا فستُسجَّل البيانات مصفوفة تخزين جديدة.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "تأتي هوية المصفوفة من `STORAGE_ARRAY_NAME`، الذي يُوسم به كل مقياس بوصفه `storage.array.name`. هذه المصفوفة هي **`array-1`**. صحّحه في `.env` وطبّقه باستخدام `docker compose up -d` في مجلد الوكيل؛ ولاحظ أن الاسم الجديد يسجّل مصفوفة تخزين جديدة.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "يحمل الأمر بالفعل عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب والمنصة التي اخترتها أعلاه. ويسأل البرنامج النصي عن:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "إمكانية الوصول من ذلك الجهاز إلى `quay.io`، حيث يسحب Docker صورة مُصدِّر Pure",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- يشغّل `COMPOSE_PROFILES=flasharray-exporter` المُصدِّر `pure-fa-exporter` من Pure بجوار المجمّع؛ ويجب أن يتطابق الاثنان.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "يعرض `docker compose ps` في مجلد الوكيل أيضًا **`pure-fa-exporter`**، مُصدِّر Pure الذي يقرأ المجمّع FlashArray من خلاله.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- يقرأ المجمّع FlashArray من خلال `pure-fa-exporter`، مُصدِّر Pure، الذي يسجّل الدخول إلى REST API في FlashArray بالرمز الذي يرسله المجمّع مع كل عملية جمع. ويبقى منفذ المُصدِّر داخل شبكة compose.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 أو أحدث مع إضافة Docker Compose v2، على جهاز يمكنه الوصول إلى عنوان الإدارة في FlashBlade عبر HTTPS (المنفذ TCP 443)",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "حساب مسؤول على FlashBlade، لإنشاء مستخدم الوكيل للقراءة فقط",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "على FlashBlade، وبصفتك مسؤولًا، أنشئ مستخدمًا باسم `oneuptime` بالدور **readonly** (في إعدادات المستخدمين في واجهة FlashBlade الرسومية، أو باستخدام `pureadmin` في سطر أوامر Purity//FB) وأنشئ له **رمز API**. أنشئ الرمز **بلا تاريخ انتهاء**، وإلا فسيتوقف الوكيل في اليوم الذي تنتهي فيه صلاحيته.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "تبدأ رموز API في FlashBlade بـ `T-`. أما إصدار Purity//FB الذي لا يدعم المستخدمين المحليين فيأخذ بدلًا من ذلك حسابًا من خدمة دليل (LDAP أو Active Directory) تُربط مجموعته بالدور readonly.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- **عنوان الإدارة** في FlashBlade (اسم المضيف أو IP، بلا `https://`) إلى جانب **رمز API** للمستخدم المخصص للقراءة فقط، ويقرؤه البرنامج النصي دون عرضه على الشاشة",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- اضبط `PURE_FB_ENDPOINT` على عنوان الإدارة في FlashBlade (اسم المضيف أو IP، بلا `https://`) و`PURE_FB_API_TOKEN` على رمز API للمستخدم المخصص للقراءة فقط. شغّل `chmod 600 .env`: فالملف يحوي الرمز.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "يعرض `docker compose ps` في مجلد الوكيل أيضًا **`pure-fb-exporter`**، مُصدِّر Pure الذي يقرأ المجمّع FlashBlade من خلاله.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- يقرأ المجمّع FlashBlade من خلال `pure-fb-exporter`، مُصدِّر Pure، الذي يسجّل الدخول إلى REST API في FlashBlade بالرمز الذي يرسله المجمّع مع كل عملية جمع. ويبقى منفذ المُصدِّر داخل شبكة compose.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **مهمة جمع واحدة لكل نقطة نهاية**، تُقرأ كلٌّ منها بالوتيرة التي تستحقها: `/metrics/array` كل 60 ثانية؛ و`/metrics/filesystems` و`/metrics/objectstore` كل 5 دقائق، لأن REST API في FlashBlade ليس مصممًا للإبلاغ السريع عن كل نظام ملفات وكل حاوية تخزين.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. على FlashBlade، وبصفتك مسؤولًا، أضف خادم syslog بالعنوان `udp://<agent-host>:5514` (أو `tcp://`) في إعدادات syslog الخاصة به.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "كل قيمة مقياسٌ لحظي يحسبه FlashBlade بنفسه: زمن الاستجابة لكل عملية بالميكروثانية، والإنتاجية في الثانية. وعليها تُبنى صفحات مصفوفة التخزين في OneUptime وفهرس المقاييس وقوالب التنبيهات:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **المصفوفة** (`/metrics/array`) | `purefb_info`، والسعة وتقليل البيانات (`purefb_array_space_*`)، والأداء لكل بروتوكول، والتنبيهات المفتوحة (`purefb_alerts_open`)، وسلامة الأجهزة (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **أنظمة الملفات** (`/metrics/filesystems`) | المساحة وتقليل البيانات والأداء لكل نظام ملفات |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **مخزن الكائنات** (`/metrics/objectstore`) | المساحة والحصة وعدد الكائنات والأداء لكل حاوية تخزين |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 أو أحدث مع إضافة Docker Compose v2، على جهاز يصل إلى كل عقد العنقود عبر UDP 161 (SNMP)",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "حساب مسؤول على العنقود، لتفعيل SNMP وضبط مجتمع الوكيل للقراءة فقط أو مستخدم SNMPv3 الخاص به",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "اتصل بأي عقدة عبر SSH بصفتك مسؤولًا: تطبّق OneFS إعدادات SNMP على العنقود كله. إذا كان العنقود يجيب أصلًا عن طلبات SNMP لأداة أخرى، فامنح الوكيل المجتمع نفسه أو المستخدم نفسه وتخطَّ هذه الخطوة. وإلا ففعّل SNMP v2c بمجتمع خاص بك للقراءة فقط، لا بالمجتمع الافتراضي في OneFS وهو `I$ilonpublic`:",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "أو فعّل SNMPv3، الذي يصادق كل استطلاع ويشفّره. لدى OneFS مستخدم SNMPv3 واحد للقراءة فقط، اسمه `general` إلى أن تغيّره: امنحه كلمات مرور من ثمانية أحرف على الأقل، بلا مسافات:",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "يعرض `isi snmp settings view` الإعدادات، مع بروتوكولَي المصادقة والخصوصية للمستخدم. اسمح بحركة UDP 161 من جهاز الوكيل إلى كل عقدة، واعرض عناوين العقد بالأمر `isi network interfaces list`.",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- **عناوين كل العقد**، مفصولة بفواصل: العنوان الخاص بكل عقدة، وليس اسم منطقة SmartConnect أبدًا، لأن العقدة لا تجيب إلا عن محركات أقراصها وحساساتها ومنافذها",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- **إصدار SNMP**، ثم **المجتمع** المخصص للقراءة فقط، أو **مستخدم** SNMPv3 وكلمتَي المرور الخاصتين به، ويقرأ البرنامج النصي كلًّا منها دون عرضه على الشاشة",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "المستخدم الذي لا تكون بروتوكولاته SHA وAES يحتاج إلى `POWERSCALE_SNMP_AUTH_PROTOCOL` و`POWERSCALE_SNMP_PRIVACY_PROTOCOL` قبل `bash install.sh`، والمستخدم بلا خصوصية يحتاج إلى `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "يُثبَّت في `/opt/oneuptime-storage-array-agent`، ويكتب ملف `.env` لا يقرؤه سواك (فيه المجتمع أو كلمات مرور SNMPv3)، مع استطلاع واحد لكل عقدة، ويشغّل الوكيل باستخدام Docker Compose. وعندما تنضم عقدة إلى العنقود، أضف عنوانها إلى `POWERSCALE_NODES` في ذلك الملف وشغّل `bash install.sh` مجددًا.",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- استبدل `my-storage-array` باسم لهذا العنقود، مثل `ps-prod`. بهذا الاسم يظهر العنقود في OneUptime، لذا أبقه ثابتًا: الاسم الجديد يسجّل مصفوفة تخزين جديدة.",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- أدرج كل عقدة في `POWERSCALE_NODES` وامنح كلًّا منها `POWERSCALE_NODE_<n>` الخاص بها و`snmp/node-<n>` الخاص بها في `POWERSCALE_SNMP_RECEIVERS`، حتى 252، بعد `snmp/cluster` و`snmp/quotas`. ويُكتب عنوان IPv6 بين قوسين معقوفين، مثل `[fd00::11]`.",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- في SNMPv3، اضبط `POWERSCALE_SNMP_VERSION=v3` و`POWERSCALE_SNMP_USER` و`POWERSCALE_SNMP_AUTH_PASSWORD` و`POWERSCALE_SNMP_PRIVACY_PASSWORD` بدلًا من المجتمع. شغّل `chmod 600 .env`: فالملف يحوي المجتمع أو كلمات المرور.",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | نعم | الاسم الذي يُسجَّل به هذا العنقود في OneUptime، ويُوسم به كل مقياس بوصفه `storage.array.name`. أبقه ثابتًا: تغييره يسجّل مصفوفة تخزين جديدة |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | نعم | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | نعم | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | نعم | عناوين كل العقد، مفصولة بفواصل. ومنها يكتب برنامج التثبيت النصي الاستطلاعات أدناه |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | نعم | العقدة التي تُقرأ عبرها صحة العنقود نفسه وسعته وحصصه: الأولى في `POWERSCALE_NODES` |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | نعم | الاستطلاعات التي يشغّلها المجمّع: `snmp/cluster` و`snmp/quotas`، ثم `snmp/node-<n>` لكل عقدة |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | نعم | عنوان العقدة `<n>`، من 1 إلى 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | لا | `v2c` (الافتراضي) أو `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | مجتمع العنقود المخصص للقراءة فقط |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | مستخدم SNMPv3 للعنقود المخصص للقراءة فقط |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | لا | `auth_priv` (الافتراضي) أو `auth_no_priv` أو `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | لا | `SHA` (الافتراضي) أو `MD5` أو `SHA224` أو `SHA256` أو `SHA384` أو `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | كلمة مرور المصادقة لمستخدم SNMPv3 |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | لا | `AES` (الافتراضي) أو `DES` أو `AES192` أو `AES256` أو `AES192C` أو `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | كلمة مرور الخصوصية لمستخدم SNMPv3 |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **مجمّع واحد، بلا مُصدِّر.** يقرأ مستقبِل SNMP الخاص بالمجمّع ISILON-MIB من Dell؛ ولا يعمل بجانبه أي شيء آخر.",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **كائنات العنقود مرة واحدة، عبر `POWERSCALE_ENDPOINT`:** صحته وسعته وإنتاجيته وأعداد عقده كل 60 ثانية (`snmp/cluster`)، وSmartQuotas الخاصة به كل 5 دقائق (`snmp/quotas`).",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **كائنات كل عقدة من العقدة نفسها:** صحتها وCPU وأداء البروتوكولات ومحركات الأقراص والحساسات والمنافذ كل 60 ثانية (`snmp/node-<n>`).",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **يضع كل استطلاع على سلاسله التسمية `scrape_endpoint: <poll>`**، ليعرف OneUptime أي الكائنات تمثّل الدفعة قائمتها الكاملة؛ وبهذا تغادر الحصة المحذوفة الجرد. أبقِ التسميات كما شُحنت.",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "الإعداد الكامل، بمستقبِل SNMP واحد لكل خانة عقدة، هو `otel-collector-config.powerscale.yaml` في مجلد الوكيل:",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "ثم أوقف SNMP على العنقود، أو غيّر مجتمع الوكيل أو كلمات مرور SNMPv3 الخاصة به، إن لم يكن شيء آخر يستطلعه.",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "يفحص `troubleshoot.sh` السلسلة بأكملها (بيئة تشغيل الحاويات، وعناوين العقد والمجتمع أو مستخدم SNMPv3 في `.env`، وكل عقدة عبر `snmpget` إن وُجد على الجهاز، ووسم اسم المصفوفة، ومقاييس المجمّع نفسه) ويسأل OneUptime مباشرة عمّا إذا كان يقبل مفتاح الاستيعاب لديك.",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "يشير `Error scraping metrics` مع `request timeout` في `docker logs oneuptime-storage-array-agent` إلى عقدة لا تجيب عن طلبات SNMP من هذا الجهاز: SNMP متوقف للإصدار الذي يستخدمه الوكيل، أو المجتمع أو مستخدم SNMPv3 ليس للعنقود، أو المنفذ UDP 161 محجوب في الطريق. والعقدة التي تجيب لكنها غائبة عن عقد العنقود ليست في `POWERSCALE_NODES`: أضفها وشغّل `bash install.sh` مجددًا.",
};

export default TRANSLATION;
