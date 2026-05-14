# OneUptime에 연속 프로파일링 데이터 전송

## 개요

연속 프로파일링은 로그, 메트릭 및 트레이스와 함께 관측 가능성의 네 번째 기둥입니다. 프로파일은 애플리케이션이 CPU 시간을 소비하고, 메모리를 할당하고, 함수 수준에서 시스템 리소스를 사용하는 방법을 캡처합니다. OneUptime은 OpenTelemetry 프로토콜(OTLP)을 통해 프로파일링 데이터를 수집하고 다른 텔레메트리 신호와 함께 저장하여 통합 분석을 제공합니다.

OneUptime의 프로파일링 데이터를 통해 CPU를 많이 소비하는 핫 함수를 식별하고, 메모리 누수를 감지하고, 경합 병목을 찾고, 특정 트레이스 및 스팬과 성능 문제를 연결할 수 있습니다.

## 지원되는 프로파일 유형

OneUptime은 다음 프로파일 유형을 지원합니다:

| 프로파일 유형 | 설명 | 단위 |
| --- | --- | --- |
| cpu | 코드 실행에 소비된 CPU 시간 | 나노초 |
| wall | 벽시계 시간 (대기/수면 포함) | 나노초 |
| alloc_objects | 힙 할당 수 | 카운트 |
| alloc_space | 할당된 힙 메모리 바이트 | 바이트 |
| goroutine | 활성 goroutine 수 (Go) | 카운트 |
| contention | 잠금/뮤텍스에서 기다리는 시간 | 나노초 |

## 시작하기

### 1단계 - 텔레메트리 수집 토큰 생성

OneUptime에 가입하고 프로젝트를 생성한 후 내비게이션 바에서 "더보기"를 클릭하고 "프로젝트 설정"을 클릭합니다.

텔레메트리 수집 키 페이지에서 "수집 키 생성"을 클릭하여 토큰을 생성합니다.

![서비스 생성](/docs/static/images/TelemetryIngestionKeys.png)

토큰을 생성한 후 "보기"를 클릭하여 토큰을 확인합니다.

![서비스 보기](/docs/static/images/TelemetryIngestionKeyView.png)

### 2단계 - 프로파일러 구성

OneUptime은 OTLP 프로파일 프로토콜을 사용하여 gRPC 및 HTTP 모두를 통해 프로파일링 데이터를 허용합니다.

| 프로토콜 | 엔드포인트 |
| --- | --- |
| gRPC | `your-oneuptime-host:4317` (OTLP 표준 gRPC 포트) |
| HTTP | `https://your-oneuptime-host/otlp/v1/profiles` |

**환경 변수**

프로파일러를 OneUptime으로 지정하려면 다음 환경 변수를 설정합니다:

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**자체 호스팅 OneUptime**

OneUptime을 자체 호스팅하는 경우 엔드포인트를 자체 호스트로 교체합니다 (예: `http(s)://YOUR-ONEUPTIME-HOST/otlp`). gRPC의 경우 OneUptime 호스트의 포트 4317에 직접 연결합니다.

## 계측 가이드

### Grafana Alloy 사용 (eBPF 기반 프로파일링)

Grafana Alloy (이전 Grafana Agent)는 코드 변경 없이 eBPF를 사용하여 Linux 호스트의 모든 프로세스에서 CPU 프로파일을 수집할 수 있습니다. OneUptime으로 OTLP를 통해 내보내도록 구성합니다.

Alloy 구성 예시:

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

### async-profiler 사용 (Java)

Java 애플리케이션의 경우 OTLP를 통해 프로파일링 데이터를 전송하기 위해 OpenTelemetry Java 에이전트와 함께 [async-profiler](https://github.com/async-profiler/async-profiler)를 사용합니다.

```bash
# OpenTelemetry Java 에이전트로 Java 애플리케이션 시작
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### OTLP 내보내기를 사용한 Go pprof

Go 애플리케이션의 경우 OTLP 내보내기와 함께 표준 `net/http/pprof` 패키지를 사용할 수 있습니다. pprof 데이터를 주기적으로 수집하고 OneUptime으로 전달하여 연속 프로파일링을 구성합니다.

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// 30초 CPU 프로파일을 수집하고 주기적으로 내보내기
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // pprof 출력을 OTLP 형식으로 변환하고 OneUptime으로 전송
}
```

또는 Go 애플리케이션의 `/debug/pprof` 엔드포인트를 스크랩하는 프로파일링 수신기가 있는 OpenTelemetry 콜렉터를 사용하고 OTLP를 통해 내보냅니다.

### py-spy 사용 (Python)

Python 애플리케이션의 경우 [py-spy](https://github.com/benfred/py-spy)는 코드 변경 없이 CPU 프로파일을 캡처할 수 있습니다. OpenTelemetry 콜렉터를 사용하여 프로파일 데이터를 수신하고 전달합니다.

```bash
# 프로파일을 캡처하고 로컬 OTLP 콜렉터로 전송
py-spy record --format speedscope --pid $PID -o profile.json
```

연속 프로파일링의 경우 애플리케이션과 함께 py-spy를 실행하고 OneUptime으로 프로파일을 전달하도록 OpenTelemetry 콜렉터를 구성합니다.

## OpenTelemetry 콜렉터 사용

OpenTelemetry 콜렉터를 프록시로 사용하여 애플리케이션에서 프로파일을 수신하고 OneUptime으로 전달할 수 있습니다.

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

## 기능

### Flamegraph 시각화

OneUptime은 프로파일 데이터를 대화형 flamegraph로 렌더링합니다. 각 막대는 호출 스택의 함수를 나타내며 너비는 소비된 시간이나 리소스에 비례합니다. 어떤 함수든 클릭하여 확대하고 호출자와 피호출자를 볼 수 있습니다.

### 함수 목록

프로파일에 캡처된 모든 함수를 자체 시간, 총 시간 또는 할당 카운트로 정렬할 수 있는 테이블로 봅니다. 이를 통해 애플리케이션에서 가장 비용이 많이 드는 함수를 빠르게 식별할 수 있습니다.

### 트레이스 연결

OneUptime의 프로파일은 분산 트레이스와 연결될 수 있습니다. 프로파일에 트레이스 및 스팬 ID가 포함된 경우 (OTLP 링크 테이블을 통해) 느린 트레이스 스팬에서 해당 CPU 또는 메모리 프로파일로 직접 이동하여 실행 중인 코드를 정확히 이해할 수 있습니다.

### 프로파일 유형별 필터링

특정 리소스 차원에 집중하기 위해 유형별 프로파일을 필터링합니다 (cpu, wall, alloc_objects, alloc_space, goroutine, contention).

## 데이터 보존

프로파일 데이터 보존은 OneUptime 프로젝트 설정에서 텔레메트리 서비스당 구성됩니다. 기본 보존 기간은 15일입니다. 데이터는 보존 기간이 만료된 후 자동으로 삭제됩니다.

서비스의 보존 기간을 변경하려면 **텔레메트리 > 서비스 > [귀하의 서비스] > 설정**으로 이동하여 데이터 보존 값을 업데이트합니다.

## 도움이 필요하신가요?

OneUptime으로 프로파일링 설정에 도움이 필요한 경우 support@oneuptime.com으로 연락하십시오.
