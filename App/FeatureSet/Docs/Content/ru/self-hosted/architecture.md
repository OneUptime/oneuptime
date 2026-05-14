# Архитектура OneUptime при самостоятельном хостинге

Данная диаграмма показывает типичный вид OneUptime при самостоятельном хостинге в вашей среде (например, в кластере Kubernetes), включая то, как зонды отслеживают как внутренние, так и внешние ресурсы.

```mermaid
flowchart TB
  %% LAYOUT
  %% Top: Users -> Ingress -> Web / API
  %% Middle: Core services + Ingest pipeline
  %% Bottom: Data stores

  %% USERS / EDGE
  U["Конечные пользователи / Браузеры"]

  %% CLUSTER BOUNDARY
  subgraph C["Сеть клиента (самостоятельный хостинг Kubernetes)"]
    direction TB

    subgraph Edge["Входящий трафик и маршрутизация"]
      NGINX["NGINX Ingress (TLS)"]
    end

    subgraph Web["Веб и API"]
      direction TB
      HOME["Главная / Панель управления (UI)"]
      STATUS["Страницы статуса (UI)"]
      API["Сервер API"]
      WORKER["Фоновый воркер"]
    end

    subgraph Ingest["Конвейер приёма данных"]
      direction TB
      PROBEINGEST["Приёмник зондов"]
      OTELINGEST["Приёмник OpenTelemetry"]
      FLUENTLOGS["Приёмник журналов (Fluent Bit)"]
      SERVERMONINGEST["Приёмник мониторинга серверов"]
      INCOMINGREQINGEST["Приёмник входящих запросов"]
    end

    subgraph Probes["Зонды OneUptime"]
      direction TB
      P1["Под(ы) зонда в вашем кластере"]
      P2["Необязательный зонд на ВМ/контейнере в вашей сети"]
    end

    %% DATA STORES
    subgraph Data["Хранилища данных"]
      direction LR
      PG[("PostgreSQL\n(конфигурация, состояние, метаданные)")]
      CH[("ClickHouse\n(метрики, трассировки, журналы)")]
      REDIS[("Redis\n(кеш, очереди, сессии)")]
    end

  end

  %% EXTERNAL / INTERNAL TARGETS
  EXT["Внешние ресурсы\n(публичные сайты/API, SaaS)"]
  INT["Внутренние ресурсы\n(частные приложения, БД, сервисы)"]

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
  P1 -->|результаты мониторинга| PROBEINGEST
  P2 -->|результаты мониторинга| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P2
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P2

  OTELCOLL["Коллектор/агенты OTel"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["Агенты мониторинга серверов"] --> SERVERMONINGEST

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

## Что показывает эта диаграмма
- Конечные пользователи получают доступ к OneUptime через Ingress вашего кластера (NGINX), который маршрутизирует трафик на UI и API.
- Основные сервисы читают/записывают состояние в PostgreSQL, Redis и ClickHouse.
- Зонды могут работать внутри вашего кластера (рекомендуется) и/или в другом месте вашей сети. Они могут отслеживать:
  - Внутренние/частные сервисы за брандмауэром.
  - Внешние/публичные ресурсы в интернете.
- Результаты зондов отправляются в приёмник зондов внутри вашего кластера, помещаются в очередь через Redis и обрабатываются фоновым воркером в ваших хранилищах данных.
- Телеметрия (метрики/трассировки/журналы) и данные серверов/агентов могут приниматься через специализированные сервисы приёма и храниться в ClickHouse.

> Примечание: Если вы используете внешние PostgreSQL, Redis или ClickHouse вместо встроенных, соединения от API/Worker/Ingest указывают на ваши внешние конечные точки. Логический поток остаётся тем же.
