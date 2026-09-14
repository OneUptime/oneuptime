# معماری خودمیزبان OneUptime

این نمودار نشان می‌دهد وقتی OneUptime در محیط شما خودمیزبانی می‌شود (برای نمونه در خوشه Kubernetes شما) معمولاً چه شکلی دارد، از جمله اینکه پراب‌ها چگونه منابع داخلی و بیرونی را پایش می‌کنند.

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
      REDIS[("Valkey\n(cache, queues, sessions)")]
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

## این نمودار چه چیزی را نشان می‌دهد

- کاربران نهایی از طریق Ingress خوشه شما (NGINX) به OneUptime دسترسی پیدا می‌کنند، که آن‌ها را به رابط کاربری و API مسیریابی می‌کند.
- سرویس‌های اصلی وضعیت را در PostgreSQL، Valkey (فورک با مجوز BSD از Redis 7.2) و ClickHouse می‌خوانند و می‌نویسند.
- پراب‌ها می‌توانند درون خوشه شما (توصیه‌شده) و/یا جای دیگری در شبکه شما اجرا شوند. آن‌ها می‌توانند این‌ها را پایش کنند:
  - سرویس‌های داخلی/خصوصی پشت دیوار آتش شما.
  - منابع بیرونی/عمومی روی اینترنت.
- نتایج پراب به Probe Ingest درون خوشه شما فرستاده می‌شود، از طریق Valkey در صف قرار می‌گیرد و توسط Background Worker پردازش و در پایگاه‌های داده شما ذخیره می‌شود.
- تله‌متری (متریک/ترِیس/لاگ) و داده سرور/عامل می‌تواند از طریق سرویس‌های اختصاصی دریافت وارد شود و در ClickHouse ذخیره گردد.

> توجه: اگر به‌جای نمونه‌های داخلی از PostgreSQL، Redis یا ClickHouse بیرونی استفاده می‌کنید، اتصال‌های API/Worker/Ingest به نقاط پایانی بیرونی شما اشاره می‌کنند. جریان منطقی همان می‌ماند.
