# OneUptime AI 与 API

OneUptime AI 了解你的数据：它从表的写入方、运行和血缘出发调查数据警报，无论在哪里被问到都能回答某个表是否新鲜、由什么构建，还能根据用一句话说出的规则编写检查。数据可观测性显示的一切，也都可以通过它的端点、指标和 MCP 服务器提供给你自己的工具。

## OneUptime AI

- **数据警报的调查。** 当 OneUptime AI 调查某个表、管道或数据库上的警报时，它会从与之相邻的内容入手：表的新鲜度和打开的警报、导致这个警报的那个警报、自前一天以来写入该表的管道的运行（带有错误的失败运行，或者从未到来的运行）、写入该表的服务及其失败的写入、部署和其他更改、该表的血缘（构建该表的表和由该表构建的表，有问题的排在前面，以及导致这个警报的那个警报在其中的位置、它引发的警报位于哪些表上），以及发生变化的列。它会指出警报背后的运行、部署或上游表。请参阅 [AI SRE](/docs/ai/ai-sre)。
- **这个表新鲜吗？** 在 [询问 AI](/docs/ai/ask-ai)、Slack 或 Microsoft Teams 中提问：“orders 表新鲜吗？”。答案会给出按表自身节奏判断的新鲜度、它最后一次更改的时间、打开的警报、写入方的最新运行，以及它所属的数据产品。多个数据库共用的名称会针对每个数据库分别回答，因此不会有人被告知错误的表是新鲜的。
- **这个表是由什么构建的？** 提问：“什么在给 revenue 表供数？”或“如果 raw.orders 停止加载，什么会坏掉？”。答案会沿着表的血缘每个方向走三步，按要求最多五步，并把有问题的放在前面：延迟、被删除、有打开的警报或其管道上次运行失败的上游和下游表，由近及远，每张表都附上相隔几步以及中间的表。然后是其余的表、从 OneUptime 监视范围之外加载其来源的管道，以及基于它构建的 BI 仪表板。打开的警报只计数、从不点名，并且只计入提问者可以看到的警报。
- **用一句话编写检查。** 在表的 **检查** 标签页上，**用一句话编写检查** 会把一条规则转换成使用你的引擎 SQL 的自定义 SQL 检查。请参阅 [检查与对账](/docs/data-observability/checks)。

- **缓慢漂移。** 表的行数或检查的值在一周内变化了五分之一或更多，但变化太慢、不足以触发任何警报时，会作为一条值得留意的提示送到 AI 洞察。它不会呼叫任何人。
- **AI 应用背后的过时数据。** 既调用模型又读取某个表的服务，就是该表的 AI 使用方。当这样的表延迟时，AI 产品的 **对话** 页面会指出这一点：用旧数据作答的应用，在它自己的追踪中看不出任何问题。

这些功能都需要为项目开启 OneUptime AI，并以提问者的权限执行操作。

## AI 代理和 MCP 服务器

AI 代理应该在使用数据之前先检查数据是否新鲜，并在更改某个表之前先查看由它构建了什么。[MCP 服务器](/docs/ai/mcp-server) 为此提供了只读工具：

| 工具 | 它回答什么 |
| --- | --- |
| `get_data_table_freshness` | 受监视的表是否新鲜、它最后一次更改的时间、打开的警报、写入方的最新运行，以及它的数据产品。`table` 可以是 `schema.table`、单独的表名或表的 ID |
| `get_data_table_lineage` | 受监视的表由什么构建、由它构建了什么，每个方向三步，最多五步：先列出有问题的表，由近及远，然后是其余的表、从外部加载其来源的管道，以及基于它构建的 BI 仪表板。`table` 的写法与查询新鲜度相同，`depth` 为 1 到 5 |

两者都可以使用只读登录工作，并以登录的用户或 API 密钥的身份回答。

## 端点

| 端点 | 用途 | 签名方式 |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | 来自 Airflow、Dagster、Spark、dbt 或 Flink 的 OpenLineage 事件 | 遥测摄取密钥 |
| `POST /telemetry/dbt/v1/artifacts` | dbt 构建的 `manifest` 和 `run_results` | 遥测摄取密钥 |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetran 的同步 webhook | 摄取密钥，作为 Fivetran 的签名密钥 |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbyte 的同步 webhook | URL 中的摄取密钥 |
| `POST /api/data-observability/tables/freshness` | 表的新鲜度，与 MCP 工具的回答相同，请求体为 `{ "table": "public.orders" }` | API 密钥 |
| `POST /api/data-observability/tables/lineage` | 表在每个方向上几步的血缘，以及每张表的当前状态，与其 **血缘** 标签页所画的相同，请求体为 `{ "dataAssetId": "<table ID>", "depth": 3 }`，加上 `"withColumns": true` 还会返回每个箭头承载的列 | API 密钥 |
| `POST /api/data-observability/tables/lineage/answer` | 用文字讲述的表的血缘，有问题的表在前，与 MCP 工具的回答相同，请求体为 `{ "table": "public.orders", "depth": 3 }` | API 密钥 |
| `POST /api/data-observability/pipelines/lineage` | 管道读取和写入的表，以及每张表的当前状态，与其页面所画的相同，请求体为 `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | API 密钥 |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | 数据警报的血缘，以及通往导致它的警报和它导致的警报的路径，与其页面所画的相同 | API 密钥 |
| `POST /api/data-observability/lineage/expand` | 血缘图中某张卡片未绘制的下一批表，与选择其数字时画出的相同：用 `nodeId` 及其 `side` 指明卡片，用 `focusNodeId`、`tables` 和 `dataDashboardIds` 指明已画的内容 | API 密钥 |
| `POST /api/data-observability/checks/apply` | 让项目的检查与一个文件一致，与 `oneuptime data-checks apply` 的作用相同，请求体为 `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | API 密钥 |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | 数据产品的“data as of”徽章 | 徽章自己的令牌 |

表、检查、对账、管道、数据产品、BI 连接和数据仓库作业也是 [API](/docs/api-reference/api-reference) 中的普通资源，可以使用拥有相应权限的 API 密钥读取和更改，也可以通过 MCP 服务器和工作流使用。

## 指标

数据可观测性保存的每个数字都是一个指标，你可以为它绘制图表、放到仪表板上或据此发出警报：每个表的 `oneuptime.data.table.*`、每个检查的 `oneuptime.data.check.value`、每个对账的 `oneuptime.data.reconciliation.*`、每个管道的 `oneuptime.data.pipeline.*`，以及每个数据产品的 `oneuptime.data.product.*`。它们是 OneUptime 自身的运维数据，不按遥测计费。

## 后续步骤

:::cards
- [MCP 服务器](/docs/ai/mcp-server): 将 AI 代理连接到 OneUptime。
- [数据可观测性](/docs/data-observability/index): 返回概览。
:::
