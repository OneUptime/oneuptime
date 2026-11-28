import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman نسخه 4.0 یا بالاتر",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "سوکت API سازگار با Docker در Podman در `/run/podman/podman.sock`؛ آن را با `sudo systemctl enable --now podman.socket` روشن کنید",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "کانتینرهایی که لاگ‌هایشان را می‌خواهید باید از درایور لاگ `k8s-file` استفاده کنند؛ Podman در حالت rootful به‌طور پیش‌فرض از `journald` استفاده می‌کند که عامل نمی‌تواند آن را بخواند",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "سپس عامل هوش مصنوعی OneUptime را با همان نشانی URL، کلید و نام میزبان کنار آن اجرا کنید. **بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن است**: وقتی OneUptime AI حادثه یا هشداری را روی این میزبان بررسی می‌کند، فرمان‌های فقط‌خواندنی `docker` را از طریق عامل هوش مصنوعی روی سوکت سازگار با Docker در Podman اجرا می‌کند و تا اصلاحات را مجاز نکنید چیزی را تغییر نمی‌دهد؛ **عامل هوش مصنوعی OneUptime** را در پیشرفته ببینید. برای اجرای کالکتور بدون بررسی‌های هوش مصنوعی، این فرمان را اجرا نکنید.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "`my-podman-host` را با نامی برای این میزبان جایگزین کنید، مثلاً `prod-podman-01`. میزبان با همین نام در OneUptime نمایش داده می‌شود، پس آن را ثابت نگه دارید: نام تازه، میزبان تازه‌ای ثبت می‌کند.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در گام 1 یک کلید دریافت داده انتخاب کنید.",
  "Look for this line in the logs:": "این خط را در لاگ‌ها پیدا کنید:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "همین که عامل متصل شود، میزبان خودکار در بخش **Podman** نمایش داده می‌شود؛ معمولاً حدود یک دقیقه. عامل هوش مصنوعی OneUptime در صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان و پایین **نمای کلی** آن متصل نشان داده می‌شود.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**متریک هست ولی لاگ نیست؟** Podman در حالت rootful به‌طور پیش‌فرض لاگ کانتینرها را در `journald` می‌نویسد که عامل نمی‌تواند آن را بخواند. کانتینرهایتان را با `--log-driver k8s-file` اجرا کنید؛ **گردآوری لاگ‌های همه کانتینرها (درایور لاگ k8s-file)** را در پیشرفته ببینید.",
  "| Variable | Required | Description |": "| متغیر | الزامی | توضیح |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | بله | نشانی URL نمونه OneUptime شما (مثلاً `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | بله | کلید دریافت داده تله‌متری از گام 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | خیر | نامی آشنا برای این میزبان. پیش‌فرض `podman-host` است |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | خیر | نسخه API موتور Docker که عامل با سوکت Podman به کار می‌برد. به‌طور پیش‌فرض خالی است: عامل آن را با سوکت توافق می‌کند. فقط برای ثابت کردن یک نسخه تنظیمش کنید (عیب‌یابی را ببینید) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` تا `ONEUPTIME_LOG_OPERATOR_5` | خیر | عملگرهای کالکتور خودتان، هر کدام به‌صورت JSON، برای قالب لاگی که عامل نمی‌خواند |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "هر کدام را به شکل `-e NAME=value` به `podman run` بدهید. برای تغییر یکی در آینده، عامل را با `podman rm -f oneuptime-podman-agent` حذف کنید و فرمان را با مقدار تازه دوباره اجرا کنید.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "عامل فایل‌هایی را می‌خواند که درایور لاگ **`k8s-file`** در Podman می‌نویسد (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`)، پس فقط لاگ‌های کانتینرهایی را می‌بیند که از آن (یا از `json-file`، که Podman آن را همان درایور فایل‌محور می‌داند) استفاده می‌کنند. پیش‌فرض Podman در حالت rootful **`journald`** است که عامل نمی‌تواند آن را بخواند و درایور راه‌دوری مانند `syslog` را هم نمی‌تواند.",
  "Check a container's log driver, and Podman's default:":
    "درایور لاگ یک کانتینر و پیش‌فرض Podman را بررسی کنید:",
  "Run a single container with `k8s-file`:":
    "یک کانتینر را با `k8s-file` اجرا کنید:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "یک سرویس Compose را با چرخش لاگ به `k8s-file` تغییر دهید:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "یا پیش‌فرض را برای همه کانتینرهایی که از این پس ساخته می‌شوند، در `containers.conf` تغییر دهید (`/etc/containers/containers.conf` در حالت rootful، `~/.config/containers/containers.conf` در حالت rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "سپس کانتینرهای مربوط را **از نو بسازید** (راه‌اندازی دوباره کافی نیست): هر کانتینر درایور لاگی را که با آن ساخته شده نگه می‌دارد. باید `journald` را نگه دارید؟ عامل همچنان متریک‌ها را از طریق سوکت گردآوری می‌کند؛ فقط لاگ کانتینرها به درایور فایل‌محور نیاز دارد.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`، کانتینر دومی که گام 2 اجرا می‌کند، فرمان‌های `docker` را که OneUptime AI هنگام بررسی حادثه یا هشدار روی این میزبان می‌خواهد، از طریق سوکت سازگار با Docker در Podman اجرا می‌کند. **بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن است**: همین که متصل شود، OneUptime AI با آن بررسی می‌کند و صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان و **نمای کلی** آن وضعیتش را نشان می‌دهند. برای خاموش کردن بررسی، از **کارهای مجاز هوش مصنوعی** در همان صفحه استفاده کنید؛ برای اجرای کالکتور بدون عامل هوش مصنوعی، آن را با `podman rm -f oneuptime-podman-ai-agent` حذف کنید.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **به‌طور پیش‌فرض فقط‌خواندنی.** فرمان‌هایی مانند `docker ps`، `docker logs --tail 200 NAME`، `docker inspect` و `docker stats --no-stream` را اجرا می‌کند و هرگز `exec`، `run`، `rm` یا `prune` را نه. مقدارهای محیطی در خروجی `docker inspect` پیش از آنکه چیزی از میزبان خارج شود پوشانده می‌شوند.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **اصلاحات باید روشن شوند.** `-e ONEUPTIME_AI_ALLOW_WRITES=true` را به فرمان اضافه کنید تا اجازه دهید کانتینری با نام مشخص را دوباره راه‌اندازی، اجرا، متوقف، مکث یا kill کند یا محدودیت‌هایش را تغییر دهد. `ONEUPTIME_AI_FIXES` در کنار آن تعیین می‌کند که هر اصلاح به تأیید نیاز دارد یا نه (`ask-for-approval`، `automatic` یا `bypass-approval`) و صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان آن را نشان می‌دهد. `ONEUPTIME_AI_WRITE_TARGETS` (الگوهای glob جداشده با ویرگول، مانند `web-*,api-*`) کانتینرهای مجاز را محدود می‌کند؛ `ONEUPTIME_AI_PROTECTED_TARGETS` کانتینرهایی را می‌افزاید که هرگز نباید تغییر دهد. هرگز خودش یا کالکتور را تغییر نمی‌دهد.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- به همان سوکتی نیاز دارد که کالکتور دارد و با کاربر root اجرا می‌شود، چون مالک سوکت کاربر root است. اتصال `:ro` سوکت، API را فقط‌خواندنی نمی‌کند؛ مرز، سیاست فرمان‌های عامل است.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- لاگ‌های آن: `podman logs -f oneuptime-podman-ai-agent`. اینکه چه چیزی را می‌تواند اجرا کند و اصلاحات چگونه کار می‌کنند: [عامل‌های هوش مصنوعی زیرساخت](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| برچسب | توضیح |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | آخرین نسخه پایدار (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | آخرین نسخه پایدار (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | نسخه‌ای ثابت، مثلاً `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | همان ایمیج، آینه‌شده روی GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "یکی از این‌ها را به‌جای `oneuptime/podman-agent:release` در انتهای فرمان `podman run` به کار ببرید.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**ارتقا**: آخرین ایمیج را بگیرید و عامل در حال اجرا را حذف کنید:",
  "Then run both `podman run` commands from step 2 again.":
    "سپس هر دو فرمان `podman run` گام 2 را دوباره اجرا کنید.",
  "**Uninstall:**": "**حذف نصب:**",
  "| Category | Data |": "| دسته | داده |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **متریک‌های CPU** | مصرف کل، درصد مصرف، زمان محدودسازی (برای هر کانتینر) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **متریک‌های حافظه** | مصرف، حد، درصد، RSS، کش (برای هر کانتینر) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **متریک‌های شبکه** | بایت‌ها و بسته‌های دریافتی/ارسالی (برای هر کانتینر) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **متریک‌های I/O بلوکی** | بایت‌ها و عملیات خواندن/نوشتن (برای هر کانتینر) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **اطلاعات کانتینر** | مدت کارکرد، تعداد راه‌اندازی دوباره، تعداد پردازه‌ها |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **لاگ‌های کانتینر** | لاگ‌های stdout/stderr همه کانتینرهایی که از درایور لاگ `k8s-file` استفاده می‌کنند |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'متریک‌ها از گیرنده `docker_stats` کالکتور و از طریق سوکت سازگار با Docker در Podman می‌آیند، پس نامشان همان نام‌های عامل Docker است. هر خط لاگ شدتش را از سطحی که نام می‌برد می‌گیرد (`[ERROR]`، `level=warn`، `{"level":"info"}`)؛ خطی که سطحی ندارد شدتش را از جریانش می‌گیرد: stderr برابر `ERROR` و stdout برابر `INFO` است.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "عامل برای خواندن `/run/podman/podman.sock` باید با کاربر root اجرا شود. مطمئن شوید پرچم `--user 0:0` در فرمان `podman run` شما هست و سوکت روشن است:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "این سوکت Podman در حالت rootful است، همانی که عامل می‌خواند. Podman را در حالت rootless اجرا می‌کنید؟ سوکت آن `/run/user/<uid>/podman/podman.sock` است (آن را با `systemctl --user enable --now podman.socket` روشن کنید) و فضای ذخیره‌سازی‌اش `~/.local/share/containers/storage`: به‌جای آن، این‌ها را در کانتینر عامل روی `/run/podman/podman.sock` و `/var/lib/containers/storage` متصل کنید؛ مستندات عامل Podman را ببینید.",
  "The agent's logs show:": "لاگ‌های عامل نشان می‌دهند:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "سروری که بیشینه‌ای را اعمال می‌کند کلاینت جدیدتر را رد می‌کند، کالکتور به همین دلیل بسته می‌شود و کانتینر پیوسته دوباره راه‌اندازی می‌شود. عامل فقط وقتی نسخه API موتور Docker را ثابت می‌کند که `DOCKER_API_VERSION` آن را نام ببرد، و یک ایمیج قدیمی عامل `1.44` را ثابت می‌کرد. عامل را حذف کنید (`podman rm -f oneuptime-podman-agent`)، آخرین ایمیج را بگیرید (`podman pull oneuptime/podman-agent:release`) و فرمان گام 2 را بدون `-e DOCKER_API_VERSION` دوباره اجرا کنید. آنگاه عامل نسخه را با سوکت توافق می‌کند.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "اگر باز هم می‌خواهید نسخه‌ای را ثابت کنید، از نسخه‌ای که سوکت گزارش می‌کند بالاتر نروید:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "آن را به فرمان اضافه کنید، مثلاً `-e DOCKER_API_VERSION=1.41`. سرورهای جدیدتر همچنان نسخه‌های قدیمی‌تر API را پشتیبانی می‌کنند، پس نسخه ثابت‌شده پس از ارتقا هم کار می‌کند.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. بررسی کنید که عامل در حال اجراست: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. لاگ‌های عامل را برای خطا بررسی کنید: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. بررسی کنید که نشانی OneUptime و کلید دریافت داده در فرمان `podman run` درست باشند.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. مطمئن شوید میزبان از راه شبکه به نمونه OneUptime شما دسترسی دارد.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "بررسی کنید که سوکت Podman در عامل متصل (mount) شده باشد. ایمیج آن پوسته ندارد، پس از یک کانتینر یک‌بارمصرف که اتصال‌های آن را به اشتراک می‌گذارد نگاه کنید:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "سپس در لاگ‌های عامل به دنبال خطاهای ارسال بگردید (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) و مطمئن شوید کلید دریافت داده معتبر است و منقضی نشده.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "متریک‌ها می‌رسند ولی زبانه **لاگ‌ها** خالی است یا فقط لاگ‌های خود عامل را نشان می‌دهد؟ به احتمال زیاد کانتینرهای شما از درایور لاگ فایل‌محور (`k8s-file` یا `json-file`) استفاده نمی‌کنند؛ Podman در حالت rootful به‌طور پیش‌فرض از `journald` استفاده می‌کند که عامل نمی‌تواند آن را بخواند.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "اگر گام 1 پیام `no files match the configured criteria` را نشان دهد، یا گام 3 هیچ فایلی برای کانتینرهای شما فهرست نکند، آن‌ها از `k8s-file` استفاده نمی‌کنند. آن‌ها را تغییر دهید (**گردآوری لاگ‌های همه کانتینرها (درایور لاگ k8s-file)** را در پیشرفته ببینید) و سپس هر کدام را از نو بسازید؛ هر کانتینر درایور لاگی را که با آن ساخته شده نگه می‌دارد:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "صفحه یک میزبان داده‌هایی را نشان می‌دهد که نام میزبانشان همان شناسه آن میزبان است و عامل آن را از `PODMAN_HOST_NAME` می‌گیرد. اگر پس از ثبت میزبان `PODMAN_HOST_NAME` را تغییر دهید، OneUptime میزبان دومی با نام تازه ثبت می‌کند و لاگ‌ها روی همان هستند. نامی را که عامل گزارش می‌کند بررسی کنید:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "نام میزبان از `PODMAN_HOST_NAME` می‌آید. عاملی که بدون آن اجرا شود `podman-host` را گزارش می‌کند، پس همه میزبان‌هایی که این‌گونه راه‌اندازی شده‌اند یک میزبان به نظر می‌رسند. روی هر میزبان `PODMAN_HOST_NAME` را نامی مخصوص خودش بگذارید و عامل را از نو بسازید: `podman rm -f oneuptime-podman-agent` و سپس فرمان گام 2 را با نام تازه اجرا کنید.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "این فرمان عامل را برای **`web-1`** نصب می‌کند؛ `PODMAN_HOST_NAME` را دقیقاً همان‌طور که هست نگه دارید، وگرنه داده‌ها به‌عنوان میزبانی تازه ثبت می‌شوند.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "یک ارائه‌دهنده Compose برای `podman compose`: `podman-compose` یا Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "سرویس دوم، عامل هوش مصنوعی OneUptime است، با همان نشانی URL، کلید و نام میزبان. **بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن است**: وقتی OneUptime AI حادثه یا هشداری را روی این میزبان بررسی می‌کند، فرمان‌های فقط‌خواندنی `docker` را از طریق عامل هوش مصنوعی روی سوکت سازگار با Docker در Podman اجرا می‌کند و تا اصلاحات را مجاز نکنید چیزی را تغییر نمی‌دهد؛ **عامل هوش مصنوعی OneUptime** را در پیشرفته ببینید. برای اجرای کالکتور بدون بررسی‌های هوش مصنوعی، سرویس `oneuptime-podman-ai-agent` را حذف کنید.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "هر کدام را در فهرست `environment:` عامل تنظیم کنید، سپس `podman compose up -d` را اجرا کنید تا با مقدارهای تازه از نو ساخته شود.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`، سرویس دوم در docker-compose.yml، فرمان‌های `docker` را که OneUptime AI هنگام بررسی حادثه یا هشدار روی این میزبان می‌خواهد، از طریق سوکت سازگار با Docker در Podman اجرا می‌کند. **بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن است**: همین که متصل شود، OneUptime AI با آن بررسی می‌کند و صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان و **نمای کلی** آن وضعیتش را نشان می‌دهند. برای خاموش کردن بررسی، از **کارهای مجاز هوش مصنوعی** در همان صفحه استفاده کنید؛ برای اجرای کالکتور بدون عامل هوش مصنوعی، سرویس آن را حذف کنید و `podman compose up -d --remove-orphans` را اجرا کنید.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **اصلاحات باید روشن شوند.** `- ONEUPTIME_AI_ALLOW_WRITES=true` را به فهرست `environment:` آن اضافه کنید تا اجازه دهید کانتینری با نام مشخص را دوباره راه‌اندازی، اجرا، متوقف، مکث یا kill کند یا محدودیت‌هایش را تغییر دهد. `ONEUPTIME_AI_FIXES` در کنار آن تعیین می‌کند که هر اصلاح به تأیید نیاز دارد یا نه (`ask-for-approval`، `automatic` یا `bypass-approval`) و صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان آن را نشان می‌دهد. `ONEUPTIME_AI_WRITE_TARGETS` (الگوهای glob جداشده با ویرگول، مانند `web-*,api-*`) کانتینرهای مجاز را محدود می‌کند؛ `ONEUPTIME_AI_PROTECTED_TARGETS` کانتینرهایی را می‌افزاید که هرگز نباید تغییر دهد. هرگز خودش یا کالکتور را تغییر نمی‌دهد.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "یکی از این‌ها را به‌جای `oneuptime/podman-agent:release` در خط `image:` عامل به کار ببرید.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**ارتقا**: در پوشه‌ای که docker-compose.yml در آن است، آخرین ایمیج‌ها را بگیرید و کانتینرها را از نو بسازید:",
  "**Uninstall** — stop and remove everything the file started:":
    "**حذف نصب**: هر چه را فایل اجرا کرده متوقف و حذف کنید:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'عامل برای خواندن `/run/podman/podman.sock` باید با کاربر root اجرا شود. مطمئن شوید سرویس عامل در docker-compose.yml مقدار `user: "0:0"` را دارد و سوکت روشن است:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "سروری که بیشینه‌ای را اعمال می‌کند کلاینت جدیدتر را رد می‌کند، کالکتور به همین دلیل بسته می‌شود و کانتینر پیوسته دوباره راه‌اندازی می‌شود. عامل فقط وقتی نسخه API موتور Docker را ثابت می‌کند که `DOCKER_API_VERSION` آن را نام ببرد، و یک ایمیج قدیمی عامل `1.44` را ثابت می‌کرد. `DOCKER_API_VERSION` را از فهرست `environment:` عامل بردارید، سپس `podman compose pull` و `podman compose up -d` را اجرا کنید. آنگاه عامل نسخه را با سوکت توافق می‌کند.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "آن را به فهرست `environment:` عامل اضافه کنید، مثلاً `- DOCKER_API_VERSION=1.41`، و `podman compose up -d` را اجرا کنید. سرورهای جدیدتر همچنان نسخه‌های قدیمی‌تر API را پشتیبانی می‌کنند، پس نسخه ثابت‌شده پس از ارتقا هم کار می‌کند.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. بررسی کنید که نشانی OneUptime و کلید دریافت داده در docker-compose.yml درست باشند.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "نام میزبان از `PODMAN_HOST_NAME` می‌آید. عاملی که بدون آن اجرا شود `podman-host` را گزارش می‌کند، پس همه میزبان‌هایی که این‌گونه راه‌اندازی شده‌اند یک میزبان به نظر می‌رسند. روی هر میزبان `PODMAN_HOST_NAME` را نامی مخصوص خودش بگذارید و `podman compose up -d` را اجرا کنید تا عامل با آن از نو ساخته شود.",
};

export default TRANSLATION;
