import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine الإصدار 20.10 أو أحدث",
  "Access to `/var/run/docker.sock` on the host":
    "الوصول إلى `/var/run/docker.sock` على المضيف",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "يجب أن تستخدم الحاويات التي تريد سجلاتها برنامج تشغيل السجلات `json-file`، وهو الافتراضي في Docker",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "ثم شغّل وكيل OneUptime AI بجانبه، بعنوان URL والمفتاح واسم المضيف نفسها. **تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا**: بينما يحقق OneUptime AI في حادثة أو تنبيه على هذا المضيف، يشغّل أوامر `docker` للقراءة فقط عبر وكيل الذكاء الاصطناعي، ولا يغيّر شيئًا ما لم تسمح بالإصلاحات — راجع **وكيل OneUptime AI** ضمن متقدم. تخطَّ هذا الأمر لتشغيل المجمّع دون تحقيقات الذكاء الاصطناعي.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "استبدل `my-docker-host` باسم لهذا المضيف، مثل `prod-docker-01`. بهذا الاسم يظهر المضيف في OneUptime، فأبقه ثابتًا: الاسم الجديد يسجّل مضيفًا جديدًا.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "ابحث عن هذا السطر في السجلات:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "بمجرد اتصال الوكيل، يظهر المضيف تلقائيًا في قسم **Docker**، عادةً خلال دقيقة تقريبًا. ويظهر وكيل OneUptime AI بحالة متصل في صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف وأسفل **نظرة عامة** الخاصة به.",
  "| Variable | Required | Description |": "| المتغير | مطلوب | الوصف |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | نعم | عنوان URL لمثيل OneUptime الخاص بك (مثل `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | نعم | مفتاح استيعاب القياس عن بُعد من الخطوة 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | لا | اسم واضح لهذا المضيف. القيمة الافتراضية `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | لا | إصدار واجهة Docker Engine API الذي يستخدمه الوكيل. فارغ افتراضيًا: يتفاوض الوكيل عليه مع البرنامج الخفي، فيعمل أي Docker Engine بدءًا من 20.10. اضبطه فقط لتثبيت إصدار (راجع استكشاف الأخطاء وإصلاحها) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| من `ONEUPTIME_LOG_OPERATOR_1` إلى `ONEUPTIME_LOG_OPERATOR_5` | لا | مشغّلات خاصة بك للمجمّع، كلٌّ منها بصيغة JSON، لتنسيق سجلات لا يقرؤه الوكيل |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "مرّر كل واحد منها إلى `docker run` بالشكل `-e NAME=value`. لتغيير أحدها لاحقًا، احذف الوكيل بالأمر `docker rm -f oneuptime-docker-agent` ثم شغّل الأمر من جديد بالقيمة الجديدة.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "يتتبع الوكيل `/var/lib/docker/containers/*/*-json.log`، لذا لا يرى إلا سجلات الحاويات التي تستخدم برنامج تشغيل السجلات **`json-file`** في Docker. هذا هو الافتراضي في Docker، لكن بعض المضيفين يتحولون إلى `local` (ملفات ثنائية لا يستطيع الوكيل تحليلها) أو إلى برنامج تشغيل بعيد (`journald` و`syslog` و`fluentd` و`gelf` و…)، فلا يبقى ملف للقراءة.",
  "Check a container's log driver, and the daemon's default:":
    "تحقق من برنامج تشغيل السجلات لحاوية ومن الافتراضي في البرنامج الخفي:",
  "Switch a Compose service to `json-file`, with rotation:":
    "حوّل خدمة Compose إلى `json-file` مع التدوير:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "أو غيّر الافتراضي في البرنامج الخفي لكل حاوية تُنشأ بعد ذلك، في `/etc/docker/daemon.json`:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "ثم أعد تشغيل Docker و**أعد إنشاء** الحاويات المتأثرة (إعادة التشغيل وحدها لا تكفي): تحتفظ الحاوية ببرنامج تشغيل السجلات الذي أُنشئت به.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`، الحاوية الثانية التي تشغّلها الخطوة 2، تنفّذ أوامر `docker` التي يطلبها OneUptime AI أثناء تحقيقه في حادثة أو تنبيه على هذا المضيف. **تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا**: بمجرد اتصالها يحقق OneUptime AI من خلالها، وتعرض صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف و**نظرة عامة** حالتها. لإيقاف التحقيق، استخدم **ما يمكن للذكاء الاصطناعي فعله** في تلك الصفحة؛ ولتشغيل المجمّع دون وكيل الذكاء الاصطناعي، احذفها بالأمر `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **للقراءة فقط افتراضيًا.** يشغّل أوامر مثل `docker ps` و`docker logs --tail 200 NAME` و`docker inspect` و`docker stats --no-stream`، ولا يشغّل أبدًا `exec` أو `run` أو `rm` أو `prune`. تُخفى قيم البيئة في مخرجات `docker inspect` قبل أن يغادر أي شيء المضيف.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **الإصلاحات تُفعَّل عند الطلب.** أضف `-e ONEUPTIME_AI_ALLOW_WRITES=true` إلى الأمر لتسمح له بإعادة تشغيل حاوية مسمّاة أو تشغيلها أو إيقافها أو إيقافها مؤقتًا أو إنهائها قسرًا أو تغيير حدودها. يحدد `ONEUPTIME_AI_FIXES` بجانبه ما إذا كان كل إصلاح يحتاج إلى موافقة (`ask-for-approval` أو `automatic` أو `bypass-approval`)، وتعرض ذلك صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف. يحدد `ONEUPTIME_AI_WRITE_TARGETS` (أنماط glob مفصولة بفواصل، مثل `web-*,api-*`) الحاويات المسموح بها؛ ويضيف `ONEUPTIME_AI_PROTECTED_TARGETS` حاويات يجب ألا يغيّرها أبدًا. ولا يغيّر نفسه ولا المجمّع أبدًا.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- يعمل بصلاحيات root لأن مقبس Docker مملوك لـ root. تركيب المقبس بالخيار `:ro` لا يجعل واجهة Docker API للقراءة فقط — الحد هو سياسة أوامر الوكيل.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- سجلاته: `docker logs -f oneuptime-docker-ai-agent`. ما يمكنه تشغيله وكيف تعمل الإصلاحات: [وكلاء الذكاء الاصطناعي للبنية التحتية](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| الوسم | الوصف |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | أحدث إصدار مستقر (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | أحدث إصدار مستقر (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | إصدار مثبّت، مثل `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | الصورة نفسها، منسوخة على GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "استخدم أحدها بدلًا من `oneuptime/docker-agent:release` في نهاية الأمر `docker run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**الترقية**: اسحب أحدث صورة واحذف الوكيل قيد التشغيل:",
  "Then run both `docker run` commands from step 2 again.":
    "ثم شغّل أمري `docker run` من الخطوة 2 من جديد.",
  "**Uninstall:**": "**إلغاء التثبيت:**",
  "| Category | Data |": "| الفئة | البيانات |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **مقاييس CPU** | إجمالي الاستخدام، نسبة الاستخدام، وقت الخنق (لكل حاوية) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **مقاييس الذاكرة** | الاستخدام، الحد، النسبة، RSS، ذاكرة التخزين المؤقت (لكل حاوية) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **مقاييس الشبكة** | البايتات والحزم المستلمة/المرسلة (لكل حاوية) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **مقاييس الإدخال/الإخراج الكتلي** | بايتات وعمليات القراءة/الكتابة (لكل حاوية) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **معلومات الحاوية** | مدة التشغيل، عدد مرات إعادة التشغيل، عدد العمليات |",
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **سجلات الحاوية** | سجلات stdout/stderr من كل الحاويات |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'يحصل كل سطر سجل على درجة خطورة من المستوى الذي يذكره (`[ERROR]` و`level=warn` و`{"level":"info"}`)؛ والسطر الذي لا مستوى له يأخذها من تدفقه: stderr هو `ERROR` وstdout هو `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "يجب أن يعمل الوكيل بصلاحيات root ليقرأ `/var/run/docker.sock`. تأكد من وجود العلامة `--user 0:0` في أمر `docker run` الخاص بك.",
  "The agent's logs show:": "تعرض سجلات الوكيل:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "يرفض البرنامج الخفي أي عميل أحدث من حده الأقصى، فيخرج المجمّع بسبب ذلك وتدخل الحاوية في حلقة إعادة تشغيل. لا يثبّت الوكيل إصدارًا إلا عندما يحدده `DOCKER_API_VERSION`، وكانت صورة قديمة للوكيل تثبّت `1.44`، التي ترفضها Docker Engine من 20.10 إلى 24. احذف الوكيل (`docker rm -f oneuptime-docker-agent`)، واسحب أحدث صورة (`docker pull oneuptime/docker-agent:release`) وشغّل أمر الخطوة 2 من جديد، دون `-e DOCKER_API_VERSION`. عندها يتفاوض الوكيل على الإصدار مع البرنامج الخفي.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "لتثبيت إصدار على أي حال، لا تتجاوز الحد الأقصى للبرنامج الخفي:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "أضفه إلى الأمر، مثل `-e DOCKER_API_VERSION=1.41`. لا تزال البرامج الخفية الأحدث تخدم إصدارات API الأقدم، لذا يستمر الإصدار المثبّت في العمل بعد ترقية Docker.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. تحقق من أن الوكيل يعمل: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. افحص سجلات الوكيل بحثًا عن أخطاء: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. تحقق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب في أمر `docker run`.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. تأكد من أن المضيف يستطيع الوصول إلى مثيل OneUptime الخاص بك عبر الشبكة.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "تحقق من أن مقبس Docker مركّب في الوكيل. لا تحتوي صورته على صدفة، لذا افحص من حاوية مؤقتة تشاركه نقاط التركيب:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "ثم ابحث عن أخطاء التصدير في سجلات الوكيل (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) وتأكد من أن مفتاح الاستيعاب صالح ولم تنتهِ صلاحيته.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "تصل المقاييس لكن علامة التبويب **السجلات** فارغة، أو تعرض سجلات الوكيل نفسه فقط؟ على الأرجح لا تستخدم حاوياتك برنامج تشغيل السجلات `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "إذا عرضت الخطوة 1 الرسالة `no files match the configured criteria`، أو لم تعرض الخطوة 3 أي ملفات لحاوياتك، فهي لا تستخدم `json-file`. حوّلها (راجع **جمع سجلات كل الحاويات (برنامج تشغيل السجلات json-file)** ضمن متقدم)، ثم أعد إنشاء كل واحدة منها: تحتفظ الحاوية ببرنامج تشغيل السجلات الذي أُنشئت به:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "تعرض صفحة المضيف البيانات التي يطابق اسم مضيفها معرّف ذلك المضيف، الذي يأخذه الوكيل من `DOCKER_HOST_NAME`. إذا غيّرت `DOCKER_HOST_NAME` بعد تسجيل المضيف، يسجّل OneUptime مضيفًا ثانيًا بالاسم الجديد — والسجلات عليه. تحقق من الاسم الذي يبلّغ عنه الوكيل:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "يأتي اسم المضيف من `DOCKER_HOST_NAME`. الوكيل الذي يبدأ دونه يبلّغ عن `docker-host`، لذا تبدو كل المضيفات المُعدّة بهذه الطريقة كأنها مضيف واحد. اضبط `DOCKER_HOST_NAME` على اسم خاص بكل مضيف وأعد إنشاء الوكيل: `docker rm -f oneuptime-docker-agent`، ثم شغّل أمر الخطوة 2 بالاسم الجديد.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "هذا يثبّت الوكيل لـ **`web-1`** — أبقِ `DOCKER_HOST_NAME` كما هو تمامًا، وإلا فستُسجَّل البيانات كمضيف جديد.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (الأمر `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "الخدمة الثانية هي وكيل OneUptime AI، بعنوان URL والمفتاح واسم المضيف نفسها. **تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا**: بينما يحقق OneUptime AI في حادثة أو تنبيه على هذا المضيف، يشغّل أوامر `docker` للقراءة فقط عبر وكيل الذكاء الاصطناعي، ولا يغيّر شيئًا ما لم تسمح بالإصلاحات — راجع **وكيل OneUptime AI** ضمن متقدم. احذف الخدمة `oneuptime-docker-ai-agent` لتشغيل المجمّع دون تحقيقات الذكاء الاصطناعي.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "اضبط كل واحد منها في قائمة `environment:` الخاصة بالوكيل، ثم شغّل `docker compose up -d` لإعادة إنشائه بالقيم الجديدة.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`، الخدمة الثانية في docker-compose.yml، تنفّذ أوامر `docker` التي يطلبها OneUptime AI أثناء تحقيقه في حادثة أو تنبيه على هذا المضيف. **تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا**: بمجرد اتصالها يحقق OneUptime AI من خلالها، وتعرض صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف و**نظرة عامة** حالتها. لإيقاف التحقيق، استخدم **ما يمكن للذكاء الاصطناعي فعله** في تلك الصفحة؛ ولتشغيل المجمّع دون وكيل الذكاء الاصطناعي، احذف خدمتها وشغّل `docker compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **الإصلاحات تُفعَّل عند الطلب.** أضف `- ONEUPTIME_AI_ALLOW_WRITES=true` إلى قائمة `environment:` الخاصة به لتسمح له بإعادة تشغيل حاوية مسمّاة أو تشغيلها أو إيقافها أو إيقافها مؤقتًا أو إنهائها قسرًا أو تغيير حدودها. يحدد `ONEUPTIME_AI_FIXES` بجانبه ما إذا كان كل إصلاح يحتاج إلى موافقة (`ask-for-approval` أو `automatic` أو `bypass-approval`)، وتعرض ذلك صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف. يحدد `ONEUPTIME_AI_WRITE_TARGETS` (أنماط glob مفصولة بفواصل، مثل `web-*,api-*`) الحاويات المسموح بها؛ ويضيف `ONEUPTIME_AI_PROTECTED_TARGETS` حاويات يجب ألا يغيّرها أبدًا. ولا يغيّر نفسه ولا المجمّع أبدًا.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "استخدم أحدها بدلًا من `oneuptime/docker-agent:release` في سطر `image:` الخاص بالوكيل.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**الترقية**: في المجلد الذي يحتوي docker-compose.yml، اسحب أحدث الصور وأعد إنشاء الحاويات:",
  "**Uninstall** — stop and remove everything the file started:":
    "**إلغاء التثبيت**: أوقف واحذف كل ما شغّله الملف:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    'يجب أن يعمل الوكيل بصلاحيات root ليقرأ `/var/run/docker.sock`. تأكد من أن خدمة الوكيل فيها `user: "0:0"` في docker-compose.yml.',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "يرفض البرنامج الخفي أي عميل أحدث من حده الأقصى، فيخرج المجمّع بسبب ذلك وتدخل الحاوية في حلقة إعادة تشغيل. لا يثبّت الوكيل إصدارًا إلا عندما يحدده `DOCKER_API_VERSION`، وكانت صورة قديمة للوكيل تثبّت `1.44`، التي ترفضها Docker Engine من 20.10 إلى 24. أزل `DOCKER_API_VERSION` من قائمة `environment:` الخاصة بالوكيل، ثم شغّل `docker compose pull` و`docker compose up -d`. عندها يتفاوض الوكيل على الإصدار مع البرنامج الخفي.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "أضفه إلى قائمة `environment:` الخاصة بالوكيل، مثل `- DOCKER_API_VERSION=1.41`، وشغّل `docker compose up -d`. لا تزال البرامج الخفية الأحدث تخدم إصدارات API الأقدم، لذا يستمر الإصدار المثبّت في العمل بعد ترقية Docker.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. تحقق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب في docker-compose.yml.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "يأتي اسم المضيف من `DOCKER_HOST_NAME`. الوكيل الذي يبدأ دونه يبلّغ عن `docker-host`، لذا تبدو كل المضيفات المُعدّة بهذه الطريقة كأنها مضيف واحد. اضبط `DOCKER_HOST_NAME` على اسم خاص بكل مضيف وشغّل `docker compose up -d` لإعادة إنشاء الوكيل به.",
};

export default TRANSLATION;
