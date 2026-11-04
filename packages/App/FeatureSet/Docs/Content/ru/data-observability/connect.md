# Подключение базы данных

Наблюдаемость данных читает каждую базу данных под учётной записью, которая читает только её каталог: какие таблицы и представления в ней есть, их столбцы, строки и размер и когда они менялись. На этой странице указан минимум, который нужен каждой СУБД, и описано, как с помощью зонда оставить строку подключения внутри вашей сети.

## Перед началом

- **Роль, которая может подключать базы данных**: Владелец проекта, Администратор проекта или Администратор телеметрии.
- **Учётная запись только для чтения**, созданная командами ниже. Проверки, которые вы добавите позже, читают строки проверяемых таблиц, поэтому выдавайте учётной записи `SELECT` на эти таблицы только тогда, когда добавляете проверку.

## Выберите, кто подключается

В разделе **Наблюдаемость данных > Базы данных** выберите **Подключить базу данных**, а затем:

- **OneUptime подключается**: вставьте строку подключения. Она хранится в зашифрованном виде, используется только воркерами OneUptime и больше никогда не показывается.
- **Зонд в моей сети подключается**: выберите один из своих зондов и укажите имя переменной окружения на зонде, в которой хранится строка подключения, например `ORDERS_DB_URL`. Строка подключения никогда не покидает вашу сеть. См. [Пользовательские probes](/docs/probe/custom-probe).

База данных, уже подключённая для Безопасности данных, тоже отслеживается без отдельного подключения, как и каждый набор данных BigQuery, найденный вашим [облачным подключением](/docs/telemetry/cloud-accounts).

## Базы данных, которые можно подключить

**Базы данных, которые можно подключить** в разделе **Базы данных** перечисляют то, о чём ваш проект уже знает и что никто не подключил: базы данных, к которым обращаются ваши трассировки, базы в ваших облачных аккаунтах и те, за которыми следит Мониторинг баз данных. **Подключить** открывает форму, заполненную тем, что известно о каждой, остаётся вписать строку подключения. **Скрыть** не даёт базе вернуться в список. Ничего не читается, пока вы её не подключите.

## Учётная запись только для чтения для каждой СУБД

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

Строка подключения: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime читает `pg_class`, `pg_stat_user_tables` и `pg_attribute`: таблица изменилась, когда сдвинулись её счётчики вставок, обновлений или удалений, и была прочитана, когда сдвинулись её счётчики сканирований.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` позволяет OneUptime видеть записи и чтения между сборами; без неё `information_schema.TABLES` всё равно показывает, когда каждая таблица менялась в последний раз.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` позволяет OneUptime читать размеры, последние обновления и последние чтения.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Подключайтесь строкой подключения PostgreSQL к эндпоинту кластера или рабочей группы, например `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` позволяет OneUptime читать число строк и размеры, последние записи и чтения всех пользователей, а также происхождение данных из журнала запросов. Без этого права время изменения таблицы всё равно видно по изменению числа её строк.
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

Snowflake читается через его SQL API с аутентификацией по паре ключей. Подключайтесь с помощью JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

Каталог читается командой `SHOW`, которой не нужен warehouse, поэтому сбор не тратит кредиты. На warehouse выполняются только проверки — по расписанию, которое вы им задаёте.
@tab Google BigQuery
Каждый набор данных, найденный вашим облачным подключением, отслеживается с сервисным аккаунтом этого подключения. Выдайте ему роли **BigQuery Metadata Viewer** и **BigQuery Job User** на проект, чтобы читать каталог, **BigQuery Data Viewer** на таблицы, которые читают ваши проверки, и **BigQuery Resource Viewer** для происхождения данных из его заданий.

Каждый сбор читает `__TABLES__` набора данных (строки, байты и последнее изменение, бесплатно) и его `INFORMATION_SCHEMA.COLUMNS` (тарифицируется по минимуму BigQuery в 10 МБ). Чтобы подключить набор данных без облачного подключения, укажите JSON с ключом сервисного аккаунта:

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

ClickHouse читается через его HTTP-интерфейс, по порту 8443 с TLS (ClickHouse Cloud) или 8123 без него: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Укажите базу данных, чтобы отслеживать только её, или не указывайте, чтобы отслеживать все базы данных, кроме собственных баз сервера. `system.parts` позволяет OneUptime видеть каждую вставку (слияние не считается), `system.part_log`, если сервер его ведёт, даёт время каждой вставки, а `system.query_log` раз в час даёт последние чтения и происхождение данных. Каждая команда выполняется в режиме только для чтения, поэтому даже учётная запись с правом записи ничего не запишет.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Один каталог Unity Catalog — это одна база данных. Подключайтесь с сервисным принципалом или с личным токеном доступа в виде `"token"` вместо `clientId` и `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

Каталог, его столбцы и последний коммит каждой таблицы Delta берутся из REST API Unity Catalog без SQL warehouse, поэтому сбор не тратит вычислительные ресурсы. Проверки, а также происхождение данных и последние чтения из `system.access.table_lineage` раз в час выполняются на SQL warehouse, который вы укажете; выдайте сервисному принципалу право **Can use** на него.
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle читается по собственному протоколу, без установки клиента Oracle: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. Пользователь видит таблицы, которые ему разрешено читать: выдайте `READ` на каждую отслеживаемую таблицу — это позволяет запрашивать их, но никогда не блокировать и не изменять. `SELECT_CATALOG_ROLE` позволяет OneUptime читать размер каждой таблицы, а `ALL_TAB_MODIFICATIONS` даёт вставки, обновления и удаления каждой таблицы с момента последней статистики и время её последнего изменения.
@tab Amazon Athena
Одна база данных Glue — это одна база данных. Её таблицы и представления, их столбцы и статистика, а также последний коммит каждой таблицы Iceberg берутся из API Glue Data Catalog, который не читает данные и ничего не стоит. Проверки выполняются как запросы Athena в указанной вами рабочей группе (workgroup). Подключайтесь с ключами пользователя или роли IAM, которым разрешено вызывать `glue:GetDatabase` и `glue:GetTables`, а для проверок — выполнять запросы Athena в рабочей группе с доступом на чтение к данным таблиц:

```json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
```
@tab MongoDB
```javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
```

MongoDB читается собственным драйвером: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/` или `mongodb://` с хостами replica set. База данных в пути — единственная отслеживаемая; без неё отслеживается каждая база, которую пользователю разрешено читать, а `{ role: "read", db: "orders" }` вместо `readAnyDatabase` ограничивает его одной. Документы, размер и записи каждой коллекции берутся из `$collStats`, а время последнего документа — из её самого нового `_id`. Её поля берутся из JSON-схемы её валидатора, а иначе — из имён и типов полей её 100 самых новых документов, вычисленных в базе, так что ни одно значение её не покидает. Документы читаются на secondary, если он есть, а пользовательская проверка — это конвейер агрегации в формате JSON.
:::

## Что читается и как часто

| Что | Когда |
| --- | --- |
| Таблицы, представления, столбцы, строки, размер и последнее изменение | Каждые пять минут |
| Проверки | Каждые 15 минут, час, 6 часов или день — как указано в каждой из них |
| Происхождение данных и последние чтения из истории запросов | Раз в час, с момента последнего чтения |

Каждая команда выполняется в режиме только для чтения, с тайм-аутом команды и блокировки там, где СУБД их поддерживает. Строка подключения никогда не попадает в журналы и вырезается из каждой ошибки. Статистика, которую учётной записи читать нельзя, пропускается с предупреждением на базе данных, но сбор из-за неё никогда не завершается ошибкой. Подключения к частным адресам в OneUptime Cloud отклоняются: используйте зонд.

## Реплики для чтения

Реплика для чтения PostgreSQL или SQL Server не двигает свои счётчики записи, поэтому таблица на ней может выглядеть неизменной, пока меняется. OneUptime видит, что это реплика, не учитывает счётчики, сообщает об этом на базе данных и переключается на размер и строки таблицы. Подключайте основной сервер, где это возможно, или задайте [столбец Freshness](/docs/data-observability/table-health) для важных таблиц.

## Пути хранилища

Не всё, на что вы полагаетесь, лежит в базе данных. Выгрузка, которая каждую ночь попадает в бакет, опаздывает или оказывается неполной так же, как любая таблица. В разделе **Пути хранилища** выберите **Редактировать пути** для бакета, найденного вашим [облачным подключением](/docs/telemetry/cloud-accounts), в Amazon S3, Google Cloud Storage или аккаунте хранилища Azure, и перечислите важные пути, по одному на строку. В Azure начинайте каждый с имени его контейнера.

Каждый путь затем отображается в разделе **Таблицы**: его самый новый объект — это время последнего изменения, его объекты — это его строки, а их размер — его размер, и действуют те же оповещения. Читаются только имена, размеры и время, но никогда сам объект. Путь, содержащий более 10000 объектов, не имеет точного числа, размера и самого нового объекта и сообщает об этом: укажите более узкий путь.

## Устранение неполадок

- **Сбор данных по базе завершается ошибкой.** В сообщении сказано почему: хост, до которого OneUptime не может достучаться, отклонённая учётная запись, режим TLS, который сервер не принимает. Базу данных внутри вашей сети подключайте через зонд.
- **У таблиц не видно последнего изменения.** Учётная запись не может читать статистику СУБД: выдайте права, перечисленные на вкладке вашей СУБД, или дождитесь, пока число строк в таблице изменится дважды.
- **Таблицы не хватает.** Она находится в схеме, которую учётная запись не может использовать, или исключена в настройках базы данных. Выдайте `USAGE` на её схему или уберите исключение.
- **У таблицы MySQL нет столбцов.** Учётной записи нужен `REFERENCES`, как указано выше: он показывает столбцы таблицы, не давая никакого чтения её строк.

## Дальнейшие шаги

:::cards
- [Состояние таблиц](/docs/data-observability/table-health): Что каждый сбор узнаёт о каждой таблице и какие оповещения он рекомендует.
- [Проверки и сверки](/docs/data-observability/checks): Правила для содержимого таблицы.
:::
