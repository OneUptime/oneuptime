import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "Docker نصب‌شده روی میزبانی که می‌خواهید پایش کنید",
  "Network access from the host to your OneUptime instance":
    "دسترسی شبکه از میزبان به نمونه OneUptime شما",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "این را با نام `config.yaml` در پوشه‌ای ذخیره کنید که `docker run` را از آن اجرا می‌کنید — گام 3 آن را در کانتینر سوار می‌کند.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در مرحله 1 یک کلید دریافت داده انتخاب کنید.",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`، `--pid host` و اتصال `/hostfs` به خراشگرهای `hostmetrics` و `process` اجازه می‌دهند اطلاعات CPU، حافظه، دیسک و هر فرایند را به‌جای کانتینر از هسته میزبان بخوانند. بدون این‌ها فقط معیارهای خود کانتینر کالکتور را می‌بینید.",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "فهرست **میزبان‌ها** را در OneUptime باز کنید — میزبان شما همین که نخستین دسته معیارها برسد خودبه‌خود نمایان می‌شود (معمولاً ظرف 30 ثانیه). نیست؟ کالکتور را بررسی کنید:",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**بررسی‌های هوش مصنوعی برای هر میزبان به‌طور پیش‌فرض روشن‌اند**: همین که عامل هوش مصنوعی میزبان روی آن اجرا شود، هوش مصنوعی OneUptime رخدادها و هشدارهای آن‌جا را با فرمان‌های فقط‌خواندنی مانند `systemctl status`، `df -h`، `free -m` و `ps aux` بررسی می‌کند و تا اصلاح‌ها را مجاز نکنید چیزی را تغییر نمی‌دهد. این یک کانتینر Linux با نصب‌کننده خودش است، پس آن را فقط روی میزبان‌های Linux بیفزایید؛ به Docker (موتور سیستم، نه Docker بدون ریشه) با افزونه Compose نیاز دارد:",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "خط اول اسکریپت را با نام `install.sh` دانلود می‌کند تا بتوانید پیش از اجرا آن را بخوانید. اسکریپت نشانی OneUptime، کلید دریافت داده و نام میزبان را می‌پرسد — نام را خالی بگذارید تا نام میزبان به کار رود، همان نامی که این کالکتور گزارش می‌کند. پس از اتصال، در صفحه **هوش مصنوعی ← عامل هوش مصنوعی** میزبان و پایین **نمای کلی** آن به‌صورت متصل نمایش داده می‌شود. این‌که چه چیزی را می‌تواند اجرا کند و اصلاح‌ها چطور کار می‌کنند: [عامل‌های هوش مصنوعی زیرساخت](/docs/ai/infrastructure-ai-agents#hosts).",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "پیکربندی از پیش نشانی‌های IP، نشانی‌های MAC، معماری، شناسه ماشین، توضیح و نسخه سیستم‌عامل ماشین را در مورد آن در **موجودی** پر می‌کند؛ همان چیزی که یک خروجی CMDB می‌خواند. شماره سریال، سازنده، مدل و نسخه سفت‌افزار (BIOS / UEFI) فرق دارند: **هیچ آشکارساز منبعی نمی‌تواند آن‌ها را تولید کند.** این‌ها از راه DMI از سفت‌افزار ماشین می‌آیند. آن‌ها را یک بار هنگام آماده‌سازی بخوانید و روی منبع بنویسید — این پردازشگر را به `config.yaml`ای که در کانتینر سوار کرده‌اید بیفزایید و در خط لوله معیارها نامش را بیاورید. آن را با بخش‌هایی که پیکربندی شما از قبل دارد ادغام کنید — کلید دوم `processors:` یا `service:` نیفزایید.",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "سپس کانتینر را از نو بسازید تا فایل ویرایش‌شده را بخواند — آن را حذف کنید و فرمان `docker run` گام 3 را دوباره اجرا کنید:",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "این مقدارها متعلق به خود ماشین‌اند، پس هر چیزی که ماشین را آماده می‌کند یک بار آن‌ها را می‌نویسد. در Linux آن‌ها را با root بخوانید (`bios_version` را همه می‌توانند بخوانند):",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "ظرف چند دقیقه مقدارها روی مورد ماشین در **موجودی** زیر **جزئیات** نمایان می‌شوند. این مقدارها نوشته شده‌اند، نه آشکارسازی، پس پس از تعویض مادربرد یا به‌روزرسانی سفت‌افزار این کار را دوباره انجام دهید.",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`، `host.model.name`، `host.firmware.version` و `host.bios.version` به‌عنوان نگارش‌های جایگزین پذیرفته و زیر کلیدهای `device.*` بالا ذخیره می‌شوند (و `device.serial_number` زیر `host.serial_number`)، پس پیکربندی‌ای که به هر یک از این دو شکل نوشته شود در یک جا قرار می‌گیرد.",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **`device.manufacturer` را از یک پیکربندی هم روی منبع یک برنامه موبایل و هم روی منبع یک میزبان تنظیم نکنید.** روی منبعی که `host.name` یا `host.id` ندارد، `device.manufacturer` همچنان دسته را Real User Monitoring موبایل نشان می‌دهد.",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "هر ویژگی منبعی که پیشوند `oneuptime.label.` داشته باشد به برچسب پروژه تبدیل و به میزبان (و به سرویس تله‌متری‌ای که این کالکتور می‌فرستد) پیوست می‌شود. الگو: `oneuptime.label.<dimension>=<value>` به برچسبی با نام `<dimension>:<value>` تبدیل می‌شود.",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "یک پردازشگر `resource` به `config.yaml`ای که در کانتینر سوار کرده‌اید بیفزایید و از خط لوله معیارها به آن ارجاع دهید. آن را با بخش‌هایی که پیکربندی شما از قبل دارد ادغام کنید — کلید دوم `processors:` یا `service:` نیفزایید.",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "میزبان با برچسب‌های `team:payments`، `env:production` و `region:us-east-1` نمایش داده می‌شود. برچسب‌ها بدون حساسیت به بزرگی و کوچکی حروف تطبیق داده می‌شوند، پس برچسب `Production` موجود که دستی ساخته شده دوباره به کار می‌رود و تکراری نمی‌شود. کالکتور هرگز برچسب‌هایی را که دستی در رابط OneUptime افزوده شده‌اند حذف نمی‌کند.",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "میزبان‌ها از روی ویژگی منبع OTel یعنی `host.name` خودکار کشف می‌شوند که پردازشگر `resourcedetection` آن را تنظیم می‌کند. OneUptime میزبان را همین که دسته‌ای با `host.name` یکی از این‌ها را هم داشته باشد ثبت می‌کند:",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- معیارهای گیرنده `hostmetrics` (CPU، حافظه، دیسک، سامانه فایل، شبکه، بار، فرایندها)، یا",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- معیارهای خراشگر `process` (CPU/حافظه/رشته‌ها برای هر فرایند)، یا",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- یک ویژگی منبع `os.type` یا `container.runtime`، روی معیارها، لاگ‌ها یا ردگیری‌ها",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "…و پر کردن زبانه‌های نمای کلی، متریک‌ها، فرایندها و لاگ‌ها را آغاز می‌کند. `host.id` یا `host.arch` به‌تنهایی میزبان را ثبت نمی‌کنند، و تله‌متری‌ای که هویت Kubernetes دارد (`k8s.cluster.name`، `k8s.node.name`، `k8s.pod.name`، …) به‌جای آن زیر خوشه Kubernetes خودش قرار می‌گیرد.",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**روی OpenStack اجرا می‌شود؟** از `detectors: [nova, system, env]` استفاده کنید تا `host.id` همان UUID نمونه باشد و OneUptime این میزبان را به نمونه‌اش پیوند دهد، و `host.name` را زیر `nova: resource_attributes:` روی `enabled: false` بگذارید تا نامش همانی بماند که `system` گزارش می‌کند.",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "همین ویژگی‌های منبع، مورد ماشین در **موجودی** را می‌سازند؛ همان چیزی که یک خروجی CMDB می‌خواند. `host.ip`، `host.mac`، `host.arch`، `host.id`، `os.type`، `os.description` و `os.version` همگی از پردازشگر `resourcedetection` می‌آیند؛ شماره سریال، سازنده، مدل و نسخه سفت‌افزار آشکارسازی ندارند و جداگانه نوشته می‌شوند (**ثبت شماره سریال، سازنده، مدل و نسخه سفت‌افزار** را ببینید).",
  "Once the host is reporting:": "وقتی میزبان گزارش می‌دهد:",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- زبانه **متریک‌ها** سری‌های زمانی `system.*` را نمایش می‌دهد.",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- زبانه **فرایندها** همین که خراشگر `process` فعال شود فرایندها را به ترتیب CPU فهرست می‌کند.",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- زبانه **لاگ‌ها** همه لاگ‌هایی را که ویژگی‌های منبعشان `host.name` دارد به‌صورت زنده نشان می‌دهد.",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "پیکربندی نسخه کالکتوری را که برایش نوشته شده (`oneuptime.agent.version`) به‌عنوان **نسخه عامل** میزبان گزارش می‌کند. وقتی این OneUptime نسخه تازه‌تری را ثابت کند، نشانه هشداری کنار آن این گام‌ها را باز می‌کند.",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. پیکربندی گام 2 را با همان کلید دریافت داده دوباره ذخیره کنید: نسخه تازه را گزارش می‌کند. هر تغییری را که در پیکربندی خودتان داده‌اید به آن منتقل کنید.",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. در پوشه‌ای که آن را نگه می‌دارد، نسخه تازه را نصب کنید و کالکتور را دوباره راه بیندازید:",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. لاگ‌های کالکتور را از نظر خطاهای ارسال بخوانید: `docker logs -f otel-collector`. HTTP `401` یعنی کلید وجود ندارد، نادرست است یا منقضی شده؛ `422` یعنی غیرفعال شده است (یا کلید مرورگر است که نمی‌تواند تله‌متری میزبان بفرستد). در گام 1 کلیدی را که کار می‌کند انتخاب کنید و `x-oneuptime-token` را در `config.yaml`ای که در کانتینر سوار کرده‌اید به‌روز کنید.",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. بررسی کنید که میزبان به OneUptime دسترسی دارد: `curl -v <YOUR_ONEUPTIME_URL>/otlp` از همان ماشین.",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. `resourcedetection` را در خط لوله معیارها نگه دارید — `host.name` را تنظیم می‌کند و OneUptime میزبان را با آن می‌شناسد.",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "کالکتور نمای هسته کانتینر خودش را می‌خواند. آن را با `--network host`، `--pid host`، اتصال `/:/hostfs` و متغیرهای `HOST_*` دقیقاً همان‌طور که گام 3 نشان می‌دهد اجرا کنید — بدون این‌ها خراشگرهای `hostmetrics` و `process` فقط خود کانتینر کالکتور را می‌بینند.",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "یک میزبان Debian یا Ubuntu (amd64 یا arm64) با `sudo`",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "این را با نام `config.yaml` در پوشه کنونی ذخیره کنید — گام 3 آن را نصب می‌کند.",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **نکته برای نصب‌های بومی:** برخلاف Docker، نصب بسته‌ای `/proc` و `/sys` را مستقیم می‌خواند — نیازی به متغیرهای محیطی `HOST_PROC` یا اتصال `/hostfs` نیست. واحد systemd همراه بسته با کاربر بی‌امتیاز `otelcol-contrib` اجرا می‌شود؛ اگر می‌خواهید خراشگر `process` فرایندهای کاربران دیگر را ببیند، `CAP_SYS_PTRACE` را به آن بدهید یا آن را با root اجرا کنید.",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` از **v0.142.0** گیرنده `systemd` را همراه دارد؛ **v0.143.0 یا تازه‌تر** را اجرا کنید، که در آن معیار CPU به نام کنونی‌اش رسید و دیگر واحدهایی را که سرویس نیستند پرس‌وجو نمی‌کند. آن را با افزودن به `/etc/otelcol-contrib/config.yaml` و خط لوله معیارها روشن کنید. آن را با بخش‌هایی که پیکربندی شما از قبل دارد ادغام کنید — کلید دوم `processors:` یا `service:` نیفزایید.",
  "Then restart the service:": "سپس سرویس را دوباره راه بیندازید:",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "این گیرنده **فقط برای Linux** و در مرحله **آلفا** است. وضعیت واحدها را از راه D-Bus سیستم با همان فراخوانی‌های فقط‌خواندنی `systemctl list-units` می‌خواند که systemd بدون امتیاز ویژه اجازه می‌دهد، پس سرویس بسته — که با کاربر `otelcol-contrib` اجرا می‌شود — به هیچ مجوز اضافه‌ای نیاز ندارد. کالکتوری که در کانتینر اجرا شود به گذرگاه میزبان نمی‌رسد، پس از نصب بومی استفاده کنید. همین که معیارها برسند، زبانه **واحدهای systemd** میزبان با هر واحد جمع‌آوری‌شده و وضعیت کنونی‌اش (`active`، `failed`، `inactive`، ...) پر می‌شود.",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "هر واحد در هر خراش برای مجموعه وضعیت هشت نقطه داده هزینه دارد، و اگر معیار CPU را روشن بگذارید دو نقطه دیگر، پس روی میزبانی با صدها واحد به‌جای خراشیدن همه چیز، `units:` را محدود کنید یا `collection_interval` را بالا ببرید.",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**بررسی‌های هوش مصنوعی برای هر میزبان به‌طور پیش‌فرض روشن‌اند**: همین که عامل هوش مصنوعی میزبان روی آن اجرا شود، هوش مصنوعی OneUptime رخدادها و هشدارهای آن‌جا را با فرمان‌های فقط‌خواندنی مانند `systemctl status`، `df -h`، `free -m` و `ps aux` بررسی می‌کند و تا اصلاح‌ها را مجاز نکنید چیزی را تغییر نمی‌دهد. این یک کانتینر Linux با نصب‌کننده خودش است؛ به Docker (موتور سیستم، نه Docker بدون ریشه) با افزونه Compose نیاز دارد:",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "پیکربندی از پیش نشانی‌های IP، نشانی‌های MAC، معماری، شناسه ماشین، توضیح و نسخه سیستم‌عامل ماشین را در مورد آن در **موجودی** پر می‌کند؛ همان چیزی که یک خروجی CMDB می‌خواند. شماره سریال، سازنده، مدل و نسخه سفت‌افزار (BIOS / UEFI) فرق دارند: **هیچ آشکارساز منبعی نمی‌تواند آن‌ها را تولید کند.** این‌ها از راه DMI از سفت‌افزار ماشین می‌آیند، و کالکتور بسته بدون امتیاز ویژه اجرا می‌شود، پس خودش نمی‌تواند آن‌ها را بخواند. آن‌ها را یک بار هنگام آماده‌سازی بخوانید و روی منبع بنویسید — این پردازشگر را به `/etc/otelcol-contrib/config.yaml` بیفزایید و در خط لوله معیارها نامش را بیاورید. آن را با بخش‌هایی که پیکربندی شما از قبل دارد ادغام کنید — کلید دوم `processors:` یا `service:` نیفزایید.",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "یک پردازشگر `resource` به `/etc/otelcol-contrib/config.yaml` بیفزایید و از خط لوله معیارها به آن ارجاع دهید. آن را با بخش‌هایی که پیکربندی شما از قبل دارد ادغام کنید — کلید دوم `processors:` یا `service:` نیفزایید.",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- زبانه **واحدهای systemd** همین که گیرنده `systemd` فعال شود وضعیت واحدها را فهرست می‌کند (**فعال کردن زبانه «واحدهای systemd»** را ببینید).",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. لاگ‌های کالکتور را از نظر خطاهای ارسال بخوانید: `sudo journalctl -u otelcol-contrib -f`. HTTP `401` یعنی کلید وجود ندارد، نادرست است یا منقضی شده؛ `422` یعنی غیرفعال شده است (یا کلید مرورگر است که نمی‌تواند تله‌متری میزبان بفرستد). در گام 1 کلیدی را که کار می‌کند انتخاب کنید و `x-oneuptime-token` را در `/etc/otelcol-contrib/config.yaml` به‌روز کنید.",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. `resourcedetection` را در همان خط لوله معیارهایی نگه دارید که گیرنده `systemd` در آن است — گیرنده به هر واحد فقط `systemd.unit.name` را می‌چسباند، پس بدون `host.name` نمونه‌ها هرگز به میزبان وصل نمی‌شوند.",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. `otelcol-contrib` نسخه v0.143.0 یا تازه‌تر را اجرا کنید: ساخت‌های قدیمی‌تر هنگام راه‌اندازی با `'receivers' unknown type: \"systemd\"` متوقف می‌شوند، یا معیار CPU را به نام دیگری می‌نامند (**فعال کردن زبانه «واحدهای systemd»** را ببینید).",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. بررسی کنید که کالکتور به D-Bus سیستم دسترسی دارد: `/run/dbus/system_bus_socket` باید وجود داشته باشد، و اجرای `systemctl list-units` با کاربر کالکتور سریع‌ترین آزمون است. root لازم نیست.",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "یک میزبان RHEL، CentOS، Fedora یا Amazon Linux (x86_64 یا aarch64) با `sudo`",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "یک میزبان Linux (x86_64 یا aarch64) که systemd را اجرا می‌کند، با `sudo`",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "یک واحد systemd در `/etc/systemd/system/otelcol-contrib.service` بگذارید:",
  "Then enable and start it:": "سپس آن را فعال کنید و راه بیندازید:",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "وقتی بسته‌ای در دسترس نیست از این روش استفاده کنید — سرورهای قفل‌شده، یا ایمیج‌های پایه کانتینر که می‌خواهید از بیرون ابزارگذاری کنید. نیازی به متغیرهای محیطی `HOST_PROC` یا اتصال `/hostfs` نیست: کالکتور وضعیت هسته را مستقیم می‌خواند و `User=root` به خراشگر `process` اجازه می‌دهد فرایندهای کاربران دیگر را ببیند (دادن `CAP_SYS_PTRACE` هم کار می‌کند).",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "این گیرنده **فقط برای Linux** و در مرحله **آلفا** است. وضعیت واحدها را از راه D-Bus سیستم با همان فراخوانی‌های فقط‌خواندنی `systemctl list-units` می‌خواند که systemd بدون امتیاز ویژه اجازه می‌دهد، پس به هیچ مجوز اضافه‌ای نیاز ندارد. کالکتوری که در کانتینر اجرا شود به گذرگاه میزبان نمی‌رسد، پس از نصب بومی استفاده کنید. همین که معیارها برسند، زبانه **واحدهای systemd** میزبان با هر واحد جمع‌آوری‌شده و وضعیت کنونی‌اش (`active`، `failed`، `inactive`، ...) پر می‌شود.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "پیکربندی از پیش نشانی‌های IP، نشانی‌های MAC، معماری، شناسه ماشین، توضیح و نسخه سیستم‌عامل ماشین را در مورد آن در **موجودی** پر می‌کند؛ همان چیزی که یک خروجی CMDB می‌خواند. شماره سریال، سازنده، مدل و نسخه سفت‌افزار (BIOS / UEFI) فرق دارند: **هیچ آشکارساز منبعی نمی‌تواند آن‌ها را تولید کند.** این‌ها از راه DMI از سفت‌افزار ماشین می‌آیند. آن‌ها را یک بار هنگام آماده‌سازی بخوانید و روی منبع بنویسید — این پردازشگر را به `/opt/otelcol-contrib/config.yaml` بیفزایید و در خط لوله معیارها نامش را بیاورید. آن را با بخش‌هایی که پیکربندی شما از قبل دارد ادغام کنید — کلید دوم `processors:` یا `service:` نیفزایید.",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "یک Mac (Apple silicon یا Intel) و یک حساب مدیر برای `sudo`",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "`/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` را بسازید:",
  "Load it:": "آن را بارگذاری کنید:",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **همان‌طور که در بالا آمد، ساخت contrib را نصب کنید.** ساخت core یعنی `otelcol` پردازشگر `resourcedetection` را ندارد، پس با این پیکربندی راه نمی‌افتد.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "پیکربندی از پیش نشانی‌های IP، نشانی‌های MAC، معماری، شناسه ماشین، توضیح و نسخه سیستم‌عامل ماشین را در مورد آن در **موجودی** پر می‌کند؛ همان چیزی که یک خروجی CMDB می‌خواند. شماره سریال، سازنده، مدل و نسخه سفت‌افزار (BIOS / UEFI) فرق دارند: **هیچ آشکارساز منبعی نمی‌تواند آن‌ها را تولید کند.** این‌ها از سفت‌افزار ماشین می‌آیند. آن‌ها را یک بار هنگام آماده‌سازی بخوانید و روی منبع بنویسید — این پردازشگر را به `/etc/otelcol-contrib/config.yaml` بیفزایید و در خط لوله معیارها نامش را بیاورید. آن را با بخش‌هایی که پیکربندی شما از قبل دارد ادغام کنید — کلید دوم `processors:` یا `service:` نیفزایید.",
  "Then restart the collector:": "سپس کالکتور را دوباره راه بیندازید:",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "این مقدارها متعلق به خود ماشین‌اند، پس هر چیزی که ماشین را آماده می‌کند یک بار آن‌ها را می‌نویسد. در Mac آن‌ها را این‌گونه بخوانید — سازنده `Apple Inc.` است:",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` *شناسه* مدل است (`MacBookPro18,3`)، نه نام تجاری. با این حال آن را در `device.model.name` بگذارید — `device.model.identifier` دسته را برنامه موبایل نشان می‌دهد.",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ یا Windows Server 2019+ (برای `tar.exe` داخلی)",
  "An elevated PowerShell prompt (Run as administrator)":
    "یک خط فرمان PowerShell با دسترسی مدیر (Run as administrator)",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "این را با نام `config.yaml` در پوشه‌ای ذخیره کنید که فرمان‌های PowerShell را از آن اجرا می‌کنید — گام 3 آن را در جای خودش کپی می‌کند.",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "در Windows، کالکتور بالادستی **`otelcol-contrib`** را نصب کنید — از **v0.155.0** گیرنده `windows_service` را همراه دارد که زبانه **سرویس‌ها** میزبان را پر می‌کند. از یک خط فرمان PowerShell با دسترسی مدیر اجرا کنید:",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **نکته:** سرویس با `LocalSystem` اجرا می‌شود تا بتواند همه سرویس‌های Windows را بخواند. در Windows، خراشگر `load` فقط یک میانگین بار را از شمارنده *Processor Queue Length* شبیه‌سازی می‌کند (از 0 شروع می‌شود)؛ اگر نتواند شمارنده را بخواند، این در لاگ ثبت و از آن صرف‌نظر می‌شود و بقیه پیکربندی `hostmetrics` بدون تغییر اجرا می‌شود. [مستندات OpenTelemetry Collector میزبان](/docs/telemetry/host-otel-collector) نصب‌کننده امضاشده `.msi` را هم پوشش می‌دهد.",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "لاگ‌ها در لاگ رویداد Application ویندوز نوشته می‌شوند؛ آن‌ها را در **Event Viewer → Windows Logs → Application** (منبع `otelcol-contrib`) ببینید.",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "از **v0.155.0**، `otelcol-contrib` گیرنده `windows_service` را دارد — آن را با افزودن به `C:\\Program Files\\otelcol-contrib\\config.yaml` و خط لوله معیارها روشن کنید. آن را با بخش‌هایی که پیکربندی شما از قبل دارد ادغام کنید — کلید دوم `processors:` یا `service:` نیفزایید.",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "این گیرنده **فقط برای Windows** و در مرحله **آلفا** است. همین که معیارها برسند، زبانه **سرویس‌ها** میزبان خودبه‌خود با وضعیت اجرا و نوع راه‌اندازی هر سرویس پر می‌شود.",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "پیکربندی از پیش نشانی‌های IP، نشانی‌های MAC، معماری، شناسه ماشین، توضیح و نسخه سیستم‌عامل ماشین را در مورد آن در **موجودی** پر می‌کند؛ همان چیزی که یک خروجی CMDB می‌خواند. شماره سریال، سازنده، مدل و نسخه سفت‌افزار (BIOS / UEFI) فرق دارند: **هیچ آشکارساز منبعی نمی‌تواند آن‌ها را تولید کند.** این‌ها از راه WMI از سفت‌افزار ماشین می‌آیند.",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "این را از یک خط فرمان PowerShell با دسترسی مدیر روی ماشین اجرا کنید — WMI را پرس‌وجو می‌کند و YAML دقیق *همین* ماشین را چاپ می‌کند:",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "یک ورودی پردازشگر را، از پیش تورفته، چاپ می‌کند. آن را درون بلوک `processors:` که `config.yaml` شما از قبل دارد بیفزایید — کنار `resourcedetection:`، `resource:` و `batch:`، نه به‌عنوان کلید دوم `processors:` — سپس در خط لوله معیارها نامش را بیاورید:",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "از `Get-CimInstance` استفاده کنید، نه `Get-WmiObject` منسوخ — در PowerShell 7 و نسخه‌های بعد وجود ندارد. مقدارها درون نقل‌قول تکی و با دوبرابر شدن هر نقل‌قول درونی چاپ می‌شوند، پس شماره سریال یا مدلی که نشانه‌گذاری دارد YAML معتبر می‌ماند. فیلدی که سفت‌افزار خالی می‌گذارد به شکل `''` چاپ می‌شود؛ به‌جای فرستادن ویژگی خالی، آن را حذف کنید.",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "ظرف چند دقیقه مورد ماشین در **موجودی** زیر **جزئیات**، `host.serial_number`، `device.manufacturer`، `device.model.name` و `device.firmware.version` را کنار نشانی‌های IP و MAC و شناسه ماشین که آشکارساز از پیش می‌دهد نشان می‌دهد. پس از تعویض مادربرد یا به‌روزرسانی BIOS این را دوباره اجرا کنید — مقدارها نوشته شده‌اند، نه آشکارسازی، پس خودشان به‌روز نمی‌شوند.",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- زبانه **سرویس‌ها** همین که گیرنده `windows_service` فعال شود وضعیت هر سرویس را فهرست می‌کند (**فعال کردن زبانه «سرویس‌های Windows»** را ببینید).",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. لاگ‌های کالکتور را از نظر خطاهای ارسال بخوانید: **Event Viewer → Windows Logs → Application** (منبع `otelcol-contrib`). HTTP `401` یعنی کلید وجود ندارد، نادرست است یا منقضی شده؛ `422` یعنی غیرفعال شده است (یا کلید مرورگر است که نمی‌تواند تله‌متری میزبان بفرستد). در گام 1 کلیدی را که کار می‌کند انتخاب کنید و `x-oneuptime-token` را در `C:\\Program Files\\otelcol-contrib\\config.yaml` به‌روز کنید.",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. کالکتور را در پیش‌زمینه اجرا کنید تا به‌جای `Error 1064` کلی، خطای واقعی را ببینید:",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` یعنی سرویس به فایلی اشاره می‌کند که وجود ندارد — `BINARY_PATH_NAME` از `sc.exe qc "otelcol-contrib"` را با محتوای `C:\\Program Files\\otelcol-contrib` مقایسه کنید. بایگانی باید همان بایگانی `otelcol-contrib_` باشد که `otelcol-contrib.exe` را باز می‌کند.',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application** (منبع `otelcol-contrib`) خطای راه‌اندازی‌ای را که مدیر سرویس‌ها فروخورده ثبت می‌کند.",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "اگر `include_services` را تنظیم کرده‌اید اما هنوز همه سرویس‌ها را می‌بینید، کالکتور ویرایش را نگرفته است — سرویس را دوباره راه بیندازید (`Restart-Service otelcol-contrib`) و چند دقیقه به زبانه سرویس‌ها فرصت دهید تا پنجره غلتانش را تازه کند.",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "گره‌های Kubernetes را **عامل Kubernetes در OneUptime** پایش می‌کند، نه یک کالکتور میزبان: هر گره زیر **Kubernetes** ← خوشه شما ← **گره‌ها**، کنار پادها و بارهای کاری‌اش، نمایان می‌شود، نه در فهرست **میزبان‌ها**. گام‌های زیر عامل را روی یک خوشه استاندارد نصب می‌کنند؛ راهنمای نصب در بخش **Kubernetes** گام‌های Amazon EKS، Google GKE، Azure AKS، GKE Autopilot و EKS Fargate را دارد.",
  "A Kubernetes cluster running v1.23 or later":
    "یک خوشه Kubernetes با نسخه v1.23 یا جدیدتر",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` و `helm` (v3) نصب‌شده روی ماشین شما",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "خوشه اشتباه است؟ با `kubectl config use-context <context-name>` عوضش کنید.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-cluster` را با نامی برای این خوشه جایگزین کنید، مثلاً `prod-us-east-1`. خوشه با همین نام در OneUptime نشان داده می‌شود، پس آن را ثابت نگه دارید: نام تازه یک خوشه تازه ثبت می‌کند.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` همان‌طور که chart به‌طور پیش‌فرض انجام می‌دهد، **بررسی‌های هوش مصنوعی** را روشن می‌کند: هوش مصنوعی OneUptime از طریق عامل هوش مصنوعی Kubernetes و با kubectl فقط‌خواندنی، رخدادها و هشدارهای این خوشه را بررسی می‌کند.",
  "You should see:": "باید این را ببینید:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "کالکتور و عامل هوش مصنوعی Kubernetes، به‌علاوه یک پاد `-logs` و یک پاد `-ebpf` روی هر گره. وقتی همه `Running` شوند، خوشه خودکار در بخش **Kubernetes** نمایان می‌شود، معمولاً ظرف یکی دو دقیقه.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**عامل هوش مصنوعی Kubernetes (به‌طور پیش‌فرض روشن، فقط‌خواندنی).** پاد `kubernetes-agent-ai-agent` به هوش مصنوعی OneUptime اجازه می‌دهد با همان کلید API و با kubectl فقط‌خواندنی (`get`، `describe`، `logs`، `events`، `top`) رخدادها و هشدارهای این خوشه را بررسی کند، و تا وقتی بعداً به آن دسترسی نوشتن ندهید هیچ چیزی را نمی‌تواند تغییر دهد. برای دیدن آن، خوشه را باز کنید و به **هوش مصنوعی ← عامل** بروید. آن را نمی‌خواهید؟ به‌جای `--set aiAgent.enabled=true` با `--set aiAgent.enabled=false` نصب کنید.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "قاعده‌های فضای نام تعیین می‌کنند عامل از هر فضای نام چه چیزی را جمع‌آوری کند. برای جمع‌آوری لاگ‌های پاد و داده‌های eBPF فقط از `default`، `production` و `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "برای نگه داشتن همه‌چیز و فقط متوقف کردن لاگ‌های فضاهای نام پرسروصدا، آن‌ها را فقط از `podLogs` مستثنا کنید:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **دامنه‌ها:** `podLogs` (stdout/stderr کانتینرها)، `ebpfDiscovery` (ترِیس‌ها و متریک‌های eBPF)، `metrics` (متریک‌های دارای فضای نام) و `traces` (همه spanها).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **الگوها** با نام کامل فضای نام تطبیق داده می‌شوند و `*` را می‌پذیرند، مثل `team-*`. قاعده `exclude` همیشه بر قاعده `include` برتری دارد.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **تنظیم قاعده‌ها جای قاعده پیش‌فرض را می‌گیرد**، که `kube-system` را از `podLogs` و `ebpfDiscovery` مستثنا می‌کند. اگر هنوز آن را می‌خواهید، مثل مثال دوم در فهرستتان نگهش دارید.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- متریک‌های گره و خوشه فضای نام ندارند، پس همیشه نگه داشته می‌شوند.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` به Helm 3.10 یا جدیدتر نیاز دارد.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**فقط خط‌های مهم را بفرستید.** خط‌های لاگ پاد زیر یک سطح شدت را پیش از خروج از خوشه دور بریزید:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '`TRACE`، `DEBUG`، `INFO`، `WARN`، `ERROR` و `FATAL` را می‌پذیرد: `WARN` هشدارها، خطاها و خط‌های مهلک را نگه می‌دارد. شدت از خود خط لاگ خوانده می‌شود (`[ERROR]`، `level=warn`، `"level":"info"`). رویدادهای Kubernetes هرگز با این تنظیم دور ریخته نمی‌شوند.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**لاگ‌های پاد را خاموش کنید.** متریک‌ها تحت تأثیر قرار نمی‌گیرند: کالکتور گره برای متریک‌های kubelet و cAdvisor همچنان اجرا می‌شود و فقط خواندن لاگ‌های پاد را متوقف می‌کند:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**روش خواندن لاگ‌ها را تغییر دهید.** پیش‌تنظیم این را برایتان انتخاب می‌کند؛ یک `logs.mode` صریح همیشه بر آن برتری دارد:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: `/var/log/pods` را روی هر گره از طریق hostPath می‌خواند (کمترین سربار؛ به hostPath نیاز دارد).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: یک Deployment لاگ‌های پاد را از طریق API در Kubernetes دنبال می‌کند (روی هر خوشه‌ای کار می‌کند).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: بدون لاگ پاد.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "این کار سرور API را می‌خواند، همان‌جا که درون خوشه پاسخ می‌دهد. etcd، زمان‌بند و مدیر کنترلرها روی گره‌های صفحه کنترل پاسخ می‌دهند که پاد عامل نمی‌تواند حدسشان بزند، پس به‌محض این‌که نشانی هر گره را بدهید آن‌ها را می‌خواند:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **زمان‌بند و مدیر کنترلرها** HTTPS ارائه می‌دهند و توکن عامل را می‌پذیرند، اما kubeadm آن‌ها را به `127.0.0.1` متصل می‌کند: به آن‌ها یک `--bind-address` بدهید که پاد عامل به آن دسترسی داشته باشد.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** همان‌طور که بالا آمد، متریک‌هایش را با HTTP ساده روی `--listen-metrics-urls` در kubeadm ارائه می‌دهد (درگاه 2381 که تا افزودن نشانی گره به `127.0.0.1` متصل است). یا درگاه کلاینت HTTPS آن، 2379، را با گواهی کلاینتی که درخواست می‌کند بخوانید: `ca.crt`، `tls.crt` و `tls.key` را در یک Secret در `oneuptime-agent` بگذارید و نامش را در `controlPlane.etcd.clientCertSecret` بیاورید.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "فقط برای خوشه‌های خودمدیریت: سرویس‌های مدیریت‌شده (EKS، GKE، AKS) متریک‌های صفحه کنترل خود را در دسترس نمی‌گذارند.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "پایش هزینه به‌طور پیش‌فرض روشن است: عامل موتور متن‌باز OpenCost (به‌علاوه Prometheus کوچکی که لازم دارد) را همراه خود دارد، گره‌ها و حجم‌های شما را بر اساس فهرست قیمت عمومی ارائه‌دهنده ابری‌تان قیمت‌گذاری می‌کند، بدون نیاز به اعتبارنامه، و می‌فرستد که هر فضای نام و بار کاری چقدر هزینه دارد. نخستین داده‌ها پس از نخستین ساعت کامل در نمای کلی خوشه و صفحه «هزینه‌ها» نمایان می‌شوند.",
  "On an agent installed before it was on by default, upgrade it:":
    "عاملی را که پیش از پیش‌فرض شدن این قابلیت نصب شده است، به‌روز کنید:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **خاموش کردن:** `--set cost.enabled=false` را به همان به‌روزرسانی اضافه کنید.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **از قبل Kubecost یا OpenCost دارید؟** عامل آن را پیدا می‌کند و آن را به‌جای موتور همراه می‌خواند، و نمای کلی خوشه هم همین را می‌گوید: برای اینکه موتور دومی همراه نصب نشود، `--set cost.engine.url=auto` را اضافه کنید.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **محلی یا bare metal؟** با `--set cost.opencost.customPricing.enabled=true` یک جدول نرخ تعیین کنید (USD به ازای هر ساعت منبع؛ `values.yaml` در chart را ببینید).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "راهنمای کامل: [مشاهده‌پذیری هزینه Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "عامل روی هر گره [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) را اجرا می‌کند. این ابزار ترافیک HTTP/HTTPS، gRPC و SQL/Redis سرویس‌های Go، .NET، Java، Node.js، Python، Ruby و Rust را بدون SDK و بدون sidecar می‌گیرد و ترِیس‌ها، متریک‌های درخواست (RED) و داده‌های گراف سرویس را از طریق کالکتور می‌فرستد.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**الزامات:** هسته Linux **5.8+** با BTF (پیش‌فرض در Debian 11+، Ubuntu 20.10+، Fedora 34+، RHEL 9+). پادهای eBPF به‌صورت **ممتاز** اجرا می‌شوند که برای بارگذاری برنامه‌های eBPF لازم است.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "اگر گره‌هایتان هسته قدیمی‌تری دارند، اگر پادهای ممتاز مجاز نیستند، یا اگر سرویس‌هایتان از قبل با SDKهای OpenTelemetry ترِیس می‌فرستند و تکراری نمی‌خواهید، **آن را خاموش کنید**:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**سیگنال‌ها را انتخاب کنید.** هر خانواده با `--set ebpf.features.<name>=false` (یا `=true`) روشن یا خاموش می‌شود:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | پیش‌فرض | چه چیزی اضافه می‌کند |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | روشن | نرخ درخواست HTTP/gRPC، خطاها و تأخیر برای هر سرویس |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | روشن | تعداد فراخوانی و مدت spanها (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | روشن | یال‌های فراخواننده ← فراخوانده؛ نقشه سرویس را می‌سازد |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | روشن | شمارنده‌های جریان TCP/UDP بین پادها |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | خاموش | متریک‌های شبکه میان منطقه‌ها (کاردینالیتی آن‌ها را دو برابر می‌کند) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | روشن | RTT در TCP و شمارنده‌های اتصال ناموفق و ارسال دوباره در سطح گره |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**انتشار ترِیس میان سرویس‌ها** (پیوند دادن درخواستی که از پاد A ← به پاد B می‌رود در یک ترِیس واحد، حتی روی گره‌ای دیگر) **به‌طور پیش‌فرض روشن** است. این کار با بازنویسی ترافیکی انجام می‌شود که از قبل در جریان است (گسترش درخواست‌های HTTP متن ساده در هسته، و افزودن یک گزینه TCP به TLS و TCP خام)، و هر خطا در این شمارش بایت‌ها جریان را از هماهنگی خارج می‌کند: نشانه گزارش‌شده، گیر کردن انتقال‌ها از یک پراکسی L7 مثل nginx است وقتی پاسخ از ~64KB بگذرد. اگر این را دیدید، یا یک service mesh پادها را از کار انداخت، آن را با `--set ebpf.contextPropagation=false` خاموش کنید؛ SDK در OpenTelemetry بدون هیچ‌یک از این‌ها `traceparent` را در فضای کاربر منتشر می‌کند.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "هر `oneuptime.labels.<key>=<value>` روی خوشه، و روی سرویس‌ها و میزبان‌هایی که گزارش می‌کند، به برچسب `<key>:<value>` تبدیل می‌شود. برچسب‌ها بدون حساسیت به بزرگی و کوچکی حروف مقایسه می‌شوند، پس برچسب موجود `Production` دوباره به کار می‌رود؛ برچسب‌هایی که در رابط کاربری OneUptime افزوده شده‌اند هرگز به دست عامل حذف نمی‌شوند.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "به آخرین chart **ارتقا** دهید. `--reset-then-reuse-values` (Helm 3.14+) مقدارهایی را که تنظیم کرده‌اید (پیش‌تنظیم، نام خوشه، فیلترها) نگه می‌دارد و بقیه را از chart تازه می‌گیرد؛ هر پرچم `--set` تازه را روی آن اضافه کنید:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "در Helm 3.13 و پیش از آن، به‌جایش با مقدارهایی که تنظیم کرده‌اید ارتقا دهید:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "از `--reuse-values` استفاده نکنید: این گزینه پیش‌فرض‌های chart مبدأ را هم نگه می‌دارد، پس پیش‌فرض‌های chart جدیدتر (از جمله ایمیج eBPF آن) هرگز اعمال نمی‌شوند.",
  "**Uninstall** the agent and its namespace:":
    "عامل و فضای نام آن را **حذف نصب** کنید:",
  "| Category | Data |": "| دسته | داده |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **متریک‌های گره** | مصرف CPU، حافظه، سامانه پرونده و شبکه |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **متریک‌های پاد و کانتینر** | CPU، حافظه، I/O شبکه و راه‌اندازی‌های دوباره |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **متریک‌های خوشه** | وضعیت گره‌ها، منابع قابل تخصیص، تعداد پادها و بارهای کاری |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **رویدادهای Kubernetes** | هشدارها، خطاها و رویدادهای زمان‌بندی |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **لاگ‌های پاد** | stdout/stderr هر کانتینر، خوانده‌شده از هر گره |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **ترِیس‌های برنامه** *(eBPF)* | spanهای HTTP، gRPC و SQL/Redis از هر پاد، بدون SDK یا تغییر کد |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **متریک‌های درخواست و گراف سرویس** *(eBPF)* | نرخ درخواست، خطاها و تأخیر برای هر سرویس، و یال‌های فراخواننده ← فراخوانده برای نقشه سرویس |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **جریان‌های شبکه** *(eBPF)* | شمارنده‌های بایت و بسته TCP/UDP بین پادها |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **هزینه بارهای کاری** *(به‌طور پیش‌فرض روشن)* | هزینه به تفکیک فضای نام، بار کاری و پاد، همراه با ظرفیت بلااستفاده و بهره‌وری، و همچنین به‌صورت متریک‌هایی برای هشدار |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "خوشه شما حجم‌های `hostPath` یا پادهای ممتاز را مسدود می‌کند. این روی **GKE Autopilot** و **EKS Fargate** عادی است: آن سکو را در بالای این راهنما انتخاب کنید و مراحلش را دنبال کنید. اما روی **OpenShift** نصب موفق می‌شود، ولی پادهای گره عامل هرگز شروع نمی‌شوند: **Red Hat OpenShift** را انتخاب کنید.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "روی هر خوشه دیگری با سیاست سخت‌گیرانه Pod Security، انتشار ناموفق را حذف کنید:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "سپس فرمان نصب را با افزودن `--set preset=gke-autopilot` دوباره اجرا کنید. این پیش‌تنظیم لاگ‌های پاد را به‌جای hostPath از طریق API در Kubernetes می‌خواند، یک زمینه امنیتی سخت‌گیرانه اعمال می‌کند و پادهای ممتاز eBPF و پروفایل‌گیری را کنار می‌گذارد.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. بررسی کنید که پادهای عامل در حال اجرا باشند: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. لاگ‌های کالکتور را بررسی کنید: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. تأیید کنید که نشانی OneUptime و کلید دریافت داده در فرمان نصب درست هستند.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. مطمئن شوید که خوشه از طریق شبکه به نمونه OneUptime شما دسترسی دارد.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. پاد عامل هوش مصنوعی را بررسی کنید: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. لاگ‌های آن را بررسی کنید: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. پادی نیست؟ chart را ارتقا دهید (**ارتقا یا حذف عامل** را در پیشرفته ببینید) و `--set aiAgent.enabled=true` را اضافه کنید.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. بررسی کنید که نام خوشه یکسان باشد: این راهنما **`my-cluster`** را نصب می‌کند.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. مجوزهای RBAC عامل را تأیید کنید: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. در لاگ‌های کالکتور دنبال خطاهای صدور بگردید: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **هسته خیلی قدیمی است یا BTF ندارد.** eBPF به Linux 5.8+ با BTF نیاز دارد؛ با `uname -r` روی یک گره بررسی کنید. اگر نمی‌توانید ارتقا دهید، eBPF را با `--set ebpf.enabled=false` خاموش کنید.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **پادهای ممتاز مسدود شده‌اند.** برخی خوشه‌های بسته آن‌ها را رد می‌کنند. eBPF را خاموش کنید.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` روی میزبان در دسترس نیست.** فقط خانواده آمار TCP را خاموش کنید: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. بررسی کنید که پادهای eBPF سالم باشند: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. خروجی اشکال‌زدایی OBI را روشن کنید تا مطمئن شوید ترافیک را می‌بیند: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`، سپس `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200` را بخوانید.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. اگر spanها آنجا دیده می‌شوند ولی در OneUptime نه، لاگ‌های کالکتور را از نظر خطاهای صدور بررسی کنید: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
