# OneUptime 자체 호스팅 아키텍처

이 다이어그램은 자체 호스팅 환경에서 OneUptime이 일반적으로 어떻게 보이는지를 보여줍니다 (예: Kubernetes 클러스터), 프로브가 내부 및 외부 리소스를 모니터링하는 방법을 포함합니다.

```mermaid
flowchart TB
  %% 레이아웃
  %% 상단: 사용자 -> 인그레스 -> 웹 / API
  %% 중간: 핵심 서비스 + 수집 파이프라인
  %% 하단: 데이터 저장소

  %% 사용자 / 엣지
  U["최종 사용자 / 브라우저"]

  %% 클러스터 경계
  subgraph C["고객 네트워크 (자체 호스팅 Kubernetes 클러스터)"]
    direction TB

    subgraph Edge["인그레스 및 라우팅"]
      NGINX["NGINX 인그레스 (TLS)"]
    end

    subgraph Web["웹 및 API"]
      direction TB
      HOME["홈 / 대시보드 (UI)"]
      STATUS["상태 페이지 (UI)"]
      API["API 서버"]
      WORKER["백그라운드 워커"]
    end

    subgraph Ingest["수집 파이프라인"]
      direction TB
      PROBEINGEST["프로브 수집"]
      OTELINGEST["OpenTelemetry 수집"]
      FLUENTLOGS["로그 수집 (Fluent Bit)"]
      SERVERMONINGEST["서버 모니터 수집"]
      INCOMINGREQINGEST["수신 요청 수집"]
    end

    subgraph Probes["OneUptime 프로브"]
      direction TB
      P1["클러스터 내 프로브 파드"]
      P2["네트워크의 선택적 프로브 VM/컨테이너"]
    end

    %% 데이터 저장소
    subgraph Data["데이터 저장소"]
      direction LR
      PG[("PostgreSQL\n(구성, 상태, 메타데이터)")]
      CH[("ClickHouse\n(메트릭, 트레이스, 로그)")]
      REDIS[("Redis\n(캐시, 큐, 세션)")]
    end

  end

  %% 외부 / 내부 대상
  EXT["외부 리소스\n(공개 웹사이트/API, SaaS)"]
  INT["내부 리소스\n(프라이빗 앱, DB, 서비스)"]

  %% 흐름: 엣지
  U -->|HTTPS| NGINX
  NGINX --> HOME
  NGINX --> STATUS
  HOME -->|REST/gRPC| API
  STATUS -->|REST/gRPC| API
  NGINX --> API

  %% 흐름: 핵심 서비스 -> 데이터
  API --> PG
  API --> REDIS
  API --> CH
  WORKER --> PG
  WORKER --> REDIS
  WORKER --> CH

  %% 흐름: 수집
  P1 -->|모니터링 결과| PROBEINGEST
  P2 -->|모니터링 결과| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/Custom| P2
  INT <-->|HTTPS/TCP/Ping/DNS/Custom| P2

  OTELCOLL["OTel 콜렉터/에이전트"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["서버 모니터 에이전트"] --> SERVERMONINGEST

  %% 수집 흐름 -> 핵심 처리
  PROBEINGEST --> REDIS
  OTELINGEST --> CH
  FLUENTLOGS --> CH
  SERVERMONINGEST --> CH
  INCOMINGREQINGEST --> CH

  %% 워커가 큐에서 소비하고 저장소에 씁니다
  REDIS --> WORKER

  %% 참고 / 범례
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

## 이 다이어그램이 보여주는 것
- 최종 사용자는 클러스터의 인그레스 (NGINX)를 통해 OneUptime에 액세스하며, UI와 API로 라우팅됩니다.
- 핵심 서비스는 PostgreSQL, Redis 및 ClickHouse에 상태를 읽고 씁니다.
- 프로브는 클러스터 내부 (권장) 및/또는 네트워크의 다른 곳에서 실행될 수 있습니다. 다음을 모니터링할 수 있습니다:
  - 방화벽 뒤의 내부/프라이빗 서비스.
  - 인터넷의 외부/공개 리소스.
- 프로브 결과는 클러스터 내의 프로브 수집으로 전송되고, Redis를 통해 대기열에 들어가며, 백그라운드 워커에 의해 데이터 저장소로 처리됩니다.
- 텔레메트리 (메트릭/트레이스/로그) 및 서버/에이전트 데이터는 전용 수집 서비스를 통해 수집되고 ClickHouse에 저장될 수 있습니다.

> 참고: 내장된 것 대신 외부 PostgreSQL, Redis 또는 ClickHouse를 사용하는 경우 API/워커/수집에서의 연결이 외부 엔드포인트를 가리킵니다. 논리적 흐름은 동일하게 유지됩니다.
