# Arquitectura auto-alojada de OneUptime

Este diagrama muestra el aspecto típico de OneUptime cuando se auto-aloja en tu entorno (por ejemplo, en tu clúster Kubernetes), incluyendo cómo las sondas monitorean tanto los recursos internos como los externos.

```mermaid
flowchart TB
  %% LAYOUT
  %% Top: Users -> Ingress -> Web / API
  %% Middle: Core services + Ingest pipeline
  %% Bottom: Data stores

  %% USERS / EDGE
  U["Usuarios finales / Navegadores"]

  %% CLUSTER BOUNDARY
  subgraph C["Red del cliente (Clúster Kubernetes auto-alojado)"]
    direction TB

    subgraph Edge["Ingreso y enrutamiento"]
      NGINX["Ingreso NGINX (TLS)"]
    end

    subgraph Web["Web y API"]
      direction TB
      HOME["Inicio / Panel (UI)"]
      STATUS["Páginas de estado (UI)"]
      API["Servidor de API"]
      WORKER["Worker en segundo plano"]
    end

    subgraph Ingest["Pipeline de ingesta"]
      direction TB
      PROBEINGEST["Ingesta de sondas"]
      OTELINGEST["Ingesta de OpenTelemetry"]
      FLUENTLOGS["Ingesta de registros (Fluent Bit)"]
      SERVERMONINGEST["Ingesta del monitor de servidor"]
      INCOMINGREQINGEST["Ingesta de solicitudes entrantes"]
    end

    subgraph Probes["Sondas de OneUptime"]
      direction TB
      P1["Pods de sonda en tu clúster"]
      P2["Sonda opcional VM/Contenedor en tu red"]
    end

    %% DATA STORES
    subgraph Data["Almacenes de datos"]
      direction LR
      PG[("PostgreSQL\n(configuración, estado, metadatos)")]
      CH[("ClickHouse\n(métricas, trazas, registros)")]
      REDIS[("Redis\n(caché, colas, sesiones)")]
    end

  end

  %% EXTERNAL / INTERNAL TARGETS
  EXT["Recursos externos\n(sitios web/APIs públicos, SaaS)"]
  INT["Recursos internos\n(aplicaciones privadas, bases de datos, servicios)"]

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
  P1 -->|resultados de monitoreo| PROBEINGEST
  P2 -->|resultados de monitoreo| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/Personalizado| P1
  INT <-->|HTTPS/TCP/Ping/DNS/Personalizado| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/Personalizado| P2
  INT <-->|HTTPS/TCP/Ping/DNS/Personalizado| P2

  OTELCOLL["Colector/Agentes OTel"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["Agentes de monitor de servidor"] --> SERVERMONINGEST

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

## Qué muestra esto
- Los usuarios finales acceden a OneUptime a través del Ingreso de tu clúster (NGINX), que enruta a la UI y la API.
- Los servicios principales leen/escriben el estado en PostgreSQL, Redis y ClickHouse.
- Las sondas pueden ejecutarse dentro de tu clúster (recomendado) y/o en otro lugar de tu red. Pueden monitorear:
  - Servicios internos/privados detrás de tu firewall.
  - Recursos externos/públicos en internet.
- Los resultados de las sondas se envían a la Ingesta de sondas dentro de tu clúster, se ponen en cola a través de Redis y son procesados por el Worker en segundo plano en tus almacenes de datos.
- Los datos de telemetría (métricas/trazas/registros) y los datos de servidor/agente pueden ingerirse a través de servicios de ingesta dedicados y almacenarse en ClickHouse.

> Nota: Si usas PostgreSQL, Redis o ClickHouse externos en lugar de los integrados, las conexiones desde la API/Worker/Ingesta apuntan a tus puntos de conexión externos. El flujo lógico sigue siendo el mismo.
