# OneUptimeに継続的プロファイリングデータを送信する

## 概要

継続的プロファイリングは、ログ、メトリクス、トレースに並ぶ可観測性の第4の柱です。プロファイリングはアプリケーションがCPU時間をどのように使用し、メモリを割り当て、システムリソースを関数レベルで使用しているかをキャプチャします。OneUptimeはOpenTelemetryプロトコル（OTLP）を介してプロファイリングデータを取り込み、統合的な分析のために他のテレメトリーシグナルと並べて保存します。

OneUptimeのプロファイリングデータを使用すると、CPU時間を消費するホットな関数を特定し、メモリリークを検出し、競合のボトルネックを見つけ、特定のトレースやスパンとパフォーマンス問題を相関させることができます。

## サポートされるプロファイルタイプ

OneUptimeは以下のプロファイルタイプをサポートしています：

| プロファイルタイプ | 説明                                        | 単位   |
| ------------------ | ------------------------------------------- | ------ |
| cpu                | コードの実行に費やされたCPU時間             | ナノ秒 |
| wall               | 壁時計時間（待機・スリープを含む）          | ナノ秒 |
| alloc_objects      | ヒープ割り当ての数                          | 件数   |
| alloc_space        | 割り当てられたヒープメモリのバイト数        | バイト |
| goroutine          | アクティブなゴルーチンの数（Go）            | 件数   |
| contention         | ロック/ミューテックスの待機に費やされた時間 | ナノ秒 |

## はじめに

### ステップ1 — テレメトリー取り込みトークンの作成

OneUptimeに登録してプロジェクトを作成した後、ナビゲーションバーの「More」をクリックし、「プロジェクト設定」をクリックします。

テレメトリー取り込みキーページで、「取り込みキーの作成」をクリックしてトークンを作成します。

![サービスの作成](/docs/static/images/TelemetryIngestionKeys.png)

トークンを作成したら、「表示」をクリックしてトークンを確認します。

![サービスの表示](/docs/static/images/TelemetryIngestionKeyView.png)

### ステップ2 — プロファイラーの設定

OneUptimeはOTLPプロファイルプロトコルを使用して、gRPCとHTTPの両方でプロファイリングデータを受け付けます。

| プロトコル | エンドポイント                                   |
| ---------- | ------------------------------------------------ |
| gRPC       | `your-oneuptime-host:4317`（OTLP標準gRPCポート） |
| HTTP       | `https://your-oneuptime-host/otlp/v1/profiles`   |

**環境変数**

プロファイラーをOneUptimeに向けるために以下の環境変数を設定します：

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**セルフホストのOneUptime**

OneUptimeをセルフホストしている場合は、エンドポイントを自分のホストに変更してください（例：`http(s)://YOUR-ONEUPTIME-HOST/otlp`）。gRPCの場合は、OneUptimeホストのポート4317に直接接続します。

## インストルメンテーションガイド

### Grafana Alloyを使用する（eBPFベースのプロファイリング）

Grafana Alloy（旧Grafana Agent）はeBPFを使用してコードの変更なしにLinuxホスト上のすべてのプロセスのCPUプロファイルを収集できます。OTLPを介してOneUptimeにエクスポートするように設定します。

Alloyの設定例：

```hcl
pyroscope.ebpf "default" {
  forward_to = [pyroscope.write.oneuptime.receiver]
  targets    = discovery.process.all.targets
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "YOUR_ONEUPTIME_SERVICE_TOKEN",
    }
  }
}
```

### async-profilerを使用する（Java）

Javaアプリケーションの場合、[async-profiler](https://github.com/async-profiler/async-profiler) をOpenTelemetry Javaエージェントと共に使用してOTLP経由でプロファイリングデータを送信します。

```bash
# OpenTelemetry Javaエージェント付きでJavaアプリケーションを起動
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### GoのpprofとOTLPエクスポートを使用する

Goアプリケーションの場合、標準の `net/http/pprof` パッケージとOTLPエクスポーターを組み合わせて使用できます。pprofデータを定期的に収集してOneUptimeに転送することで継続的プロファイリングを設定します。

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// 30秒間のCPUプロファイルを収集して定期的にエクスポート
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // pprofの出力をOTLP形式に変換してOneUptimeに送信
}
```

または、GoアプリケーションのN`/debug/pprof` エンドポイントをスクレイプするプロファイリングレシーバーを持つOpenTelemetryコレクターを使用してOTLP経由でエクスポートします。

### py-spyを使用する（Python）

Pythonアプリケーションの場合、[py-spy](https://github.com/benfred/py-spy) はコードの変更なしにCPUプロファイルをキャプチャできます。OpenTelemetryコレクターを使用してプロファイルデータを受信・転送します。

```bash
# プロファイルをキャプチャしてローカルのOTLPコレクターに送信
py-spy record --format speedscope --pid $PID -o profile.json
```

継続的プロファイリングの場合、アプリケーションと並行してpy-spyを実行し、OpenTelemetryコレクターを設定してプロファイルをOneUptimeに取り込み・転送します。

## OpenTelemetryコレクターを使用する

OpenTelemetryコレクターをプロキシとして使用して、アプリケーションからプロファイルを受信し、OneUptimeに転送できます。

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_ONEUPTIME_SERVICE_TOKEN"

service:
  pipelines:
    profiles:
      receivers: [otlp]
      exporters: [otlphttp]
```

## 機能

### フレームグラフの可視化

OneUptimeはプロファイルデータをインタラクティブなフレームグラフとして描画します。各バーはコールスタック内の関数を表し、その幅は消費された時間やリソースに比例します。任意の関数をクリックしてズームインし、呼び出し元と呼び出し先を確認できます。

### 関数リスト

プロファイルにキャプチャされたすべての関数のソートテーブルを表示し、自己時間、合計時間、または割り当て数でランク付けします。アプリケーション内で最もコストのかかる関数を素早く特定するのに役立ちます。

### トレースとの相関

OneUptimeのプロファイリングデータは分散トレースと相関させることができます。プロファイルにトレースとスパンIDが含まれている場合（OTLPリンクテーブル経由）、遅いトレーススパンから対応するCPUまたはメモリプロファイルに直接移動して、どのコードが実行されていたかを正確に把握できます。

### プロファイルタイプによるフィルタリング

プロファイルタイプ（cpu、wall、alloc_objects、alloc_space、goroutine、contention）でフィルタリングして、調査している特定のリソースディメンションに集中できます。

## データ保持

プロファイルデータの保持期間はOneUptimeプロジェクト設定でテレメトリーサービスごとに設定できます。デフォルトの保持期間は15日間です。保持期間が過ぎるとデータは自動的に削除されます。

サービスの保持期間を変更するには、**テレメトリー > サービス > [対象サービス] > 設定** に移動して、データ保持値を更新します。

## サポート

OneUptimeでのプロファイリング設定に関してご不明な点がある場合は、support@oneuptime.com にお問い合わせください。
