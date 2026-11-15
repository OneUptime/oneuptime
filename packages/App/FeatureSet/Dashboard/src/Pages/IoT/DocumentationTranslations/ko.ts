import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "OTLP를 HTTP로 내보내는 OpenTelemetry SDK가 실행되는 디바이스",
  "Network access from the device to your OneUptime instance":
    "디바이스에서 OneUptime 인스턴스로의 네트워크 접근",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "`building-a-sensors`와 `sensor-001`을 플릿 이름과 디바이스 id로 바꾸세요. `iot.fleet.name`은 바꾸지 마세요. 바꾸면 완전히 새로운 플릿이 등록됩니다.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "읽은 값을 `iot_*` 규칙에 맞는 이름의 메트릭으로 보내고, 모든 데이터 포인트에 `device.id` 속성을 붙이세요. 예:",
  "| Metric | Value | Datapoint attribute |":
    "| 메트릭 | 값 | 데이터 포인트 속성 |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "디바이스 인벤토리는 리소스가 아니라 데이터 포인트의 `device.id`를 키로 하므로, `OTEL_RESOURCE_ATTRIBUTES`뿐 아니라 각 측정값에도 설정하세요. 인식되는 모든 이름은 고급의 **메트릭 규칙**에 있습니다.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. 디바이스가 오류 없이 내보내는지 확인하세요. SDK 로그에서 내보내기 실패와 HTTP `401` 또는 `422` 응답을 확인합니다.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. OneUptime 대시보드에서 **IoT** 섹션을 여세요. 보통 1분 정도면 플릿이 나타납니다.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. 플릿의 **디바이스** 탭을 여세요. 보낸 각 `device.id`가 최신 배터리, 신호, 온도, CPU, 메모리, 작동 상태와 함께 목록에 표시되어야 합니다.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. 플릿의 **메트릭**을 열어 `iot_*` 시계열 중 하나를 차트로 그리세요.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "디바이스에 설치할 에이전트는 없습니다. OneUptime은 OpenTelemetry 속성을 사용해 디바이스를 두 가지 개념에 대응시킵니다:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **플릿**: 디바이스의 논리적 그룹입니다(예: `building-a-sensors` 또는 `field-gateways`). 플릿은 리소스 속성 `iot.fleet.name`에서 정해지며, OneUptime에서 텔레메트리 서비스 `iot/<fleet>`으로 나타납니다. 로그와 메트릭이 같은 서비스 아래에 모이도록 `service.name=iot/<fleet>`을 설정하세요.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **디바이스**: 플릿 안의 개별 디바이스로, 각 데이터 포인트의 `device.id` 속성으로 식별됩니다. OneUptime은 `device.id`를 키로 하는 플릿별 디바이스 인벤토리를 만들고 유지합니다.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "OneUptime이 읽는 속성입니다. 선택 속성은 각 디바이스를 분류하고 모니터에서 범위를 좁히는 방식을 세분화합니다:",
  "| Attribute | Set on | Required | Description |":
    "| 속성 | 설정 위치 | 필수 | 설명 |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | 리소스 | 예 | 이 디바이스가 속한 플릿. OneUptime 서비스 `iot/<fleet>`이 됩니다 |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | 각 데이터 포인트 | 예 | 플릿 안에서 디바이스를 가리키는 고유하고 안정적인 id |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | 각 데이터 포인트 | 아니요 | 디바이스 종류(예: `Device`, `Sensor`, `Gateway`). 기본값은 `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | 각 데이터 포인트 | 아니요 | 모니터 필터링에 쓰는 더 세분화된 디바이스 유형 또는 모델(예: `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | 각 데이터 포인트 | 아니요 | 디바이스가 보고하는 펌웨어 버전 |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime은 다음 `iot_*` 메트릭 이름을 인식합니다. 읽은 값이 올바른 디바이스에 귀속되도록 각 데이터 포인트에 `device.id` 레이블을 붙여야 합니다. 디바이스에 의미 있는 메트릭만 보내면 됩니다. 빠진 메트릭은 차트에 표시되지 않을 뿐입니다.",
  "| Metric Name | Meaning |": "| 메트릭 이름 | 의미 |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | 디바이스 가용성. `1` = 작동/연결 가능, `0` = 중단. IoT 디바이스 모니터를 구동합니다 |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | 식별 정보만 담은 신호. `device.id` / 종류 / 유형 / 펌웨어를 담아, 읽은 값을 보고하기 전에도 디바이스가 인벤토리에 나타나게 합니다 |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | 배터리 충전량, `0`–`100`(%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | 무선 신호 세기(dBm)(예: Wi-Fi / LoRa / 셀룰러 RSSI) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | 디바이스 또는 센서 온도(°C) |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU 사용률을 `0`–`1` 비율로 나타낸 값(디바이스 인벤토리에서는 백분율로 표시) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | 현재 사용 중인 메모리(바이트) |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | 디바이스에서 사용할 수 있는 전체 메모리(바이트) |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | 디바이스가 마지막으로 부팅된 후 지난 초 |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. `iot.fleet.name`이 데이터 포인트 레이블이 아니라 **리소스** 속성으로 설정되어 있고, `service.name`이 `iot/<fleet>`인지 확인하세요.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. 내보내기 엔드포인트가 `<YOUR_ONEUPTIME_URL>/otlp`이고 `x-oneuptime-token` 헤더에 유효한 수집 키가 들어 있는지 확인하세요.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. 각 데이터 포인트에 `device.id` 레이블이 있는지 확인하세요. 디바이스는 이 값을 키로 합니다.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. 아직 읽은 값을 보고하지 않은 디바이스에는 `iot_device_info`(식별 정보만)를 보내 인벤토리에 나타나게 하세요.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. `device.id` 값이 보고할 때마다 바뀌지 않는지 확인하세요. id가 바뀌면 디바이스 행이 중복됩니다.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401`은 수집 키가 없거나 잘못되었거나 만료되었다는 뜻이고, `422`는 키가 비활성화되었거나 디바이스 텔레메트리를 보낼 수 없는 브라우저 키라는 뜻입니다. 위에서 다른 키를 선택하고(또는 새로 만들고) 디바이스나 컬렉터가 보내는 `x-oneuptime-token` 헤더를 업데이트하세요.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. 고급의 **메트릭 규칙**에 있는 `iot_*` 메트릭 이름을 그대로 사용하세요. 다른 이름은 일반 메트릭으로 저장되어 IoT 차트를 채우지 않습니다.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio`는 `0`–`1` 비율입니다. 비율을 그대로 보내면 OneUptime이 백분율로 표시합니다.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. 디바이스가 보고를 시작한 뒤 첫 데이터 포인트가 나타나기까지 최대 1분 정도 기다리세요.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "이렇게 하면 읽은 값이 플릿 **`fleet-1`** 으로 전송됩니다. `sensor-001`을 디바이스의 id로 바꾸고, `iot.fleet.name`은 정확히 그대로 두세요. 다른 이름은 새 플릿으로 등록됩니다.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "OpenTelemetry Collector를 실행할 수 있는 게이트웨이(Docker 또는 `otelcol-contrib` 바이너리)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "게이트웨이로 OTLP를 보내는 디바이스와, 게이트웨이에서 OneUptime 인스턴스로의 네트워크 접근",
  "Save this as `config.yaml` on the gateway:":
    "이 내용을 게이트웨이에 `config.yaml`로 저장하세요:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- 게이트웨이마다 `iot.fleet.name`(과 이에 맞는 `service.name=iot/<fleet>`)을 설정해, 각 게이트웨이의 디바이스가 올바른 플릿에 들어가게 하세요.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- 각 데이터 포인트에 `device.id`(필요하면 `iot.device.kind` / `iot.device.type` / `iot.device.firmware`도)를 유지해, OneUptime이 플릿 안의 개별 디바이스를 찾을 수 있게 하세요.",
  "Run it from the directory that holds `config.yaml`:":
    "`config.yaml`이 있는 디렉터리에서 실행하세요:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "그러면 디바이스가 게이트웨이로 OTLP를 보냅니다(gRPC는 포트 `4317`, HTTP는 포트 `4318`). 예를 들어 각 디바이스의 SDK에 `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318`을 설정합니다.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "게이트웨이에 이미 `otelcol-contrib`가 있나요? 이 파일을 지정하세요:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. 게이트웨이의 컬렉터가 오류 없이 내보내는지 확인하세요. 로그에서 내보내기 실패와 HTTP `401` 또는 `422` 응답을 확인합니다(Docker에서 실행 중이면 `docker logs -f otel-collector`).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** 는 gRPC(`4317`)와 HTTP(`4318`)로 디바이스에서 데이터를 받습니다. 컬렉터가 지원하는 다른 방법(MQTT 브리지, 파일 로그 등…)으로 읽은 값을 받아 같은 파이프라인으로 전달할 수도 있습니다.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** 는 모든 레코드에 플릿 속성을 붙입니다. 게이트웨이마다 `iot.fleet.name`(과 이에 맞는 `service.name=iot/<fleet>`)을 설정해, 각 게이트웨이의 디바이스가 올바른 플릿에 들어가게 하세요.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** 는 내보내기 전에 레코드를 묶어, 게이트웨이가 읽은 값마다 HTTP 왕복을 하지 않게 합니다.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** 는 수집 토큰을 붙여 HTTPS로 OneUptime에 보냅니다. 기본 protobuf 인코딩과 `encoding: json` 모두 허용됩니다.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- 이 게이트웨이가 전달하는 모든 읽은 값은 플릿 **`fleet-1`** 으로 갑니다. `iot.fleet.name`과 `service.name`을 정확히 그대로 두세요. 그렇지 않으면 읽은 값이 새 플릿을 등록합니다. 다른 플릿의 게이트웨이는 자체 값을 설정합니다.",
  "Any MQTT client that can connect over WebSocket":
    "WebSocket으로 연결할 수 있는 모든 MQTT 클라이언트",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "예를 들어 Node.js `mqtt` 클라이언트(`npm install mqtt`)를 사용할 때:",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "`building-a-sensors`와 `sensor-001`을 플릿 이름과 디바이스 id로 바꾸세요. OneUptime은 토픽에서 플릿과 디바이스를 만듭니다. Last Will은 연결이 끊기는 순간 디바이스를 오프라인으로 보고합니다. 직접 연결하는 디바이스는 자체 자격 증명을 쓰는 편이 좋습니다(둘 다 고급에 있습니다).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. 클라이언트가 오류 없이 연결하고 게시하는지 확인하세요. 반환 코드 4(잘못된 사용자 이름 또는 비밀번호)로 연결이 거부되면 키가 잘못된 것입니다.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. 플릿의 **디바이스** 탭을 여세요. 게시한 각 디바이스가 최신 배터리, 신호, 온도, CPU, 메모리, 작동 상태와 함께 목록에 표시되어야 합니다.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "디바이스에 설치할 에이전트는 없습니다. OneUptime은 디바이스를 두 가지 개념에 대응시키며, MQTT에서는 토픽이 둘 다 정합니다:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **플릿**: `oneuptime/<fleet>/…`의 `<fleet>`으로, 디바이스의 논리적 그룹입니다(예: `building-a-sensors`). 읽은 값의 `iot.fleet.name`이 되며, OneUptime에서 텔레메트리 서비스 `iot/<fleet>`으로 나타납니다.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **디바이스**: `oneuptime/<fleet>/<device>/…`의 `<device>`로, 플릿 안의 개별 디바이스입니다. 모든 읽은 값의 `device.id`가 되며, OneUptime은 이를 키로 하는 플릿별 디바이스 인벤토리를 만들고 유지합니다.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    '선택 속성은 각 디바이스를 분류하고 모니터에서 범위를 좁히는 방식을 세분화합니다. 텔레메트리 게시의 `"attributes"` 맵에 넣으면 해당 게시의 모든 데이터 포인트에 붙습니다:',
  "| Attribute | Description |": "| 속성 | 설명 |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | 디바이스 종류(예: `Device`, `Sensor`, `Gateway`). 기본값은 `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | 모니터 필터링에 쓰는 더 세분화된 디바이스 유형 또는 모델(예: `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | 디바이스가 보고하는 펌웨어 버전 |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime은 다음 `iot_*` 메트릭 이름을 인식합니다. MQTT에서는 토픽이 디바이스를 가리키므로 모든 읽은 값이 그 디바이스에 귀속됩니다. 디바이스에 의미 있는 메트릭만 보내면 됩니다. 빠진 메트릭은 차트에 표시되지 않을 뿐입니다.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "프로젝트 전체 수집 키는 여러 디바이스를 대신해 게시하는 게이트웨이에 적합합니다. 직접 연결하는 디바이스는 플릿의 **디바이스 레지스트리** 탭에서 하나씩 등록하세요. 디바이스별 자격 증명이 발급되며, 자격 증명 ID가 MQTT **사용자 이름**, 시크릿이 **비밀번호**입니다. 플릿은 첫 읽은 값과 함께 나타나므로, 2단계처럼 먼저 프로젝트 전체 키로 하나를 보내세요.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **토픽 격리**: 디바이스 자격 증명은 자기 `oneuptime/<fleet>/<device>/…` 토픽에만 게시할 수 있습니다. 나머지는 모두 버려집니다.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **개별 취소**: 플릿의 나머지에 영향을 주지 않고 한 디바이스의 자격 증명을 비활성화하거나 삭제할 수 있습니다. 연결된 디바이스는 몇 초 안에 끊깁니다.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **조용한 장애의 오프라인 감지**: 등록된 디바이스는 보고를 멈추면 사라지지 않고 오프라인으로 인벤토리에 남습니다. Last Will 없이 멈춘 경우도 마찬가지입니다.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "`oneuptime/<fleet>/<device>/status`에 페이로드 `offline`으로 MQTT **Last Will**을 등록하세요. 디바이스가 멈추면 세션이 끊기는 순간 OneUptime이 디바이스를 대신해 `iot_device_up = 0`을 게시하고, 폴링 없이 기본 제공 Device Offline 경고 템플릿이 작동합니다. 연결한 뒤 같은 토픽에 `online`을 게시하면 디바이스가 다시 작동 중으로 표시됩니다. 2단계의 예는 둘 다 합니다. 디바이스가 게시하는 읽은 값도 작동 중으로 간주되므로, 읽은 값을 계속 보내는 디바이스는 상태를 다시 게시하지 않아도 작동 중으로 남습니다. 상태 토픽은 `1`/`0`, `true`/`false`, `up`/`down`도 받습니다.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "WebSocket 엔드포인트에서는 MQTT keepalive를 **5분 미만**으로 유지하세요(클라이언트 라이브러리 기본값인 60초면 됩니다). 유휴 WebSocket 연결은 300초 후에 닫히며, 이때 Last Will과 잘못된 오프라인 경고가 발생합니다.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "고정 접두사 `oneuptime/` 아래에 게시하세요. 플릿과 디바이스 세그먼트에는 `/`, `+`, `#`를 넣거나 `$`로 시작할 수 없으며, 100자로 제한됩니다.",
  "| Topic | Payload |": "| 토픽 | 페이로드 |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | 읽은 값의 JSON 객체(`{"metrics":{"iot_temperature_celsius":21.5}}`) 또는 숫자 필드가 메트릭이 되는 평면 객체 |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | 단일 값: 숫자만(`23.4`) 또는 `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` 또는 `offline`. `iot_device_up`에 대응합니다 |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    '텔레메트리 페이로드에는 `"attributes"`(모든 데이터 포인트에 붙는 문자열 맵. `iot.device.kind`, `iot.device.type`, `iot.device.firmware` 또는 직접 정한 레이블에 사용)와 `"timestamp"`(ISO-8601 또는 Unix 초/밀리초)도 넣을 수 있습니다. 둘 다 선택 사항이며, `timestamp`가 없으면 수집 시각이 사용됩니다.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "이 엔드포인트는 수집 전용이라 구독은 거부됩니다. 게시 한 번은 128KB, 메트릭 100개로 제한됩니다. 이 규약을 벗어난 게시나 형식이 잘못된 페이로드는 받아들인 뒤 버려지며(MQTT 3.1.1에는 메시지별 오류 응답이 없습니다), OneUptime이 이유와 함께 경고를 기록합니다.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "자체 호스팅 환경에서는 원시 MQTT over TCP(`MQTT_INGEST_PORT`, 기본값 `1883`)도 노출할 수 있습니다. 리스너는 기본적으로 클러스터나 Compose 네트워크 안에서만 쓸 수 있으니, 디바이스가 WebSocket을 쓸 수 없다면 노출하세요. 그곳에는 WebSocket keepalive 상한이 적용되지 않습니다.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "MQTT 리스너를 끄려면 앱 서비스에 `MQTT_INGEST_ENABLED=false`를 설정하세요.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. 토픽이 `oneuptime/<fleet>/<device>/…`를 정확히 따르는지 확인하세요. 플릿을 만드는 것은 토픽의 플릿 세그먼트입니다.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. 토픽 규약을 벗어난 게시나 형식이 잘못된 페이로드는 받아들인 뒤 버려집니다(MQTT 3.1.1에는 메시지별 오류 응답이 없습니다). 고급의 **MQTT 토픽과 페이로드**와 비교해 보세요. 자체 호스팅 인스턴스에서는 앱 로그에 이유가 나옵니다(`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime은 잘못된 자격 증명을 CONNECT 단계에서 반환 코드 4로 거부합니다. 다음을 확인하세요:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- 비밀번호가 유효한 수집 키인지, 등록된 디바이스라면 자격 증명의 시크릿이고 자격 증명 ID를 사용자 이름으로 쓰는지;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- 키가 서버 키이고(브라우저 키는 MQTT에서 거부됩니다) 비활성화되거나 만료되지 않았는지.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. 디바이스 id는 토픽의 `<device>` 세그먼트입니다. 게시할 때마다 바뀌지 않게 하세요. id가 바뀌면 디바이스 행이 중복됩니다.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. 아직 읽은 값을 보고하지 않은 디바이스에는 `iot_device_info`(식별 정보만) 또는 `status` 메시지를 게시해 인벤토리에 나타나게 하세요.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "WebSocket 엔드포인트에서는 유휴 연결이 300초 후에 닫히며, 이때 Last Will과 잘못된 Device Offline 경고가 발생합니다. MQTT keepalive를 5분 미만으로 유지하세요. 클라이언트 라이브러리 기본값인 60초면 됩니다.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "`sensor-001`을 디바이스의 id로 바꾸세요. OneUptime은 토픽에서 디바이스를 플릿 **`fleet-1`** 에 추가합니다. Last Will은 연결이 끊기는 순간 디바이스를 오프라인으로 보고합니다. 직접 연결하는 디바이스는 자체 자격 증명을 쓰는 편이 좋습니다(둘 다 고급에 있습니다).",
};

export default TRANSLATION;
