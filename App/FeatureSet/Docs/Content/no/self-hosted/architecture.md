# OneUptime selvhostet arkitektur

Dette diagrammet viser hvordan OneUptime vanligvis ser ut når det selvhostes i ditt miljø (for eksempel i Kubernetes-klyngen din), inkludert hvordan prober overvåker både interne og eksterne ressurser.

```mermaid
flowchart TB
  %% LAYOUT
  %% Topp: Brukere -> Inngang -> Web / API
  %% Midten: Kjernetjenester + Innhentingspipeline
  %% Bunn: Datalager

  %% BRUKERE / KANT
  U["Sluttbrukere / Nettlesere"]

  %% KLYNGEGRENSE
  subgraph C["Kundenettverk (selvhostet Kubernetes-klynge)"]
    direction TB

    subgraph Edge["Inngang og ruting"]
      NGINX["NGINX Inngang (TLS)"]
    end

    subgraph Web["Web og API"]
      direction TB
      HOME["Hjem / Dashbord (UI)"]
      STATUS["Statussider (UI)"]
      API["API-server"]
      WORKER["Bakgrunnsarbeider"]
    end

    subgraph Ingest["Innhentingspipeline"]
      direction TB
      PROBEINGEST["Probe-innhenting"]
      OTELINGEST["OpenTelemetry-innhenting"]
      FLUENTLOGS["Logg-innhenting (Fluent Bit)"]
      SERVERMONINGEST["Server-monitor-innhenting"]
      INCOMINGREQINGEST["Innkommende forespørsels-innhenting"]
    end

    subgraph Probes["OneUptime-prober"]
      direction TB
      P1["Probe-pod(er) i klyngen din"]
      P2["Valgfri probe-VM/container i nettverket ditt"]
    end

    %% DATALAGER
    subgraph Data["Datalager"]
      direction LR
      PG[("PostgreSQL\n(konfigurasjon, tilstand, metadata)")]
      CH[("ClickHouse\n(metrikker, spor, logger)")]
      REDIS[("Redis\n(hurtigbuffer, køer, sesjoner)")]
    end

  end

  %% EKSTERNE / INTERNE MÅL
  EXT["Eksterne ressurser\n(offentlige nettsteder/API-er, SaaS)"]
  INT["Interne ressurser\n(private apper, databaser, tjenester)"]

  %% FLYTER: Kant
  U -->|HTTPS| NGINX
  NGINX --> HOME
  NGINX --> STATUS
  HOME -->|REST/gRPC| API
  STATUS -->|REST/gRPC| API
  NGINX --> API

  %% FLYTER: Kjernetjenester -> Data
  API --> PG
  API --> REDIS
  API --> CH
  WORKER --> PG
  WORKER --> REDIS
  WORKER --> CH

  %% FLYTER: Innhenting
  P1 -->|overvåkingsresultater| PROBEINGEST
  P2 -->|overvåkingsresultater| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/Egendefinert| P1
  INT <-->|HTTPS/TCP/Ping/DNS/Egendefinert| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/Egendefinert| P2
  INT <-->|HTTPS/TCP/Ping/DNS/Egendefinert| P2

  OTELCOLL["OTel Collector/Agenter"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["Server-monitoragenter"] --> SERVERMONINGEST

  %% Innhentingsflyt til kjernbehandling
  PROBEINGEST --> REDIS
  OTELINGEST --> CH
  FLUENTLOGS --> CH
  SERVERMONINGEST --> CH
  INCOMINGREQINGEST --> CH

  %% Arbeidere forbruker fra køer og skriver til lager
  REDIS --> WORKER

  %% Notater / Forklaring
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

## Hva dette viser

- Sluttbrukere får tilgang til OneUptime gjennom klyngens inngang (NGINX), som ruter til UI og API.
- Kjernetjenester leser/skriver tilstand til PostgreSQL, Redis og ClickHouse.
- Prober kan kjøre inne i klyngen din (anbefalt) og/eller andre steder i nettverket ditt. De kan overvåke:
  - Interne/private tjenester bak brannmuren din.
  - Eksterne/offentlige ressurser på internett.
- Probe-resultater sendes til Probe-innhenting inne i klyngen, settes i kø via Redis og behandles av bakgrunnsarbeideren inn i datalagerne.
- Telemetri (metrikker/spor/logger) og server-/agentdata kan hentes inn via dedikerte innhentingstjenester og lagres i ClickHouse.

> Merk: Hvis du bruker ekstern PostgreSQL, Redis eller ClickHouse i stedet for de innebygde, peker tilkoblingene fra API/Worker/Ingest til de eksterne endepunktene. Den logiske flyten forblir den samme.
