# 表健康

每五分钟，每个已连接数据库的目录都会说明每个表的状况：它最后一次更改的时间、包含多少行、有多大，以及它有哪些列。数据可观测性据此学习每个表的节奏，并在表延迟、缩小或结构改变时告诉你，无需设置任何阈值。

## 读取的内容

对每个表和视图：

- **行数和大小**，来自引擎自身的统计信息。
- **最后一次更改的时间**：如果引擎自己记录了时间，就用该时间；否则就是两次采集之间其写入计数器、行数或字节数发生变化的时刻。
- **它的列**，包括列的类型以及是否可以为空。
- **最后一次被读取的时间**，前提是引擎会统计读取。

只读取目录。不读取任何一行，也没有任何值离开数据库。

## 新鲜度

表的 **节奏** 是指它通常多久更改一次，从它各次更改之间的时间间隔中学习得出。远远超出节奏的表会在它的页面和 **表** 中显示为 **Late**，并写入超出了多久。表更改两次后，就能知道它的新鲜度：每小时加载的表在几小时内就能学会，每晚加载的表在几天内就能学会。

视图本身不包含行，因此它的新鲜度就是其来源的新鲜度：请参阅 [血缘与管道](/docs/data-observability/lineage-and-pipelines)。

## 数据量和架构变更

- **行** 会在两次采集之间进行比较：丢失一半行的表，或者行数远少于每周该时段通常水平的表，都会如实报告。
- **列** 也会进行比较。新增、删除、重命名、更改类型或改为可为空的列，会记录在该表的 **时间线** 和 **架构变更** 上，后者按从新到旧列出每个数据库的每次变更。
- **被删除的表** 会保留在 **已删除的表** 下，并显示它们最后一次出现的时间；如果该表重新出现，它会连同历史记录一起恢复。

## 推荐的警报

在 **数据库** 上，为某个数据库选择 **Recommended Alerts**。每项推荐都是覆盖整个数据库的一个指标监视器，每个表警报一次，因此以后创建的表也会受到监视：

| 警报 | 触发条件 |
| --- | --- |
| **Table Is Late** | 表超出其通常的更改时间已持续十五分钟 |
| **Row Count Fell Sharply** | 表在两次采集之间丢失一半或更多的行 |
| **Row Count Unusually Low** | 表的行数远少于每周该时段的通常水平（基于两周的数据学习） |
| **Schema Changed** | 表的列被新增、删除、重命名或更改类型 |
| **Table Health Stopped Reporting** | 该数据库的任何表都已十五分钟没有被读取 |

在创建时选择严重程度、值班策略、所有者和标签。此后它们就是普通的监视器：可以像其他监视器一样编辑、静音，或放到状态页上。

## 每个表写入的指标

每次采集都会为每个表写入这些指标，因此你可以像对待任何其他指标一样，为它们绘制图表、放到仪表板上并据此发出警报：

| 指标 | 含义 |
| --- | --- |
| `oneuptime.data.table.row_count` | 表中的行数 |
| `oneuptime.data.table.size` | 表及其索引占用的字节数 |
| `oneuptime.data.table.seconds_since_change` | 自表最后一次更改以来的秒数 |
| `oneuptime.data.table.overdue_seconds` | 表超出其通常更改时间的秒数；按时时为 0 |
| `oneuptime.data.table.row_count_change_percent` | 与上一次采集相比行数变化的幅度，以百分比表示 |
| `oneuptime.data.table.schema_changes` | 自上一次采集以来发生变化的列数 |

每条指标记录都带有 `oneuptime.data.store.id`、`oneuptime.data.store.name`、`oneuptime.data.table.id`、`oneuptime.data.table.schema`、`oneuptime.data.table.name` 和 `oneuptime.data.table.key`（`schema.table`）。按 `oneuptime.data.table.key` 分组的 [指标监视器](/docs/monitor/metrics-monitor) 会对每个表警报一次，它的 **Anomalously High** 和 **Anomalously Low** 筛选条件会把每个表与它自己在每周该时段的通常值进行比较。这些指标是 OneUptime 自身的运维数据，不按遥测计费。

## 未使用的表

每个统计读取的引擎都会说明每个表最后一次被读取的时间：PostgreSQL 的扫描、MySQL 的 performance_schema、SQL Server 的查找、扫描和键查找，以及 Redshift、ClickHouse 和 Databricks 的查询历史。在你的服务的数据库 Span 中看到的读取也会计入。

**未使用的表** 列出 90 天内无人读取的表，最大的排在前面，并显示每个表最后一次被写入的时间：仍在写入却从未被读取的表，白白耗费写入和存储成本。表在首次采集时计数器为 0，意味着自引擎的统计信息开始以来它从未被读取，因此未使用的表从一开始就会显示为未使用。

## 仓库支出

数据可观测性每小时读取每个 Snowflake 和 BigQuery 仓库在过去一天里逐个作业的支出：Snowflake 的计算积分来自 `QUERY_ATTRIBUTION_HISTORY`，BigQuery 的计费字节来自其作业视图，后者需要 **BigQuery Resource Viewer**。作业是反复运行的同一个查询，按其查询标签或 label，或按它做什么和写入的表来命名：绝不使用查询的文本。

**仓库支出** 显示按团队的合计（作业查询标签或 label 中的 `team`，否则为运行者）、写入成本最高的表、失败的作业，以及花在只写入 90 天内无人读取的表的作业上的支出。

## 使用每个表的服务

表的 **服务** 标签页列出观察到正在写入和读取它的服务，并附上每个服务运行的语句、过去一小时的调用和失败次数，以及最后一次出现的时间。这些信息来自你的服务已经通过 OpenTelemetry 发送的数据库 Span：带有 `db.system.name`、`db.namespace` 和 `db.collection.name` 的客户端 Span。无需额外安装任何东西。

只有当 Span 的数据库是某次采集读取过的数据库时，它才会关联到某个表；当两个数据库同名时，还要求它的 `server.address` 是其中之一的地址。

## 后续步骤

:::cards
- [检查与对账](/docs/data-observability/checks): 不仅关注表是否更改，还针对表中内容设定规则。
- [血缘与管道](/docs/data-observability/lineage-and-pipelines): 延迟的表的数据从哪里来，以及本应加载它的那次运行。
:::
