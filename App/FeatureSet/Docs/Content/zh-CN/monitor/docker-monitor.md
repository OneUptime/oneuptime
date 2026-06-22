# Docker 监控器

Docker 监控允许您监控 Docker 主机及其上运行的容器的健康状况和性能。OneUptime 通过预配置的 OpenTelemetry Collector（**OneUptime Docker Agent**）收集指标和容器日志，并根据您配置的标准进行评估。

## 概述

Docker 监控器使用来自主机的指标和日志，为您的容器工作负载提供可见性。这使您能够：

- 监控 Docker 主机和每个容器的健康状况
- 跨容器跟踪 CPU、内存、网络、块 I/O 和进程数
- 检测容器重启、崩溃和 CPU 限速
- 以原生 OpenTelemetry 格式流式传输结构化容器日志
- 就高 CPU、高内存、重启循环等发出告警

## 创建 Docker 监控器

1. 在 OneUptime 控制台中转到 **监控器**
2. 点击 **创建监控器**
3. 选择 **Docker** 作为监控器类型
4. 选择要监控的 Docker 主机和资源范围
5. 配置指标查询和聚合
6. 根据需要配置监控标准

## 配置选项

### Docker 主机

选择要监控的 Docker 主机。主机在 OneUptime Docker Agent 首次从其发送遥测数据时自动注册——您无需手动创建它们。

### 资源范围

选择监控资源的级别：

| 范围 | 描述                                 |
| ---- | ------------------------------------ |
| 主机 | 监控整个 Docker 主机，跨所有容器聚合 |
| 容器 | 按名称或镜像监控特定容器             |

### 指标查询

配置一个或多个指标查询进行评估。每个查询指定：

- **指标名称** — 要查询的容器指标
- **聚合** — 如何聚合指标值（平均值、求和、最大值、最小值）
- **过滤器** — 基于属性的额外过滤（例如按容器名称、镜像或主机过滤）
- **分组** — 可选地按 `resource.container.name` 分组，以便每个容器单独评估

您还可以创建使用数学表达式组合多个指标查询的**公式**。

### 滚动时间窗口

选择指标评估的时间窗口：

- 过去 1 分钟
- 过去 5 分钟
- 过去 10 分钟
- 过去 15 分钟
- 过去 30 分钟
- 过去 60 分钟

## 收集的指标

Docker Agent 使用 OpenTelemetry `docker_stats` 接收器，该接收器以可配置的间隔（默认每 30 秒）抓取 Docker Engine API。

### CPU

| 指标                                              | 描述                            |
| ------------------------------------------------- | ------------------------------- |
| `container.cpu.utilization`                       | CPU 利用率，占主机 CPU 的百分比 |
| `container.cpu.usage.total`                       | 容器消耗的累计 CPU 时间         |
| `container.cpu.throttling_data.throttled_time`    | 容器被 cgroups 限速的时间       |
| `container.cpu.throttling_data.throttled_periods` | 限速周期数                      |

### 内存

| 指标                           | 描述                     |
| ------------------------------ | ------------------------ |
| `container.memory.usage.total` | 当前内存使用量（字节）   |
| `container.memory.usage.limit` | 内存限制（字节）         |
| `container.memory.percent`     | 内存使用量占限制的百分比 |

### 网络

| 指标                                  | 描述           |
| ------------------------------------- | -------------- |
| `container.network.io.usage.rx_bytes` | 接收的总字节数 |
| `container.network.io.usage.tx_bytes` | 发送的总字节数 |

### 块 I/O

| 指标                                                 | 描述                 |
| ---------------------------------------------------- | -------------------- |
| `container.blockio.io_service_bytes_recursive.read`  | 从块设备读取的字节数 |
| `container.blockio.io_service_bytes_recursive.write` | 写入块设备的字节数   |

### 容器信息

| 指标                   | 描述               |
| ---------------------- | ------------------ |
| `container.uptime`     | 容器运行时间（秒） |
| `container.restarts`   | 容器重启次数       |
| `container.pids.count` | 容器内的进程数     |

## 监控标准

### 可用检查类型

| 检查类型 | 描述                     |
| -------- | ------------------------ |
| 指标值   | 配置的指标查询或公式的值 |

### 聚合类型

| 聚合   | 描述                   |
| ------ | ---------------------- |
| 平均值 | 时间窗口内的平均值     |
| 求和   | 所有值的总和           |
| 最大值 | 时间窗口内的最高值     |
| 最小值 | 时间窗口内的最低值     |
| 所有值 | 所有值必须满足标准     |
| 任意值 | 至少一个值必须满足标准 |

### 过滤类型

- **大于**、**小于**、**大于或等于**、**小于或等于**、**等于**、**不等于**

## 预置告警模板

OneUptime 为常见的 Docker 监控场景提供模板：

| 模板         | 描述                     | 阈值  | 聚合               |
| ------------ | ------------------------ | ----- | ------------------ |
| 高容器 CPU   | 每个容器的 CPU 利用率    | > 90% | 最大值（每个容器） |
| 高容器内存   | 内存使用量占限制的百分比 | > 85% | 最大值（每个容器） |
| 高 CPU 限速  | CPU 限速周期数           | > 0   | 最大值（每个容器） |
| 容器重启循环 | 容器重启次数             | > 3   | 求和               |
| 容器宕机     | 容器运行时间重置为 0     | = 0   | 最小值             |

> 注意：CPU、内存和限速模板使用按 `resource.container.name` 分组的 **最大值** 聚合。这可以防止单个繁忙容器的信号被同一主机上的许多空闲容器稀释。

## 收集的日志

除了指标外，Docker Agent 还通过 OpenTelemetry filelog 接收器跟踪每个容器的 `*-json.log` 文件，并以原生 OTLP 日志格式发送日志记录。每条日志记录都包含以下信息：

- `resource.host.name` — Docker 主机标识符
- `resource.container.id` — 完整的容器 ID
- `resource.container.runtime` — 始终为 `docker`
- `attributes["log.iostream"]` — `stdout` 或 `stderr`
- `severityText` / `severityNumber` — 从流中派生：`stderr` → `ERROR`，`stdout` → `INFO`
- `body` — 容器进程输出的原始日志行
- `time` — Docker 守护进程对该行的时间戳

日志显示在 Docker 主机的 **日志** 选项卡和每个容器的详情页面上。

### 日志驱动程序要求

**Docker Agent 只摄取使用 Docker `json-file` 日志驱动程序的容器的日志。** 这是 Docker 的默认设置，但可以按容器或全局覆盖：

- **`local`** 驱动程序 — 将二进制 protobuf 块写入 `/var/lib/docker/containers/<id>/local-logs/container.log`。filelog 接收器无法解析此格式。
- **`journald`**、**`syslog`**、**`fluentd`**、**`gelf`**、**`awslogs`**、**`splunk`** 等 — 将日志发送到远程目标；没有文件可供跟踪。
- **`none`** — 完全丢弃日志。

如果使用了上述任何驱动程序，您将在 Docker 主机页面上看到指标，但 **日志** 选项卡将为空（或仅包含 Docker Agent 自身的日志）。

**检查特定容器的日志驱动程序：**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**检查守护进程默认值：**

```bash
docker info --format '{{.LoggingDriver}}'
```

**将 Docker Compose 服务切换为带有合理轮换的 `json-file`：**

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

**切换守护进程默认值**（适用于之后创建的每个容器），编辑 `/etc/docker/daemon.json`：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

然后重启 Docker 守护进程并**重建**受影响的容器。Docker 在容器创建时绑定日志驱动程序，因此现有容器会保留旧驱动程序，直到被删除并重新创建：

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# 普通 docker
docker rm -f <container>
docker run ... <image>
```

## 设置要求

要使用 Docker 监控，您需要：

1. 在每个要监控的 Docker 主机上安装 OneUptime Docker Agent
2. 将 `ONEUPTIME_URL`、`ONEUPTIME_SERVICE_TOKEN` 和 `DOCKER_HOST_NAME` 作为环境变量传入
3. 确保要观察的容器使用 `json-file` 日志驱动程序（见上文）

该 Agent 以 `oneuptime/docker-agent:release` 的形式发布在 Docker Hub 上。完整的 `docker run` 和 `docker compose` 示例请参见 [Docker Agent 安装指南](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent)。

## 故障排查

### 指标显示但日志选项卡为空

您的容器几乎肯定没有使用 `json-file` 日志驱动程序。运行上方[日志驱动程序要求](#日志驱动程序要求)部分中的诊断命令，并切换任何需要发送日志的容器。

### Filelog 接收器日志显示"no files match the configured criteria"

这意味着 include glob `/var/lib/docker/containers/*/*-json.log` 在 Agent 启动时未匹配任何文件。原因可能是：

1. 此主机上没有容器使用 `json-file`，或
2. 绑定挂载 `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` 缺失或指向空目录，或
3. Agent 运行在 Docker Desktop for macOS 上，未暴露 Linux VM 的容器目录。

### 日志到达但被归类到错误的主机名下

OneUptime 通过 `resource.host.name` 自动注册 Docker 主机，该值来自 `DOCKER_HOST_NAME` 环境变量。在首次遥测批次发送后更改 `DOCKER_HOST_NAME` 会创建第二个主机行，而不是重命名现有行。

### "高 CPU"未触发事件

确保指标查询的聚合为 **最大值**（而非平均值），并且按 `resource.container.name` 分组。跨繁忙主机上所有容器的平均值会被空闲容器稀释，很少超过阈值。
