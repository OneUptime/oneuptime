# 容量规划与配置选型

本指南帮助你在 Kubernetes（Helm）上为自托管的 OneUptime 部署进行容量规划。它涵盖 OneUptime 依赖的三个数据存储——**PostgreSQL**、**Redis** 和 **ClickHouse**——以及应用计算资源，并给出可在掌握真实数据后再调整的起始档位。

> **请先阅读：** Helm chart 发布时**未设置任何 CPU/内存的 requests 或 limits**，并为 PostgreSQL 和 ClickHouse 配置了较小的 **25 Gi** 默认卷。这些默认值的存在是为了让 chart 能在任何集群上安装并运行——它们**并非**生产环境的容量配置。对于超出快速试用范围的任何场景，请使用下面的数字显式设置资源和存储。

如果你改用单服务器 Docker Compose 安装，配置选型会更简单——参见 [Docker Compose](/docs/installation/docker-compose)（推荐：16 GB RAM、8 核、400 GB 磁盘）。

## 各数据存储的规模驱动因素

OneUptime 在生产环境中需要三个数据存储。它们的规模取决于完全不同的输入，因此应独立进行配置选型。

| 数据存储 | 存储内容 | 规模驱动因素 |
| --- | --- | --- |
| **ClickHouse** | 全部遥测数据——日志、指标、追踪、异常、性能剖析 | 遥测**写入速率 × 保留期**。这约占你存储的 ~95%，是主要成本来源。 |
| **PostgreSQL** | 配置与状态——监控器、事件、告警、用户、团队、项目、工作流、状态页、仪表盘 | **实体数量与历史记录**，而非遥测量。增长缓慢。 |
| **Redis** | 缓存、工作队列和会话 | **队列深度与活跃会话数**。受内存约束且规模适中。不是数据真实来源。 |

对象存储（S3/MinIO）**不是** OneUptime 运行的必需项。它仅可选地用于数据库**备份**（PostgreSQL 通过 CloudNativePG Barman 插件，ClickHouse 通过 `clickhouse-backup`）。OneUptime 不会将遥测数据分层存储到对象存储——参见下文的“保留期及其对存储的影响”一节。

## ClickHouse——主要驱动因素

你几乎所有的存储以及很大一部分 RAM 都会用于 ClickHouse，因为每一条日志行、指标点、追踪 span 和异常都存放在这里。

### 存储计算公式

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

压缩率取决于信号类型：

- **日志**压缩效果好——大致为 **5:1**。
- **指标**压缩效果较差——大致为 **2:1**——而且高标签**基数**会比原始数据量更快地膨胀磁盘和 RAM。请保持标签为低基数。
- **追踪**介于两者之间，取决于 span 属性。

### 实例计算

一个由 **10 个集群**组成的集群群，每个集群约 10 个节点 / 约 100 个 pod，以 INFO 级别的详细程度运行，在 30 天内**每个集群大约产生 50–150 GB 的原始日志**（≈ 每个集群每天 1.7–5 GB）。在整个集群群范围内，加上指标和追踪并经过压缩后，预算大约为**每天 5–15 GB 的压缩遥测数据**。

| 保留期 | 单副本 | 2 副本 + 30% 余量 |
| --- | --- | --- |
| 30 天 | ~150–450 GB | **~0.4–1.2 TB** |
| 90 天 | ~0.45–1.35 TB | **~1.2–3.5 TB** |

存储**随保留期线性增长**——90 天窗口的成本约为 30 天窗口的 ~3 倍。

### RAM 与磁盘类型

- **使用 NVMe/SSD。** 遥测写入密集，并伴有突发的聚合读取；运行在机械磁盘上的 ClickHouse 会力不从心。
- **为 ClickHouse 配置充足的 RAM。** 聚合查询是内存密集型的。作为经验法则，将 RAM 配置为你*热*（近期查询过）的压缩数据集的一个有意义的比例（25–50%），对于任何真实的生产集群群，实际下限为 16 GB。
- **管控指标基数。** 它是同时影响 ClickHouse RAM 和磁盘的最大单一杠杆。在采集层强制执行低基数标签规范，并关注活跃序列数。

## PostgreSQL——配置与状态

PostgreSQL 存储你的配置和运行状态，而非遥测数据，因此它增长缓慢，相对于 ClickHouse 保持较小规模。即使是大型部署通常也只在数十 GB 量级。默认的 **25 Gi** 卷对于小型安装没有问题；对于较大型的部署，规划 50–100 GB 并为事件/告警历史预留余量。

如果你运行了许多应用、worker 和探针副本，数据库连接数可能在存储之前就成为瓶颈。OneUptime 的 Helm chart 包含一个可选的 **PgBouncer** 连接池（`pgbouncer.enabled`），正是为此而设——为高副本数部署启用它。

## Redis——缓存、队列与会话

Redis 用作缓存、工作队列和会话存储。它**受内存约束**，并且默认**禁用持久化**（这里的 Redis 不是数据真实来源——它可以被重建）。按预期的队列深度和并发会话数来配置；2–8 GB 内存可覆盖大多数部署。注意默认的逐出策略为 `noeviction`，因此如果队列在持续过载下积压，请监控 Redis 内存。

## 应用计算资源

除数据存储之外，还需为无状态工作负载（ingress、web/API、worker 和探针）进行配置选型。它们全部默认为 **1 个副本**且无资源限制——请显式设置它们。chart 捆绑了 **KEDA**，使 worker 和探针可以根据队列深度自动扩缩容；对于负载多变的场景请启用它。worker 随遥测/写入处理量扩缩，探针随活跃监控器的数量扩缩。

## 起始档位

选择最接近你环境的档位作为起点，然后观察实际使用情况（`kubectl top pods`、ClickHouse/Postgres 磁盘增长）并进行调整。

- **小型 / PoC** —— 1–3 个集群，≤30 个节点，≤5 GB/天原始遥测，30 天保留期。
- **中型 / 生产集群群** —— 约 10 个集群，约 100 个节点，10–30 GB/天原始遥测，30–90 天保留期。
- **大型 / 多集群群** —— 50+ 个集群，500+ 个节点，100+ GB/天原始遥测，90 天保留期。

| | 小型 / PoC | 中型 / 生产集群群 | 大型 / 多集群群 |
| --- | --- | --- | --- |
| **ClickHouse** | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe，**分片** |
| **PostgreSQL** | 2 vCPU / 4 GB / 50 GB SSD | 4 vCPU / 8 GB / 100 GB SSD | 8 vCPU / 16–32 GB / 250 GB SSD（+ PgBouncer） |
| **Redis** | 1 vCPU / 2 GB | 2 vCPU / 4 GB | 4 vCPU / 8–16 GB |
| **假定保留期** | 30 天 | 30–90 天 | 90 天 |

这些是为 OneUptime **后端**进行的配置选型。在每个被监控集群上运行的 OneUptime 采集器需要单独进行配置选型——参见 [Kubernetes Agent](/docs/telemetry/kubernetes-agent) 的配置档位。

## 高可用

chart 内置的数据存储默认以**单实例**运行。对于生产环境的高可用：

- **PostgreSQL** —— 启用捆绑的 [CloudNativePG](https://cloudnative-pg.io) operator（`postgresOperator.cnpg.enabled`），配置 **3 个实例**（1 个主节点 + 2 个热备）以实现自动故障转移。
- **ClickHouse** —— 启用捆绑的 [Altinity](https://github.com/Altinity/clickhouse-operator) operator（`clickhouseOperator.altinity.enabled`），配置**每个分片 ≥2 个副本**以及 **3 个 ClickHouse Keeper** 节点以形成法定人数。一旦单个节点的磁盘或 RAM 成为限制，就增加分片。
- **Redis** —— chart 内不提供副本机制。要实现高可用，请将 OneUptime 指向**外部托管的 Redis**（或 Sentinel/集群部署）。

## 保留期及其对存储的影响

遥测保留期作为**以天为单位配置的 ClickHouse TTL** 强制执行，**按项目**设置，并可**按信号**（日志、指标、追踪、性能剖析）以及按桶（例如按日志严重程度）进行细化。硬编码的默认值为 15 天。

由于保留期直接成倍影响 ClickHouse 存储，请在配置磁盘之前先确定它。OneUptime **不会**自动将旧遥测数据归档或分层到对象存储——对于多年期的合规保留，请延长保留窗口并相应地配置 ClickHouse 存储（或导出到你选择的外部归档）。

## 在投入之前先度量

遥测量会随应用日志详细程度、命名空间数量、抓取间隔以及是否在任何地方启用了 DEBUG 日志而发生巨大变化。请将上面的档位视为起点：**对你的环境进行至少四周的检测**，度量每个信号实际的 GB/天，然后基于真实数据来配置保留期和存储。

## 相关链接

- [Docker Compose](/docs/installation/docker-compose) —— 单服务器配置选型
- [Self-Hosted Architecture](/docs/self-hosted/architecture) —— 各组件如何协同工作
- [Kubernetes Agent](/docs/telemetry/kubernetes-agent) —— 采集器（数据平面）配置选型
- [Helm chart on Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)
