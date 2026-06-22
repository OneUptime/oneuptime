# OneUptimeセルフホストのアーキテクチャ

以下の図は、OneUptimeが自社環境（例：Kubernetesクラスター）にセルフホストされる場合の一般的な構成と、プローブが内部・外部リソースを監視する方法を示しています。

```mermaid
flowchart TB
  %% LAYOUT
  %% 上部: ユーザー -> イングレス -> Web / API
  %% 中部: コアサービス + インジェストパイプライン
  %% 下部: データストア

  %% ユーザー / エッジ
  U["エンドユーザー / ブラウザ"]

  %% クラスター境界
  subgraph C["カスタマーネットワーク（セルフホストKubernetesクラスター）"]
    direction TB

    subgraph Edge["イングレス & ルーティング"]
      NGINX["NGINXイングレス（TLS）"]
    end

    subgraph Web["Web & API"]
      direction TB
      HOME["ホーム / ダッシュボード（UI）"]
      STATUS["ステータスページ（UI）"]
      API["APIサーバー"]
      WORKER["バックグラウンドワーカー"]
    end

    subgraph Ingest["インジェストパイプライン"]
      direction TB
      PROBEINGEST["プローブインジェスト"]
      OTELINGEST["OpenTelemetryインジェスト"]
      FLUENTLOGS["ログインジェスト（Fluent Bit）"]
      SERVERMONINGEST["サーバーモニターインジェスト"]
      INCOMINGREQINGEST["受信リクエストインジェスト"]
    end

    subgraph Probes["OneUptimeプローブ"]
      direction TB
      P1["クラスター内のプローブPod"]
      P2["ネットワーク上のオプションのプローブVM/コンテナ"]
    end

    %% データストア
    subgraph Data["データストア"]
      direction LR
      PG[("PostgreSQL\n（設定、状態、メタデータ）")]
      CH[("ClickHouse\n（メトリクス、トレース、ログ）")]
      REDIS[("Redis\n（キャッシュ、キュー、セッション）")]
    end

  end

  %% 外部 / 内部ターゲット
  EXT["外部リソース\n（公開ウェブサイト/API、SaaS）"]
  INT["内部リソース\n（プライベートアプリ、DB、サービス）"]

  %% フロー: エッジ
  U -->|HTTPS| NGINX
  NGINX --> HOME
  NGINX --> STATUS
  HOME -->|REST/gRPC| API
  STATUS -->|REST/gRPC| API
  NGINX --> API

  %% フロー: コアサービス -> データ
  API --> PG
  API --> REDIS
  API --> CH
  WORKER --> PG
  WORKER --> REDIS
  WORKER --> CH

  %% フロー: インジェスト
  P1 -->|監視結果| PROBEINGEST
  P2 -->|監視結果| PROBEINGEST

  EXT <-->|HTTPS/TCP/Ping/DNS/カスタム| P1
  INT <-->|HTTPS/TCP/Ping/DNS/カスタム| P1
  EXT <-->|HTTPS/TCP/Ping/DNS/カスタム| P2
  INT <-->|HTTPS/TCP/Ping/DNS/カスタム| P2

  OTELCOLL["OTelコレクター/エージェント"] --> OTELINGEST
  FLUENT["Fluentd / Fluent Bit"] --> FLUENTLOGS
  SERVERAGENTS["サーバーモニターエージェント"] --> SERVERMONINGEST

  %% インジェストフロー -> コア処理
  PROBEINGEST --> REDIS
  OTELINGEST --> CH
  FLUENTLOGS --> CH
  SERVERMONINGEST --> CH
  INCOMINGREQINGEST --> CH

  %% ワーカーはキューから消費してストアに書き込む
  REDIS --> WORKER

  %% 注意 / 凡例
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

## 図の説明

- エンドユーザーはクラスターのイングレス（NGINX）経由でOneUptimeにアクセスし、UIとAPIにルーティングされます。
- コアサービスはPostgreSQL、Redis、ClickHouseで状態を読み書きします。
- プローブはクラスター内（推奨）や、ネットワーク上の別の場所でも実行できます。プローブは以下を監視できます：
  - ファイアウォールの内側にある内部/プライベートサービス。
  - インターネット上の外部/公開リソース。
- プローブの結果はクラスター内のプローブインジェストに送信され、Redisを通じてキューに入れられ、バックグラウンドワーカーによってデータストアに処理されます。
- テレメトリー（メトリクス/トレース/ログ）とサーバー/エージェントデータは専用のインジェストサービス経由で取り込まれ、ClickHouseに保存されます。

> 注意：内蔵のPostgreSQL、Redis、ClickHouseの代わりに外部のものを使用する場合、API/ワーカー/インジェストからの接続は外部エンドポイントを指します。論理的なフローは同じです。
