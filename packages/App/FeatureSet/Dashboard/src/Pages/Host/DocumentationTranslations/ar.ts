import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker مثبّت على المضيف الذي تريد مراقبته",
  "Network access from the host to your OneUptime instance":
    "وصول شبكي من المضيف إلى مثيل OneUptime الخاص بك",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "احفظ هذا باسم `config.yaml` في الدليل الذي ستشغّل منه `docker run` — تركّبه الخطوة 3 في الحاوية.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "تتيح `--network host` و`--pid host` وربط `/hostfs` لكاشطَي `hostmetrics` و`process` قراءة معلومات المعالج والذاكرة والقرص وكل عملية من نواة المضيف بدلًا من الحاوية. ودونها لن ترى إلا مقاييس حاوية المجمّع نفسها.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "افتح قائمة **المضيفون** في OneUptime — يظهر مضيفك تلقائيًا ما إن تصل أول دفعة من المقاييس (عادةً خلال 30 ثانية). ليس هناك؟ تحقّق من المجمّع:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا** لكل مضيف: ما إن يعمل وكيل الذكاء الاصطناعي الخاص بالمضيف عليه حتى يحقّق OneUptime AI هناك في الحوادث والتنبيهات بأوامر للقراءة فقط مثل `systemctl status` و`df -h` و`free -m` و`ps aux`، ولا يغيّر شيئًا ما لم تسمح بالإصلاحات. وهو حاوية Linux لها برنامج تثبيت خاص بها، لذا أضفه على مضيفات Linux فقط؛ ويحتاج إلى Docker (محرّك النظام، لا Docker دون جذر) مع إضافة Compose:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "ينزّل السطر الأول البرنامج النصي باسم `install.sh` لتتمكن من قراءته قبل تشغيله. يسأل عن عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب واسم المضيف — اترك الاسم فارغًا لاستخدام اسم المضيف، وهو ما يُبلغ عنه هذا المجمّع. وما إن يتصل حتى يظهر متصلًا في صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف وفي أسفل **نظرة عامة**. ما الذي يمكنه تشغيله وكيف تعمل الإصلاحات: [وكلاء الذكاء الاصطناعي للبنية التحتية](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "يملأ الإعداد بالفعل عناوين IP وعناوين MAC والمعمارية ومعرّف الجهاز ووصف نظام التشغيل وإصداره في عنصر الجهاز ضمن **الجرد**، وهو ما يقرؤه تصدير CMDB. أما الرقم التسلسلي والشركة المصنّعة والطراز وإصدار البرنامج الثابت (BIOS / UEFI) فأمرها مختلف: **لا يستطيع أي كاشف موارد الحصول عليها.** فهي تأتي من البرنامج الثابت للجهاز عبر DMI. اقرأها مرة واحدة عند التجهيز واختمها على المورد — أضف هذا المعالج إلى ملف `config.yaml` الذي ركّبته في الحاوية وسمِّه في مسار معالجة المقاييس. ادمجه في الأقسام الموجودة أصلًا في إعدادك — لا تُضف مفتاح `processors:` أو `service:` ثانيًا.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "ثم أعد إنشاء الحاوية لتقرأ الملف المعدّل — احذفها وشغّل أمر `docker run` من الخطوة 3 مجددًا:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "هذه القيم خاصة بالجهاز نفسه، لذا يكتبها مرة واحدة ما يجهّزه. على Linux اقرأها بصلاحيات root (يستطيع أي أحد قراءة `bios_version`):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "في غضون دقائق تظهر القيم في عنصر الجهاز ضمن **الجرد** تحت **التفاصيل**. وهي مختومة لا مكتشفة، فأعد تشغيل هذا بعد استبدال اللوحة الأم أو تحديث البرنامج الثابت.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "تُقبل `host.manufacturer` و`host.model.name` و`host.firmware.version` و`host.bios.version` تهجئاتٍ بديلة وتُحفظ تحت مفاتيح `device.*` أعلاه (و`device.serial_number` تحت `host.serial_number`)، فينتهي إعدادٌ كُتب بأي الطريقتين في مكان واحد.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **لا تضبط `device.manufacturer` من الإعداد نفسه على مورد تطبيق جوّال وعلى مورد مضيف معًا.** فعلى مورد لا يحمل `host.name` ولا `host.id`، يظل `device.manufacturer` يَسِم الدفعة بأنها مراقبة مستخدمين حقيقيين (Real User Monitoring) للجوّال.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "كل سمة مورد تبدأ بالبادئة `oneuptime.label.` تُرقّى إلى تسمية مشروع وتُرفق بالمضيف (وبخدمة القياس عن بُعد التي يُصدرها هذا المجمّع). النمط: `oneuptime.label.<dimension>=<value>` يصبح تسمية اسمها `<dimension>:<value>`.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "أضف معالج `resource` إلى ملف `config.yaml` الذي ركّبته في الحاوية وأشِر إليه من مسار معالجة المقاييس. ادمجه في الأقسام الموجودة أصلًا في إعدادك — لا تُضف مفتاح `processors:` أو `service:` ثانيًا.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "يظهر المضيف موسومًا بـ `team:payments` و`env:production` و`region:us-east-1`. وتُطابَق التسميات دون تمييز بين الأحرف الكبيرة والصغيرة، لذا يُعاد استخدام تسمية `Production` موجودة أُنشئت يدويًا بدلًا من تكرارها. ولا يزيل المجمّع أبدًا التسميات المضافة يدويًا في واجهة OneUptime.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "تُكتشف المضيفات تلقائيًا من سمة مورد OTel `host.name`، التي يضبطها المعالج `resourcedetection`. ويسجّل OneUptime المضيف ما إن تحمل دفعةٌ فيها `host.name` أيضًا أيًّا مما يلي:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- مقاييس المستقبِل `hostmetrics` (المعالج، الذاكرة، القرص، نظام الملفات، الشبكة، الحمل، العمليات)، أو",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- مقاييس الكاشط `process` (المعالج/الذاكرة/الخيوط لكل عملية)، أو",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- سمة مورد `os.type` أو `container.runtime`، على المقاييس أو السجلات أو التتبعات",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…ويبدأ في ملء علامات التبويب نظرة عامة والمقاييس والعمليات والسجلات. لا تسجّل `host.id` أو `host.arch` وحدها مضيفًا، والقياس عن بُعد الذي يحمل هوية Kubernetes (`k8s.cluster.name` و`k8s.node.name` و`k8s.pod.name`، …) يُصنَّف بدلًا من ذلك تحت عنقود Kubernetes الخاص به.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**يعمل على OpenStack؟** استخدم `detectors: [nova, system, env]` ليكون `host.id` هو UUID المثيل ويربط OneUptime هذا المضيف بمثيله، واضبط `host.name` على `enabled: false` تحت `nova: resource_attributes:` ليبقى اسمه هو ما يُبلغ عنه `system`.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "تصبح سمات المورد نفسها عنصر الجهاز ضمن **الجرد**، وهو ما يقرؤه تصدير CMDB. تأتي `host.ip` و`host.mac` و`host.arch` و`host.id` و`os.type` و`os.description` و`os.version` كلها من المعالج `resourcedetection`؛ أما الرقم التسلسلي والشركة المصنّعة والطراز وإصدار البرنامج الثابت فلا كاشف لها وتُختم على حدة (راجع **سجّل الرقم التسلسلي والشركة المصنّعة والطراز وإصدار البرنامج الثابت**).",
  "Once the host is reporting:": "ما إن يبدأ المضيف الإبلاغ:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- تعرض علامة التبويب **المقاييس** السلاسل الزمنية `system.*`.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- تسرد علامة التبويب **العمليات** العمليات مرتّبة حسب المعالج ما إن يُفعَّل الكاشط `process`.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- تعرض علامة التبويب **السجلات** مباشرةً كل السجلات التي تتضمن سمات موردها `host.name`.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "يُبلغ الإعداد عن إصدار المجمّع الذي كُتب له (`oneuptime.agent.version`) بوصفه **إصدار الوكيل** للمضيف. وحين يثبّت OneUptime هذا إصدارًا أحدث، تفتح علامة تحذير بجواره هذه الخطوات.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. احفظ الإعداد من الخطوة 2 مجددًا بمفتاح الاستيعاب نفسه: فهو يُبلغ عن الإصدار الجديد. انقل إليه أي تغيير أجريته على إعدادك.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. في المجلد الذي يحتويه، ثبّت الإصدار الجديد وأعد تشغيل المجمّع:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. اقرأ سجلات المجمّع بحثًا عن أخطاء التصدير: `docker logs -f otel-collector`. يعني HTTP `401` أن المفتاح مفقود أو خاطئ أو منتهي الصلاحية؛ ويعني `422` أنه معطّل (أو أنه مفتاح متصفح لا يستطيع إرسال القياس عن بُعد للمضيف). اختر مفتاحًا يعمل في الخطوة 1 وحدّث `x-oneuptime-token` في ملف `config.yaml` الذي ركّبته في الحاوية.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. تحقّق من أن المضيف يصل إلى OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` من الجهاز نفسه.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. أبقِ `resourcedetection` في مسار معالجة المقاييس — فهو يضبط `host.name`، وبه يتعرّف OneUptime على المضيف.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "يقرأ المجمّع منظور النواة من داخل حاويته. شغّله مع `--network host` و`--pid host` وربط `/:/hostfs` ومتغيرات `HOST_*` كما تعرضها الخطوة 3 تمامًا — فدونها لا يرى كاشطا `hostmetrics` و`process` إلا حاوية المجمّع نفسها.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "مضيف Debian أو Ubuntu (amd64 أو arm64) مع `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "احفظ هذا باسم `config.yaml` في الدليل الحالي — تثبّته الخطوة 3.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **ملاحظة للتثبيتات الأصلية:** بخلاف Docker، يقرأ التثبيت عبر الحزمة `/proc` و`/sys` مباشرةً — دون حاجة إلى متغيرات البيئة `HOST_PROC` ولا إلى ربط `/hostfs`. وتعمل وحدة systemd المرفقة بالحزمة بالمستخدم غير المميّز `otelcol-contrib`؛ وإن أردت أن يرى الكاشط `process` عمليات المستخدمين الآخرين، فامنحه `CAP_SYS_PTRACE` أو شغّله بصلاحيات root.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "تضم `otelcol-contrib` المستقبِل `systemd` منذ **v0.142.0**؛ شغّل **v0.143.0 أو أحدث**، فيه استقر مقياس المعالج على اسمه الحالي وتوقف عن الاستعلام عن الوحدات التي ليست خدمات. فعّله بإضافته إلى `/etc/otelcol-contrib/config.yaml` وإلى مسار معالجة المقاييس. ادمجه في الأقسام الموجودة أصلًا في إعدادك — لا تُضف مفتاح `processors:` أو `service:` ثانيًا.",
  "Then restart the service:": "ثم أعد تشغيل الخدمة:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "المستقبِل **لـ Linux فقط** وفي مرحلة **ألفا**. يقرأ حالة الوحدات عبر D-Bus النظام بالاستدعاءات نفسها للقراءة فقط التي يستخدمها `systemctl list-units`، والتي يسمح بها systemd دون امتيازات، لذا لا تحتاج خدمة الحزمة — التي تعمل بالمستخدم `otelcol-contrib` — إلى أي صلاحيات إضافية. لا يستطيع مجمّع يعمل في حاوية الوصول إلى ناقل المضيف، فاستخدم تثبيتًا أصليًا. وما إن تصل المقاييس حتى تمتلئ علامة التبويب **وحدات Systemd** للمضيف بكل وحدة مجمّعة وحالتها الحالية (`active` و`failed` و`inactive`، ...).",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "تكلّف كل وحدة ثماني نقاط بيانات في كل كشط لمجموعة الحالات، واثنتين أخريين إن تركت مقياس المعالج مفعّلًا، لذا على مضيف فيه مئات الوحدات ضيّق `units:` أو ارفع `collection_interval` بدلًا من كشط كل شيء.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا** لكل مضيف: ما إن يعمل وكيل الذكاء الاصطناعي الخاص بالمضيف عليه حتى يحقّق OneUptime AI هناك في الحوادث والتنبيهات بأوامر للقراءة فقط مثل `systemctl status` و`df -h` و`free -m` و`ps aux`، ولا يغيّر شيئًا ما لم تسمح بالإصلاحات. وهو حاوية Linux لها برنامج تثبيت خاص بها؛ ويحتاج إلى Docker (محرّك النظام، لا Docker دون جذر) مع إضافة Compose:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "يملأ الإعداد بالفعل عناوين IP وعناوين MAC والمعمارية ومعرّف الجهاز ووصف نظام التشغيل وإصداره في عنصر الجهاز ضمن **الجرد**، وهو ما يقرؤه تصدير CMDB. أما الرقم التسلسلي والشركة المصنّعة والطراز وإصدار البرنامج الثابت (BIOS / UEFI) فأمرها مختلف: **لا يستطيع أي كاشف موارد الحصول عليها.** فهي تأتي من البرنامج الثابت للجهاز عبر DMI، ومجمّع الحزمة يعمل دون امتيازات فلا يستطيع قراءتها بنفسه. اقرأها مرة واحدة عند التجهيز واختمها على المورد — أضف هذا المعالج إلى `/etc/otelcol-contrib/config.yaml` وسمِّه في مسار معالجة المقاييس. ادمجه في الأقسام الموجودة أصلًا في إعدادك — لا تُضف مفتاح `processors:` أو `service:` ثانيًا.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "أضف معالج `resource` إلى `/etc/otelcol-contrib/config.yaml` وأشِر إليه من مسار معالجة المقاييس. ادمجه في الأقسام الموجودة أصلًا في إعدادك — لا تُضف مفتاح `processors:` أو `service:` ثانيًا.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- تسرد علامة التبويب **وحدات Systemd** حالة الوحدات ما إن يُفعَّل المستقبِل `systemd` (راجع **فعّل علامة التبويب «وحدات Systemd»**).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. اقرأ سجلات المجمّع بحثًا عن أخطاء التصدير: `sudo journalctl -u otelcol-contrib -f`. يعني HTTP `401` أن المفتاح مفقود أو خاطئ أو منتهي الصلاحية؛ ويعني `422` أنه معطّل (أو أنه مفتاح متصفح لا يستطيع إرسال القياس عن بُعد للمضيف). اختر مفتاحًا يعمل في الخطوة 1 وحدّث `x-oneuptime-token` في `/etc/otelcol-contrib/config.yaml`.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. أبقِ `resourcedetection` في مسار معالجة المقاييس نفسه الذي فيه المستقبِل `systemd` — فالمستقبِل لا يُلحق بكل وحدة إلا `systemd.unit.name`، لذا لا ترتبط العيّنات بالمضيف أبدًا دون `host.name`.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. شغّل `otelcol-contrib` بالإصدار v0.143.0 أو أحدث: الإصدارات الأقدم تتوقف عند البدء بالرسالة `'receivers' unknown type: \"systemd\"`، أو تسمّي مقياس المعالج باسم آخر (راجع **فعّل علامة التبويب «وحدات Systemd»**).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. تحقّق من أن المجمّع يصل إلى D-Bus النظام: يجب أن يوجد `/run/dbus/system_bus_socket`، وتشغيل `systemctl list-units` بمستخدم المجمّع هو أسرع اختبار. لا حاجة إلى root.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "مضيف RHEL أو CentOS أو Fedora أو Amazon Linux (x86_64 أو aarch64) مع `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "مضيف Linux (x86_64 أو aarch64) يشغّل systemd، مع `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "ضع وحدة systemd في `/etc/systemd/system/otelcol-contrib.service`:",
  "Then enable and start it:": "ثم فعّلها وشغّلها:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "استخدم هذا حين لا تتوفر الحزم — خوادم مقيّدة، أو صور أساسية لحاويات تريد قياسها من الخارج. لا حاجة إلى متغيرات البيئة `HOST_PROC` ولا إلى ربط `/hostfs`: يقرأ المجمّع حالة النواة مباشرةً، ويتيح `User=root` للكاشط `process` رؤية عمليات المستخدمين الآخرين (ومنحه `CAP_SYS_PTRACE` يفي بالغرض أيضًا).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "المستقبِل **لـ Linux فقط** وفي مرحلة **ألفا**. يقرأ حالة الوحدات عبر D-Bus النظام بالاستدعاءات نفسها للقراءة فقط التي يستخدمها `systemctl list-units`، والتي يسمح بها systemd دون امتيازات، لذا لا يحتاج إلى أي صلاحيات إضافية. لا يستطيع مجمّع يعمل في حاوية الوصول إلى ناقل المضيف، فاستخدم تثبيتًا أصليًا. وما إن تصل المقاييس حتى تمتلئ علامة التبويب **وحدات Systemd** للمضيف بكل وحدة مجمّعة وحالتها الحالية (`active` و`failed` و`inactive`، ...).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "يملأ الإعداد بالفعل عناوين IP وعناوين MAC والمعمارية ومعرّف الجهاز ووصف نظام التشغيل وإصداره في عنصر الجهاز ضمن **الجرد**، وهو ما يقرؤه تصدير CMDB. أما الرقم التسلسلي والشركة المصنّعة والطراز وإصدار البرنامج الثابت (BIOS / UEFI) فأمرها مختلف: **لا يستطيع أي كاشف موارد الحصول عليها.** فهي تأتي من البرنامج الثابت للجهاز عبر DMI. اقرأها مرة واحدة عند التجهيز واختمها على المورد — أضف هذا المعالج إلى `/opt/otelcol-contrib/config.yaml` وسمِّه في مسار معالجة المقاييس. ادمجه في الأقسام الموجودة أصلًا في إعدادك — لا تُضف مفتاح `processors:` أو `service:` ثانيًا.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "جهاز Mac (Apple silicon أو Intel) وحساب مسؤول لـ `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "أنشئ `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:",
  "Load it:": "حمّله:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **ثبّت إصدار contrib كما في الأعلى.** إصدار core المسمّى `otelcol` لا يحوي المعالج `resourcedetection`، لذا يرفض البدء بهذا الإعداد.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "يملأ الإعداد بالفعل عناوين IP وعناوين MAC والمعمارية ومعرّف الجهاز ووصف نظام التشغيل وإصداره في عنصر الجهاز ضمن **الجرد**، وهو ما يقرؤه تصدير CMDB. أما الرقم التسلسلي والشركة المصنّعة والطراز وإصدار البرنامج الثابت (BIOS / UEFI) فأمرها مختلف: **لا يستطيع أي كاشف موارد الحصول عليها.** فهي تأتي من البرنامج الثابت للجهاز. اقرأها مرة واحدة عند التجهيز واختمها على المورد — أضف هذا المعالج إلى `/etc/otelcol-contrib/config.yaml` وسمِّه في مسار معالجة المقاييس. ادمجه في الأقسام الموجودة أصلًا في إعدادك — لا تُضف مفتاح `processors:` أو `service:` ثانيًا.",
  "Then restart the collector:": "ثم أعد تشغيل المجمّع:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "هذه القيم خاصة بالجهاز نفسه، لذا يكتبها مرة واحدة ما يجهّزه. على Mac اقرأها هكذا — الشركة المصنّعة هي `Apple Inc.`:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` هو *معرّف* الطراز (`MacBookPro18,3`)، لا اسمه التجاري. ضعه مع ذلك في `device.model.name` — فـ `device.model.identifier` يَسِم الدفعة بأنها تطبيق جوّال.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ أو Windows Server 2019+ (لأجل `tar.exe` المدمج)",
  "An elevated PowerShell prompt (Run as administrator)":
    "موجّه PowerShell بصلاحيات مرتفعة (التشغيل كمسؤول)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "احفظ هذا باسم `config.yaml` في المجلد الذي ستشغّل منه أوامر PowerShell — تنسخه الخطوة 3 إلى مكانه.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "على Windows، ثبّت المجمّع الأصلي **`otelcol-contrib`** — فمنذ **v0.155.0** يضم المستقبِل `windows_service` الذي يغذّي علامة التبويب **الخدمات** للمضيف. شغّل من موجّه PowerShell بصلاحيات مرتفعة:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **ملاحظة:** تعمل الخدمة بحساب `LocalSystem` لتتمكن من قراءة كل خدمات Windows. وعلى Windows لا يفعل الكاشط `load` سوى محاكاة متوسط الحمل من العدّاد *Processor Queue Length* (يبدأ من 0)؛ وإن لم يستطع قراءة العدّاد سُجّل ذلك وتُخطّي، ويعمل باقي إعداد `hostmetrics` في المجمّع دون تغيير. وتغطي [وثائق OpenTelemetry Collector للمضيف](/docs/telemetry/host-otel-collector) أيضًا برنامج التثبيت الموقّع `.msi`.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "تُكتب السجلات في سجل أحداث التطبيقات في Windows؛ اعرضها في **Event Viewer → Windows Logs → Application** (المصدر `otelcol-contrib`).",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "منذ **v0.155.0** يضم `otelcol-contrib` المستقبِل `windows_service` — فعّله بإضافته إلى `C:\\Program Files\\otelcol-contrib\\config.yaml` وإلى مسار معالجة المقاييس. ادمجه في الأقسام الموجودة أصلًا في إعدادك — لا تُضف مفتاح `processors:` أو `service:` ثانيًا.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "المستقبِل **لـ Windows فقط** وفي مرحلة **ألفا**. وما إن تصل المقاييس حتى تمتلئ علامة التبويب **الخدمات** للمضيف تلقائيًا بحالة تشغيل كل خدمة ونوع بدئها.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "يملأ الإعداد بالفعل عناوين IP وعناوين MAC والمعمارية ومعرّف الجهاز ووصف نظام التشغيل وإصداره في عنصر الجهاز ضمن **الجرد**، وهو ما يقرؤه تصدير CMDB. أما الرقم التسلسلي والشركة المصنّعة والطراز وإصدار البرنامج الثابت (BIOS / UEFI) فأمرها مختلف: **لا يستطيع أي كاشف موارد الحصول عليها.** فهي تأتي من البرنامج الثابت للجهاز عبر WMI.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "شغّل هذا من موجّه PowerShell بصلاحيات مرتفعة على الجهاز — فهو يستعلم WMI ويطبع YAML الدقيق *لهذا* الجهاز:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "يطبع إدخال معالج واحدًا مُزاحًا بالفعل. أضفه داخل كتلة `processors:` الموجودة أصلًا في `config.yaml` — بجوار `resourcedetection:` و`resource:` و`batch:`، لا مفتاح `processors:` ثانيًا — ثم سمِّه في مسار معالجة المقاييس:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "استخدم `Get-CimInstance`، لا `Get-WmiObject` المهمل — فهو غير موجود في PowerShell 7 وما بعده. تُطبع القيم بين علامتَي اقتباس مفردتين مع مضاعفة أي علامة اقتباس بداخلها، فيبقى الرقم التسلسلي أو الطراز الذي فيه علامات ترقيم YAML صالحًا. والحقل الذي يتركه البرنامج الثابت فارغًا يُطبع `''`؛ احذف تلك السمة بدلًا من إرسال سمة فارغة.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "في غضون دقائق يعرض عنصر الجهاز ضمن **الجرد** تحت **التفاصيل** كلًّا من `host.serial_number` و`device.manufacturer` و`device.model.name` و`device.firmware.version`، بجوار عناوين IP وMAC ومعرّف الجهاز التي يوفّرها الكاشف بالفعل. أعد تشغيل هذا بعد استبدال اللوحة الأم أو تحديث BIOS — فالقيم مختومة لا مكتشفة، لذا لا تتحدّث من تلقاء نفسها.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- تسرد علامة التبويب **الخدمات** حالة كل خدمة ما إن يُفعَّل المستقبِل `windows_service` (راجع **فعّل علامة التبويب «خدمات Windows»**).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. اقرأ سجلات المجمّع بحثًا عن أخطاء التصدير: **Event Viewer → Windows Logs → Application** (المصدر `otelcol-contrib`). يعني HTTP `401` أن المفتاح مفقود أو خاطئ أو منتهي الصلاحية؛ ويعني `422` أنه معطّل (أو أنه مفتاح متصفح لا يستطيع إرسال القياس عن بُعد للمضيف). اختر مفتاحًا يعمل في الخطوة 1 وحدّث `x-oneuptime-token` في `C:\\Program Files\\otelcol-contrib\\config.yaml`.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. شغّل المجمّع في المقدّمة لترى الخطأ الحقيقي بدلًا من `Error 1064` العام:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. يعني `Error 2: The system cannot find the file specified` أن الخدمة تشير إلى ملف غير موجود — قارن `BINARY_PATH_NAME` من `sc.exe qc "otelcol-contrib"` بمحتوى `C:\\Program Files\\otelcol-contrib`. ويجب أن يكون الأرشيف هو أرشيف `otelcol-contrib_` الذي يفكّ `otelcol-contrib.exe`.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. يسجّل **Event Viewer → Windows Logs → Application** (المصدر `otelcol-contrib`) خطأ البدء الذي ابتلعه مدير الخدمات.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "إن ضبطت `include_services` وما زلت ترى كل الخدمات، فالمجمّع لم يلتقط التعديل — أعد تشغيل الخدمة (`Restart-Service otelcol-contrib`) وامنح علامة التبويب «الخدمات» بضع دقائق لتحديث نافذتها المتحركة.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "تراقب عقدَ Kubernetes **وكيلُ Kubernetes من OneUptime** لا مجمّعُ المضيف: تظهر كل عقدة تحت **Kubernetes** ← عنقودك ← **العقد**، بجوار حجيراتها وأحمال عملها، لا في قائمة **المضيفون**. تثبّت الخطوات أدناه الوكيل على عنقود قياسي؛ ويضم دليل التثبيت في قسم **Kubernetes** خطوات Amazon EKS وGoogle GKE وAzure AKS وGKE Autopilot وEKS Fargate.",
  "A Kubernetes cluster running v1.23 or later":
    "عنقود Kubernetes يعمل بالإصدار v1.23 أو أحدث",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` و`helm` (v3) مثبّتان على جهازك",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "عنقود خاطئ؟ بدّله باستخدام `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "استبدل `my-cluster` باسم لهذا العنقود، مثل `prod-us-east-1`. بهذا الاسم يظهر العنقود في OneUptime، لذا أبقه ثابتًا: الاسم الجديد يسجّل عنقودًا جديدًا.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "يفعّل `--set aiAgent.enabled=true` **تحقيقات الذكاء الاصطناعي** كما يفعل الـ chart افتراضيًا: يحقق الذكاء الاصطناعي من OneUptime في حوادث هذا العنقود وتنبيهاته باستخدام kubectl للقراءة فقط، عبر وكيل الذكاء الاصطناعي في Kubernetes.",
  "You should see:": "يُفترض أن ترى:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "المجمّع ووكيل الذكاء الاصطناعي في Kubernetes، إضافةً إلى Pod واحد من `-logs` وPod واحد من `-ebpf` على كل عقدة. حين تصبح في حالة `Running` يظهر العنقود تلقائيًا في قسم **Kubernetes**، عادةً خلال دقيقة أو دقيقتين.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**وكيل الذكاء الاصطناعي في Kubernetes (مفعّل افتراضيًا، للقراءة فقط).** يتيح الـ Pod المسمّى `kubernetes-agent-ai-agent` للذكاء الاصطناعي من OneUptime التحقيق في حوادث هذا العنقود وتنبيهاته باستخدام kubectl للقراءة فقط (`get`، `describe`، `logs`، `events`، `top`) وبمفتاح API نفسه، ولا يمكنه تغيير أي شيء ما لم تمنحه لاحقًا صلاحية الكتابة. لرؤيته افتح العنقود وانتقل إلى **الذكاء الاصطناعي ← الوكيل**. لا تريده؟ ثبّت باستخدام `--set aiAgent.enabled=false` بدلًا من `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "تحدد قواعد مساحات الأسماء ما يجمعه الوكيل من كل مساحة أسماء. لجمع سجلات الـ Pod وبيانات eBPF من `default` و`production` و`staging` فقط:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "للإبقاء على كل شيء مع إيقاف سجلات مساحات الأسماء الصاخبة، استثنِها من `podLogs` فقط:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **النطاقات:** `podLogs` (stdout/stderr للحاويات)، و`ebpfDiscovery` (تتبعات eBPF ومقاييسه)، و`metrics` (المقاييس ذات مساحة الأسماء)، و`traces` (كل span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- تطابق **الأنماط** اسم مساحة الأسماء بالكامل وتقبل `*`، كما في `team-*`. تتغلب قاعدة `exclude` دائمًا على قاعدة `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **ضبط القواعد يستبدل القاعدة الافتراضية**، التي تستثني `kube-system` من `podLogs` و`ebpfDiscovery`. أبقِها في قائمتك، كما في المثال الثاني، إن كنت لا تزال تريد ذلك.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- ليس لمقاييس العُقد والعنقود مساحة أسماء، لذا تُحفظ دائمًا.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- يتطلب `--set-json` الإصدار Helm 3.10 أو أحدث.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**أرسل الأسطر المهمة فقط.** أسقط أسطر سجلات الـ Pod التي تقل عن درجة خطورة معينة قبل أن تغادر العنقود:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'يقبل `TRACE` و`DEBUG` و`INFO` و`WARN` و`ERROR` و`FATAL`: يُبقي `WARN` التحذيرات والأخطاء والأسطر الفادحة. تُقرأ درجة الخطورة من سطر السجل نفسه (`[ERROR]`، `level=warn`، `"level":"info"`). لا تُسقط أحداث Kubernetes بهذا الإعداد أبدًا.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**أوقف سجلات الـ Pod.** لا تتأثر المقاييس: يواصل مجمّع العُقد العمل لمقاييس kubelet وcAdvisor، ويكفّ فقط عن قراءة سجلات الـ Pod:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**غيّر طريقة قراءة السجلات.** يختار الإعداد المسبق ذلك نيابةً عنك؛ ويتغلب `logs.mode` الصريح عليه دائمًا:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: يقرأ `/var/log/pods` على كل عقدة عبر hostPath (أقل عبء؛ يتطلب hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: يتابع Deployment سجلات الـ Pod عبر واجهة Kubernetes البرمجية (يعمل على أي عنقود).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: بلا سجلات Pod.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "يقرأ ذلك خادم API حيث يجيب داخل العنقود. أما etcd والمجدول ومدير المتحكمات فتجيب على عُقد مستوى التحكم، التي لا يستطيع Pod الوكيل تخمينها، لذا يقرؤها بمجرد أن تدرج عنوان كل عقدة:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **المجدول ومدير المتحكمات** يقدّمان HTTPS ويقبلان رمز الوكيل، لكن kubeadm يربطهما بالعنوان `127.0.0.1`: امنحهما `--bind-address` يستطيع Pod الوكيل الوصول إليه.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** يقدّم مقاييسه عبر HTTP عادي على `--listen-metrics-urls` الخاص بـ kubeadm (المنفذ 2381، المربوط بـ `127.0.0.1` حتى تضيف عنوان العقدة)، كما سبق. أو اجمع من منفذ عميل HTTPS الخاص به، 2379، بشهادة العميل التي يطلبها: ضع `ca.crt` و`tls.crt` و`tls.key` في Secret ضمن `oneuptime-agent` وسمِّه في `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "للعناقيد ذاتية الإدارة فقط: لا تكشف الخدمات المُدارة (EKS، GKE، AKS) مقاييس مستوى التحكم لديها.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "مراقبة التكاليف مفعّلة افتراضيًا: يتضمن الوكيل محرك OpenCost مفتوح المصدر (إضافةً إلى Prometheus الصغير الذي يحتاجه)، ويسعّر عُقدك ووحدات التخزين لديك وفق قوائم الأسعار العامة لمزوّد السحابة، دون أي بيانات اعتماد، ويرسل تكلفة كل مساحة أسماء وكل حمل عمل. تظهر أولى البيانات في صفحتَي «نظرة عامة» و«التكاليف» للعنقود بعد مرور أول ساعة كاملة.",
  "On an agent installed before it was on by default, upgrade it:":
    "إذا كان الوكيل مثبّتًا قبل أن تصبح مراقبة التكاليف مفعّلة افتراضيًا، فنفّذ ترقيته:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **لإيقافها:** أضف `--set cost.enabled=false` إلى الترقية نفسها.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **هل تشغّل Kubecost أو OpenCost بالفعل؟** يعثر عليه الوكيل ويقرأ منه بدلًا من المحرك الذي يتضمنه الـ chart، وتذكر صفحة «نظرة عامة» للعنقود ذلك: أضف `--set cost.engine.url=auto` لإيقاف تضمين محرك ثانٍ.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **محلي أو bare metal؟** اضبط جدول أسعار باستخدام `--set cost.opencost.customPricing.enabled=true` (بالدولار لكل ساعة مورد؛ راجع `values.yaml` في الـ chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "الدليل الكامل: [قابلية ملاحظة تكاليف Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "يشغّل الوكيل [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) على كل عقدة. يلتقط حركة HTTP/HTTPS وgRPC وSQL/Redis من خدمات Go و.NET وJava وNode.js وPython وRuby وRust، بلا SDK وبلا sidecar، ويرسل التتبعات ومقاييس الطلبات (RED) وبيانات مخطط الخدمات عبر المجمّع.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**المتطلبات:** نواة Linux **5.8+** مع BTF (الافتراضي في Debian 11+ وUbuntu 20.10+ وFedora 34+ وRHEL 9+). تعمل وحدات Pod الخاصة بـ eBPF **بامتيازات**، تحتاجها لتحميل برامج eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**أوقفه** إذا كانت عُقدك تعمل بنواة أقدم، أو إذا لم يكن مسموحًا بوحدات Pod ذات الامتيازات، أو إذا كانت خدماتك ترسل التتبعات بالفعل عبر حزم OpenTelemetry SDK ولا تريد تكرارًا:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**اختر الإشارات.** تُشغَّل كل عائلة أو تُوقَف باستخدام `--set ebpf.features.<name>=false` (أو `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | الافتراضي | ما يضيفه |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | مفعّل | معدل طلبات HTTP/gRPC والأخطاء وزمن الاستجابة لكل خدمة |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | مفعّل | عدد استدعاءات الـ span ومدتها (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | مفعّل | حواف المستدعي ← المستدعى؛ تبني خريطة الخدمات |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | مفعّل | عدّادات تدفقات TCP/UDP بين وحدات Pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | معطّل | مقاييس الشبكة بين المناطق (تضاعف عدد قيمها المميزة) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | مفعّل | زمن الذهاب والإياب في TCP وعدّادات الاتصالات الفاشلة وإعادة الإرسال على مستوى العقدة |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**نشر التتبع بين الخدمات** (ربط طلب يعبر من Pod A ← إلى Pod B في تتبع واحد، حتى على عقدة أخرى) **مفعّل افتراضيًا**. يعمل بإعادة كتابة حركة المرور الجارية بالفعل (بتوسيع طلبات HTTP النصية في النواة، وإلحاق خيار TCP بـ TLS وTCP الخام)، وأي خطأ في هذا العدّ للبايتات يُخرج التدفق عن التزامن: والعرَض المُبلَّغ عنه هو توقف عمليات النقل عبر وكيل L7 مثل nginx بمجرد أن تتجاوز الاستجابة ~64KB. إذا رأيت ذلك، أو بدأت شبكة خدمات (service mesh) بإفشال وحدات Pod، فأوقفه باستخدام `--set ebpf.contextPropagation=false`؛ إذ ينشر OpenTelemetry SDK الترويسة `traceparent` في مساحة المستخدم دون أي من ذلك.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "يصبح كل `oneuptime.labels.<key>=<value>` التسمية `<key>:<value>` على العنقود وعلى الخدمات والمضيفين الذين يبلّغ عنهم. تُطابق التسميات دون تمييز بين الأحرف الكبيرة والصغيرة، لذا يُعاد استخدام التسمية الموجودة `Production`؛ ولا يزيل الوكيل أبدًا التسميات المضافة في واجهة OneUptime.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "نفّذ **ترقية** إلى أحدث chart. يحتفظ `--reset-then-reuse-values` (Helm 3.14+) بالقيم التي ضبطتها (الإعداد المسبق، واسم العنقود، والمرشحات) ويأخذ كل ما عداها من الـ chart الجديد؛ أضف فوقه أي أعلام `--set` جديدة:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "في Helm 3.13 وما قبله، نفّذ الترقية بدلًا من ذلك بالقيم التي ضبطتها:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "لا تستخدم `--reuse-values`: فهو يحتفظ أيضًا بالقيم الافتراضية للـ chart الذي تُرقّي منه، فلا تُطبَّق أبدًا القيم الافتراضية للـ chart الأحدث (ومنها صورة eBPF الخاصة به).",
  "**Uninstall** the agent and its namespace:":
    "نفّذ **إلغاء التثبيت** للوكيل ومساحة أسمائه:",
  "| Category | Data |": "| الفئة | البيانات |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **مقاييس العُقد** | استخدام المعالج والذاكرة ونظام الملفات والشبكة |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **مقاييس وحدات Pod والحاويات** | المعالج والذاكرة وإدخال/إخراج الشبكة وعمليات إعادة التشغيل |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **مقاييس العنقود** | حالات العُقد، والموارد القابلة للتخصيص، وأعداد وحدات Pod وأحمال العمل |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **أحداث Kubernetes** | التحذيرات والأخطاء وأحداث الجدولة |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **سجلات الـ Pod** | stdout/stderr لكل حاوية، مقروءة من كل عقدة |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **تتبعات التطبيقات** *(eBPF)* | spans لـ HTTP وgRPC وSQL/Redis من كل Pod، دون SDK أو تغييرات في الكود |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **مقاييس الطلبات ومخطط الخدمات** *(eBPF)* | معدل الطلبات والأخطاء وزمن الاستجابة لكل خدمة، وحواف المستدعي ← المستدعى لخريطة الخدمات |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **تدفقات الشبكة** *(eBPF)* | عدّادات البايتات والحزم في TCP/UDP بين وحدات Pod |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **تكاليف أحمال العمل** *(مفعّلة افتراضيًا)* | الإنفاق لكل مساحة أسماء وحمل عمل وPod، مع السعة الخاملة والكفاءة، وكذلك كمقاييس يمكن التنبيه عليها |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "يحظر عنقودك وحدات تخزين `hostPath` أو وحدات Pod ذات الامتيازات. هذا طبيعي على **GKE Autopilot** و **EKS Fargate**: اختر تلك المنصة في أعلى هذا الدليل واتبع خطواتها. أما على **OpenShift** فينجح التثبيت، لكن وحدات Pod الخاصة بعُقد الوكيل لا تبدأ أبدًا: اختر **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "على أي عنقود آخر بسياسة Pod Security مقيِّدة، أزل الإصدار الفاشل:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "ثم شغّل أمر التثبيت مجددًا مع إضافة `--set preset=gke-autopilot`. يقرأ هذا الإعداد المسبق سجلات الـ Pod عبر واجهة Kubernetes البرمجية بدلًا من hostPath، ويطبّق سياق أمان مشدّدًا، ويستبعد وحدات Pod ذات الامتيازات الخاصة بـ eBPF والتنميط.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. تحقّق من أن وحدات Pod الخاصة بالوكيل تعمل: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. تحقّق من سجلات المجمّع: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. تحقّق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب في أمر التثبيت.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. تأكد من أن العنقود يستطيع الوصول إلى مثيل OneUptime لديك عبر الشبكة.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. تحقّق من Pod وكيل الذكاء الاصطناعي: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. تحقّق من سجلاته: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. لا يوجد Pod؟ رقِّ الـ chart (راجع **ترقية الوكيل أو إلغاء تثبيته** ضمن متقدم) وأضف `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. تحقّق من تطابق اسم العنقود: يثبّت هذا الدليل **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. تحقّق من صلاحيات RBAC الخاصة بالوكيل: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. ابحث عن أخطاء التصدير في سجلات المجمّع: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **النواة قديمة جدًا أو بلا BTF.** يحتاج eBPF إلى Linux 5.8+ مع BTF؛ تحقّق باستخدام `uname -r` على عقدة. إن لم تستطع الترقية، فأوقف eBPF باستخدام `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **وحدات Pod ذات الامتيازات محظورة.** ترفضها بعض العناقيد المقفلة. أوقف eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` غير متاحين على المضيف.** أوقف عائلة إحصاءات TCP فقط: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. تحقّق من سلامة وحدات Pod الخاصة بـ eBPF: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. فعّل مخرجات التصحيح في OBI للتأكد من أنه يرى الحركة: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`، ثم اقرأ `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. إذا ظهرت الـ spans هناك لا في OneUptime، فابحث عن أخطاء التصدير في سجلات المجمّع: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
