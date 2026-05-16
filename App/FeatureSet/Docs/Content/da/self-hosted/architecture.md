# OneUptime selvhostet arkitektur

Dette diagram viser, hvordan OneUptime typisk ser ud, når det selvhostes i dit miljø (f.eks. i din Kubernetes-klynge), herunder hvordan prober overvåger både interne og eksterne ressourcer.

```mermaid
flowchart TB
  %% LAYOUT
  %% Øverst: Brugere -> Indgang -> Web / API
  %% Midten: Kernetjenester + Indtagspipeline
  %% Bunden: Datalagre

  %% BRUGERE / KANT
  U["Slutbrugere / Browsere"]

  %% KLYNGEGRÆNSE
  subgraph C["Kundenetværk (Selvhostet Kubernetes-klynge)"]
    direction TB

    subgraph Edge["Indgang og dirigering"]
      NGINX["NGINX Indgang (TLS)"]
    end

    subgraph Web["Web og API"]
      direction TB
      HOME["Hjem / Dashboard (UI)"]
      STATUS["Statussider (UI)"]
      API["API-server"]
      WORKER["Baggrundsmedarbejder"]
    end

    subgraph Ingest["Indtagspipeline"]
      direction TB
      PROBEINGEST["Probe-indtagelse"]
      OTELINGEST["OpenTelemetry-indtagelse"]
      FLUENTLOGS["Log-indtagelse (Fluent Bit)"]
      SERVERMONINGEST["Servermonitor-indtagelse"]
      INCOMINGREQINGEST["Indgående anmodnings-indtagelse"]
    end

    subgraph Probes["OneUptime-prober"]
      direction TB
      P1["Probe-pod(s) i din klynge"]
      P2["Valgfri probe-VM/container på dit netværk"]
    end

    %% DATALAGRE
    subgraph Data["Datalagre"]
      direction LR
      PG[("PostgreSQL\n(konfiguration, tilstand, metadata)")]
      CH[("ClickHouse\n(metrikker, traces, logs)")]
      REDIS[("Redis\n(cache, køer, sessioner)")]
    end

  end

  %% EKSTERNE / INTERNE MÅL
  EXT["Eksterne ressourcer\n(offentlige websteder/API'er, SaaS)"]
  INT["Interne ressourcer\n(private apps, DB'er, tjenester)"]

  %% FLOWS: Kant
  U -->|HTTPS| NGINX
  NGINX --> HOME
  NGINX --> STATUS
  HOME -->|REST/gRPC| API
  STATUS -->|REST/gRPC| API
  NGINX --> API

  %% FLOWS: Kernetjenester -> Data
  API --> PG
  API --> REDIS
  API --> CH
  WORKER --> PG
  WORKER --> REDIS
  WORKER --> CH

  %% FLOWS: Indtagelse
  P1 -->|overvågningsresultater| PROBEINGEST
  P2 -->|overvågningsresultater| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/Brugerdefineret| P1
  INT <-->|HTTPS/TCP/Ping/DNS/Brugerdefineret| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/Brugerdefineret| P2
  INT <-->|HTTPS/TCP/Ping/DNS/Brugerdefineret| P2

  OTELCOLL["OTel Collector/Agenter"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["Servermonitor-agenter"] --> SERVERMONINGEST

  %% Indtagelsesflow til kerne-behandling
  PROBEINGEST --> REDIS
  OTELINGEST --> CH
  FLUENTLOGS --> CH
  SERVERMONINGEST --> CH
  INCOMINGREQINGEST --> CH

  %% Medarbejdere forbruger fra køer og skriver til lagre
  REDIS --> WORKER

  %% Noter / Forklaring
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

## Hvad dette viser
- Slutbrugere tilgår OneUptime via din klynges indgang (NGINX), som dirigerer til UI'en og API'en.
- Kernetjenester læser/skriver tilstand til PostgreSQL, Redis og ClickHouse.
- Prober kan køre inde i din klynge (anbefalet) og/eller andre steder på dit netværk. De kan overvåge:
  - Interne/private tjenester bag din firewall.
  - Eksterne/offentlige ressourcer på internettet.
- Probe-resultater sendes til Probe-indtagelse inde i din klynge, sættes i kø via Redis og behandles af Baggrundsmedarbejderen til dine datalagre.
- Telemetri (metrikker/traces/logs) og server-/agentdata kan indsamles via dedikerede indtagelsestjenester og gemmes i ClickHouse.

> Bemærk: Hvis du bruger ekstern PostgreSQL, Redis eller ClickHouse i stedet for de indbyggede, peger forbindelserne fra API/Worker/Ingest på dine eksterne endpoints. Det logiske flow forbliver det samme.
