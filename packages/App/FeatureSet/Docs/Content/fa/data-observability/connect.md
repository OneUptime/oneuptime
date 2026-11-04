# اتصال یک پایگاه داده

مشاهده‌پذیری داده هر پایگاه داده را با حساب کاربری‌ای می‌خواند که فقط کاتالوگ آن را می‌خواند: چه جدول‌ها و نماهایی در آن هست، ستون‌ها، سطرها و اندازهٔ آن‌ها، و زمان تغییرشان. این صفحه کمترین چیزی را که هر موتور پایگاه داده نیاز دارد می‌گوید، و اینکه چگونه با یک پراب، رشته اتصال را درون شبکهٔ خودتان نگه دارید.

## پیش از شروع

- **نقشی که بتواند پایگاه داده متصل کند**: مالک پروژه، مدیر پروژه یا مدیر تله‌متری.
- **یک حساب کاربری فقط‌خواندنی**، که با دستورهای زیر ساخته می‌شود. بررسی‌هایی که بعداً اضافه می‌کنید سطرهای جدول‌هایی را که بررسی می‌کنند می‌خوانند، پس دسترسی `SELECT` روی آن جدول‌ها را فقط وقتی به حساب کاربری بدهید که بررسی‌ای اضافه می‌کنید.

## انتخاب کنید چه کسی متصل شود

در **مشاهده‌پذیری داده** > **پایگاه‌های داده**، **Connect a Database** را انتخاب کنید، سپس:

- **OneUptime connects**: یک رشته اتصال جای‌گذاری کنید. به‌صورت رمزگذاری‌شده ذخیره می‌شود، فقط کارگرهای OneUptime از آن استفاده می‌کنند، و دیگر هرگز نمایش داده نمی‌شود.
- **A probe in my network connects**: یکی از پراب‌های خود را انتخاب کنید و نام متغیر محیطی‌ای را روی پراب بنویسید که رشته اتصال را در خود دارد، مانند `ORDERS_DB_URL`. رشته اتصال هرگز از شبکهٔ شما بیرون نمی‌رود. [پراب‌های سفارشی](/docs/probe/custom-probe) را ببینید.

پایگاه داده‌ای که از قبل برای امنیت داده متصل شده است هم بدون نیاز به اتصال تازه زیر نظر گرفته می‌شود، و همین‌طور هر مجموعه‌داده BigQuery که [اتصال ابری](/docs/telemetry/cloud-accounts) شما پیدا کرده است.

## یک حساب کاربری فقط‌خواندنی برای هر موتور

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

رشته اتصال: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime جدول‌های `pg_class`، `pg_stat_user_tables` و `pg_attribute` را می‌خواند: یک جدول وقتی تغییر کرده است که شمارنده‌های درج، به‌روزرسانی یا حذف آن جابه‌جا شده باشند، و وقتی خوانده شده است که شمارنده‌های اسکن آن جابه‌جا شده باشند.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` به OneUptime اجازه می‌دهد نوشتن‌ها و خواندن‌های میان دو جمع‌آوری را ببیند؛ بدون آن هم `information_schema.TABLES` همچنان می‌گوید هر جدول آخرین بار کی تغییر کرده است.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` به OneUptime اجازه می‌دهد اندازه‌ها، آخرین به‌روزرسانی‌ها و آخرین خواندن‌ها را بخواند.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

با یک رشته اتصال PostgreSQL به نقطه پایانی کلاستر یا workgroup متصل شوید، مانند `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` به OneUptime اجازه می‌دهد تعداد سطرها و اندازه‌ها، آخرین نوشتن‌ها و خواندن‌های همهٔ کاربران، و تبار داده را از لاگ کوئری بخواند. بدون آن هم تغییر تعداد سطرهای یک جدول همچنان نشان می‌دهد که جدول کی تغییر کرده است.
@tab Snowflake
```sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
```

Snowflake از راه SQL API خود با احراز هویت جفت‌کلید خوانده می‌شود. با JSON متصل شوید:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

کاتالوگ با `SHOW` خوانده می‌شود که به هیچ warehouse نیازی ندارد، پس جمع‌آوری هیچ اعتباری مصرف نمی‌کند. فقط بررسی‌ها روی warehouse اجرا می‌شوند، طبق زمان‌بندی‌ای که به آن‌ها می‌دهید.
@tab Google BigQuery
هر مجموعه‌داده‌ای که اتصال ابری شما پیدا کرده است، با حساب سرویس همان اتصال زیر نظر گرفته می‌شود. نقش‌های **BigQuery Metadata Viewer** و **BigQuery Job User** را برای خواندن کاتالوگ روی پروژه، **BigQuery Data Viewer** را روی جدول‌هایی که بررسی‌هایتان می‌خوانند، و **BigQuery Resource Viewer** را برای تبار داده از jobهای آن به این حساب بدهید.

هر جمع‌آوری `__TABLES__` مجموعه‌داده (سطرها، بایت‌ها و آخرین تغییر، بدون هزینه) و `INFORMATION_SCHEMA.COLUMNS` آن (با صورت‌حساب حداقلی 10 MB در BigQuery) را می‌خواند. برای اتصال یک مجموعه‌داده بدون اتصال ابری، JSON با کلید یک حساب سرویس بدهید:

```json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
```
@tab ClickHouse
```sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
```

ClickHouse از راه رابط HTTP خود خوانده می‌شود، روی درگاه 8443 با TLS (ClickHouse Cloud) یا 8123 بدون آن: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. یک پایگاه داده را نام ببرید تا فقط همان زیر نظر گرفته شود، یا آن را ننویسید تا همهٔ پایگاه‌های داده به‌جز پایگاه‌های خود سرور زیر نظر گرفته شوند. `system.parts` به OneUptime اجازه می‌دهد هر درج را ببیند (ادغام به حساب نمی‌آید)، `system.part_log`، هر جا سرور آن را نگه دارد، زمان هر درج را می‌دهد، و `system.query_log` ساعتی یک بار آخرین خواندن‌ها و تبار داده را می‌دهد. هر دستور به‌صورت فقط‌خواندنی اجرا می‌شود، پس حتی حساب کاربری‌ای که اجازهٔ نوشتن دارد هم نمی‌تواند بنویسد.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

هر catalog در Unity Catalog یک پایگاه داده است. با یک service principal متصل شوید، یا با یک توکن دسترسی شخصی به‌صورت `"token"` به‌جای `clientId` و `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

کاتالوگ، ستون‌های آن و آخرین commit هر جدول Delta بدون هیچ SQL warehouse از REST API مربوط به Unity Catalog می‌آیند، پس جمع‌آوری هیچ هزینهٔ محاسباتی ندارد. بررسی‌ها، و تبار داده و آخرین خواندن‌ها از `system.access.table_lineage` که ساعتی یک بار خوانده می‌شوند، روی SQL warehouseای اجرا می‌شوند که نام می‌برید؛ دسترسی **Can use** روی آن را به service principal بدهید.
:::

## چه چیزی خوانده می‌شود، و هر چند وقت یک بار

| چه چیزی | چه زمانی |
| --- | --- |
| جدول‌ها، نماها، ستون‌ها، سطرها، اندازه و آخرین تغییر | هر پنج دقیقه |
| بررسی‌ها | هر 15 دقیقه، هر ساعت، هر 6 ساعت یا هر روز، همان‌طور که هر بررسی تعیین می‌کند |
| تبار داده و آخرین خواندن‌ها از تاریخچهٔ کوئری | ساعتی یک بار، از آخرین خواندن به بعد |

هر دستور به‌صورت فقط‌خواندنی اجرا می‌شود، با مهلت زمانی دستور و قفل، هر جا موتور پایگاه داده آن‌ها را داشته باشد. رشته اتصال هرگز در لاگ ثبت نمی‌شود و از هر پیام خطا حذف می‌شود. آماری که حساب کاربری اجازهٔ خواندنش را ندارد، با یک اخطار روی پایگاه داده کنار گذاشته می‌شود و هرگز باعث ناموفق شدن جمع‌آوری نمی‌شود.

## عیب‌یابی

- **جمع‌آوری از پایگاه داده ناموفق است.** پیام آن دلیلش را می‌گوید: میزبانی که OneUptime نمی‌تواند به آن برسد، حساب کاربری‌ای که رد شده است، یا حالتی از TLS که سرور نمی‌پذیرد. پایگاه داده‌ای را که درون شبکهٔ شماست از راه یک پراب متصل کنید.
- **جدول‌ها هیچ آخرین تغییری نشان نمی‌دهند.** حساب کاربری نمی‌تواند آمار موتور پایگاه داده را بخواند: آنچه را زبانهٔ موتور شما فهرست کرده اعطا کنید، یا صبر کنید تا تعداد سطرهای یک جدول دو بار تغییر کند.
- **یک جدول پیدا نیست.** در طرح‌واره‌ای است که حساب کاربری نمی‌تواند از آن استفاده کند، یا روی پایگاه داده مستثنا شده است. دسترسی `USAGE` روی طرح‌وارهٔ آن بدهید، یا استثنا را بردارید.

## گام‌های بعدی

:::cards
- [سلامت جدول‌ها](/docs/data-observability/table-health): آنچه هر جمع‌آوری دربارهٔ هر جدول یاد می‌گیرد، و هشدارهایی که پیشنهاد می‌کند.
- [بررسی‌ها و تطبیق‌ها](/docs/data-observability/checks): قواعدی برای آنچه یک جدول در خود دارد.
:::
