# 超大规模 OpenStack 云

在您安装任何东西之前，任何规模的云需要付出的开销：监控对其控制平面的压力有多大、发送多少数据，以及随着云的增长 OneUptime 会做出哪些不同的处理。几乎所有的云都应该不需要这些：按下面的数量计算，[OpenStack 代理](/docs/telemetry/openstack)和[探测器](/docs/telemetry/openstack-agentless)的默认设置无需任何调整，即可支撑数千个实例。

:::cards
- [对控制平面的负载](#对控制平面的负载): 各种规模下每项服务每分钟的请求数。
- [它发送的数据](#它发送的数据): 根据您云的数量得出的序列数和每天的 GB 数。
- [摘要模式](#摘要模式): 超过 5,000 个实例的云保留什么、放弃什么。
- [在多个收集器之间共享一个云](#在多个收集器之间共享一个云): 每个区域或每项服务一个代理。
- [数据库路径](#数据库路径): 从数据库读取最大的云。
- [最大规模经受的考验](#最大规模经受的考验): 200,000 个实例下的一小时，及其预算和测得的结果。
:::

## 对控制平面的负载

### 通过探测器

无论云有多大，探测器都保持在规定的负载之内。它一次向每项服务发出一个请求（Placement 为四个），在两次完整读取之间按变化读取实例，并且在超过规定数量后，把每项一次调用的内容（Hypervisor 的用量、路由器的代理、项目的配额）轮流读取。每次收集都把所有内容按上次读取的值发送，因此任何序列都不会出现空缺：变化的只是这些部分的新鲜程度。

默认设置下、收集稳定后，在使用 OVN 的云上每分钟的请求数：

| 云 | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 个 Hypervisor，100 个实例，20 个项目 | 1.3 | 3.5 | 12.5 | 3.5 | 2.5 | 0.3 |
| 500 个 Hypervisor，20,000 个实例，1,000 个项目 | 1.3 | 4.2 | 253 | 7.5 | 8.5 | 0.3 |
| 5,000 个 Hypervisor，200,000 个实例，10,000 个项目 | 1.3 | 12.7 | 1,003 | 43.5 | 62.5 | 0.5 |

这些数字是计数得出的，而不是估算的：测试会针对每种规模的模拟 API 运行真实的收集器，使用它自己拨动的时钟，并要求它发出的请求逐服务地与这些数字完全一致，包括在不同时间点到期的各项。请求数不取决于计数时所用的机器。

每种规模除 Hypervisor、实例和项目之外所含的内容是假设的，真实的云会有所不同：每隔一个实例有一个卷，每十个卷有一个快照和一个备份，每个项目有一个网络、子网、路由器和安全组，每十个实例有一个浮动 IP，40 个规格，每个 Hypervisor 有两个 Neutron 代理，每十个项目有一个镜像，介于 10 到 1,000 个之间。列表每一千行消耗一个请求，因此您的云实际包含的内容对这些数字影响很小。影响最大的是：

| 变化 | 开销 |
| --- | --- |
| 探测器启动后的第一次收集 | 无论有多少，每个 Hypervisor 的清单一次调用，用量一次调用 |
| 使用 ML2/OVS 而不是 OVN | 每个路由器一次调用，询问哪些 L3 代理持有它，每次收集最多 2,000 次 |
| 实例发生变化 | 每个发生变化的实例对 Nova 一次调用，读取它发生了什么，每次收集最多 25 次 |
| 开启[项目限额](/docs/telemetry/openstack-agentless#它对您的云有什么开销) | 每个项目四次调用，每次收集最多 250 个项目，因此一个有 10,000 个项目的云需要 80 分钟才能轮完一圈 |
| 降低收集频率 | 云的 **设置** 页面上的 **收集频率**。时间加倍，调用减半 |
| 更多区域 | 除 Keystone 外，每个区域再来一遍 |

一次收集拥有其间隔的十分之九，且最多十分钟，并且每项服务一次读取一个请求。因此大型云的 API 应答有多快，决定了它能多频繁地被收集：在 200,000 个实例和默认的两分钟下，Nova 必须在大约半秒内应答其完整读取的每一页，Cinder 必须在大约 0.8 秒内应答其列表。无法完成的服务在完成之前会显示为宕机，卡片会显示 **收集耗时过长**。请调高 **收集频率** 的间隔，这同样会降低负载，或者使用[数据库路径](#数据库路径)。

### 通过代理

代理的导出器在每次抓取时都会登录并完整读取每个列表，并且对每个 Hypervisor 一次一个调用地向 Placement 询问三件事。默认设置下每分钟的请求数：

| 云 | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 个 Hypervisor，100 个实例，20 个项目 | 3.4 | 3 | 15.5 | 3.5 | 2 | 0.2 |
| 500 个 Hypervisor，20,000 个实例，1,000 个项目 | 3.4 | 13 | 751 | 7.5 | 7.5 | 0.2 |
| 5,000 个 Hypervisor，200,000 个实例，10,000 个项目 | 3.4 | 106 | 7,501 | 43.5 | 57 | 0.4 |

这些数字是根据导出器的源码计算的，导出器尚未在这些规模下运行过。一次抓取有 110 秒，因此对于应答仅需 20 毫秒的 Placement，大约在 1,800 个 Hypervisor 时就会超时，而对于每页一秒的 Nova，大约在 110,000 个实例时超时。超过这些规模后，无论请求多么温和，对它们的抓取都会失败。超过这些规模，请使用[数据库路径](#数据库路径)或探测器。

### 当 API 变慢时

探测器会监视每项服务通常的应答用时，当某次应答很慢或被拒绝时就会退让：[对您的云的开销](/docs/telemetry/openstack-agentless#它对您的云有什么开销)说明了退让的幅度。多个同时等待的读取会轮流进行，因此暂停结束时不会出现突发。其他服务不会受到阻碍：每项服务各自独立询问。

云的 **数据收集** 卡片会在此期间逐服务说明：其最慢的应答有多慢，以及探测器退让了多久。代理的导出器做不到这一点。一次抓取按其间隔完整运行：请为该任务调高 `scrape_interval` 和 `scrape_timeout`，以减轻服务的负担。

## 它发送的数据

云的序列数由其数量决定。OneUptime 中 **OpenStack → 文档** 下的计算器可以根据三个数字算出结果。若要自己计算，对于一个区域：

| 序列 | 数量 |
| --- | --- |
| Compute | 每个 Hypervisor 10 个，加上规格和控制服务，再加 7 个 |
| Placement | 每个 Hypervisor 15 个，再加 4 个。探测器每个规格再增加约 2 个，用于[每种规格能容纳多少个](/docs/telemetry/openstack#容量) |
| Neutron | 代理、网络、路由器和浮动 IP，每个子网 3 个，再加 11 个。使用 ML2/OVS 时每个路由器再多一个 |
| Cinder | 服务、快照和备份，每个存储池 2 个，再加 26 个 |
| 实例和卷，未开启摘要模式时 | 每个实例 4 个，每个卷 2 个 |
| 摘要模式的计数，开启时 | 每个状态一个，每个项目一个：约 6 个加上项目数 |
| Keystone、Glance | 项目、域和 9 个，以及每个镜像 2 个再加 5 个。探测器为 Heat 和 Magnum 各增加 3 个，无论云是否运行它们 |

您的计费依据是每次抓取的行数：前五行每 2 分钟到达一次，每天 720 次，最后一行每 5 分钟一次，每天 288 次。价格就是您账单上的价格，[按每 GB 及保留时长计算](/docs/telemetry/data-retention#保留的成本)。账单读取的是每一行的真实大小，而这里按每行 1,024 字节计算，这是 OneUptime 在没有某一行大小时计费所采用的回退值。带有很多标签的行（例如实例的行）开销高于此，没有标签的行则低于此。

| 云 | 序列 | 每天 GB 数，所有序列 | 每天 GB 数，摘要模式 | 保留 15 天的一个月，摘要模式 |
| --- | --- | --- | --- | --- |
| 10 个 Hypervisor，100 个实例，20 个项目 | 1,084 | 0.7 | 不处于摘要模式 | $2.12 |
| 500 个 Hypervisor，20,000 个实例，1,000 个项目 | 123,856 | 84.5 | 16.6 | $49.71 |
| 5,000 个 Hypervisor，200,000 个实例，10,000 个项目 | 1,237,192 | 844.5 | 164.9 | $494.73 |

这些是通过代理得出的，假设每一千个实例中有一个处于需要保留其序列的状态。超过摘要规模的探测器，会每个周期发送一次未变化的内容，而不是每次收集都发送，因此在第二种规模下约为每天 13.2 GB，在第三种规模下为 116 GB。

来自 libvirt 或 Ceilometer 的每个实例的真实用量要额外计算：请参阅[开销](/docs/telemetry/openstack#开销)。

## 摘要模式

超过 5,000 个实例后，云只保留计数和行，而不再为每个实例保留一个序列。到了这个规模，这些序列占账单的大部分，约每天 17 GB，而其余所有内容只有 4 GB，而且它们所表达的内容，行和计数已经表达了。

**它保留什么：**

- 每个部分的一行，出现在每个页面和列表上，并保持最新。状态变化照常到达。
- Hypervisor、worker、网络、路由器、浮动 IP、地址池和存储池的所有序列。
- 每个区域的 `openstack_nova_instances_by_status` 和 `openstack_nova_instances_by_project`。
- 处于告警所监视状态的任何实例或卷的序列：处于 `ERROR`，或卡在 `BUILD`、`RESIZE`、`attaching` 等状态。因此每个[告警模板](/docs/monitor/openstack-monitor#预置警报模板)都继续工作，并继续自动恢复。

**它放弃什么：**

- 每个已稳定的实例和卷的状态历史，以及基于这些序列的图表或监控器。一个部分稳定后，`openstack_nova_server_status`、`openstack_cinder_volume_gb` 和 `openstack_cinder_volume_status` 就会停止。需要监控某个实例的监控器应选择它的项目，见下文。
- `openstack_placement_resource_provider_allocations` 和 `openstack_nova_server_local_gb`，无论它们属于谁。探测器完全不再向 Placement 询问分配情况。

**若仍要保留某个实例的序列**，请打开云的 **设置**，然后进入 **每个实例的真实用量**。**仅我选择的项目和聚合** 会保留这些项目的所有实例和卷，无论云有多大。**每个实例** 会为整个云关闭摘要模式。当每次收集的指标超过约 480 MiB 时，探测器会拒绝这样做，而不是把它们保存在内存中：这样的云请使用代理。

**通过探测器** 还有一点不同。超过摘要规模后，它每次都读取所有内容，但只发送发生变化的内容、有人选择的内容、告警所监视的内容，以及其余内容的一部分。每个部分每个周期轮到一次，其大小使一次收集的上传量在每次都发送的序列之外保持在约 24 MiB：在 20,000 个实例时是 6 分钟，在 200,000 个时是 44 分钟。**数据收集** 卡片会说明周期有多长。由此带来两点：

- **新云的列表会在第一个周期内逐步填满。** 第一次收集知道云里有什么，卡片会立即说明，但它的行是一部分一部分到达的。重启过的探测器也是如此，不过在此期间它留下的行仍然保留在页面上。卡片会说明它们何时会全部到达。
- **已经消失的部分会多保留一小段时间。** 它在没有任何内容报告它的 15 分钟后，加上一个周期，再加两次读取之内离开。因此在大多数云上是 15 分钟多一点，而在 200,000 个实例时略多于一小时。仍然存在的部分绝不会被移除。读取失败不会移除任何内容，无论持续多久。

## 在多个收集器之间共享一个云

无论有多少区域，一个代理都可以读取一个云，应当先从这里开始。当一个代理对其所在机器或一次抓取的时间而言负担过重时，让每个代理各负责一部分。它们都以相同的 `OPENSTACK_CLOUD_NAME` 发送到同一个 OneUptime 云。有两条规则可避免图表和账单重复计数：

- **每一对区域和服务只属于一个代理。** 无论有多少代理报告，一行都是同一行，但每个代理的序列都会被存储并计费。
- **Keystone 只属于一个代理。** 无论哪个区域询问，它对整个云都是同一个。

**每个区域一个代理** 是大多数云所需要的。在 `clouds.yaml` 和 `OPENSTACK_EXPORTER_CLOUDS` 中只列出该区域的条目。只有第一个代理保留 Keystone。设置了 `OPENSTACK_AGENT_SERVICES` 的代理只读取其中列出的服务，所以请添加云上运行的其他任何服务，例如 `load-balancer`：

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**每项服务一个代理** 适用于最大的云，其中某项服务的列表是一次抓取无法完成的原因。`OPENSTACK_AGENT_SERVICES` 保留它所列出的任务，其余的交给另一个代理：

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And the rest: add any other service you run, such as load-balancer
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

对承担大份额的代理设置 `OPENSTACK_AGENT_MEMORY_LIMIT_MIB`：它在发送出去之前会把一次抓取保存在内存中，默认值为 512 MiB。一行由它所在区域自己的服务作保，因此某个代理停止时，不会带走另一个代理读取的任何内容。云所依赖的组件，即 `OPENSTACK_RABBITMQ_TARGETS` 以及[其他类似的设置](/docs/telemetry/openstack#环境变量)，只能在一个代理上指定。如果该代理停止而其他代理继续运行，这些机器会在 15 分钟后从页面上消失，并在它恢复时回来。

**使用探测器时**，一个云有一个探测器。要给某个区域单独的探测器，请把它连接为一个独立的云，只选择该区域：不会重复计数，因为每个探测器只读取自己的区域，并各自读取 Keystone。这样每个都是 OneUptime 中独立的云，有自己的页面和自己的告警。

## 数据库路径

超过 **1,500 个 Hypervisor 或 100,000 个实例** 后，代理可以使用 [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter) 读取云的数据库，而不是读取其 API。在这个规模下，对 API 的一次抓取会超时，而无法完成的读取只是白白增加负载。读取数据库不会给 API 带来任何开销。只有超过这个规模才提供它，因为在此之下 API 的应答已经足够好，而这条路径会放弃一些内容。

**它对您的要求：**

- 每项服务的数据库上都有一个只读账户：Nova、Nova API、Placement、Neutron、Cinder、Glance 和 Keystone。被排除的数据库对应的服务不会被它读取。
- 从代理所在的机器到这些数据库的路由，而这些数据库在大多数云上都与其他任何东西严格隔离。这又多了一个可以读取每个项目记录的途径。
- 每个区域、每个 Nova cell 一个导出器。它读取您指向的内容，第二个 cell 需要第二个导出器。
- 它的 schema 要与您的版本保持一致。它直接读取每项服务的表，因此 OpenStack 升级后，可能在导出器的新版本发布之前就改变了它能读取的内容。

**要开启它**，在 `.env` 中：

```bash
COMPOSE_PROFILES=openstack-database-exporter
# Read from the databases, and from nowhere else: with the two together every series arrives twice.
OPENSTACK_EXPORTER_CLOUDS=[]
OPENSTACK_DATABASE_EXPORTER_TARGETS=[openstack-database-exporter:9180]
# What a hypervisor's full name adds to Nova's host name, so an instance finds its hypervisor.
OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX=.example.org
# oslo.db's form. Each is kept in .env, which only its owner can read.
NOVA_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova
NOVA_API_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova_api
PLACEMENT_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/placement
NEUTRON_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/neutron
CINDER_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/cinder
GLANCE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/glance
KEYSTONE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/keystone
# What a database cannot say, from the API: each is one small list a scrape.
OPENSTACK_WORKER_STATE_CLOUDS=[RegionOne]
```

**它涵盖什么。** 名称相同的相同序列，因此每个页面、监控器和告警模板对它们的读取方式都相同。测试会逐个名称、逐个标签地要求它们与 API 导出器的一致。

**它不涵盖什么：**

| 内容 | 原因，以及改为如何处理 |
| --- | --- |
| 每个 Nova worker 是否存活 | 它的 `openstack_nova_agent_state` 对任何启用的服务都读为 1，所以已停止的 `nova-compute` 也会读为运行中。代理会丢弃该序列，改为从 Nova 的 API 读取，这只是一个小列表 |
| 每个存储池有多满 | 每个后端把这一信息报告给 Cinder 的调度器，它不在数据库中。代理从 Cinder 的 API 读取，这又多了一次读取 |
| 网络的 MTU | 显示为未知 |
| `openstack_placement_resource_provider_allocations`，提供者的 generation | 无人读取它们 |
| 每个项目的配额和限额 | 它可以读取，但在 10,000 个项目时，每次抓取会有 790,000 个数据点，所以代理将它们省略。要保留它们，请删除 `otel-collector-config.yaml` 中的那条规则 |
| API 是否应答 | `openstack_<service>_up` 表示的是它的数据库是否应答。API 已停止而数据库健康时仍读为运行中，所以请用[网站监控器](/docs/monitor/website-monitor)监视 API 本身 |

**验证到什么程度。** 这些序列读自导出器的源码和代理所固定标签处的自带测试，并且每一项都与 OneUptime 读取的内容一致。它尚未在真实数据库上运行过。

## 最大规模经受的考验

真实的收集器每两分钟读取一次包含 5,000 个 Hypervisor、200,000 个实例和 10,000 个项目的模拟 API，持续 60 分钟，使用真实的时钟。它发送的内容经过真实的摄取，并真实写入真实的 Postgres，同时概览的读取和过期行清理每 30 秒在旁边运行一次，每次收集有 200 个实例发生变化。下面的每项预算都有断言，未达标的运行会失败。

| 内容 | 预算 | 实测 |
| --- | --- | --- |
| 每分钟请求数，即对每项服务的请求 | 恰好是收集器的计划所规定的，逐服务计算 | 完全一致。Keystone 1.3，Nova 25.1，Placement 1,166，Neutron 43.5，Cinder 62.4，Glance 0.5 |
| 因上一次仍在运行而被跳过的收集 | 无 | 30 次中 0 次 |
| 摄取延迟，从一次收集开始到其最后一行写入 | 低于 2 分钟 | 中位数 37 秒，最差 112 秒 |
| 打开概览，它所发出的所有读取同时进行 | 低于 6 秒 | 中位数 0.6 秒，最差 4.1 秒，需要关注的内容为 5,008 字节 |
| 任何写入方在清单表的锁上等待的最长时间 | 低于 5 秒 | 0.0 秒，在每秒一次的 2,739 次检查中 |
| 仍然存在却被删除的部分 | 无 | 0 |

此外还有它所耗费的资源，对此没有预算：压缩前每次收集 73 MiB 的指标，最多分 2 次上传，读取、发送和写入合计每次收集消耗此进程 14 秒的 CPU，JavaScript 堆最多 998 MiB。收集这种规模的云的探测器，在其他工作之外还需要这么多内存。

这是在一台 10 核的 Mac 上运行的，它同时在处理其他工作，平均负载约为 33，PostgreSQL 14 也在同一台机器上，所以这些时间反映的是一台繁忙机器能做到的，而不是服务器能做到的。测量日期为 2026-11-05。一小时的请求包含其第一次收集，该次收集会向 Placement 询问每个 Hypervisor 的清单，因此读数略高于已稳定收集的[表格](#通过探测器)，而每次收集有 200 个实例发生变化则是 Nova 在那里其余的读取。

在如此繁忙的机器上，余量并不宽裕。更早的一个小时，平均负载约为 42 并曾达到 95，运行中一次收集的最后一行在 124 秒时才落地，于是下一次收集被跳过，而其他所有预算都保持住了。

**这里没有涵盖的内容。** 模拟 API 立即应答，因此这与您的 API 有多快无关：[一次收集的时间允许什么](#通过探测器)才是关于这一点的。它不包含探测器与摄取之间的 HTTP 服务器和队列，也不包含 ClickHouse，所以图表或监控器对序列的读取不在其中，只有清单的写入和读取。这些行的形态与真实的 DevStack 相似，而数量是编造的。没有任何这种规模的云对它运行过。

## 页面读取什么

大型云的页面读取的内容只比小型云的多一点点，因为没有哪个页面会读取整个云。

| 页面 | 它读取什么 |
| --- | --- |
| **概览** | 在服务器上算出的计数，以及可能需要有人处理的行。超过 1,000 个主机或 worker 后，其余的只计数，所以无论云有多大，它带回的内容都保持在一兆字节以下 |
| **服务** | 同样如此：每项服务一张卡片，需要有人处理的排在前面，以及有多少其他的正常。搜索会询问服务器，因此能找到任何主机 |
| 列表 | 一次一页，每页都从前一页的最后一行开始。跳到较远的页面则按偏移量进行，在 200,000 行的最后一页上需要数秒而不是一毫秒 |
| **拓扑** | 超过 5,000 个部分后，显示结构、已失败的内容及其连带影响。它会说明省略了什么 |
| **清单写入** | 每条语句最多 500 行，删除最多 5,000 行，各自独立成一个事务，因此没有写入方会长时间等待另一个。一行如果没有变化，最长 5 分钟内不会被重写，这使预写日志减少了二十多倍 |

## 用量与支出

云的[支出页面](/docs/telemetry/openstack#支出)读取的是清单的行，而不是任何实例的序列，因此在摘要模式下的工作方式相同，其开销随项目数而不是实例数增长。它读取云的一行和项目的一页。[它自己的一节](/docs/telemetry/openstack#不同规模下的开销)列出了各种规模下的数字。

## 后续步骤

:::cards
- [OpenStack 代理](/docs/telemetry/openstack): 安装代理。
- [无需代理的 OpenStack](/docs/telemetry/openstack-agentless): 用探测器收集云。
- [OpenStack 监控器](/docs/monitor/openstack-monitor): 对到达的数据发出告警。
:::
