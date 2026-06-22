# OneUptime Docker Agent

## 概述

OneUptime Docker Agent 是一个预构建的容器镜像，内置了经过调优的 OpenTelemetry Collector 配置。将它与你现有的容器一起运行，它会自动发现主机上的每一个容器，采集 CPU / 内存 / 网络 / 块 I/O 指标以及容器日志，并通过 OTLP 将所有数据转发到 OneUptime。单个镜像，单条命令。

本页是**安装指南**。若要基于该 agent 所采集的数据来配置 Docker 监控器和告警，请参阅 [Docker Monitor](/docs/monitor/docker-monitor)。

## 前提条件

- Docker Engine 20.10+
- 可访问主机上的 `/var/run/docker.sock`
- 一个 **OneUptime 遥测摄取令牌（Telemetry Ingestion Token）** —— 从 _Project Settings → Telemetry Ingestion Keys_ 创建一个并复制其值

## 快速开始（一条命令）

请将 `YOUR_ONEUPTIME_URL`、`YOUR_TELEMETRY_INGESTION_TOKEN` 以及主机名替换为你自己环境中的值。主机名决定了该 Docker 主机在 OneUptime 中的显示方式 —— 可以选用类似 `prod-docker-01` 这样的名称。

```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

就是这样。一旦 agent 连接成功，你的 Docker 主机就会自动出现在 OneUptime 仪表板的 **Docker** 板块中。

## 备选方案 —— Docker Compose

如果你更倾向于使用 Docker Compose，请将以下内容放入 `docker-compose.yml`：

```yaml
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

启动它：

```bash
docker compose up -d
```

## 环境变量

| 变量                      | 是否必需 | 说明                                                                                            |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | 是       | 你的 OneUptime 实例 URL（例如 `https://oneuptime.com` 或你自托管的主机地址）                    |
| `ONEUPTIME_SERVICE_TOKEN` | 是       | 来自 _Project Settings → Telemetry Ingestion Keys_ 的遥测摄取令牌                               |
| `DOCKER_HOST_NAME`        | 否       | 该主机的友好名称。默认值为 `docker-host`。请为每台主机设置一个稳定的值（例如 `prod-docker-01`） |

## 验证安装

检查 agent 是否正在运行：

```bash
docker ps --filter name=oneuptime-docker-agent
```

查看 agent 日志：

```bash
docker logs -f oneuptime-docker-agent
```

留意这一行：`"Everything is ready. Begin running and processing data."`

大约一分钟内，该主机就应当出现在 OneUptime 仪表板中，并开始持续上报指标和日志。

## 升级 Agent

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# 重新运行上面的 `docker run` 命令
```

或者使用 Docker Compose：

```bash
docker compose pull
docker compose up -d
```

## 卸载 Agent

```bash
docker rm -f oneuptime-docker-agent
```

如果你使用的是 Docker Compose：

```bash
docker compose down
```

## 采集了哪些数据

| 类别            | 数据                                      |
| --------------- | ----------------------------------------- |
| **CPU 指标**    | 总使用量、使用百分比、节流时间（按容器）  |
| **内存指标**    | 使用量、上限、百分比、RSS、缓存（按容器） |
| **网络指标**    | 接收 / 发送的字节数和数据包数（按容器）   |
| **块 I/O 指标** | 读 / 写的字节数和操作数（按容器）         |
| **容器信息**    | 运行时长、重启次数、进程数                |
| **容器日志**    | 所有容器的 stdout / stderr 日志           |

## 自托管的 OneUptime

如果你正在自托管 OneUptime，请将 `ONEUPTIME_URL` 设置为你自己的实例：

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

如果你的实例仅支持 HTTP，请使用 `http://` 以及相应的端口。

## 故障排查

### Docker Socket 权限被拒绝（Permission Denied）

agent 容器必须以 root 身份运行（`--user 0:0`）才能访问 `/var/run/docker.sock`。请确保 `--user 0:0` 标志（或 Compose 中的 `user: "0:0"`）存在。

### Agent 显示为已断开连接

1. 检查 agent 是否正在运行：`docker ps --filter name=oneuptime-docker-agent`
2. 查看 agent 日志：`docker logs oneuptime-docker-agent | grep -i error`
3. 确认你的 OneUptime URL 和服务令牌是否正确
4. 确保你的 Docker 主机可以通过网络访问到该 OneUptime 实例

### 没有出现任何指标

1. 验证 agent 内部能否访问 Docker socket：`docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. 检查 collector 日志中是否有导出错误：`docker logs oneuptime-docker-agent | tail -100`
3. 确保你的服务令牌有效且未过期

### 主机名显示为容器 ID

请将 `DOCKER_HOST_NAME` 环境变量设置为一个友好的名称，然后重新创建该容器。

## 后续步骤

- 配置 **Docker Monitors**，针对容器 CPU / 内存 / 重启条件发出告警 —— 请参阅 [Docker Monitor](/docs/monitor/docker-monitor)。
- 如果是 Kubernetes 集群而非独立的 Docker 主机，请使用 [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent)。
- 对于非容器化的主机（Linux / macOS / Windows 虚拟机及裸机），请使用 [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector)。
