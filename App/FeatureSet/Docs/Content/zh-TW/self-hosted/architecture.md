# OneUptime 自架架構

此圖表展示了 OneUptime 在您的環境中自架時（例如在您的 Kubernetes 叢集中）通常的樣貌，包括 Probe 如何監控內部與外部資源。

```mermaid
flowchart TB
  %% LAYOUT
  %% Top: Users -> Ingress -> Web / API
  %% Middle: Core services + Ingest pipeline
  %% Bottom: Data stores

  %% USERS / EDGE
  U["End Users / Browsers"]

  %% CLUSTER BOUNDARY
  subgraph C["Customer Network (Self-hosted Kubernetes Cluster)"]
    direction TB

    subgraph Edge["Ingress & Routing"]
      NGINX["NGINX Ingress (TLS)"]
    end

    subgraph Web["Web & API"]
      direction TB
      HOME["Home / Dashboard (UI)"]
      STATUS["Status Pages (UI)"]
      API["API Server"]
      WORKER["Background Worker"]
    end

    subgraph Ingest["Ingest Pipeline"]
      direction TB
      PROBEINGEST["Probe Ingest"]
      OTELINGEST["OpenTelemetry Ingest"]
      FLUENTLOGS["Logs Ingest (Fluent Bit)"]
      SERVERMONINGEST["Server Monitor Ingest"]
      INCOMINGREQINGEST["Incoming Request Ingest"]
    end

    subgraph Probes["OneUptime Probes"]
      direction TB
      P1["Probe Pod(s) in your cluster"]
      P2["Optional Probe VM/Container on your network"]
    end

    %% DATA STORES
    subgraph Data["Data Stores"]
      direction LR
      PG[("PostgreSQL\n(config, state, metadata)")]
      CH[("ClickHouse\n(metrics, traces, logs)")]
      REDIS[("Redis\n(cache, queues, sessions)")]
    end

  end

  %% EXTERNAL / INTERNAL TARGETS
  EXT["External Resources\n(public websites/APIs, SaaS)"]
  INT["Internal Resources\n(private apps, DBs, services)"]

  %% FLOWS: Edge
  U -->|HTTPS| NGINX
  NGINX --> HOME
  NGINX --> STATUS
  HOME -->|REST/gRPC| API
  STATUS -->|REST/gRPC| API
  NGINX --> API

  %% FLOWS: Core services -> Data
  API --> PG
  API --> REDIS
  API --> CH
  WORKER --> PG
  WORKER --> REDIS
  WORKER --> CH

  %% FLOWS: Ingest
  P1 -->|monitoring results| PROBEINGEST
  P2 -->|monitoring results| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P2
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P2

  OTELCOLL["OTel Collector/Agents"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["Server Monitor Agents"] --> SERVERMONINGEST

  %% Ingest flow to core processing
  PROBEINGEST --> REDIS
  OTELINGEST --> CH
  FLUENTLOGS --> CH
  SERVERMONINGEST --> CH
  INCOMINGREQINGEST --> CH

  %% Workers consume from queues and write to stores
  REDIS --> WORKER

  %% Notes / Legend
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

## 此圖表展示的內容

- 終端使用者透過您叢集的 Ingress（NGINX）存取 OneUptime，由其路由至 UI 與 API。
- 核心服務會讀取/寫入狀態至 PostgreSQL、Redis 與 ClickHouse。
- Probe 可以在您的叢集內執行（建議）以及／或在您網路的其他位置執行。它們可以監控：
  - 您防火牆後方的內部／私有服務。
  - 網際網路上的外部／公開資源。
- Probe 結果會傳送至您叢集內的 Probe Ingest，透過 Redis 排入佇列，並由 Background Worker 處理後寫入您的資料儲存區。
- 遙測資料（指標／追蹤／日誌）以及伺服器／代理程式資料可透過專用的擷取服務進行擷取，並儲存於 ClickHouse 中。

> 注意：如果您使用外部的 PostgreSQL、Redis 或 ClickHouse 而非內建的版本，則來自 API／Worker／Ingest 的連線會指向您的外部端點。邏輯流程維持不變。
