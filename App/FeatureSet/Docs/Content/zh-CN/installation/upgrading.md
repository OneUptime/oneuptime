# 升级 OneUptime

本指南介绍如何安全地升级您的自托管 OneUptime 安装。

## 通用指南

- 跨主版本逐步升级（例如 6 → 7 → 8）。不要跳过主版本。
- 只要遵循发布说明，您可以跨越次要/补丁版本（例如 8.1 → 8.4）。
- 升级前务必做好备份，并验证可以从备份中恢复。

## 从 OneUptime 10 升级到 11

OneUptime 11 重建了 ClickHouse 遥测存储。本页说明发生了哪些变化、谁需要采取行动,以及——对于想保留历史遥测数据的安装环境——完成迁移所需的每一条查询。

### v11 中的变化

遥测数据(日志、链路追踪、指标、异常、性能分析、监控日志、审计日志)迁移到新的 ClickHouse 表,新表采用基于时间的分区、按列压缩编解码器以及新的实体模型列:

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

所有遥测表中有两列被重命名:`serviceId` → `primaryEntityId`,`serviceType` → `primaryEntityType`。这是硬性重命名——**如果你直接使用 `serviceId`/`serviceType` 过滤条件查询 OneUptime analytics API,请更新为新名称。** OneUptime 内部的仪表盘、监控器和告警会自动迁移。

此次切换**只向前进行**:新表从空开始,升级后摄入的所有遥测数据会立即写入新表,历史数据随时间自然回填。旧表会在升级过程中**自动删除**以回收磁盘空间——如果你想保留迁移历史数据的选项,请在升级**之前**重命名它们(见下方第 0 步)。

> **已经在使用 11.0.0 或 11.0.1?** 这些版本会保留旧表(它们通过 TTL 逐渐清空,复制可以"升级后随时"执行)。之后的任何更新都会**在启动时删除它们**。如果你仍想进行历史数据复制且尚未完成,请在应用更新之前执行下方的第 0 步。

### 谁需要采取行动

- **全新安装:** 无需任何操作。
- **界面中不需要升级前遥测数据的升级:** 无需任何操作。遥测页面只显示升级时刻之后的数据;旧表会在升级过程中被删除。
- **希望看到升级前遥测数据的升级:** 在升级**之前**重命名旧表(见下方第 0 步),然后在升级后随时执行手动复制。

一如既往:主版本要逐级升级(10 → 11,不要跳级),并在升级前备份 Postgres 和 ClickHouse。

### 可选:迁移遥测历史数据

第 0 步在**升级之前**执行;从第 1 步开始的所有操作都在**升级完全启动之后**执行(新表及其物化视图必须已存在)。请直接在 ClickHouse 主机上连接——原生协议没有 HTTP 超时,因此运行数小时的语句也没有问题:

```bash
clickhouse-client --database oneuptime
```

开始之前需要了解:

- 复制可以在 OneUptime 在线运行时安全执行。新的遥测数据独立写入新表;复制的历史数据在其后填充。
- 大规模数据(数百 GB)预计需要数小时。
- 下面每条语句都带有 `insert_deduplication_token`,且新表自带去重窗口——因此**重新运行中途失败的语句是安全的**(已插入的块会被跳过,包括指标汇总中的块),前提是尽快重试。在高强度实时摄入下,窗口(每表最近 10,000 个插入块)最终会淘汰旧令牌。
- 复制指标还会自动重建预聚合的仪表盘汇总(每条复制的行都会重新馈入汇总物化视图)——这使得指标复制比其他复制更慢;请最后执行。

#### 第 0 步——升级前重命名旧表

升级会在启动时删除旧表,所以请先把你要作为复制来源的表移出它的作用范围。停止 OneUptime(将部署缩容到零),确保没有任何进程写入或能重建这些表,然后重命名——`RENAME TABLE` 是瞬时的元数据操作,`IF EXISTS` 让整个语句块跳过你的安装环境从未有过的表(早于 10.0.x 中期的部署可能没有 `AuditLogV1` 或某些 `…V2` 表——那就没有该类型的历史数据可复制):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

然后执行升级,等 OneUptime 完全启动后再继续。

> 如果在重命名后回滚到 v10(v10 启动时会用旧名称重建空表),请在重启 v10 之前把 `_backup` 表改回原名——否则回滚期间摄入的遥测数据会进入重建的表,并在之后的升级中被删除。

#### 第 1 步——列出来源分区

每张旧表最多有 16 个分区。对每张来源表执行:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### 第 2 步——生成复制语句

不同安装环境的列集合可能略有差异(较旧的部署可能缺少最近新增的列),因此请基于你的实际 schema 生成语句,而不是照搬固定语句。把 `WITH` 子句中的 `src` 和 `dst` 设置为上表中的一对表(来源表带有第 0 步的 `_backup` 后缀),然后运行:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
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

生成的语句只复制两张表共有的列(新列取默认值),即时重命名 `serviceId`/`serviceType`,对行进行确定性排序以便重试产生完全相同、可去重的块,并解除这种规模的语句所需的执行时间和分区数量限制。

#### 第 3 步——逐个分区执行

取生成的语句,将 `{PARTITION}`(出现两次——在 `WHERE` 和令牌中)替换为第 1 步得到的每个分区 id。逐条执行语句,然后对每对表重复第 1–3 步。

> 注意:如果某张来源表因在你的安装环境中不存在而在第 0 步被跳过,该表对的第 1 步会以 `UNKNOWN_TABLE` 失败——直接跳过该表对即可;没有该类型的历史数据可复制。

如果语句中途失败,请尽快重新运行**同一条**语句——已提交的块会被去重。如果间隔很久才重试,请先比较行数(第 5 步)。

#### 第 4 步(可选)——按主机的指标汇总历史

复制的原始指标行会自动重建服务级汇总,但不会重建**按主机**的汇总(旧行没有主机实体键)。第 0 步重命名的旧汇总表是这部分历史的唯一来源;通过从主机名计算新键来迁移它:

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
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

`ORDER BY` 很重要:它确保重试产生完全相同的插入块,从而能被去重令牌识别。没有它,重试可能被悄悄跳过或重复计数。(边缘情况:包含 `\`、`|` 或 `=` 的主机名——这些不是合法的 RFC 1123 主机名字符——计算出的键会与应用程序不同;除非你确定有这样的主机,否则可以忽略。)

#### 第 5 步——验证

按表对比较总数(新表还包含升级后的行,因此应大于或等于旧表):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### 第 6 步——删除备份表

重命名后的表保留其保留期 TTL,因此会自行清空和收缩——但一旦你对复制结果满意,就删除它们以立即回收磁盘:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` 仅为该条语句解除服务器 50 GB 的删除保护。)

> 提示:与所有主版本升级一样,请先在预发布环境中测试,并确认遥测数据正流入新表,再在生产环境中依赖复制结果。

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
