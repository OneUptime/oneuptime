# OneUptime Zelf-gehoste architectuur

Dit diagram toont hoe OneUptime er doorgaans uitziet wanneer het zelf wordt gehost in uw omgeving (bijvoorbeeld in uw Kubernetes-cluster), inclusief hoe probes zowel interne als externe resources bewaken.

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

## Wat dit toont
- Eindgebruikers krijgen toegang tot OneUptime via de Ingress (NGINX) van uw cluster, die routeert naar de UI en API.
- Kerndiensten lezen/schrijven status naar PostgreSQL, Redis en ClickHouse.
- Probes kunnen draaien binnen uw cluster (aanbevolen) en/of elders op uw netwerk. Ze kunnen het volgende bewaken:
  - Interne/privédiensten achter uw firewall.
  - Externe/openbare resources op het internet.
- Probe-resultaten worden verzonden naar Probe Ingest binnen uw cluster, in de wachtrij geplaatst via Redis en verwerkt door de Achtergrondwerker in uw dataopslag.
- Telemetrie (metrics/traces/logs) en server-/agentgegevens kunnen worden verwerkt via speciale ingest-diensten en opgeslagen in ClickHouse.

> Opmerking: Als u externe PostgreSQL, Redis of ClickHouse gebruikt in plaats van de ingebouwde, wijzen de verbindingen van API/Worker/Ingest naar uw externe eindpunten. De logische stroom blijft hetzelfde.
