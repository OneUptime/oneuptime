/*
 * The Data Observability Documentation page in Simplified Chinese: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Simplified Chinese words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Data Observability 监视什么

每个已连接数据库中的每个表和每个视图，每五分钟一次：

- **行数和大小**：来自引擎自身的统计信息。
- **上次更改时间**：MySQL 和 SQL Server 会报告；对于 PostgreSQL，OneUptime 会观察插入、更新和删除计数器，并记录它们变化的时间。
- **列**：被添加、删除、重命名、更改类型或改为 nullable 的列会记入表的时间线和架构变更。
- **平常的节奏**：表通常多久更改一次。明显超出自身节奏的表会显示为 **延迟**。

只读取数据库的目录；在 MongoDB 上，还会读取集合最新文档的字段名。任何值都不会离开数据库。

目录可能在只有内部维护发生变化时报告表已更改，也可能什么都不报告。在表的 **设置** 中指定一个 **新鲜度列**（例如 \`updated_at\`），表的上次更改就会变成该列的最新值。登录账号需要能读取该列，并且该列最好建有索引。

PostgreSQL 或 SQL Server 的只读副本不会推动写入计数器，因此 OneUptime 会在那里不使用这些计数器，并在数据库上注明这一点。

## 概览

**概览** 说明你的数据当前的状况。在项目设置完成之前，它会列出剩下的步骤：每个数据库的警报、表的所有者、一项检查，以及你的管道运行。**需要处理** 按严重程度从高到低列出需要有人处理的事项：无法读取的数据库、失败或延迟的管道运行、失败或无法运行的检查、发生偏离的对账，以及延迟的数据产品或表。每一项都会说明归谁所有、其警报是否已打开（或者因为其数据库没有开启任何警报而没有人会收到通知），并打开可以修复它的页面。**数据库** 显示每个数据库上次读取的情况，以及其警报是否已开启。菜单中 **概览** 旁边的数字统计需要处理的事项，它下面的 **问题** 会逐页列出每一项，可按类型、数据库、所有者（或 **无所有者**）以及是否有未解决的警报筛选。**概览** 上的每个数字都会打开对应的列表：**需要处理** 打开 **问题**，**延迟的表** 打开只显示延迟表的 **表**，**失败的检查** 打开只显示失败检查的 **检查**。

## 连接数据库

请使用 **只读登录账号**。在概览或数据库页面上选择 **连接数据库**，然后选择以下其中一种：

- **OneUptime 进行连接**：粘贴连接字符串。它会加密存储，并且不会再次显示。
- **我网络中的探测器进行连接**：选择此项目的一个探测器，并指定探测器上保存连接字符串的环境变量名（例如 \`ORDERS_DB_URL\`）。连接字符串永远不会离开你的网络。请先将探测器更新到最新版本。

已经为数据安全连接的数据库也会被监视。

同一页面上的 **可连接的数据库** 列出你的项目已经知道、但还没有人连接的数据库：你的追踪所访问的数据库、你的云账号中的数据库，以及数据库监控正在监视的数据库。**连接** 会用已知的信息预先填写表单。在你连接之前，不会读取任何内容。

## 存储路径

每晚落入存储桶的导出文件，也可能像任何表一样延迟或不完整。在 **存储路径** 下，为你的云连接找到的存储桶（Amazon S3、Google Cloud Storage 或 Azure 存储账户上的）选择 **编辑路径**，并填写重要的路径，每行一个。每条路径都会显示在 **表** 下：其最新的对象就是它的上次更改，其对象就是它的行，并适用相同的警报。只读取名称、大小和时间，从不读取对象本身。

### 每种引擎的只读登录账号

PostgreSQL：

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL 和 MariaDB（\`performance_schema\` 让 OneUptime 能看到两次收集之间的写入）：

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server（\`VIEW DATABASE STATE\` 让 OneUptime 能读取大小和上次更新）：

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift：使用 PostgreSQL 连接字符串连接到集群或工作组的端点，例如 \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`。\`SYSLOG ACCESS UNRESTRICTED\` 让 OneUptime 能读取行数和大小（\`svv_table_info\`）、每个用户查询的最近写入和读取（\`stl_insert\`、\`stl_delete\`、\`stl_scan\`，保留几天），以及每个用户查询的血缘。没有它，表的行发生变化时仍然可以知道它何时更改。

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake：创建一个使用密钥对（无密码）的用户，并使用指定账户标识符、用户、私钥（未加密的 PKCS#8）、数据库和检查用仓库的 JSON 进行连接：

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

收集使用不需要仓库的 SHOW 读取目录，因此不消耗积分。只有数据检查会在仓库上运行，按你为它们设定的计划执行。Snowflake 不报告任何表的上次更改，因此当表的行或字节发生变化时，就认为表已更改。

\`\`\`sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
-- Warehouse spend reads SNOWFLAKE.ACCOUNT_USAGE.
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
-- Checks read rows: SELECT on the tables they check.
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
\`\`\`

Google BigQuery：你的 Google Cloud 连接找到的每个数据集都已经在使用该连接的服务账号进行监视，无需再连接。为服务账号授予项目上的 **BigQuery Metadata Viewer** 和 **BigQuery Job User**，以及检查所读取的表上的 **BigQuery Data Viewer**。每次收集会读取数据集的 \`__TABLES__\`（行、字节和上次更改，不收费）以及它的 \`INFORMATION_SCHEMA.COLUMNS\`（按 BigQuery 的 10 MB 最低计费）。在项目上添加 **BigQuery Resource Viewer**，即可获得来自其作业的血缘，每小时读取一次（参见“数据库自身提供的血缘”）。要在没有 Google Cloud 连接的情况下连接数据集，请选择 **Google BigQuery**，并提供包含服务账号密钥的 JSON：

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse：通过其 HTTP 接口连接，使用 TLS 时为端口 8443（ClickHouse Cloud），不使用时为 8123，例如 \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`。指定一个数据库则只监视它；省略则监视除服务器自身数据库以外的所有数据库。\`system.parts\` 让 OneUptime 能看到两次收集之间的每次插入（合并不计入），\`system.part_log\`（如果服务器保留它）提供每次插入的时间，\`system.query_log\` 每小时提供一次每个表的上次读取以及来自 \`INSERT ... SELECT\` 的血缘。每条语句都在设置了 \`readonly\` 的情况下运行，因此即使登录账号本来可以写入，也无法写入。

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks：一个 Unity Catalog 目录就是一个数据库。它的架构、表、视图和列，以及每个 Delta 表的最后一次提交，都通过 Unity Catalog 的 REST API 读取，不需要 SQL 仓库，因此收集不消耗计算资源。数据检查，以及来自系统表 \`system.access.table_lineage\` 的血缘、最近写入和最近读取（每小时一次），在你指定的 SQL 仓库上运行。使用服务主体连接（也可以用个人访问令牌代替 \`clientId\` 和 \`clientSecret\`：\`"token": "dapi..."\`）：

\`\`\`json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
\`\`\`

\`\`\`sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE SCHEMA ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE CATALOG ON CATALOG system TO \`oneuptime-reader\`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO \`oneuptime-reader\`;
-- Checks read rows: SELECT on the tables they check. And CAN USE on the SQL warehouse.
\`\`\`

Oracle：使用 \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\` 或 JSON \`{ "user", "password", "connectString" }\` 连接。通过 Oracle 自己的协议读取，无需安装 Oracle 客户端。登录账号能看到它有权读取的表：对每个要监视的表授予 \`READ\`（它可以查询这些表，但永远不能锁定或更改它们）。\`SELECT_CATALOG_ROLE\` 让 OneUptime 能读取每个表的大小；没有它，只有登录账号自己的表才有大小。\`ALL_TAB_MODIFICATIONS\` 提供每个表自上次统计以来的插入、更新和删除，以及它的上次更改时间。

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena：一个 Glue 数据库就是一个数据库。它的表和视图、它们的列和统计信息，以及每个 Iceberg 表的最后一次提交，都来自 Glue Data Catalog 的 API，该 API 不读取数据，也不收费；检查以 Athena 查询的形式在你指定的工作组中运行。使用有权读取该 Glue 数据库并运行 Athena 查询的 IAM 用户或角色的密钥进行连接：

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

它需要数据库及其表上的 \`glue:GetDatabase\` 和 \`glue:GetTables\`，检查还需要工作组上的 \`athena:StartQueryExecution\`、\`athena:GetQueryExecution\`、\`athena:GetQueryResults\` 和 \`athena:StopQueryExecution\`，以及对表的 S3 数据的读取权限和对输出位置的写入权限。

MongoDB：使用其连接字符串连接 - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`，或带有副本集主机的 \`mongodb://\`。路径中的数据库是唯一被监视的数据库；没有指定时，会监视登录账号能读取的每个数据库。每个集合的文档数、大小和写入来自 \`$collStats\`，它上次接收文档的时间来自其最新的 \`_id\`。它的字段来自其验证器的 JSON 架构，否则来自其最新 100 个文档的字段名和类型，并在数据库中计算，因此任何值都不会离开数据库。如果有从节点，就在从节点上读取文档。视图的源集合属于血缘，自定义检查是一个 JSON 格式的聚合管道。

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

如果只监视一个数据库，请授予 \`{ role: "read", db: "orders" }\` 来代替 \`readAnyDatabase\`。

Microsoft Dataverse：一个环境就是一个数据库，其表位于 \`dbo\`，与其 SQL 端点的命名一致。OneUptime 以应用的身份登录：在 Microsoft Entra ID 中注册一个带客户端密码的应用，并将它作为应用程序用户添加到环境中（Power Platform admin center > the environment > Settings > Users + permissions > Application users），同时赋予一个有权读取这些表的安全角色。使用 JSON，或使用写明 \`AuthType=ClientSecret\` 的 Dataverse 连接字符串进行连接。租户可以省略：环境会说明它属于哪个租户。

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

每五分钟，Web API 会提供每个表的定义、来自 Dataverse 每天生成一次的快照中的行数（因此最多滞后一天），以及它最新的 \`modifiedon\`，即它的上次更改时间。它的列每小时读取一次。每次读取都计入应用的 Dataverse 请求限制，被要求放慢速度的收集会把剩余部分留给下一次。一个环境本身就有数百个表，因此只监视核心业务表（客户、联系人、潜在顾客、商机、报价单、订单、发票、产品、案例、电子邮件、电话联络、约会、任务和备注）以及你自己的自定义表。Microsoft 应用的表（\`msdyn_\`、\`adx_\` 以及其他 \`ms\` 前缀）会被排除：需要监视其他表时，请像 \`"tables": ["msdyn_workorder"]\` 这样指定。

数据检查以只读 SQL 的形式在环境的 TDS 端点上运行，端口为 1433 或 5558。除非管理员将其关闭，否则它是开启的；如果为它开启了用户级访问控制，应用的角色需要 **Allow user to access TDS endpoint** 权限。它的 SQL 不支持正则表达式、不支持 \`WITH\`，也不支持采样。

## 每个表写入的指标

每次收集都会为每个表写入以下指标，因此你可以像使用其他指标一样为它们绘制图表、放到仪表板上并设置警报：

| 指标 | 含义 |
| --- | --- |
| \`oneuptime.data.table.row_count\` | 表中的行数 |
| \`oneuptime.data.table.size\` | 表及其索引占用的字节数 |
| \`oneuptime.data.table.seconds_since_change\` | 距离上次插入、更新或删除一行过去的秒数 |
| \`oneuptime.data.table.overdue_seconds\` | 表超过其通常更改时间的秒数；按时时为 0。在学会其节奏后写入 |
| \`oneuptime.data.table.row_count_change_percent\` | 自上一次收集以来行数变化的百分比（-50 表示一半的行消失了）。少于 1,000 行的表不计入 |
| \`oneuptime.data.table.schema_changes\` | 自上一次收集以来发生更改的列 |
| \`oneuptime.data.table.breaking_schema_changes\` | 自上一次收集以来被删除、重命名或更改类型的列 |

每一行都带有 \`oneuptime.data.store.id\`、\`oneuptime.data.store.name\`、\`oneuptime.data.table.id\`、\`oneuptime.data.table.schema\`、\`oneuptime.data.table.name\` 和 \`oneuptime.data.table.key\`（\`schema.table\`）。按 \`oneuptime.data.table.key\` 分组的指标监视器会对每个表各发出一次警报，它的 **异常偏高** 和 **异常偏低** 筛选器会将每个表与它自己在一周中该时段的通常值进行比较，因此无需设置阈值。

## 警报

你连接的数据库会在其 **推荐的警报** 上打开；之后，你可以在 **数据库** 中为它选择这些警报。每条推荐都是针对整个数据库的一个指标监视器，会对每个表各发出一次警报，因此之后创建的表也会被监视：

| 警报 | 触发条件 |
| --- | --- |
| **表延迟** | 表超过其通常更改时间达十五分钟 - 与 **延迟** 标签的规则相同 |
| **行数骤降** | 表在两次收集之间失去一半或更多的行 |
| **行数异常偏低** | 表的行数远少于一周中该时段的通常值（用两周时间学习） |
| **架构已更改** | 表的列被删除、重命名或更改类型。添加的列不会破坏任何东西，只会留在时间线上 |
| **表状态停止上报** | 数据库中没有任何表在十五分钟内被读取 |

在创建时选择严重程度、值班策略、所有者和标签。之后它们就是普通的监视器：可以像其他监视器一样编辑、静音或放到状态页上。

回填或迁移不应该惊动任何人。在维护事件的 **Data Observability 数据库** 中指定该数据库，或将其数据库服务器加入维护事件，在事件进行期间，其数据警报就会保持安静。

## 所有者和标签

表的 **所有者** 选项卡列出它所属的人员和团队，表的警报会发送给他们；没有所有者时，发送给其数据库的所有者。**所有者规则** 和 **标签规则** 会在每个表首次出现时应用于它，按其标签，或按对其名称、架构或数据库的正则表达式进行匹配。范围限定为 \`Owned\` 的权限只覆盖其持有者或其团队所拥有的表，以及这些表的检查、活动和报告的问题。拥有一个数据库并不会让人成为其表的所有者：要把整个数据库交给一个团队，请使用所有者规则。

## 警报打开时

表的警报有一张 **数据** 卡片，按可能性高低说明它最可能发生的原因：上游的警报、失败的运行、写入它的服务的部署、它的写入失败、发生变化的列、数据库或其所在的服务器。下方列出依赖它的内容：表、仪表板、服务以及拥有它们的人。

请说说你的看法：**有用**、**符合预期**（计划内的事件：不做任何更改）或 **不是问题**（给表更大的余量，这样下次同样的情况就不会再报警）。如果有人先发现了问题，可以在表上用 **报告问题** 记录下来。**概览** 显示汇总情况：每周有用的警报数、其中有多少不是噪音、问题在有人报告之前被发现的频率和速度，以及推测的原因有多少次就是真正的原因。


## 数据产品

使用数据的人（分析师、财务、管理层、AI 智能体）考虑的是他们所使用的东西：“收入仪表板的表”，而不是数据库。数据产品为这些表命名，并带有其所有者、使用方和新鲜度 SLA。在 **数据产品** 中创建。它的 SLA 是以下之一或两者：
- **在一天中的某个时间（UTC）前保持最新：** 每天的数据在当天这个时间之前到达。从这个时间起，每个表都必须在当天发生过更改；在此之前，以昨天的加载为准。总是晚半小时的加载，每天都会在这半小时内处于延迟状态。
- **最大时长：** 任何表的上次更改都不能早于这个时长。

每五分钟，每个产品的表都会与其 SLA 进行比较。只要有任何一个表延迟，产品就处于 **延迟** 状态，其数据的时间点是这些表中最早的上次更改。它会写入 \`oneuptime.data.product.late_tables\` 和 \`oneuptime.data.product.data_age\`，因此你可以把所有产品的新鲜度并排绘制出来。

保存产品时，还会以你的身份、用你的权限创建：
- **一个监视器**，在状态页上代表该产品。只要有表延迟，它就处于降级状态，并以项目中最低的严重程度打开一个事件和一个警报，它们会自行解决。将它作为资源添加到私有或公开的状态页上：订阅的使用方会在产品延迟以及恢复最新时收到通知。
- **一个 SLO**，基于该监视器：数据按时的时间比例，对照产品在 30 天内的 SLA 目标，并带有每个 SLO 一开始就有的快速和慢速消耗率警报。

删除产品会同时删除这两者。每个产品还有一个 **徽章**，说明其数据截至什么时候：按时时为绿色，不再按时时变为琥珀色并带有“late”。从产品的概览中将其嵌入 BI 仪表板、Wiki 页面或 README。它的链接不需要登录，因此请像对待共享链接一样对待它；**重置徽章链接** 会生成新链接并停用旧链接。

## 对表中值的检查

表的状态说明它是否在变化。**检查** 说明它所包含的内容是否正确。在表的 **检查** 选项卡上添加：

| 检查 | 读取的内容 |
| --- | --- |
| **NULL 占比** | 该列为空的行所占的百分比 |
| **重复占比** | 与另一行的值重复的值所占的百分比 |
| **去重计数** | 该列包含多少个不同的值 |
| **最小值**、**最大值**、**平均值**、**总和** | 数值列的值（没有行时总和为 0） |
| **无效值占比** | 不在你给出的列表中的值所占的百分比 |
| **格式不符占比** | 不符合你选择的格式（如电子邮件、UUID 或国家代码）或不匹配你自己的正则表达式的值所占的百分比（除 SQL Server 外的所有引擎） |
| **孤立行数** | 其值在另一个表的列中找不到匹配的行 |
| **行数** | 表中的行数，与 **分段依据** 搭配使用最有用 |
| **自定义 SQL** | 你的一条只读 SELECT 返回的数字 |

同一选项卡上的 **建议的检查** 仅根据列的名称和类型，提供表的列所需要的检查：
- id 是唯一的。
- \`customer_id\` 在 \`customers\` 中有对应的行。
- 电子邮件地址看起来像电子邮件地址，金额不为负数。
- 状态保持其通常的取值。
- 按租户拆分的表按租户计数。

可以添加一项、全部添加，或永久忽略某一项。

**分段依据** 会针对某一列的每个值（如租户或区域）各运行一次检查：为最大的 100 个分段各生成一个序列和一个警报。分段的行数会在某个租户停止发送数据时发出警报。

检查随数据库的收集一起运行，由 OneUptime 或其探测器执行，频率为每 15 分钟、每小时、每 6 小时或每天。每项检查都在带有语句超时的只读事务中作为一条聚合语句运行：只有数字会离开数据库，除非项目选择保留失败行的脱敏样本。值写入为 \`oneuptime.data.check.value\`，并带有 \`oneuptime.data.check.id\`、\`oneuptime.data.check.name\` 和 \`oneuptime.data.check.segment\`。

设置 **发出警报的条件** 即可对检查发出警报：
- **异常偏高** 或 **异常偏低** 会将每个值与它在一周中该时段学到的基线进行比较。
- **高于** 或 **低于** 会将它与阈值进行比较。

保存检查时，会以你的身份、用你的权限为它创建一个指标监视器。清除条件会删除该监视器。

**失败的行** 统计你的一条只读 SELECT 返回的行：也就是不应该存在的行。0 表示正常。

有三项设置可以控制检查的成本。**采样百分比** 只读取一部分行，适用于读取比率的检查。**设置** 下的 **单次检查最多读取量（GB）** 会在 BigQuery 或 Athena 上的检查读取超过该量之前停止它。同样位于那里的 **数据库繁忙时等待** 会在 PostgreSQL、MySQL 或 SQL Server 数据库看起来很忙时，把到期的检查留给下一次收集。

**设置** 下的 **保留失败的行** 最多为每项检查保留 20 条失败的行，敏感列会在离开数据库之前被脱敏。在你开启之前它是关闭的。这些行存储在 OneUptime 中：在 OneUptime Cloud 上存储在 OneUptime 的服务器上，在自托管安装中存储在你自己的服务器上；关闭它会删除这些行。

把检查保存在代码仓库中的文件里，并在 CI 中用 \`oneuptime data-checks apply checks.yaml\` 应用它们。在拉取请求中使用 \`--dry-run\` 运行它。文件中任何地方有错误，都不会应用任何内容。文件格式请参阅文档。


## 对账

副本会逐渐偏离：仓库中的订单比应用程序数据库中的少，或者一次迁移丢失了行。对账会比较两个表的一个度量，这两个表可以在同一个数据库中，也可以在两个数据库中：
- **行数**
- 某一列的 **总和**
- 某一列的 **去重计数**
- **自定义 SQL**：返回一个名为 \`value\` 的数字的只读查询。

它有一个容差：**绝对值** 数量，或源值的 **百分比**。在 **对账** 中创建。

每一侧都由一项专属的数据检查读取，该检查由对账创建和维护，并随其数据库的收集一起运行：由 OneUptime 或由该数据库的探测器执行。因此，对账可以把你网络中的 PostgreSQL 表与它在 Snowflake 或 BigQuery 中的副本进行比较。它的检查会显示在每个表的检查选项卡上，并且只能在对账中更改。

两侧都在彼此 15 分钟以内被读取后，就会比较这两个值，然后安排两侧再次一起读取。对账会写入：
- \`oneuptime.data.reconciliation.drifted\`：两者的偏离超出容差时为 1，一致时为 0。它的监视器读取该指标，并在两者偏离时发出警报。
- \`oneuptime.data.reconciliation.difference\`：目标的值减去源的值。
- \`oneuptime.data.reconciliation.difference_percent\`：差值占源值的百分比。

检查失败的一侧会说明原因。按计划加载的副本会落后于其源：请用自定义 SQL 比较两者都已稳定下来的度量（例如一小时以前的行），或在容差中考虑这段滞后。

## 来自 OpenLineage 的管道和血缘

Airflow、Dagster、Spark、dbt 和 Flink 用 [OpenLineage](https://openlineage.io) 事件描述作业的每次运行。使用遥测摄取密钥把它们原样发送到 OneUptime（项目设置 > 遥测与 APM > 摄取密钥）：

- **URL：** \`https://oneuptime.com/telemetry/openlineage\`（自托管的 OneUptime 请使用你自己的地址）
- **端点：** \`api/v1/lineage\`，即 OpenLineage 的默认值
- **API 密钥：** 摄取密钥。它作为 \`Authorization: Bearer\` 发送，也可以设置 \`x-oneuptime-token\`。

对于 Airflow 的 OpenLineage 提供程序：

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

对于任何 OpenLineage 客户端，设置 \`OPENLINEAGE_URL\` 和 \`OPENLINEAGE_API_KEY\`。

每个作业都会显示在 **管道** 下，并带有其最新一次运行：开始和结束时间、耗时，以及失败运行的错误。读取和写入 OneUptime 所监视表的运行会成为 **血缘**：表的 **血缘** 选项卡显示构建它所用的表、写入它的管道及其最新一次运行，以及由它构建的表。

数据集按 OpenLineage 命名规范与表进行匹配：\`postgres://host:5432\` 对应 \`database.schema.table\`，\`mysql://host:3306\` 对应 \`database.table\`，\`sqlserver://host:1433\` 和 \`redshift://cluster:5439\` 对应 \`database.schema.table\`，\`snowflake://account\` 对应 \`database.schema.table\`，\`bigquery\` 对应 \`project.dataset.table\`，\`clickhouse://host:8443\` 对应 \`database.table\`，\`databricks://workspace-host\` 对应 \`catalog.schema.table\`。

每个管道都会从自己的运行中学习一次运行通常需要多长时间（最近 20 次已完成运行的中位数），以及按其计划两次运行之间相隔多久（最近 50 次启动之间不属于偶发情况的最长间隔）。两者在五次运行后即可确定，既适用于每五分钟运行一次的作业，也适用于每晚运行的作业。当你的调度器像 Airflow 那样发送 OpenLineage 的 \`nominalTime\` facet 时，运行的计划时间会被视为其开始时间，因此回填仍会按计划来解读。

管道的页面会推荐三个监视器，每个都只需单击即可创建：
- **管道运行失败**：一次运行失败或被中止。
- **管道运行时间异常长**：一次运行的耗时达到通常的两倍或更多。运行期间每五分钟检查一次，因此卡住的运行会在结束之前被发现。
- **管道延迟**：在超过计划允许的时间内没有任何运行开始，留有间隔的四分之一且至少十五分钟的余量。

它们读取以下指标，每个指标都带有 \`oneuptime.data.pipeline.id\` 和 \`oneuptime.data.pipeline.name\` 标签：
- \`oneuptime.data.pipeline.run_failed\`：每次运行结束时为 1 或 0。
- \`oneuptime.data.pipeline.run_duration\`：每次运行结束时的秒数。
- \`oneuptime.data.pipeline.run_duration_ratio\`：本次运行时间除以通常运行时间（至少按一分钟计），在每次运行结束时以及运行期间每五分钟写入一次。
- \`oneuptime.data.pipeline.overdue_seconds\`：下一次运行超出其计划多久，每五分钟一次；按时时为 0。

管道的页面会绘制它的 **血缘**，这是运行失败或延迟时首先要看的地方：左边是它读取的表，右边是它写入的表，以及每个表当前的状况。选择更多步数，可以看到这些表由什么构建，以及由它们构建了什么；点击管道或表卡片上未绘制的表的数量，会在原处绘制更多表。同样的血缘也可以通过 \`POST /api/data-observability/pipelines/lineage\` 获取，供你自己的工具使用。 选择它写入的某一列，即可跨管道追踪该列：向上追踪到它读取的每个表中构建该列的列，向下追踪到它写入该列的每个表。 对于你自己的工具，请发送 \`"withColumns": true\` 以获取其运行移动的列。



## Fivetran 和 Airbyte 同步

Fivetran 和 Airbyte 加载你的原始表，并且不发送 OpenLineage 事件，但它们的 webhook 会告知每次同步何时开始和结束。每个 Fivetran 连接器和每个 Airbyte 连接都会成为 **管道** 下的一个管道，每次同步成为一次运行，拥有与任何管道相同的运行历史、学到的耗时和计划，以及相同的警报：失败的运行、异常长的运行和延迟的运行。**管道 > 连接 Fivetran 或 Airbyte** 会用你的一个摄取密钥填好下面的 URL。

- **Fivetran：** 使用 Fivetran 的 REST API，为你的账户或一个目标组创建 webhook，事件为 \`sync_start\` 和 \`sync_end\`。它的 URL 是 \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`，它的密钥就是该摄取密钥。Fivetran 用密钥为每次投递签名，因此密钥本身永远不会出现在 URL 中，未用它签名的投递会被拒绝。
- **Airbyte：** 在工作区的通知设置中，将 webhook 设置为 \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\`，并为失败的同步和成功的同步开启它。Airbyte 不做任何签名，因此它的 URL 中带有密钥：请为 Airbyte 单独准备一个密钥。

管道的名称就是工具为连接器或连接起的名称，位于 \`fivetran://<destination group>\` 或 \`airbyte://<workspace>\` 之下。失败同步的运行会显示工具的错误。因 API 速率限制而被重新安排的 Fivetran 同步会以 **已重新安排** 结束：这不算失败，因此不会惊动任何人，其耗时也不会用于学习。

Fivetran 连接器会加载其目标中以它命名的架构。当恰好只有一个被监视的数据库拥有该架构时，该数据库的表会把该连接器记录为其写入者：变得陈旧的表会指向本应加载它的同步，失败同步的警报就是这些表的警报的原因（参见“一个原因一个问题”）。Airbyte 不提供表名。

## BI 工具中的仪表板

坏数据真正的影响，体现在有人打开的仪表板上。在 **BI 仪表板** 下，用有权读取其仪表板的凭据添加你的 BI 工具：

| 工具 | 凭据（JSON） |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\`（或某个用户的 \`username\` 和 \`password\`） |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`，一个个人访问令牌 |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`，一个 API 客户端 |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`，一个有权使用 Power BI 管理 API 的服务主体 |
| **Hightouch** | \`{ "apiKey": "..." }\`：每次同步都被视为又一个依赖某个表的对象 |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`：每次同步都被视为又一个依赖某个表的对象 |

每小时一次，以及在添加工具或你选择 **立即读取** 时，OneUptime 会读取每个仪表板及其背后的表：卡片的表和原生问题的 SQL（Metabase）、数据集的表或虚拟数据集的 SQL（Superset）、Metadata API 的上游表（Tableau）、每个磁贴的 explore（Looker），以及每个报表的数据集（Power BI，来自工作区扫描）。每个表都按其数据库、架构和名称与一个被监视的表进行匹配；仍然同时符合两个被监视表的名称会保持未匹配。表的 **血缘** 选项卡、其警报的 **数据** 卡片和生产审查会列出基于它构建的仪表板，以及基于由它构建的表的仪表板。只读取名称和链接，从不读取仪表板的数据。

Power BI 工具还可以对其数据集的刷新失败发出警报。开启 **刷新失败时发出警报** 后（现在添加的工具默认开启），OneUptime 会为该工具维护一个监视器，为每个最近一次刷新失败或被取消的数据集打开一个警报（数据集名称会出现在警报标题中），并在之后的刷新完成后解决它。它读取 \`oneuptime.data.bi.refresh_failed\`，该指标带有 \`oneuptime.data.bi.dataset.name\` 和 \`oneuptime.data.bi.workspace.name\` 标签：每五分钟，每小时读取时发现失败的每个数据集会写入 1，在之后的刷新完成后的一小时内写入 0。仍在运行的刷新不会改变任何内容，因此无论有多少次每小时读取看到它，一次失败就是一个警报。

## 追踪中的作业

Kubernetes CronJob 或定时触发的函数无需安装任何东西就会显示为管道：带有 \`k8s.cronjob.name\` 或 \`k8s.job.name\` 的 span，或带有 \`faas.trigger\` 为 \`timer\` 或 \`datasource\` 的 \`faas.name\` 的 span，会成为一个管道，并带有其运行以及其数据库调用涉及的表。每次运行都链接到其追踪和日志，停止运行的 CronJob 会被视为延迟。

## 数据库自身提供的血缘

血缘并不需要发送 OpenLineage 的管道。每个数据库自己就会提供一部分血缘，OneUptime 会随数据库的收集一起读取：
- **视图：** 在 PostgreSQL、Redshift、MySQL 8 和 SQL Server 中，视图由定义它的表构建而成。视图被重新定义或删除时，它旧的血缘也会随之消失。
- **查询历史：** 读取一个表并写入另一个表的查询，例如计划查询、dbt 模型或 MERGE，也属于血缘。它来自 BigQuery 的作业（数据集所在项目和位置的 \`INFORMATION_SCHEMA.JOBS\` 视图，需要 **BigQuery Resource Viewer**）以及 Redshift 的查询日志（\`stl_insert\` 和 \`stl_scan\`，需要 \`SYSLOG ACCESS UNRESTRICTED\`）。只有在数据集自己的项目中运行的作业才会出现在其作业视图中。

血缘每小时读取一次，回溯到上一次读取；在数据库首次收集时回溯一周，因此从一开始就有血缘。BigQuery 的读取按其读取的作业小时数计费，大多数情况下是 BigQuery 的 10 MB 最低计费。

表的 **血缘** 选项卡上的每条边都会说明它是在哪里看到的：管道的运行、查询历史（带有其查询移动了数据的登录账号），或视图的定义。来自所有来源的血缘都会用于 **一个原因一个问题**。

在表的 **血缘** 选项卡顶部，有一张图会把它的血缘向两个方向各绘制几步（三步，或选择 1、2 或 5）：左边是构建它所用的内容，右边是由它构建的表和仪表板，以及在数据进入的地方从外部加载数据的管道。每张卡片都会显示当前状况 - 延迟、未解决的警报、失败的运行 - 当其管道最近一次运行失败时，箭头会变成红色，因此可以从延迟的表一路追溯到导致它出问题的那次运行。打开任意一个表，即可让图以它为中心。每张卡片在每个方向上最多绘制十个表，其余的会计数，例如 **+14**：选择这个数字，就会在原处绘制接下来的表；选择 **重置图** 可以返回。在来源提供了列名的地方，在 **追踪列** 中选择表的一列，即可高亮显示它从哪里来、到哪里去，即使它在途中被重命名。同样的血缘也可以通过 \`POST /api/data-observability/tables/lineage\` 获取，供你自己的工具使用：发送 \`"withColumns": true\` 可以获得每个箭头的列，向 \`POST /api/data-observability/lineage/expand\` 请求可以获得卡片的下一批表。 血缘只显示你的角色可以读取的表和管道：你无权读取的内容永远不会被绘制、在箭头上命名或被计数。

## dbt

在 \`dbt build\`（或 run、test、seed、snapshot）之后，使用 CLI 和遥测摄取密钥发送项目的构件。它会读取 \`target/manifest.json\` 和 \`target/run_results.json\`，只发送 Data Observability 从中读取的内容：

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

在 CI 中，把 \`oneuptime dbt upload\` 作为构建之后的步骤运行，即使构建失败也要运行，这样失败的测试才会被记录下来。对于 dbt Cloud 作业，先用 dbt Cloud 的 API 下载其构件，再使用 \`--manifest\` 和 \`--run-results\` 上传。也可以自己发送：向 \`POST /telemetry/dbt/v1/artifacts\` 发送 \`{ "manifest": ..., "run_results": ... }\`，并把密钥放在 \`x-oneuptime-token\` 中。

每次上传的作用：
- **表：** 每个属于 OneUptime 所监视表的模型、seed、snapshot 和源，都会在其概览上获得一张 **dbt** 卡片：节点、其物化方式、所有者、标签和上一次构建。当表的描述为空时，会用其 dbt 描述填写。表按其数据库、架构和名称进行匹配，支持 PostgreSQL、MySQL、SQL Server、Redshift、Snowflake、BigQuery、ClickHouse 和 Databricks。dbt 不知道主机，因此当两个被监视的数据库同名时，它们的表会保持未匹配，除非只有其中一个包含该表。
- **血缘：** 每个模型由什么构建，会通过项目的管道成为该表 **血缘** 选项卡上的血缘。
- **测试：** 被监视表的每个测试都会显示在其 **检查** 选项卡上，并带有其最近的结果以及它发现失败的行。点击 **失败时发出警报**，即可让失败的测试打开警报。
- **构建：** 每次构建都是 **管道** 下项目管道（命名空间 \`dbt\`）的一次运行。带有错误或失败测试的构建就是一次失败的运行，因此管道警报也适用于 dbt 构建：失败、异常长和延迟。

## 未使用的表

每个引擎都会在自己的统计信息中统计每个表的读取：
- PostgreSQL：其扫描。
- MySQL：performance_schema 的读取。
- SQL Server：其 seek、scan 和 lookup，以及最后一次的时间。

每次收集都会将计数器与上次保存的值进行比较，因此表的 **上次读取** 可以精确到小时，从什么时候开始没有读取也同样可知。表首次收集时计数器为 0，表示自引擎统计开始以来它从未被读取，因此未使用的表从一开始就会显示为未使用，而不是在监视几个月之后。在某个服务的数据库 span 中看到的读取也会计入。

**未使用的表** 列出 90 天内没有人读取过的表，从最大的开始，并显示每个表上次被写入的时间：仍在写入却从未被读取的表，会产生写入和存储的成本。概览显示它们有多少以及包含什么。视图没有自己的计数器，因此永远不会被列出。当数据库登录账号无法读取计数器时，表的上次读取时间就无从得知。

## 仓库支出

每小时一次，随每个仓库的收集，OneUptime 会逐个作业读取 Snowflake 和 BigQuery 在过去一天的花费：Snowflake 的计算积分来自 \`QUERY_ATTRIBUTION_HISTORY\`（需要对 \`SNOWFLAKE\` 数据库的 \`IMPORTED PRIVILEGES\`，在连接的仓库上运行），BigQuery 的计费字节来自其作业视图（需要 **BigQuery Resource Viewer**）。作业是一个被反复运行的查询 - Snowflake 的参数化查询、去掉字面量的 BigQuery 查询 - 以其查询标签或标记命名，或以它做什么以及写入哪个表命名，绝不以其查询文本命名。

**仓库支出** 显示当天的积分和计费字节，按团队划分（作业的查询标签或标记中的 \`team\`，否则为运行它的人），写入成本最高的表（在 Snowflake 的 ACCESS_HISTORY 或 BigQuery 的目标表说明了是哪些表时，把作业的花费分摊到它写入的表上），失败的作业，以及花在只写入 90 天内没有人读取过的表的作业上的费用。

## 一个原因一个问题

当一个表变得陈旧时，由它构建的每个表也会变得陈旧。在打开数据警报之前，OneUptime 会沿着血缘查找：构建其表或管道所用的内容上是否已经有一个打开的警报，包括上游的表、写入它们的管道以及它们所在的数据库，最多向上五步。找到之后，新警报就是那个警报的后果：
- 它一开始就是 **已确认** 状态，因此不会有人为同一个问题被惊动两次。它的数据一旦恢复，它也会自行恢复。
- 它的动态会说明是哪个警报导致了它，它的 **数据** 卡片也会说明。
- 如果原因属于某个片段，它会加入原因所在的片段。

原因的 **数据** 卡片会列出它的 **下游影响**：它导致的每个警报。表警报的卡片还会显示写入该表的服务、它们的写入失败，以及它们在警报前一天的部署和其他更改。

在 **数据** 卡片下方，警报的页面会绘制它的 **血缘**：围绕其表绘制（与表的 **血缘** 选项卡的画法相同），或围绕其管道绘制，并高亮显示向上到导致它的警报、向下到它导致的每个警报的路径，原因标记为 **原因**，它导致的每个警报标记为 **后果**。当原因位于画在箭头上的管道上时，箭头会在管道名称下方显示 **原因**。来自针对某一列的检查（例如针对 \`customer_id\` 的 NULL 占比检查）的警报，打开时会在这些路径旁边追踪该列，与表的 **血缘** 选项卡上相同；你可以在那里选择表的另一列，或清除选择以只查看路径。无权查看导致它的警报的人，既看不到 **数据** 卡片，也看不到血缘；对于他们无权查看的被导致的警报，既不会高亮显示也不会计数。同样的血缘也可以通过 \`POST /api/data-observability/alerts/<alert ID>/lineage\` 获取，其中包括列检查的警报所读取的 \`column\` 以及每个箭头所携带的列。 它引起的、位于箭头上所绘管道的警报，同样会在那里显示 **后果**；列选择器会先列出检查的列，再按表自身的顺序列出表的其他列。


## OneUptime AI

- **数据警报的调查。** 当 OneUptime AI 调查关于表、管道或数据库的警报时，它会读取与之相关的内容：表的新鲜度及其未解决的警报、导致此警报的那个警报、自前一天以来写入该表的管道的运行（失败的运行及其错误）、写入该表的服务及其写入失败、部署和其他更改，以及它的血缘：构建它所用的表和由它构建的表（有问题的排在前面），并说明导致此警报的警报位于何处、它导致的警报位于哪些表上。对于来自针对某一列的检查的警报，它还会沿着血缘追踪该列：上游中构建它所用的列，以及下游中由它构建的列，逐表进行。它会指出警报背后的运行、部署或上游表。
- **用一句话生成检查。** 在表的检查选项卡上，**用一句话编写检查** 会把“订单的总额永远不会是负数”这样的规则，变成统计违反该规则的行的自定义 SQL 检查，一旦有违反就发出警报。在 **添加检查** 添加它之前，你可以先阅读查询，它和任何自定义 SQL 检查一样受到同样的限制：一条只读语句，在只读事务中运行。
- **这个表是最新的吗？** 在询问 AI、Slack 或 Microsoft Teams 中询问 OneUptime AI（“orders 表是最新的吗？”）。它会根据表自己的节奏回答其新鲜度、上次更改的时间、未解决的警报、写入者的最新运行，以及它所属的数据产品。AI 智能体在使用数据之前，会通过 MCP 服务器的 \`get_data_table_freshness\` 工具询问同样的问题。
- **这个表是由什么构建的？** 用同样的方式询问（“revenue 表的数据来自哪里？”“如果 raw.orders 停止加载，会影响什么？”）。它会沿着表的血缘向两个方向各追踪三步（应要求可达五步），并把延迟、已删除、有未解决警报或其管道最近一次运行失败的上游和下游表排在前面，由近到远，同时说明每个表相隔几步以及中间的表；然后是其余部分：从 OneUptime 监视范围之外加载其源的管道，以及基于它构建的 BI 仪表板。未解决的警报只计数、从不点名，并且只包括提问者有权查看的警报。AI 智能体在更改表之前，会通过 MCP 服务器的 \`get_data_table_lineage\` 工具询问同样的问题。 对所述内容之外更远处的表，无论与多少个已述的表相邻，每个只计一次。在表的页面上打开时，询问 AI 知道“此表”指的是哪个表，并会询问该表，即使多个数据库中都有同名的表。与每个血缘视图一样，它只告知提问者可以读取的表和管道。

## 使用每个表的服务

表的 **服务** 选项卡列出被看到写入和读取该表的服务，以及每个服务运行的语句、过去一小时内的调用和失败，以及上次被看到的时间。这些信息来自你的服务已经通过 OpenTelemetry 发送的数据库 span：带有 \`db.system.name\`、\`db.namespace\` 和 \`db.collection.name\`（或 \`db.sql.table\`，或名称类似 \`INSERT orders\` 的 span）的客户端 span。无需额外安装任何东西。每 15 分钟更新一次。

每个服务还会显示发起其调用的端点，如果它也调用模型，则会标记为 **AI 应用**。**提到此表的错误** 列出写入该表的服务中，按名称提到该表的未解决异常和过去一天的错误日志。

只有当 span 的数据库是某次收集所读取的数据库时，才会把它与表关联；当两个数据库同名时，只有其 \`server.address\` 是其中之一时才会关联。如果不确定，就不会计入该 span。

这些指标是 OneUptime 自己的运营数据，不会作为遥测计费。
`;

export default DOCUMENTATION;
