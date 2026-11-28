import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 یا تازه‌تر همراه با افزونه Docker Compose v2، روی ماشینی که به API Proxmox VE هر گره روی درگاه 8006 دسترسی داشته باشد",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "یک پوسته root روی هر گره PVE، یا رابط وب Proxmox، برای ساختن یک توکن API فقط‌خواندنی",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "ترجیحاً ماشینی بیرون از خوشه، یا ماشین مجازی‌ای که Proxmox HA آن را روی گره دیگری دوباره راه‌اندازی می‌کند: وقتی گره‌ای از کار بیفتد، عامل خوشه را از گره دیگری می‌خواند، اما وقتی ماشین خود عامل از کار بیفتد نه",
  "As root on any PVE node:": "به‌عنوان root روی هر گره PVE:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- خط اول فقط وقتی شکست می‌خورد که `monitoring@pam` از قبل وجود داشته باشد، و آن هم بی‌ضرر است. توکن‌های API رمز خودشان را دارند، پس کاربر نه گذرواژه لازم دارد و نه حساب سیستمی.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` رمز توکن را چاپ می‌کند: همین حالا آن را کپی کنید، فقط یک بار نشان داده می‌شود. شناسه توکن `monitoring@pam!oneuptime` است.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- نقش هم به کاربر داده می‌شود و هم به توکن، چون توکنی که امتیازهایش جداست فقط مجوزهایی را می‌گیرد که کاربرش هم دارد. نقش باید روی مسیر ریشه `/` باشد: pve-exporter وضعیت کل خوشه را می‌خواند، و توکنی که به یک زیرمسیر محدود شده باشد با `Permission check failed (/, Sys.Audit)` شکست می‌خورد.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. به *Datacenter → Permissions → API Tokens* بروید و روی **Add** کلیک کنید.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. یک کاربر انتخاب کنید (یا بسازید)، به توکن شناسه‌ای مثل `oneuptime` بدهید، مطمئن شوید **Privilege Separation** تیک خورده است و روی **Add** کلیک کنید.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. شناسه توکن (`user@realm!tokenname`) و رمز را کپی کنید: رمز فقط یک بار نشان داده می‌شود.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. در *Datacenter → Permissions* دو بار روی **Add** کلیک کنید تا نقش **PVEAuditor** را به مسیر `/` بدهید: یک بار به‌عنوان **API Token Permission** برای توکن، و یک بار به‌عنوان **User Permission** برای کاربرش.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "توکنی که امتیازهایش جداست فقط مجوزهایی را می‌گیرد که کاربرش هم دارد، پس هر دو به این نقش نیاز دارند. نقش باید روی مسیر ریشه `/` باشد: pve-exporter وضعیت کل خوشه را می‌خواند، و توکنی که به یک زیرمسیر محدود شده باشد با `Permission check failed (/, Sys.Audit)` شکست می‌خورد.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "اسکریپت نشانی OneUptime و کلید دریافت داده شما را می‌پرسد که هر دو در مرحله 1 نشان داده می‌شوند (یک کلید را آن‌جا انتخاب کنید تا این‌جا پر شوند)، و سپس این‌ها را:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **نام خوشه**: نامی که خوشه با آن در OneUptime نشان داده می‌شود. به هر خوشه نام خودش را بدهید و آن را ثابت نگه دارید: نام تازه یک خوشه تازه ثبت می‌کند.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **میزبان API Proxmox VE**: هر گره‌ای، مثلاً `192.168.1.10`. تا وقتی API آن پاسخ ندهد، عامل خوشه را از گره بعدی فهرست زیر می‌خواند.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **prometheus-pve-exporter همراه**: اگر از قبل یکی را اجرا نمی‌کنید، **Y** را پاسخ دهید.",
  "- **API token** — the token id and secret from the previous step.":
    "- **توکن API**: شناسه و رمز توکن از مرحله قبل.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **نشانی هر گره**: نشانی خود هر گره، جداشده با ویرگول، هرگز یک IP مجازی. با داشتن توکن، اسکریپت فهرست خود خوشه را پیشنهاد می‌دهد: برای پذیرفتنش Enter را بزنید. وقتی گره اول از کار افتاده باشد هم، عامل خوشه را از همین گره‌ها می‌خواند.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **عامل هوش مصنوعی OneUptime**: این‌که آیا می‌تواند اصلاح‌ها را اعمال کند؛ برای فقط‌خواندنی نگه داشتنش **N** را پاسخ دهید.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "در `/opt/oneuptime-proxmox-agent` نصب می‌شود، یک فایل `.env` با مجوز `0600` می‌نویسد و همه‌چیز را با Docker Compose راه می‌اندازد. اجرای دوباره اسکریپت به‌جای پرسیدن دوباره، همه‌چیزِ آن `.env` را دوباره به کار می‌برد، پس ارتقا هم به همین شکل انجام می‌شود.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` کالکتور (`oneuptime-proxmox-agent`)، جابه‌جایی خودکار گره (`oneuptime-pve-api-failover`)، اکسپورتر همراه (`oneuptime-pve-exporter`، مگر این‌که اکسپورتر خودتان را به کار ببرید) و عامل هوش مصنوعی OneUptime (`oneuptime-proxmox-ai-agent`) را فهرست می‌کند. در لاگ‌های کالکتور دنبال `Everything is ready. Begin running and processing data.` بگردید. پس از آن خوشه خودکار در بخش **Proxmox** نمایان می‌شود.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**عامل هوش مصنوعی OneUptime (به‌طور پیش‌فرض روشن، فقط‌خواندنی).** بررسی‌های هوش مصنوعی روشن است: به هوش مصنوعی OneUptime اجازه می‌دهد رخدادها و هشدارهای این خوشه را با درخواست‌های فقط‌خواندنی `pvesh` بررسی کند، و تا وقتی اصلاح‌ها را مجاز نکنید چیزی را تغییر نمی‌دهد؛ **عامل هوش مصنوعی OneUptime** را در پیشرفته ببینید.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "به Proxmox VE 8.3 یا تازه‌تر نیاز دارد. برای نمایش دو فرمان، در مرحله 1 یک کلید دریافت داده انتخاب کنید: فرمان‌ها کلید را دربر دارند و Proxmox VE آن را در مقصد وب‌هوکی که اضافه می‌کنند نگه می‌دارد.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "پس از آن صفحه هر مهمان آخرین پشتیبان آن را نشان می‌دهد و **توصیه‌ها**ی خوشه هشدارهای **Backup Job Failed** و **Node Fenced** را پیشنهاد می‌کنند.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "اسکریپت نصب این‌ها را در `/opt/oneuptime-proxmox-agent/.env` می‌نویسد. پس از تغییر هر کدام، آن را با `docker compose up -d` در `/opt/oneuptime-proxmox-agent` اعمال کنید.",
  "| Variable | Required | Description |": "| متغیر | الزامی | توضیح |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | بله | نشانی نمونه OneUptime شما (مثلاً `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | بله | کلید دریافت داده تله‌متری، همانی که در مرحله 1 انتخاب شد |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | بله | شناسه خوشه که در OneUptime نشان داده می‌شود. روی هر متریک به‌عنوان ویژگی منبع `proxmox.cluster.name` زده می‌شود. آن را ثابت نگه دارید: تغییرش یک خوشه تازه ثبت می‌کند (پیش‌فرض: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | بله | گره‌ای که اکسپورتر خوشه را از API Proxmox VE آن می‌خواند و عامل هوش مصنوعی از آن پرس‌وجو می‌کند، مثلاً `192.168.1.10`. تا وقتی API آن پاسخ ندهد، هر دو از گره بعدی در `PVE_NODES` که پاسخ می‌دهد استفاده می‌کنند |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | در یک خوشه | نشانی API خود هر گره، جداشده با ویرگول درون کروشه، مثلاً `[192.168.1.10,192.168.1.11,192.168.1.12]`. پیش‌فرض فقط `PVE_HOST` است که برای یک گره تنها کافی است. اکسپورتر شروع هنگام بوت (Guest Down)، تکثیر و اشتراک را فقط برای گره‌ای می‌خواند که از آن می‌پرسد، پس از هر گره به نوبت پرسیده می‌شود؛ گره‌ای که جا بماند دیده نمی‌شود. وقتی `PVE_HOST` از کار بیفتد، عامل خوشه را از گره بعدی همین فهرست هم می‌خواند. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | خیر | نشانی (`host:port`، بدون شِما) prometheus-pve-exporter. پیش‌فرض اکسپورتر همراه است (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | اکسپورتر همراه و عامل هوش مصنوعی | شناسه کامل توکن API Proxmox، مثلاً `monitoring@pam!oneuptime` (PVEAuditor، فقط‌خواندنی) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | اکسپورتر همراه و عامل هوش مصنوعی | رمز توکن API Proxmox |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | خیر | بررسی گواهی TLS در API Proxmox (پیش‌فرض: `false`؛ PVE با گواهی‌های خودامضا عرضه می‌شود) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | خیر | برای راه‌اندازی کانتینر اکسپورتر همراه، آن را روی `pve-exporter` بگذارید |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "تنظیمات خود عامل هوش مصنوعی OneUptime زیر **عامل هوش مصنوعی OneUptime** آمده است.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "وقتی اسکریپت نصب می‌پرسد **Run the bundled prometheus-pve-exporter?**، **n** را پاسخ دهید و نشانی اکسپورتر خود را بدهید (`host:port`، بدون شِما).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "نشانی‌ای به کار ببرید که کانتینر عامل به آن دسترسی داشته باشد، یعنی IP شبکه محلی یا نام DNS میزبان: `localhost` درون کانتینر خود کانتینر است. اگر عامل هوش مصنوعی OneUptime را به کار می‌برید، `PVE_API_TOKEN_ID` و `PVE_API_TOKEN_SECRET` را در `.env` نگه دارید، چون عامل هوش مصنوعی API را با همان توکن می‌خواند.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "عامل هر 30 ثانیه اکسپورتر را جمع‌آوری می‌کند: کالکتورهای خوشه‌ای آن را یک بار، روی `PVE_HOST` (یا گره‌ای که تا وقتی `PVE_HOST` از کار افتاده خوشه را از آن می‌خواند)، و کالکتورهای گره‌ای آن را برای هر گره در `PVE_NODES` یک بار. هر سری برچسب `id` دارد که منبع را مشخص می‌کند: `node/<name>`، `qemu/<vmid>`، `lxc/<vmid>` یا `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| دسته | متریک‌ها |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **دسترس‌پذیری** | `pve_up`، `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **گره** | `pve_node_info`، `pve_cpu_usage_ratio`، `pve_cpu_usage_limit`، `pve_memory_usage_bytes`، `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **مهمان (VM / LXC)** | `pve_guest_info`، به‌علاوه سری‌های CPU / حافظه / شبکه روی شناسه‌های `qemu/*` و `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **ذخیره‌سازی** | `pve_disk_usage_bytes`، `pve_disk_size_bytes`، `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (دسترس‌پذیری بالا) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **پوشش پشتیبان‌گیری** | `pve_not_backed_up_total`، `pve_not_backed_up_info`: مهمان‌هایی که هیچ کار پشتیبان‌گیری‌ای آن‌ها را انتخاب نمی‌کند (این‌که پشتیبان‌گیری‌ها اجرا شدند یا موفق بودند نشان داده نمی‌شود) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **شروع هنگام بوت** | `pve_onboot_status` برای هر مهمان، که **Guest Down** آن را می‌خواند |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **تکثیر** | سری‌های `pve_replication_*` برای هر کار تکثیر ذخیره‌سازی: برچسب `id` آن‌ها شناسه کار است (مثلاً `100-0`)، نه یک منبع |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "شروع هنگام بوت و تکثیر از کالکتورهای گره‌ای اکسپورتر می‌آیند که فقط گره‌ای را می‌خوانند که اکسپورتر از آن می‌پرسد: گره‌ای که در `PVE_NODES` نباشد هیچ‌کدام را ندارد.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "کالکتور برچسب `id` را به سه ویژگی نقطه داده هم تقسیم می‌کند که با برابری قابل فیلترند (پردازشگر `transform/pve-identity`)؛ معیارهای مانیتورها و فیلترهای داشبورد بر پایه همین‌ها تطبیق می‌دهند:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| ویژگی | مقادیر | نمونه برای `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`، `guest`، `storage`، `cluster` (`qemu` و `lxc` هر دو به `guest` نگاشت می‌شوند) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | هر چه پس از نخستین `/` در `id` می‌آید (`pve1`، `100`، `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "برچسب اصلی `id` دست‌نخورده باقی می‌ماند.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "عامل کل خوشه را از طریق API یک گره می‌خواند: API گره `PVE_HOST` تا وقتی پاسخ می‌دهد. هر 15 ثانیه کانتینر `oneuptime-pve-api-failover` آن گره را بررسی می‌کند، و وقتی API آن دیگر پاسخ ندهد، کالکتور خوشه را از گره بعدی در `PVE_NODES` که پاسخ می‌دهد می‌خواند، تا وقتی `PVE_HOST` دوباره پاسخ دهد. با توکن API در `.env`، از گره‌ای هم می‌گذرد که پاسخ می‌دهد اما از بخش دارای حد نصاب خوشه جدا افتاده است، چون از دید آن گره همه گره‌های دیگر از کار افتاده‌اند. عامل هوش مصنوعی OneUptime هم در هر فراخوانی خود همین کار را می‌کند. پس وقتی گره‌ای از کار بیفتد، **Node Offline** برای آن اجرا می‌شود و بقیه خوشه به گزارش‌دادن ادامه می‌دهد.",
  "Its logs say which node the cluster is read from, and why.":
    "لاگ‌های آن می‌گویند خوشه از کدام گره خوانده می‌شود، و چرا.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "چیزی که نمی‌تواند پوشش دهد ماشینی است که عامل روی آن اجرا می‌شود: اگر آن ماشین از کار بیفتد، کل خوشه خاموش می‌شود و **Cluster Stopped Reporting** اجرا می‌شود. عامل را بیرون از خوشه اجرا کنید، یا در ماشین مجازی‌ای که Proxmox HA آن را روی گره دیگری دوباره راه‌اندازی می‌کند (`ha-manager add vm:<vmid>`، روی ذخیره‌سازی مشترک)، و برای هر خوشه یک عامل اجرا کنید: هر عامل کل خوشه را می‌خواند، پس عامل دوم هر منبع را دو بار گزارش می‌کند. [وقتی گره‌ای از کار می‌افتد](/docs/telemetry/proxmox#when-a-node-goes-down) را ببینید.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "این `otel-collector-config.yaml` کاملی است که عامل اجرا می‌کند؛ فایل `.env` مقدارهای `${env:...}` را فراهم می‌کند. پردازشگر `transform/pve-identity` ویژگی‌های `pve.scope` / `pve.type` / `pve.id` را می‌سازد که قالب‌های هشدار داخلی Proxmox و فیلترهای داشبورد به آن‌ها متکی‌اند؛ اگر پیکربندی را سفارشی می‌کنید، آن را نگه دارید:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "به‌طور پیش‌فرض عامل فقط متریک می‌فرستد، پس زبانه **لاگ‌ها** خوشه خالی می‌ماند. سرویس‌های PVE در ژورنال systemd لاگ می‌نویسند، و پیکربندی همراه یک گیرنده `journald` غیرفعال‌شده با کامنت برای `pveproxy`، `pvedaemon`، `pve-firewall`، `pve-ha-crm`، `pve-ha-lrm`، `pvescheduler`، `pvestatd` و `qmeventd` دارد.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **عامل را روی یک گره PVE اجرا کنید.** ژورنال برای هر میزبان جداست، پس عامل راه دور نمی‌تواند آن را بخواند، و هر گره فقط ژورنال خودش را می‌فرستد. برای این‌که عامل متریک بیرون از خوشه بماند، به‌جای آن روی هر گره یک کالکتور دوم فقط برای لاگ‌ها اجرا کنید.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. کامنت گیرنده `journald` و خط لوله `logs` را در `otel-collector-config.yaml`، و دو حجم ژورنال را در `docker-compose.yml` بردارید.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **ایمیج کالکتور را عوض کنید.** ایمیج استاندارد `journalctl` ندارد و با کاربری اجرا می‌شود که نمی‌تواند ژورنال را بخواند. این پوشش را بسازید و `image:` را در `docker-compose.yml` به آن ارجاع دهید:",
  "4. Apply it:": "4. آن را اعمال کنید:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "ترجیح می‌دهید ایمیج استاندارد را نگه دارید؟ مستندات یک جایگزین با `filelog` دارد که `/var/log/syslog` را دنبال می‌کند: [فرستادن لاگ‌های سرویس‌های Proxmox](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "هر ویژگی منبعی که با پیشوند `oneuptime.label.` شروع شود، برچسب پروژه‌ای روی خوشه می‌شود: `oneuptime.label.<dimension>=<value>` همان برچسب `<dimension>:<value>` است. آن‌ها را در `otel-collector-config.yaml` به پردازنده `resource`، کنار `proxmox.cluster.name`، اضافه کنید:",
  "Then restart the collector so it reads the new config:":
    "سپس کالکتور را دوباره راه بیندازید تا پیکربندی تازه را بخواند:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "خوشه با برچسب‌های `team:platform` و `env:production` نمایان می‌شود. برچسب‌ها بدون حساسیت به بزرگی و کوچکی حروف مقایسه می‌شوند، پس برچسب موجود `Production` دوباره به کار می‌رود؛ برچسب‌هایی که در رابط کاربری OneUptime افزوده شده‌اند هرگز به دست عامل حذف نمی‌شوند.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` همچنین **`oneuptime-proxmox-ai-agent`** را اجرا می‌کند. وقتی هوش مصنوعی OneUptime رخداد یا هشداری را روی این خوشه بررسی می‌کند، فرمان‌های فقط‌خواندنی `pvesh` را از طریق آن اجرا می‌کند: `pvesh get /cluster/status`، وضعیت فعلی یک مهمان، کارهای ناموفق یک گره. هیچ فایل اجرایی `pvesh` در آن نیست: هر فرمان به یک فراخوانی API Proxmox VE روی `PVE_HOST` تبدیل می‌شود. با نام خوشه `PROXMOX_CLUSTER_NAME` ثبت می‌شود و در صفحه **هوش مصنوعی ← عامل هوش مصنوعی** خوشه نمایان می‌شود.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **توکن API مرز قطعی است.** با توکن PVEAuditor کالکتور (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`) می‌خواند که فقط می‌تواند بخواند و کار دیگری نمی‌کند. اگر اکسپورتر خودتان را اجرا می‌کنید و توکنی در `.env` ندارید، یکی اضافه کنید.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- تا وقتی `ONEUPTIME_AI_ALLOW_WRITES=true` را نگذارید **فقط‌خواندنی** است. اصلاح‌ها (راه‌اندازی یا راه‌اندازی دوباره یک مهمان) به توکن جداگانه‌ای هم نیاز دارند که بتواند مهمان‌ها را روشن و خاموش کند، با نام `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`؛ فرمان‌های `pveum` در README عامل آمده‌اند. اگر عامل در یکی از مهمان‌های همین خوشه اجرا می‌شود، VMID آن مهمان را در `ONEUPTIME_AI_PROTECTED_TARGETS` بگذارید.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- بررسی کنید: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- از هوش مصنوعی OneUptime استفاده نمی‌کنید؟ سرویس `oneuptime-proxmox-ai-agent` را از `docker-compose.yml` حذف کنید.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "این‌که چه چیزی را می‌تواند اجرا کند و اصلاح‌ها چطور کار می‌کنند: [عامل‌های هوش مصنوعی زیرساخت](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**ارتقا**: ایمیج کالکتور در `docker-compose.yml` ثابت شده و پیکربندی‌اش فایلی کنار آن است، پس فقط کشیدن ایمیج عامل را جلو نمی‌برد. اسکریپت نصب را دوباره اجرا کنید. هر مقدار `.env` موجود شما را دوباره به کار می‌برد (چیزی دوباره پرسیده نمی‌شود)، آخرین `docker-compose.yml` و `otel-collector-config.yaml` را دانلود می‌کند (فایلی که ویرایش کرده‌اید کنار فایل تازه با نام `<file>.bak.<timestamp>` نگه داشته می‌شود)، ایمیج‌ها را می‌کشد و عامل را با آن‌ها از نو می‌سازد:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "پیکربندی، نسخه کالکتوری را که ثابت می‌کند به‌عنوان **نسخه عامل** خوشه گزارش می‌دهد. وقتی این OneUptime نسخه تازه‌تری را ثابت کند، یک نشانه هشدار کنار آن این فرمان‌ها را باز می‌کند.",
  "**Uninstall** the agent:": "عامل را **حذف نصب** کنید:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "سپس اگر دیگر به توکن API نیاز ندارید، آن را در *Datacenter → Permissions → API Tokens* حذف کنید.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` کل زنجیره را بررسی می‌کند (محیط اجرای کانتینر، جمع‌آوری از اکسپورتر، زدن نام خوشه، شکل توکن، متریک‌های خود کالکتور) و مستقیم از OneUptime می‌پرسد که آیا کلید دریافت داده شما را می‌پذیرد. این آخرین بررسی از همه مهم‌تر است: نقاط پایانی OTLP در OneUptime کلید نادرست را با `401` یا `422` رد می‌کنند، که کالکتور آن را در هر دسته به‌صورت یک خط `Exporting failed` لاگ می‌کند که به‌آسانی از چشم می‌افتد، پس اسکریپت از `GET /otlp/v1/validate` حکم مستقیم 200/401 را می‌خواهد.",
  "It ends with a verdict naming the most likely cause.":
    "در پایان حکمی می‌دهد که محتمل‌ترین علت را نام می‌برد.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. بررسی کنید که عامل در حال اجراست (در `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. لاگ‌های عامل را از نظر خطا بررسی کنید: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. تأیید کنید که نشانی OneUptime و کلید دریافت داده شما درست هستند.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. مطمئن شوید که ماشین عامل از طریق شبکه به نمونه OneUptime دسترسی دارد.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. بررسی کنید که اکسپورتر پاسخ می‌دهد. اکسپورتر همراه درگاهش را روی میزبان منتشر نمی‌کند، پس curl را درون فضای نام شبکه آن اجرا کنید؛ باید خط‌های متریک `pve_*` را ببینید (برای اکسپورتر خودتان، مستقیم با curl به `host:9221` آن بروید):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. بررسی کنید که توکن API نقش **PVEAuditor** را روی مسیر `/` دارد، هم روی توکن و هم روی کاربرش.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. لاگ‌های کالکتور را از نظر خطاهای جمع‌آوری یا صادرکردن بررسی کنید (در `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "توکن API نادرست است یا مجوزهای لازم را ندارد. قالب شناسه توکن (`user@realm!tokenname`)، رمز، و این‌که نقش **PVEAuditor** روی مسیر `/` به توکن و کاربرش داده شده است را دوباره بررسی کنید. لاگ‌های خود اکسپورتر پاسخ API را نشان می‌دهند: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'سری‌های مهمان (شناسه‌های `qemu/*`، `lxc/*`) از کالکتور خوشه‌ای اکسپورتر می‌آیند. پیکربندی همراه آن را فعال می‌کند (پارامتر جمع‌آوری `cluster=1`)؛ اگر پیکربندی را سفارشی کرده‌اید، پارامتر `cluster: ["1"]` را برگردانید.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "پرچم‌های شروع هنگام بوت و کارهای تکثیر آن‌ها از گره‌ای می‌آیند که روی آن اجرا می‌شوند، و عامل فقط گره‌های `PVE_NODES` را می‌خواند. نشانی خود هر گره را آن‌جا بنویسید، مثل `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`، و آن را با `docker compose up -d` در `/opt/oneuptime-proxmox-agent` اعمال کنید. اگر کالکتور پس از یک ویرایش دیگر راه نیفتاد، فهرست کروشه‌هایش را از دست داده است. `troubleshoot.sh` هر گره فهرست را بررسی می‌کند.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "هویت خوشه از `PROXMOX_CLUSTER_NAME` می‌آید که روی هر متریک به‌عنوان `proxmox.cluster.name` زده می‌شود. آن را در `.env` درست کنید و با `docker compose up -d` در `/opt/oneuptime-proxmox-agent` اعمال کنید؛ توجه داشته باشید که نام تازه یک خوشه تازه ثبت می‌کند.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **نام خوشه**: دقیقاً **`pve-1`** را وارد کنید؛ نام دیگری یک خوشه تازه ثبت می‌کند.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "هویت خوشه از `PROXMOX_CLUSTER_NAME` می‌آید که روی هر متریک به‌عنوان `proxmox.cluster.name` زده می‌شود. این خوشه **`pve-1`** است. آن را در `.env` درست کنید و با `docker compose up -d` در `/opt/oneuptime-proxmox-agent` اعمال کنید؛ توجه داشته باشید که نام تازه یک خوشه تازه ثبت می‌کند.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "فرمان از پیش نشانی OneUptime و کلید دریافت داده شما را در خود دارد. بقیه را اسکریپت می‌پرسد:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "به Proxmox VE 8.3 یا تازه‌تر نیاز دارد. فرمان اول یک مقصد وب‌هوک با نام `oneuptime` اضافه می‌کند که هر اعلان را به‌صورت یک لاگ از این خوشه به OneUptime می‌فرستد و کلید و نام خوشه را در رمزهای خود نگه می‌دارد. فرمان دوم همه اعلان‌ها را به آن می‌فرستد. `my-proxmox-cluster` را با نام خوشه‌ای که به عامل داده‌اید جایگزین کنید تا اعلان‌ها به همان خوشه برسند.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "پس از آن صفحه هر مهمان آخرین پشتیبان آن را نشان می‌دهد و **توصیه‌ها**ی خوشه هشدارهای **Backup Job Failed** و **Node Fenced** را پیشنهاد می‌کنند. برای توقف فرستادن آن‌ها:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "به Proxmox VE 8.3 یا تازه‌تر نیاز دارد. فرمان اول یک مقصد وب‌هوک با نام `oneuptime` اضافه می‌کند که هر اعلان را به‌صورت یک لاگ از این خوشه به OneUptime می‌فرستد و کلید و نام خوشه را در رمزهای خود نگه می‌دارد. فرمان دوم همه اعلان‌ها را به آن می‌فرستد. فرمان از قبل **`pve-1`** را نام می‌برد، پس اعلان‌ها به این خوشه می‌رسند.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "`docker-compose.yml` و `otel-collector-config.yaml` را از این OneUptime در یک پوشه تازه دانلود کنید:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "یک فایل `.env` کنار آن‌ها بسازید؛ رمز توکن در آن است، پس آن را با `chmod 600 .env` خصوصی نگه دارید:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- `my-proxmox-cluster` را با نامی برای این خوشه جایگزین کنید، مثلاً `pve-prod`. خوشه با همین نام در OneUptime نشان داده می‌شود، پس آن را ثابت نگه دارید: نام تازه یک خوشه تازه ثبت می‌کند.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- `PVE_HOST` را روی هر گره‌ای از خوشه بگذارید: تا وقتی API آن پاسخ ندهد، عامل خوشه را از گره بعدی در `PVE_NODES` می‌خواند، پس به هیچ IP مجازی‌ای نیاز ندارد.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- `PVE_NODES` را روی نشانی خود هر گره درون کروشه بگذارید، هرگز یک IP مجازی. اکسپورتر شروع هنگام بوت (Guest Down)، تکثیر و اشتراک را فقط برای گره‌ای می‌خواند که از آن می‌پرسد، پس از هر گره به نوبت پرسیده می‌شود؛ گره‌ای که جا بماند دیده نمی‌شود.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- توکن مرحله قبل را وارد کنید. `COMPOSE_PROFILES=pve-exporter` همچنین prometheus-pve-exporter همراه را راه می‌اندازد که API را با همین توکن می‌خواند.",
  "Start the agent:": "عامل را راه بیندازید:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در مرحله 1 یک کلید دریافت داده انتخاب کنید.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "عامل این‌ها را از فایل `.env` کنار `docker-compose.yml` می‌خواند. پس از تغییر هر کدام، آن را با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "`COMPOSE_PROFILES` را از `.env` کنار بگذارید و به‌جای آن عامل را به اکسپورتر خودتان ارجاع دهید (`host:port`، بدون شِما):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "این‌ها را در پوشه عامل اجرا کنید، همان که `docker-compose.yml` در آن است.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**ارتقا**: ایمیج کالکتور در `docker-compose.yml` ثابت شده و پیکربندی‌اش فایلی کنار آن است، پس فقط کشیدن ایمیج عامل را جلو نمی‌برد. هر دو فایل را دوباره دانلود کنید؛ `.env` شما می‌ماند، و تغییری که در هر یک از فایل‌ها داده بودید باید دوباره انجام شود:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "سپس ایمیج‌ها را بکشید و عامل را از نو بسازید تا کالکتور پیکربندی تازه‌اش را بخواند:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. بررسی کنید که عامل در حال اجراست (در پوشه عامل): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. لاگ‌های کالکتور را از نظر خطاهای جمع‌آوری یا صادرکردن بررسی کنید (در پوشه عامل): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "پرچم‌های شروع هنگام بوت و کارهای تکثیر آن‌ها از گره‌ای می‌آیند که روی آن اجرا می‌شوند، و عامل فقط گره‌های `PVE_NODES` را می‌خواند. نشانی خود هر گره را آن‌جا بنویسید، مثل `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`، و آن را با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید. اگر کالکتور پس از یک ویرایش دیگر راه نیفتاد، فهرست کروشه‌هایش را از دست داده است. `troubleshoot.sh` هر گره فهرست را بررسی می‌کند.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "هویت خوشه از `PROXMOX_CLUSTER_NAME` می‌آید که روی هر متریک به‌عنوان `proxmox.cluster.name` زده می‌شود. آن را در `.env` درست کنید و با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید؛ توجه داشته باشید که نام تازه یک خوشه تازه ثبت می‌کند.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- این فرمان عامل را برای **`pve-1`** نصب می‌کند: `PROXMOX_CLUSTER_NAME` را دقیقاً همان‌طور که هست نگه دارید، وگرنه داده‌ها به‌عنوان یک خوشه تازه ثبت می‌شوند.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "هویت خوشه از `PROXMOX_CLUSTER_NAME` می‌آید که روی هر متریک به‌عنوان `proxmox.cluster.name` زده می‌شود. این خوشه **`pve-1`** است. آن را در `.env` درست کنید و با `docker compose up -d` در پوشه‌ای که `docker-compose.yml` در آن است اعمال کنید؛ توجه داشته باشید که نام تازه یک خوشه تازه ثبت می‌کند.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**بدون عامل، اما با داده کمتر.** Proxmox VE 9.0 و تازه‌تر خودشان متریک‌های هر گره را به OneUptime می‌فرستند. وضعیت HA، شروع هنگام بوت (که **Guest Down** به کار می‌برد)، پوشش پشتیبان‌گیری و تکثیر فرستاده نمی‌شوند؛ اگر به آن‌ها نیاز دارید، اسکریپت نصب یا Docker Compose را به کار ببرید. برای یک خوشه یکی از این دو را به کار ببرید: اجرای هر دو هر منبع را دو بار گزارش می‌کند.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 یا تازه‌تر**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "رابط وب Proxmox، برای افزودن یک سرور متریک در *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "هر گره بتواند روی درگاه `443` به `<YOUR_ONEUPTIME_HOST>` دسترسی داشته باشد",
  "| Field | Value |": "| فیلد | مقدار |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (سرور) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (درگاه) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (پروتکل) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (مسیر) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |": "| **Headers** (هدرها) | JSON زیر |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "آن را یک بار برای مرکز داده اضافه کنید: پس از آن هر گره خوشه متریک‌های خودش را می‌فرستد.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime این ارسال را به همان سری‌های `pve_*` تبدیل می‌کند که عامل می‌فرستد. خوشه با نام خوشه Proxmox شما خودبه‌خود ثبت می‌شود (گره مستقل با نام گره خودش) و در بخش **Proxmox** نمایان می‌شود، جایی که صفحه‌های گره‌ها، مهمان‌ها و ذخیره‌سازی، نمودارهای نمای کلی، فهرست متریک‌ها و قالب‌های هشدار CPU / حافظه / ذخیره‌سازی همان‌طور کار می‌کنند که با عامل.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "هر گره فقط وضعیت خودش را می‌فرستد، پس گرهی که از کار بیفتد نمی‌تواند از کار افتادنش را خودش گزارش کند؛ گره‌هایی که هنوز کار می‌کنند به‌جای آن گزارش می‌دهند:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- حدود 2 دقیقه پس از آخرین گزارشش، در صفحه‌های Proxmox **آفلاین** نشان داده می‌شود و حدود 5 دقیقه بعد **Node Offline** اجرا می‌شود.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** هم آن را آفلاین به شمار می‌آورد؛ این هشدار حدود 7–9 دقیقه پس از خاموش شدن گره اجرا می‌شود، وقتی کل پنجره 5 دقیقه‌ای آن گزارش داشته باشد.",
  "- Its next report brings it back.": "- گزارش بعدی‌اش آن را برمی‌گرداند.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "آفلاین یعنی «گزارش‌دادن متوقف شد»: یک `pvestatd` گیرکرده، یک `pmxcfs` متوقف‌شده یا شبکه قطع‌شده تا OneUptime همه یکسان دیده می‌شوند. وقتی یک میزبان مستقل یا کل یک خوشه خاموش شود، کسی نمی‌ماند که آن را گزارش کند، پس به‌جای آن خوشه **قطع‌شده** می‌شود. گرهی که بیش از 7 روز خاموش بماند دیگر گزارش نمی‌شود. این گزارش‌ها در کاوشگر متریک با `oneuptime.proxmox.inferred=not-reporting` علامت خورده‌اند.",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "خوشه با نام خوشه Proxmox خود ثبت می‌شود؛ گره مستقل با نام گره خود ثبت می‌شود. اگر ویژگی منبع `proxmox.cluster.name` در *Resource Attributes* سرور متریک تنظیم شده باشد، به‌جای آن همچنان همان به کار می‌رود.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime این ارسال را به سری‌های `pve_*` تبدیل می‌کند که عامل می‌فرستد، پس صفحه‌های Proxmox و قالب‌های هشدار CPU / حافظه / ذخیره‌سازی بدون تغییر کار می‌کنند. سری‌های اصلی `proxmox_*` هم برای هر چیز دیگری که Proxmox VE گزارش می‌کند در کاوشگر متریک در دسترس می‌مانند.",
  "Some alert templates need data only the agent collects:":
    "برخی قالب‌های هشدار به داده‌ای نیاز دارند که فقط عامل جمع‌آوری می‌کند:",
  "| Needs the agent | Why |": "| به عامل نیاز دارد | چرا |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| وضعیت HA | فرستاده نمی‌شود: قالب **HA Resource in Error State** به عامل نیاز دارد |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| پرچم شروع هنگام بوت | فرستاده نمی‌شود: **Guest Down** که فقط برای مهمان‌هایی هشدار می‌دهد که برای شروع هنگام بوت تنظیم شده‌اند، به عامل نیاز دارد |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| پوشش پشتیبان‌گیری و تکثیر | فرستاده نمی‌شوند: **Guest Not Backed Up** و **Replication Failing** به عامل نیاز دارند |",
  "Every node has stopped reporting, or never started.":
    "همه گره‌ها گزارش‌دادن را متوقف کرده‌اند، یا هیچ‌وقت شروع نکرده‌اند.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. در *Datacenter → Metric Server* ورودی OpenTelemetry را بررسی کنید: سرور `<YOUR_ONEUPTIME_HOST>`، درگاه `443`، پروتکل `https`، مسیر `/otlp/v1/metrics` و هدر `x-oneuptime-token` با یک کلید از مرحله 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. بررسی کنید که گره‌ها از طریق شبکه به `<YOUR_ONEUPTIME_HOST>` دسترسی دارند.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "گزارش‌دادنش متوقف شده است: گرهی که از کار افتاده، یک `pvestatd` گیرکرده، یک `pmxcfs` متوقف‌شده یا شبکه قطع‌شده تا OneUptime همه یکسان دیده می‌شوند. گزارش بعدی‌اش آن را برمی‌گرداند. اگر گره را از خوشه بیرون آورده‌اید، در صفحه آن **حذف گره** را به کار ببرید؛ وگرنه تا 7 روز آفلاین می‌ماند.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "ارسال بومی وضعیت HA، شروع هنگام بوت، پوشش پشتیبان‌گیری یا تکثیر را نمی‌فرستد. برای اجرای عامل به‌جای آن، در بالای این راهنما **اسکریپت نصب** یا **Docker Compose** را انتخاب کنید، و سرور متریک را حذف کنید، چون اجرای هر دو هر منبع را دو بار گزارش می‌کند.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "این خوشه در OneUptime **`pve-1`** است. اگر این نام خود خوشه Proxmox نیست، `proxmox.cluster.name` را در *Resource Attributes* سرور متریک روی `pve-1` بگذارید، وگرنه ارسال یک خوشه تازه ثبت می‌کند.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "به Proxmox VE 8.3 یا تازه‌تر نیاز دارد. فرمان اول یک مقصد وب‌هوک با نام `oneuptime` اضافه می‌کند که هر اعلان را به‌صورت یک لاگ از این خوشه به OneUptime می‌فرستد و کلید و نام خوشه را در رمزهای خود نگه می‌دارد. فرمان دوم همه اعلان‌ها را به آن می‌فرستد. `my-proxmox-cluster` را با نامی جایگزین کنید که خوشه با آن در OneUptime نمایان می‌شود: نام خوشه Proxmox آن، یا نام خود یک گره مستقل.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | خیر | نام کانتینر کالکتور (پیش‌فرض: `oneuptime-proxmox-agent`). عامل یک خوشه دوم روی همان ماشین به نام‌های خودش نیاز دارد: اسکریپت نصب، اگر آن‌ها را تنظیم نکنید، کانتینرهای عامل تازه را به نام پوشه‌اش می‌نامد و وقتی اسکریپت را دوباره اجرا می‌کنید آن‌ها را نگه می‌دارد |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | خیر | نام کانتینر sidecar جابه‌جایی خودکار API (پیش‌فرض: `oneuptime-pve-api-failover`). اسکریپت نصب، اگر آن را تنظیم نکنید، sidecar جابه‌جایی خودکار API یک خوشه دوم را به نام کالکتورش می‌نامد (`oneuptime-pve-api-failover-cluster2` کنار `oneuptime-proxmox-agent-cluster2`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر همراه (پیش‌فرض: `oneuptime-pve-exporter`). اسکریپت نصب، اگر آن را تنظیم نکنید، اکسپورتر همراه یک خوشه دوم را به نام کالکتورش می‌نامد (`oneuptime-pve-exporter-cluster2` کنار `oneuptime-proxmox-agent-cluster2`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | خیر | نام کانتینر عامل هوش مصنوعی (پیش‌فرض: `oneuptime-proxmox-ai-agent`). اسکریپت نصب، اگر آن را تنظیم نکنید، عامل هوش مصنوعی یک خوشه دوم را به نام کالکتورش می‌نامد (`oneuptime-proxmox-ai-agent-cluster2` کنار `oneuptime-proxmox-agent-cluster2`) و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "یک عامل یک خوشه را می‌خواند. برای خوشه دوم، عامل دومی را در پوشه‌ای جداگانه و با نام‌های کانتینر خودش نصب کنید، چون دو کانتینر نمی‌توانند یک نام داشته باشند:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "اسکریپت، اگر متغیرهای کانتینرها را تنظیم نکنید، مثلاً `PROXMOX_AGENT_CONTAINER_NAME`، کانتینرها را به نام پوشه می‌نامد، مثلاً `oneuptime-proxmox-agent-cluster2`. اسکریپت نام‌ها را در `.env` همان عامل نگه می‌دارد، پس اجرای دوباره اسکریپت با همان `INSTALL_DIR` برای ارتقای عامل آن‌ها را حفظ می‌کند، و عاملی که `container_name` آن را زمانی در `docker-compose.yml` ویرایش کرده‌اید همان نام را نگه می‌دارد.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "به هر پوشه نامی از آن خودش بدهید: Docker Compose هر پروژه را فقط به نام پوشه‌اش می‌نامد، پس اسکریپت پوشه‌ای را که هم‌نام پوشه‌ای باشد که در جای دیگری عاملی را اجرا می‌کند نمی‌پذیرد. پوشه را با `-d` به اسکریپت تشخیصی بدهید.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | خیر | نام کانتینر کالکتور (پیش‌فرض: `oneuptime-proxmox-agent`). عامل یک خوشه دوم روی همان ماشین به نام خودش نیاز دارد |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | خیر | نام کانتینر sidecar جابه‌جایی خودکار API (پیش‌فرض: `oneuptime-pve-api-failover`). عامل یک خوشه دوم روی همان ماشین به نام خودش نیاز دارد |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | خیر | نام کانتینر اکسپورتر همراه (پیش‌فرض: `oneuptime-pve-exporter`). عامل یک خوشه دوم روی همان ماشین به نام خودش نیاز دارد |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | خیر | نام کانتینر عامل هوش مصنوعی (پیش‌فرض: `oneuptime-proxmox-ai-agent`). عامل یک خوشه دوم روی همان ماشین به نام خودش نیاز دارد |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "یک عامل یک خوشه را می‌خواند. برای خوشه دوم، عامل دومی را در پوشه‌ای جداگانه و با نام‌های کانتینر خودش راه‌اندازی کنید، چون دو کانتینر نمی‌توانند یک نام داشته باشند. آن‌ها را در `.env` همان عامل تنظیم کنید:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "به هر پوشه نامی از آن خودش بدهید: Docker Compose هر پروژه را فقط به نام پوشه‌اش می‌نامد، پس پوشه دومی با همان نام جای کانتینرهای عامل اول را می‌گیرد. نام‌ها را در `docker-compose.yml` نگذارید، چون ارتقا این فایل را جایگزین می‌کند.",
};

export default TRANSLATION;
