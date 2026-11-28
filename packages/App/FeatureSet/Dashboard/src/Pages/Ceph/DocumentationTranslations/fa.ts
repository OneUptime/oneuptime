import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 یا جدیدتر با افزونه Docker Compose v2، روی ماشینی که از درگاه 9283 به دیمن‌های mgr در Ceph شما دسترسی داشته باشد",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "یک خط فرمان روی یک گره مدیریتی Ceph که در آن فرمان `ceph` با دسترسی مدیر کار کند",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "سپس دیمن‌های mgr خود را فهرست کنید؛ عامل به **همه** آن‌ها نیاز دارد، چه فعال و چه آماده‌به‌کار:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "فقط mgr **فعال** متریک برمی‌گرداند (آماده‌به‌کارها پاسخی خالی می‌دهند)، پس خواندن همه mgr‌ها باعث می‌شود وقتی mgr فعال جابه‌جا شود، متریک‌ها همچنان برسند.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "اسکریپت نشانی OneUptime و کلید دریافت داده شما را می‌پرسد که هر دو در مرحله 1 نشان داده می‌شوند (یک کلید را آن‌جا انتخاب کنید تا این‌جا پر شوند)، و سپس این‌ها را:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **نام خوشه**: نامی که خوشه با آن در OneUptime نشان داده می‌شود. به هر خوشه نام خودش را بدهید و آن را ثابت نگه دارید: نام تازه یک خوشه تازه ثبت می‌کند.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **نقاط پایانی mgr**: هر mgr از مرحله قبل به شکل `host:port` جداشده با ویرگول، مثلاً `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. اسکریپت کروشه‌ها را اضافه می‌کند.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **عامل هوش مصنوعی OneUptime**: این‌که آیا می‌تواند اصلاح‌ها را اعمال کند؛ برای فقط‌خواندنی نگه‌داشتنش **N** پاسخ دهید. جایی که `ceph` با دسترسی مدیر کار می‌کند، اسکریپت ساختن کلاینت Ceph خود عامل هوش مصنوعی را هم پیشنهاد می‌دهد.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "در `/opt/oneuptime-ceph-agent` نصب می‌شود، یک فایل `.env` با `0600` می‌نویسد و عامل را با Docker Compose راه می‌اندازد. اجرای دوباره اسکریپت به‌جای پرسیدن دوباره، همه‌چیز را از همان `.env` دوباره به کار می‌برد، پس ارتقا هم همین‌طور انجام می‌شود.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "در لاگ‌ها دنبال `Everything is ready. Begin running and processing data.` بگردید. سپس خوشه خودکار در بخش **Ceph** نمایان می‌شود، معمولاً در حدود یک دقیقه.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose همچنین **`oneuptime-ceph-ai-agent`**، یعنی عامل هوش مصنوعی OneUptime، را اجرا می‌کند. اگر اسکریپت نصب کلاینت Ceph آن را ساخته باشد، از هم‌اکنون کار می‌کند؛ وگرنه منتظر یکی می‌ماند؛ **عامل هوش مصنوعی OneUptime** را در پیشرفته ببینید.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**عامل هوش مصنوعی OneUptime (به‌طور پیش‌فرض روشن، فقط‌خواندنی).** بررسی‌های هوش مصنوعی روشن است: به‌محض این‌که کلاینت Ceph خود را داشته باشد، به هوش مصنوعی OneUptime اجازه می‌دهد رخدادها و هشدارهای این خوشه را با فرمان‌های فقط‌خواندنی `ceph` بررسی کند، و تا وقتی اصلاح‌ها را مجاز نکنید چیزی را تغییر نمی‌دهد.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "اسکریپت نصب این‌ها را در `/opt/oneuptime-ceph-agent/.env` می‌نویسد. پس از تغییر هر کدام، آن را با `docker compose up -d` در `/opt/oneuptime-ceph-agent` اعمال کنید.",
  "| Variable | Required | Description |": "| متغیر | الزامی | توضیح |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | بله | نشانی نمونه OneUptime شما (مثلاً `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | بله | کلید دریافت داده تله‌متری، همانی که در مرحله 1 انتخاب شد |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | بله | شناسه خوشه که در OneUptime نشان داده می‌شود. روی هر متریک به‌عنوان ویژگی منبع `ceph.cluster.name` زده می‌شود. آن را ثابت نگه دارید: تغییرش یک خوشه تازه ثبت می‌کند (پیش‌فرض: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | بله | فهرست `host:port` جداشده با ویرگولِ **همه** دیمن‌های mgr، درون کروشه، مثلاً `[ceph-mon-1:9283,ceph-mon-2:9283]`. اسکریپت نصب کروشه‌ها را برایتان اضافه می‌کند |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "تنظیمات خود عامل هوش مصنوعی OneUptime زیر **عامل هوش مصنوعی OneUptime** آمده است.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **همه mgr‌ها خوانده می‌شوند** (فعال و آماده‌به‌کار)، پس متریک‌ها از جابه‌جایی mgr فعال جان سالم به در می‌برند.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **هر 30 ثانیه.** ماژول prometheus در mgr هر خواندن را به مدت `mgr/prometheus/scrape_interval` (به‌طور پیش‌فرض 15 ثانیه) در حافظه نهان نگه می‌دارد: هرگز بیشتر از آن نخوانید، فقط حافظه نهان را دوباره می‌خوانید.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** برچسب‌هایی را که Ceph صادر می‌کند (`ceph_daemon`، `pool_id`) همان‌طور که هستند نگه می‌دارد، تا سری‌ها در جابه‌جایی‌های mgr پیوسته بمانند.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "این همان `otel-collector-config.yaml` کاملی است که عامل اجرا می‌کند؛ فایل `.env` مقدارهای `${env:...}` را فراهم می‌کند:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "عامل می‌تواند `/var/log/ceph/ceph.log` را دنبال کند و به OneUptime بفرستد که صفحه **لاگ خوشه** را پر می‌کند. این به‌طور پیش‌فرض خاموش است، چون عامل باید روی میزبانی اجرا شود که لاگ خوشه را دارد، به‌طور پیش‌فرض یک میزبان mon.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. در `otel-collector-config.yaml`، گیرنده `filelog` و خط لوله `logs` را از حالت توضیح خارج کنید.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. در `docker-compose.yml`، حجم `/var/log/ceph:/var/log/ceph:ro` را از حالت توضیح خارج کنید.",
  "3. Apply both:": "3. هر دو را اعمال کنید:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "خط‌ها همان‌طور که هستند فرستاده می‌شوند؛ OneUptime هنگام خواندنشان قالب ceph.log (مهر زمانی، دیمن، سطح INF/WRN/ERR، پیام) را تجزیه می‌کند، و پردازنده `resource` مقدار `ceph.cluster.name` را می‌زند تا لاگ روی همین خوشه بنشیند.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "هر ویژگی منبعی که با پیشوند `oneuptime.label.` شروع شود، برچسب پروژه‌ای روی خوشه می‌شود: `oneuptime.label.<dimension>=<value>` همان برچسب `<dimension>:<value>` است. آن‌ها را در `otel-collector-config.yaml` به پردازنده `resource`، کنار `ceph.cluster.name`، اضافه کنید:",
  "Then restart the collector so it reads the new config:":
    "سپس کالکتور را دوباره راه بیندازید تا پیکربندی تازه را بخواند:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "خوشه با برچسب‌های `team:storage` و `env:production` نمایان می‌شود. برچسب‌ها بدون حساسیت به بزرگی و کوچکی حروف مقایسه می‌شوند، پس برچسب موجود `Production` دوباره به کار می‌رود؛ برچسب‌هایی که در رابط کاربری OneUptime افزوده شده‌اند هرگز به دست عامل حذف نمی‌شوند.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "عامل هر چیزی را که ماژول prometheus در mgr صادر می‌کند می‌فرستد. صفحه‌های Ceph، فهرست متریک‌ها و الگوهای هشدار OneUptime بر این‌ها ساخته شده‌اند:",
  "| Category | Data |": "| دسته | داده |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **سلامت خوشه** | `ceph_health_status` (0 = OK، 1 = WARN، 2 = ERR)، حد نصاب مانیتورها، ظرفیت خام کل و مصرف‌شده |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | وضعیت up / in هر OSD (بر اساس برچسب `ceph_daemon`، مثلاً `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **استخر** | بایت‌های ذخیره‌شده، بیشینه دردسترس، تعداد اشیا، عملیات خواندن/نوشتن و توان عملیاتی هر استخر |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | تعداد PG‌های فعال، تنزل‌یافته و کم‌اندازه |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` همچنین **`oneuptime-ceph-ai-agent`** را اجرا می‌کند. وقتی هوش مصنوعی OneUptime رخداد یا هشداری را روی این خوشه بررسی می‌کند، فرمان‌های `ceph` را از طریق آن اجرا می‌کند: `ceph health detail`، `ceph osd tree`، `ceph pg dump_stuck`، `ceph crash ls`. با نام خوشه `CEPH_CLUSTER_NAME` ثبت می‌شود و در صفحه **هوش مصنوعی ← عامل هوش مصنوعی** خوشه نمایان می‌شود.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "به‌عنوان کلاینت Ceph خودش، `client.oneuptime-ai`، با `ceph.conf` حداقلی خوشه و دسته‌کلید همان کلاینت در پوشه `ceph/` کنار `docker-compose.yml` وصل می‌شود. اسکریپت نصب در نصب تازه، وقتی `ceph` روی ماشینی که آن را اجرا می‌کنید با دسترسی مدیر کار کند، ساختن آن‌ها را پیشنهاد می‌دهد. در غیر این صورت، یا برای افزودنشان در آینده، روی یک گره مدیریتی Ceph:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "اگر عامل روی ماشین دیگری اجرا می‌شود، دو فایل را به همین شکل در پوشه `ceph/` آن کپی کنید. **هرگز دسته‌کلید مدیر را آن‌جا نگذارید.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **caps کلاینت مرز سخت است.** با این caps خواندنی، هیچ چیزی که اجرا می‌کند نمی‌تواند خوشه را تغییر دهد. اصلاح‌ها (برگرداندن یک OSD به in، پاک کردن `noout`) به `ONEUPTIME_AI_ALLOW_WRITES=true` در `.env` و caps اصلاح از README عامل هم نیاز دارند.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- بررسی کنید: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- از هوش مصنوعی OneUptime استفاده نمی‌کنید؟ سرویس `oneuptime-ceph-ai-agent` را از `docker-compose.yml` حذف کنید.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "این‌که چه چیزی را می‌تواند اجرا کند و اصلاح‌ها چطور کار می‌کنند: [عامل‌های هوش مصنوعی زیرساخت](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**ارتقا**: ایمیج کالکتور در `docker-compose.yml` ثابت شده و پیکربندی‌اش فایلی کنار آن است، پس فقط کشیدن ایمیج عامل را جلو نمی‌برد. اسکریپت نصب را دوباره اجرا کنید. هر مقدار `.env` موجود شما را دوباره به کار می‌برد (چیزی دوباره پرسیده نمی‌شود)، آخرین `docker-compose.yml` و `otel-collector-config.yaml` را دانلود می‌کند (فایلی که ویرایش کرده‌اید کنار فایل تازه با نام `<file>.bak.<timestamp>` نگه داشته می‌شود)، ایمیج‌ها را می‌کشد و عامل را با آن‌ها از نو می‌سازد. پوشه `ceph/` عامل هوش مصنوعی همان‌طور که هست می‌ماند:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "پیکربندی، نسخه کالکتوری را که ثابت می‌کند به‌عنوان **نسخه عامل** خوشه گزارش می‌دهد. وقتی این OneUptime نسخه تازه‌تری را ثابت کند، یک نشانه هشدار کنار آن این فرمان‌ها را باز می‌کند.",
  "**Uninstall** the agent:": "عامل را **حذف نصب** کنید:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "اگر کلاینت Ceph عامل هوش مصنوعی را ساخته‌اید، آن را روی یک گره مدیریتی حذف کنید: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` کل زنجیره را بررسی می‌کند (محیط اجرای کانتینر، هر نقطه پایانی mgr همراه با تله فعال در برابر آماده‌به‌کار، زدن نام خوشه، شکل توکن، متریک‌های خود کالکتور) و مستقیم از OneUptime می‌پرسد که آیا کلید دریافت داده شما را می‌پذیرد. این آخرین بررسی از همه مهم‌تر است: نقاط پایانی OTLP در OneUptime کلید نادرست را با `401` یا `422` رد می‌کنند، که کالکتور آن را در هر دسته به‌صورت یک خط `Exporting failed` لاگ می‌کند که به‌آسانی از چشم می‌افتد، پس اسکریپت از `GET /otlp/v1/validate` حکم مستقیم 200/401 را می‌خواهد.",
  "It ends with a verdict naming the most likely cause.":
    "در پایان حکمی می‌دهد که محتمل‌ترین علت را نام می‌برد.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. لاگ‌های کالکتور را بررسی کنید: `docker logs oneuptime-ceph-agent`؛ دنبال خطاهای صدور بگردید (`401` یعنی کلید دریافت داده نادرست، رد شدن اتصال یعنی `ONEUPTIME_URL` نادرست).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. تأیید کنید که یک نقطه پایانی mgr متریک ارائه می‌دهد: `curl http://<active-mgr>:9283/metrics | head`؛ باید خط‌های متریک `ceph_*` را ببینید. اگر نه، ماژول را فعال کنید: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. مطمئن شوید که `CEPH_MGR_ENDPOINTS` درون کروشه است: بدون آن‌ها کالکتور کل رشته جداشده با ویرگول را یک هدف واحد (نامعتبر) در نظر می‌گیرد.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. بررسی کنید که عامل در حال اجراست: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. لاگ‌های عامل را از نظر خطا بررسی کنید: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. تأیید کنید که نشانی OneUptime و کلید دریافت داده شما درست هستند.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. مطمئن شوید که ماشین عامل از طریق شبکه به نمونه OneUptime دسترسی دارد.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "احتمالاً فقط mgr فعال (قبلی) را می‌خوانید. **هر** دیمن mgr را در `CEPH_MGR_ENDPOINTS` فهرست کنید: خواندن mgr‌های آماده‌به‌کار کم‌هزینه است و پاسخ خالی برمی‌گرداند.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "اگر `mgr/prometheus/standby_behaviour` روی خوشه شما `error` باشد، این قابل انتظار است: آماده‌به‌کارها در این حالت با HTTP 500 پاسخ می‌دهند. خواندن mgr فعال همچنان موفق است، پس این خطاها نویزند؛ برای خاموش کردنشان رفتار را به `default` برگردانید.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "هویت خوشه از `CEPH_CLUSTER_NAME` می‌آید که روی هر متریک به‌عنوان `ceph.cluster.name` زده می‌شود. آن را در `.env` درست کنید و با `docker compose up -d` در `/opt/oneuptime-ceph-agent` اعمال کنید؛ توجه داشته باشید که نام تازه یک خوشه تازه ثبت می‌کند.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **نام خوشه**: دقیقاً **`ceph-1`** را وارد کنید؛ نام دیگری یک خوشه تازه ثبت می‌کند.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "هویت خوشه از `CEPH_CLUSTER_NAME` می‌آید که روی هر متریک به‌عنوان `ceph.cluster.name` زده می‌شود. این خوشه **`ceph-1`** است. آن را در `.env` درست کنید و با `docker compose up -d` در `/opt/oneuptime-ceph-agent` اعمال کنید؛ توجه داشته باشید که نام تازه یک خوشه تازه ثبت می‌کند.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "فرمان از پیش نشانی OneUptime و کلید دریافت داده شما را در خود دارد. بقیه را اسکریپت می‌پرسد:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "`docker-compose.yml` و `otel-collector-config.yaml` را از این OneUptime در یک پوشه تازه دانلود کنید:",
  "Create a `.env` file next to them:": "یک فایل `.env` کنار آن‌ها بسازید:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- `my-ceph-cluster` را با نامی برای این خوشه جایگزین کنید، مثلاً `ceph-prod`. خوشه با همین نام در OneUptime نشان داده می‌شود، پس آن را ثابت نگه دارید: نام تازه یک خوشه تازه ثبت می‌کند.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- **هر** دیمن mgr را در `CEPH_MGR_ENDPOINTS` فهرست کنید، جداشده با ویرگول و درون کروشه: بدون کروشه‌ها کالکتور کل فهرست را یک هدف نامعتبر می‌خواند.",
  "Start the agent:": "عامل را راه بیندازید:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در مرحله 1 یک کلید دریافت داده انتخاب کنید.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose همچنین **`oneuptime-ceph-ai-agent`**، یعنی عامل هوش مصنوعی OneUptime، را راه می‌اندازد. منتظر کلاینت Ceph خودش می‌ماند؛ **عامل هوش مصنوعی OneUptime** را در پیشرفته ببینید، یا اگر از هوش مصنوعی OneUptime استفاده نمی‌کنید، سرویس آن را از `docker-compose.yml` حذف کنید.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "عامل این‌ها را از فایل `.env` کنار `docker-compose.yml` می‌خواند. پس از تغییر هر کدام، آن را با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | بله | فهرست `host:port` جداشده با ویرگولِ **همه** دیمن‌های mgr، درون کروشه، مثلاً `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "به‌عنوان کلاینت Ceph خودش، `client.oneuptime-ai`، با `ceph.conf` حداقلی خوشه و دسته‌کلید همان کلاینت در پوشه `ceph/` کنار `docker-compose.yml` وصل می‌شود. روی یک گره مدیریتی Ceph، در پوشه عامل:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "این‌ها را در پوشه عامل اجرا کنید، همان که `docker-compose.yml` در آن است.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**ارتقا**: ایمیج کالکتور در `docker-compose.yml` ثابت شده و پیکربندی‌اش فایلی کنار آن است، پس فقط کشیدن ایمیج عامل را جلو نمی‌برد. هر دو فایل را دوباره دانلود کنید؛ `.env` شما می‌ماند، و تغییری که در هر یک از فایل‌ها داده بودید باید دوباره انجام شود:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "سپس ایمیج‌ها را بکشید و عامل را از نو بسازید تا کالکتور پیکربندی تازه‌اش را بخواند:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "هویت خوشه از `CEPH_CLUSTER_NAME` می‌آید که روی هر متریک به‌عنوان `ceph.cluster.name` زده می‌شود. آن را در `.env` درست کنید و با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید؛ توجه داشته باشید که نام تازه یک خوشه تازه ثبت می‌کند.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- این فرمان عامل را برای **`ceph-1`** نصب می‌کند: `CEPH_CLUSTER_NAME` را دقیقاً همان‌طور که هست نگه دارید، وگرنه داده‌ها به‌عنوان یک خوشه تازه ثبت می‌شوند.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "هویت خوشه از `CEPH_CLUSTER_NAME` می‌آید که روی هر متریک به‌عنوان `ceph.cluster.name` زده می‌شود. این خوشه **`ceph-1`** است. آن را در `.env` درست کنید و با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید؛ توجه داشته باشید که نام تازه یک خوشه تازه ثبت می‌کند.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | خیر | نام کانتینر کالکتور (پیش‌فرض: `oneuptime-ceph-agent`). عامل یک خوشه دوم روی همان ماشین به نام‌های خودش نیاز دارد: اسکریپت نصب، اگر آن‌ها را تنظیم نکنید، کانتینرهای عامل تازه را به نام پوشه‌اش می‌نامد و وقتی اسکریپت را دوباره اجرا می‌کنید آن‌ها را نگه می‌دارد |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | خیر | نام کانتینر عامل هوش مصنوعی (پیش‌فرض: `oneuptime-ceph-ai-agent`). اسکریپت نصب، اگر آن را تنظیم نکنید، عامل هوش مصنوعی یک خوشه دوم را به نام کالکتورش می‌نامد (`oneuptime-ceph-ai-agent-cluster2` کنار `oneuptime-ceph-agent-cluster2`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "یک عامل یک خوشه را می‌خواند. برای خوشه دوم، عامل دومی را در پوشه‌ای جداگانه و با نام‌های کانتینر خودش نصب کنید، چون دو کانتینر نمی‌توانند یک نام داشته باشند:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "اسکریپت، اگر متغیرهای کانتینرها را تنظیم نکنید، مثلاً `CEPH_AGENT_CONTAINER_NAME`، کانتینرها را به نام پوشه می‌نامد، مثلاً `oneuptime-ceph-agent-cluster2`. اسکریپت نام‌ها را در `.env` همان عامل نگه می‌دارد، پس اجرای دوباره اسکریپت با همان `INSTALL_DIR` برای ارتقای عامل آن‌ها را حفظ می‌کند، و عاملی که `container_name` آن را زمانی در `docker-compose.yml` ویرایش کرده‌اید همان نام را نگه می‌دارد.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "به هر پوشه نامی از آن خودش بدهید: Docker Compose هر پروژه را فقط به نام پوشه‌اش می‌نامد، پس اسکریپت پوشه‌ای را که هم‌نام پوشه‌ای باشد که در جای دیگری عاملی را اجرا می‌کند نمی‌پذیرد. پوشه را با `-d` به اسکریپت تشخیصی بدهید.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | خیر | نام کانتینر کالکتور (پیش‌فرض: `oneuptime-ceph-agent`). عامل یک خوشه دوم روی همان ماشین به نام خودش نیاز دارد |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | خیر | نام کانتینر عامل هوش مصنوعی (پیش‌فرض: `oneuptime-ceph-ai-agent`). عامل یک خوشه دوم روی همان ماشین به نام خودش نیاز دارد |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "یک عامل یک خوشه را می‌خواند. برای خوشه دوم، عامل دومی را در پوشه‌ای جداگانه و با نام‌های کانتینر خودش راه‌اندازی کنید، چون دو کانتینر نمی‌توانند یک نام داشته باشند. آن‌ها را در `.env` همان عامل تنظیم کنید:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "به هر پوشه نامی از آن خودش بدهید: Docker Compose هر پروژه را فقط به نام پوشه‌اش می‌نامد، پس پوشه دومی با همان نام جای کانتینرهای عامل اول را می‌گیرد. نام‌ها را در `docker-compose.yml` نگذارید، چون ارتقا این فایل را جایگزین می‌کند.",
};

export default TRANSLATION;
