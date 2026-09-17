# 수신 요청 모니터

수신 요청 모니터는 다른 시스템이 HTTP 요청을 보낼 수 있는 URL을 제공합니다. OneUptime은 모든 요청을 여러분의 criteria에 따라 평가하고, 모니터 상태를 변경하거나 인시던트를 선언하고 온콜 로테이션을 호출할 수 있습니다.

이 모니터는 서로 다른 두 가지 역할을 합니다.

- **하트비트 모니터링** — cron 작업, 워커 또는 장치가 일정에 따라 URL을 호출하고, 하트비트가 도착하지 않으면 OneUptime이 인시던트를 엽니다.
- **다른 시스템의 알림 수신** — Prometheus Alertmanager, Grafana를 비롯해 JSON을 POST할 수 있는 무엇이든 알림을 보내고, OneUptime이 각각을 온콜 에스컬레이션과 복구 시 자동 해결이 붙은 인시던트로 만듭니다.

둘 다 같은 모니터 유형을 사용합니다. 둘을 가르는 것은 여러분이 설정하는 criteria입니다.

## 개요

수신 요청 모니터는 서비스가 호출할 고유 URL을 제공합니다. 이를 통해 다음이 가능합니다.

- cron 작업과 예약된 태스크 모니터링
- 백그라운드 워커가 실행 중인지 확인
- 외부에서 도달할 수 없는 방화벽 뒤의 서비스 모니터링
- Prometheus Alertmanager, Grafana 및 기타 알림 시스템으로부터 알림 수신
- HTTP를 지원하는 모든 시스템의 하트비트 신호 추적

## 수신 요청 모니터 만들기

1. OneUptime 대시보드에서 **모니터** 로 이동합니다
2. **모니터 생성** 을 클릭합니다
3. 모니터 유형으로 **수신 요청** 을 선택합니다
4. 이 모니터에 대한 **비밀 키** 와 URL이 생성됩니다
5. 모니터를 열고 왼쪽 메뉴에서 **Documentation** 을 클릭해 URL을 복사합니다
6. 해당 URL로 요청을 보내도록 서비스를 설정합니다
7. 아래 설명에 따라 모니터링 criteria를 설정합니다

## 요청 URL

모니터에는 다음 형식의 고유 URL이 있습니다.

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

자체 호스팅 중이라면 `https://oneuptime.com` 을 여러분의 OneUptime 인스턴스 URL로 바꾸세요.

이 URL로 **GET** 또는 **POST** 요청을 보내세요. HEAD는 허용되며 GET처럼 처리됩니다. 그 외의 메서드는 404를 반환합니다. 경로에 포함된 비밀 키가 유일한 자격 증명이며, 별도의 헤더나 토큰은 필요하지 않습니다.

> **Warning:** 이 URL을 아는 사람은 누구나 모니터를 정상으로 표시할 수 있으므로 비밀로 다루세요. 보내는 모든 헤더는 모니터에 저장되며 모니터를 읽을 수 있는 사람에게 노출됩니다 — 이 엔드포인트로 API 키나 토큰을 헤더에 담아 보내지 마세요.

OneUptime은 즉시 빈 `200` 으로 응답하고 요청은 큐에서 처리합니다. 이 응답은 어떤 검증보다도 먼저 기록되므로, `200` 은 요청이 수락되었다는 확인이 **아닙니다** — 잘못된 비밀 키, 삭제된 모니터, 비활성화된 모니터도 모두 `200` 을 반환합니다. 요청이 실제로 도착하는지는 모니터 자체의 타임라인에서 확인하세요.

### 요청 본문 보내기

본문 안의 필드를 참조하고 싶다면 — 인시던트 제목의 `{{requestBody.status}}`, 인시던트 그룹화의 JSON 경로, JavaScript Expression criteria 등 — `Content-Type: application/json` 을 보내세요. 이 문서 전체가 전제하는 형식입니다. `application/x-www-form-urlencoded` 본문도 파싱되지만 최상위의 평평한 필드로만 변환됩니다. 그 외의 content type이거나 아예 없으면 파싱되지 않으며 모든 `requestBody` 참조는 아무것도 해석하지 못합니다.

본문은 50MB까지 허용됩니다. `Content-Encoding: gzip` 으로 본문을 압축하지 마세요. 파싱되지 않은 채 저장되어 그 안의 경로가 해석되지 않습니다.

### 하트비트 보내기

#### curl 사용

```bash
# Simple GET request
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST request with custom body
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### cron 작업에서

```bash
# Add to crontab to send heartbeat every 5 minutes
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### 애플리케이션 코드에서

```javascript
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python example
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## 모니터링 Criteria

서비스를 온라인, 저하됨, 오프라인 중 어느 상태로 볼지 criteria로 설정할 수 있습니다. 각 criteria 필터에는 **Filter Type**(무엇을 볼지), **Filter Condition**(어떻게 비교할지), **Value** 가 있습니다.

### 사용 가능한 Filter Type

| Filter Type           | 확인 대상                                             | 참고                                                                               |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Incoming Request      | 지정한 시간 창 안에 요청을 받았는지 여부              | 아무것도 도착하지 않았을 때 발동할 수 있는 유일한 검사                             |
| Request Body          | 요청 본문                                             | 부분 문자열 일치. 객체 본문은 압축된 JSON으로 비교됩니다                           |
| Request Header        | 요청 헤더의 이름                                      | 소문자로 변환한 헤더 이름과의 정확한 일치                                          |
| Request Header Value  | 요청 헤더의 값                                        | 소문자로 변환한 헤더 값과의 정확한 일치                                            |
| JavaScript Expression | `requestBody` 와 `requestHeaders` 에 대한 모든 표현식 | 가장 유연한 선택지 — [JavaScript 표현식](/docs/monitor/javascript-expression) 참고 |

### Filter Condition

각 Filter Type마다 고유한 조건 집합이 있습니다.

**Incoming Request** 의 경우(대시보드의 철자 그대로 표기):

- **Recieved In Minutes** — 지정한 분 이내에 요청을 받았습니다
- **Not Recieved In Minutes** — 지정한 분 이내에 요청을 받지 못했습니다

**Request Body**, **Request Header**, **Request Header Value** 의 경우: **Contains** 와 **Not Contains**.

**JavaScript Expression** 의 경우: **Evaluates To True**.

> **Note:** 헤더 이름과 헤더 값은 비교 전에 소문자로 바뀌며, 부분 문자열이 아니라 이름이나 값 전체와 대조합니다. `Content-Type` 이 아니라 `content-type`, `application/JSON` 이 아니라 `application/json` 으로 쓰세요. 진짜 부분 문자열 일치를 수행하는 것은 **Request Body** 뿐입니다.

객체 본문은 공백 없는 압축 JSON으로 비교되므로 **Request Body** / **Contains** 필터는 `"status":"firing"` 로 써야 합니다 — 보기 좋게 정렬된 페이로드에서 `"status": "firing"` 을 복사하면 결코 일치하지 않습니다.

### Criteria 예시

#### 10분 동안 하트비트가 없으면 오프라인으로 표시

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### 요청 본문 내용에 따라 저하됨으로 표시

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** 모니터가 백그라운드에서 다시 평가되는 것은 criteria 중 하나 이상이 **Incoming Request** 를 검사할 때뿐입니다. criteria가 Request Body, Request Header 또는 JavaScript Expression만 검사하는 모니터는 요청이 도착할 때만 평가되고 그 외에는 평가되지 않으므로, 스스로 오프라인이 될 수 없습니다. 하트비트 누락 경보가 필요하다면 **Incoming Request** criteria가 있어야 합니다.

또한 한 번도 요청을 받은 적 없는 모니터는 생성 시각을 마지막 요청으로 간주합니다. 갓 만든 모니터에 "Not Recieved In Minutes: 10" criteria가 있으면, 발신 측을 연결하지 않았더라도 생성 후 10분 뒤에 발동합니다.

## 다른 시스템의 알림 수신

Alertmanager, Grafana 및 유사한 도구는 하나 이상의 알림을 기술한 JSON 문서를 POST합니다. 기본적으로 criteria는 **하나의** 인시던트만 열기 때문에, 알림 다섯 개가 담긴 페이로드도 인시던트 하나만 만듭니다. 인시던트 그룹화는 이를 바꿉니다. 페이로드에서 값을 추출해 **서로 다른 값마다 별도의 인시던트**를 열고, 그것들이 모두 동시에 열려 있을 수 있습니다.

### 인시던트 그룹화 켜기

criteria를 열고 **Settings** 를 펼친 뒤 **Group incidents and alerts by a payload field** 를 켜세요. 네 개의 필드가 나타납니다.

| 필드                               | 예시                                     | 하는 일                                                                   |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | 서로 다른 값으로 인시던트를 나누는 경로                                   |
| Field that signals recovery        | `requestBody.alerts[*].status`           | 알림이 복구되었는지 판단하기 위해 확인하는 경로                           |
| Value that means recovered         | `resolved`                               | 복구를 뜻하는 정확한 값                                                   |
| Max incidents per request          | `100` (기본값)                           | 카디널리티가 높은 필드가 무제한으로 인시던트를 열지 못하게 하는 안전 상한 |

### 경로 문법

경로는 반드시 리터럴 접두사 `requestBody.` 로 시작해야 합니다. 이것이 없는 경로 — `alerts[*].labels.alertname` — 는 아무것도 매칭하지 못하며, 그것도 조용히 실패합니다. `{{ }}` 로 감싸는 것은 선택 사항이며 `requestBody.status` 와 `{{requestBody.status}}` 는 동일하게 동작합니다.

- `[*]` 는 배열 위로 펼쳐집니다 — **서로 다른** 값마다 인시던트 하나. 같은 값을 내는 두 요소는 하나의 인시던트로 합쳐지며, 그 인시던트의 firing/resolved 상태는 **첫 번째** 로 일치한 요소에서 가져옵니다. **경로에서 와일드카드로 동작하는 것은 첫 번째 `[*]` 뿐입니다**. `requestBody.groups[*].alerts[*].name` 은 아무것도 매칭하지 못합니다.
- `[0]` 과 `[last]` 는 단일 요소를 선택하며 `[*]` 뒤에 올 수 있습니다.
- 객체와 배열 값, 빈 문자열, null은 건너뜁니다. `0` 과 `false` 는 유효한 키입니다.

### 해결은 이벤트 기반

webhook은 해당 페이로드에 담긴 내용만 기술하므로, OneUptime은 키가 더 이상 나타나지 않는다는 이유로 인시던트를 해결하지 않습니다. 인시던트는 페이로드가 그 키가 복구되었다고 명시적으로 알릴 때만 해결됩니다. 다음 두 가지가 모두 참이어야 합니다.

1. **Field that signals recovery** 와 **Value that means recovered** 가 설정되어 있고 페이로드와 일치할 것. 비교는 정확하며 대소문자를 구분합니다 — `Resolved` 는 `resolved` 와 일치하지 않습니다.
2. criteria의 인시던트에서 **Auto Resolve Incident** 가 켜져 있을 것(인시던트 양식의 **Advanced Options** 아래). 이것이 없으면 일치하는 복구 이벤트는 무시되고 인시던트는 계속 열려 있습니다. (알림과 **Auto Resolve Alert** 에도 동일하게 적용됩니다.)

**Max incidents per request** 는 생성뿐 아니라 추출도 제한합니다. 상한을 넘어선 키는 복구에도 보이지 않으므로, 상한보다 많은 서로 다른 키를 담은 페이로드에서는 상한 너머에서 `resolved` 를 알리는 알림이 자신의 인시던트를 닫지 못합니다.

> **Warning:** **Field that signals recovery** 에는 `[*]` 가 있는데 **Open a separate incident for each…** 에는 없다면 아무것도 해결되지 않습니다. 둘 다에 `[*]` 를 쓰거나 둘 다 쓰지 마세요. `[*]` 가 없는 복구 경로는 페이로드 전체를 대상으로 평가되므로, 페이로드 수준의 `status: resolved` 는 그 페이로드의 모든 키를 해결합니다 — 자체 상태가 여전히 firing인 알림까지 포함해서요.

### 인시던트 이름 짓기

그룹화 키는 **경로의 마지막 세그먼트** 이름을 딴 변수로 인시던트 및 알림 템플릿에 노출됩니다.

| 경로                                     | 변수              |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

전체 페이로드도 함께 사용할 수 있으므로 인시던트 제목 `{{alertname}}` 과 `{{requestBody.commonAnnotations.summary}}` 를 참조하는 설명이 모두 동작합니다. [인시던트 및 알림 동적 템플릿](/docs/monitor/incident-alert-templating) 을 참고하세요.

> **Warning:** 변수 이름은 OneUptime이 복구 이벤트를 열려 있는 인시던트와 짝짓는 데 사용하는 식별 정보의 일부입니다. 그룹화 경로를 마지막 세그먼트가 다른 경로로 바꾸면, 예전 경로 아래에서 현재 열려 있는 모든 인시던트가 고아가 됩니다 — 더 이상 자동으로 해결할 수 없으며 손으로 닫아야 합니다.

`[*]` 는 두 개의 그룹화 경로 필드에서**만** 동작합니다. 다른 곳에서는 해석되지 않으며, 해석되지 않은 플레이스홀더는 비워지지 않고 **그대로** 출력됩니다 — 제목 `{{requestBody.alerts[*].labels.alertname}}` 은 중괄호가 그대로 남은 채 표시됩니다. 제목 `{{requestBody.alerts[0].annotations.summary}}` 는 해석되지만 항상 페이로드의 첫 번째 알림을 읽으며, 이 인시던트가 열린 대상 알림이 아닙니다. 그룹화 변수와 페이로드의 공통 `commonAnnotations` 필드를 함께 쓰는 편이 좋습니다.

### 실제 예시

Alertmanager 전체 구성은 [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) 를, Grafana는 [Grafana](/docs/integrations/grafana) 를 참고하세요.

## 모범 사례

1. **시간 창을 적절히 설정하세요** — cron 작업이 5분마다 실행된다면 "Not Recieved In Minutes" 임계값을 10~15분으로 두어 간헐적인 지연을 허용하세요
2. **의미 있는 데이터를 포함하세요** — 요청 본문에 상태 정보를 보내면 세분화된 criteria를 만들 수 있습니다
3. **POST와 `Content-Type: application/json` 을 사용하세요** — 본문 안을 읽는 모든 기능이 여기에 달려 있습니다
4. **하나의 모니터에 두 역할을 섞지 마세요** — 이벤트 기반 알림을 받는 모니터에는 일정한 주기가 없으므로 "Not Recieved In Minutes" criteria를 두면 상태가 요동칩니다. 데드맨 스위치에는 별도의 모니터를 쓰세요
5. **모니터를 모니터링하세요** — 요청을 보내는 서비스에 적절한 오류 처리를 넣어 실패한 요청이 묻히지 않도록 하세요

## 다음에 읽어 볼 내용

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — 인바운드 알림 구성 전체
- [Grafana](/docs/integrations/grafana) — Grafana 알림에 대한 동일한 구성
- [인시던트 및 알림 동적 템플릿](/docs/monitor/incident-alert-templating) — 제목과 설명에서 쓸 수 있는 모든 변수
- [JavaScript 표현식](/docs/monitor/javascript-expression) — 표현식 문법과 따옴표 규칙
