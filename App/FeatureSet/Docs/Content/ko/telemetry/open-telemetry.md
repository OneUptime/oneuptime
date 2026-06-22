# OpenTelemetry (로깅, 메트릭 및 트레이스)를 OneUptime과 통합합니다.

### 1단계 - 텔레메트리 수집 토큰 생성.

OneUptime 계정을 만든 후 애플리케이션에서 로그, 메트릭 및 트레이스를 수집하기 위한 텔레메트리 수집 토큰을 생성할 수 있습니다.

OneUptime에 가입하고 프로젝트를 생성한 후. 내비게이션 바에서 "더보기"를 클릭하고 "프로젝트 설정"을 클릭합니다.

텔레메트리 수집 키 페이지에서 "수집 키 생성"을 클릭하여 토큰을 생성합니다.

![서비스 생성](/docs/static/images/TelemetryIngestionKeys.png)

토큰을 생성한 후 "보기"를 클릭하여 토큰을 확인합니다.

![서비스 보기](/docs/static/images/TelemetryIngestionKeyView.png)

### 2단계

#### 애플리케이션에서 텔레메트리 서비스를 구성합니다.

#### 애플리케이션 로그

OpenTelemetry를 사용하여 애플리케이션 로그를 수집합니다. OneUptime은 현재 이러한 OpenTelemetry SDK에서 로그 수집을 지원합니다. 다음 지침에 따라 애플리케이션에서 텔레메트리 서비스를 구성하십시오.

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / Typescript / NodeJS / Browser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)

**OneUptime과 통합**

애플리케이션에서 텔레메트리 서비스를 구성한 후 다음 환경 변수를 설정하여 OneUptime과 통합할 수 있습니다.

| 환경 변수                   | 값                                             |
| --------------------------- | ---------------------------------------------- |
| OTEL_EXPORTER_OTLP_HEADERS  | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp                     |
| OTEL_SERVICE_NAME           | NAME_OF_YOUR_SERVICE                           |

**예시**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**자체 호스팅 OneUptime**

OneUptime을 자체 호스팅하는 경우 자체 호스팅 OpenTelemetry 콜렉터 엔드포인트로 변경할 수 있습니다 (예: `http(s)://YOUR-ONEUPTIME-HOST/otlp`)

애플리케이션을 실행하면 OneUptime 텔레메트리 서비스 페이지에서 로그를 볼 수 있습니다. 도움이 필요한 경우 support@oneuptime.com으로 연락하십시오.

#### OpenTelemetry 콜렉터 사용

애플리케이션에서 직접 텔레메트리 데이터를 전송하는 대신 OpenTelemetry 콜렉터를 사용할 수도 있습니다.
OpenTelemetry 콜렉터를 사용하는 경우 콜렉터 구성 파일에서 OneUptime 내보내기를 구성할 수 있습니다.

다음은 OpenTelemetry 콜렉터에 대한 예시 구성입니다.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  # HTTP를 통해 내보내기
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # 기본 Proto(buf) 대신 JSON 인코더 사용 필요
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # OneUptime 토큰

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
```
