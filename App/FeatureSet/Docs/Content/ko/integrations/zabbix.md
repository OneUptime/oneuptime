# Zabbix 통합

[Zabbix](https://www.zabbix.com)는 서버와 네트워크를 감시하고, OneUptime은 인시던트 대응, 온콜, 상태 페이지를 관리합니다. 두 가지를 연결하면 모든 Zabbix 문제가 자동으로 OneUptime 인시던트가 되어 — 담당자에게 호출이 가고 상태 페이지도 정확하게 유지됩니다.

이 통합은 **인바운드**: Zabbix가 OneUptime으로 문제를 보냅니다. 한쪽에는 Zabbix **webhook 미디어 타입**을, 다른 한쪽에는 OneUptime **[Workflow](/docs/workflows/index)** 를 사용합니다. 플러그인이나 추가 서비스는 필요 없습니다.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## 동작 방식

1. Zabbix 트리거가 **PROBLEM** 상태로 변경됩니다.
2. Zabbix **액션** 이 **OneUptime** 미디어 타입에 이벤트를 전송하도록 지시합니다.
3. 미디어 타입의 스크립트가 OneUptime 워크플로 URL에 소형 JSON 페이로드를 POST합니다.
4. 워크플로가 페이로드를 읽고 인시던트를 생성합니다(선택적으로 Zabbix가 복구될 때 해결도 가능).

## 사전 요건

- 관리 권한이 있는 Zabbix 서버 (이 가이드는 **Zabbix 6.0 LTS / 7.0 LTS** 기준으로 작성되었으며, webhook 미디어 타입은 5.0 이상에서 동일하게 동작합니다).
- Zabbix 서버가 HTTPS로 OneUptime 인스턴스에 도달할 수 있어야 합니다.
- 워크플로를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — OneUptime 워크플로 구성

이 작업을 먼저 하세요. 여기서 생성되는 webhook URL이 필요합니다.

1. **Workflows → Create Workflow** 를 열고 이름을 `Zabbix → Incidents` 로 지정한 후 **Builder** 탭을 엽니다.
2. **Webhook** 트리거를 캔버스에 끌어다 놓습니다. 클릭하고 **고유 URL을 복사합니다**. 이 URL을 안전하게 보관하세요 — 이 URL을 가진 사람은 누구나 워크플로를 시작할 수 있습니다. 블록 이름을 `Zabbix` 로 바꾸면 변수를 읽기 쉬워집니다.
3. **Conditions** 블록을 캔버스에 끌어다 놓고 트리거 출력에 연결합니다. 다음과 같이 설정합니다:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1`  *(Zabbix는 문제 발생 시 `1`, 복구 시 `0`을 전송합니다)*
4. **Create Incident** 블록을 끌어다 Conditions 블록의 **Yes** 출력에 연결합니다. 다음과 같이 입력합니다:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: 원하는 OneUptime 인시던트 심각도를 선택합니다(나중에 Zabbix 심각도를 매핑하는 추가 Conditions 분기로 세분화할 수 있습니다).
5. 저장합니다. **Enabled** 는 *끔* 상태로 유지하세요 — 테스트 후에 켜겠습니다.

> **팁:** 설명(또는 인시던트 라벨)에 Zabbix `event_id` 를 넣어두면 나중에 복구 시 자동 해결을 원할 때 이 인시던트를 다시 찾을 수 있습니다. [자동 해결 (선택 사항)](#자동-해결-선택-사항)을 참조하세요.

## 2단계 — Zabbix 설정

### 1단계: OneUptime 미디어 타입 만들기

1. Zabbix에서 **Alerts → Media types** 로 이동합니다(이전 버전: **Administration → Media types**).
2. **Create media type** 을 클릭하고 **Type** 을 **Webhook** 으로 설정합니다.
3. **Name**: `OneUptime`.
4. 다음 **Parameters** 를 추가합니다(*Add* 클릭 후 각각 입력). 이것은 Zabbix [매크로](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location)를 깔끔한 페이로드로 매핑합니다:

   | 이름 | 값 |
   | --- | --- |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. **Script** 필드에 다음을 붙여넣습니다:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader('Content-Type: application/json');

   var payload = {
     source: 'zabbix',
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw 'OneUptime responded with HTTP ' + request.getStatus() + ': ' + response;
   }

   return 'OK';
   ```

6. **Message templates** 탭을 클릭하고 **Problem** 과 **Problem recovery** 에 대한 템플릿을 추가합니다(본문은 비워도 됩니다 — 페이로드는 스크립트에서 구성됩니다). Zabbix가 해당 이벤트 유형에 미디어 타입을 사용하려면 이 설정이 필요합니다.
7. **Add** 를 클릭해 미디어 타입을 저장합니다.

### 2단계: webhook을 전달할 사용자 만들기

Zabbix는 *사용자에게* 알림을 보냅니다. 통합을 쉽게 찾고 비활성화할 수 있도록 전용 사용자를 만드세요.

1. **Users → Users → Create user** 로 이동합니다. 이름을 `OneUptime Webhook` 으로 지정하고, 알림을 받을 수 있는 역할(예: **User role**)을 부여하고 사용자 그룹에 추가합니다.
2. **Media** 탭에서 **Add** 를 클릭합니다:
   - **Type**: `OneUptime`
   - **Send to**: 1단계에서 복사한 **워크플로 webhook URL** 을 붙여넣습니다.
   - **When active** / 심각도: 기본값을 유지합니다(또는 원하는 심각도로 제한합니다).
3. **Add** 및 **Update** 를 클릭합니다.

### 3단계: 액션으로 문제를 OneUptime으로 전송

1. **Alerts → Actions → Trigger actions → Create action** 으로 이동합니다.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (선택 사항): 범위를 좁힙니다 — 예: *트리거 심각도 >= Warning*. 모든 것을 보내려면 비워둡니다.
4. **Operations** 탭에서 **User: OneUptime Webhook** 에게 **OneUptime** 미디어 타입으로 전송하는 작업을 추가합니다.
5. 나중에 복구 시 인시던트를 해결하려면 **Recovery operations** 에도 같은 사용자/미디어를 입력합니다.
6. **Add** 를 클릭해 저장하고 액션이 **Enabled** 상태인지 확인합니다.

## 3단계 — 테스트

1. OneUptime 워크플로로 돌아가 **Enabled** 를 켭니다.
2. Zabbix에서 테스트 문제를 발생시킵니다 — 예를 들어 일시적으로 트리거 임계값을 낮추거나, 문제 상태로 전환되는 테스트 항목을 사용합니다.
3. 워크플로의 **Logs** 탭을 엽니다. Zabbix 페이로드가 포함된 실행, Conditions 블록이 **Yes** 경로를 취한 것, 인시던트가 생성된 것을 확인할 수 있습니다.
4. OneUptime의 **Incidents** 를 확인합니다 — Zabbix 문제가 이제 인시던트로 나타납니다.

아무것도 도착하지 않으면 [문제 해결](#문제-해결)을 참조하세요.

## 자동 해결 (선택 사항)

위의 핵심 워크플로는 인시던트를 *엽니다*. Zabbix가 복구될 때 인시던트를 *닫으려면*:

1. Zabbix 액션에 **Recovery operations** 가 설정되어 있는지 확인합니다(위 3단계 참조). 복구 이벤트도 전송되어야 합니다. 복구 시 `status` 는 `0` 으로 옵니다.
2. 워크플로에서 두 번째 **Conditions** 분기를 추가합니다: 왼쪽 `{{Zabbix.Request Body.status}}`, 연산자 `==`, 오른쪽 `0`.
3. **Yes** 출력에서 **Find Incident** 블록을 추가해 앞서 생성한 열린 인시던트를 조회합니다 — 설명이나 라벨에 저장한 Zabbix `event_id` 로 매칭합니다.
4. **Update Incident** 블록에 연결해 인시던트를 *해결됨* 상태로 이동합니다.

해결은 프로젝트의 인시던트 상태 모델링 방식에 따라 달라지므로, **생성** 경로를 안정적인 핵심으로 유지하고 이벤트 흐름이 올바르게 확인된 후에 해결 경로를 추가하세요. [컴포넌트 → OneUptime 데이터 컴포넌트](/docs/workflows/components#oneuptime-data-components)를 참조하시기 바랍니다.

## Zabbix 심각도 매핑 (선택 사항)

Zabbix 심각도(`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`)는 `{{Zabbix.Request Body.severity}}` 로 옵니다. OneUptime 인시던트 심각도로 매핑하려면 **Create Incident** 앞에 **Conditions** 분기를 추가합니다 — 예를 들어 `Disaster` 와 `High` 는 "Critical" 인시던트로, 나머지는 "Major"로 라우팅합니다. 분기마다 **Create Incident** 블록을 하나씩 만드세요.

## 문제 해결

**워크플로가 전혀 실행되지 않습니다.**
- 워크플로의 **Enabled** 스위치가 켜져 있는지 확인합니다.
- Zabbix 서버에서 URL에 도달할 수 있는지 확인합니다: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. 빠른 응답 확인을 받아야 합니다.
- Zabbix에서 **Reports → Action log** 를 확인해 전달 오류가 있는지 확인합니다.

**Zabbix가 스크립트 오류를 보고합니다.**
- 미디어 타입을 열고 **Test** 를 사용해 샘플 페이로드를 전송합니다. Zabbix가 스크립트 출력이나 발생한 오류를 표시합니다.
- OneUptime의 2xx가 아닌 응답은 스크립트의 `throw` 로 표시됩니다 — 워크플로 URL이 정확한지 확인하세요.

**인시던트가 생성되었지만 필드가 비어 있습니다.**
- 워크플로의 **Logs** 탭을 열고 트리거 출력을 검사합니다. **Request Body** 아래의 필드 이름이 참조한 것(`name`, `host`, `severity`, `status`, `event_id`)과 일치하는지 확인합니다.
- 누락된 필드는 오류 대신 빈 문자열로 처리됩니다 — [변수 → 주의사항](/docs/workflows/variables#gotchas)을 참조하시기 바랍니다.

**모든 것이 두 번 발생합니다.**
- 문제 작업과 에스컬레이션 단계 모두 같은 미디어로 전송되고 있을 가능성이 높습니다. 액션의 **Operations** 단계를 확인하세요.

## 보안 참고 사항

- 워크플로 webhook URL을 비밀번호처럼 취급하세요. 유출되면 트리거를 삭제하고 새로 만들어 URL을 교체하세요.
- Zabbix 액션의 조건을 제한하여 인시던트가 필요한 심각도만 전달하세요.
- 방화벽 뒤에서 OneUptime을 자체 호스팅하는 경우, Zabbix 서버의 출력 IP가 HTTPS로 접근할 수 있도록 허용하세요.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 인바운드/아웃바운드 패턴.
- [Webhook 트리거](/docs/workflows/triggers#webhook) — 수신 URL의 동작 방식.
- [컴포넌트](/docs/workflows/components) — Conditions, Create Incident 등.
- [변수](/docs/workflows/variables) — 이후 블록에서 Zabbix 페이로드 읽기.
