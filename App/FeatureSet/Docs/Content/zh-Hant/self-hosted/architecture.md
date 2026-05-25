# OneUptime 自託管架構

此圖展示了 OneUptime 在您的環境（例如 Kubernetes 集羣）中自託管時的典型架構，包括探針如何監控內部和外部資源。

```mermaid
flowchart TB
  %% 佈局
  %% 頂部：用戶 -> 入口 -> Web/API
  %% 中部：核心服務 + 數據攝取管道
  %% 底部：數據儲存

  %% 用戶/邊緣
  U["終端用戶/瀏覽器"]

  %% 集羣邊界
  subgraph C["客戶網絡（自託管 Kubernetes 集羣）"]
    direction TB

    subgraph Edge["入口與路由"]
      NGINX["NGINX 入口（TLS）"]
    end

    subgraph Web["Web 與 API"]
      direction TB
      HOME["主頁/控制台（UI）"]
      STATUS["狀態頁面（UI）"]
      API["API 服務器"]
      WORKER["後臺 Worker"]
    end

    subgraph Ingest["數據攝取管道"]
      direction TB
      PROBEINGEST["探針數據攝取"]
      OTELINGEST["OpenTelemetry 數據攝取"]
      FLUENTLOGS["日誌攝取（Fluent Bit）"]
      SERVERMONINGEST["服務器監控數據攝取"]
      INCOMINGREQINGEST["傳入請求數據攝取"]
    end

    subgraph Probes["OneUptime 探針"]
      direction TB
      P1["集羣內的探針 Pod"]
      P2["網絡上的可選探針虛擬機/容器"]
    end

    %% 數據儲存
    subgraph Data["數據儲存"]
      direction LR
      PG[("PostgreSQL\n（配置、狀態、元數據）")]
      CH[("ClickHouse\n（指標、追蹤、日誌）")]
      REDIS[("Redis\n（緩存、隊列、會話）")]
    end

  end

  %% 外部/內部目標
  EXT["外部資源\n（公共網站/API、SaaS）"]
  INT["內部資源\n（私有應用、數據庫、服務）"]

  %% 流程：邊緣
  U -->|HTTPS| NGINX
  NGINX --> HOME
  NGINX --> STATUS
  HOME -->|REST/gRPC| API
  STATUS -->|REST/gRPC| API
  NGINX --> API

  %% 流程：核心服務 -> 數據
  API --> PG
  API --> REDIS
  API --> CH
  WORKER --> PG
  WORKER --> REDIS
  WORKER --> CH

  %% 流程：數據攝取
  P1 -->|監控結果| PROBEINGEST
  P2 -->|監控結果| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/自定義| P1
  INT <-->|HTTPS/TCP/Ping/DNS/自定義| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/自定義| P2
  INT <-->|HTTPS/TCP/Ping/DNS/自定義| P2

  OTELCOLL["OTel 收集器/Agent"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["服務器監控 Agent"] --> SERVERMONINGEST

  %% 攝取流程到核心處理
  PROBEINGEST --> REDIS
  OTELINGEST --> CH
  FLUENTLOGS --> CH
  SERVERMONINGEST --> CH
  INCOMINGREQINGEST --> CH

  %% Worker 從隊列消費並寫入儲存
  REDIS --> WORKER

  %% 備註/圖例
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

## 圖示說明
- 終端用戶通過集羣的入口（NGINX）訪問 OneUptime，該入口將請求路由到 UI 和 API。
- 核心服務從 PostgreSQL、Redis 和 ClickHouse 讀寫狀態。
- 探針可以在集羣內（推薦）和/或網絡其他地方運行。它們可以監控：
  - 防火牆後面的內部/私有服務。
  - 互聯網上的外部/公共資源。
- 探針結果發送到集羣內的探針數據攝取，通過 Redis 排隊，並由後臺 Worker 處理到數據儲存中。
- 遙測數據（指標/追蹤/日誌）和服務器/Agent 數據可以通過專用數據攝取服務攝取，儲存在 ClickHouse 中。

> 注意：如果您使用外部 PostgreSQL、Redis 或 ClickHouse 而非內置的，API/Worker/數據攝取的連接將指向您的外部端點。邏輯流程保持不變。
