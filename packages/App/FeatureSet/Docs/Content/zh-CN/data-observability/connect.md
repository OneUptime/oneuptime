# 连接数据库

数据可观测性使用一个只读取目录的登录来读取每个数据库：它包含哪些表和视图、它们的列、行数和大小，以及它们何时更改。本页给出每种引擎至少需要的权限，以及如何借助探测器把连接字符串保留在你的网络内部。

## 开始之前

- **能够连接数据库的角色**：Project Owner、Project Admin 或 Telemetry Admin。
- **一个只读登录**，用下面的语句创建。你以后添加的检查会读取它们所检查的表中的行，因此只在添加检查时，才授予该登录对这些表的 `SELECT` 权限。

## 选择由谁连接

在 **数据可观测性 > 数据库** 上，选择 **Connect a Database**，然后：

- **OneUptime connects**：粘贴一个连接字符串。它会被加密存储，只由 OneUptime 的工作进程使用，并且不会再次显示。
- **A probe in my network connects**：选择你的一个探测器，并指定该探测器上保存连接字符串的环境变量名称，例如 `ORDERS_DB_URL`。连接字符串永远不会离开你的网络。请参阅 [自定义探测器](/docs/probe/custom-probe)。

已经为数据安全连接的数据库也会受到监视，无需再次连接；你的 [云连接](/docs/telemetry/cloud-accounts) 找到的每个 BigQuery 数据集也是如此。

## 每种引擎的只读登录

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

连接字符串：`postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`。OneUptime 会读取 `pg_class`、`pg_stat_user_tables` 和 `pg_attribute`：表的插入、更新或删除计数器发生变化时，表即为已更改；扫描计数器发生变化时，表即为已读取。
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` 让 OneUptime 能够看到两次采集之间的写入和读取；即使没有它，`information_schema.TABLES` 仍会说明每个表最后一次更改的时间。
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` 让 OneUptime 能够读取大小、最后更新时间和最后读取时间。
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

使用 PostgreSQL 连接字符串连接到集群或工作组的端点，例如 `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`。`SYSLOG ACCESS UNRESTRICTED` 让 OneUptime 能够读取行数和大小、每个用户最后的写入和读取，以及来自查询日志的血缘。即使没有它，表的行数发生变化时，仍能知道它何时更改。
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

Snowflake 通过其 SQL API 读取，使用密钥对认证。使用 JSON 连接：

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

目录通过 `SHOW` 读取，它不需要仓库，因此采集不消耗任何积分。只有检查会在仓库上运行，并按你设定的计划执行。
@tab Google BigQuery
你的云连接找到的每个数据集，都会使用该连接的服务账号进行监视。请在项目上授予它 **BigQuery Metadata Viewer** 和 **BigQuery Job User** 以读取目录，在你的检查所读取的表上授予 **BigQuery Data Viewer**，并授予 **BigQuery Resource Viewer** 以获取来自其作业的血缘。

每次采集都会读取数据集的 `__TABLES__`（行数、字节数和最后更改时间，不产生费用）以及它的 `INFORMATION_SCHEMA.COLUMNS`（按 BigQuery 的 10 MB 最低计费量计费）。要在没有云连接的情况下连接数据集，请提供包含服务账号密钥的 JSON：

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

ClickHouse 通过其 HTTP 接口读取，使用 TLS 时端口为 8443（ClickHouse Cloud），不使用时为 8123：`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`。指定一个数据库则只监视它，省略则监视除服务器自身数据库以外的所有数据库。`system.parts` 让 OneUptime 能够看到每次插入（合并不计在内）；在服务器保留 `system.part_log` 的情况下，它会提供每次插入的时间；`system.query_log` 则每小时提供一次最后读取时间和血缘。每条语句都以只读方式运行，因此即使登录本身可以写入，也无法写入。
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

一个 Unity Catalog 目录就是一个数据库。使用服务主体连接，或者用个人访问令牌作为 `"token"` 代替 `clientId` 和 `clientSecret` 进行连接：

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

目录、它的列以及每个 Delta 表的最后一次提交都来自 Unity Catalog 的 REST API，无需 SQL 仓库，因此采集不消耗计算资源。检查，以及每小时一次来自 `system.access.table_lineage` 的血缘和最后读取时间，都在你指定的 SQL 仓库上运行；请在该仓库上授予服务主体 **Can use** 权限。
:::

## 读取的内容和频率

| 内容 | 时间 |
| --- | --- |
| 表、视图、列、行数、大小和最后更改时间 | 每五分钟 |
| 检查 | 每 15 分钟、每小时、每 6 小时或每天，以各检查的设置为准 |
| 来自查询历史的血缘和最后读取时间 | 每小时一次，回溯到上次读取的位置 |

每条语句都以只读方式运行，并在引擎支持的情况下设置语句超时和锁超时。连接字符串从不写入日志，并会从每条错误中删除。登录无权读取的统计信息会被略过，并在数据库上显示一条警告，而不会导致采集失败。

## 故障排除

- **数据库显示“失败”。** 它的消息会说明原因：OneUptime 无法访问的主机、被拒绝的登录、服务器不接受的 TLS 模式。对于你网络内部的数据库，请通过探测器连接。
- **表没有显示最后更改时间。** 该登录无法读取引擎的统计信息：请授予你的引擎标签页中列出的权限，或者等待表的行数更改两次。
- **缺少某个表。** 它位于该登录无法使用的架构中，或者在该数据库上被排除。请授予对其架构的 `USAGE` 权限，或者移除该排除项。

## 后续步骤

:::cards
- [表健康](/docs/data-observability/table-health): 每次采集了解到的关于每个表的信息，以及它推荐的警报。
- [检查与对账](/docs/data-observability/checks): 针对表中内容的规则。
:::
