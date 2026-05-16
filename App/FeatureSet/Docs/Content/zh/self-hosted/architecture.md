# OneUptime 自托管架构

此图展示了 OneUptime 在您的环境（例如 Kubernetes 集群）中自托管时的典型架构，包括探针如何监控内部和外部资源。

```mermaid
flowchart TB
  %% 布局
  %% 顶部：用户 -> 入口 -> Web/API
  %% 中部：核心服务 + 数据摄取管道
  %% 底部：数据存储

  %% 用户/边缘
  U["终端用户/浏览器"]

  %% 集群边界
  subgraph C["客户网络（自托管 Kubernetes 集群）"]
    direction TB

    subgraph Edge["入口与路由"]
      NGINX["NGINX 入口（TLS）"]
    end

    subgraph Web["Web 与 API"]
      direction TB
      HOME["主页/控制台（UI）"]
      STATUS["状态页面（UI）"]
      API["API 服务器"]
      WORKER["后台 Worker"]
    end

    subgraph Ingest["数据摄取管道"]
      direction TB
      PROBEINGEST["探针数据摄取"]
      OTELINGEST["OpenTelemetry 数据摄取"]
      FLUENTLOGS["日志摄取（Fluent Bit）"]
      SERVERMONINGEST["服务器监控数据摄取"]
      INCOMINGREQINGEST["传入请求数据摄取"]
    end

    subgraph Probes["OneUptime 探针"]
      direction TB
      P1["集群内的探针 Pod"]
      P2["网络上的可选探针虚拟机/容器"]
    end

    %% 数据存储
    subgraph Data["数据存储"]
      direction LR
      PG[("PostgreSQL\n（配置、状态、元数据）")]
      CH[("ClickHouse\n（指标、追踪、日志）")]
      REDIS[("Redis\n（缓存、队列、会话）")]
    end

  end

  %% 外部/内部目标
  EXT["外部资源\n（公共网站/API、SaaS）"]
  INT["内部资源\n（私有应用、数据库、服务）"]

  %% 流程：边缘
  U -->|HTTPS| NGINX
  NGINX --> HOME
  NGINX --> STATUS
  HOME -->|REST/gRPC| API
  STATUS -->|REST/gRPC| API
  NGINX --> API

  %% 流程：核心服务 -> 数据
  API --> PG
  API --> REDIS
  API --> CH
  WORKER --> PG
  WORKER --> REDIS
  WORKER --> CH

  %% 流程：数据摄取
  P1 -->|监控结果| PROBEINGEST
  P2 -->|监控结果| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/自定义| P1
  INT <-->|HTTPS/TCP/Ping/DNS/自定义| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/自定义| P2
  INT <-->|HTTPS/TCP/Ping/DNS/自定义| P2

  OTELCOLL["OTel 收集器/Agent"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["服务器监控 Agent"] --> SERVERMONINGEST

  %% 摄取流程到核心处理
  PROBEINGEST --> REDIS
  OTELINGEST --> CH
  FLUENTLOGS --> CH
  SERVERMONINGEST --> CH
  INCOMINGREQINGEST --> CH

  %% Worker 从队列消费并写入存储
  REDIS --> WORKER

  %% 备注/图例
  classDef store fill:#fef6e4,stroke:#d4a373,color:#333;
  classDef edge fill:#e3f2fd,stroke:#64b5f6,color:#333;
  classDef web fill:#e8f5e9,stroke:#81c784,color:#333;
  classDef ingest fill:#f3e5f5,stroke:#ba68c8,color:#333;
  classDef probe fill:#fff3e0,stroke:#ffb74d,color:#333;
  classDef outside fill:#f5f5f5,stroke:#bdbdbd,color:#333,stroke-dasharray: 3 3;

  class NGINX edge;
  class HOME,STATUS,API,WORKER web;
  class PROBEINGEST,OTELINGEST,FLUENTLOGS,SERVERMONINGEST,INCOMINGREQINGEST ingest;
  class P1,P2 probe;
  class PG,CH,REDIS store;
  class EXT,INT,OTELCOLL,FLUENT,SERVERAGENTS outside;
```

## 图示说明
- 终端用户通过集群的入口（NGINX）访问 OneUptime，该入口将请求路由到 UI 和 API。
- 核心服务从 PostgreSQL、Redis 和 ClickHouse 读写状态。
- 探针可以在集群内（推荐）和/或网络其他地方运行。它们可以监控：
  - 防火墙后面的内部/私有服务。
  - 互联网上的外部/公共资源。
- 探针结果发送到集群内的探针数据摄取，通过 Redis 排队，并由后台 Worker 处理到数据存储中。
- 遥测数据（指标/追踪/日志）和服务器/Agent 数据可以通过专用数据摄取服务摄取，存储在 ClickHouse 中。

> 注意：如果您使用外部 PostgreSQL、Redis 或 ClickHouse 而非内置的，API/Worker/数据摄取的连接将指向您的外部端点。逻辑流程保持不变。
