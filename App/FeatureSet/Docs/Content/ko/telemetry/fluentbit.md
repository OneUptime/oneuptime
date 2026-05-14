# FluentBit을 사용하여 OneUptime에 텔레메트리 데이터 전송

## 개요

[FluentBit](https://docs.fluentbit.io/manual) 플러그인을 사용하여 애플리케이션 및 서비스에서 로그 및 텔레메트리 데이터를 수집할 수 있습니다. 플러그인은 텔레메트리 데이터를 OneUptime OpenTelemetry HTTP 콜렉터로 전송합니다. fluentbit의 opentelemetry 출력 플러그인을 사용하여 텔레메트리 데이터를 OneUptime OpenTelemetry HTTP 콜렉터로 전송할 수 있습니다. 이 플러그인은 여기에서 찾을 수 있습니다: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## 시작하기

FluentBit은 수백 가지 데이터 소스를 지원하며 이러한 소스 중 어디에서나 로그 및 텔레메트리를 OneUptime으로 수집할 수 있습니다. 인기 있는 소스에는 다음이 포함됩니다:

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust 

및 그 외 많은 것들. 

지원되는 소스의 전체 목록은 [여기](https://docs.fluentbit.io/manual)에서 찾을 수 있습니다.

## 전제 조건

- **1단계: 시스템에 FluentBit 설치** - [여기](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)에 제공된 지침을 사용하여 FluentBit을 설치할 수 있습니다
- **2단계: OneUptime 계정 가입** - [여기](https://oneuptime.com)에서 무료 계정에 가입할 수 있습니다. 계정은 무료이지만 로그 수집은 유료 기능임을 참고하십시오. 가격에 대한 자세한 내용은 [여기](https://oneuptime.com/pricing)에서 찾을 수 있습니다.
- **3단계: OneUptime 프로젝트 생성** - 계정이 있으면 OneUptime 대시보드에서 프로젝트를 생성할 수 있습니다. 프로젝트 생성에 대한 도움이 필요하거나 질문이 있으시면 support@oneuptime.com으로 연락하십시오
- **4단계: 텔레메트리 수집 토큰 생성** - OneUptime 계정을 만든 후 애플리케이션에서 로그, 메트릭 및 트레이스를 수집하기 위한 텔레메트리 수집 토큰을 생성할 수 있습니다.

OneUptime에 가입하고 프로젝트를 생성한 후. 내비게이션 바에서 "더보기"를 클릭하고 "프로젝트 설정"을 클릭합니다.

텔레메트리 수집 키 페이지에서 "수집 키 생성"을 클릭하여 토큰을 생성합니다. 

![서비스 생성](/docs/static/images/TelemetryIngestionKeys.png)

토큰을 생성한 후 "보기"를 클릭하여 토큰을 확인합니다.

![서비스 보기](/docs/static/images/TelemetryIngestionKeyView.png)


## 구성

다음 구성을 사용하여 텔레메트리 데이터를 OneUptime OpenTelemetry HTTP 콜렉터로 전송할 수 있습니다. fluentbit 구성 파일에 이 구성을 추가할 수 있습니다. 구성 파일은 일반적으로 `/etc/fluent-bit/fluent-bit.yaml`에 위치합니다. 구성 파일의 출력 섹션이 어떻게 보이는지에 대한 예시입니다:


```yaml


outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'oneuptime.com'
    port: 443
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    tls: On
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN

```

입력 섹션에 opentelemetry_envelope이 있는지 확인하십시오. 입력 섹션이 어떻게 보이는지에 대한 예시입니다:

```yaml
pipeline:
  inputs:
      # 귀하의 입력

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            # YOUR_SERVICE_NAME을 서비스 이름으로 교체하십시오
            value: YOUR_SERVICE_NAME
```

전체 구성 파일의 예시입니다:

```yaml
service:
  flush: 1
  log_level: info

pipeline:
  inputs:
    - name: http
      listen: 0.0.0.0
      port: 8888

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: '*'
    - name: opentelemetry
      match: '*'
      host: 'oneuptime.com'
      port: 443
      metrics_uri: '/otlp/v1/metrics'
      logs_uri: '/otlp/v1/logs'
      traces_uri: '/otlp/v1/traces'
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```


**OneUptime을 자체 호스팅하는 경우**: OneUptime을 자체 호스팅하는 경우 `host`를 OneUptime 인스턴스의 호스트로 교체할 수 있습니다. HTTPS가 아닌 HTTP 서버에서 호스팅하는 경우 `port`를 OneUptime 인스턴스의 포트 (포트 80일 가능성이 높음)로 교체할 수 있습니다.

이 경우 구성은 다음과 같이 됩니다:

```yaml
outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'your-oneuptime-instance.com'
    port: 80
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

## 사용

fluentbit 구성 파일에 구성을 추가한 후 fluentbit 서비스를 재시작할 수 있습니다. 서비스가 재시작되면 텔레메트리 데이터가 OneUptime HTTP 소스로 전송됩니다. 이제 OneUptime 대시보드에서 텔레메트리 데이터를 볼 수 있습니다. 구성에 대한 질문이 있거나 도움이 필요한 경우 support@oneuptime.com으로 연락하십시오.
