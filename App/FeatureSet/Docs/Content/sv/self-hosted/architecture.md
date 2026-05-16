# OneUptime-arkitektur för egeninstallation

Det här diagrammet visar hur OneUptime vanligtvis ser ut när det egeninstalleras i din miljö (till exempel i ditt Kubernetes-kluster), inklusive hur sonder övervakar både interna och externa resurser.

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

## Vad detta visar
- Slutanvändare når OneUptime via klustrets Ingress (NGINX), som dirigerar till UI och API.
- Kärntjänster läser/skriver tillstånd till PostgreSQL, Redis och ClickHouse.
- Sonder kan köras inuti ditt kluster (rekommenderas) och/eller på annan plats i ditt nätverk. De kan övervaka:
  - Interna/privata tjänster bakom din brandvägg.
  - Externa/offentliga resurser på internet.
- Sondresultat skickas till Probe Ingest inuti ditt kluster, köas via Redis och bearbetas av bakgrundsarbetaren till dina datalager.
- Telemetri (mätvärden/spårningar/loggar) och server-/agentdata kan matas in via dedikerade ingest-tjänster och lagras i ClickHouse.

> Observera: Om du använder extern PostgreSQL, Redis eller ClickHouse istället för de inbyggda, pekar anslutningarna från API/Worker/Ingest till dina externa slutpunkter. Det logiska flödet förblir detsamma.
