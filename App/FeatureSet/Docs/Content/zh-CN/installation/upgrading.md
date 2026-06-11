# 升级 OneUptime

本指南介绍如何安全地升级您的自托管 OneUptime 安装。

## 通用指南

- 跨主版本逐步升级（例如 6 → 7 → 8）。不要跳过主版本。
- 只要遵循发布说明，您可以跨越次要/补丁版本（例如 8.1 → 8.4）。
- 升级前务必做好备份，并验证可以从备份中恢复。

## 从 OneUptime 10 升级到 11

OneUptime 11 重构了 ClickHouse 遥测存储。本节说明有哪些变化、哪些用户需要采取行动，以及——对于希望保留历史遥测数据的安装——完成迁移所需的全部查询语句。

### v11 中有哪些变化

遥测数据（日志、链路追踪、指标、异常、性能剖析、监控日志、审计日志）将迁移到新的 ClickHouse 表中，新表采用基于时间的分区、按列设置的压缩编解码器，以及新的实体模型列：

| 旧表                  | 新表                  |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

所有遥测表上有两列被重命名：`serviceId` → `primaryEntityId`，`serviceType` → `primaryEntityType`。这是硬性重命名——**如果您直接调用 OneUptime 分析 API 并使用 `serviceId`/`serviceType` 过滤条件，请将其更新为新的列名。** OneUptime 内部的仪表盘、监控器和告警会自动迁移。

此次切换是**仅向前生效**的：新表初始为空，升级后摄入的所有遥测数据会立即写入新表，历史数据则随着时间推移自然回填。旧表会被保留，并通过其保留期 TTL 逐步自行删除。

### 哪些用户需要采取行动

- **全新安装：** 无需任何操作。
- **升级后不需要在界面中查看升级前遥测数据的安装：** 无需任何操作。遥测页面只会显示从升级时刻起的数据；更早的数据会在旧表中悄然过期清除。
- **升级后希望看到升级前遥测数据的安装：** 在升级完成后的任意时间，执行下面的手动复制操作。

一如既往：主版本请逐级升级（10 → 11，不要跳级），并在升级前备份 Postgres 和 ClickHouse。

### 可选：保留遥测历史数据

请在**升级完全启动完成后**再执行以下操作（新表及其物化视图必须已存在）。直接在您的 ClickHouse 主机上连接——原生协议没有 HTTP 超时限制，因此运行数小时的语句也没有问题：

```bash
clickhouse-client --database oneuptime
```

开始之前需要了解的事项：

- 复制操作可以在 OneUptime 运行期间安全执行。新的遥测数据会独立写入新表；复制的历史数据在其后逐步回填。
- 在大规模数据量（数百 GB）下，预计耗时数小时。
- 下面的每条语句都带有 `insert_deduplication_token`，且新表自带去重窗口——因此**中途失败的语句重新执行是安全的**（已插入的数据块会被跳过，包括指标汇总表中的数据块），前提是您在合理时间内尽快重试。在高强度实时摄入的情况下，去重窗口（每表最近 10,000 个插入块）最终会淘汰旧的 token。
- 复制指标数据时会自动重建仪表盘所用的预聚合汇总数据（每条复制的行都会重新触发汇总物化视图）——这使得指标复制比其他表更慢；请最后执行。

#### 第 1 步 — 列出源表分区

每张旧表最多有 16 个分区。对每张源表执行：

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### 第 2 步 — 生成复制语句

不同安装之间的列集合可能略有差异（较旧的部署可能缺少近期新增的列），因此请基于您的实时 schema 生成语句，而不要照搬固定语句。将 `WITH` 子句中的 `src` 和 `dst` 设置为上表中的某一对表名，然后执行：

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

生成的语句只复制两张表共有的列（新增列取其默认值），即时完成 `serviceId`/`serviceType` 的重命名，按确定性顺序排列行以确保重试时产生完全相同、可去重的数据块，并解除此类大规模语句所需的执行时间和分区数量限制。

#### 第 3 步 — 逐个分区执行

取生成的语句，将其中的 `{PARTITION}`（出现两次——一次在 `WHERE` 中，一次在 token 中）替换为第 1 步得到的每个分区 ID。逐条执行这些语句，然后对每一对表重复第 1–3 步。

如果某条语句中途失败，请尽快重新执行**同一条**语句——已提交的数据块会自动去重。如果间隔很久才重试，请先比对行数（第 5 步）。

#### 第 4 步（可选）— 按主机的指标汇总历史数据

复制的原始指标行会自动重建服务级汇总数据，但不会重建**按主机**的汇总数据（旧行没有主机实体键）。升级过程特意保留了旧的按主机汇总表，以便您将其迁移过来，并根据主机名计算新的键：

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

#### 第 5 步 — 验证

逐对比较两张表的总行数（新表还包含升级后写入的行，因此其行数应大于或等于旧表）：

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### 第 6 步（可选）— 提前回收磁盘空间

旧表会通过 TTL 自行清空，但当您确认复制结果无误后，可以立即删除它们：

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
```

> 提示：与每次主版本升级一样，请先在预发布环境中测试，并在生产环境依赖复制结果之前，确认遥测数据正在正常写入新表。



## 从 OneUptime 9 升级到 10

没有需要手动操作的变更。按照标准升级流程操作即可。

## 从 OneUptime 8 升级到 9

Helm 图表不再配置 Kubernetes Ingress 资源。OneUptime 内置了一个 ingress 网关容器，该容器已经负责终止 TLS、管理状态页面域名并路由平台流量，因此不再需要集群 ingress 控制器。

- 在升级前，从您的自定义 `values.yaml` 文件中删除所有 `oneuptimeIngress` 覆盖项。这些键现在已被忽略，如果保留会导致验证错误。
- 确保 `nginx.service.type` 反映您希望暴露捆绑的 ingress 网关的方式（例如 `LoadBalancer`、`NodePort`，或带有外部负载均衡器的 `ClusterIP`）。
- 验证状态页面或主机的所有 DNS 记录是否仍指向 OneUptime ingress 网关前端的 Service 或负载均衡器。
- 升级后，确认 TLS 证书通过嵌入式网关继续续期，并且状态页面域名可正常解析。


## 从 OneUptime 7 升级到 8

如果您在 Kubernetes 上运行，存在重要的破坏性变更：

- 我们不再使用 Bitnami 图表用于 Postgres、Redis 和 ClickHouse，原因是 [Bitnami 许可证变更](https://github.com/bitnami/charts/issues/35164)
- 这些变更不向后兼容。您必须遵循 Helm 图表 `values.yaml` 中的新结构。
- 在升级前备份您的数据（Postgres、ClickHouse 和任何持久化卷）。


> 提示：先在预发布环境中测试升级。在升级生产环境之前，确认您的工作负载健康且数据完整。
