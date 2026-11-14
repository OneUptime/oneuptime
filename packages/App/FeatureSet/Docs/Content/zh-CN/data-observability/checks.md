# 检查与对账

表健康说明表是否在更改。**检查** 说明表中保存的内容是否正确，**对账** 说明数据的两个副本是否一致，**dbt 的测试** 则报告 dbt 构建的表的情况。它们都在数据库的采集运行的地方运行（由 OneUptime 或其探测器执行），离开数据库的只有一个数字，除非项目选择保留失败行的带遮盖样本。

## 检查

在表的 **检查** 标签页上添加检查：

| 检查 | 读取的内容 |
| --- | --- |
| **NULL 占比** | 该列为空的行所占的百分比 |
| **重复占比** | 与其他行的值重复的值所占的百分比 |
| **去重计数** | 该列包含多少个不同的值 |
| **最小值**、**最大值**、**平均值**、**总和** | 数值列的相应值（没有行时总和为 0） |
| **无效值占比** | 不在你给出的列表中的值所占的百分比 |
| **格式不符占比** | 不在你选择的格式中的值所占的百分比，例如 Email、UUID 或 Country Code，或者不匹配你自己的正则表达式的值所占的百分比（SQL Server 和 Dataverse 以外的所有引擎） |
| **孤立行数** | 其值在另一个表的列中没有匹配项的行 |
| **行数** | 表中的行数，与 **分段依据** 搭配使用最有用 |
| **自定义 SQL** | 你的一条只读 SELECT 返回的、名为 `value` 的数字（在 MongoDB 中为聚合管道返回的数字） |
| **失败的行** | 你的一条只读 SELECT 返回多少行：即不应该存在的行。0 表示健康（在 MongoDB 中为管道最终得到的文档） |

每个检查每 15 分钟、每小时、每 6 小时或每天运行一次，作为一条聚合语句，在带有语句超时的只读事务中执行。它的值写入为 `oneuptime.data.check.value`，并带有 `oneuptime.data.check.id`、`oneuptime.data.check.name` 和 `oneuptime.data.check.segment`。

## 建议的检查

同一标签页上的 **建议的检查** 会仅根据列的名称和类型，提供表的列所需要的检查：id 是唯一的、`customer_id` 在 `customers` 中有匹配的行、电子邮件看起来像电子邮件、金额不是负数、状态保持其通常的值，以及按租户拆分的表按租户计数。数据安全知道其中保存的是电子邮件地址、电话号码或 IP 地址的列，无论它叫什么名字，都会按该格式检查。你可以添加一个、全部添加，或者永久隐藏某一个。

## 用一句话编写检查

**用一句话编写检查** 会把“订单的总额从不为负”这样的规则，用你的引擎自己的 SQL 转换成统计违反该规则的行的自定义 SQL 检查，并在有任何违反时发出警报。在用 **添加检查** 添加之前，你可以先阅读查询，它也受到与任何自定义 SQL 检查相同的所有限制。这需要为项目开启 OneUptime AI。在 MongoDB 上，结果是一个聚合管道。

## 分段

**分段依据** 会针对某一列的每个值（例如租户或区域）各运行一次检查：最大的 100 个分段各有一个序列和一个警报。分段的行数检查会在某个租户停止发送数据、而其他租户仍在继续发送时发出警报。

## 检查的警报

设置 **发出警报的条件** 以针对检查发出警报：

- **异常偏高** 或 **异常偏低** 会把每个值与它自己在每周该时段学习到的基线进行比较。
- **高于** 或 **低于** 会把它与阈值进行比较。

保存检查时，会以你的身份、按你的权限为它创建一个指标监视器。清除该条件会删除该监视器。

检查的 **状态** 会在 **检查** 页面和其所在表的 **检查** 标签页上说明它的情况：警报打开时为 **失败**，未打开时为 **已通过**，查询失败时为 **无法运行**。没有警报的检查只会显示 **已运行**，表示它的查询运行了。失败的检查以及无法运行的检查也会出现在 **概览** 上。

## 检查的成本

检查会与你的应用程序争用数据库，而在按查询读取量计费的数据仓库上，检查还会产生费用。有三个设置可以控制这一点：

- **采样百分比** 只读取一部分行，而不是全部行，适用于读取比率的检查：NULL 占比、平均值、无效值占比和格式不符占比。大多数引擎会跳过表的整页数据；MySQL、Redshift、ClickHouse 和 MongoDB 仍会读取每一行，只是省去了对其余行的处理。Dataverse 不进行采样：其上的检查会读取每一行。视图可能会拒绝该设置，检查会说明这一点。
- **设置** 下的 **单次检查最多读取量（GB）** 会在 BigQuery 或 Athena 上的检查读取超过该吉字节数之前将其停止。在你更改之前，它是 10。
- **设置** 下的 **数据库繁忙时等待** 会在 PostgreSQL、MySQL 或 SQL Server 数据库看起来繁忙时，把到期的检查留到下一次采集。它默认开启，直到你将其关闭，数据库会说明检查何时进行了等待。

## 失败的行

数字说明出了问题；几行数据则说明问题出在哪里。**设置** 下的 **保留失败的行** 会保留“失败的行”“无效值占比”“格式不符占比”或“孤立行数”检查发现的最多 20 行，检查上的 **失败的行** 会显示它们。此设置在你开启之前一直处于关闭状态。敏感列会在读取行的地方被遮盖，依据是数据安全在其中发现的内容或它们的名称，因此离开数据库或探测器的内容已经被遮盖。如果某个敏感列没有被任何扫描发现，名称也看不出来，它会按原样保留。

这些行存储在 OneUptime 中：使用 OneUptime Cloud 时存储在 OneUptime 的服务器上，使用自托管安装时存储在你自己的服务器上。能够读取项目检查的人都可以看到它们。每个检查只保留最后一次运行的行，关闭 **保留失败的行** 会删除每个检查保留的内容。

## 文件中的检查

手写的检查会与更改表的代码逐渐脱节。把它们保存在你的仓库中，在同一个拉取请求中一起审查：

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

从 CI 中使用 [OneUptime CLI](/docs/cli/index) 和 API 密钥应用它：

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

名称相同且位于同一个表上的检查就是同一个检查，因此把一个文件应用两次不会有任何更改。文件中任何地方出错，都不会应用任何内容，并以错误退出，因此请在拉取请求上运行 `--dry-run`，合并时再应用。使用 `--prune` 时，之前某次应用创建、而文件中不再提到的检查会被删除。你手动添加的检查则永远不会被删除。来自文件的检查会在其行上标明这一点，它的下一次应用会覆盖手动所做的更改。

键有 `name`、`table`、`database`、`type`、`column`、`segment`、`accepted_values`、`format`、`pattern`、`references`、`query`、`sample_percent`、`every`、`alert`、`description` 和 `enabled`。

## 对账

副本会出现偏差：数据仓库中的订单比应用程序的数据库少，或者一次迁移丢失了行。对账会在 **对账** 下比较两个表（位于同一个数据库或两个数据库中）的一个度量：

- **行数**
- 某一列的 **总和**
- 某一列的 **去重计数**
- **自定义 SQL**：一个返回名为 `value` 的数字的只读查询

它有一个容差：一个 **绝对值** 数量，或来源值的一个 **百分比**。每一端都由对账创建并维护的一个专属检查读取，并随其数据库的采集一起进行，因此对账可以把你网络中的 PostgreSQL 表与它在 Snowflake 中的副本进行比较。两个值都在彼此相隔 15 分钟以内被读取后，才会进行比较。对账会写入：

- `oneuptime.data.reconciliation.drifted`：两者的偏差超出容差时为 1，一致时为 0。它的监视器读取的就是这个值。
- `oneuptime.data.reconciliation.difference`：目标的值减去来源的值。
- `oneuptime.data.reconciliation.difference_percent`：该差值占来源值的百分比。

按计划加载的副本会落后于其来源：可以用自定义 SQL 比较两者都已稳定的度量，例如一小时以前的行，或者在容差中为延迟留出余量。

## dbt 测试

dbt 构建完成后，`oneuptime dbt upload` 会发送项目的构建产物（请参阅 [血缘与管道](/docs/data-observability/lineage-and-pipelines)）。之后，受监视的表的每个测试都会显示在该表的 **检查** 标签页上，并附上它的最新结果和它发现的失败行。选择 **失败时发出警报**，即可让失败的测试打开一个警报。

## 后续步骤

:::cards
- [血缘与管道](/docs/data-observability/lineage-and-pipelines): 发送 dbt 的构建产物，并查看失败的检查背后的运行。
- [数据产品](/docs/data-observability/data-products): 向使用数据的人承诺数据是新鲜的。
:::
