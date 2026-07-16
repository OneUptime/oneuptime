# OneUptime IoT 장치

## 개요

OneUptime은 소수의 `iot_*` 메트릭을 수집하여 IoT 장치 플릿 — 센서, 게이트웨이, 컨트롤러, 엣지 박스 — 을 모니터링합니다. 각 측정값에는 어느 **플릿**에 속하는지와 자신의 **장치 id**가 태그로 함께 전송됩니다. OneUptime은 이러한 메트릭을 플릿으로 그룹화하고, 실시간 장치 인벤토리를 구축하며, 장치별 배터리, 연결 상태, 온도, CPU, 메모리, 가용성을 추적합니다.

장치는 두 가지 방식으로 측정값을 푸시할 수 있으며, 두 방식 모두 완전히 동일한 플릿 인벤토리, 대시보드, 모니터로 연결됩니다:

- **OpenTelemetry(OTLP)** — 장치의 OTel SDK, 또는 여러 장치로 팬아웃하는 게이트웨이에서 실행되는 OpenTelemetry Collector.
- **MQTT** — OneUptime의 내장 MQTT 엔드포인트(`wss://<your-host>/mqtt`의 WebSocket을 통한 MQTT, 또는 자체 호스팅 배포의 원시 MQTT TCP)에 직접 연결하여 JSON 측정값을 게시하세요. collector가 필요 없으며, Last Will 지원으로 즉각적인 오프라인 감지가 가능합니다.

장치 쪽에 설치할 독점 에이전트는 없습니다. 이 페이지는 **수집 가이드**입니다. 푸시한 데이터를 기반으로 IoT 모니터와 알림을 구성하려면 [IoT 장치 모니터](/docs/monitor/iot-device-monitor)를 참조하세요.

## 사전 요구 사항

- OneUptime으로 OTLP/HTTP를 전송할 수 있는 장치, 게이트웨이 또는 collector
- 장치/게이트웨이에서 OneUptime 인스턴스로의 네트워크 도달성
- **OneUptime 텔레메트리 수집 토큰** — _Project Settings → Telemetry Ingestion Keys_ 에서 하나 생성하고 `x-oneuptime-token` 값을 복사하세요

## OneUptime이 IoT를 모델링하는 방식

OneUptime은 OpenTelemetry 리소스 속성을 사용하여 장치를 두 가지 개념으로 매핑합니다:

- **플릿(Fleet)** — 장치의 논리적 그룹(예: `building-a-sensors` 또는 `field-gateways`). 플릿은 `iot.fleet.name` 리소스 속성에서 파생되며 OneUptime에서 텔레메트리 서비스 `iot/<fleet>`로 나타납니다. 로그와 메트릭이 동일한 서비스 아래에 정렬되도록 `service.name=iot/<fleet>`를 설정하세요.
- **장치(Device)** — 플릿 내의 개별 장치로, `device.id` 속성으로 식별됩니다. OneUptime은 `device.id`를 키로 하는 플릿별 장치 인벤토리를 구축하고 유지합니다.

선택적 속성은 각 장치가 모니터에서 분류되고 범위가 지정되는 방식을 세분화합니다:

| 속성                  | 필수 여부 | 설명                                                                              |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | 예       | 이 장치가 속한 플릿. OneUptime 서비스 `iot/<fleet>`가 됩니다                         |
| `device.id`          | 예       | 플릿 내에서 장치를 식별하는 안정적이고 고유한 id                                       |
| `iot.device.kind`    | 아니오    | 장치 클래스 — 예: `Device`, `Sensor`, `Gateway`. 기본값은 `Device`                  |
| `iot.device.type`    | 아니오    | 모니터 필터링에 사용되는 더 세분화된 장치 유형/모델(예: `temp-sensor`)                |
| `iot.device.firmware`| 아니오    | 장치가 보고하는 펌웨어 버전                                                         |

## OpenTelemetry SDK를 통한 메트릭 전송

장치가 OpenTelemetry SDK를 직접 실행하는 경우, 이를 OneUptime으로 향하게 하고 표준 `OTEL_*` 환경 변수를 통해 IoT 리소스 속성을 찍으세요. 토큰, 엔드포인트, 플릿 이름, 장치 id를 사용자 환경에 맞는 값으로 교체하세요.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| 환경 변수                       | 필수 여부 | 설명                                                                                                  |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 예       | OneUptime OTLP 엔드포인트(`https://oneuptime.com/otlp`, 또는 자체 호스팅 시 `http(s)://YOUR-ONEUPTIME-HOST/otlp`) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | 예       | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | 예       | 쉼표로 구분된 리소스 속성. `iot.fleet.name`, `device.id`, `service.name=iot/<fleet>`를 반드시 포함해야 합니다 |

아래 `iot_*` 이름을 사용하여 측정값을 메트릭으로 내보내세요(자세한 내용은 [메트릭 규칙](#메트릭-규칙) 참조). 약 1분 이내에 장치가 OneUptime 대시보드의 **IoT** 섹션에 나타납니다.

## OpenTelemetry Collector를 통한 메트릭 전송

많은 장치가 게이트웨이를 통해 보고하는 경우, 게이트웨이에서 OpenTelemetry Collector를 실행하고 OneUptime으로 내보내세요. `resource` 프로세서는 플릿 속성을 찍습니다. 장치에서 측정값(OTLP, MQTT 브리지, 파일 로그 등)을 받아 전달하세요:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: iot.fleet.name
        value: field-gateways
        action: upsert
      - key: service.name
        value: iot/field-gateways
        action: upsert

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** 는 모든 레코드에 플릿 속성을 찍습니다. 각 게이트웨이의 장치가 올바른 플릿에 도착하도록 게이트웨이마다 `iot.fleet.name`(및 일치하는 `service.name=iot/<fleet>`)을 설정하세요.
- OneUptime이 플릿 내에서 개별 장치를 확인할 수 있도록 각 데이터포인트에 `device.id`(및 선택적으로 `iot.device.kind` / `iot.device.type` / `iot.device.firmware`)를 유지하세요.
- **`otlphttp`** 는 수집 토큰을 첨부하여 HTTPS를 통해 OneUptime으로 전송합니다. 기본 protobuf 인코딩과 `encoding: json` 모두 허용됩니다.

## MQTT를 통한 메트릭 전송

OneUptime은 내장 MQTT 엔드포인트를 제공하므로, 이미 MQTT를 말할 수 있는 장치는 측정값을 직접 푸시할 수 있습니다 — OpenTelemetry SDK, collector, 브리지가 필요하지 않습니다. MQTT를 통해 게시된 모든 것은 OTLP와 동일한 파이프라인에 도착합니다. 플릿이 자동으로 생성되고, 장치 인벤토리가 업데이트되며, 모든 IoT 모니터와 알림 템플릿이 변경 없이 동작합니다.

**엔드포인트**

| 전송 방식                | 주소                                    | 참고                                                                                       |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| WebSocket을 통한 MQTT    | `wss://<your-host>/mqtt`               | 모든 배포에서 동작합니다 — OneUptime 인그레스를 통해 일반 HTTPS 포트를 사용합니다              |
| TCP를 통한 MQTT          | `<app-host>:1883` (`MQTT_INGEST_PORT`) | 자체 호스팅: 기본적으로 클러스터/compose 네트워크 내부 전용입니다. 필요한 경우 노출하세요       |

**인증** — 두 가지 옵션이 있습니다:

- **프로젝트 전체**: **텔레메트리 수집 토큰**을 MQTT 비밀번호로 전송하세요(사용자 이름은 무시됩니다. 클라이언트가 사용자 이름 필드만 제공하는 경우 거기에 토큰을 넣으세요). 여러 장치를 대신하여 게시하는 게이트웨이에 적합합니다.
- **장치별**(직접 연결하는 장치에 권장): 대시보드의 플릿 **Device Registry** 탭에서 장치를 등록하세요. 등록하면 장치별 자격 증명이 발급됩니다 — 자격 증명 ID가 MQTT **사용자 이름**이고 시크릿이 **비밀번호**입니다. 장치로 인증된 클라이언트는 자신의 `oneuptime/<fleet>/<device>/…` 토픽 아래에만 게시할 수 있고, 손상된 장치 하나를 플릿의 나머지 부분을 건드리지 않고 대시보드에서 취소할 수 있으며(취소는 연결된 세션에 대해서도 약 1분 이내에 적용됩니다), 등록된 장치는 **조용한 종료 오프라인 감지** 기능을 얻습니다. 즉, 보고를 중단해도 인벤토리에서 사라지지 않고 Offline 상태로 남아 있으며, Last Will 없이 종료되더라도 Device Offline 알림 템플릿이 발동합니다.

유효하지 않은 자격 증명은 CONNECT 시 반환 코드 4(잘못된 사용자 이름 또는 비밀번호)로 거부되므로, 잘못 구성된 장치는 명확하게 실패합니다.

**토픽** — 고정된 `oneuptime/` 접두사 아래에 게시하세요. 플릿과 장치 세그먼트에는 `/`, `+`, `#`가 포함되어서는 안 되며 100자로 제한됩니다:

| 토픽                                              | 페이로드                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | 측정값의 JSON 객체 — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`, 또는 숫자 필드가 메트릭인 평면 객체 |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| 단일 값 — 순수한 숫자(`23.4`) 또는 `{ "value": 23.4 }`                                                 |
| `oneuptime/<fleet>/<device>/status`              | `"online"` 또는 `"offline"`(`1`/`0`, `true`/`false`, `up`/`down`도 가능) — `iot_device_up`에 매핑됩니다 |

텔레메트리 페이로드는 `"attributes"`(모든 데이터포인트에 찍히는 문자열 맵 — `iot.device.kind`, `iot.device.type`, `iot.device.firmware` 또는 사용자 정의 레이블에 사용하세요)와 `"timestamp"`(ISO-8601, 또는 유닉스 초/밀리초)를 함께 전달할 수도 있습니다. 둘 다 선택 사항이며, `timestamp`가 없으면 수집 시각이 사용됩니다.

**Last Will을 통한 오프라인 감지** — `oneuptime/<fleet>/<device>/status`에 페이로드 `offline`로 MQTT Last Will을 등록하세요. 장치가 종료되거나 네트워크에서 떨어지면, 세션이 끝나는 순간 브로커가 장치를 대신하여 `iot_device_up = 0`을 게시합니다 — 이는 기본 **Device Offline** 알림 템플릿을 발동시키고 인벤토리에서 장치를 Down으로 전환하며, 폴링도 필요 없고 누락된 스크레이프를 기다릴 필요도 없습니다. 연결 후 동일한 토픽에 `online`을 게시하면 장치가 다시 Up으로 표시됩니다.

`mosquitto_pub` 예시(원시 TCP, 자체 호스팅):

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

WebSocket을 통한 Node.js `mqtt` 예시(oneuptime.com 및 모든 자체 호스팅 인스턴스에서 동작합니다):

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // 무시됩니다 — 아래의 토큰이 인증을 수행합니다
  password: "YOUR_TELEMETRY_INGESTION_TOKEN",
  will: {
    topic: "oneuptime/building-a-sensors/sensor-001/status",
    payload: "offline",
  },
});

client.on("connect", () => {
  client.publish("oneuptime/building-a-sensors/sensor-001/status", "online");
  setInterval(() => {
    client.publish(
      "oneuptime/building-a-sensors/sensor-001/telemetry",
      JSON.stringify({
        metrics: {
          iot_device_up: 1,
          iot_battery_percent: readBattery(),
          iot_temperature_celsius: readTemperature(),
        },
      }),
    );
  }, 60 * 1000);
});
```

WebSocket을 통한 Python `paho-mqtt` 예시:

```python
import json
import paho.mqtt.client as mqtt

client = mqtt.Client(transport="websockets")
client.username_pw_set("oneuptime", "YOUR_TELEMETRY_INGESTION_TOKEN")
client.tls_set()
client.will_set("oneuptime/building-a-sensors/sensor-001/status", "offline")
client.ws_set_options(path="/mqtt")
client.connect("oneuptime.com", 443)

client.publish("oneuptime/building-a-sensors/sensor-001/status", "online")
client.publish(
    "oneuptime/building-a-sensors/sensor-001/telemetry",
    json.dumps({"metrics": {"iot_device_up": 1, "iot_temperature_celsius": 21.5}}),
)
```

참고 사항:

- 이 엔드포인트는 **수집 전용**입니다. 구독은 거부됩니다(SUBACK 실패). 브로커가 수신을 확인하기를 원하면 QoS 1을 사용하세요. 수집은 **최소 한 번(at-least-once)** 입니다 — 확인 응답이 유실된 후 QoS 1/2 재전송이 발생하면 중복 데이터포인트가 생길 수 있습니다.
- 토픽 계약을 벗어난 게시나 잘못된 형식의 페이로드는 수락된 뒤 **폐기됩니다**(MQTT 3.1.1에는 메시지별 오류 응답이 없습니다) — 서버가 그 이유를 경고 로그로 남기므로, 데이터가 도착하지 않으면 OneUptime 앱 로그를 확인하세요.
- WebSocket 엔드포인트에서는 MQTT keepalive를 **5분 미만**으로 유지하세요 — OneUptime 인그레스는 유휴 WebSocket 연결을 300초 후에 닫으며, 이는 Last Will을 발동시켜 잘못된 Device Offline 알림을 유발합니다. 클라이언트 라이브러리 기본값(`mqtt`와 `paho-mqtt` 모두 60초)이면 충분합니다. 원시 TCP 엔드포인트에는 그러한 상한이 없습니다.
- 페이로드는 게시당 128KB 및 100개 메트릭으로 제한됩니다. 초과된 패킷은 연결을 끊습니다.

## 메트릭 규칙

OneUptime은 다음 `iot_*` 메트릭 이름을 인식합니다. 각 데이터포인트는 측정값이 올바른 장치에 귀속되도록 `device.id` 레이블을 포함해야 합니다. 장치에 적합한 메트릭만 보내면 됩니다 — 누락된 메트릭은 단순히 차트에 표시되지 않습니다.

| 메트릭 이름                  | 의미                                                                            |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | 장치 가용성. `1` = 작동/도달 가능, `0` = 다운. IoT 장치 모니터를 구동합니다       |
| `iot_device_info`           | 식별 전용 신호. `device.id` / kind / type / firmware를 포함하여 장치가 측정값을 보고하기 전에도 인벤토리에 나타나게 합니다 |
| `iot_battery_percent`       | 배터리 충전 수준, `0`–`100`(%)                                                  |
| `iot_signal_strength_dbm`   | dBm 단위의 무선 신호 강도(예: Wi-Fi / LoRa / 셀룰러 RSSI)                         |
| `iot_temperature_celsius`   | °C 단위의 장치 또는 센서 온도                                                    |
| `iot_cpu_usage_ratio`       | `0`–`1` 비율로 표현된 CPU 사용률(OneUptime은 이를 백분율로 저장합니다)             |
| `iot_memory_usage_bytes`    | 현재 사용 중인 메모리, bytes 단위                                                |
| `iot_memory_size_bytes`     | 장치에서 사용 가능한 총 메모리, bytes 단위                                        |
| `iot_uptime_seconds`        | 장치가 마지막으로 부팅된 이후의 초                                                |

## 설치 확인

1. 장치 또는 게이트웨이가 오류 없이 내보내고 있는지 확인하세요(SDK/collector 로그에서 내보내기 실패 및 HTTP `401`/`403` 응답을 확인).
2. OneUptime 대시보드에서 **IoT** 섹션을 여세요 — 플릿이 약 1분 이내에 `iot/<fleet>`로 나타나야 합니다.
3. 플릿의 **Devices** 탭을 여세요 — 전송한 각 `device.id`가 최신 배터리, 신호, 온도, CPU, 메모리 및 작동/다운 상태와 함께 나열되어야 합니다.
4. 플릿 아래의 **Metrics**를 열어 위의 `iot_*` 시리즈를 차트로 표시하세요.

## 문제 해결

### 플릿이 나타나지 않음

1. `iot.fleet.name`이 데이터포인트 레이블이 아닌 **리소스** 속성으로 설정되어 있고, `service.name`이 `iot/<fleet>`인지 확인하세요.
2. 익스포터 엔드포인트가 `https://oneuptime.com/otlp`(또는 자체 호스팅 `…/otlp`)이고 `x-oneuptime-token` 헤더에 유효한 토큰이 들어 있는지 확인하세요.
3. MQTT를 사용하는 경우, 토픽이 `oneuptime/<fleet>/<device>/…` 형식을 정확히 따르는지 확인하세요 — 토픽의 플릿 세그먼트가 플릿을 생성하는 요소입니다.

### 인벤토리에서 장치 누락

1. 각 데이터포인트에 `device.id` 레이블이 포함되어 있는지 확인하세요 — 장치는 이를 키로 합니다.
2. 아직 측정값을 보고하지 않은 장치라도 인벤토리에 표시되도록 `iot_device_info`(식별 전용)를 보내세요.
3. `device.id` 값이 보고 간에 안정적인지 확인하세요. id가 바뀌면 중복된 장치 행이 생성됩니다.

### 익스포터에서 HTTP 401 / 403 발생

수집 토큰이 유효하지 않거나, 취소되었거나, 누락된 것입니다. _Project Settings → Telemetry Ingestion Keys_ 에서 새 토큰을 생성하고 `x-oneuptime-token` 헤더를 업데이트하세요.

### 메트릭이 차트에 표시되지 않음

1. [메트릭 규칙](#메트릭-규칙) 표에서 정확한 `iot_*` 메트릭 이름을 사용하고 있는지 확인하세요 — 인식되지 않는 이름은 일반 메트릭으로 저장되며 IoT 차트를 채우지 않습니다.
2. `iot_cpu_usage_ratio`는 `0`–`1` 비율임을 기억하세요. 원시 비율을 보내면 OneUptime이 이를 백분율로 렌더링합니다.
3. 장치가 보고를 시작한 후 첫 데이터포인트가 표시되기까지 최대 1분을 기다리세요.

## 자체 호스팅 OneUptime

OneUptime을 자체 호스팅하는 경우, 엔드포인트를 자신의 인스턴스로 향하게 하세요:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

또는 collector에서:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

MQTT의 경우 `wss://your-oneuptime-host.example.com/mqtt`에 연결하거나, 장치가 WebSocket을 사용할 수 없다면 앱 서비스의 원시 MQTT TCP 포트(`MQTT_INGEST_PORT`, 기본값 `1883`)를 노출하세요. MQTT 리스너를 완전히 끄려면 앱 서비스에 `MQTT_INGEST_ENABLED=false`를 설정하세요.

인스턴스가 HTTP 전용인 경우, 스킴을 `http://`(MQTT의 경우 `ws://`)로 변경하고 적절한 포트를 사용하세요.

## 다음 단계

- **IoT 장치 모니터**를 구성하여 장치 오프라인, 배터리 부족, 약한 신호, 높은 온도, 높은 CPU 조건에 대해 알림을 받으세요 — [IoT 장치 모니터](/docs/monitor/iot-device-monitor)를 참조하세요.
- 컨테이너화되지 않은 호스트(Linux / macOS / Windows VM 및 베어메탈)의 경우, [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector)를 사용하세요.
- 기본 OTLP 통합을 심층적으로 학습하려면 [OpenTelemetry를 OneUptime과 통합하기](/docs/telemetry/open-telemetry)를 참조하세요.
