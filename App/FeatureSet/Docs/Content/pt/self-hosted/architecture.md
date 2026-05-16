# Arquitetura Auto-Hospedada do OneUptime

Este diagrama mostra como o OneUptime normalmente se parece quando auto-hospedado no seu ambiente (por exemplo, no seu cluster Kubernetes), incluindo como as Probes monitoram recursos internos e externos.

```mermaid
flowchart TB
  %% LAYOUT
  %% Top: Users -> Ingress -> Web / API
  %% Middle: Core services + Ingest pipeline
  %% Bottom: Data stores

  %% USERS / EDGE
  U["Usuários Finais / Navegadores"]

  %% CLUSTER BOUNDARY
  subgraph C["Rede do Cliente (Cluster Kubernetes Auto-hospedado)"]
    direction TB

    subgraph Edge["Ingress e Roteamento"]
      NGINX["NGINX Ingress (TLS)"]
    end

    subgraph Web["Web e API"]
      direction TB
      HOME["Home / Dashboard (UI)"]
      STATUS["Páginas de Status (UI)"]
      API["Servidor de API"]
      WORKER["Worker em Segundo Plano"]
    end

    subgraph Ingest["Pipeline de Ingestão"]
      direction TB
      PROBEINGEST["Ingestão de Probe"]
      OTELINGEST["Ingestão de OpenTelemetry"]
      FLUENTLOGS["Ingestão de Logs (Fluent Bit)"]
      SERVERMONINGEST["Ingestão de Monitor de Servidor"]
      INCOMINGREQINGEST["Ingestão de Requisição de Entrada"]
    end

    subgraph Probes["Probes do OneUptime"]
      direction TB
      P1["Pod(s) de Probe no seu cluster"]
      P2["VM/Contêiner de Probe opcional na sua rede"]
    end

    %% DATA STORES
    subgraph Data["Armazenamentos de Dados"]
      direction LR
      PG[("PostgreSQL\n(configuração, estado, metadados)")]
      CH[("ClickHouse\n(métricas, rastreamentos, logs)")]
      REDIS[("Redis\n(cache, filas, sessões)")]
    end

  end

  %% EXTERNAL / INTERNAL TARGETS
  EXT["Recursos Externos\n(sites/APIs públicos, SaaS)"]
  INT["Recursos Internos\n(aplicativos privados, BDs, serviços)"]

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
  P1 -->|resultados de monitoramento| PROBEINGEST
  P2 -->|resultados de monitoramento| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P2
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P2

  OTELCOLL["Coletor/Agentes OTel"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["Agentes do Monitor de Servidor"] --> SERVERMONINGEST

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

## O que isso mostra
- Os usuários finais acessam o OneUptime através do Ingress do seu cluster (NGINX), que roteia para a UI e API.
- Os serviços principais leem/escrevem estado no PostgreSQL, Redis e ClickHouse.
- As Probes podem ser executadas dentro do seu cluster (recomendado) e/ou em outros lugares da sua rede. Elas podem monitorar:
  - Serviços internos/privados atrás do seu firewall.
  - Recursos externos/públicos na internet.
- Os resultados das Probes são enviados para a Ingestão de Probe dentro do seu cluster, enfileirados via Redis e processados pelo Worker em Segundo Plano em seus armazenamentos de dados.
- Telemetria (métricas/rastreamentos/logs) e dados de servidor/agente podem ser ingeridos via serviços dedicados de ingestão e armazenados no ClickHouse.

> Nota: Se você usar PostgreSQL, Redis ou ClickHouse externos em vez dos integrados, as conexões de API/Worker/Ingest apontam para seus endpoints externos. O fluxo lógico permanece o mesmo.
