# 血缘与管道

血缘说明每个表由哪些表构建而成，以及哪些管道写入它。数据可观测性会同时从六个地方收集血缘——OpenLineage 事件、dbt、Fivetran 和 Airbyte 同步、追踪中的作业、视图，以及每个数据库自身的查询历史——并用它把每个延迟或损坏的表关联到其背后的运行，让一个问题只打开一个警报。

## 血缘的来源

| 来源 | 提供的内容 |
| --- | --- |
| **OpenLineage** | Airflow、Dagster、Spark、dbt 或 Flink 作业的每次运行，以及它读取和写入的表 |
| **dbt** | 每个模型由什么构建而成、作为一次运行的每次构建，以及每个测试的结果 |
| **Fivetran 和 Airbyte** | 作为其连接器一次运行的每次同步，以及它加载的原始表 |
| **追踪中的作业** | Kubernetes CronJob 或定时函数、它的运行，以及它的数据库调用所读取和写入的表 |
| **视图** | 视图由其定义所基于的表构建而成（PostgreSQL、Redshift、MySQL 8、SQL Server、Oracle、Snowflake、ClickHouse 物化视图、Databricks、MongoDB） |
| **查询历史** | 读取一个表并写入另一个表的查询（Snowflake 的访问历史、BigQuery 的作业、Redshift 的查询日志、ClickHouse 的查询日志、Databricks 的血缘表） |

表的 **血缘** 标签页显示构建它的表、写入它的管道及其最新运行，以及由它构建的表。每条边都会说明它是在哪里观察到的。

如果来源指明了列，表的 **列** 标签页会说明每一列来自哪里、又提供给了什么：Snowflake 的访问历史（企业版，需要对 `SNOWFLAKE` 数据库拥有 `IMPORTED PRIVILEGES`），以及 OpenLineage 的 `columnLineage` facet。

## OpenLineage

使用遥测 [摄取密钥](/docs/telemetry/ingestion-keys)，将 OpenLineage 事件原样发送到 OneUptime：

- **URL：** `https://oneuptime.com/telemetry/openlineage`（在自托管的 OneUptime 上，使用你自己的地址）
- **端点：** `api/v1/lineage`，即 OpenLineage 的默认值
- **API 密钥：** 摄取密钥，以 `Authorization: Bearer` 发送，或设置 `x-oneuptime-token`

对于 Airflow 的 OpenLineage 提供程序：

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

对于任何其他 OpenLineage 客户端，请设置 `OPENLINEAGE_URL` 和 `OPENLINEAGE_API_KEY`。数据集按 OpenLineage 命名规范与表对应，例如 `postgres://host:5432` 加 `database.schema.table`、`snowflake://account` 加 `database.schema.table`、`clickhouse://host:8443` 加 `database.table`，以及 `databricks://workspace-host` 加 `catalog.schema.table`。

## dbt

在 `dbt build`（或 run、test、seed、snapshot）之后，使用 [OneUptime CLI](/docs/cli/index) 发送项目的构建产物：

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

在 CI 中，把 `oneuptime dbt upload` 作为构建之后的步骤运行，即使构建失败也要运行，这样失败的测试才会被记录下来。dbt 构建的每个表都会在其概览上获得一张 **dbt** 卡片，获得其模型的血缘，并在 **检查** 标签页上显示其测试；每次构建都是该项目管道的一次运行。

## Fivetran 和 Airbyte

它们的 webhook 会说明每次同步何时开始和结束。**管道 > 连接 Fivetran 或 Airbyte** 会用你的一个摄取密钥填好 URL：

- **Fivetran：** 使用 Fivetran 的 REST API 创建的 webhook，针对 `sync_start` 和 `sync_end` 事件，发送到 `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`，并把摄取密钥用作它的签名密钥。Fivetran 用它为每次投递签名，因此密钥永远不会出现在 URL 中。
- **Airbyte：** 将工作区的 webhook 设为 `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`，并为失败和成功的同步开启。请给 Airbyte 一个专用的密钥。

因 API 速率限制而被重新安排的 Fivetran 同步会以 **已重新安排** 结束：这不是失败，因此不会呼叫任何人。

## 追踪中的作业

很多管道是 Kubernetes CronJob，或是按定时器运行的函数，没有调度器来发送血缘。它们的追踪照样能说明一切，无需安装任何东西。每十五分钟，带有资源属性 `k8s.cronjob.name` 或 `k8s.job.name` 的 Span，或者带有 `faas.name` 且 `faas.trigger` 为 `timer` 或 `datasource` 的 Span，会成为 **管道** 下的一个管道：

- CronJob 的一次运行就是它的 Kubernetes Job，函数的一次运行就是它的 `faas.invocation_id`。
- 当其追踪顶部的 Span 失败时，该次运行即为失败。在其中失败后又被重试的调用不会使它失败。
- 它写入和读取的表来自它的数据库 Span。

每次运行都链接到它的追踪及日志。同样的三个监视器也适用，因此停止运行的 CronJob 会被视为延迟。

## BI 工具中的仪表板

坏数据的真正影响是有人打开的仪表板。在 **BI 仪表板** 下，用可以读取其仪表板的凭据添加你的 BI 工具。数据可观测性每小时读取每个仪表板及其背后的表，将每张表与受监控的表匹配，并在表的 **血缘** 标签页、告警和 Production Review 中列出基于该表以及由它构建的表的仪表板。

| 工具 | 凭据 |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, 允许使用 Power BI 管理 API 的服务主体 |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }`（或 `eu`） |

Hightouch 和 Census 是反向 ETL 工具：把表复制到 CRM 的同步，与仪表板一样依赖该表，因此以同样的方式读取，并在表的警报中列出。

只读取仪表板的名称和链接以及它们查询的表，绝不读取其数据。

## 管道

每个作业、dbt 项目和同步都会连同其运行显示在 **管道** 下：每次运行何时开始和结束、耗时多久、在调度器给出的情况下它是第几次尝试（Airflow 的尝试次数），以及失败运行的错误。积累五次运行后，每个管道都会从自己的运行中学习一次运行通常需要多久，以及按其计划两次运行之间通常间隔多久。管道的页面会推荐三个监视器：

- **Pipeline Run Failed**：某次运行失败或被中止。
- **Pipeline Run Unusually Long**：某次运行的耗时已达到其典型时间的两倍或更多；运行期间每五分钟检查一次，因此挂起的运行在结束之前就会被发现。
- **Pipeline Is Late**：超过其计划所允许的时间仍没有任何运行开始。

## 一个原因，一个警报

当一个表变得陈旧时，由它构建的每个表也会变得陈旧。在数据警报打开之前，OneUptime 会查找血缘，看该表或管道的上游是否已有打开的警报：上游的表、写入这些表的管道，以及这些表所在的数据库，最多向上追溯五步。如果找到，新警报就会成为该警报的后果：

- 它一开始就处于 **已确认** 状态，因此不会有人因同一个问题被呼叫两次；一旦其数据恢复，它也会自行恢复。
- 它的动态和 **数据** 卡片会说明是哪个警报导致了它，并且它会加入原因所在的片段。

原因的 **数据** 卡片会列出它的 **下游影响**：它导致的每个警报。表警报的卡片还会显示写入该表的服务，以及这些服务失败的写入、它们在警报前一天内的部署和其他更改。

## 更改合并之前

当拉取请求更改了受监视的表时，[Production Review](/docs/ai/ai-agent) 会在该拉取请求上说明有哪些内容依赖于它：读取它的服务、由它构建的表、基于它的仪表板，以及它的数据产品。如果表在标记为预发布的数据库上有副本，它还会说明副本有何不同：行数、列，以及该表的检查在那里读取到的内容（当场运行）。对于只有探测器才能访问的数据库，检查会被省略，并会说明这一点。

## 后续步骤

:::cards
- [数据产品](/docs/data-observability/data-products): 针对人们使用的表的新鲜度 SLA。
- [OneUptime AI 与 API](/docs/data-observability/ai-and-api): 从表的写入方和运行开始的调查。
:::
