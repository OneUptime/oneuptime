# مانیتور آرایه ذخیره‌سازی

مانیتورینگ آرایه ذخیره‌سازی به شما امکان می‌دهد سلامت و کارایی آرایه‌های ذخیره‌سازی خود را زیر نظر بگیرید — هشدارهای خودِ آرایه، ظرفیت، تأخیر، سخت‌افزار، ولوم‌ها، میزبان‌ها، تکثیر، سیستم‌فایل‌ها و باکت‌ها — با آغاز از Pure Storage FlashArray و Pure Storage FlashBlade. OneUptime سنجه‌ها را از راه جمع‌کننده‌ای از پیش پیکربندی‌شده از OpenTelemetry (**عامل آرایه ذخیره‌سازی در OneUptime**) جمع می‌کند و بر پایه معیارهای پیکربندی‌شده شما می‌سنجدشان.

## نمای کلی

مانیتورهای آرایه ذخیره‌سازی از سنجه‌هایی که خودِ آرایه صادر می‌کند — سری‌های `purefa_*` و `purefb_*` از Pure — برای دید به ذخیره‌سازی شما استفاده می‌کنند. این به شما امکان می‌دهد:

- همان لحظه که آرایه هشدار بحرانی یا هشدار هشداری خودش را بالا می‌برد، هشدار بدهید
- تمام شدن ظرفیت را پیش از شکست نوشتن‌ها بگیرید
- تأخیر خواندن و نوشتن، IOPS و پهنای باند را برای کل آرایه، هر ولوم و هر میزبان ردیابی کنید
- قطعه‌های سخت‌افزاری خراب یا degraded و درایوهای خراب را تشخیص دهید
- میزبان‌هایی را که مسیرهای افزونه‌شان به آرایه را از دست داده‌اند پیدا کنید
- تأخیر تکثیر ActiveCluster / ActiveDR، و سیستم‌فایل‌های FlashBlade نزدیک به سهمیه‌شان را بپایید

## ساختن یک مانیتور آرایه ذخیره‌سازی

1. در داشبورد OneUptime به **Monitors** بروید
2. روی **Create Monitor** کلیک کنید
3. نوع مانیتور را **Storage Array** برگزینید
4. آرایه ذخیره‌سازی‌ای را که باید زیر نظر گرفته شود برگزینید
5. یک قالب را زیر **Quick Setup**، یک سنجه را زیر **Custom Metric** برگزینید، یا پرس‌وجوها و فرمول‌ها را زیر **Advanced** بسازید
6. معیارهای مانیتورینگ را به‌فراخور پیکربندی کنید

## گزینه‌های پیکربندی

### آرایه ذخیره‌سازی

آرایه ذخیره‌سازی‌ای را که باید زیر نظر گرفته شود برگزینید. آرایه‌ها نخستین بار که عامل آرایه ذخیره‌سازی در OneUptime از آن‌ها تله‌متری می‌فرستد خودکار ثبت می‌شوند (کلیدخورده بر پایه ویژگی منبع `storage.array.name`) — لازم نیست دستی بسازیدشان. هر پرس‌وجویی که مانیتور اجرا می‌کند خودکار با `resource.storage.array.name` برابر با نام آرایه برگزیده محدود می‌شود، پس دو آرایه که هر دو ولومی به نام `vol-01` دارند هرگز به مانیتورهای یکدیگر نشت نمی‌کنند. سکوی آرایه (`storage.system`: ‏`purestorage.flasharray` یا `purestorage.flashblade`) تعیین می‌کند فرم کدام سنجه‌ها و قالب‌ها را پیشنهاد کند.

### پالایه‌های منبع

اگر بخواهید، مانیتور را به یک شیء از آرایه تنگ کنید. هر پالایه برابری‌ای روی برچسب datapoint است که سکو آن شیء را با آن نام می‌برد:

| پالایه | سکو | برچسب datapoint | یادداشت‌ها |
| ------------------ | ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Volume | FlashArray | `name` | یک ولوم، برای نمونه `vol-db-01` |
| Host | FlashArray | `host` | یک میزبان آن‌گونه که آرایه می‌شناسدش، برای نمونه `esxi-01` |
| Pod | FlashArray | `name` (`local_pod` روی سری‌های پیوند replica) | یک پاد ActiveCluster / ActiveDR |
| Hardware Component | هر دو | `component_name` روی FlashArray، `name` روی FlashBlade | یک قطعه سخت‌افزاری، برای نمونه `CH0.BAY1` یا `CT0` |
| File System | FlashBlade | `name` | یک سیستم‌فایل |
| Bucket | FlashBlade | `name` | یک باکت ذخیره‌ساز شیء |

### پرس‌وجوهای سنجه

یک یا چند پرس‌وجوی سنجه برای ارزیابی پیکربندی کنید. هر پرس‌وجو این‌ها را مشخص می‌کند:

- **نام سنجه** — سنجه آرایه ذخیره‌سازی برای پرس‌وجو (سری‌های `purefa_*` یا `purefb_*`، کاتالوگ پایین را ببینید)
- **تجمیع** — اینکه مقادیر سنجه چگونه تجمیع شوند (Avg، Sum، Max، Min)
- **پالایه‌ها** — پالایش بر پایه ویژگی روی برچسب‌های datapoint: ‏`dimension` (اینکه یک سری کارایی کدام رقم را حمل می‌کند)، `space` (کدام رقم ظرفیت)، `severity` روی هشدارهای باز، `component_status` روی سخت‌افزار، `status` روی اتصال میزبان، `protocol` روی کارایی FlashBlade، `type` روی فضای FlashBlade
- **گروه‌بندی** — اگر بخواهید بر پایه برچسب شیء گروه‌بندی کنید (`name`، `host`، `component_name`، `local_pod`، `summary`) تا هر ولوم، میزبان، قطعه، پاد یا هشدار مستقل ارزیابی شود — یک حادثه به ازای هر شیء

می‌توانید **فرمول‌هایی** هم بسازید که چند پرس‌وجوی سنجه را با عبارت‌های ریاضی ترکیب کنند — برای نمونه ظرفیت استفاده‌شده از `purefa_array_space_bytes` پالوده به `space=capacity` منهای همان سنجه پالوده به `space=empty`.

### سری‌های Pure چه شکلی دارند

خانواده‌های کارایی Pure چند رقم را روی **یک** نام سنجه می‌گذارند، که فقط با برچسب `dimension` از هم جدا می‌شوند: `purefa_array_performance_latency_usec` تأخیر خواندن (`usec_per_read_op`)، تأخیر نوشتن (`usec_per_write_op`)، تأخیر نوشتن آینه‌ای، و اجزای SAN، صف، QoS و زمان سرویس هر یک را حمل می‌کند. همیشه روی یک `dimension` بپالایید — میانگین‌گیری روی همه آن‌ها تأخیر خواندن ۲۰۰ µs را با رقم صف درمی‌آمیزد. خانواده‌های فضا هم با برچسب `space` همین‌گونه کار می‌کنند (`capacity`، `empty`، `snapshots`، `total_provisioned`، `total_physical`، `available_ratio`، ...).

چند سری وضعیتشان را در یک **برچسب** حمل می‌کنند و مقدارشان همیشه 1 است: `purefa_alerts_open` (یک سری به ازای هر هشدار باز، با برچسب‌های `severity`، `summary`، `code`، `component_type`)، `purefa_hw_component_status` (با برچسب `component_status`)، `purefa_host_connectivity_info` (با برچسب‌های `status` و `details`)، و `purefa_drive_capacity_bytes` (با برچسب `component_status`، و مقدارش ظرفیت درایو). سری‌ای که به وضعیتی بد پالوده شده فقط تا وقتی وجود دارد که شیئی در آن وضعیت باشد — نبودنش یعنی سالم. این «Max > 0 شلیک می‌کند، = 0 بازمی‌یابد» را شکل درست هشدار دادن برایشان می‌کند، و قالب‌های پایین همین‌گونه ساخته شده‌اند (معیارهای بازیابی‌شان نبودن سری را صفر می‌شمارند).

در ClickHouse — و بنابراین در پالایه‌ها و کلیدهای گروه‌بندی مانیتور — ویژگی‌های عامل پیشوند `resource.` دارند (`resource.storage.array.name`، `resource.storage.system`)، در حالی که برچسب‌های datapoint ‏Pure بی‌پیشوندند (`name`، `host`، `component_name`، `dimension`، `space`، `severity`).

### پنجره زمانی غلتان

پنجره زمانی ارزیابی سنجه را برگزینید:

- ۱ دقیقه گذشته
- ۵ دقیقه گذشته
- ۱۰ دقیقه گذشته
- ۱۵ دقیقه گذشته
- ۳۰ دقیقه گذشته
- ۶۰ دقیقه گذشته

عامل نقطه پایانی آرایه را هر ۶۰ ثانیه و ولوم‌ها، میزبان‌ها و پادها را هر ۲ دقیقه می‌خواند، پس فرم برای یک سنجه سفارشی ۵ دقیقه را پیشنهاد می‌کند؛ سیستم‌فایل‌ها و باکت‌های FlashBlade هر ۵ دقیقه خوانده می‌شوند، پس برای آن‌ها ۱۵ را پیشنهاد می‌کند. دایرکتوری‌های FlashArray هر ۳۰ دقیقه خوانده می‌شوند — به مانیتور دایرکتوری پنجره‌ای ۶۰ دقیقه‌ای بدهید.

## سنجه‌های جمع‌آوری‌شده

عامل آرایه ذخیره‌سازی هر چه آرایه صادر می‌کند را می‌فرستد؛ سری‌های زیر کاتالوگی‌اند که فرم مانیتور پیشنهاد می‌کند. هر مقدار یک gauge است که خودِ آرایه حسابش می‌کند — تأخیرها میکروثانیه برای هر عملیات‌اند، توان عملیاتی برای هر ثانیه — پس محاسبه نرخی لازم نیست. **پالایه** همان پالایه برچسب datapoint است که سری را به معنایی که سطرش می‌گوید درمی‌آورد؛ فرم آن را برایتان اعمال می‌کند.

### سلامت آرایه

| سنجه | پالایه | سکو | واحد | توضیح |
| -------------------- | ------ | ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `purefa_alerts_open` | — | FlashArray | `count` | یک سری به ازای هر هشدار باز روی آرایه (مقدار 1)، با برچسب‌های `severity` (`critical`، `warning`، `info`، `hidden`)، `category`، `code`، `component_type` و `summary` |
| `purefb_alerts_open` | — | FlashBlade | `count` | یک سری به ازای هر هشدار باز روی FlashBlade (مقدار 1)، با برچسب‌های `severity` (`info`، `warning`، `critical`)، `code`، `component_name`، `component_type`، `summary` و `kburl` (مقاله پایگاه دانش Pure) |

### ظرفیت

| سنجه | پالایه | سکو | واحد | توضیح |
| ----------------------------------------- | ---------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `purefa_array_space_utilization` | — | FlashArray | `%` | سهم ظرفیت قابل استفاده آرایه که در استفاده است. Pure هشدارهای ظرفیت خودش را در ۸۰٪، ۹۰٪ و ۱۰۰٪ بالا می‌برد |
| `purefa_array_space_bytes` | `space=capacity` | FlashArray | `bytes` | ظرفیت قابل استفاده آرایه |
| `purefa_array_space_bytes` | `space=empty` | FlashArray | `bytes` | ظرفیت استفاده‌نشده — روندش را بگیرید تا پیش‌بینی کنید آرایه کی پر می‌شود |
| `purefa_array_space_bytes` | `space=snapshots` | FlashArray | `bytes` | فضای فیزیکی که فقط snapshotها نگه داشته‌اند؛ بالا رفتن سریع معمولاً یعنی گروه حفاظتی بیش از برنامه snapshot نگه می‌دارد |
| `purefa_array_space_data_reduction_ratio` | — | FlashArray | `ratio` | حذف تکرار و فشرده‌سازی در سراسر آرایه، برای نمونه 4.2 برای 4.2:1. افت پایدار یعنی داده تازه بد کاهش می‌یابد |
| `purefb_array_space_utilization` | `type=array` | FlashBlade | `%` | سهم ظرفیت قابل استفاده FlashBlade که در استفاده است |
| `purefb_array_space_bytes` | `type=array`، `space=empty` | FlashBlade | `bytes` | ظرفیت استفاده‌نشده FlashBlade |
| `purefb_array_space_data_reduction_ratio` | `type=array` | FlashBlade | `ratio` | کاهش داده در سراسر FlashBlade |

### کارایی

| سنجه | پالایه | سکو | واحد | توضیح |
| ------------------------------------------ | ---------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `purefa_array_performance_latency_usec` | `dimension=usec_per_read_op` | FlashArray | `µs` | میانگین تأخیر یک خواندن آن‌گونه که میزبان‌ها می‌بینند؛ خواندن‌های FlashArray معمولاً بسیار زیر ۱ ms کامل می‌شوند |
| `purefa_array_performance_latency_usec` | `dimension=usec_per_write_op` | FlashArray | `µs` | میانگین تأخیر یک نوشتن آن‌گونه که میزبان‌ها می‌بینند |
| `purefa_array_performance_latency_usec` | `dimension=usec_per_mirrored_write_op` | FlashArray | `µs` | میانگین تأخیر نوشتن در یک پاد کشیده ActiveCluster، با رفت‌وبرگشت تا آرایه همتا |
| `purefa_array_performance_latency_usec` | `dimension=san_usec_per_read_op` | FlashArray | `µs` | زمانی که یک خواندن در SAN می‌گذراند؛ تأخیر بالای SAN با تأخیر پایین سرویس به fabric یا میزبان اشاره می‌کند |
| `purefa_array_performance_throughput_iops` | `dimension=reads_per_sec` | FlashArray | `ops/s` | عملیات خواندن در ثانیه |
| `purefa_array_performance_throughput_iops` | `dimension=writes_per_sec` | FlashArray | `ops/s` | عملیات نوشتن در ثانیه |
| `purefa_array_performance_bandwidth_bytes` | `dimension=read_bytes_per_sec` | FlashArray | `bytes/s` | بایت‌های خوانده‌شده در ثانیه |
| `purefa_array_performance_bandwidth_bytes` | `dimension=write_bytes_per_sec` | FlashArray | `bytes/s` | بایت‌های نوشته‌شده در ثانیه |
| `purefa_array_performance_queue_depth_ops` | — | FlashArray | `ops` | عملیات در صف آرایه؛ صفی رو به رشد با تأخیر رو به افزایش یعنی میزبان‌ها بیش از توان سرویس آرایه می‌فرستند |
| `purefa_array_performance_average_bytes` | `dimension=bytes_per_op` | FlashArray | `bytes` | میانگین اندازه یک عملیات — ورودی/خروجی بزرگ بی‌آنکه چیزی خراب باشد تأخیر را بالا می‌برد |
| `purefb_array_performance_latency_usec` | `dimension=usec_per_read_op`، `protocol=all` | FlashBlade | `µs` | میانگین تأخیر خواندن در همه پروتکل‌ها |
| `purefb_array_performance_latency_usec` | `dimension=usec_per_write_op`، `protocol=all` | FlashBlade | `µs` | میانگین تأخیر نوشتن در همه پروتکل‌ها |
| `purefb_array_performance_throughput_iops` | `dimension=reads_per_sec`، `protocol=all` | FlashBlade | `ops/s` | عملیات خواندن در ثانیه در همه پروتکل‌ها |
| `purefb_array_performance_throughput_iops` | `dimension=writes_per_sec`، `protocol=all` | FlashBlade | `ops/s` | عملیات نوشتن در ثانیه در همه پروتکل‌ها |
| `purefb_array_performance_bandwidth_bytes` | `dimension=read_bytes_per_sec`، `protocol=all` | FlashBlade | `bytes/s` | بایت‌های خوانده‌شده در ثانیه در همه پروتکل‌ها |
| `purefb_array_performance_bandwidth_bytes` | `dimension=write_bytes_per_sec`، `protocol=all` | FlashBlade | `bytes/s` | بایت‌های نوشته‌شده در ثانیه در همه پروتکل‌ها |

### ولوم‌ها

| سنجه | پالایه | سکو | واحد | توضیح |
| ------------------------------------------- | -------------------------------- | ---------- | --------- | ------------------------------------------------------------- |
| `purefa_volume_performance_latency_usec` | `dimension=usec_per_read_op` | FlashArray | `µs` | میانگین تأخیر خواندن هر ولوم — بر پایه `name` گروه‌بندی کنید |
| `purefa_volume_performance_latency_usec` | `dimension=usec_per_write_op` | FlashArray | `µs` | میانگین تأخیر نوشتن هر ولوم |
| `purefa_volume_performance_throughput_iops` | `dimension=reads_per_sec` | FlashArray | `ops/s` | عملیات خواندن در ثانیه هر ولوم |
| `purefa_volume_performance_throughput_iops` | `dimension=writes_per_sec` | FlashArray | `ops/s` | عملیات نوشتن در ثانیه هر ولوم |
| `purefa_volume_performance_bandwidth_bytes` | `dimension=read_bytes_per_sec` | FlashArray | `bytes/s` | بایت‌های خوانده‌شده در ثانیه از هر ولوم |
| `purefa_volume_performance_bandwidth_bytes` | `dimension=write_bytes_per_sec` | FlashArray | `bytes/s` | بایت‌های نوشته‌شده در ثانیه در هر ولوم |
| `purefa_volume_space_bytes` | `space=total_provisioned` | FlashArray | `bytes` | اندازه هر ولوم آن‌گونه که میزبان‌ها می‌بینند |
| `purefa_volume_space_bytes` | `space=total_physical` | FlashArray | `bytes` | فضای فیزیکی که هر ولوم پس از کاهش داده به کار می‌برد |
| `purefa_volume_space_data_reduction_ratio` | — | FlashArray | `ratio` | نسبت کاهش داده هر ولوم |

### میزبان‌ها

| سنجه | پالایه | سکو | واحد | توضیح |
| ----------------------------------------- | ----------------------------- | ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `purefa_host_connectivity_info` | — | FlashArray | `count` | یک سری به ازای هر میزبان (مقدار 1) با برچسب `status` اتصالش (`healthy`، `critical`، `unused`) و `details` (`Redundant`، `Single Controller`، `None`، ...) |
| `purefa_host_performance_latency_usec` | `dimension=usec_per_read_op` | FlashArray | `µs` | میانگین تأخیر خواندنی که هر میزبان می‌بیند — بر پایه `host` گروه‌بندی کنید |
| `purefa_host_performance_latency_usec` | `dimension=usec_per_write_op` | FlashArray | `µs` | میانگین تأخیر نوشتنی که هر میزبان می‌بیند |
| `purefa_host_performance_throughput_iops` | `dimension=reads_per_sec` | FlashArray | `ops/s` | عملیات خواندن در ثانیه هر میزبان |
| `purefa_host_performance_throughput_iops` | `dimension=writes_per_sec` | FlashArray | `ops/s` | عملیات نوشتن در ثانیه هر میزبان |

### تکثیر

| سنجه | پالایه | سکو | واحد | توضیح |
| ---------------------------------------------------- | -------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `purefa_pod_replica_links_lag_max_msec` | — | FlashArray | `ms` | بزرگ‌ترین تأخیر تکثیر هر پیوند replica پاد (ActiveDR / ناهمگام)، با برچسب‌های `local_pod`، `remote_pod`، `remote`، `direction` و `status` — بر پایه `local_pod` گروه‌بندی کنید |
| `purefa_pod_replica_links_lag_average_msec` | — | FlashArray | `ms` | میانگین تأخیر تکثیر هر پیوند replica پاد |
| `purefa_pod_performance_replication_bandwidth_bytes` | — | FlashArray | `bytes/s` | ترافیک تکثیر هر پاد، با برچسب‌های `direction` و `dimension` |
| `purefa_pod_performance_latency_usec` | `dimension=usec_per_mirrored_write_op` | FlashArray | `µs` | میانگین تأخیر نوشتن آینه‌ای هر پاد ActiveCluster |

### سخت‌افزار

| سنجه | پالایه | سکو | واحد | توضیح |
| --------------------------------------------- | -------------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `purefa_hw_component_status` | — | FlashArray | `count` | یک سری به ازای هر قطعه سخت‌افزاری (مقدار 1) — شاسی، کنترلرها، جایگاه‌های درایو و NVRAM، منبع‌های تغذیه، فن‌ها، حسگرهای دما، درگاه‌های Ethernet و Fibre Channel — با برچسب `component_status` (`ok`، `critical`، `degraded`، `device_off`، `identifying`، `not_installed`، `unknown`) |
| `purefa_hw_component_temperature_celsius` | — | FlashArray | `°C` | دمای هر حسگر — بر پایه `component_name` گروه‌بندی کنید |
| `purefa_drive_capacity_bytes` | — | FlashArray | `bytes` | ظرفیت خام هر درایو، با برچسب `component_status` آن (`healthy`، `failed`، `missing`، `recovering`، `unhealthy`، `empty`، ...) و نوعش |
| `purefa_network_interface_performance_errors` | `dimension=total_errors_per_sec` | FlashArray | `errors/s` | خطا در ثانیه روی هر رابط Ethernet و Fibre Channel — خطاهای پایدار معمولاً یعنی کابل، ماژول نوری یا درگاه سوئیچ خراب |
| `purefb_hardware_health` | — | FlashBlade | — | سلامت هر قطعه سخت‌افزاری (blade، ماژول fabric، منبع تغذیه، فن، ...): 1 = سالم، 2 = بی‌استفاده، 0 = ناسالم. کمینه را به ازای هر `name` بگیرید |

### سیستم‌فایل‌ها

| سنجه | پالایه | سکو | واحد | توضیح |
| ---------------------------------------------- | ----------------------------- | ---------- | ------- | -------------------------------------------------------------------------------------------- |
| `purefb_file_systems_performance_latency_usec` | `dimension=usec_per_read_op` | FlashBlade | `µs` | میانگین تأخیر خواندن هر سیستم‌فایل — بر پایه `name` گروه‌بندی کنید |
| `purefb_file_systems_performance_latency_usec` | `dimension=usec_per_write_op` | FlashBlade | `µs` | میانگین تأخیر نوشتن هر سیستم‌فایل |
| `purefb_file_systems_space_bytes` | `space=total_physical` | FlashBlade | `bytes` | فضای فیزیکی که هر سیستم‌فایل به کار می‌برد |
| `purefb_file_systems_space_bytes` | `space=available_ratio` | FlashBlade | `ratio` | سهمی از اندازه تخصیص‌یافته هر سیستم‌فایل که هنوز در دسترس است، از 0 تا 1 — نزدیک 0 یعنی در آستانه پر کردن سهمیه‌اش است |

### باکت‌ها

| سنجه | پالایه | سکو | واحد | توضیح |
| ----------------------------------------- | ---------------------------- | ---------- | ------- | ----------------------------------------------------- |
| `purefb_buckets_performance_latency_usec` | `dimension=usec_per_read_op` | FlashBlade | `µs` | میانگین تأخیر خواندن هر باکت — بر پایه `name` گروه‌بندی کنید |
| `purefb_buckets_space_bytes` | `space=total_physical` | FlashBlade | `bytes` | فضای فیزیکی که هر باکت به کار می‌برد |
| `purefb_buckets_object_count` | — | FlashBlade | `count` | شمار اشیای هر باکت |

## معیارهای مانیتورینگ

### چه چیزی ارزیابی می‌شود

این مانیتورها همیشه **مقدار سنجه** را ارزیابی می‌کنند — مقدار پرس‌وجوی سنجه یا فرمول پیکربندی‌شده. فرم معیارها انتخابگر Filter Type ندارد؛ **Metric**، **Aggregation**، **Condition** و **Threshold** را نشان می‌دهد.

### انواع تجمیع

| تجمیع | توضیح |
| ------------- | ---------------------------------- |
| Average | مقدار میانگین روی پنجره زمانی |
| Sum | مجموع همه مقادیر |
| Maximum Value | بالاترین مقدار در پنجره زمانی |
| Minimum Value | پایین‌ترین مقدار در پنجره زمانی |
| All Values | همه مقادیر باید با معیار مطابق باشند |
| Any Value | دست‌کم یک مقدار باید مطابق باشد |

### شرط‌ها

آستانه‌های ایستا — با **Threshold**ای که وارد می‌کنید مقایسه می‌شوند:

- **Greater Than**، **Less Than**، **Greater Than or Equal To**، **Less Than or Equal To**، **Equal To**

تشخیص ناهنجاری بر پایه خط پایه — بدون آستانه؛ فرم به‌جایش **Sensitivity** و **Baseline Window** را نشان می‌دهد، و هر نمونه را با خط پایه همان ساعت هفته که از آن پنجره ساخته شده مقایسه می‌کند:

- **Anomalously High** — مقدار بالاتر از محدوده مورد انتظار می‌رود
- **Anomalously Low** — مقدار پایین‌تر از محدوده مورد انتظار می‌افتد
- **Anomalous** — مقدار در هر جهتی از محدوده مورد انتظار بیرون می‌رود

شرط‌های ناهنجاری در وضعیت «Learning» می‌مانند و تا وقتی دست‌کم به اندازه Baseline Window برگزیده تاریخچه سنجه وجود نداشته باشد هیچ هشداری تولید نمی‌کنند.

### نمونه‌های معیار

- **ولومی کند است** — `purefa_volume_performance_latency_usec` پالوده به `dimension=usec_per_read_op`، میانگین، گروه‌بندی‌شده بر پایه `name`، **Greater Than** ‏`2000` روی ۱۰ دقیقه گذشته.
- **آرایه پر می‌شود** — `purefa_array_space_utilization`، بیشینه، **Greater Than** ‏`85` روی ۱۵ دقیقه گذشته.
- **میزبانی روی یک کنترلر کار می‌کند** — `purefa_host_connectivity_info` پالوده به `status=critical`، بیشینه، گروه‌بندی‌شده بر پایه `host`، **Greater Than** ‏`0`.
- **سیستم‌فایلی در FlashBlade تقریباً پر است** — `purefb_file_systems_space_bytes` پالوده به `space=available_ratio`، کمینه، گروه‌بندی‌شده بر پایه `name`، **Less Than** ‏`0.05`.

## قالب‌های آماده هشدار

‏OneUptime ‏۱۸ قالب عرضه می‌کند — ۱۱ برای FlashArray و ۷ برای FlashBlade — و فرم قالب‌های سکوی آرایه برگزیده را پیشنهاد می‌کند. هرکدام مانیتوری کامل می‌سازند — پرس‌وجوی سنجه، پالایه‌های برچسب، گروه‌بندی بر پایه برچسب خود شیء، معیاری برای شلیک، و معیاری برای بازیابی خودکار — که پس از اعمال می‌توانید ویرایششان کنید. آستانه‌ها نقطه آغازند. معیاری باید برای **هر** مقدار پنجره‌اش برقرار باشد تا شلیک کند، و مانیتوری که روی آستانه ظرفیت، تأخیر، عقب‌افتادگی یا نسبت شلیک کرده فقط ۱۰٪ آن‌سوی آستانه بازمی‌یابد، تا مقداری که حوالی آستانه نوسان دارد پس‌وپیش نرود؛ قالب‌های هشدار و سخت‌افزار همین که وضعیت برطرف شود بازمی‌یابند:

### FlashArray

| قالب | دسته | شدت | چه می‌پاید | شلیک می‌کند وقتی |
| ------------------------------ | ------------ | -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Critical Array Alert | سلامت آرایه | بحرانی | `purefa_alerts_open` پالوده به `severity=critical`، بیشینه (Max) به ازای هر `summary`، ۵ دقیقه گذشته | > 0 — آرایه هشدار بحرانی بازی دارد (قطعه‌ای خراب، وضعیت اضطراری ظرفیت، شکست تکثیر). یک حادثه به ازای هر هشدار؛ وقتی هشدار بسته شود بازمی‌یابد |
| Warning Array Alert | سلامت آرایه | هشدار | `purefa_alerts_open` پالوده به `severity=warning`، بیشینه (Max) به ازای هر `summary`، ۵ دقیقه گذشته | > 0 — آرایه هشدار هشداری بازی دارد. یک حادثه به ازای هر هشدار؛ وقتی هشدار بسته شود بازمی‌یابد |
| Capacity Above 80% | ظرفیت | هشدار | `purefa_array_space_utilization`، بیشینه (Max)، ۱۵ دقیقه گذشته | > 80 — نخستین آستانه ظرفیت خودِ Pure؛ در ≤ 72 بازمی‌یابد |
| Capacity Above 90% | ظرفیت | بحرانی | `purefa_array_space_utilization`، بیشینه (Max)، ۵ دقیقه گذشته | > 90 — آرایه نزدیک به رد کردن نوشتن‌هاست؛ در ≤ 81 بازمی‌یابد |
| High Read Latency | کارایی | هشدار | `purefa_array_performance_latency_usec` پالوده به `dimension=usec_per_read_op`، میانگین (Avg)، ۱۰ دقیقه گذشته | > 5000 µs (5 ms) — خواندن‌های FlashArray معمولاً بسیار زیر ۱ ms کامل می‌شوند؛ در ≤ 4500 بازمی‌یابد |
| High Write Latency | کارایی | هشدار | `purefa_array_performance_latency_usec` پالوده به `dimension=usec_per_write_op`، میانگین (Avg)، ۱۰ دقیقه گذشته | > 5000 µs (5 ms)؛ در ≤ 4500 بازمی‌یابد |
| Hardware Component Failed | سخت‌افزار | بحرانی | `purefa_hw_component_status` پالوده به `component_status=critical`، بیشینه (Max) به ازای هر `component_name`، ۵ دقیقه گذشته | > 0 — کنترلر، منبع تغذیه، فن، جایگاه یا درگاهی بحرانی است و افزونگی از دست رفته. یک حادثه به ازای هر قطعه؛ وقتی ok گزارش کند بازمی‌یابد |
| Hardware Component Degraded | سخت‌افزار | هشدار | `purefa_hw_component_status` پالوده به `component_status=degraded`، بیشینه (Max) به ازای هر `component_name`، ۵ دقیقه گذشته | > 0 — قطعه‌ای degraded است. یک حادثه به ازای هر قطعه؛ وقتی ok گزارش کند بازمی‌یابد |
| Drive Failed | سخت‌افزار | بحرانی | `purefa_drive_capacity_bytes` پالوده به `component_status=failed`، بیشینه (Max) به ازای هر `component_name`، ۵ دقیقه گذشته | > 0 — ماژول DirectFlash یا SSD‌ای خراب شده و آرایه روی بقیه بازسازی می‌کند. یک حادثه به ازای هر درایو؛ وقتی جایگزین شود بازمی‌یابد |
| Host Lost Redundant Paths | میزبان‌ها | هشدار | `purefa_host_connectivity_info` پالوده به `status=critical`، بیشینه (Max) به ازای هر `host`، ۵ دقیقه گذشته | > 0 — میزبان از راه یک کنترلر یا هیچ کنترلری به آرایه می‌رسد؛ یک failover کنترلر ذخیره‌سازی‌اش را از دسترس خارج می‌کند. یک حادثه به ازای هر میزبان؛ وقتی مسیرهایش برگردند بازمی‌یابد |
| Replication Lag Above 1 Minute | تکثیر | هشدار | `purefa_pod_replica_links_lag_max_msec`، بیشینه (Max) به ازای هر `local_pod`، ۱۰ دقیقه گذشته | > 60000 ms (60 s) — failover در این لحظه نوشتن‌های تازه‌تری از آنچه برنامه‌ریزی شده از دست می‌دهد. یک حادثه به ازای هر پاد؛ در ≤ 54000 بازمی‌یابد |

### FlashBlade

| قالب | دسته | شدت | چه می‌پاید | شلیک می‌کند وقتی |
| ---------------------------- | ------------ | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Critical Array Alert | سلامت آرایه | بحرانی | `purefb_alerts_open` پالوده به `severity=critical`، بیشینه (Max) به ازای هر `summary`، ۵ دقیقه گذشته | > 0 — ‏FlashBlade هشدار بحرانی بازی دارد. یک حادثه به ازای هر هشدار؛ وقتی هشدار بسته شود بازمی‌یابد |
| Warning Array Alert | سلامت آرایه | هشدار | `purefb_alerts_open` پالوده به `severity=warning`، بیشینه (Max) به ازای هر `summary`، ۵ دقیقه گذشته | > 0 — ‏FlashBlade هشدار هشداری بازی دارد. یک حادثه به ازای هر هشدار؛ وقتی هشدار بسته شود بازمی‌یابد |
| Capacity Above 80% | ظرفیت | هشدار | `purefb_array_space_utilization` پالوده به `type=array`، بیشینه (Max)، ۱۵ دقیقه گذشته | > 80؛ در ≤ 72 بازمی‌یابد |
| Capacity Above 90% | ظرفیت | بحرانی | `purefb_array_space_utilization` پالوده به `type=array`، بیشینه (Max)، ۵ دقیقه گذشته | > 90 — وقتی پر شود نوشتن برای هر کلاینتی شکست می‌خورد؛ در ≤ 81 بازمی‌یابد |
| Hardware Component Unhealthy | سخت‌افزار | بحرانی | `purefb_hardware_health`، کمینه (Min) به ازای هر `name`، ۵ دقیقه گذشته | < 1 — یک blade، ماژول fabric، منبع تغذیه یا فن سالم نیست (جایگاه بی‌استفاده 2 گزارش می‌کند). یک حادثه به ازای هر قطعه؛ در ≥ 1 بازمی‌یابد |
| High Read Latency | کارایی | هشدار | `purefb_array_performance_latency_usec` پالوده به `dimension=usec_per_read_op` و `protocol=all`، میانگین (Avg)، ۱۰ دقیقه گذشته | > 10000 µs (10 ms) در همه پروتکل‌ها؛ در ≤ 9000 بازمی‌یابد |
| File System Near Full | سیستم‌فایل‌ها | هشدار | `purefb_file_systems_space_bytes` پالوده به `space=available_ratio`، کمینه (Min) به ازای هر `name`، ۱۵ دقیقه گذشته | < 0.1 — کمتر از ۱۰٪ اندازه تخصیص‌یافته سیستم‌فایل باقی مانده. یک حادثه به ازای هر سیستم‌فایل؛ در ≥ 0.11 بازمی‌یابد |

> یادداشت‌هایی درباره انتخاب‌های پخته‌شده در این‌ها: قالب‌های هشدار باز و وضعیت سخت‌افزار از **بیشینه** سری‌ای استفاده می‌کنند که فقط تا وقتی هشدار باز است یا قطعه در آن وضعیت است وجود دارد، پس یک برداشت که آن را نشان دهد آستانه را می‌لغزاند، و معیارهای بازیابی‌شان نبودن سری را صفر می‌شمارند — مانیتور وقتی هشدار بسته شود یا قطعه بهبود یابد به سالم برمی‌گردد. هر قالب به ازای هر شیء بر پایه برچسب خود شیء گروه‌بندی می‌کند (`summary`، `component_name`، `host`، `local_pod`، `name`)، پس به ازای هر شیء متأثر یک حادثه شلیک می‌شود و هشدار نامش را می‌برد. قالب‌های تأخیر از **میانگین** میانگین هر عملیاتِ خودِ آرایه استفاده می‌کنند، و قالب‌های ظرفیت از **بیشینه** درصد بهره‌برداری خودِ آرایه. قالب سخت‌افزار FlashBlade از **کمینه** به ازای هر قطعه استفاده می‌کند، چون سلامت یک قطعه وقتی سالم است 1 است و وقتی نیست به 0 می‌افتد. تأخیرها به میکروثانیه سنجاق شده‌اند، ظرفیت به درصد.

بدون پوشش قالب، با دلایل: تأخیر هر ولوم به بار کاری وابسته است، پس آستانه واحدی برای عرضه وجود ندارد — آن را از کاتالوگ با گروه‌بندی بر پایه `name` بسازید؛ پیش‌بینی ظرفیت به برازش رشد نیاز دارد نه آستانه؛ فرسایش درایو و پیش‌بینی SMART هیچ سری OpenMetrics ندارند.

## نیازمندی‌های راه‌اندازی

برای استفاده از مانیتورینگ آرایه ذخیره‌سازی، باید:

1. کاربری با نقش readonly و یک توکن API برای آن روی آرایه بسازید
2. عامل آرایه ذخیره‌سازی در OneUptime را روی ماشینی نصب کنید که بتواند روی HTTPS به رابط مدیریتی آرایه برسد — [راهنمای نصب عامل آرایه ذخیره‌سازی](/docs/telemetry/storage-arrays) را ببینید
3. مقادیر `ONEUPTIME_URL`، `ONEUPTIME_TELEMETRY_INGESTION_KEY`، `STORAGE_ARRAY_NAME`، و نشانی و توکن API آرایه (`PURE_FA_ENDPOINT` / `PURE_FA_API_TOKEN` یا `PURE_FB_ENDPOINT` / `PURE_FB_API_TOKEN`) را به‌عنوان متغیر محیطی بدهید
4. منتظر خودثبت شدن آرایه بمانید (حدود یک دقیقه پس از نخستین برداشت)

## Terraform

[فراهم‌کننده Terraform در OneUptime](/docs/terraform/monitor-steps) پیکربندی گام مانیتور آرایه ذخیره‌سازی را در صفت دریچه فرار `storage_array_monitor` حمل می‌کند — JSON خام زیرپیکربندی `storageArrayMonitor` (‏`arrayIdentifier`، `storageSystem`، `resourceFilters`، `metricViewConfig`، `rollingTime`)، نوشته‌شده با `jsonencode()`:

```hcl
monitor_steps = [{
  storage_array_monitor = jsonencode({
    arrayIdentifier = "my-storage-array"
    storageSystem   = "purestorage.flasharray"
    resourceFilters = {}
    rollingTime     = "Past 15 Minutes"
    metricViewConfig = {
      queryConfigs = [{
        metricAliasData = { metricVariable = "capacity_used_percent", title = "Capacity Used", description = "", legend = "" }
        metricQueryData = {
          filterData = {
            metricName     = "purefa_array_space_utilization"
            attributes     = {}
            aggegationType = "Max"
            aggregateBy    = {}
          }
        }
      }]
      formulaConfigs = []
    }
  })
  criteria = [ /* ... */ ]
}]
```

`arrayIdentifier` همان `storage.array.name` آرایه است (‏`STORAGE_ARRAY_NAME`ای که عامل با آن آغاز شده)، نه شناسه OneUptime آن. `storageSystem` فقط کاتالوگ و قالب‌هایی را که فرم نشان می‌دهد برمی‌گزیند؛ ارزیابی هرگز به آن وابسته نیست.

## رفع اشکال

### آرایه در انتخابگر آرایه مانیتور پدیدار نمی‌شود

آرایه خودش را از تله‌متری عامل ثبت می‌کند. بررسی کنید عامل در حال اجرا و ارسال است ([تأیید نصب](/docs/telemetry/storage-arrays) را ببینید) و اینکه `STORAGE_ARRAY_NAME` تنظیم شده است.

### قالب هشدار یا سخت‌افزار هرگز شلیک نمی‌کند

این همان حالت سالم است: `purefa_alerts_open`، `purefa_hw_component_status`، `purefa_drive_capacity_bytes` و `purefa_host_connectivity_info` وضعیت را در یک برچسب حمل می‌کنند، و سری‌ای که به وضعیتی بد پالوده شده (`severity=critical`، `component_status=failed`) فقط تا وقتی چیزی در آن وضعیت است وجود دارد. نبودن سری در دوره‌ای سالم مورد انتظار است. برای دیدن سری پشت یک قالب، پرس‌وجویش را بدون پالایه در صفحه **Metrics** اجرا کنید.

### مانیتور تأخیر نادرست به نظر می‌رسد

‏Pure ارقام خواندن، نوشتن، نوشتن آینه‌ای، SAN، صف و QoS را روی یک نام سنجه می‌گذارد، که فقط با برچسب `dimension` از هم جدا می‌شوند. پرس‌وجویی بدون پالایه `dimension` همه را با هم میانگین می‌گیرد. روی یک dimension بپالایید — قالب‌ها و کاتالوگ فرم چنین می‌کنند. سری‌های هر ولوم و هر میزبان فقط `usec_per_read_op`، `usec_per_write_op` و `usec_per_mirrored_write_op` را نگه می‌دارند: عامل بقیه ریزتفکیک را برای صرفه‌جویی در سری‌ها کنار می‌گذارد، و `purefa_array_performance_latency_usec` در سطح کل آرایه همه‌اش را نگه می‌دارد.

### پنجره ۱ دقیقه‌ای داده‌ای نشان نمی‌دهد

عامل ولوم‌ها، میزبان‌ها و پادها را هر ۲ دقیقه، سیستم‌فایل‌ها و باکت‌های FlashBlade را هر ۵ دقیقه، و دایرکتوری‌های FlashArray را هر ۳۰ دقیقه می‌خواند، پس پنجره غلتان ۱ دقیقه‌ای ممکن است هیچ نمونه‌ای نداشته باشد. پنجره ۵ دقیقه‌ای یا بلندتر به کار ببرید (۱۵ برای سیستم‌فایل‌ها و باکت‌ها، ۶۰ برای دایرکتوری‌ها).

### حادثه‌ها به‌جای هر ولوم یک بار برای کل آرایه شلیک می‌شوند

پرس‌وجو را بر پایه برچسب شیء گروه‌بندی کنید — `name` برای ولوم‌ها، پادها، دایرکتوری‌ها، سیستم‌فایل‌ها و باکت‌ها، `host` برای میزبان‌ها، `component_name` برای سخت‌افزار FlashArray. برچسب‌های datapoint بی‌پیشوندند: `resource.name` با هیچ چیزی تطبیق نمی‌کند.
