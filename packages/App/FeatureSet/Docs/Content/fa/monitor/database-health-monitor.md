# مانیتور سلامت پایگاه داده

مانیتور سلامت پایگاه داده روی زمان‌بندی‌ای به PostgreSQL، ‏MySQL یا Microsoft SQL Server وصل می‌شود و سیگنال‌های سلامت خودِ کارساز را گزارش می‌دهد — فضای مانور اتصال، نشست‌های مسدود، تأخیر همانندسازی، نرخ برخورد حافظه نهان، اندازه پایگاه داده، دور زدن شناسه تراکنش، و سی‌واند تای دیگر — تا بتوانید همان‌گونه بر آن‌ها هشدار بدهید که بر پایین بودن وب‌سایتی.

هیچ SQLای نمی‌نویسید. پروب مجموعه‌ای ثابت از پرس‌وجوهای فقط‌خواندنی فهرست را که بر پایه موتور برگزیده شده‌اند اجرا می‌کند، و مجموعه کوچکی از اعداد نام‌دار گزارش می‌دهد.

## سلامت پایگاه داده یا پرس‌وجوی SQL؟

دو نوع مانیتور پایگاه داده به پرسش‌های متفاوتی پاسخ می‌دهند و قرار است با هم به کار روند.

| | سلامت پایگاه داده | [پرس‌وجوی SQL](/docs/monitor/sql-monitor) |
|---|---|---|
| به چه پرسشی پاسخ می‌دهد | «آیا خودِ پایگاه داده سالم است؟» | «آیا داده من همان است که انتظار دارم؟» |
| پرس‌وجو | توکار، به ازای هر موتور، فقط‌خواندنی | مال شما |
| چه گزارش می‌دهد | سنجه‌های عددی نام‌دار ([سنجه‌های جمع‌آوری‌شده](#سنجههای-جمعآوریشده) را ببینید) | شمار سطر، مقدار اسکالر، نخستین سطر، زمان اجرا |
| هشدار معمول | اتصال‌های مصرف‌شده بالای ۹۰٪ | سفارش‌های لغوشده بالای ۵۰ در پنج دقیقه گذشته |
| دسترسی‌های لازم | خواندن آمار/DMV — [ساخت کاربر مانیتورینگ](#ساخت-کاربر-مانیتورینگ) را ببینید | `SELECT` روی جدول‌هایی که پرس‌وجوی شما لمس می‌کند |

اگر می‌خواهید بر شرطی کسب‌وکاری هشدار بدهید، از مانیتور پرس‌وجوی SQL استفاده کنید. اگر می‌خواهید بدانید کارساز پیش از آنکه شرط کسب‌وکاری فرصت شکست بیابد دارد اتصال کم می‌آورد، از این یکی استفاده کنید.

## پایگاه‌های داده پشتیبانی‌شده

- **PostgreSQL** (درگاه پیش‌فرض `5432`)
- **MySQL** (درگاه پیش‌فرض `3306`)
- **Microsoft SQL Server** (درگاه پیش‌فرض `1433`)

موتورهای سازگار با PostgreSQL و MySQL که همان پروتکل سیم را حرف می‌زنند معمولاً کار می‌کنند، اما ممکن است نماهای آماری کمتری در معرض بگذارند، که در آن صورت سنجه‌های متأثر به‌جای جمع‌آوری شدن به‌عنوان در دسترس نبوده گزارش می‌شوند. فقط سه موتور بالا رسماً آزموده شده‌اند.

## چگونه کار می‌کند

در هر بررسی، پروبی:

1. با اعتبارنامه‌هایی که پیکربندی می‌کنید به پایگاه داده وصل می‌شود.
2. یک پرس‌وجوی سبک کاوش اجرا می‌کند. **این تنها دستوری است که شکستش می‌تواند مانیتور را آفلاین کند.**
3. پرس‌وجوهای فهرست را برای هر [گروه سنجه](#گروههای-سنجه) فعال اجرا می‌کند، هرکدام درون تراکنشی فقط‌خواندنی و زیر مهلت دستور.
4. اعدادی را که جمع کرده گزارش می‌دهد، به‌علاوه یادداشتی برای هر گروهی که نتوانسته جمع کند و دلیلش.

فقط تجمیع‌های عددی نام‌دار به OneUptime فرستاده می‌شوند. متن پرس‌وجو، سطری از جدول‌هایتان و نام طرحواره‌ای شبکه شما را ترک نمی‌کند — پرس‌وجوها نماهای آماری خودِ موتور را می‌خوانند (`pg_stat_activity`، `performance_schema.global_status`، `sys.dm_exec_sessions` و دوستان)، هرگز داده شما را.

چون بررسی از پروبی اجرا می‌شود، پایگاه داده فقط باید از پروب دست‌یافتنی باشد. [پروبی سفارشی](/docs/probe/custom-probe) درون شبکه‌تان بگذارید و OneUptime اصلاً به مسیری تا پایگاه داده نیاز ندارد.

## ساخت کاربر مانیتورینگ

**این مهم‌ترین گام است.** مانیتور نماهای آماری‌ای را می‌خواند که ورودهای عادی اجازه دیدنشان را ندارند، و حالت شکست ورودی کم‌امتیاز همیشه خطا نیست — روی PostgreSQL پاسخی اشتباه است. ورودی اختصاصی دقیقاً با این دسترسی‌ها و نه بیشتر بسازید.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

نقش `pg_monitor` نقشی توکار است (PostgreSQL ‏۱۰ به بالا) که دسترسی خواندن به نماهای آمار و مانیتورینگ می‌دهد. هیچ دسترسی‌ای به جدول‌های شما نمی‌دهد.

> **چرا `pg_monitor` روی PostgreSQL اختیاری نیست.** بدون آن، `pg_stat_activity` شکست نمی‌خورد — موفق می‌شود و فقط سطر خودِ نشست مانیتورینگ را برمی‌گرداند. شمار اتصال‌ها `1` می‌خواند، نشست‌های مسدود `0`، و تأخیر همانندسازی `0`، برای همیشه، روی کارسازی که واقعاً در آتش است. پس پروب **پیش از** اجرای آن پرس‌وجوها `pg_has_role(current_user, 'pg_monitor', 'member')` را بررسی می‌کند، و وقتی پاسخ منفی باشد گروه‌های Connections، Activity، Locks، Replication و Maintenance را با `GRANT`ای که لازم دارید به‌عنوان در دسترس نبوده گزارش می‌دهد. گزارش نکردن هیچ، پاسخ صادقانه است؛ گزارش `1` نه.

روی سرویسی مدیریت‌شده که `pg_monitor` در دسترس نیست، `pg_read_all_stats` همان نماها را پوشش می‌دهد. روی Amazon RDS، ‏`GRANT rds_superuser` لازم نیست — ‏`GRANT pg_monitor TO oneuptime_health;` به‌عنوان عضوی از `rds_superuser` کار می‌کند.

### MySQL

```sql
CREATE USER 'oneuptime_health'@'%' IDENTIFIED BY 'a-strong-password';
-- INNODB_TRX (open transactions, longest query) and replication status.
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_health'@'%';
-- Status counters, server variables, and lock waits.
GRANT SELECT ON performance_schema.* TO 'oneuptime_health'@'%';
-- Database size: information_schema.TABLES only shows tables the login can see.
GRANT SELECT ON mydb.* TO 'oneuptime_health'@'%';
FLUSH PRIVILEGES;
```

مقدار `performance_schema` در MySQL باید فعال باشد (`performance_schema = ON`، پیش‌فرض از ۵٫۶ به بعد). وقتی خاموش باشد، گروه‌های Connections، Throughput و Locks به‌عنوان در دسترس نبوده گزارش می‌شوند و راه‌حل بازراه‌اندازی کارساز است نه دسترسی.

### Microsoft SQL Server

```sql
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';
-- Every server-scoped DMV the monitor reads.
GRANT VIEW SERVER STATE TO oneuptime_health;

USE mydb;
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
-- Database size and transaction log space.
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

روی Azure SQL Database، ‏`VIEW SERVER STATE` وجود ندارد؛ به‌تنهایی `GRANT VIEW DATABASE STATE TO oneuptime_health;` را به کار ببرید. آنگاه گروه‌های محدود به کارساز به‌عنوان در دسترس نبوده گزارش می‌شوند، و گروه Storage محدود به پایگاه داده همچنان جمع می‌کند.

## پیش‌نیازها

- یک **پروب** با دسترسی شبکه به میزبان و درگاه پایگاه داده. اگر پایگاه داده از اینترنت دست‌یافتنی است پروبی میزبانی‌شده توسط OneUptime به کار ببرید، یا اگر نه [پروبی سفارشی](/docs/probe/custom-probe) درون شبکه‌تان.
- یک **کاربر مانیتورینگ** که مانند بالا ساخته شده، و جزئیات اتصالش.

## پیکربندی

مانیتوری بسازید و نوع مانیتور را **Database Health** برگزینید، سپس پر کنید:

- **Database Type** — ‏PostgreSQL، ‏MySQL یا Microsoft SQL Server. برگزیدن نوع، درگاه پیش‌فرض را می‌گذارد و تصمیم می‌گیرد کدام پرس‌وجوها اجرا شوند.
- **Host** — میزبان پایگاه داده که از پروب دست‌یافتنی است (برای نمونه `db.internal`).
- **Port** — درگاه پایگاه داده.
- **Database Name** — پایگاه داده‌ای که به آن وصل می‌شوید. سنجه‌های محدود به پایگاه داده (اندازه، نرخ برخورد حافظه نهان، ریزش موقت) برای همین پایگاه داده گزارش می‌شوند؛ سنجه‌های محدود به کارساز (اتصال‌ها، آپ‌تایم، همانندسازی) برای کل کارساز.
- **Use Windows Integrated Authentication** — فقط Microsoft SQL Server. به‌جای نام کاربری و گذرواژه، با هویت فرایند پروب احراز هویت کنید. [احراز هویت یکپارچه ویندوز](/docs/monitor/sql-monitor#windows-integrated-authentication) را در صفحه مانیتور پرس‌وجوی SQL ببینید — راه‌اندازی یکسان است.
- **Username** — کاربر مانیتورینگ.
- **Password** — گذرواژه. به‌جای تایپ متن ساده، با `{{monitorSecrets.name}}` به یک [راز مانیتور](/docs/monitor/monitor-secrets) ارجاع دهید ([استفاده از راز مانیتور](#استفاده-از-یک-راز-مانیتور-برای-گذرواژه) را ببینید).
- **Use SSL/TLS** — اتصال روی TLS. وقتی فعال باشد می‌توانید برای گواهی خودامضا **Verify server certificate** را خاموش کنید.
- **Collected Metric Groups** — کدام گروه‌ها اجرا شوند. همه به‌طور پیش‌فرض روشن‌اند؛ [گروه‌های سنجه](#گروههای-سنجه) را ببینید.

### گزینه‌های پیشرفته

- **Connection Timeout (ms)** — چقدر برای برقراری اتصال منتظر بماند. پیش‌فرض `10000`، بیشینه `30000`.
- **Statement Timeout (ms)** — سقف هر پرس‌وجوی فهرست تنها. پیش‌فرض `10000`، بیشینه `60000`. پیش‌فرض عمداً تنگ‌تر از مانیتور پرس‌وجوی SQL است: این پرس‌وجوها روی کارسازی سالم در چند میلی‌ثانیه برمی‌گردند، پس اگر `pg_stat_activity` ده ثانیه طول بکشد سیگنال مفید «این کارساز در دردسر است» است، نه انتظاری طولانی‌تر.

جمع‌آوری در کل هم کران‌دار است. اگر گروه‌های فعال درون بودجه جمع‌آوری تمام نشوند، بررسی با آنچه دارد برمی‌گردد و هر گروه باقی‌مانده را مهلت‌گذشته ثبت می‌کند — کارسازی کند نتیجه‌ای جزئی تولید می‌کند، هرگز بررسی‌ای گم‌شده نه.

## استفاده از یک راز مانیتور برای گذرواژه

تا گذرواژه هرگز به‌صورت متن ساده روی مانیتور ذخیره نشود:

1. به داشبورد OneUptime → Monitors → Settings → Secrets → Create Monitor Secret بروید.
2. رازی بسازید (برای نمونه `dbPassword`) و به این مانیتور دسترسی به آن بدهید.
3. در فیلد Password، ‏`{{monitorSecrets.dbPassword}}` را وارد کنید.

راز پیش از سپرده شدن پیکربندی به پروبی سمت کارساز تفکیک می‌شود. فیلدهای Host، Username و Database Name همان ارجاع را می‌پذیرند. اعتبارنامه‌ها هرگز در گزارش‌ها، خوراک مانیتور یا قالب‌های هشدار نوشته نمی‌شوند.

## گروه‌های سنجه

گروه یک واحد جمع‌آوری است: پرس‌وجوهای درونش با هم اجرا می‌شوند، با هم موفق می‌شوند، و با هم شکست می‌خورند. گروه‌ها هستند تا یک دسترسی گمشده یک گروه برایتان هزینه داشته باشد نه کل مانیتور.

| گروه | چه جمع می‌کند | چه لازم دارد |
|---|---|---|
| Connections | شمار اتصال‌ها، سقف پیکربندی‌شده، اتصال‌های سقط‌شده، آپ‌تایم کارساز | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | طولانی‌ترین پرس‌وجوی در حال اجرا، طولانی‌ترین تراکنش باز، تراکنش‌های باز | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | تراکنش‌ها، پرس‌وجوها، نرخ برخورد حافظه نهان، خواندن و نوشتن دیسک، زمان ورودی/خروجی | PostgreSQL: چیزی فراتر از `CONNECT` نه. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | نشست‌های مسدود، انتظار قفل، بن‌بست‌ها، انتظار قفل جدول | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | اندازه پایگاه داده، ریزش موقت، فضای گزارش، فضای آزاد tempdb | PostgreSQL: چیزی فراتر از `CONNECT` نه. MySQL: `SELECT` روی پایگاه داده. SQL Server: `VIEW DATABASE STATE` |
| Replication | نسخه‌های متصل، تأخیر همانندسازی بر حسب ثانیه و بایت، جایگاه‌های غیرفعال، وضعیت بازیابی | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE` |
| Maintenance | فضای مانور دور زدن شناسه تراکنش، تاپل‌های مرده، جدول‌هایی که هرگز autovacuum نشده‌اند، چک‌پوینت‌ها | PostgreSQL: `pg_monitor` |

خاموش کردن گروهی خاموش است: بدون سنجه، بدون مسئله جمع‌آوری، بدون هشدار. در دو حالت حرکت درستی است.

- **نمی‌توانید دسترسی را بگیرید.** خاموش کردن گروه جلوی تکرار مسئله جمع‌آوری در هر بررسی را می‌گیرد.
- **پرس‌وجوها خیلی گران‌اند.** روی MySQL، ‏**Storage** نامزد معمول است: اندازه پایگاه داده از جمع زدن `information_schema.TABLES` می‌آید، که روی طرحواره‌ای با ده‌ها هزار جدول رایگان نیست و در هر بررسی اجرا می‌شود. خاموشش کنید، یا آن مانیتور را به فاصله پنج‌دقیقه‌ای ببرید.

پاک کردن هر گروهی راهی برای جمع نکردن هیچ‌چیز نیست — فهرست خالی به همه گروه‌ها نرمال می‌شود، پس مانیتوری هرگز نمی‌تواند در حالتی ذخیره شود که خاموش هیچ‌چیز جمع نمی‌کند.

## وقتی سنجه‌ای نمی‌تواند جمع شود چه رخ می‌دهد

**دسترسی گمشده هرگز مانیتور را آفلاین نمی‌کند.** این تنها مهم‌ترین رفتار این نوع مانیتور است، و ارزش دارد دقیق بیانش کنیم.

- **اتصال شکست می‌خورد**، یا پرس‌وجوی کاوش شکست می‌خورد — اعتبارنامه بد، اتصال ردشده، شکست TLS، اتمام مهلت اتصال. مانیتور **آفلاین** می‌شود. مقدار `Database Is Online` نادرست است، و هر حادثه و سیاست کشیکی که به آن پیوست کرده‌اید شلیک می‌کند.
- **گروهی نمی‌تواند اجرا شود** — دسترسی گمشده، `performance_schema` غیرفعال، اتمام مهلت دستور. مانیتور **آنلاین می‌ماند**. سنجه‌های آن گروه **غایب**اند، نه صفر. هیچ خط نموداری کشیده نمی‌شود، هیچ آستانه‌ای روی آن سری‌ها نمی‌تواند مطابقت کند، و هیچ حادثه‌ای نمی‌تواند از آن‌ها برانگیخته شود. بررسی یک مسئله جمع‌آوری ثبت می‌کند که گروه، دلیل، و — هرجا هست — دستور دقیق `GRANT` را نام می‌برد، که روی خلاصه مانیتور نشان داده می‌شود و در **Metric Groups Failed** شمرده می‌شود.
- **موتور اصلاً نمی‌تواند سنجه‌ای تولید کند** — ‏MySQL خام شمارنده بن‌بست ندارد؛ SQL Server سقف اتصالش را به‌طور پیش‌فرض نامحدود می‌گذارد پس «درصد مصرف‌شده» بی‌معنا می‌بود؛ PostgreSQL فقط وقتی `track_io_timing` روشن باشد زمان ورودی/خروجی را پر می‌کند. سنجه صرفاً غایب است. این مسئله جمع‌آوری **نیست**، به Metric Groups Failed نمی‌شمارد، و چیزی برای رفع کردن نیست. ستون Engines در [سنجه‌های جمع‌آوری‌شده](#سنجههای-جمعآوریشده) را ببینید.

غایب همیشه یعنی غایب. مقداری که اندازه‌گیری نشده هرگز به‌عنوان `0` گزارش نمی‌شود، چون نموداری از صفرهای جعلی بدتر از شکافی است — شکاف را می‌بینید.

برای هشدار بر دید ازدست‌رفته، از `Database Collection Error` یا آستانه‌ای روی **Metric Groups Failed** استفاده کنید. هر دو را هشدار کنید نه حادثه: دسترسی باطل‌شده تیکتی است، نه فراخوانی.

## سنجه‌های جمع‌آوری‌شده

چهل‌ویک سری در هشت دسته. Engines موتورهایی را فهرست می‌کند که واقعاً می‌توانند سری را تولید کنند؛ روی هر موتور دیگری صرفاً غایب است. Group گروه جمع‌آوری‌ای است که سری به آن تعلق دارد، که همان چیزی است که کلید می‌زنید و با هم تنزل می‌کند.

### دسترس‌پذیری

| سنجه | سری | گروه | موتورها |
|---|---|---|---|
| **Uptime** (ثانیه) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL، MySQL، SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL، MySQL، SQL Server |

### اتصال‌ها

| سنجه | سری | گروه | موتورها |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL، MySQL، SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL، MySQL، SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL، MySQL |
| **Connections Used** (٪) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL، MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### گذردهی

| سنجه | سری | گروه | موتورها |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL، SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL، SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (٪) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (ثانیه) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL، MySQL، SQL Server |
| **Longest Open Transaction** (ثانیه) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL، MySQL، SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### قفل‌ها و مسدودسازی

| سنجه | سری | گروه | موتورها |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL، MySQL، SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL، MySQL، SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL، SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

‏MySQL خام هیچ شمارنده بن‌بستی در معرض نمی‌گذارد، که دلیل این است که Deadlocks فقط PostgreSQL و SQL Server است.

### حافظه نهان و ورودی/خروجی

| سنجه | سری | گروه | موتورها |
|---|---|---|---|
| **Cache Hit Ratio** (٪) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL، MySQL، SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL، MySQL، SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL، SQL Server |
| **I/O Read Time** (میلی‌ثانیه) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL، SQL Server |
| **I/O Write Time** (میلی‌ثانیه) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL، SQL Server |
| **Page Life Expectancy** (ثانیه) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

‏PostgreSQL زمان خواندن و نوشتن ورودی/خروجی را فقط وقتی پر می‌کند که `track_io_timing` روشن باشد. به‌طور پیش‌فرض خاموش است، پس آن دو سری معمولاً روی کارساز PostgreSQL کاملاً مجاز غایب‌اند. آن تنظیمی از کارساز است، نه مشکل دسترسی.

### ذخیره‌سازی

| سنجه | سری | گروه | موتورها |
|---|---|---|---|
| **Database Size** (بایت) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL، MySQL، SQL Server |
| **Temp Bytes Written** (بایت) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (٪) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (بایت) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### همانندسازی

| سنجه | سری | گروه | موتورها |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL، SQL Server |
| **Replication Lag** (ثانیه) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL، MySQL، SQL Server |
| **Replication Lag (Bytes)** (بایت) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL، SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

سنجه‌های همانندسازی از هر سویی از پیوند که مانیتور به آن وصل است گزارش می‌شوند. مانیتوری را به اصلی نشانه بگیرید تا نسخه‌های متصل و صف ارسال را ببینید؛ به هر آماده‌به‌کاری یکی نشانه بگیرید تا ببینید آن آماده‌به‌کار واقعاً چقدر عقب است.

تأخیر بر حسب ثانیه روی اصلی بیکار صفر می‌خواند حتی وقتی نسخه‌ای خیلی عقب باشد، چون چیز تازه‌ای نوشته نشده است. **Replication Lag (Bytes)** آن نقطه کور را ندارد، پس بر هر دو هشدار بدهید.

### نگهداری

| سنجه | سری | گروه | موتورها |
|---|---|---|---|
| **Transaction ID Used** (٪) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

سنجه **Transaction ID Used** سزاوار معیاری روی هر مانیتور PostgreSQLای است که می‌سازید. PostgreSQL وقتی به ۱۰۰٪ برسد همه نوشتن‌ها را رد می‌کند، بازیابی یعنی vacuumای در حالت تک‌کاربره با پایگاه داده پایین، و تقریباً هیچ‌کس نمی‌پایدش. خیلی زیر پرتگاه هشدار بدهید — ۸۰٪ در بیشتر بارهای کاری روزها فضای مانور می‌گذارد.

شمارنده‌هایی که به `total` ختم می‌شوند از آغاز کارساز تجمعی‌اند. برای گرفتن نرخ دو نقطه در زمان را مقایسه کنید؛ مقدار تنها فقط در برابر تاریخچه خودش معنا دارد، و هنگام بازراه‌اندازی کارساز به صفر بازنشانی می‌شود (که **Uptime** نشانتان می‌دهد).

## برپا کردن معیارها

- **Database Is Online** — اینکه پایگاه داده دست‌یافتنی بود و پرس‌وجوی کاوش موفق شد. این همان معیار آفلاینی است که مانیتور با آن ساخته می‌شود، و تنها بررسی‌ای است که دست‌یافتنی بودن را بازتاب می‌دهد.
- **Database Metric** — سنجه‌ای برگزینید، سپس مقایسه‌اش کنید. انتخابگر سنجه فقط سنجه‌هایی را ارائه می‌دهد که موتور برگزیده شما می‌تواند تولید کند، پس نمی‌توانید معیاری بسازید که برای همیشه برآورده نشود. اگر سنجه در بررسی‌ای جمع نشده باشد — گروه شکست خورده، یا موتور گزارشش نمی‌کند — پالایه مطابقت نمی‌کند، و «نادرست» هم مطابقت نمی‌کند: رد می‌شود. مشکل دسترسی نمی‌تواند کسی را فرا بخواند.
- **Database Collection Error** — خلاصه مسئله جمع‌آوری برای بررسی. برای گرفتن دید ازدست‌رفته وقتی خالی نیست هشدار بدهید، یا با Contains گروهی مشخص یا دسترسی نام‌داری را بپایید.
- **JavaScript Expression** — کنترل کامل. [عبارت‌های JavaScript](/docs/monitor/javascript-expression) را ببینید.

آستانه‌ها اعداد کامل‌اند. `90` بنویسید نه `90.5` — درصدها و ثانیه‌ها به‌صورت عدد صحیح مقایسه می‌شوند.

### متغیرهای عبارت JavaScript

برای مانیتور سلامت پایگاه داده، عبارت به این‌ها دسترسی دارد:

| متغیر | نوع | |
|---|---|---|
| `isOnline` | بولی | اینکه هم اتصال و هم پرس‌وجوی کاوش موفق شدند |
| `engineVersion` | رشته | رشته نسخه‌ای که کارساز گزارش کرد |
| `connectionError` | رشته | خطای اتصال پاک‌سازی‌شده، وقتی نبود خالی است |
| `collectedGroups` | آرایه | گروه‌هایی که در این بررسی مقدار تولید کردند |
| `unavailableGroups` | آرایه | گروه‌هایی که نکردند، هرکدام با دلیلی و اصلاحی |
| `metrics` | شیء | مقادیر جمع‌شده کلیدخورده بر پایه نام سری؛ سری‌ای که جمع نشده غایب است |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

برای آستانه‌ای روی سنجه‌ای منفرد به‌جای عبارت سراغ **Database Metric** بروید: سری را برایتان تفکیک می‌کند، فقط آنچه موتورتان می‌تواند تولید کند ارائه می‌دهد، و وقتی مقدار جمع نشده به‌جای مقایسه با هیچ، بررسی را رد می‌کند.

### نمونه: یک PostgreSQL اصلی

- **معیار: آفلاین** — `Database Is Online` برابر `false` است.
- **معیار: تنزل‌یافته** — `Database Metric` → Connections Used بزرگ‌تر از `90` است، سنجیده روی ۵ دقیقه با All Values تا یک جهش تنها کسی را فرا نخواند.
- **معیار: تنزل‌یافته** — `Database Metric` → Transaction ID Used بزرگ‌تر از `80` است.
- **معیار: تنزل‌یافته** — `Database Metric` → Blocked Sessions بزرگ‌تر از `0` است، روی ۵ دقیقه.
- **معیار: آنلاین** — `Database Is Online` برابر `true` است.

معیارها از بالا به پایین سنجیده می‌شوند و نخستین تطابق برنده است، پس معیارهای هشداردهنده را نخست و سالم را آخر فهرست کنید.

سیاست کشیکی به معیار آفلاین پیوست کنید، و هر چیزی را که از **Metric Groups Failed** یا `Database Collection Error` مشتق می‌شود به‌عنوان هشداری بدون سیاست کشیک پیوست‌شده رها کنید.

## چیزهایی که باید در نظر بگیرید

- **پرس‌وجوها در هر بررسی اجرا می‌شوند.** بنا به طراحی ارزان‌اند، اما «ارزان» نسبت به فاصله است. فاصله یک‌دقیقه‌ای روی کارسازی با هزاران نشست یعنی پویش `pg_stat_activity` بیش از آنچه شاید بخواهید؛ پنج دقیقه برای سنجه‌های ظرفیت کاملاً بس است.
- **مانیتور را به پایگاه داده‌ای که برایتان مهم است نشانه بگیرید.** اندازه، نرخ برخورد حافظه نهان و ریزش موقت به ازای هر پایگاه داده‌اند. اتصال‌ها، آپ‌تایم و همانندسازی به ازای هر کارسازند و از هر پایگاه داده‌ای روی آن نمونه یکسان خوانده می‌شوند.
- **یک مانیتور به ازای هر نمونه، نه به ازای هر پایگاه داده**، مگر مشخصاً اندازه و سنجه‌های حافظه نهان به ازای هر پایگاه داده را بخواهید — وگرنه پرس‌وجوهای محدود به کارساز را بدون اطلاعات تازه‌ای ضرب می‌کنید.
- **بر نرخ‌ها هشدار بدهید، نه بر شمارنده‌ها.** هر چیزی که به `total` ختم می‌شود فقط بالا می‌رود، پس آستانه‌ای «بزرگ‌تر از» روی آن یک بار شلیک می‌کند و هرگز بازیابی نمی‌شود. ترسیمش کنید، یا روی پنجره‌ای مقایسه‌اش کنید.
- **راز مانیتور را به گذرواژه متن ساده ترجیح دهید.** آنگاه اعتبارنامه در حالت سکون رمزگذاری‌شده می‌ماند و هرگز روی مانیتور پدیدار نمی‌شود.
- مانیتور هرگز نمی‌نویسد. هر پرس‌وجویی خواندنی از نمای آماری است، در تراکنشی فقط‌خواندنی هرجا موتور پشتیبانی‌اش کند. هر چیزی که نتواند بخواند به‌عنوان سنجه‌ای گمشده گزارش می‌شود، هرگز به‌عنوان قطعی نه.
