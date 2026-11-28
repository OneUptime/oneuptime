import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 یا جدیدتر با افزونه Docker Compose v2، روی ماشینی که از طریق HTTPS (TCP 443) به نشانی مدیریتی FlashArray دسترسی داشته باشد",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "یک حساب مدیر روی FlashArray، برای ساختن کاربر فقط‌خواندنی عامل",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "توکن را **بدون تاریخ انقضا** بسازید، وگرنه عامل در روزی که توکن منقضی شود از کار می‌افتد.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "با SSH و به‌عنوان مدیر به FlashArray وصل شوید. فرمان اول گذرواژه کاربر تازه را می‌پرسد؛ فرمان دوم توکن API آن را چاپ می‌کند:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. **Settings → Users and Policies** را باز کنید (در نسخه‌های قدیمی‌تر **Settings → Access**).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. از منوی ⋮ در پنل **Users**، گزینه **Create User…** را انتخاب کنید، نام آن را `oneuptime` بگذارید و نقش **readonly** را به آن بدهید.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. از منوی ⋮ کاربر تازه، گزینه **Create API Token…** را انتخاب کنید، **Expires In** را خالی بگذارید و توکن را کپی کنید.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "خطی مانند `purefa_info{...} 1` یعنی آرایه متریک‌هایش را به‌صورت بومی ارائه می‌دهد: ادامه دهید. پاسخ **404** یعنی Purity//FA آن قدیمی‌تر است (Pure نقطه پایانی بومی را برای 6.7.0 و بالاتر مستند کرده است؛ اطلاعیه منسوخ‌شدن صادرکننده آن 6.6.11 و بالاتر را می‌گوید): در عوض، در بالای این راهنما **FlashArray، Purity قدیمی‌تر** را انتخاب کنید.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "خط اول اسکریپت را با نام `install.sh` دانلود می‌کند تا بتوانید پیش از اجرا آن را بخوانید.",
  "The command carries the platform you picked above. The script asks for:":
    "فرمان، پلتفرمی را که در بالا انتخاب کردید در خود دارد. اسکریپت این‌ها را می‌پرسد:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- **نشانی OneUptime** و **کلید دریافت داده** شما، که هر دو در مرحله 1 نشان داده می‌شوند (یک کلید را آن‌جا انتخاب کنید تا این‌جا پر شوند)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- یک **نام آرایه**: نامی که آرایه با آن در OneUptime نشان داده می‌شود. به هر آرایه نام خودش را بدهید و آن را ثابت نگه دارید: نام تازه یک آرایه ذخیره‌سازی تازه ثبت می‌کند",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- **نشانی مدیریتی** FlashArray (نام میزبان یا IP، بدون `https://`) و **توکن API** کاربر فقط‌خواندنی، که اسکریپت آن را بدون نمایش روی صفحه می‌خواند",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- این‌که گواهی آرایه بررسی شود یا نه: پاسخ **N** بدهید، مگر آن‌که آرایه گواهی‌ای از یک CA مورد اعتماد شما داشته باشد (آرایه‌ها با یک گواهی خودامضا عرضه می‌شوند)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "در `/opt/oneuptime-storage-array-agent` نصب می‌شود، یک فایل `.env` می‌نویسد که فقط شما می‌توانید بخوانید (توکن API در آن است) و عامل را با Docker Compose راه می‌اندازد.",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "فایل compose و پیکربندی‌های کالکتور را از این OneUptime در یک پوشه تازه دانلود کنید:",
  "Create a `.env` file next to them:": "یک فایل `.env` کنار آن‌ها بسازید:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- `my-storage-array` را با نامی برای این آرایه جایگزین کنید، مثلاً `fa-prod-01`. آرایه با همین نام در OneUptime نشان داده می‌شود، پس آن را ثابت نگه دارید: نام تازه یک آرایه ذخیره‌سازی تازه ثبت می‌کند.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- `PURE_FA_ENDPOINT` را روی نشانی مدیریتی FlashArray (نام میزبان یا IP، بدون `https://`) و `PURE_FA_API_TOKEN` را روی توکن API کاربر فقط‌خواندنی تنظیم کنید. `chmod 600 .env` را اجرا کنید: این فایل توکن را در خود دارد.",
  "Start the agent:": "عامل را راه بیندازید:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در مرحله 1 یک کلید دریافت داده انتخاب کنید.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "در لاگ‌ها دنبال `Everything is ready. Begin running and processing data.` بگردید. سپس آرایه پس از نخستین اسکرپ خودکار در بخش **آرایه‌های ذخیره‌سازی** نمایان می‌شود، معمولاً در یکی دو دقیقه.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "اسکریپت نصب این‌ها را در `/opt/oneuptime-storage-array-agent/.env` می‌نویسد؛ نصب با Docker Compose آن‌ها را از فایل `.env` کنار `docker-compose.yml` می‌خواند. پس از تغییر هر کدام، آن را با `docker compose up -d` در پوشه عامل اعمال کنید.",
  "| Variable | Required | Description |": "| متغیر | الزامی | توضیح |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | بله | نشانی نمونه OneUptime شما (مثلاً `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | بله | کلید دریافت داده تله‌متری، همانی که در مرحله 1 انتخاب شد |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | بله | نامی که این آرایه با آن در OneUptime ثبت می‌شود. روی هر متریک به‌عنوان ویژگی منبع `storage.array.name` زده می‌شود. آن را ثابت نگه دارید: تغییرش یک آرایه ذخیره‌سازی تازه ثبت می‌کند |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | خیر | پلتفرم، که به‌عنوان ویژگی منبع `storage.system` زده می‌شود: `purestorage.flasharray` یا `purestorage.flashblade` (پیش‌فرض: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | خیر | کدام پیکربندی همراه اجرا شود: `otel-collector-config.yaml` (FlashArray، بومی؛ پیش‌فرض)، `otel-collector-config.flasharray-exporter.yaml` (FlashArray قدیمی‌تر) یا `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | خیر | صادرکننده‌ای را که پیکربندی لازم دارد راه می‌اندازد: برای پیکربندی بومی FlashArray خالی، برای بقیه `flasharray-exporter` یا `flashblade` |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | نشانی مدیریتی FlashArray: نام میزبان یا IP، بدون `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | توکن API کاربر FlashArray با نقش readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | نشانی مدیریتی FlashBlade: نام میزبان یا IP، بدون `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | توکن API کاربر FlashBlade با نقش readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | خیر | `true` گواهی خودامضای آرایه را روی نقطه پایانی بومی می‌پذیرد؛ `false` آن را بررسی می‌کند (پیش‌فرض: `true`). صادرکننده‌های Pure هرگز گواهی آرایه را بررسی نمی‌کنند، پس این متغیر روی آن‌ها اثری ندارد |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | خیر | نام کانتینر عامل (پیش‌فرض: `oneuptime-storage-array-agent`). عامل آرایه دوم روی همان ماشین به نام خودش نیاز دارد: اسکریپت نصب، اگر آن را تنظیم نکنید، عامل تازه را به نام پوشه‌اش می‌نامد و وقتی اسکریپت را دوباره اجرا می‌کنید آن را نگه می‌دارد |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- کالکتور نقطه پایانی OpenMetrics خود FlashArray را از طریق HTTPS و با توکن به‌عنوان اعتبارنامه Bearer می‌خواند: هیچ صادرکننده‌ای اجرا نمی‌شود.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **یک کار اسکرپ برای هر نقطه پایانی**، هر کدام با تناوبی که ارزشش را دارد: `/metrics/array` هر 60 ثانیه؛ `/metrics/volumes`، `/metrics/hosts` و `/metrics/pods` هر 2 دقیقه؛ `/metrics/directories` هر 30 دقیقه، چون محاسبه فضای دایرکتوری‌ها برای آرایه پرهزینه است.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **هر کار روی سری‌هایش برچسب `scrape_endpoint: <endpoint>` می‌زند**، تا OneUptime بداند هر دسته فهرست کامل کدام اشیاست؛ شیء حذف‌شده این‌گونه از موجودی بیرون می‌رود. برچسب‌ها را همان‌طور که عرضه شده‌اند نگه دارید.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **تأخیر به‌ازای هر حجم و هر میزبان سه بُعد را نگه می‌دارد** (`usec_per_read_op`، `usec_per_write_op`، `usec_per_mirrored_write_op`)؛ یک قاعده `metric_relabel_configs` تفکیک QoS، صف، SAN و زمان سرویس را کنار می‌گذارد، که شمار سری‌های یک آرایه بزرگ را چند برابر می‌کند. تفکیک کل آرایه حفظ می‌شود.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **بدون `send_batch_max_size`.** OneUptime موجودی را از یک اسکرپ کامل از نو می‌سازد، پس پردازنده `batch` هرگز یک اسکرپ را تقسیم نمی‌کند.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "این همان `otel-collector-config.yaml` کاملی است که عامل اجرا می‌کند؛ فایل `.env` مقدارهای `${env:...}` را فراهم می‌کند:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "عامل تا وقتی گیرنده‌های syslog آن را روشن نکنید فقط متریک می‌فرستد. آرایه‌ها هشدارها و رویدادهای ممیزی‌شان را به‌صورت syslog ارسال می‌کنند؛ عامل روی هر خط `storage.array.name` را می‌زند، پس آن‌ها به صفحه **لاگ‌ها** این آرایه می‌رسند.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. در `otel-collector-config.yaml`، گیرنده‌های `syslog/tcp` و `syslog/udp` و خط لوله `logs` را از حالت توضیح خارج کنید. مهرهای زمانی syslog کلاسیک BSD منطقه زمانی ندارند: `location` را روی منطقه زمانی آرایه تنظیم کنید، مگر آن‌که ساعت آن روی UTC کار کند.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. در `docker-compose.yml`، بلوک `ports:` را که `5514/tcp` و `5514/udp` را منتشر می‌کند از حالت توضیح خارج کنید، و درگاه را در دیوار آتش ماشین برای شبکه مدیریتی آرایه باز کنید.",
  "3. Apply both:": "3. هر دو را اعمال کنید:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. روی FlashArray و به‌عنوان مدیر، **Settings → System → Syslog Servers** را باز کنید، `udp://<agent-host>:5514` (یا `tcp://<agent-host>:5514`) را اضافه کنید و یک پیام آزمایشی بفرستید.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "هر ویژگی منبعی که با پیشوند `oneuptime.label.` شروع شود، برچسب پروژه‌ای روی آرایه می‌شود: `oneuptime.label.<dimension>=<value>` همان برچسب `<dimension>:<value>` است. آن‌ها را به پردازنده `resource` در پیکربندی کالکتوری که به کار می‌برید، کنار `storage.array.name`، اضافه کنید:",
  "Then restart the collector so it reads the new config:":
    "سپس کالکتور را دوباره راه بیندازید تا پیکربندی تازه را بخواند:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "آرایه با برچسب‌های `team:storage` و `env:production` نمایان می‌شود. برچسب‌ها بدون حساسیت به بزرگی و کوچکی حروف مقایسه می‌شوند، پس برچسب موجود `Production` دوباره به کار می‌رود؛ برچسب‌هایی که در رابط کاربری OneUptime افزوده شده‌اند هرگز به دست عامل حذف نمی‌شوند.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "هر مقدار یک گیج است که خود FlashArray محاسبه می‌کند: تأخیر به‌ازای هر عملیات بر حسب میکروثانیه، توان عملیاتی بر ثانیه. صفحه‌های آرایه ذخیره‌سازی OneUptime، کاتالوگ متریک‌ها و الگوهای هشدار بر این‌ها بنا شده‌اند:",
  "| Endpoint | Data |": "| نقطه پایانی | داده |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **آرایه** (`/metrics/array`) | `purefa_info`، ظرفیت و کاهش داده (`purefa_array_space_*`)، کارایی، هشدارهای باز (`purefa_alerts_open`)، اجزای سخت‌افزاری، درایوها، کنترلرها و رابط‌های شبکه |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **حجم‌ها** (`/metrics/volumes`) | تأخیر، IOPS، پهنای باند، فضا و کاهش داده برای هر حجم |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **میزبان‌ها** (`/metrics/hosts`) | اتصال، حجم‌های متصل، تأخیر، IOPS و فضا برای هر میزبان |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **پادها** (`/metrics/pods`) | تأخیر پیوند نسخه‌های تکثیر ActiveCluster و ActiveDR، وضعیت میانجی، کارایی و فضا |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **دایرکتوری‌ها** (`/metrics/directories`) | فضا و کارایی دایرکتوری‌های مدیریت‌شده سرویس‌های فایل FlashArray |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "یک عامل یک آرایه را می‌خواند. برای پایش چند آرایه از یک ماشین، هر کدام را با `.env` خودش و نام کانتینر خودش در پوشه خودش نصب کنید، چون دو کانتینر نمی‌توانند یک نام داشته باشند:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "بدون `STORAGE_ARRAY_AGENT_CONTAINER_NAME`، اسکریپت نام کانتینر را از روی پوشه می‌گذارد. اسکریپت این نام را در `.env` همان عامل نگه می‌دارد، پس اجرای دوباره اسکریپت برای ارتقای عامل آن را حفظ می‌کند، و عاملی که `container_name` آن را زمانی در `docker-compose.yml` ویرایش کرده‌اید همان نام را نگه می‌دارد. با Docker Compose، به‌جای آن `STORAGE_ARRAY_AGENT_CONTAINER_NAME` را در `.env` هر عامل تنظیم کنید.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "عامل یک یونیت systemd همراه دارد که پوشه اسکریپت نصب، یعنی `/opt/oneuptime-storage-array-agent`، را فرض می‌گیرد. اسکریپت نصب آن را دانلود نمی‌کند، پس خودتان آن را بگیرید:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**ارتقا**: ایمیج کالکتور در `docker-compose.yml` ثابت شده و پیکربندی‌هایش فایل‌هایی کنار آن هستند، پس فقط کشیدن ایمیج عامل را جلو نمی‌برد. اسکریپت نصب را دوباره اجرا کنید. هر مقدار `.env` موجود شما را دوباره به کار می‌برد (چیزی دوباره پرسیده نمی‌شود)، آخرین `docker-compose.yml` و پیکربندی‌های کالکتور را دانلود می‌کند (فایلی که ویرایش کرده‌اید کنار فایل تازه با نام `<file>.bak.<timestamp>` نگه داشته می‌شود) و عامل را با آن‌ها از نو می‌سازد:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "عاملی که بیرون از `/opt/oneuptime-storage-array-agent` نصب شده است (مثلاً عامل آرایه دوم) به پوشه‌اش نیاز دارد: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "آن را با Docker Compose نصب کرده‌اید؟ در پوشه عامل، فایل compose و پیکربندی‌های کالکتور را دوباره دانلود کنید؛ `.env` شما می‌ماند، و تغییری که در هر کدام از آن‌ها داده‌اید باید دوباره انجام شود:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "سپس ایمیج‌ها را بکشید و عامل را از نو بسازید تا کالکتور پیکربندی تازه‌اش را بخواند:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "پیکربندی، نسخه کالکتوری را که ثابت می‌کند به‌عنوان **نسخه عامل** آرایه گزارش می‌دهد. وقتی این OneUptime نسخه تازه‌تری را ثابت کند، یک نشانه هشدار کنار آن این فرمان‌ها را باز می‌کند.",
  "**Uninstall** the agent:": "عامل را **حذف نصب** کنید:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "سپس اگر دیگر به کاربر فقط‌خواندنی و توکن API آن نیاز ندارید، آن‌ها را روی آرایه حذف کنید.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` کل زنجیره را بررسی می‌کند (محیط اجرای کانتینر، نقطه پایانی آرایه دقیقاً همان‌طور که کالکتور به آن می‌رسد، یعنی نقطه پایانی بومی یا صادرکننده Pure، همراه با DNS، TLS و توکن API، زدن نام آرایه، متریک‌های خود کالکتور) و مستقیم از OneUptime می‌پرسد که آیا کلید دریافت داده شما را می‌پذیرد. این آخرین بررسی از همه مهم‌تر است: نقاط پایانی OTLP در OneUptime کلید نادرست را با `401` یا `422` رد می‌کنند، که کالکتور آن را در هر دسته به‌صورت یک خط `Exporting failed` لاگ می‌کند که به‌آسانی از چشم می‌افتد، پس اسکریپت از `GET /otlp/v1/validate` حکم مستقیم 200/401 را می‌خواهد.",
  "It ends with a verdict naming the most likely cause.":
    "در پایان حکمی می‌دهد که محتمل‌ترین علت را نام می‌برد.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. لاگ‌های کالکتور را بررسی کنید: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` یعنی آرایه توکن API را رد کرده است، `404` یعنی FlashArray نقطه پایانی بومی ندارد، `x509` یعنی بررسی TLS در برابر گواهی خودامضای آرایه روشن است، `no such host` یا `connection refused` یعنی `PURE_FA_ENDPOINT` نادرست است، و `401` هنگام صدور یعنی کلید دریافت داده نادرست است.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. مطمئن شوید `STORAGE_ARRAY_NAME` تنظیم شده است: کشف بر پایه ویژگی منبع `storage.array.name` است، و کالکتور بدون آن راه نمی‌افتد.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. مطمئن شوید `STORAGE_ARRAY_COLLECTOR_CONFIG` و `COMPOSE_PROFILES` به یک پلتفرم اشاره می‌کنند.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "Purity//FA این FlashArray نقطه پایانی بومی OpenMetrics ندارد. `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` و `COMPOSE_PROFILES=flasharray-exporter` را در `.env` تنظیم کنید و `docker compose up -d` را اجرا کنید، یا `install.sh` را با گزینه Purity قدیمی‌تر دوباره اجرا کنید. پس از ارتقای آرایه به Purity//FA 6.7 یا بالاتر، به پیکربندی بومی برگردید و پروفایل را بردارید.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "بررسی کنید که توکن را چسبانده‌اید، نه گذرواژه کاربر را؛ که کاربر هنوز وجود دارد و نقش readonly را دارد؛ و که توکن منقضی نشده است. یک توکن تازه بسازید (روی FlashArray با `pureadmin create --api-token oneuptime`)، آن را به‌عنوان `PURE_FA_API_TOKEN` در `.env` بگذارید و `docker compose up -d` را اجرا کنید.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "آرایه‌ها به‌طور پیش‌فرض گواهی خودامضا ارائه می‌دهند که هیچ ایمیج Docker به آن اعتماد ندارد. `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` را تنظیم کنید (انتخاب عملی در یک شبکه مدیریتی خصوصی)، یا روی آرایه گواهی‌ای از یک CA نصب کنید که ایمیج کالکتور به آن اعتماد دارد.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` یا `pure-fb-exporter` در حال اجرا نیست: `COMPOSE_PROFILES` باید با `STORAGE_ARRAY_COLLECTOR_CONFIG` جور باشد؛ `flasharray-exporter` برای پیکربندی صادرکننده FlashArray، و `flashblade` برای پیکربندی FlashBlade. `.env` را درست کنید و `docker compose up -d` را اجرا کنید؛ سپس `docker compose ps` صادرکننده را فهرست می‌کند.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. بررسی کنید که عامل در حال اجراست: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. لاگ‌های عامل را از نظر خطا بررسی کنید: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. تأیید کنید که نشانی OneUptime و کلید دریافت داده شما درست هستند.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. مطمئن شوید که ماشین عامل از طریق شبکه به نمونه OneUptime دسترسی دارد.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "هویت آرایه از `STORAGE_ARRAY_NAME` می‌آید که روی هر متریک به‌عنوان `storage.array.name` زده می‌شود. آن را در `.env` درست کنید و با `docker compose up -d` در پوشه عامل اعمال کنید؛ توجه داشته باشید که نام تازه یک آرایه ذخیره‌سازی تازه ثبت می‌کند.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "آرایه را با نام **`array-1`** ثبت می‌کند، همان نامی که این آرایه در OneUptime دارد.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- این فرمان عامل را برای **`array-1`** نصب می‌کند: `STORAGE_ARRAY_NAME` را دقیقاً همان‌طور که هست نگه دارید، وگرنه داده‌ها به‌عنوان یک آرایه ذخیره‌سازی تازه ثبت می‌شوند.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "هویت آرایه از `STORAGE_ARRAY_NAME` می‌آید که روی هر متریک به‌عنوان `storage.array.name` زده می‌شود. این آرایه **`array-1`** است. آن را در `.env` درست کنید و با `docker compose up -d` در پوشه عامل اعمال کنید؛ توجه داشته باشید که نام تازه یک آرایه ذخیره‌سازی تازه ثبت می‌کند.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "فرمان از پیش نشانی OneUptime، کلید دریافت داده شما و پلتفرمی را که در بالا انتخاب کردید در خود دارد. اسکریپت این‌ها را می‌پرسد:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "دسترسی از آن ماشین به `quay.io`، جایی که Docker ایمیج صادرکننده Pure را از آن می‌کشد",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter`، صادرکننده Pure یعنی `pure-fa-exporter` را کنار کالکتور راه می‌اندازد؛ این دو باید با هم جور باشند.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` در پوشه عامل **`pure-fa-exporter`** را هم فهرست می‌کند، یعنی صادرکننده Pure که کالکتور FlashArray را از طریق آن می‌خواند.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- کالکتور FlashArray را از طریق `pure-fa-exporter`، صادرکننده Pure، می‌خواند که با توکنی که کالکتور در هر اسکرپ می‌فرستد به REST API در FlashArray وارد می‌شود. درگاه صادرکننده درون شبکه compose می‌ماند.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 یا جدیدتر با افزونه Docker Compose v2، روی ماشینی که از طریق HTTPS (TCP 443) به نشانی مدیریتی FlashBlade دسترسی داشته باشد",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "یک حساب مدیر روی FlashBlade، برای ساختن کاربر فقط‌خواندنی عامل",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "روی FlashBlade و به‌عنوان مدیر، کاربری به نام `oneuptime` با نقش **readonly** بسازید (در تنظیمات کاربران رابط گرافیکی FlashBlade، یا با `pureadmin` در خط فرمان Purity//FB) و برای آن یک **توکن API** بسازید. توکن را **بدون تاریخ انقضا** بسازید، وگرنه عامل در روزی که توکن منقضی شود از کار می‌افتد.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "توکن‌های API در FlashBlade با `T-` شروع می‌شوند. نسخه‌ای از Purity//FB که کاربر محلی ندارد، به‌جای آن یک حساب سرویس دایرکتوری (LDAP یا Active Directory) را می‌پذیرد که گروهش به نقش readonly نگاشت شده باشد.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- **نشانی مدیریتی** FlashBlade (نام میزبان یا IP، بدون `https://`) و **توکن API** کاربر فقط‌خواندنی، که اسکریپت آن را بدون نمایش روی صفحه می‌خواند",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- `PURE_FB_ENDPOINT` را روی نشانی مدیریتی FlashBlade (نام میزبان یا IP، بدون `https://`) و `PURE_FB_API_TOKEN` را روی توکن API کاربر فقط‌خواندنی تنظیم کنید. `chmod 600 .env` را اجرا کنید: این فایل توکن را در خود دارد.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` در پوشه عامل **`pure-fb-exporter`** را هم فهرست می‌کند، یعنی صادرکننده Pure که کالکتور FlashBlade را از طریق آن می‌خواند.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- کالکتور FlashBlade را از طریق `pure-fb-exporter`، صادرکننده Pure، می‌خواند که با توکنی که کالکتور در هر اسکرپ می‌فرستد به REST API در FlashBlade وارد می‌شود. درگاه صادرکننده درون شبکه compose می‌ماند.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **یک کار اسکرپ برای هر نقطه پایانی**، هر کدام با تناوبی که ارزشش را دارد: `/metrics/array` هر 60 ثانیه؛ `/metrics/filesystems` و `/metrics/objectstore` هر 5 دقیقه، چون REST API در FlashBlade برای گزارش سریع هر سیستم فایل و هر باکت ساخته نشده است.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. روی FlashBlade و به‌عنوان مدیر، در تنظیمات syslog آن یک سرور syslog با نشانی `udp://<agent-host>:5514` (یا `tcp://`) اضافه کنید.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "هر مقدار یک گیج است که خود FlashBlade محاسبه می‌کند: تأخیر به‌ازای هر عملیات بر حسب میکروثانیه، توان عملیاتی بر ثانیه. صفحه‌های آرایه ذخیره‌سازی OneUptime، کاتالوگ متریک‌ها و الگوهای هشدار بر این‌ها بنا شده‌اند:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **آرایه** (`/metrics/array`) | `purefb_info`، ظرفیت و کاهش داده (`purefb_array_space_*`)، کارایی به‌ازای هر پروتکل، هشدارهای باز (`purefb_alerts_open`)، سلامت سخت‌افزار (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **سامانه‌های فایل** (`/metrics/filesystems`) | فضا، کاهش داده و کارایی برای هر سامانه فایل |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **ذخیره‌گاه اشیا** (`/metrics/objectstore`) | فضا، سهمیه، شمار اشیا و کارایی برای هر باکت |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 یا جدیدتر با افزونه Docker Compose v2، روی ماشینی که از راه UDP 161 (SNMP) به همه گره‌های خوشه دسترسی داشته باشد",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "یک حساب مدیر روی خوشه، برای روشن کردن SNMP و تنظیم community فقط‌خواندنی یا کاربر SNMPv3 عامل",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "با SSH و به‌عنوان مدیر به هر گره‌ای وصل شوید: OneFS تنظیمات SNMP را روی کل خوشه اعمال می‌کند. اگر خوشه از پیش برای ابزار دیگری به SNMP پاسخ می‌دهد، همان community یا کاربر را به عامل بدهید و از این مرحله بگذرید. در غیر این صورت، SNMP v2c را با یک community فقط‌خواندنی از آنِ خودتان روشن کنید، نه community پیش‌فرض OneFS یعنی `I$ilonpublic`:",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "یا SNMPv3 را روشن کنید که هر پرس‌وجو را احراز هویت و رمزگذاری می‌کند. OneFS یک کاربر فقط‌خواندنی SNMPv3 دارد که تا وقتی نامش را تغییر ندهید `general` است: به آن گذرواژه‌هایی با دست‌کم هشت نویسه و بدون فاصله بدهید:",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` تنظیمات را همراه با پروتکل‌های احراز هویت و حریم خصوصی کاربر نشان می‌دهد. UDP 161 را از ماشین عامل به همه گره‌ها مجاز کنید و نشانی گره‌ها را با `isi network interfaces list` فهرست کنید.",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- **نشانی همه گره‌ها**، جداشده با ویرگول: نشانی خود هر گره، هرگز نام زُن SmartConnect، چون هر گره فقط برای درایوها، حسگرها و پورت‌های خودش پاسخ می‌دهد",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- **نسخه SNMP**، سپس **community** فقط‌خواندنی، یا **کاربر** SNMPv3 و دو گذرواژه آن، که اسکریپت هر کدام را بدون نمایش روی صفحه می‌خواند",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "کاربری که پروتکل‌هایش SHA و AES نیستند، به `POWERSCALE_SNMP_AUTH_PROTOCOL` و `POWERSCALE_SNMP_PRIVACY_PROTOCOL` پیش از `bash install.sh` نیاز دارد، و کاربر بدون حریم خصوصی به `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "در `/opt/oneuptime-storage-array-agent` نصب می‌شود، یک فایل `.env` می‌نویسد که فقط شما می‌توانید بخوانید (community یا گذرواژه‌های SNMPv3 در آن است)، با یک پرس‌وجو برای هر گره، و عامل را با Docker Compose راه می‌اندازد. وقتی گره‌ای به خوشه اضافه می‌شود، نشانی آن را در همان فایل به `POWERSCALE_NODES` بیفزایید و `bash install.sh` را دوباره اجرا کنید.",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- `my-storage-array` را با نامی برای این خوشه جایگزین کنید، مثلاً `ps-prod`. خوشه با همین نام در OneUptime نشان داده می‌شود، پس آن را ثابت نگه دارید: نام تازه یک آرایه ذخیره‌سازی تازه ثبت می‌کند.",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- همه گره‌ها را در `POWERSCALE_NODES` فهرست کنید و به هر کدام `POWERSCALE_NODE_<n>` خودش و `snmp/node-<n>` خودش را در `POWERSCALE_SNMP_RECEIVERS` بدهید، تا 252 گره، پس از `snmp/cluster` و `snmp/quotas`. نشانی IPv6 درون کروشه می‌آید، مانند `[fd00::11]`.",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- برای SNMPv3، به جای community، `POWERSCALE_SNMP_VERSION=v3`، `POWERSCALE_SNMP_USER`، `POWERSCALE_SNMP_AUTH_PASSWORD` و `POWERSCALE_SNMP_PRIVACY_PASSWORD` را تنظیم کنید. `chmod 600 .env` را اجرا کنید: community یا گذرواژه‌ها در این فایل است.",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | بله | نامی که این خوشه با آن در OneUptime ثبت می‌شود و روی هر متریک به‌عنوان `storage.array.name` زده می‌شود. آن را ثابت نگه دارید: تغییرش یک آرایه ذخیره‌سازی تازه ثبت می‌کند |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | بله | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | بله | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | بله | نشانی همه گره‌ها، جداشده با ویرگول. اسکریپت نصب پرس‌وجوهای زیر را از روی آن می‌نویسد |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | بله | گره‌ای که سلامت، ظرفیت و سهمیه‌های خود خوشه از راه آن خوانده می‌شوند: نخستین گره در `POWERSCALE_NODES` |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | بله | پرس‌وجوهایی که کالکتور اجرا می‌کند: `snmp/cluster`، `snmp/quotas`، سپس `snmp/node-<n>` برای هر گره |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | بله | نشانی گره `<n>`، از 1 تا 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | خیر | `v2c` (پیش‌فرض) یا `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | community فقط‌خواندنی خوشه |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | کاربر فقط‌خواندنی SNMPv3 خوشه |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | خیر | `auth_priv` (پیش‌فرض)، `auth_no_priv` یا `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | خیر | `SHA` (پیش‌فرض)، `MD5`، `SHA224`، `SHA256`، `SHA384` یا `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | گذرواژه احراز هویت کاربر SNMPv3 |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | خیر | `AES` (پیش‌فرض)، `DES`، `AES192`، `AES256`، `AES192C` یا `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | گذرواژه حریم خصوصی کاربر SNMPv3 |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **یک کالکتور، بدون صادرکننده.** گیرنده SNMP خود کالکتور ISILON-MIB متعلق به Dell را می‌خواند؛ چیز دیگری کنار آن اجرا نمی‌شود.",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **اشیای خوشه یک بار، از راه `POWERSCALE_ENDPOINT`:** سلامت، ظرفیت، توان عملیاتی و تعداد گره‌های آن هر 60 ثانیه (`snmp/cluster`)، و SmartQuotas آن هر 5 دقیقه (`snmp/quotas`).",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **اشیای هر گره از خود همان گره:** سلامت، CPU، کارایی پروتکل‌ها، درایوها، حسگرها و پورت‌های آن هر 60 ثانیه (`snmp/node-<n>`).",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **هر پرس‌وجو روی سری‌هایش برچسب `scrape_endpoint: <poll>` می‌زند**، تا OneUptime بداند هر دسته فهرست کامل کدام اشیاست؛ سهمیه حذف‌شده این‌گونه از موجودی بیرون می‌رود. برچسب‌ها را همان‌طور که عرضه شده‌اند نگه دارید.",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "پیکربندی کامل، با یک گیرنده SNMP برای هر جایگاه گره، فایل `otel-collector-config.powerscale.yaml` در پوشه عامل است:",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "سپس اگر چیز دیگری از خوشه پرس‌وجو نمی‌کند، SNMP را روی آن خاموش کنید، یا community یا گذرواژه‌های SNMPv3 عامل را تغییر دهید.",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "`troubleshoot.sh` کل زنجیره را بررسی می‌کند (محیط اجرای کانتینر، نشانی گره‌ها و community یا کاربر SNMPv3 در `.env`، هر گره با `snmpget` وقتی ماشین آن را داشته باشد، زدن نام آرایه، متریک‌های خود کالکتور) و مستقیم از OneUptime می‌پرسد که آیا کلید دریافت داده شما را می‌پذیرد.",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`Error scraping metrics` همراه با `request timeout` در `docker logs oneuptime-storage-array-agent` گره‌ای را نام می‌برد که از این ماشین به SNMP پاسخ نمی‌دهد: SNMP برای نسخه‌ای که عامل به کار می‌برد خاموش است، community یا کاربر SNMPv3 از آنِ خوشه نیست، یا UDP 161 در مسیر مسدود است. گره‌ای که پاسخ می‌دهد اما در میان گره‌های خوشه نیست، در `POWERSCALE_NODES` نیامده است: آن را بیفزایید و `bash install.sh` را دوباره اجرا کنید.",
};

export default TRANSLATION;
