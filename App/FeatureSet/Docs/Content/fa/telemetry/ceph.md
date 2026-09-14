# عامل Ceph در OneUptime

## نمای کلی

عامل Ceph در OneUptime جمع‌کننده‌ای از پیش پیکربندی‌شده از OpenTelemetry است که خوشه‌های Ceph را زیر نظر می‌گیرد — وضعیت سلامت، حد نصاب mon، ‏OSDها، استخرها و گروه‌های جای‌گذاری. ماژول `prometheus` در mgr را روی **هر** دیمن mgr برداشت می‌کند (پس سنجه‌ها از failover ‏mgr فعال جان به در می‌برند)، هر سنجه‌ای را با هویت خوشه شما مهر می‌زند، و همه‌چیز را روی OTLP به OneUptime می‌فرستد. یک فایل `.env`، یک `docker compose up`.

این صفحه **راهنمای نصب** است. برای پیکربندی مانیتورها و هشدارهای Ceph روی داده‌ای که عامل جمع می‌کند، [مانیتور Ceph](/docs/monitor/ceph-monitor) را ببینید.

## پیش‌نیازها

- ‏Docker Engine ‏20.10 به بالا با افزونه Docker Compose v2، روی هر ماشینی که بتواند به دیمن‌های mgr در Ceph شما برسد (درگاه ۹۲۸۳)
- ماژول `prometheus` در mgr فعال باشد (پایین‌تر را ببینید)
- یک **توکن دریافت تله‌متری OneUptime** — از _Project Settings → Telemetry & APM → Ingestion Keys_ یکی بسازید و مقدارش را کپی کنید

### فعال کردن ماژول Prometheus در mgr

```bash
ceph mgr module enable prometheus
```

آنگاه هر دیمن mgr سنجه‌های Prometheus را روی درگاه `9283` در مسیر `/metrics` سرو می‌کند. **فقط mgr فعال سنجه برمی‌گرداند** — ‏mgrهای آماده‌به‌کار با پاسخی خالی جواب می‌دهند (یا خطای HTTP اگر `mgr/prometheus/standby_behaviour` روی `error` تنظیم شده باشد). به همین دلیل عامل همه نقطه‌های پایانی mgr را برداشت می‌کند: وقتی mgr فعال failover شود، سنجه‌ها بدون هیچ تغییر پیکربندی جاری می‌مانند.

برای فهرست کردن دیمن‌های mgr خود:

```bash
ceph mgr stat                    # active mgr
ceph orch ps --daemon-type mgr   # all mgrs (cephadm clusters)
```

## شروع سریع (اسکریپت نصب)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/CephAgent/install.sh -o install.sh
bash install.sh
```

اسکریپت نشانی OneUptime، توکن دریافت تله‌متری، نام خوشه و نقطه‌های پایانی mgr شما را می‌پرسد، در `/opt/oneuptime-ceph-agent` نصب می‌کند، و عامل را با Docker Compose آغاز می‌کند.

## جایگزین — Docker Compose

دو فایل را از [پوشه CephAgent](https://github.com/OneUptime/oneuptime/tree/master/CephAgent) — ‏`docker-compose.yml` و `otel-collector-config.yaml` — در پوشه‌ای دانلود کنید، سپس کنارشان فایلی `.env` بسازید:

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
CEPH_CLUSTER_NAME=my-ceph-cluster
CEPH_MGR_ENDPOINTS=[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]
```

> **هر** دیمن mgr را (فعال و آماده‌به‌کار) جداشده با ویرگول و پیچیده در کروشه فهرست کنید — کروشه‌ها باعث می‌شوند جمع‌کننده مقدار را به‌عنوان فهرستی از هدف‌های برداشت تفکیک کند.

آغازش کنید:

```bash
docker compose up -d
```

همین. پس از وصل شدن عامل، خوشه شما خودکار در بخش **Ceph** داشبورد OneUptime پدیدار می‌شود.

## متغیرهای محیطی

| متغیر | الزامی | توضیح |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL` | بله | نشانی نمونه OneUptime شما (برای نمونه `https://oneuptime.com` یا میزبان خودمیزبانتان) |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | بله | توکن دریافت تله‌متری از _Project Settings → Telemetry & APM → Ingestion Keys_ |
| `CEPH_CLUSTER_NAME` | بله | شناسه خوشه که در OneUptime نشان داده می‌شود، روی هر سنجه‌ای به‌عنوان ویژگی منبع `ceph.cluster.name` مهر می‌خورد. پایدار نگهش دارید — تغییرش بعداً خوشه دومی ثبت می‌کند. پیش‌فرض `ceph` |
| `CEPH_MGR_ENDPOINTS` | بله | فهرست `host:port` جداشده با ویرگول از **همه** دیمن‌های mgr، پیچیده در کروشه، برای نمونه `[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]`. اسکریپت نصب کروشه‌ها را برایتان می‌افزاید |

## عامل چگونه برداشت می‌کند

- **همه mgrها، فاصله ۳۰ ثانیه.** ماژول prometheus در mgr هر برداشتی را به مدت `mgr/prometheus/scrape_interval` (پیش‌فرض ۱۵ ثانیه) در حافظه نهان نگه می‌دارد. هرگز زیر ۱۵ ثانیه برداشت نکنید — فقط دوباره حافظه نهان را می‌خواندید. ۳۰ ثانیه پیش‌فرض عرضه‌شده است.
- **`honor_labels: true`.** برچسب‌هایی که Ceph صادر می‌کند (`ceph_daemon`، `pool_id`، برچسب‌های نمونه به ازای هر دیمن) همان‌طور که هستند نگه داشته می‌شوند. بدون آن، برچسب `instance` به ازای هر هدف برداشت بازنویسی می‌شد و هر بار که mgr فعال عوض شود می‌چرخید، و پیوستگی سری را می‌شکست.

## تأیید نصب

بررسی کنید عامل در حال اجراست:

```bash
docker compose ps
```

گزارش‌های جمع‌کننده را بررسی کنید:

```bash
docker logs -f oneuptime-ceph-agent
```

دنبال این بگردید: `"Everything is ready. Begin running and processing data."`

ظرف حدود یک دقیقه خوشه باید در داشبورد OneUptime با سنجه‌های جاری پدیدار شود.

## چه چیزی جمع می‌شود

عامل هر چیزی را که ماژول prometheus در mgr صادر می‌کند می‌فرستد. سری‌هایی که داشبورد Ceph، فهرست سنجه و قالب‌های هشدار OneUptime روی آن‌ها ساخته شده‌اند:

| دسته | سنجه‌ها |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **سلامت خوشه** | `ceph_health_status` (‏۰ = OK، ‏۱ = WARN، ‏۲ = ERR)، `ceph_health_detail` (به ازای هر بررسی سلامت **فعال** یک سری، برچسب‌خورده با `name`/`severity` — از Quincy به بعد؛ قالب‌های هشدار بررسی سلامت و ریزبینی «چرا» در داشبورد را نیرو می‌دهد)، `ceph_healthcheck_slow_ops`، `ceph_daemon_health_metrics` (به ازای هر دیمن، کلیدخورده با `type`)، `ceph_mon_quorum_status`، `ceph_mon_metadata`، `ceph_cluster_total_bytes`، `ceph_cluster_total_used_bytes` |
| **OSD** | `ceph_osd_up`، `ceph_osd_in`، `ceph_osd_apply_latency_ms`، `ceph_osd_commit_latency_ms`، `ceph_osd_stat_bytes`، `ceph_osd_stat_bytes_used`، `ceph_osd_numpg`، `ceph_osd_metadata` — به ازای هر OSD از راه برچسب `ceph_daemon` (برای نمونه `osd.3`) |
| **استخر** | `ceph_pool_stored`، `ceph_pool_max_avail`، `ceph_pool_objects`، `ceph_pool_rd`، `ceph_pool_wr`، `ceph_pool_rd_bytes`، `ceph_pool_wr_bytes`، `ceph_pool_metadata` — سری‌های داده فقط برچسب `pool_id` حمل می‌کنند؛ نام استخر روی `ceph_pool_metadata` زندگی می‌کند |
| **گروه‌های جای‌گذاری** | `ceph_pg_total`، `ceph_pg_active`، `ceph_pg_clean`، `ceph_pg_degraded`، `ceph_pg_undersized` (همه به ازای هر استخر، برچسب `pool_id`)، `ceph_num_objects_degraded`، `ceph_num_objects_misplaced` |

## هدف‌های برداشت اضافی اختیاری

ماژول mgr سلامت و ظرفیت در سطح خوشه را پوشش می‌دهد. برای دید عمیق‌تر می‌توانید کارهای بیشتری زیر `scrape_configs` در `otel-collector-config.yaml` بیفزایید:

- **`ceph-exporter` (‏Reef ‏18.2 به بالا)** — ‏cephadm روی هر میزبان خوشه دیمنی `ceph-exporter` مستقر می‌کند که شمارنده‌های کارایی به ازای هر دیمن را روی درگاه `9926` سرو می‌کند. به ازای هر میزبان یک هدف بیفزایید.
- **`node_exporter`** — جفت استاندارد برای سنجه‌های سطح سیستم‌عامل (CPU، ‏RAM، دیسک‌ها، شبکه) روی هر میزبان Ceph، درگاه پیش‌فرض `9100`.

هر دو ویژگی منبع `ceph.cluster.name` را از پردازشگر `resource` عرضه‌شده به ارث می‌برند، پس روی همان خوشه در OneUptime می‌نشینند.

## اختیاری — فرستادن گزارش خوشه Ceph

عامل می‌تواند `/var/log/ceph/ceph.log` را دنبال کند و به OneUptime بفرستد، که صفحه **Cluster Log** داشبورد Ceph را نیرو می‌دهد. به‌طور پیش‌فرض خاموش است چون نیاز دارد عامل روی میزبانی اجرا شود که گزارش خوشه را دارد (به‌طور پیش‌فرض میزبان mon). برای فعال کردنش:

1. گیرنده `filelog` و خط لوله `logs` را در `otel-collector-config.yaml` از حالت توضیح درآورید.
2. سوارسازی حجم `/var/log/ceph` را در `docker-compose.yml` از حالت توضیح درآورید.
3. بازراه‌اندازی کنید: `docker compose up -d`

خط‌ها عیناً فرستاده می‌شوند؛ OneUptime قالب ceph.log را (مهر زمانی، دیمن، سطح INF/WRN/ERR، پیام) هنگام خواندن تفکیک می‌کند، و پردازشگر `resource` مقدار `ceph.cluster.name` را مهر می‌زند تا گزارش روی این خوشه بنشیند.

## اجرا به‌عنوان سرویس systemd

```bash
sudo cp systemd/oneuptime-ceph-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-ceph-agent
```

واحد فرض می‌گیرد عامل در `/opt/oneuptime-ceph-agent` زندگی می‌کند (پیش‌فرض اسکریپت نصب).

## ارتقای عامل

```bash
cd /opt/oneuptime-ceph-agent
docker compose pull
docker compose up -d
```

## حذف نصب عامل

```bash
cd /opt/oneuptime-ceph-agent
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

عامل با اسکریپت دکتری، [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/CephAgent/troubleshoot.sh)، عرضه می‌شود که کل زنجیره را بررسی می‌کند: زمان اجرای کانتینر، هر نقطه پایانی پیکربندی‌شده mgr (از جمله تله فعال-در-برابر-آماده‌به‌کار — فقط mgr فعال سنجه سرو می‌کند، پس وقتی هیچ نقطه پایانی‌ای `ceph_health_status` برنگرداند یا فقط یک نقطه پایانی پیکربندی شده باشد بلند هشدار می‌دهد)، مهر خوردن نام خوشه، شکل توکن دریافت، سنجه‌های خودی جمع‌کننده، و **اعتبارسنجی قطعی توکن در سمت کارساز**. بررسی توکن مهم‌ترین است — نقطه‌های پایانی OTLP در OneUptime عمداً روی توکن دریافت بد `200` خاموشی برمی‌گردانند (تا جمع‌کننده‌ای بد پیکربندی‌شده نتواند کارساز را با تلاش دوباره غرق کند)، که یعنی گزارش‌های جمع‌کننده حتی وقتی هر نقطه داده‌ای انداخته می‌شود تمیز به نظر می‌رسند. اسکریپت `GET <url>/otlp/v1/validate` را از درون فضای‌نام شبکه عامل فرا می‌خواند تا رأی واقعی `200` (معتبر) / `401` (نامعتبر) بگیرد، و روی کارسازهای قدیمی‌تر به `POST /fluentd/v1/logs` بازمی‌گردد.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/CephAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-ceph-agent
```

با بخشی به نام VERDICT پایان می‌یابد که محتمل‌ترین ریشه علت را نام می‌برد. بخش‌های زیر همان زمین را دستی پوشش می‌دهند.

### هیچ خوشه‌ای در OneUptime پدیدار نمی‌شود

1. گزارش‌های جمع‌کننده را بررسی کنید: `docker logs oneuptime-ceph-agent` — ‏`401` هنگام صادرات یعنی توکن دریافت بد، و connection refused یعنی `ONEUPTIME_URL` اشتباه.
2. تأیید کنید mgrای سنجه سرو می‌کند: `curl http://ACTIVE_MGR_HOST:9283/metrics | head` باید خط‌های سنجه `ceph_*` چاپ کند. اگر نه، ماژول را فعال کنید: `ceph mgr module enable prometheus`.
3. مطمئن شوید `CEPH_MGR_ENDPOINTS` در کروشه پیچیده شده — بدون آن‌ها جمع‌کننده کل رشته جداشده با ویرگول را یک هدف (نامعتبر) می‌داند.

### سنجه‌ها پس از failover ‏mgr می‌ایستند

احتمالاً فقط mgrای را که پیش‌تر فعال بود برداشت می‌کنید. **هر** دیمن mgr را در `CEPH_MGR_ENDPOINTS` فهرست کنید — برداشت mgrهای آماده‌به‌کار ارزان است و پاسخ‌های خالی برمی‌گرداند.

### خطاهای برداشت برای mgrهای آماده‌به‌کار در گزارش‌های جمع‌کننده

اگر `mgr/prometheus/standby_behaviour` روی خوشه شما `error` باشد انتظار می‌رود — آنگاه آماده‌به‌کارها با HTTP 500 پاسخ می‌دهند. برداشت mgr فعال همچنان موفق است، پس این‌ها نویزند؛ برای ساکت کردنشان رفتار را به `default` برگردانید.

### سنجه‌ها زیر خوشه اشتباه می‌نشینند

‏OneUptime خوشه‌های Ceph را بر پایه `ceph.cluster.name` خودکار ثبت می‌کند، که از متغیر محیطی `CEPH_CLUSTER_NAME` گرفته می‌شود. تغییرش پس از نخستین دسته تله‌متری به‌جای تغییر نام موجود، سطر خوشه دومی می‌سازد.

## گام‌های بعدی

- **مانیتورهای Ceph** را برای هشدار بر وضعیت سلامت، دسترس‌پذیری OSD، وضعیت‌های PG، ظرفیت، فروریزی دیمن، انحراف ساعت، عملیات کند و بیشتر پیکربندی کنید — [مانیتور Ceph](/docs/monitor/ceph-monitor) را ببینید.
- ‏Ceph را به‌عنوان ذخیره‌سازی Proxmox VE اجرا می‌کنید؟ این عامل را با [عامل Proxmox در OneUptime](/docs/telemetry/proxmox) جفت کنید.
- برای نمای سطح سیستم‌عامل میزبان‌های منفرد، از [جمع‌کننده OpenTelemetry میزبان](/docs/telemetry/host-otel-collector) استفاده کنید.
