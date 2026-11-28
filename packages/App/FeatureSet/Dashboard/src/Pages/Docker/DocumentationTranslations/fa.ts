import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine نسخه 20.10 یا بالاتر",
  "Access to `/var/run/docker.sock` on the host":
    "دسترسی به `/var/run/docker.sock` روی میزبان",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "کانتینرهایی که لاگ‌هایشان را می‌خواهید باید از درایور لاگ `json-file` استفاده کنند که پیش‌فرض Docker است",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "سپس عامل هوش مصنوعی OneUptime را با همان نشانی URL، کلید و نام میزبان کنار آن اجرا کنید. **بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن است**: وقتی OneUptime AI حادثه یا هشداری را روی این میزبان بررسی می‌کند، فرمان‌های فقط‌خواندنی `docker` را از طریق عامل هوش مصنوعی اجرا می‌کند و تا اصلاحات را مجاز نکنید چیزی را تغییر نمی‌دهد؛ **عامل هوش مصنوعی OneUptime** را در پیشرفته ببینید. برای اجرای کالکتور بدون بررسی‌های هوش مصنوعی، این فرمان را اجرا نکنید.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "`my-docker-host` را با نامی برای این میزبان جایگزین کنید، مثلاً `prod-docker-01`. میزبان با همین نام در OneUptime نمایش داده می‌شود، پس آن را ثابت نگه دارید: نام تازه، میزبان تازه‌ای ثبت می‌کند.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در گام 1 یک کلید دریافت داده انتخاب کنید.",
  "Look for this line in the logs:": "این خط را در لاگ‌ها پیدا کنید:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "همین که عامل متصل شود، میزبان خودکار در بخش **Docker** نمایش داده می‌شود؛ معمولاً حدود یک دقیقه. عامل هوش مصنوعی OneUptime در صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان و پایین **نمای کلی** آن متصل نشان داده می‌شود.",
  "| Variable | Required | Description |": "| متغیر | الزامی | توضیح |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | بله | نشانی URL نمونه OneUptime شما (مثلاً `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | بله | کلید دریافت داده تله‌متری از گام 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | خیر | نامی آشنا برای این میزبان. پیش‌فرض `docker-host` است |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | خیر | نسخه API موتور Docker که عامل با آن کار می‌کند. به‌طور پیش‌فرض خالی است: عامل آن را با دیمن توافق می‌کند، پس هر Docker Engine از 20.10 به بعد کار می‌کند. فقط برای ثابت کردن یک نسخه تنظیمش کنید (عیب‌یابی را ببینید) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` تا `ONEUPTIME_LOG_OPERATOR_5` | خیر | عملگرهای کالکتور خودتان، هر کدام به‌صورت JSON، برای قالب لاگی که عامل نمی‌خواند |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "هر کدام را به شکل `-e NAME=value` به `docker run` بدهید. برای تغییر یکی در آینده، عامل را با `docker rm -f oneuptime-docker-agent` حذف کنید و فرمان را با مقدار تازه دوباره اجرا کنید.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "عامل `/var/lib/docker/containers/*/*-json.log` را دنبال می‌کند، پس فقط لاگ‌های کانتینرهایی را می‌بیند که از درایور لاگ **`json-file`** در Docker استفاده می‌کنند. این پیش‌فرض Docker است، ولی برخی میزبان‌ها به `local` (فایل‌های دودویی که عامل نمی‌تواند تجزیه کند) یا به یک درایور راه‌دور (`journald`، `syslog`، `fluentd`، `gelf`، …) تغییر می‌دهند که فایلی برای خواندن باقی نمی‌گذارند.",
  "Check a container's log driver, and the daemon's default:":
    "درایور لاگ یک کانتینر و پیش‌فرض دیمن را بررسی کنید:",
  "Switch a Compose service to `json-file`, with rotation:":
    "یک سرویس Compose را با چرخش لاگ به `json-file` تغییر دهید:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "یا پیش‌فرض دیمن را برای همه کانتینرهایی که از این پس ساخته می‌شوند، در `/etc/docker/daemon.json` تغییر دهید:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "سپس Docker را دوباره راه‌اندازی کنید و کانتینرهای مربوط را **از نو بسازید** (راه‌اندازی دوباره کافی نیست): هر کانتینر درایور لاگی را که با آن ساخته شده نگه می‌دارد.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`، کانتینر دومی که گام 2 اجرا می‌کند، فرمان‌های `docker` را که OneUptime AI هنگام بررسی حادثه یا هشدار روی این میزبان می‌خواهد اجرا می‌کند. **بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن است**: همین که متصل شود، OneUptime AI با آن بررسی می‌کند و صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان و **نمای کلی** آن وضعیتش را نشان می‌دهند. برای خاموش کردن بررسی، از **کارهای مجاز هوش مصنوعی** در همان صفحه استفاده کنید؛ برای اجرای کالکتور بدون عامل هوش مصنوعی، آن را با `docker rm -f oneuptime-docker-ai-agent` حذف کنید.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **به‌طور پیش‌فرض فقط‌خواندنی.** فرمان‌هایی مانند `docker ps`، `docker logs --tail 200 NAME`، `docker inspect` و `docker stats --no-stream` را اجرا می‌کند و هرگز `exec`، `run`، `rm` یا `prune` را نه. مقدارهای محیطی در خروجی `docker inspect` پیش از آنکه چیزی از میزبان خارج شود پوشانده می‌شوند.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **اصلاحات باید روشن شوند.** `-e ONEUPTIME_AI_ALLOW_WRITES=true` را به فرمان اضافه کنید تا اجازه دهید کانتینری با نام مشخص را دوباره راه‌اندازی، اجرا، متوقف، مکث یا kill کند یا محدودیت‌هایش را تغییر دهد. `ONEUPTIME_AI_FIXES` در کنار آن تعیین می‌کند که هر اصلاح به تأیید نیاز دارد یا نه (`ask-for-approval`، `automatic` یا `bypass-approval`) و صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان آن را نشان می‌دهد. `ONEUPTIME_AI_WRITE_TARGETS` (الگوهای glob جداشده با ویرگول، مانند `web-*,api-*`) کانتینرهای مجاز را محدود می‌کند؛ `ONEUPTIME_AI_PROTECTED_TARGETS` کانتینرهایی را می‌افزاید که هرگز نباید تغییر دهد. هرگز خودش یا کالکتور را تغییر نمی‌دهد.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- با کاربر root اجرا می‌شود، چون مالک سوکت Docker کاربر root است. اتصال `:ro` سوکت، API موتور Docker را فقط‌خواندنی نمی‌کند؛ مرز، سیاست فرمان‌های عامل است.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- لاگ‌های آن: `docker logs -f oneuptime-docker-ai-agent`. اینکه چه چیزی را می‌تواند اجرا کند و اصلاحات چگونه کار می‌کنند: [عامل‌های هوش مصنوعی زیرساخت](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| برچسب | توضیح |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | آخرین نسخه پایدار (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | آخرین نسخه پایدار (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | نسخه‌ای ثابت، مثلاً `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | همان ایمیج، آینه‌شده روی GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "یکی از این‌ها را به‌جای `oneuptime/docker-agent:release` در انتهای فرمان `docker run` به کار ببرید.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**ارتقا**: آخرین ایمیج را بگیرید و عامل در حال اجرا را حذف کنید:",
  "Then run both `docker run` commands from step 2 again.":
    "سپس هر دو فرمان `docker run` گام 2 را دوباره اجرا کنید.",
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
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **لاگ‌های کانتینر** | لاگ‌های stdout/stderr همه کانتینرها |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'هر خط لاگ شدتش را از سطحی که نام می‌برد می‌گیرد (`[ERROR]`، `level=warn`، `{"level":"info"}`)؛ خطی که سطحی ندارد شدتش را از جریانش می‌گیرد: stderr برابر `ERROR` و stdout برابر `INFO` است.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "عامل برای خواندن `/var/run/docker.sock` باید با کاربر root اجرا شود. مطمئن شوید پرچم `--user 0:0` در فرمان `docker run` شما هست.",
  "The agent's logs show:": "لاگ‌های عامل نشان می‌دهند:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "دیمن کلاینتی را که از بیشینه خودش جدیدتر باشد رد می‌کند، کالکتور به همین دلیل بسته می‌شود و کانتینر پیوسته دوباره راه‌اندازی می‌شود. عامل فقط وقتی نسخه‌ای را ثابت می‌کند که `DOCKER_API_VERSION` آن را نام ببرد، و یک ایمیج قدیمی عامل `1.44` را ثابت می‌کرد که Docker Engine نسخه 20.10 تا 24 آن را رد می‌کنند. عامل را حذف کنید (`docker rm -f oneuptime-docker-agent`)، آخرین ایمیج را بگیرید (`docker pull oneuptime/docker-agent:release`) و فرمان گام 2 را بدون `-e DOCKER_API_VERSION` دوباره اجرا کنید. آنگاه عامل نسخه را با دیمن توافق می‌کند.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "اگر باز هم می‌خواهید نسخه‌ای را ثابت کنید، از بیشینه دیمن بالاتر نروید:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "آن را به فرمان اضافه کنید، مثلاً `-e DOCKER_API_VERSION=1.41`. دیمن‌های جدیدتر همچنان نسخه‌های قدیمی‌تر API را پشتیبانی می‌کنند، پس نسخه ثابت‌شده پس از ارتقای Docker هم کار می‌کند.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. بررسی کنید که عامل در حال اجراست: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. لاگ‌های عامل را برای خطا بررسی کنید: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. بررسی کنید که نشانی OneUptime و کلید دریافت داده در فرمان `docker run` درست باشند.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. مطمئن شوید میزبان از راه شبکه به نمونه OneUptime شما دسترسی دارد.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "بررسی کنید که سوکت Docker در عامل متصل (mount) شده باشد. ایمیج آن پوسته ندارد، پس از یک کانتینر یک‌بارمصرف که اتصال‌های آن را به اشتراک می‌گذارد نگاه کنید:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "سپس در لاگ‌های عامل به دنبال خطاهای ارسال بگردید (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) و مطمئن شوید کلید دریافت داده معتبر است و منقضی نشده.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "متریک‌ها می‌رسند ولی زبانه **لاگ‌ها** خالی است یا فقط لاگ‌های خود عامل را نشان می‌دهد؟ به احتمال زیاد کانتینرهای شما از درایور لاگ `json-file` استفاده نمی‌کنند.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "اگر گام 1 پیام `no files match the configured criteria` را نشان دهد، یا گام 3 هیچ فایلی برای کانتینرهای شما فهرست نکند، آن‌ها از `json-file` استفاده نمی‌کنند. آن‌ها را تغییر دهید (**گردآوری لاگ‌های همه کانتینرها (درایور لاگ json-file)** را در پیشرفته ببینید) و سپس هر کدام را از نو بسازید؛ هر کانتینر درایور لاگی را که با آن ساخته شده نگه می‌دارد:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "صفحه یک میزبان داده‌هایی را نشان می‌دهد که نام میزبانشان همان شناسه آن میزبان است و عامل آن را از `DOCKER_HOST_NAME` می‌گیرد. اگر پس از ثبت میزبان `DOCKER_HOST_NAME` را تغییر دهید، OneUptime میزبان دومی با نام تازه ثبت می‌کند و لاگ‌ها روی همان هستند. نامی را که عامل گزارش می‌کند بررسی کنید:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "نام میزبان از `DOCKER_HOST_NAME` می‌آید. عاملی که بدون آن اجرا شود `docker-host` را گزارش می‌کند، پس همه میزبان‌هایی که این‌گونه راه‌اندازی شده‌اند یک میزبان به نظر می‌رسند. روی هر میزبان `DOCKER_HOST_NAME` را نامی مخصوص خودش بگذارید و عامل را از نو بسازید: `docker rm -f oneuptime-docker-agent` و سپس فرمان گام 2 را با نام تازه اجرا کنید.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "این فرمان عامل را برای **`web-1`** نصب می‌کند؛ `DOCKER_HOST_NAME` را دقیقاً همان‌طور که هست نگه دارید، وگرنه داده‌ها به‌عنوان میزبانی تازه ثبت می‌شوند.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (فرمان `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "سرویس دوم، عامل هوش مصنوعی OneUptime است، با همان نشانی URL، کلید و نام میزبان. **بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن است**: وقتی OneUptime AI حادثه یا هشداری را روی این میزبان بررسی می‌کند، فرمان‌های فقط‌خواندنی `docker` را از طریق عامل هوش مصنوعی اجرا می‌کند و تا اصلاحات را مجاز نکنید چیزی را تغییر نمی‌دهد؛ **عامل هوش مصنوعی OneUptime** را در پیشرفته ببینید. برای اجرای کالکتور بدون بررسی‌های هوش مصنوعی، سرویس `oneuptime-docker-ai-agent` را حذف کنید.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "هر کدام را در فهرست `environment:` عامل تنظیم کنید، سپس `docker compose up -d` را اجرا کنید تا با مقدارهای تازه از نو ساخته شود.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`، سرویس دوم در docker-compose.yml، فرمان‌های `docker` را که OneUptime AI هنگام بررسی حادثه یا هشدار روی این میزبان می‌خواهد اجرا می‌کند. **بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن است**: همین که متصل شود، OneUptime AI با آن بررسی می‌کند و صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان و **نمای کلی** آن وضعیتش را نشان می‌دهند. برای خاموش کردن بررسی، از **کارهای مجاز هوش مصنوعی** در همان صفحه استفاده کنید؛ برای اجرای کالکتور بدون عامل هوش مصنوعی، سرویس آن را حذف کنید و `docker compose up -d --remove-orphans` را اجرا کنید.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **اصلاحات باید روشن شوند.** `- ONEUPTIME_AI_ALLOW_WRITES=true` را به فهرست `environment:` آن اضافه کنید تا اجازه دهید کانتینری با نام مشخص را دوباره راه‌اندازی، اجرا، متوقف، مکث یا kill کند یا محدودیت‌هایش را تغییر دهد. `ONEUPTIME_AI_FIXES` در کنار آن تعیین می‌کند که هر اصلاح به تأیید نیاز دارد یا نه (`ask-for-approval`، `automatic` یا `bypass-approval`) و صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان آن را نشان می‌دهد. `ONEUPTIME_AI_WRITE_TARGETS` (الگوهای glob جداشده با ویرگول، مانند `web-*,api-*`) کانتینرهای مجاز را محدود می‌کند؛ `ONEUPTIME_AI_PROTECTED_TARGETS` کانتینرهایی را می‌افزاید که هرگز نباید تغییر دهد. هرگز خودش یا کالکتور را تغییر نمی‌دهد.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "یکی از این‌ها را به‌جای `oneuptime/docker-agent:release` در خط `image:` عامل به کار ببرید.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**ارتقا**: در پوشه‌ای که docker-compose.yml در آن است، آخرین ایمیج‌ها را بگیرید و کانتینرها را از نو بسازید:",
  "**Uninstall** — stop and remove everything the file started:":
    "**حذف نصب**: هر چه را فایل اجرا کرده متوقف و حذف کنید:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    'عامل برای خواندن `/var/run/docker.sock` باید با کاربر root اجرا شود. مطمئن شوید سرویس عامل در docker-compose.yml مقدار `user: "0:0"` را دارد.',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "دیمن کلاینتی را که از بیشینه خودش جدیدتر باشد رد می‌کند، کالکتور به همین دلیل بسته می‌شود و کانتینر پیوسته دوباره راه‌اندازی می‌شود. عامل فقط وقتی نسخه‌ای را ثابت می‌کند که `DOCKER_API_VERSION` آن را نام ببرد، و یک ایمیج قدیمی عامل `1.44` را ثابت می‌کرد که Docker Engine نسخه 20.10 تا 24 آن را رد می‌کنند. `DOCKER_API_VERSION` را از فهرست `environment:` عامل بردارید، سپس `docker compose pull` و `docker compose up -d` را اجرا کنید. آنگاه عامل نسخه را با دیمن توافق می‌کند.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "آن را به فهرست `environment:` عامل اضافه کنید، مثلاً `- DOCKER_API_VERSION=1.41`، و `docker compose up -d` را اجرا کنید. دیمن‌های جدیدتر همچنان نسخه‌های قدیمی‌تر API را پشتیبانی می‌کنند، پس نسخه ثابت‌شده پس از ارتقای Docker هم کار می‌کند.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. بررسی کنید که نشانی OneUptime و کلید دریافت داده در docker-compose.yml درست باشند.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "نام میزبان از `DOCKER_HOST_NAME` می‌آید. عاملی که بدون آن اجرا شود `docker-host` را گزارش می‌کند، پس همه میزبان‌هایی که این‌گونه راه‌اندازی شده‌اند یک میزبان به نظر می‌رسند. روی هر میزبان `DOCKER_HOST_NAME` را نامی مخصوص خودش بگذارید و `docker compose up -d` را اجرا کنید تا عامل با آن از نو ساخته شود.",
};

export default TRANSLATION;
