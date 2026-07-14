# SQL 查询监控器

SQL 查询监控器会按计划从探针运行一条只读 SQL 查询，并根据结果发出告警——返回的行数、某个标量值、查询耗时或查询错误。它专为"运行查询并创建事件"的使用场景而设计，例如当过去五分钟内取消的订单数量激增时、当某个队列表变得过大时，或当某个关键行消失时发出告警。

由于查询是从您网络内部的探针运行的，OneUptime 无需直接连接到您的数据库，完整的结果集也绝不会离开探针——只有结果的一小部分有界投影会被上报回来。

## 支持的数据库

SQL 查询监控器支持以下数据库引擎：

- **PostgreSQL**（默认端口 `5432`）
- **MySQL**（默认端口 `3306`）
- **Microsoft SQL Server**（默认端口 `1433`）

使用相同通信协议和 SQL 方言的 MySQL 兼容引擎和 PostgreSQL 兼容引擎通常也能正常工作，但只有上述三种引擎经过官方测试。

## 工作原理

在每次检查时，探针会连接到您的数据库，在只读上下文中运行您的查询，最多读回有限数量的行，并将一份紧凑的投影上报给 OneUptime。随后会根据该投影评估您监控器的判定条件。

探针仅上报：

- **行数（Row Count）**——查询返回的行数（受最大行数限制的约束）。
- **标量值（Scalar Value）**——第一行的第一列。对于 `SELECT COUNT(*)` 式查询，这是最自然的取值。
- **首行（First Row）**——以列/值对形式表示的第一行，显示在检查摘要中以提供上下文。
- **执行时间（Execution Time）**——查询耗时，以毫秒为单位。
- **查询错误（Query Error）**——如果查询失败，则为经过净化处理的错误消息。

完整的结果集绝不会发送到 OneUptime，因此客户数据不会被复制到 OneUptime 存储中。

## 安全模型

针对生产数据库运行客户提供的查询是敏感操作，因此 SQL 查询监控器在设计上是只读的，并叠加了多层控制：

- **最小权限数据库用户（主要控制）。** 您应始终使用专用的只读数据库用户进行连接，该用户仅能访问查询所需的表。这是最重要的控制——参见下方的创建只读用户。
- **只读执行。** 在 PostgreSQL 和 MySQL 上，探针会开启一个 `READ ONLY` 事务，无论查询文本如何，它都会拒绝任何写入（包括可写 CTE）。在没有只读事务的 Microsoft SQL Server 上，探针会在一个始终会回滚的事务中运行。
- **单语句、允许列表查询。** 查询必须是以 `SELECT`、`WITH`、`VALUES` 或 `TABLE` 开头的单条语句。堆叠语句（`SELECT 1; DROP TABLE …`）以及写入/DDL 会在探针连接之前被拒绝。该检查能识别注释和字符串字面量，因此隐藏在注释或字符串中的关键字无法蒙混过关。
- **语句超时。** 每条查询都有一个硬性时间上限。运行时间过长的查询会被取消。
- **有界行数。** 最多只会读回 Max Rows（再加一行，用于检测截断）行，从而限制了探针的内存占用和负载大小。
- **凭据脱敏。** 数据库错误在存储之前会经过净化处理——密码和任何连接字符串都会被脱敏，因此凭据绝不会泄露到错误消息中。

## 前提条件

- 一个能够通过网络访问您数据库主机和端口的**探针**。它可以是 OneUptime 托管的探针（如果您的数据库可从互联网访问），也可以是运行在您网络内部的自托管探针。有关如何安装自定义探针，请参阅探针文档。
- 一个**只读数据库用户**以及连接详情（主机、端口、数据库名称、用户名、密码）。

## 配置

创建一个新监控器，选择 **SQL Query** 作为监控器类型，然后填写连接详情：

- **数据库类型（Database Type）**——PostgreSQL、MySQL 或 Microsoft SQL Server。选择类型会设置默认端口。
- **主机（Host）**——探针可访问的数据库主机（例如 `db.internal`）。
- **端口（Port）**——数据库端口。
- **数据库名称（Database Name）**——要针对其运行查询的数据库。
- **用户名（Username）**——只读、最小权限的数据库用户。
- **密码（Password）**——数据库密码。我们强烈建议使用 `{{monitorSecrets.name}}` 引用[监控器密钥](/docs/monitor/monitor-secrets)，而不是以明文形式输入密码（见下文）。
- **SQL 查询（SQL Query）**——要运行的只读查询（参见编写查询）。
- **使用 SSL/TLS（Use SSL/TLS）**——启用后通过 TLS 连接。启用后，如果数据库使用自签名证书，您可以关闭**验证服务器证书（Verify server certificate）**。

### 高级选项

- **连接超时（Connection Timeout，毫秒）**——建立连接的等待时长。默认 `10000`，最大 `30000`。
- **语句超时（Statement Timeout，毫秒）**——查询可运行时长的硬性上限。默认 `15000`，最大 `60000`。
- **最大行数（Max Rows）**——从数据库读回的行数上限。默认 `100`，最大 `1000`。

## 编写查询

查询必须是**单条只读语句**。它必须以 `SELECT`、`WITH`、`VALUES` 或 `TABLE` 之一开头。允许有一个结尾分号；不允许多条语句。

保持查询开销小且范围明确——它们会在每次检查时运行，因此应优先使用带索引的列和较窄的时间窗口。

```sql
-- 统计近期取消的订单数（PostgreSQL）
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- 在 MySQL 上的相同思路
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- 在 Microsoft SQL Server 上的相同思路
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

对于 `COUNT(*)` 式查询，计数值既可通过**行数（Row Count）**（其值为 `1`，因为只返回一行）获得，也可通过**标量值（Scalar Value）**（来自第一列的计数值本身）获得。若要针对"数量多少"发出告警，请与**标量值（Scalar Value）**进行比较。

## 使用监控器密钥作为密码

为了使数据库密码绝不会以明文形式存储在监控器上，请创建一个[监控器密钥](/docs/monitor/monitor-secrets)，并在密码字段中引用它：

1. 前往 OneUptime 控制台 → 项目设置 → 监控器密钥 → 创建监控器密钥。
2. 创建一个密钥（例如 `dbPassword`），并授予此监控器对它的访问权限。
3. 在监控器的密码字段中，输入 `{{monitorSecrets.dbPassword}}`。

在将配置交给探针之前，OneUptime 会在服务器端解析该密钥。OneUptime 绝不会为您创建这些密钥——是否引用密钥由您自行决定。

## 设置判定条件

添加判定条件以决定监控器何时被视为在线、降级或离线。SQL 查询监控器提供以下检查项：

- **SQL 是否在线（SQL Is Online）**——数据库是否可访问且查询是否成功。
- **SQL 查询行数（SQL Query Row Count）**——返回的行数。可使用大于、小于或等于等运算符进行比较。
- **SQL 查询标量值（SQL Query Scalar Value）**——第一行的第一列。当两侧看起来都是数值时按数值比较，否则按字符串比较。这是用于 `COUNT(*)` 式查询的检查项。
- **SQL 查询执行时间（SQL Query Execution Time，单位毫秒）**——查询耗时。有助于发现运行缓慢的数据库。
- **SQL 查询错误（SQL Query Error）**——查询错误消息。可在其为空（或不为空）时，或匹配特定字符串时发出告警。
- **JavaScript 表达式（JavaScript Expression）**——评估自定义 JavaScript 表达式以获得完全控制。参见 [JavaScript 表达式](/docs/monitor/javascript-expression)。

### 示例：当取消订单数激增时告警

使用上面的查询：

- **判定条件：降级** —— `SQL Query Scalar Value` 大于 `10`。
- **判定条件：离线** —— `SQL Query Scalar Value` 大于 `50`，或 `SQL Is Online` 为 `false`。

为判定条件附加值班策略，以便呼叫到正确的人员。

## 创建只读用户

始终使用专用的只读用户进行连接。示例：

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- 同时包含将来创建的表：
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```

```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```

```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```

## 注意事项

- 查询会在每次检查时运行，因此请保持其开销低。使用索引和较窄的时间窗口，并依靠语句超时作为最后防线。
- 只有行数、第一个单元格（标量）和第一行会被上报——请设计您的查询，使您想要告警的值位于第一列。
- 如果结果因超过最大行数而被截断，检查摘要会将其标记为已达上限。仅在确有需要时才增大 Max Rows；更大的结果集会占用探针更多内存。
- 写入和 DDL 始终会被拒绝。如果您需要测试写入路径，那不是该监控器的用途。
- 相比明文密码，更推荐使用监控器密钥，以使凭据在静态存储时保持加密。
