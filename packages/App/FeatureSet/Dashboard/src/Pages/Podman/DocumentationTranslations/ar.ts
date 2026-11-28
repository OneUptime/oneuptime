import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman الإصدار 4.0 أو أحدث",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "مقبس API المتوافق مع Docker في Podman على `/run/podman/podman.sock` — فعّله بالأمر `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "يجب أن تستخدم الحاويات التي تريد سجلاتها برنامج تشغيل السجلات `k8s-file` — يستخدم Podman في وضع rootful افتراضيًا `journald`، الذي لا يستطيع الوكيل قراءته",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "ثم شغّل وكيل OneUptime AI بجانبه، بعنوان URL والمفتاح واسم المضيف نفسها. **تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا**: بينما يحقق OneUptime AI في حادثة أو تنبيه على هذا المضيف، يشغّل أوامر `docker` للقراءة فقط عبر وكيل الذكاء الاصطناعي، على مقبس Podman المتوافق مع Docker، ولا يغيّر شيئًا ما لم تسمح بالإصلاحات — راجع **وكيل OneUptime AI** ضمن متقدم. تخطَّ هذا الأمر لتشغيل المجمّع دون تحقيقات الذكاء الاصطناعي.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "استبدل `my-podman-host` باسم لهذا المضيف، مثل `prod-podman-01`. بهذا الاسم يظهر المضيف في OneUptime، فأبقه ثابتًا: الاسم الجديد يسجّل مضيفًا جديدًا.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "ابحث عن هذا السطر في السجلات:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "بمجرد اتصال الوكيل، يظهر المضيف تلقائيًا في قسم **Podman**، عادةً خلال دقيقة تقريبًا. ويظهر وكيل OneUptime AI بحالة متصل في صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف وأسفل **نظرة عامة** الخاصة به.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**مقاييس دون سجلات؟** يكتب Podman في وضع rootful سجلات الحاويات افتراضيًا في `journald`، الذي لا يستطيع الوكيل قراءته. شغّل حاوياتك بالخيار `--log-driver k8s-file` — راجع **جمع سجلات كل الحاويات (برنامج تشغيل السجلات k8s-file)** ضمن متقدم.",
  "| Variable | Required | Description |": "| المتغير | مطلوب | الوصف |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | نعم | عنوان URL لمثيل OneUptime الخاص بك (مثل `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | نعم | مفتاح استيعاب القياس عن بُعد من الخطوة 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | لا | اسم واضح لهذا المضيف. القيمة الافتراضية `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | لا | إصدار Docker API الذي يستخدمه الوكيل مع مقبس Podman. فارغ افتراضيًا: يتفاوض الوكيل عليه مع المقبس. اضبطه فقط لتثبيت إصدار (راجع استكشاف الأخطاء وإصلاحها) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| من `ONEUPTIME_LOG_OPERATOR_1` إلى `ONEUPTIME_LOG_OPERATOR_5` | لا | مشغّلات خاصة بك للمجمّع، كلٌّ منها بصيغة JSON، لتنسيق سجلات لا يقرؤه الوكيل |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "مرّر كل واحد منها إلى `podman run` بالشكل `-e NAME=value`. لتغيير أحدها لاحقًا، احذف الوكيل بالأمر `podman rm -f oneuptime-podman-agent` ثم شغّل الأمر من جديد بالقيمة الجديدة.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "يقرأ الوكيل الملفات التي يكتبها برنامج تشغيل السجلات **`k8s-file`** في Podman (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`)، لذا لا يرى إلا سجلات الحاويات التي تستخدمه (أو `json-file`، الذي يعامله Podman كبرنامج التشغيل نفسه القائم على الملفات). الافتراضي في Podman بوضع rootful هو **`journald`**، الذي لا يستطيع قراءته، ولا يستطيع كذلك قراءة برنامج تشغيل بعيد مثل `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "تحقق من برنامج تشغيل السجلات لحاوية ومن الافتراضي في Podman:",
  "Run a single container with `k8s-file`:": "شغّل حاوية واحدة بـ `k8s-file`:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "حوّل خدمة Compose إلى `k8s-file` مع التدوير:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "أو غيّر الافتراضي لكل حاوية تُنشأ بعد ذلك، في `containers.conf` (`/etc/containers/containers.conf` في وضع rootful، و`~/.config/containers/containers.conf` في وضع rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "ثم **أعد إنشاء** الحاويات المتأثرة (إعادة التشغيل وحدها لا تكفي): تحتفظ الحاوية ببرنامج تشغيل السجلات الذي أُنشئت به. هل يجب أن تُبقي `journald`؟ يواصل الوكيل جمع المقاييس عبر المقبس؛ سجلات الحاويات وحدها تحتاج إلى برنامج التشغيل القائم على الملفات.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`، الحاوية الثانية التي تشغّلها الخطوة 2، تنفّذ أوامر `docker` التي يطلبها OneUptime AI — عبر مقبس Podman المتوافق مع Docker — أثناء تحقيقه في حادثة أو تنبيه على هذا المضيف. **تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا**: بمجرد اتصالها يحقق OneUptime AI من خلالها، وتعرض صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف و**نظرة عامة** حالتها. لإيقاف التحقيق، استخدم **ما يمكن للذكاء الاصطناعي فعله** في تلك الصفحة؛ ولتشغيل المجمّع دون وكيل الذكاء الاصطناعي، احذفها بالأمر `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **للقراءة فقط افتراضيًا.** يشغّل أوامر مثل `docker ps` و`docker logs --tail 200 NAME` و`docker inspect` و`docker stats --no-stream`، ولا يشغّل أبدًا `exec` أو `run` أو `rm` أو `prune`. تُخفى قيم البيئة في مخرجات `docker inspect` قبل أن يغادر أي شيء المضيف.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **الإصلاحات تُفعَّل عند الطلب.** أضف `-e ONEUPTIME_AI_ALLOW_WRITES=true` إلى الأمر لتسمح له بإعادة تشغيل حاوية مسمّاة أو تشغيلها أو إيقافها أو إيقافها مؤقتًا أو إنهائها قسرًا أو تغيير حدودها. يحدد `ONEUPTIME_AI_FIXES` بجانبه ما إذا كان كل إصلاح يحتاج إلى موافقة (`ask-for-approval` أو `automatic` أو `bypass-approval`)، وتعرض ذلك صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف. يحدد `ONEUPTIME_AI_WRITE_TARGETS` (أنماط glob مفصولة بفواصل، مثل `web-*,api-*`) الحاويات المسموح بها؛ ويضيف `ONEUPTIME_AI_PROTECTED_TARGETS` حاويات يجب ألا يغيّرها أبدًا. ولا يغيّر نفسه ولا المجمّع أبدًا.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- يحتاج إلى المقبس نفسه الذي يستخدمه المجمّع، ويعمل بصلاحيات root لأن المقبس مملوك لـ root. تركيب المقبس بالخيار `:ro` لا يجعل الواجهة البرمجية للقراءة فقط — الحد هو سياسة أوامر الوكيل.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- سجلاته: `podman logs -f oneuptime-podman-ai-agent`. ما يمكنه تشغيله وكيف تعمل الإصلاحات: [وكلاء الذكاء الاصطناعي للبنية التحتية](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| الوسم | الوصف |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | أحدث إصدار مستقر (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | أحدث إصدار مستقر (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | إصدار مثبّت، مثل `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | الصورة نفسها، منسوخة على GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "استخدم أحدها بدلًا من `oneuptime/podman-agent:release` في نهاية الأمر `podman run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**الترقية**: اسحب أحدث صورة واحذف الوكيل قيد التشغيل:",
  "Then run both `podman run` commands from step 2 again.":
    "ثم شغّل أمري `podman run` من الخطوة 2 من جديد.",
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
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **سجلات الحاوية** | سجلات stdout/stderr من كل الحاويات التي تستخدم برنامج تشغيل السجلات `k8s-file` |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'تأتي المقاييس من المستقبِل `docker_stats` في المجمّع، عبر مقبس Podman المتوافق مع Docker، لذا أسماؤها هي أسماء مقاييس وكيل Docker نفسها. يحصل كل سطر سجل على درجة خطورة من المستوى الذي يذكره (`[ERROR]` و`level=warn` و`{"level":"info"}`)؛ والسطر الذي لا مستوى له يأخذها من تدفقه: stderr هو `ERROR` وstdout هو `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "يجب أن يعمل الوكيل بصلاحيات root ليقرأ `/run/podman/podman.sock`. تأكد من وجود العلامة `--user 0:0` في أمر `podman run` الخاص بك، ومن أن المقبس مفعّل:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "هذا مقبس Podman في وضع rootful، وهو الذي يقرؤه الوكيل. هل تشغّل Podman في وضع rootless؟ مقبسه هو `/run/user/<uid>/podman/podman.sock` (فعّله بالأمر `systemctl --user enable --now podman.socket`) وتخزينه `~/.local/share/containers/storage`: ركّبهما بدلًا من ذلك على `/run/podman/podman.sock` و`/var/lib/containers/storage` في حاوية الوكيل — راجع وثائق وكيل Podman.",
  "The agent's logs show:": "تعرض سجلات الوكيل:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "يرفض الخادم الذي يفرض حدًا أقصى أي عميل أحدث، فيخرج المجمّع بسبب ذلك وتدخل الحاوية في حلقة إعادة تشغيل. لا يثبّت الوكيل إصدار Docker API إلا عندما يحدده `DOCKER_API_VERSION`، وكانت صورة قديمة للوكيل تثبّت `1.44`. احذف الوكيل (`podman rm -f oneuptime-podman-agent`)، واسحب أحدث صورة (`podman pull oneuptime/podman-agent:release`) وشغّل أمر الخطوة 2 من جديد، دون `-e DOCKER_API_VERSION`. عندها يتفاوض الوكيل على الإصدار مع المقبس.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "لتثبيت إصدار على أي حال، لا تتجاوز الإصدار الذي يبلّغ عنه المقبس:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "أضفه إلى الأمر، مثل `-e DOCKER_API_VERSION=1.41`. لا تزال الخوادم الأحدث تخدم إصدارات API الأقدم، لذا يستمر الإصدار المثبّت في العمل بعد الترقية.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. تحقق من أن الوكيل يعمل: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. افحص سجلات الوكيل بحثًا عن أخطاء: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. تحقق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب في أمر `podman run`.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. تأكد من أن المضيف يستطيع الوصول إلى مثيل OneUptime الخاص بك عبر الشبكة.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "تحقق من أن مقبس Podman مركّب في الوكيل. لا تحتوي صورته على صدفة، لذا افحص من حاوية مؤقتة تشاركه نقاط التركيب:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "ثم ابحث عن أخطاء التصدير في سجلات الوكيل (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) وتأكد من أن مفتاح الاستيعاب صالح ولم تنتهِ صلاحيته.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "تصل المقاييس لكن علامة التبويب **السجلات** فارغة، أو تعرض سجلات الوكيل نفسه فقط؟ على الأرجح لا تستخدم حاوياتك برنامج تشغيل سجلات قائمًا على الملفات (`k8s-file` أو `json-file`) — يستخدم Podman في وضع rootful افتراضيًا `journald`، الذي لا يستطيع الوكيل قراءته.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "إذا عرضت الخطوة 1 الرسالة `no files match the configured criteria`، أو لم تعرض الخطوة 3 أي ملفات لحاوياتك، فهي لا تستخدم `k8s-file`. حوّلها (راجع **جمع سجلات كل الحاويات (برنامج تشغيل السجلات k8s-file)** ضمن متقدم)، ثم أعد إنشاء كل واحدة منها: تحتفظ الحاوية ببرنامج تشغيل السجلات الذي أُنشئت به:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "تعرض صفحة المضيف البيانات التي يطابق اسم مضيفها معرّف ذلك المضيف، الذي يأخذه الوكيل من `PODMAN_HOST_NAME`. إذا غيّرت `PODMAN_HOST_NAME` بعد تسجيل المضيف، يسجّل OneUptime مضيفًا ثانيًا بالاسم الجديد — والسجلات عليه. تحقق من الاسم الذي يبلّغ عنه الوكيل:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "يأتي اسم المضيف من `PODMAN_HOST_NAME`. الوكيل الذي يبدأ دونه يبلّغ عن `podman-host`، لذا تبدو كل المضيفات المُعدّة بهذه الطريقة كأنها مضيف واحد. اضبط `PODMAN_HOST_NAME` على اسم خاص بكل مضيف وأعد إنشاء الوكيل: `podman rm -f oneuptime-podman-agent`، ثم شغّل أمر الخطوة 2 بالاسم الجديد.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "هذا يثبّت الوكيل لـ **`web-1`** — أبقِ `PODMAN_HOST_NAME` كما هو تمامًا، وإلا فستُسجَّل البيانات كمضيف جديد.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "موفّر Compose لـ `podman compose`: `podman-compose` أو Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "الخدمة الثانية هي وكيل OneUptime AI، بعنوان URL والمفتاح واسم المضيف نفسها. **تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا**: بينما يحقق OneUptime AI في حادثة أو تنبيه على هذا المضيف، يشغّل أوامر `docker` للقراءة فقط عبر وكيل الذكاء الاصطناعي، على مقبس Podman المتوافق مع Docker، ولا يغيّر شيئًا ما لم تسمح بالإصلاحات — راجع **وكيل OneUptime AI** ضمن متقدم. احذف الخدمة `oneuptime-podman-ai-agent` لتشغيل المجمّع دون تحقيقات الذكاء الاصطناعي.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "اضبط كل واحد منها في قائمة `environment:` الخاصة بالوكيل، ثم شغّل `podman compose up -d` لإعادة إنشائه بالقيم الجديدة.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`، الخدمة الثانية في docker-compose.yml، تنفّذ أوامر `docker` التي يطلبها OneUptime AI — عبر مقبس Podman المتوافق مع Docker — أثناء تحقيقه في حادثة أو تنبيه على هذا المضيف. **تحقيقات الذكاء الاصطناعي مفعّلة افتراضيًا**: بمجرد اتصالها يحقق OneUptime AI من خلالها، وتعرض صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف و**نظرة عامة** حالتها. لإيقاف التحقيق، استخدم **ما يمكن للذكاء الاصطناعي فعله** في تلك الصفحة؛ ولتشغيل المجمّع دون وكيل الذكاء الاصطناعي، احذف خدمتها وشغّل `podman compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **الإصلاحات تُفعَّل عند الطلب.** أضف `- ONEUPTIME_AI_ALLOW_WRITES=true` إلى قائمة `environment:` الخاصة به لتسمح له بإعادة تشغيل حاوية مسمّاة أو تشغيلها أو إيقافها أو إيقافها مؤقتًا أو إنهائها قسرًا أو تغيير حدودها. يحدد `ONEUPTIME_AI_FIXES` بجانبه ما إذا كان كل إصلاح يحتاج إلى موافقة (`ask-for-approval` أو `automatic` أو `bypass-approval`)، وتعرض ذلك صفحة **الذكاء الاصطناعي ← وكيل ذكاء اصطناعي** الخاصة بالمضيف. يحدد `ONEUPTIME_AI_WRITE_TARGETS` (أنماط glob مفصولة بفواصل، مثل `web-*,api-*`) الحاويات المسموح بها؛ ويضيف `ONEUPTIME_AI_PROTECTED_TARGETS` حاويات يجب ألا يغيّرها أبدًا. ولا يغيّر نفسه ولا المجمّع أبدًا.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "استخدم أحدها بدلًا من `oneuptime/podman-agent:release` في سطر `image:` الخاص بالوكيل.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**الترقية**: في المجلد الذي يحتوي docker-compose.yml، اسحب أحدث الصور وأعد إنشاء الحاويات:",
  "**Uninstall** — stop and remove everything the file started:":
    "**إلغاء التثبيت**: أوقف واحذف كل ما شغّله الملف:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'يجب أن يعمل الوكيل بصلاحيات root ليقرأ `/run/podman/podman.sock`. تأكد من أن خدمة الوكيل فيها `user: "0:0"` في docker-compose.yml، ومن أن المقبس مفعّل:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "يرفض الخادم الذي يفرض حدًا أقصى أي عميل أحدث، فيخرج المجمّع بسبب ذلك وتدخل الحاوية في حلقة إعادة تشغيل. لا يثبّت الوكيل إصدار Docker API إلا عندما يحدده `DOCKER_API_VERSION`، وكانت صورة قديمة للوكيل تثبّت `1.44`. أزل `DOCKER_API_VERSION` من قائمة `environment:` الخاصة بالوكيل، ثم شغّل `podman compose pull` و`podman compose up -d`. عندها يتفاوض الوكيل على الإصدار مع المقبس.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "أضفه إلى قائمة `environment:` الخاصة بالوكيل، مثل `- DOCKER_API_VERSION=1.41`، وشغّل `podman compose up -d`. لا تزال الخوادم الأحدث تخدم إصدارات API الأقدم، لذا يستمر الإصدار المثبّت في العمل بعد الترقية.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. تحقق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب في docker-compose.yml.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "يأتي اسم المضيف من `PODMAN_HOST_NAME`. الوكيل الذي يبدأ دونه يبلّغ عن `podman-host`، لذا تبدو كل المضيفات المُعدّة بهذه الطريقة كأنها مضيف واحد. اضبط `PODMAN_HOST_NAME` على اسم خاص بكل مضيف وشغّل `podman compose up -d` لإعادة إنشاء الوكيل به.",
};

export default TRANSLATION;
