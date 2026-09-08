# عامل Proxmox در OneUptime

## نمای کلی

عامل Proxmox در OneUptime جمع‌کننده‌ای از پیش پیکربندی‌شده از OpenTelemetry است که خوشه‌های Proxmox VE را زیر نظر می‌گیرد — گره‌ها، ماشین‌های مجازی QEMU، کانتینرهای LXC، ذخیره‌سازی و وضعیت HA. [prometheus-pve-exporter](https://github.com/prometheus-pve/prometheus-pve-exporter) را برداشت می‌کند (و اختیاراً صادرکننده را برایتان اجرا می‌کند)، هر سنجه‌ای را با هویت خوشه شما مهر می‌زند، و همه‌چیز را روی OTLP به OneUptime می‌فرستد. یک فایل `.env`، یک `docker compose up`.

این صفحه **راهنمای نصب** است. برای پیکربندی مانیتورها و هشدارهای Proxmox روی داده‌ای که عامل جمع می‌کند، [مانیتور Proxmox](/docs/monitor/proxmox-monitor) را ببینید.

## پیش‌نیازها

- ‏Docker Engine ‏20.10 به بالا با افزونه Docker Compose v2، روی هر ماشینی که بتواند به API ‏Proxmox VE شما برسد (درگاه ۸۰۰۶)
- توکن API در Proxmox VE با نقش **PVEAuditor** (فقط‌خواندنی)
- یک **توکن دریافت تله‌متری OneUptime** — از _Project Settings → Telemetry & APM → Ingestion Keys_ یکی بسازید و مقدارش را کپی کنید

### ساخت توکن API در Proxmox

**سریع‌ترین مسیر — این را روی هر گره PVE اجرا کنید** (پوسته به‌عنوان root):

```bash
pveum user token add monitoring@pam oneuptime --privsep 1
pveum acl modify / --roles PVEAuditor --tokens 'monitoring@pam!oneuptime'
```

(اگر کاربر `monitoring@pam` هنوز وجود ندارد، نخست با `pveum user add monitoring@pam` بسازیدش — توکن‌های API راز خودشان را حمل می‌کنند، پس کاربر به گذرواژه یا حساب سامانه‌ای نیاز ندارد.)

‏ACL باید در مسیر ریشه `/` بنشیند چون **PVEAuditor** به دسترسی خواندن هر گره، مهمان و شیء ذخیره‌سازی‌ای که صادرکننده می‌پیماید نیاز دارد — اعطایش روی مسیری تنگ‌تر باقی خوشه را پنهان می‌کند و خطاهای `401`/`403 Permission check failed (/, Sys.Audit)` تولید می‌کند. فرمان نخست راز توکن را یک بار چاپ می‌کند؛ در `.env` شما آن می‌شود `PVE_API_TOKEN_ID=monitoring@pam!oneuptime` و `PVE_API_TOKEN_SECRET=<راز چاپ‌شده>`.

**یا از راه رابط وب Proxmox:**

1. در رابط وب Proxmox به _Datacenter → Permissions → API Tokens_ بروید و **Add** را بزنید.
2. کاربری برگزینید (یا بسازید)، به توکن شناسه‌ای مانند `oneuptime` بدهید، و **Privilege Separation را تیک بردارید** (یا در گام بعدی به توکن دسترسی‌های خودش را بدهید).
3. زیر _Datacenter → Permissions_ دسترسی‌ای روی مسیر `/` برای توکن با نقش **PVEAuditor** بیفزایید.
4. شناسه توکن (`user@realm!tokenname`) و راز را کپی کنید — راز فقط یک بار نشان داده می‌شود.

### عامل را کجا اجرا کنیم

عامل API ‏PVE را روی شبکه پرس‌وجو می‌کند، پس لازم نیست روی گره‌ای از خوشه زندگی کند — و در حالت ایده‌آل نباید: آن را روی ماشینی اجرا کنید که از شکست گره‌ای جان به در می‌برد (ماشین مجازی کوچکی برای مانیتورینگ روی سخت‌افزار جدا، میزبانی مدیریتی)، یا `PVE_HOST` را به‌جای نشانی گرهی تنها به VIP / نام DNS چرخشی نشانه بگیرید. اگر هدف API عامل همان گره‌ای باشد که تازه مرده، مانیتورینگ شما هم با آن می‌میرد. (تنها استثنا خط لوله اختیاری گزارش‌های journald است، که باید روی گره PVE اجرا شود — [فرستادن گزارش‌های سرویس Proxmox](#اختیاری-فرستادن-گزارشهای-سرویس-proxmox) را ببینید.)

## شروع سریع (اسکریپت نصب)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/ProxmoxAgent/install.sh -o install.sh
bash install.sh
```

اسکریپت نشانی OneUptime، توکن دریافت تله‌متری، نام خوشه و جزئیات API ‏Proxmox شما را می‌پرسد، در `/opt/oneuptime-proxmox-agent` نصب می‌کند، و عامل را با Docker Compose آغاز می‌کند.

## جایگزین — Docker Compose

دو فایل را از [پوشه ProxmoxAgent](https://github.com/OneUptime/oneuptime/tree/master/ProxmoxAgent) — ‏`docker-compose.yml` و `otel-collector-config.yaml` — در پوشه‌ای دانلود کنید، سپس کنارشان فایلی `.env` بسازید:

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
PROXMOX_CLUSTER_NAME=my-proxmox-cluster
PVE_HOST=192.168.1.10
PVE_API_TOKEN_ID=oneuptime@pve!exporter
PVE_API_TOKEN_SECRET=your-token-secret
COMPOSE_PROFILES=pve-exporter
```

آغازش کنید (نمایه `pve-exporter` کانتینر صادرکننده همراه را هم آغاز می‌کند):

```bash
docker compose up -d
```

همین. پس از وصل شدن عامل، خوشه شما خودکار در بخش **Proxmox** داشبورد OneUptime پدیدار می‌شود.

اگر از پیش prometheus-pve-exporter را جایی اجرا می‌کنید، `COMPOSE_PROFILES`، `PVE_API_TOKEN_ID` و `PVE_API_TOKEN_SECRET` را بیندازید و به‌جایش عامل را به آن نشانه بگیرید:

```bash
PVE_EXPORTER_URL=your-exporter-host:9221
```

## متغیرهای محیطی

| متغیر | الزامی | توضیح |
| ----------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL` | بله | نشانی نمونه OneUptime شما (برای نمونه `https://oneuptime.com` یا میزبان خودمیزبانتان) |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | بله | توکن دریافت تله‌متری از _Project Settings → Telemetry & APM → Ingestion Keys_ |
| `PROXMOX_CLUSTER_NAME` | بله | شناسه خوشه که در OneUptime نشان داده می‌شود، روی هر سنجه‌ای به‌عنوان ویژگی منبع `proxmox.cluster.name` مهر می‌خورد. پایدار نگهش دارید — تغییرش بعداً خوشه دومی ثبت می‌کند. پیش‌فرض `proxmox-cluster` |
| `PVE_HOST` | بله | میزبان API ‏Proxmox VE (هر گره‌ای از خوشه) که صادرکننده پرس‌وجویش می‌کند، برای نمونه `192.168.1.10` |
| `PVE_EXPORTER_URL` | خیر | نشانی (`host:port`، بدون طرح) prometheus-pve-exporter. پیش‌فرض صادرکننده همراه (`pve-exporter:9221`) |
| `PVE_API_TOKEN_ID` | فقط صادرکننده همراه | شناسه کامل توکن API در Proxmox، برای نمونه `oneuptime@pve!exporter` |
| `PVE_API_TOKEN_SECRET` | فقط صادرکننده همراه | راز توکن API در Proxmox |
| `PVE_VERIFY_SSL` | خیر | تأیید گواهی TLS در API ‏Proxmox. پیش‌فرض `false` است چون Proxmox گواهی خودامضا عرضه می‌کند |
| `COMPOSE_PROFILES` | خیر | برای آغاز کانتینر صادرکننده همراه روی `pve-exporter` بگذارید |

## تأیید نصب

بررسی کنید عامل در حال اجراست:

```bash
docker compose ps
```

گزارش‌های جمع‌کننده را بررسی کنید:

```bash
docker logs -f oneuptime-proxmox-agent
```

دنبال این بگردید: `"Everything is ready. Begin running and processing data."`

ظرف حدود یک دقیقه خوشه باید در داشبورد OneUptime با سنجه‌های جاری پدیدار شود.

## چه چیزی جمع می‌شود

عامل هر ۳۰ ثانیه صادرکننده را با هر دو جمع‌کننده خوشه و گره فعال برداشت می‌کند — که جمع‌کننده‌های پیش‌فرض-روشن `backup-info` (سطح خوشه) و `replication` (سطح گره) صادرکننده را هم پوشش می‌دهد. هر سری برچسب `id`ای حمل می‌کند که منبع را شناسایی می‌کند — `node/<name>`، `qemu/<vmid>`، `lxc/<vmid>` یا `storage/<node>/<storage>`:

| دسته | سنجه‌ها |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **دسترس‌پذیری** | `pve_up`، `pve_uptime_seconds` |
| **گره** | `pve_node_info`، `pve_cpu_usage_ratio`، `pve_cpu_usage_limit`، `pve_memory_usage_bytes`، `pve_memory_size_bytes` |
| **مهمان (ماشین مجازی / LXC)** | `pve_guest_info`، سری‌های CPU / حافظه / شبکه روی شناسه‌های `qemu/*` و `lxc/*` ‏(`pve_network_receive_bytes`، `pve_network_transmit_bytes`) |
| **ذخیره‌سازی** | `pve_disk_usage_bytes`، `pve_disk_size_bytes`، `pve_storage_info` |
| **HA** | `pve_ha_state` |
| **پوشش پشتیبان‌گیری** | `pve_not_backed_up_total` (شمار مهمان‌هایی که هیچ کار پشتیبان‌گیری پوششان نمی‌دهد؛ سری‌ای در سطح خوشه، بدون برچسب `id`)، `pve_not_backed_up_info` (به ازای هر مهمان بی‌پوشش یک سری، برچسب‌خورده با `id` آن). مرز صادقانه: «پوشیده با کار پشتیبان‌گیری» یعنی مهمان دست‌کم در یک کار برگزیده شده — اینکه پشتیبان‌گیری اخیراً اجرا یا موفق شده را pve-exporter در معرض نمی‌گذارد |
| **همانندسازی** | `pve_replication_failed_syncs`، `pve_replication_duration_seconds`، `pve_replication_last_sync_timestamp_seconds`، `pve_replication_last_try_timestamp_seconds`، `pve_replication_next_sync_timestamp_seconds`، `pve_replication_info` — به ازای هر کار همانندسازی ذخیره‌سازی؛ برچسب `id` آن‌ها شناسه **کار** همانندسازی را حمل می‌کند (برای نمونه `100-0`)، نه شناسه منبعی |

معیارهای مانیتور و پالایه‌های ویژگی در OneUptime بر پایه برابری تطبیق می‌کنند نه پیشوند، پس پیکربندی جمع‌کننده عرضه‌شده برچسب `id` را به سه ویژگی نقطه داده‌ای اضافه هم تقسیم می‌کند (قالب‌های توکار هشدار Proxmox روی آن‌ها می‌پالایند — پردازشگر `transform/pve-identity` را سر جایش نگه دارید):

| ویژگی | مقادیر | نمونه برای `qemu/100` |
| ----------- | ---------------------------------------------------------------------------- | ---------------------- |
| `pve.scope` | `node`، `guest`، `storage`، `cluster` (‏`qemu` و `lxc` هر دو به `guest` نگاشت می‌شوند) | `guest` |
| `pve.type` | `node`، `qemu`، `lxc`، `storage` | `qemu` |
| `pve.id` | هر چیزی پس از نخستین `/` در `id` ‏(`pve1`، `100`، `pve1/local`) | `100` |

برچسب اصلی `id` دست‌نخورده نگه داشته می‌شود.

## اختیاری — فرستادن گزارش‌های سرویس Proxmox

به‌طور پیش‌فرض عامل **فقط سنجه** می‌فرستد، پس زبانه Logs داشبورد Proxmox خالی می‌ماند. صفحه کنترل PVE زیر هشت واحد به journal سیستم‌دی گزارش می‌دهد: `pveproxy`، `pvedaemon`، `pve-firewall`، `pve-ha-crm`، `pve-ha-lrm`، `pvescheduler`، `pvestatd` و `qmeventd`. فایل عرضه‌شده `otel-collector-config.yaml` گیرنده‌ای `journald` را به‌صورت توضیح دربر دارد که دقیقاً همان واحدها را نشانه می‌گیرد، و به خط لوله‌ای `logs` به‌صورت توضیح سیم‌کشی شده که `proxmox.cluster.name` را مهر می‌زند تا گزارش‌ها روی خوشه شما بنشینند.

برای فعال کردنش:

1. **عامل را روی گره PVE اجرا کنید.** journal به ازای هر میزبان است — عاملی از راه دور نمی‌تواند بخواندش. این تنها راه‌اندازی‌ای است که با توصیه جای‌گذاری بالا در تعارض است؛ اگر می‌خواهید عامل سنجه را بیرون از خوشه نگه دارید، به‌جایش جمع‌کننده‌ای دوم و فقط-گزارشی روی گره اجرا کنید (پیکربندی را کپی کنید، گیرنده `prometheus` و خط لوله `metrics` را حذف کنید).
2. **گیرنده `journald` و خط لوله `logs` را** در `otel-collector-config.yaml` از حالت توضیح درآورید.
3. **سوارسازی حجم‌های journal را** در `docker-compose.yml` از حالت توضیح درآورید تا کانتینر بتواند journal میزبان را بخواند:

   ```yaml
   - /var/log/journal:/var/log/journal:ro
   - /etc/machine-id:/etc/machine-id:ro
   ```

4. **ایمیج جمع‌کننده را عوض کنید.** ایمیج خام `otel/opentelemetry-collector-contrib` با `FROM scratch` ساخته شده است: باینری `journalctl` را ندارد (که گیرنده journald به آن پوسته می‌زند) و با کاربری غیر ریشه اجرا می‌شود که نمی‌تواند journal را بخواند. پوششی نازک بسازید و `image:` را در `docker-compose.yml` به آن نشانه بگیرید:

   ```dockerfile
   FROM otel/opentelemetry-collector-contrib:latest AS otelcol
   FROM debian:stable-slim
   RUN apt-get update \
       && apt-get install -y --no-install-recommends systemd \
       && rm -rf /var/lib/apt/lists/*
   COPY --from=otelcol /otelcol-contrib /otelcol-contrib
   ENTRYPOINT ["/otelcol-contrib"]
   CMD ["--config", "/etc/otelcol-contrib/config.yaml"]
   ```

   بسته `systemd` فقط برای باینری `journalctl` نصب می‌شود؛ این ایمیج به‌عنوان root اجرا می‌شود، که همان چیزی است که دسترسی خواندن journal را اعطا می‌کند. یا برای مسیر گزارش‌ها کلاً Docker را کنار بگذارید و بسته انتشار `.deb` از `otelcol-contrib` را مستقیم روی گره اجرا کنید — ‏`journalctl` از پیش آنجاست.

گزارش‌ها به ازای هر گره‌اند: گیرنده journald ژورنال گره‌ای را که عامل رویش اجرا می‌شود می‌فرستد. برای گزارش‌های سرویس از هر گرهی، جمع‌کننده فقط-گزارشی گام ۱ را روی هر گره اجرا کنید.

### پناه بدون ایمیج سفارشی — filelog روی ‎/var/log/syslog

اگر ترجیح می‌دهید ایمیج خام را نگه دارید، به‌جایش syslog را دنبال کنید: rsyslog را روی گره نصب کنید (`apt install rsyslog` — دبیان ۱۲ / PVE ‏۸ به بالا دیگر به‌طور پیش‌فرض عرضه‌اش نمی‌کنند)، `/var/log` را درون کانتینر سوار کنید (`- /var/log:/var/log:ro` — پوشه را سوار کنید نه فایل را، تا چرخش گزارش inodeای کهنه را سنجاق نکند)، و به‌جای گیرنده journald از گیرنده‌ای `filelog` استفاده کنید:

```yaml
receivers:
  filelog:
    include:
      - /var/log/syslog
    start_at: end
```

پالایش به ازای هر واحد را از دست می‌دهید (syslog همه‌چیز را حمل می‌کند، نه فقط آن هشت سرویس PVE) و کاربر غیر ریشه ایمیج خام باید بتواند فایل را بخواند، اما نیازی به عوض کردن ایمیج نیست. آن را به همان خط لوله `logs` توضیح‌شده سیم‌کشی کنید (`receivers: [filelog]`).

## جایگزین بدون نصب — ارسال بومی OpenTelemetry در Proxmox VE ‏۹ به بالا

‏Proxmox VE ‏۹٫۰ و بالاتر **کارساز سنجه OpenTelemetry** توکاری عرضه می‌کنند که سنجه‌های گره، مهمان و ذخیره‌سازی را به هر نقطه پایانی OTLP/HTTP می‌فرستد — بدون عامل یا صادرکننده‌ای برای نصب. آن را زیر _Datacenter → Metric Server → Add → OpenTelemetry_ پیکربندی کنید:

| فیلد | مقدار |
| -------- | -------------------------------------------------------------------- |
| Server | میزبان OneUptime شما، برای نمونه `oneuptime.com` (یا میزبان خودمیزبانتان) |
| Port | `443` |
| Protocol | `https` |
| Path | `/otlp/v1/metrics` |
| Headers | `{"x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"}` |

دو معامله که باید بدانید:

1. **کشف خوشه.** مسیر عامل همان چیزی است که ثبت خودکار خوشه را در OneUptime نیرو می‌دهد، چون ویژگی منبع `proxmox.cluster.name` را روی هر سنجه‌ای مهر می‌زند. با ارسال بومی، گزینه _Resource Attributes_ کارساز سنجه را روی `proxmox.cluster.name=my-proxmox-cluster` بگذارید تا خوشه خودش را ثبت کند — بدون آن سنجه‌ها به پروژه شما دریافت می‌شوند اما هیچ خوشه Proxmoxای پدیدار نمی‌شود.
2. **نام سنجه‌های متفاوت.** ارسال بومی سری‌های `proxmox_node_*` / `proxmox_vm_*` / `proxmox_storage_*` را منتشر می‌کند، در حالی که عامل سری‌های `pve_*` در pve-exporter را منتشر می‌کند. فهرست سنجه توکار Proxmox و قالب‌های هشدار OneUptime نام‌های `pve_*` را نشانه می‌گیرند، پس مسیر عامل توصیه می‌شود؛ ارسال بومی به‌عنوان راهی بدون نصب برای رساندن سنجه‌های خام به [کاوشگر سنجه](/docs/monitor/metrics-monitor) و داشبوردهای سفارشی عالی است.

می‌توانید هر دو را هم اجرا کنید: ارسال بومی برای سنجه‌های خام کم‌تأخیر، عامل برای کشف، صفحه‌های داشبورد Proxmox و قالب‌های هشدار.

## اجرا به‌عنوان سرویس systemd

```bash
sudo cp systemd/oneuptime-proxmox-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-proxmox-agent
```

واحد فرض می‌گیرد عامل در `/opt/oneuptime-proxmox-agent` زندگی می‌کند (پیش‌فرض اسکریپت نصب).

## ارتقای عامل

```bash
cd /opt/oneuptime-proxmox-agent
docker compose pull
docker compose up -d
```

## حذف نصب عامل

```bash
cd /opt/oneuptime-proxmox-agent
docker compose down
```

## ‏OneUptime خودمیزبان

اگر OneUptime را خودمیزبان می‌کنید، `ONEUPTIME_URL` را روی نمونه خودتان بگذارید:

```bash
ONEUPTIME_URL=https://your-oneuptime-host.example.com
```

اگر نمونه شما فقط HTTP است، از `http://` و درگاه مناسب استفاده کنید.

## رفع اشکال

### نخست اسکریپت تشخیص را اجرا کنید

عامل با اسکریپت دکتری، [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/ProxmoxAgent/troubleshoot.sh)، عرضه می‌شود که کل زنجیره را بررسی می‌کند: زمان اجرای کانتینر، برداشت صادرکننده، مهر خوردن نام خوشه، شکل توکن دریافت، سنجه‌های خودی جمع‌کننده، و **اعتبارسنجی قطعی توکن در سمت کارساز**. بررسی توکن مهم‌ترین است — نقطه‌های پایانی OTLP در OneUptime عمداً روی توکن دریافت بد `200` خاموشی برمی‌گردانند (تا جمع‌کننده‌ای بد پیکربندی‌شده نتواند کارساز را با تلاش دوباره غرق کند)، که یعنی گزارش‌های جمع‌کننده حتی وقتی هر نقطه داده‌ای انداخته می‌شود تمیز به نظر می‌رسند. اسکریپت `GET <url>/otlp/v1/validate` را از درون فضای‌نام شبکه عامل فرا می‌خواند تا رأی واقعی `200` (معتبر) / `401` (نامعتبر) بگیرد، و روی کارسازهای قدیمی‌تر به `POST /fluentd/v1/logs` بازمی‌گردد.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/ProxmoxAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-proxmox-agent
```

با بخشی به نام VERDICT پایان می‌یابد که محتمل‌ترین ریشه علت را نام می‌برد. بخش‌های زیر همان زمین را دستی پوشش می‌دهند.

### هیچ خوشه‌ای در OneUptime پدیدار نمی‌شود

1. گزارش‌های جمع‌کننده را بررسی کنید: `docker logs oneuptime-proxmox-agent` — ‏`401` هنگام صادرات یعنی توکن دریافت بد، و connection refused یعنی `ONEUPTIME_URL` اشتباه.
2. تأیید کنید برداشت صادرکننده کار می‌کند. صادرکننده همراه درگاهش را روی میزبان منتشر نمی‌کند، پس از درون فضای‌نام شبکه‌اش بیازماییدش: `docker run --rm --network container:oneuptime-pve-exporter curlimages/curl -s "http://localhost:9221/pve?target=YOUR_PVE_HOST" | head` باید خط‌های سنجه `pve_*` چاپ کند. (برای صادرکننده بیرونی، مستقیم `host:9221` آن را `curl` کنید.)
3. مطمئن شوید `PROXMOX_CLUSTER_NAME` تنظیم شده — کشف بر ویژگی منبع `proxmox.cluster.name` کلید می‌خورد.

### صادرکننده خطاهای ۴۰۱ / احراز هویت گزارش می‌کند

توکن API اشتباه است یا دسترسی ندارد. قالب شناسه توکن (`user@realm!tokenname`)، راز، و اینکه توکن نقش **PVEAuditor** را روی مسیر `/` دارد (با جداسازی امتیاز غیرفعال یا دسترسی‌های اعطاشده به خود توکن) دوباره بررسی کنید.

### فقط سنجه‌های گره، بدون سنجه مهمان

سری‌های مهمان (شناسه‌های `qemu/*`، `lxc/*`) از جمع‌کننده خوشه صادرکننده می‌آیند. پیکربندی عرضه‌شده فعالش می‌کند (پارامتر برداشت `cluster=1`) — اگر `otel-collector-config.yaml` را سفارشی کرده‌اید، پارامتر `cluster: ["1"]` را بازگردانید.

### سنجه‌ها زیر خوشه اشتباه می‌نشینند

‏OneUptime خوشه‌های Proxmox را بر پایه `proxmox.cluster.name` خودکار ثبت می‌کند، که از متغیر محیطی `PROXMOX_CLUSTER_NAME` گرفته می‌شود. تغییرش پس از نخستین دسته تله‌متری به‌جای تغییر نام موجود، سطر خوشه دومی می‌سازد.

## گام‌های بعدی

- **مانیتورهای Proxmox** را برای هشدار بر شرایط گره، مهمان، ذخیره‌سازی، HA، پوشش پشتیبان‌گیری و همانندسازی پیکربندی کنید — [مانیتور Proxmox](/docs/monitor/proxmox-monitor) را ببینید.
- ‏Ceph را به‌عنوان پشتوانه ذخیره‌سازی خوشه Proxmox خود زیر نظر می‌گیرید؟ این عامل را با [عامل Ceph در OneUptime](/docs/telemetry/ceph) جفت کنید.
- برای نمای سطح سیستم‌عامل میزبان‌های منفرد، از [جمع‌کننده OpenTelemetry میزبان](/docs/telemetry/host-otel-collector) استفاده کنید.
