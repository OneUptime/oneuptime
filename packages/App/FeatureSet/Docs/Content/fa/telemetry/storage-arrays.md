# عامل آرایه ذخیره‌سازی در OneUptime

## نمای کلی

عامل آرایه ذخیره‌سازی در OneUptime جمع‌کننده‌ای از پیش پیکربندی‌شده از OpenTelemetry است که آرایه‌های ذخیره‌سازی را زیر نظر می‌گیرد — ظرفیت و کاهش داده، تأخیر، IOPS و پهنای باند، ولوم‌ها، میزبان‌ها، پادها و تکثیر، سلامت سخت‌افزار، سیستم‌فایل‌ها و باکت‌ها. فقط پیکربندی است: کانتینر خام `otel/opentelemetry-collector-contrib` که نقاط پایانی OpenMetrics آرایه را با توکن API یک کاربر فقط‌خواندنی برداشت می‌کند، هر سنجه‌ای را با هویت آرایه شما مهر می‌زند، و همه‌چیز را روی OTLP به OneUptime می‌فرستد. یک فایل `.env`، یک `docker compose up`.

آرایه‌های ذخیره‌سازی در OneUptime محصولی مستقل از سازنده است. از این‌ها پشتیبانی می‌کند:

| آرایه | عامل چگونه آن را می‌خواند | پیکربندی جمع‌کننده |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Pure Storage FlashArray**، ‏Purity//FA نسخه 6.7 به بالا | نقطه پایانی OpenMetrics خودِ آرایه (`https://<array>/metrics/...?namespace=purefa`) — چیزی کنار جمع‌کننده اجرا نمی‌شود | `otel-collector-config.yaml` (پیش‌فرض) |
| **Pure Storage FlashArray**، ‏Purity//FA قدیمی‌تر | صادرکننده OpenMetrics ‏FlashArray از Pure، که همان فایل Compose آن را به‌عنوان سرویس `pure-fa-exporter` اجرا می‌کند | `otel-collector-config.flasharray-exporter.yaml` |
| **Pure Storage FlashBlade** | صادرکننده OpenMetrics ‏FlashBlade از Pure، که همان فایل Compose آن را به‌عنوان سرویس `pure-fb-exporter` اجرا می‌کند | `otel-collector-config.flashblade.yaml` |

‏Pure Storage در فوریه ۲۰۲۶ نام خود را به **Everpure** تغییر داد. FlashArray، FlashBlade و Purity نامشان را نگه داشتند، و سنجه‌های `purefa_*` / `purefb_*` هم، پس هر چه در این صفحه آمده بی‌تغییر برای آرایه‌هایی که با هر یک از این دو نام فروخته شده‌اند صدق می‌کند.

هر عامل یک آرایه را زیر نظر می‌گیرد. به ازای هر آرایه یک عامل اجرا کنید — [پایش چند آرایه](#پایش-چند-آرایه) را ببینید.

این صفحه **راهنمای نصب** است. برای پیکربندی مانیتورها و هشدارهای آرایه ذخیره‌سازی روی داده‌ای که عامل جمع می‌کند، [مانیتور آرایه ذخیره‌سازی](/docs/monitor/storage-array-monitor) را ببینید.

## پیش‌نیازها

- ‏Docker Engine ‏20.10 به بالا با افزونه Docker Compose v2، روی هر ماشینی که بتواند روی HTTPS (‏TCP ‏443) به رابط مدیریتی آرایه برسد
- کاربری روی آرایه با نقش توکار **readonly**، و یک توکن API برای آن (پایین را ببینید)
- یک **توکن دریافت تله‌متری OneUptime** — از _Project Settings → Telemetry & APM → Ingestion Keys_ یکی بسازید و مقدارش را کپی کنید

### ساخت کاربر فقط‌خواندنی و توکن API

عامل فقط می‌خواند. کاربری اختصاصی با نقش توکار **readonly** به آن بدهید — هرگز مدیر نه — و یک توکن API برای همان کاربر. توکن را **بدون تاریخ انقضا** بسازید، وگرنه عامل روزی که توکن منقضی شود می‌ایستد.

**‏FlashArray، با CLI ‏Purity** (با SSH به‌عنوان مدیر به آرایه وصل شوید):

```bash
pureadmin create --role readonly oneuptime
pureadmin create --api-token oneuptime
```

فرمان دوم توکن API را چاپ می‌کند، که یک UUID است. **‏FlashArray، در رابط گرافیکی:** _Settings → Users and Policies_ را باز کنید (_Settings → Access_ در نسخه‌های قدیمی‌تر)، از منوی ⋮ پنل **Users** گزینه **Create User…** را برگزینید و نقش readonly را به کاربر بدهید، سپس از منوی ⋮ کاربر تازه گزینه **Create API Token…** را برگزینید و **Expires In** را خالی بگذارید.

**‏FlashBlade:** کاربری با نقش **readonly** و یک توکن API برای آن به همین شیوه بسازید — در تنظیمات کاربران رابط گرافیکی FlashBlade، یا با `pureadmin` در CLI ‏Purity//FB. در نسخه‌ای که کاربر محلی ندارد، از حسابی در سرویس دایرکتوری (LDAP / Active Directory) استفاده کنید که گروهش به نقش readonly نگاشت شده است. توکن‌های API ‏FlashBlade با `T-` آغاز می‌شوند.

### نقطه پایانی بومی یا صادرکننده؟

‏Pure نقطه پایانی بومی OpenMetrics را برای **Purity//FA نسخه 6.7.0 به بالا** مستند کرده است (اطلاعیه منسوخ‌شدن صادرکننده FlashArray از Pure می‌گوید 6.6.11 به بالا). سریع‌ترین راه برای دانستن، پرسیدن از خود آرایه است، از ماشینی که عامل روی آن اجرا خواهد شد:

```bash
curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer <api-token>' | grep purefa_info
```

خطی به شکل `purefa_info{...} 1` یعنی آرایه سنجه‌هایش را به‌صورت بومی ارائه می‌کند: پیکربندی پیش‌فرض را به کار ببرید. پاسخ `404` یعنی نه: پیکربندی صادرکننده را به کار ببرید، که صادرکننده Pure را کنار جمع‌کننده اجرا می‌کند — Pure آن صادرکننده را منسوخ کرده است، پس پس از ارتقای آرایه به پیکربندی بومی بروید. FlashBlade همیشه از راه صادرکننده FlashBlade از Pure خوانده می‌شود.

### عامل را کجا اجرا کنیم

عامل روی HTTPS با رابط مدیریتی آرایه حرف می‌زند، پس می‌تواند روی هر ماشین Docker‌داری اجرا شود که روی TCP ‏443 به شبکه مدیریتی مسیر دارد — میزبانی برای مانیتورینگ یا ماشین مجازی مدیریتی کوچکی. ماشینی را ترجیح دهید که ذخیره‌سازی خودش روی همان آرایه‌ای که می‌پاید نباشد: اگر آرایه بیفتد، مانیتورینگ شما نباید با آن بیفتد. (شنونده اختیاری syslog افزون بر آن نیاز دارد آرایه روی درگاه syslog به عامل برسد — [فرستادن syslog آرایه](#اختیاری-فرستادن-syslog-آرایه) را ببینید.)

## شروع سریع (اسکریپت نصب)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/install.sh -o install.sh
bash install.sh
```

اسکریپت می‌پرسد این کدام آرایه است — FlashArray‌ای که سنجه‌های بومی ارائه می‌کند، FlashArray‌ای با Purity//FA قدیمی‌تر، یا FlashBlade — سپس نشانی OneUptime، توکن دریافت تله‌متری، نامی پایدار برای آرایه، نشانی مدیریتی آرایه، و توکن API کاربر فقط‌خواندنی را می‌پرسد (بدون بازتاب خوانده می‌شود). در `/opt/oneuptime-storage-array-agent` نصب می‌کند، فایل Compose و هر سه پیکربندی جمع‌کننده را دانلود می‌کند، با دسترسی `0600` فایل `.env` را با پیکربندی و پروفایل Compose متناظر می‌نویسد، و عامل را با Docker Compose آغاز می‌کند. مقدارها هنگام نوشتن برای Docker Compose نقل‌قول‌گذاری می‌شوند، اجرای دوباره اسکریپت به‌جای پرسیدن دوباره همه‌چیز را از `.env` موجود بازاستفاده می‌کند، و فایلی که ویرایش کرده‌اید پیش از جایگزینی به شکل `<file>.bak.<timestamp>` نگه داشته می‌شود.

## جایگزین — Docker Compose

‏`docker-compose.yml` و سه فایل `otel-collector-config*.yaml` را از [پوشه StorageArrayAgent](https://github.com/OneUptime/oneuptime/tree/master/agents/StorageArrayAgent) در پوشه‌ای دانلود کنید، سپس کنارشان فایلی `.env` بسازید (`chmod 600 .env` — توکن API در آن است). برای FlashArray‌ای که سنجه‌های بومی ارائه می‌کند:

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
STORAGE_ARRAY_NAME=my-storage-array
STORAGE_SYSTEM=purestorage.flasharray
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml
COMPOSE_PROFILES=
PURE_FA_ENDPOINT=fa-prod-01.example.com
PURE_FA_API_TOKEN=YOUR_READ_ONLY_API_TOKEN
PURE_FB_ENDPOINT=
PURE_FB_API_TOKEN=
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
```

برای FlashArray‌ای با Purity//FA قدیمی‌تر، `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` و `COMPOSE_PROFILES=flasharray-exporter` را بگذارید. برای FlashBlade، `STORAGE_SYSTEM=purestorage.flashblade`، `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flashblade.yaml` و `COMPOSE_PROFILES=flashblade` را بگذارید، و `PURE_FB_ENDPOINT` و `PURE_FB_API_TOKEN` را به‌جای جفت `PURE_FA_*` پر کنید.

آغازش کنید:

```bash
docker compose up -d
```

همین. پس از نخستین برداشت (حدود یک دقیقه) آرایه خودکار در بخش **Storage Arrays** داشبورد OneUptime پدیدار می‌شود.

## متغیرهای محیطی

| متغیر | الزامی | توضیح |
| ------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL` | بله | نشانی نمونه OneUptime شما (برای نمونه `https://oneuptime.com` یا میزبان خودمیزبانتان) |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | بله | توکن دریافت تله‌متری از _Project Settings → Telemetry & APM → Ingestion Keys_ |
| `STORAGE_ARRAY_NAME` | بله | نامی که این آرایه زیر آن در OneUptime ثبت می‌شود، روی هر سنجه‌ای به‌عنوان ویژگی منبع `storage.array.name` مهر می‌خورد. پایدار نگهش دارید — تغییرش بعداً آرایه دومی ثبت می‌کند. جمع‌کننده بدون آن آغاز نمی‌شود |
| `STORAGE_SYSTEM` | خیر | سکو، که به‌عنوان ویژگی منبع `storage.system` مهر می‌خورد: `purestorage.flasharray` یا `purestorage.flashblade`. پیش‌فرض `purestorage.flasharray` |
| `STORAGE_ARRAY_COLLECTOR_CONFIG` | خیر | کدام پیکربندی همراهِ جمع‌کننده اجرا شود: `otel-collector-config.yaml` (‏FlashArray، بومی — پیش‌فرض)، `otel-collector-config.flasharray-exporter.yaml` (‏FlashArray قدیمی‌تر) یا `otel-collector-config.flashblade.yaml` (‏FlashBlade) |
| `COMPOSE_PROFILES` | خیر | صادرکننده‌ای را که پیکربندی برگزیده برداشت می‌کند آغاز می‌کند: خالی برای پیکربندی بومی FlashArray، و `flasharray-exporter` یا `flashblade` برای دو پیکربندی دیگر |
| `PURE_FA_ENDPOINT` | FlashArray | نشانی مدیریتی FlashArray — نام میزبان یا IP، بدون `https://` |
| `PURE_FA_API_TOKEN` | FlashArray | توکن API کاربر FlashArray با نقش readonly |
| `PURE_FB_ENDPOINT` | FlashBlade | نشانی مدیریتی FlashBlade — نام میزبان یا IP، بدون `https://` |
| `PURE_FB_API_TOKEN` | FlashBlade | توکن API کاربر FlashBlade با نقش readonly |
| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | خیر | `true` گواهی خودامضای آرایه را روی نقطه پایانی بومی می‌پذیرد؛ `false` آن را تأیید می‌کند. پیش‌فرض `true`. صادرکننده‌های Pure هرگز گواهی آرایه را تأیید نمی‌کنند، پس این متغیر روی آن‌ها اثری ندارد |

## عامل چگونه برداشت می‌کند

- **یک کار برداشت به ازای هر نقطه پایانی**، هر یک به اندازه ارزشش. FlashArray: `/metrics/array` هر ۶۰ ثانیه؛ `/metrics/volumes`، `/metrics/hosts` و `/metrics/pods` هر ۲ دقیقه؛ `/metrics/directories` هر ۳۰ دقیقه، که توصیه خودِ Pure است — محاسبه فضای دایرکتوری‌ها برای آرایه پرهزینه است. FlashBlade: `/metrics/array` هر ۶۰ ثانیه؛ `/metrics/filesystems` و `/metrics/objectstore` هر ۵ دقیقه، باز هم به توصیه Pure که نقاط پایانی سیستم‌فایل و ذخیره‌ساز شیء را کمتر از خودِ آرایه بخوانید.
- **هر کار سری‌هایش را با `scrape_endpoint: <endpoint>` برچسب می‌زند.** هر نقطه پایانی `purefa_info` / `purefb_info` را هم صادر می‌کند، پس OneUptime می‌داند یک دسته فهرست کامل کدام خانواده‌هاست — این‌گونه است که ولوم، میزبان، پاد، سیستم‌فایل یا باکتِ حذف‌شده به‌جای ماندن، از فهرست موجودی بیرون می‌رود. برچسب‌ها را همان‌طور که ارسال شده‌اند نگه دارید.
- **تأخیر هر ولوم و هر میزبان سه بُعد را نگه می‌دارد.** هر ولوم و میزبان تأخیرش را در حداکثر شانزده `dimension` صادر می‌کند. یک قاعده `metric_relabel_configs`، ‏`usec_per_read_op`، `usec_per_write_op` و `usec_per_mirrored_write_op` را نگه می‌دارد و ریزتفکیک محدودیت نرخ QoS، صف، SAN و زمان سرویس را کنار می‌گذارد، که شمار سری‌های یک آرایه بزرگ را چندبرابر می‌کند. ریزتفکیک کل آرایه روی `purefa_array_performance_latency_usec` نگه داشته می‌شود. برای نگه داشتن ریزتفکیک هر ولوم هم، این قاعده را پاک کنید.
- **توکن API یک توکن Bearer است.** پیکربندی بومی آن را به خودِ آرایه می‌فرستد؛ پیکربندی‌های صادرکننده آن را فقط روی شبکه Compose به صادرکننده می‌فرستند — درگاه‌های صادرکننده‌ها هرگز منتشر نمی‌شوند.
- **بدون `send_batch_max_size`.** ‏OneUptime فهرست موجودی را در هر درخواست از یک برداشت کامل بازمی‌سازد، پس پردازشگر `batch` همراهِ عامل هرگز یک برداشت را میان چند صادرات تقسیم نمی‌کند. تنظیمات batch را همان‌طور که ارسال شده‌اند نگه دارید.

## تأیید نصب

بررسی کنید عامل در حال اجراست:

```bash
docker compose ps
```

گزارش‌های جمع‌کننده را بررسی کنید:

```bash
docker logs -f oneuptime-storage-array-agent
```

دنبال این بگردید: `"Everything is ready. Begin running and processing data."`

در حدود یک دقیقه آرایه با ظرفیت، کارایی، هشدارهای باز و سخت‌افزارش در داشبورد OneUptime پدیدار می‌شود. ولوم‌ها، میزبان‌ها و پادها ظرف ۲ دقیقه می‌رسند، سیستم‌فایل‌ها و باکت‌های FlashBlade ظرف ۵ دقیقه، و دایرکتوری‌های FlashArray ظرف ۳۰ دقیقه.

## چه چیزی جمع می‌شود

قراردادهای معنایی Pure میان نقطه پایانی بومی FlashArray و هر دو صادرکننده مشترک است. هر مقدار یک gauge است که خودِ آرایه حسابش می‌کند — تأخیر به میکروثانیه برای هر عملیات، توان عملیاتی برای هر ثانیه — پس محاسبه نرخی در کار نیست، و اشیا با **برچسب‌های datapoint** شناسایی می‌شوند (`name` برای ولوم‌ها، پادها، دایرکتوری‌ها، سیستم‌فایل‌ها و باکت‌ها؛ `host` برای میزبان‌ها؛ `component_name` برای سخت‌افزار FlashArray). عامل ویژگی‌های منبع `storage.array.name` و `storage.system` را هم رویشان می‌افزاید تا OneUptime بتواند همه‌چیز را به آرایه شما برساند:

| نقطه پایانی | خانواده‌های سنجه | آنچه OneUptime از آن‌ها می‌سازد |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ‏FlashArray `/metrics/array` | `purefa_info`، `purefa_alerts_open`، `purefa_array_space_*`، `purefa_array_performance_*`، `purefa_hw_component_status`، `purefa_hw_component_temperature_celsius`، `purefa_hw_controller_info`، `purefa_drive_capacity_bytes`، `purefa_network_interface_*` | نام آرایه، نسخه Purity و شناسه سیستم؛ ظرفیت، فضای استفاده‌شده و کاهش داده؛ شمار هشدارهای باز؛ سلامت آرایه؛ صفحه **Hardware** (قطعه‌ها، درایوها، کنترلرها، رابط‌های شبکه) |
| ‏FlashArray `/metrics/volumes` | `purefa_volume_performance_*`، `purefa_volume_space_*`، `purefa_volume_qos_*` | صفحه **Volumes**: اندازه تخصیص‌یافته و فیزیکی، کاهش داده، تأخیر خواندن و نوشتن، IOPS و پهنای باند هر ولوم |
| ‏FlashArray `/metrics/hosts` | `purefa_host_connectivity_info`، `purefa_host_connections_info`، `purefa_host_performance_*`، `purefa_host_space_*` | صفحه **Hosts**: اتصال (مسیرهای افزونه یا نه)، ولوم‌های متصل، تأخیر، IOPS و پهنای باند هر میزبان |
| ‏FlashArray `/metrics/pods` | `purefa_pod_performance_*`، `purefa_pod_space_*`، `purefa_pod_replica_links_*`، `purefa_pod_mediator_status` | صفحه **Replication**: پادهای ActiveCluster و ActiveDR، وضعیت و تأخیر پیوندهای replica |
| ‏FlashArray `/metrics/directories` | `purefa_directory_performance_*`، `purefa_directory_space_*` | صفحه **Directories** (‏FlashArray File Services) |
| ‏FlashBlade `/metrics/array` | `purefb_info`، `purefb_alerts_open`، `purefb_array_space_*`، `purefb_array_performance_*`، `purefb_hardware_health` | نام FlashBlade، نسخه Purity و شناسه سیستم؛ ظرفیت و کاهش داده؛ شمار هشدارهای باز؛ سلامت آرایه؛ صفحه **Hardware** |
| ‏FlashBlade `/metrics/filesystems` | `purefb_file_systems_space_*`، `purefb_file_systems_performance_*` | صفحه **File Systems**: فضای تخصیص‌یافته و استفاده‌شده، کاهش داده، تأخیر، IOPS و پهنای باند هر سیستم‌فایل |
| ‏FlashBlade `/metrics/objectstore` | `purefb_buckets_space_*`، `purefb_buckets_quota_space_bytes`، `purefb_buckets_object_count`، `purefb_buckets_performance_*`، `purefb_object_store_accounts_*` | صفحه **Buckets**: فضا، سهمیه، شمار اشیا و کارایی هر باکت، گروه‌بندی‌شده بر پایه حساب |

سلامت آرایه در نمای کلی‌اش **Critical** است تا وقتی هشداری بحرانیِ باز یا قطعه سخت‌افزاری، درایو یا کنترلری در وضعیت critical، ‏failed، ‏missing یا unhealthy گزارش کند؛ **Warning** تا وقتی هشدار هشداریِ باز یا قطعه‌ای degraded یا unknown گزارش کند؛ و در غیر این صورت **OK**. در ClickHouse — و بنابراین در معیارهای مانیتور — ویژگی‌های آرایه پیشوند `resource.` دارند (`resource.storage.array.name`، `resource.storage.system`)، در حالی که برچسب‌های datapoint بی‌پیشوند می‌مانند (`name`، `host`، `dimension`، `space`).

## اختیاری — فرستادن syslog آرایه

به‌طور پیش‌فرض عامل **فقط سنجه‌ها** را می‌فرستد، پس زبانه Logs آرایه ذخیره‌سازی خالی می‌ماند. آرایه‌ها هشدارها و رویدادهای ممیزی‌شان را به شکل syslog پیش می‌فرستند، و هر پیکربندی همراهِ جمع‌کننده یک جفت گیرنده `syslog` به‌صورت توضیح‌شده (TCP و UDP روی درگاه 5514، ‏RFC 3164) دارد که به یک خط لوله `logs` توضیح‌شده وصل است که `storage.array.name` را مهر می‌زند تا گزارش‌ها روی آرایه شما بنشینند.

برای فعال کردنش:

1. **دو گیرنده `syslog/*` و خط لوله `logs` را** در پیکربندی جمع‌کننده‌ای که به کار می‌برید **از حالت توضیح دربیاورید**. مهرهای زمانی RFC 3164 منطقه زمانی ندارند: `location` را روی منطقه زمانی آرایه بگذارید، مگر اینکه ساعتش روی UTC باشد.
2. **بلوک `ports:` را** در `docker-compose.yml` **از حالت توضیح دربیاورید** تا میزبان `5514/tcp` و `5514/udp` را منتشر کند، سپس `docker compose up -d`. درگاه را روی دیوار آتش ماشین برای شبکه مدیریتی آرایه باز کنید.
3. **آرایه را به عامل نشانه بروید**، به‌عنوان مدیر و نه کاربر فقط‌خواندنیِ مانیتورینگ. روی FlashArray، _Settings → System → Syslog Servers_ را باز کنید، `udp://<agent-host>:5514` (یا `tcp://<agent-host>:5514`) را بیفزایید، و یک پیام آزمایشی بفرستید. روی FlashBlade، سرور syslog‌ای با همان URI در تنظیمات syslog آن بیفزایید. هر دو آرایه شکل `PROTOCOL://HOST:PORT` را می‌پذیرند، از راه REST APIهایشان هم (`syslog-servers`).

گیرنده syslog در هر گیرنده فقط یک ترابری را می‌پذیرد، برای همین TCP و UDP دو گیرنده نام‌دار جدا هستند — اگر فقط یکی را نیاز دارید، دیگری را توضیح‌شده رها کنید. تصویر خام جمع‌کننده syslog را می‌فهمد؛ تصویر سفارشی لازم نیست.

## برچسب‌گذاری خودکار با برچسب‌های پروژه

هر ویژگی منبعی که پیشوند `oneuptime.label.` دارد به یک Label پروژه ارتقا می‌یابد و به آرایه ذخیره‌سازی پیوست می‌شود. الگو: `oneuptime.label.<dimension>=<value>` به برچسبی به نام `<dimension>:<value>` تبدیل می‌شود.

ویژگی‌ها را به پردازشگر `resource` در پیکربندی جمع‌کننده‌ای که به کار می‌برید بیفزایید (کنار `storage.array.name`):

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: storage
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
```

آرایه با برچسب‌های `team:storage` و `env:production` پدیدار می‌شود. برچسب‌ها بدون حساسیت به بزرگی و کوچکی حروف تطبیق داده می‌شوند، پس برچسب `Production` که پیش‌تر دستی ساخته شده بازاستفاده می‌شود و تکراری نمی‌شود؛ برچسب‌هایی که دستی در رابط OneUptime افزوده شده‌اند هرگز به دست عامل برداشته نمی‌شوند.

## پایش چند آرایه

هر عامل یک آرایه را می‌خواند. برای پایش چند آرایه از یک ماشین، هر کدام را در پوشه خودش با `.env` خودش نصب کنید — برای نمونه `INSTALL_DIR=/opt/oneuptime-storage-array-agent-fa02 bash install.sh` — و به هر کدام `container_name` خودش را در `docker-compose.yml` آن بدهید (برای نمونه `oneuptime-storage-array-agent-fa02`): دو کانتینر نمی‌توانند یک نام داشته باشند. پوشه را با `-d` به اسکریپت تشخیص بدهید.

## اجرا به‌عنوان سرویس systemd

```bash
sudo cp systemd/oneuptime-storage-array-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-storage-array-agent
```

این یونیت فرض می‌کند عامل در `/opt/oneuptime-storage-array-agent` (پیش‌فرض اسکریپت نصب) قرار دارد.

## ارتقای عامل

عامل نسخه جمع‌کننده‌ای را که فایل‌هایش سنجاق کرده‌اند به‌عنوان **Agent Version** خود گزارش می‌کند. وقتی آن نسخه از نسخه‌ای که این انتشار OneUptime سنجاق کرده قدیمی‌تر باشد، نشانه هشداری کنارش در **Overview** آرایه پدیدار می‌شود. آن را برگزینید تا همین فرمان‌ها را ببینید. عاملی که پیش از گزارش نسخه در فایل‌هایش نصب شده، تا وقتی به این روش ارتقا نیابد نسخه‌ای نشان نمی‌دهد.

تصویر جمع‌کننده در `docker-compose.yml` سنجاق شده و پیکربندی‌هایش فایل‌هایی کنار آن‌اند، پس pull به‌تنهایی عامل را جلو نمی‌برد. `install.sh` را دوباره اجرا کنید: هر مقدار `.env` موجود شما را بازاستفاده می‌کند (چیزی دوباره پرسیده نمی‌شود)، `docker-compose.yml` و سه پیکربندی جمع‌کننده را تازه می‌کند (فایلی را که ویرایش کرده بودید به‌صورت `<file>.bak.<timestamp>` نگه می‌دارد) و عامل را دوباره می‌سازد تا جمع‌کننده پیکربندی تازه‌اش را بخواند. عاملی که بیرون از `/opt/oneuptime-storage-array-agent` نصب شده، پوشه‌اش را لازم دارد: `INSTALL_DIR=<folder> bash install.sh`.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/install.sh -o install.sh
bash install.sh
```

آن را با Docker Compose نصب کرده‌اید؟ در پوشه عامل فایل compose و سه پیکربندی جمع‌کننده را دوباره دانلود کنید (هر تغییری را که در آن‌ها داده بودید دوباره اعمال کنید)، سپس تصویرها را pull کنید و عامل را دوباره بسازید:

```bash
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.yaml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.flashblade.yaml
docker compose pull
docker compose up -d --force-recreate
```

## حذف عامل

```bash
cd /opt/oneuptime-storage-array-agent
docker compose down
```

سپس اگر دیگر نیازشان ندارید، کاربر فقط‌خواندنی و توکن API آن را روی آرایه پاک کنید.

## OneUptime خودمیزبان

اگر OneUptime را خودتان میزبانی می‌کنید، `ONEUPTIME_URL` را روی نمونه خودتان بگذارید:

```bash
ONEUPTIME_URL=https://your-oneuptime-host.example.com
```

اگر نمونه شما فقط HTTP است، از `http://` و درگاه مناسب استفاده کنید.

## عیب‌یابی

### اول اسکریپت تشخیص را اجرا کنید

عامل همراه با یک اسکریپت پزشک، [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/agents/StorageArrayAgent/troubleshoot.sh)، می‌آید که کل زنجیره را بررسی می‌کند: محیط اجرای کانتینر، نقطه پایانی آرایه دقیقاً همان‌گونه که جمع‌کننده به آن می‌رسد (نقطه پایانی بومی یا صادرکننده Pure — DNS، ‏TLS، اینکه آیا FlashArray اصلاً نقطه پایانی بومی دارد، و اینکه آیا آرایه توکن API را می‌پذیرد، که اسکریپت آن را از راه stdin به curl می‌دهد)، مهر نام آرایه، شکل توکن دریافت، خودسنجه‌های جمع‌کننده، و یک **اعتبارسنجی قطعی توکن در سمت سرور**. بررسی توکن مهم‌ترین است — نقاط پایانی OTLP ‏OneUptime توکن دریافت نادرست را با `401` رد می‌کنند (`422` برای کلید غیرفعال یا کلید مرورگر)، و جمع‌کننده هر دو را دائمی می‌شمارد: دسته را دور می‌اندازد و برایش یک خطای `Exporting failed` ثبت می‌کند، که در حالی که خودِ کانتینر سالم می‌ماند به‌آسانی از چشم می‌افتد. اسکریپت از درون فضای نام شبکه عامل `GET <url>/otlp/v1/validate` را صدا می‌زند تا حکمی مستقیم `200` (معتبر) / `401` (نامعتبر) بگیرد، و روی سرورهای قدیمی‌تر به `POST /fluentd/v1/logs` بازمی‌گردد.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-storage-array-agent
```

با بخش VERDICT پایان می‌یابد که محتمل‌ترین علت ریشه‌ای را نام می‌برد. بخش‌های زیر همان زمینه را دستی پوشش می‌دهند.

### هیچ آرایه‌ای در OneUptime پدیدار نمی‌شود

1. گزارش‌های جمع‌کننده را بررسی کنید: `docker logs oneuptime-storage-array-agent` — ‏`server returned HTTP status 401` یعنی آرایه توکن API را رد کرده، `404` یعنی FlashArray نقطه پایانی بومی ندارد، `x509` یعنی تأیید TLS در برابر گواهی خودامضای آرایه روشن است، `no such host` / `connection refused` یعنی `PURE_FA_ENDPOINT` یا `PURE_FB_ENDPOINT` نادرست است، و `401` هنگام صادرات یعنی توکن دریافت نادرست است.
2. از شبکه عامل از آرایه بپرسید. تصویر جمع‌کننده distroless است (بدون پوسته، بدون curl)، پس از کانتینری خواهر در فضای نام شبکه آن آزمایش کنید: `docker run --rm --network container:oneuptime-storage-array-agent curlimages/curl -sk -H 'Authorization: Bearer <api-token>' 'https://<array>/metrics/array?namespace=purefa'` باید خطوط `purefa_*` را چاپ کند.
3. مطمئن شوید `STORAGE_ARRAY_NAME` تنظیم شده است — کشف بر ویژگی منبع `storage.array.name` تکیه دارد، و جمع‌کننده بدون آن آغاز نمی‌شود.

### ‏FlashArray با 404 پاسخ می‌دهد

‏Purity//FA آن نقطه پایانی بومی OpenMetrics ندارد. `install.sh` را دوباره اجرا کنید و گزینه Purity قدیمی‌تر را برگزینید، یا `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` و `COMPOSE_PROFILES=flasharray-exporter` را در `.env` بگذارید و `docker compose up -d` را اجرا کنید. پس از ارتقای آرایه به Purity//FA نسخه 6.7 به بالا، به پیکربندی بومی برگردید و پروفایل را کنار بگذارید.

### آرایه توکن API را رد می‌کند

بررسی کنید توکن API را چسبانده‌اید، نه گذرواژه کاربر را؛ کاربر هنوز وجود دارد و نقش readonly را دارد؛ و توکن منقضی نشده است. توکنی تازه بسازید (`pureadmin create --api-token oneuptime` روی FlashArray)، در `.env` بگذاریدش و `docker compose up -d` را اجرا کنید. از راه صادرکننده‌های Pure، توکن ردشده در گزارش جمع‌کننده به شکل HTTP ‏`400` از صادرکننده دیده می‌شود، که بدنه‌اش `failed to login` می‌گوید.

### خطاهای `x509` / TLS

آرایه‌ها به‌طور پیش‌فرض گواهی خودامضا ارائه می‌کنند، که هیچ تصویر Docker‌ای به آن اعتماد ندارد. یا `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` را بگذارید (انتخاب عملی روی یک شبکه مدیریتی خصوصی) یا گواهی‌ای از CA‌ای که تصویر جمع‌کننده به آن اعتماد دارد روی آرایه نصب کنید.

### نام `pure-fa-exporter` یا `pure-fb-exporter` پیدا نمی‌شود

سرویس صادرکننده در حال اجرا نیست: `COMPOSE_PROFILES` باید با `STORAGE_ARRAY_COLLECTOR_CONFIG` بخواند — `flasharray-exporter` برای پیکربندی صادرکننده FlashArray، و `flashblade` برای پیکربندی FlashBlade. ‏`.env` را درست کنید و `docker compose up -d` را اجرا کنید؛ سپس `docker compose ps` صادرکننده را فهرست می‌کند.

### ولوم‌ها یا میزبان‌های حذف‌شده در فهرست موجودی می‌مانند

‏OneUptime شیئی را وقتی برمی‌دارد که برداشتی کامل از نقطه پایانی‌اش دیگر آن را نداشته باشد، که آن را از برچسب `scrape_endpoint` بازمی‌شناسد. اگر پیکربندی همراهِ جمع‌کننده را با پیکربندی خودتان جایگزین کرده‌اید، برچسب‌های `scrape_endpoint` را روی کارهای برداشت آن نگه دارید؛ وگرنه اشیا فقط وقتی کهنه شوند از فهرست موجودی بیرون می‌روند.

### سنجه‌ها زیر آرایه اشتباه می‌نشینند

‏OneUptime آرایه‌های ذخیره‌سازی را با `storage.array.name` خودکار ثبت می‌کند، که از متغیر محیطی `STORAGE_ARRAY_NAME` گرفته می‌شود. تغییر آن پس از نخستین دسته تله‌متری به‌جای تغییر نام آرایه موجود، آرایه دومی می‌سازد.

### فرستادن سنجه‌ها بدون عامل

عامل یک پیکربندی خام جمع‌کننده است، پس ناوگان جمع‌کننده‌ای که از پیش اجرا می‌کنید می‌تواند همین کار را انجام دهد: کارهای برداشت و پردازشگر `resource` را از پیکربندی همراه به پیکربندی خودتان کپی کنید. ویژگی منبع `storage.array.name` همان چیزی است که آرایه را در OneUptime ثبت می‌کند، و حذف‌های `service.name` / `service.instance.id` نمی‌گذارند داده به یک Service خیالی برود — هر دو را نگه دارید، و برچسب‌های `scrape_endpoint` را هم.

## گام‌های بعدی

- **مانیتورهای آرایه ذخیره‌سازی** را پیکربندی کنید تا برای هشدارهای باز آرایه، ظرفیت، تأخیر، سخت‌افزار خراب یا degraded، درایوهای خراب، میزبان‌هایی که مسیرهای افزونه‌شان را از دست داده‌اند، تأخیر تکثیر و سیستم‌فایل‌های پر هشدار دهند — [مانیتور آرایه ذخیره‌سازی](/docs/monitor/storage-array-monitor) را ببینید.
- ‏VMware را روی آرایه اجرا می‌کنید؟ این عامل را با [عامل VMware در OneUptime](/docs/telemetry/vmware) جفت کنید تا نمای دیتااستور و ماشین مجازیِ همان ذخیره‌سازی را هم داشته باشید.
- برای نمای سطح سیستم‌عامل ماشین‌هایی که از آرایه استفاده می‌کنند، از [جمع‌کننده OpenTelemetry میزبان](/docs/telemetry/host-otel-collector) استفاده کنید.
