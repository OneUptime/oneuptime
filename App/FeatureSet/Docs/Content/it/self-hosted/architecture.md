# Architettura Self-Hosted di OneUptime

Questo diagramma mostra come OneUptime appare tipicamente quando viene ospitato autonomamente nel proprio ambiente (ad esempio, nel proprio cluster Kubernetes), incluso come i Probe monitorano sia le risorse interne che quelle esterne.

```mermaid
flowchart TB
  %% LAYOUT
  %% Top: Utenti -> Ingress -> Web / API
  %% Middle: Servizi core + Pipeline di ingest
  %% Bottom: Data store

  %% UTENTI / EDGE
  U["Utenti Finali / Browser"]

  %% CONFINE CLUSTER
  subgraph C["Rete Cliente (Cluster Kubernetes Self-hosted)"]
    direction TB

    subgraph Edge["Ingress & Routing"]
      NGINX["NGINX Ingress (TLS)"]
    end

    subgraph Web["Web & API"]
      direction TB
      HOME["Home / Dashboard (UI)"]
      STATUS["Pagine di Stato (UI)"]
      API["Server API"]
      WORKER["Worker Background"]
    end

    subgraph Ingest["Pipeline di Ingest"]
      direction TB
      PROBEINGEST["Ingest Probe"]
      OTELINGEST["Ingest OpenTelemetry"]
      FLUENTLOGS["Ingest Log (Fluent Bit)"]
      SERVERMONINGEST["Ingest Monitor Server"]
      INCOMINGREQINGEST["Ingest Richiesta In Entrata"]
    end

    subgraph Probes["Probe OneUptime"]
      direction TB
      P1["Pod Probe nel proprio cluster"]
      P2["VM/Container Probe opzionale nella propria rete"]
    end

    %% DATA STORE
    subgraph Data["Data Store"]
      direction LR
      PG[("PostgreSQL\n(config, stato, metadati)")]
      CH[("ClickHouse\n(metriche, tracce, log)")]
      REDIS[("Redis\n(cache, code, sessioni)")]
    end

  end

  %% TARGET ESTERNI / INTERNI
  EXT["Risorse Esterne\n(siti web/API pubblici, SaaS)"]
  INT["Risorse Interne\n(app private, DB, servizi)"]

  %% FLUSSI: Edge
  U -->|HTTPS| NGINX
  NGINX --> HOME
  NGINX --> STATUS
  HOME -->|REST/gRPC| API
  STATUS -->|REST/gRPC| API
  NGINX --> API

  %% FLUSSI: Servizi core -> Data
  API --> PG
  API --> REDIS
  API --> CH
  WORKER --> PG
  WORKER --> REDIS
  WORKER --> CH

  %% FLUSSI: Ingest
  P1 -->|risultati monitoraggio| PROBEINGEST
  P2 -->|risultati monitoraggio| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P2
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P2

  OTELCOLL["OTel Collector/Agent"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["Agenti Monitor Server"] --> SERVERMONINGEST

  %% Flusso ingest all'elaborazione core
  PROBEINGEST --> REDIS
  OTELINGEST --> CH
  FLUENTLOGS --> CH
  SERVERMONINGEST --> CH
  INCOMINGREQINGEST --> CH

  %% I worker consumano dalle code e scrivono nei data store
  REDIS --> WORKER

  %% Note / Legenda
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

## Cosa Mostra
- Gli utenti finali accedono a OneUptime tramite l'Ingress del cluster (NGINX), che instrada verso l'UI e l'API.
- I servizi core leggono/scrivono lo stato su PostgreSQL, Redis e ClickHouse.
- I Probe possono essere eseguiti all'interno del cluster (consigliato) e/o altrove nella propria rete. Possono monitorare:
  - Servizi interni/privati protetti dal proprio firewall.
  - Risorse esterne/pubbliche su Internet.
- I risultati del Probe vengono inviati all'Ingest Probe all'interno del cluster, accodati tramite Redis ed elaborati dal Worker Background nei propri data store.
- I dati di telemetria (metriche/tracce/log) e i dati del server/agente possono essere acquisiti tramite servizi di ingest dedicati e archiviati in ClickHouse.

> Nota: Se si usa PostgreSQL, Redis o ClickHouse esterno invece di quelli integrati, le connessioni da API/Worker/Ingest puntano ai propri endpoint esterni. Il flusso logico rimane lo stesso.
