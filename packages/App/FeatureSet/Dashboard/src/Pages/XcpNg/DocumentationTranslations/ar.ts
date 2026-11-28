import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 أو أحدث، متصل بالتجمّعات التي تريد مراقبتها. تحتاج إضافة OpenMetrics فيه إلى ترخيص Premium على XOA؛ أما Xen Orchestra المبني من المصدر فيتضمنها",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 أو أحدث مع إضافة Docker Compose v2، على جهاز يمكنه الوصول إلى Xen Orchestra عبر HTTPS",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "شهادة على Xen Orchestra تسمّي العنوان الذي يتصل به الوكيل. الشهادة الموقّعة ذاتيًا التي ينشئها Xen Orchestra لنفسه لا تسمّي أي عنوان، لذا لا يستطيع أي عميل TLS حالي التحقق منها — راجع **شهادة Xen Orchestra** ضمن متقدم",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. في Xen Orchestra، افتح *Settings → Plugins* وابحث عن **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. فعّلها. في أول تشغيل لها تنشئ سرًا وتحتفظ به، ويحتفظ به Xen Orchestra بعد كل إعادة تشغيل.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. افتح إعدادات الإضافة وانسخ **Prometheus secret** الخاص بها — ستعطيه للوكيل في الخطوة التالية. ويمكنك أيضًا كتابة سر من اختيارك هناك وحفظه.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "تجيب الإضافة على عنوان Xen Orchestra نفسه وبشهادته نفسها، على `/openmetrics/metrics`، ولا تجيب إلا على طلب يحمل سرها. وهي تقدّم كل تجمّع يتصل به Xen Orchestra، لذا يغطيها وكيل واحد كلها.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "يسأل البرنامج النصي عن عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب، وكلاهما ظاهر في الخطوة 1 (اختر مفتاحًا هناك ليُملآ هنا)، ثم عن:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **عنوان Xen Orchestra** — كما تفتحه في المتصفح، مثل `https://xo.example.com` أو `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **سر إضافة OpenMetrics** — من الخطوة السابقة. لا يظهر أثناء كتابته.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **اسم Xen Orchestra هذا** — الاسم الذي يعرضه كل تجمّع من تجمّعاته في إعداداته. اضغط Enter لاستخدام عنوانه.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "ثم يقرأ البرنامج النصي شهادة Xen Orchestra. إذا كان هذا الجهاز يثق بها مسبقًا، يثق الوكيل بحزمة CA نفسها. وإن لم يكن، يعرض البرنامج النصي بصمة SHA-256 للشهادة: قارنها بالبصمة الموجودة على جهاز Xen Orchestra وأجب بـ **y** لتثق بتلك الشهادة وحدها دون غيرها. ولا يعطّل التحقق أبدًا. وقبل أن يثبّت أي شيء، يطلب من الإضافة مقاييسها باستخدام السر ويخبرك بالتجمّعات التي يُبلغ عنها Xen Orchestra.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "يُثبَّت في `/opt/oneuptime-xcp-ng-agent`، ويكتب ملف `.env` بصلاحيات `0600`، ويشغّل الوكيل باستخدام Docker Compose. تشغيل البرنامج النصي مجددًا يعيد استخدام كل ما في ذلك الملف `.env` بدلًا من السؤال مرة أخرى، لذا فهو أيضًا طريقة الترقية.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "يعرض `docker compose ps` الحاوية `oneuptime-xcp-ng-agent`. ابحث في سجلاتها عن `Everything is ready. Begin running and processing data.` يقرأ الوكيل Xen Orchestra كل دقيقة، ثم يظهر كل تجمّع يُبلغ عنه في قسم **XCP-ng** بالاسم الذي يمنحه إياه Xen Orchestra، مع مضيفيه وأجهزته الافتراضية وتخزينه.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "يكتب برنامج التثبيت النصي هذه القيم في `/opt/oneuptime-xcp-ng-agent/.env`. بعد تغيير أيٍّ منها، طبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |": "| المتغير | مطلوب | الوصف |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | نعم | عنوان URL لمثيل OneUptime لديك (مثل `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | نعم | مفتاح استيعاب القياس عن بُعد، المفتاح الذي اخترته في الخطوة 1 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | نعم | `host` أو `host:port` الخاص بـ Xen Orchestra، دون مخطط |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | لا | `https` (الافتراضي). `http` في بيئة الاختبار فقط: يعبر السر حينها الشبكة دون تشفير |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | نعم | سر إضافة OpenMetrics، ويُرسل بوصفه رمز Bearer. يُكتب كل `$` فيه على شكل `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | لا | اسم Xen Orchestra هذا في OneUptime، ويظهر في إعدادات كل تجمّع من تجمّعاته (الافتراضي: عنوانه) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | لا | الاسم الذي تُطابَق به شهادة Xen Orchestra، حين يكون `XO_ADDRESS` عنوانًا لا تذكره الشهادة |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | برنامج التثبيت النصي | عنوان Xen Orchestra كما كُتب؛ ويستخرج منه البرنامج النصي `XO_SCHEME` و`XO_ADDRESS` |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | برنامج التثبيت النصي | بصمة SHA-256 لشهادة Xen Orchestra نفسها، حين يثق الوكيل بتلك الشهادة وحدها دون غيرها |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | برنامج التثبيت النصي | حزمة CA أصدرت شهادة Xen Orchestra، ينسخها البرنامج النصي إلى `xo-ca.pem` |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | لا | رمز لمستخدم Xen Orchestra يحمل نسخة من الدور المدمج **Read only** ولا شيء غيره: يعمل وكيل الذكاء الاصطناعي لـ XCP-ng عند ضبطه، ويقرأ به |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | لا | للإصلاحات فقط: رمز لمستخدم آخر يسمح دوره بها. ومن دونه لا يغيّر وكيل الذكاء الاصطناعي شيئًا |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | لا | معرّف UUID في XAPI للتجمّع الذي يخدمه وكيل الذكاء الاصطناعي (الافتراضي: التجمّع الوحيد الذي يراه رمز القراءة الخاص به) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | لا | يتجاوز `XCP_NG_POOL_ID` بوصفه التجمّع الذي يسجّل به وكيل الذكاء الاصطناعي |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | لا | `true` أو `false`: هل يمكن لـ OneUptime AI تشغيل أوامر وكيل الذكاء الاصطناعي للقراءة فقط أثناء التحقيق (الافتراضي: مفعّل) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | لا | `off` أو `ask-for-approval` أو `automatic` أو `bypass-approval`: كيف يمكن لـ OneUptime AI تطبيق إصلاح |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | لا | `true` يتيح لوكيل الذكاء الاصطناعي تطبيق الإصلاحات برمز التغييرات. وأي قيمة أخرى تُبقيه للقراءة فقط |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | لا | قيم `vm/<uuid>` أو `host/<uuid>` أو `pbd/<uuid>` أو `schedule/<uuid>` التي يمكن أن يمسها إصلاح، مفصولة بفواصل (الافتراضي: الكل) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | لا | الأمر نفسه، لما يجب ألا يغيّره OneUptime AI أبدًا: الجهاز الافتراضي الذي يعمل فيه وكيل الذكاء الاصطناعي، والجهاز الافتراضي الخاص بـ Xen Orchestra نفسه |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | لا | مستوى سجل وكيل الذكاء الاصطناعي: `debug` أو `info` (الافتراضي) أو `warn` أو `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | لا | `xcp-ng-ai-agent` يشغّل وكيل الذكاء الاصطناعي؛ ويكتبه برنامج التثبيت النصي عند ضبط رمز القراءة |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "يتحقق الوكيل من شهادة Xen Orchestra مقابل `xo-ca.pem` الموجود بجوار `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "يتحقق الوكيل من شهادة Xen Orchestra في كل قراءة، مقابل `xo-ca.pem` وحده. ويحمل هذا الملف واحدًا من ثلاثة أشياء:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **شهادة Xen Orchestra نفسها**، مثبّتة ببصمتها SHA-256 (`XO_TLS_FINGERPRINT`): يثق الوكيل بتلك الشهادة وحدها دون غيرها.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **المرجع المصدّق (CA) الذي أصدرها** (`XO_CA_FILE`)، لشهادة صادرة عن CA خاص بك.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **حزمة CA الخاصة بهذا الجهاز**، لشهادة يثق بها هذا الجهاز مسبقًا.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "وفي كل الأحوال، يجب أن تسمّي الشهادة العنوان الذي يتصل به الوكيل: فالوكيل يتحقق من الأسماء التي صدرت لها الشهادة، كما يفعل كل عميل TLS حالي، لا من موضوعها (subject). والشهادة الموقّعة ذاتيًا التي ينشئها Xen Orchestra لنفسه لا تسمّي أي اسم، لذا لا يستطيع الوكيل الوثوق بها، مثبّتة كانت أم لا، ويفشل بالخطأ `x509: certificate is not valid for any names`. امنح Xen Orchestra شهادة تسمّي عنوانه — من CA الخاص بك، أو شهادة موقّعة ذاتيًا تحمل اسمًا بديلًا للموضوع (subject alternative name) — كما يبيّن [شهادة Xen Orchestra](/docs/telemetry/xcp-ng#xen-orchestras-certificate).",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "حين تسمّي الشهادة Xen Orchestra باسم غير العنوان الموجود في `XO_ADDRESS`، اضبط `XO_TLS_SERVER_NAME` على ذلك الاسم. وحين تُجدَّد شهادة مثبّتة، يتوقف الوكيل عن قراءة Xen Orchestra إلى أن يثق بالشهادة الجديدة. شغّل برنامج التثبيت النصي مرة أخرى: يعرض البصمة الجديدة ويتوقف دون تغيير أي شيء. تحقّق من تلك البصمة على جهاز Xen Orchestra، ثم شغّل البرنامج النصي مرة أخرى معها: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "يقرأ الوكيل الإضافة كل دقيقة، وهي تقرأ قواعد بيانات round-robin لكل مضيف عبر XAPI بدقة 60 ثانية. ويحتفظ الوكيل بسلاسل `xcp_*`، وينقل تجمّع كل سلسلة إلى الدفعة التي يرسلها، بوصفه `xcp_ng.pool.id` (معرّف UUID للتجمّع، الذي لا يتغير أبدًا) و`xcp_ng.pool.name`:",
  "| Category | Series |": "| الفئة | السلاسل |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **التجمّع** | `xcp_pool_connected` — موجودة ما دام Xen Orchestra متصلًا بالتجمّع |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **المضيفون** | `xcp_host_status` (حالة الطاقة وهل المضيف مفعّل)، `xcp_host_uptime_seconds`، `xcp_host_cpu_average`، `xcp_host_load_average`، `xcp_host_memory_*`، `xcp_host_running_vcpus`، `xcp_host_network_*` لكل واجهة، `xcp_host_disk_*` لكل مستودع تخزين |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **الأجهزة الافتراضية** | `xcp_vm_status`، `xcp_vm_uptime_seconds`، `xcp_vm_cpu_usage`، `xcp_vm_runstate_*` (التنافس على CPU)، `xcp_vm_memory_*`، `xcp_vm_network_*` لكل واجهة، `xcp_vm_disk_*` لكل قرص، `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **التخزين** | `xcp_sr_physical_size_bytes`، `xcp_sr_physical_usage_bytes`، `xcp_sr_virtual_size_bytes`، `xcp_vdi_virtual_size_bytes`، `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`، على التجمّعات التي تشغّل XOSTOR |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'تُبلغ نطاقات التحكم عن نفسها بوصفها أجهزة افتراضية تحمل `is_control_domain="true"`؛ وتخفيها الصفحات ما لم تطلبها.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "يصنّف Xen Orchestra ثماني سلاسل للإنتاجية بوصفها عدّادات، مع أن كلًّا منها يحمل معدل XAPI في الثانية: `xcp_host_network_receive_bytes_total` و`xcp_host_network_transmit_bytes_total`، وسلاسل الشبكة وأخطاء الشبكة والقراءة من الأقراص والكتابة إليها للأجهزة الافتراضية. ويحوّلها الوكيل إلى مقاييس لحظية (gauge) دون المساس بقيمها، فيخزّنها OneUptime بوصفها المعدلات التي هي عليها، بالبايت أو بالأخطاء في الثانية.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "يضيف OneUptime أربع سلاسل 0/1 لكل تجمّع، تقرؤها قوالب التنبيهات: `xcp_ng.host.running` و`xcp_ng.host.enabled` و`xcp_ng.vm.running` و`xcp_ng.vm.stopped_after_running` (جهاز افتراضي متوقف أو موقوف مؤقتًا كان يعمل خلال اليوم الأخير). ويختم كذلك كل نقطة بـ `xcp_ng.scope` (`pool` أو `host` أو `vm` أو `sr` أو `vdi` أو `xostor`) و`xcp_ng.id` (معرّف UUID لذلك الكائن)، وعليهما تُرشّح المراقبات ولوحات المعلومات.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "ما لا يُحتفظ به: سلاسل عمليات Xen Orchestra نفسه (`xo_*`)، التي لا تنتمي إلى أي تجمّع، وقدرة المضيف المقروءة عبر IPMI، التي ترسلها الإضافة دون تجمّعها. أما الحصة التقديرية لكل جهاز افتراضي منها فيُحتفظ بها.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with its own `container_name` in its `docker-compose.yml`:":
    "يقرأ الوكيل الواحد Xen Orchestra واحدًا وكل تجمّع يديره. ولقراءة Xen Orchestra ثانٍ، ثبّت وكيلًا ثانيًا في مجلد خاص به، مع `container_name` خاص به في ملف `docker-compose.yml` الخاص به:",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "لا تدع اثنين من Xen Orchestra يديران التجمّع نفسه يُقرآن معًا: فالتجمّع تجمّع واحد في OneUptime، بمعرّف UUID الخاص به، وسيُبلغ عنه مرتين.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "أي سمة مورد تبدأ بالبادئة `oneuptime.label.` تصبح تسمية مشروع على كل تجمّع يقرؤه الوكيل: `oneuptime.label.<dimension>=<value>` هي التسمية `<dimension>:<value>`. أضفها إلى المعالج `resource` في `otel-collector-config.yaml`، بجوار `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "ثم أعد تشغيل المجمّع ليقرأ الإعدادات الجديدة:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "تظهر التجمّعات موسومة بـ `team:platform` و`env:production`. تُطابق التسميات دون تمييز بين الأحرف الكبيرة والصغيرة، لذا يُعاد استخدام التسمية الموجودة `Production`؛ ولا يزيل الوكيل أبدًا التسميات المضافة في واجهة OneUptime. وتشغيل برنامج التثبيت النصي مجددًا يستبدل `otel-collector-config.yaml` المعدَّل، ويحتفظ بنسختك بجواره باسم `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**ترقية** — صورة المجمّع مثبّتة في `docker-compose.yml` وملف إعدادها بجوارها، لذا فإن سحب الصورة وحده لا يحدّث الوكيل. شغّل برنامج التثبيت النصي مرة أخرى. فهو يعيد استخدام كل قيمة في ملف `.env` الحالي (لا يُسأل عن شيء مجددًا)، ويتحقق من شهادة Xen Orchestra بالطريقة نفسها، ويُنزّل أحدث `docker-compose.yml` و`otel-collector-config.yaml` — ويُحتفظ بالملف الذي عدّلته بجوار الجديد باسم `<file>.bak.<timestamp>` —، ويسحب الصورة ويعيد إنشاء الوكيل بها:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "تُبلغ الإعدادات عن إصدار المجمّع الذي تثبّته بوصفه **إصدار الوكيل** لكل تجمّع. وحين يثبّت OneUptime هذا إصدارًا أحدث، تفتح علامة تحذير بجواره هذه الأوامر.",
  "**Uninstall** the agent:": "**إلغاء التثبيت** للوكيل:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "ثم عطّل إضافة OpenMetrics في Xen Orchestra إذا لم يكن شيء آخر يقرؤها.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "يفحص `troubleshoot.sh` السلسلة كلها — الحاوية، وشهادة Xen Orchestra مقابل `xo-ca.pem`، والإضافة وسرها، والتجمّعات التي تُبلغ عنها — ويسأل OneUptime مباشرة هل يقبل مفتاح الاستيعاب الخاص بك. وهذا الفحص الأخير هو الأهم: نقاط نهاية OTLP في OneUptime ترفض المفتاح الخاطئ بـ `401` أو `422`، ويسجّل المجمّع ذلك سطرًا واحدًا `Exporting failed` لكل دفعة يسهل أن يفوتك.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "وينتهي بحكم يسمّي السبب الأرجح. ولا يطبع السر أبدًا.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "يضع OneUptime على التجمّع حالة «منقطع الاتصال» حين لا يُقرأ له شيء طوال 15 دقيقة.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. إذا كانت كل تجمّعات Xen Orchestra هذا في حالة «منقطع الاتصال»، فافحص الوكيل (في `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` و`docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. إذا كان تجمّع واحد فقط كذلك، فقد توقف Xen Orchestra عن الإبلاغ عنه: في *Settings → Servers* في Xen Orchestra، يجب أن يكون خادم التجمّع متصلًا. ويبقى مضيفو التجمّع وأجهزته الافتراضية وتخزينه كما أبلغ عنها Xen Orchestra آخر مرة.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "يسجّل المجمّع `server returned HTTP status 401 Unauthorized`. انسخ السر مجددًا من *Settings → Plugins → openmetrics*، واضبط `XO_OPENMETRICS_SECRET` عليه في `.env` — بين علامتي اقتباس مفردتين، مع كتابة كل `$` على شكل `$$` — وطبّقه باستخدام `docker compose up -d` في `/opt/oneuptime-xcp-ng-agent`. قبل الإصدار 6.8، كان Xen Orchestra ينشئ سرًا جديدًا في كل إعادة تشغيل.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'يجيب Xen Orchestra، لكن إضافة OpenMetrics فيه لا تجيب. فعّل الإضافة من *Settings → Plugins → openmetrics* (تحتاج XOA إلى ترخيص Premium لذلك)، وتحقّق من أن Xen Orchestra بالإصدار 6.9 أو أحدث. ويجيب `/openmetrics/health` بـ `{"status":"ok"}` دون سر ما دامت الإضافة تعمل.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — لا تسمّي الشهادة أي عنوان، كما هو حال شهادة Xen Orchestra الموقّعة ذاتيًا. امنح Xen Orchestra شهادة تسمّي عنوانه.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — اتصل بأحد تلك الأسماء، أو اضبط `XO_TLS_SERVER_NAME` على أحدها.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — لا يحمل `xo-ca.pem` هذه الشهادة ولا الـ CA الذي أصدرها. فإما أن الشهادة جُدّدت، أو أن الملف يحمل شهادة خاطئة: اكتبه مجددًا، كما يشرح **شهادة Xen Orchestra** ضمن متقدم.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "لا يُبلغ Xen Orchestra إلا عن التجمّعات التي يتصل بها، ولا يقرأ الوكيل إلا Xen Orchestra هذا. صِل خادم التجمّع من *Settings → Servers* في Xen Orchestra؛ فيظهر التجمّع في OneUptime مع القراءة التالية. والتجمّع الذي يقرؤه Xen Orchestra آخر يحتاج إلى وكيل خاص به بجوار ذلك الـ Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **اسم Xen Orchestra هذا** — يسمّيه الأمر بالفعل **`xo-paris`**، كما تعرضه إعدادات هذا التجمّع.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "يحمل الأمر بالفعل عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب. ويسأل البرنامج النصي عن الباقي:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "نزّل `docker-compose.yml` و`otel-collector-config.yaml` من OneUptime هذا إلى مجلد جديد:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "أنشئ ملف `.env` بجوارهما؛ فهو يحمل سر الإضافة، لذا أبقِه خاصًا بـ `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- اضبط `XO_ADDRESS` على `host` أو `host:port` الخاص بـ Xen Orchestra، دون `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- ضع سر الإضافة بين علامتي اقتباس مفردتين. إذا احتوى على `$`، فاكتب كلًّا منها على شكل `$$`: فالمجمّع يقرأ القيمة مرة أخرى.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` هو الاسم الذي تطلقه إعدادات كل تجمّع على Xen Orchestra هذا.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "ثم أعطِ الوكيل شهادة Xen Orchestra، باسم `xo-ca.pem` بجوار `docker-compose.yml` — يتحقق الوكيل من Xen Orchestra مقابل هذا الملف وحده. لتثق بشهادة Xen Orchestra نفسها، اقرأها وتحقّق من بصمتها مقابل البصمة الموجودة على جهاز Xen Orchestra:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "إذا أصدرها CA خاص بك، فانسخ بدلًا من ذلك شهادة ذلك الـ CA إلى `xo-ca.pem`؛ وإذا أصدرها CA عام، فانسخ حزمة CA الخاصة بهذا الجهاز (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "شغّل الوكيل:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "يقرأ الوكيل هذه القيم من ملف `.env` بجوار `docker-compose.yml`. بعد تغيير أيٍّ منها، طبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "حين تسمّي الشهادة Xen Orchestra باسم غير العنوان الموجود في `XO_ADDRESS`، اضبط `XO_TLS_SERVER_NAME` على ذلك الاسم. وحين تُجدَّد الشهادة الموجودة في `xo-ca.pem`، اقرأها مجددًا كما في الخطوة 3، ثم شغّل `docker compose up -d --force-recreate`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "شغّل هذه الأوامر في مجلد الوكيل، وهو المجلد الذي فيه `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**ترقية** — صورة المجمّع مثبّتة في `docker-compose.yml` وملف إعدادها بجوارها، لذا فإن سحب الصورة وحده لا يحدّث الوكيل. نزّل الملفين مجددًا؛ يبقى ملفا `.env` و`xo-ca.pem` لديك، وأي تغيير أجريته على أيٍّ من الملفين يجب إجراؤه مجددًا:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "ثم اسحب الصورة وأعد إنشاء الوكيل، ليقرأ المجمّع إعداداته الجديدة:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. إذا كانت كل تجمّعات Xen Orchestra هذا في حالة «منقطع الاتصال»، فافحص الوكيل (في مجلد الوكيل): `docker compose ps` و`docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "يسجّل المجمّع `server returned HTTP status 401 Unauthorized`. انسخ السر مجددًا من *Settings → Plugins → openmetrics*، واضبط `XO_OPENMETRICS_SECRET` عليه في `.env` — بين علامتي اقتباس مفردتين، مع كتابة كل `$` على شكل `$$` — وطبّقه باستخدام `docker compose up -d` في المجلد الذي فيه `docker-compose.yml`. قبل الإصدار 6.8، كان Xen Orchestra ينشئ سرًا جديدًا في كل إعادة تشغيل.",
};

export default TRANSLATION;
