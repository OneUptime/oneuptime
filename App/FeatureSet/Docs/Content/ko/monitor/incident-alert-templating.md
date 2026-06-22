# 인시던트 및 알림 동적 템플릿

모니터 기준에서 JavaScript 표현식이 사용하는 `{{variable}}` 플레이스홀더 구문을 동일하게 사용하여 모니터 기준에서 자동으로 생성될 때 인시던트 및 알림의 제목, 설명 및 조치 노트를 동적으로 채울 수 있습니다.

## 지원되는 모니터 유형 및 변수

다음 모니터 유형은 각각의 변수로 동적 템플릿을 지원합니다:

- **웹사이트 및 API 모니터**: 응답 데이터, 헤더, 상태 코드, 타이밍
- **수신 요청 모니터**: 요청 데이터, 헤더, 메서드, 타이밍
- **Ping 모니터**: 연결 상태, 응답 시간, 실패 원인
- **포트 모니터**: 포트 연결, 응답 시간, 타임아웃 상태
- **IP 모니터**: IP 도달 가능성, ping 시간, 실패 정보
- **SSL 인증서 모니터**: 인증서 세부 정보, 유효성 검사 상태, 만료 정보
- **서버/VM 모니터**: 시스템 메트릭 (CPU, 메모리, 디스크), 프로세스, 호스트 이름
- **합성 모니터**: 스크립트 실행 결과, 스크린샷, 브라우저 세부 정보
- **커스텀 JavaScript 코드 모니터**: 실행 결과, 타이밍, 오류 메시지
- **SNMP 모니터**: 장치 상태, 응답 시간, OID 값

> **참고**: 로그, 트레이스 및 메트릭 모니터는 다른 트리거 메커니즘을 사용하므로 현재 인시던트/알림 템플릿을 지원하지 않습니다.

## 지원되는 모니터 유형 및 변수

### 웹사이트 및 API 모니터

| 변수                 | 설명                                                     | 유형                 |
| -------------------- | -------------------------------------------------------- | -------------------- |
| `responseBody`       | 응답 본문 객체. HTML/XML이면 문자열. JSON이면 JSON 객체. | `string` 또는 `JSON` |
| `responseHeaders`    | 응답 헤더 객체 (키는 소문자).                            | `Dictionary<string>` |
| `responseStatusCode` | HTTP 응답 상태 코드.                                     | `number`             |
| `responseTimeInMs`   | 밀리초 단위의 응답 시간.                                 | `number`             |
| `isOnline`           | 모니터가 온라인으로 간주되는지 여부.                     | `boolean`            |

### 수신 요청 모니터

| 변수                        | 설명                                    | 유형                 |
| --------------------------- | --------------------------------------- | -------------------- |
| `requestBody`               | 요청 본문 객체.                         | `string` 또는 `JSON` |
| `requestHeaders`            | 요청 헤더 객체 (키는 소문자).           | `Dictionary<string>` |
| `requestMethod`             | 수신 요청의 HTTP 메서드 (GET, POST 등). | `string`             |
| `incomingRequestReceivedAt` | 수신 요청이 수신된 날짜 및 시간.        | `Date`               |

### Ping 모니터

| 변수               | 설명                                    | 유형      |
| ------------------ | --------------------------------------- | --------- |
| `isOnline`         | Ping 대상이 온라인으로 간주되는지 여부. | `boolean` |
| `responseTimeInMs` | 밀리초 단위의 Ping 응답 시간.           | `number`  |
| `failureCause`     | Ping이 실패한 경우 실패 원인.           | `string`  |
| `isTimeout`        | Ping 요청이 타임아웃되었는지 여부.      | `boolean` |

### 포트 모니터

| 변수               | 설명                                           | 유형      |
| ------------------ | ---------------------------------------------- | --------- |
| `isOnline`         | 포트가 온라인/액세스 가능으로 간주되는지 여부. | `boolean` |
| `responseTimeInMs` | 밀리초 단위의 연결 응답 시간.                  | `number`  |
| `failureCause`     | 포트 확인이 실패한 경우 실패 원인.             | `string`  |
| `isTimeout`        | 포트 연결이 타임아웃되었는지 여부.             | `boolean` |

### IP 모니터

| 변수               | 설명                                  | 유형      |
| ------------------ | ------------------------------------- | --------- |
| `isOnline`         | IP 주소가 온라인으로 간주되는지 여부. | `boolean` |
| `responseTimeInMs` | 밀리초 단위의 Ping 응답 시간.         | `number`  |
| `failureCause`     | IP 확인이 실패한 경우 실패 원인.      | `string`  |
| `isTimeout`        | IP Ping 요청이 타임아웃되었는지 여부. | `boolean` |

### SSL 인증서 모니터

| 변수                 | 설명                                 | 유형      |
| -------------------- | ------------------------------------ | --------- |
| `isOnline`           | SSL 인증서 확인이 성공했는지 여부.   | `boolean` |
| `isSelfSigned`       | SSL 인증서가 자체 서명되었는지 여부. | `boolean` |
| `createdAt`          | SSL 인증서가 생성된 날짜.            | `Date`    |
| `expiresAt`          | SSL 인증서가 만료되는 날짜.          | `Date`    |
| `commonName`         | 인증서의 일반 이름 (CN).             | `string`  |
| `organizationalUnit` | 인증서의 조직 단위 (OU).             | `string`  |
| `organization`       | 인증서의 조직 (O).                   | `string`  |
| `locality`           | 인증서의 지역 (L).                   | `string`  |
| `state`              | 인증서의 주/도 (ST).                 | `string`  |
| `country`            | 인증서의 국가 (C).                   | `string`  |
| `serialNumber`       | 인증서의 일련 번호.                  | `string`  |
| `fingerprint`        | 인증서의 SHA-1 지문.                 | `string`  |
| `fingerprint256`     | 인증서의 SHA-256 지문.               | `string`  |
| `failureCause`       | SSL 확인이 실패한 경우 실패 원인.    | `string`  |

### 서버/VM 모니터

| 변수                         | 설명                                       | 유형            |
| ---------------------------- | ------------------------------------------ | --------------- |
| `hostname`                   | 모니터링되는 서버의 호스트 이름.           | `string`        |
| `requestReceivedAt`          | 서버 모니터 요청이 수신된 날짜 및 시간.    | `Date`          |
| `cpuUsagePercent`            | CPU 사용률 백분율.                         | `number`        |
| `cpuCores`                   | CPU 코어 수.                               | `number`        |
| `memoryUsagePercent`         | 메모리 사용률 백분율.                      | `number`        |
| `memoryFreePercent`          | 메모리 여유 백분율.                        | `number`        |
| `memoryTotalBytes`           | 총 메모리 바이트.                          | `number`        |
| `diskMetrics`                | 마운트된 모든 디스크의 디스크 메트릭 배열. | `Array<Object>` |
| `diskMetrics[].diskPath`     | 디스크 마운트 포인트의 경로.               | `string`        |
| `diskMetrics[].usagePercent` | 이 마운트 포인트의 디스크 사용률 백분율.   | `number`        |
| `diskMetrics[].freePercent`  | 이 마운트 포인트의 디스크 여유 백분율.     | `number`        |
| `diskMetrics[].totalBytes`   | 이 마운트 포인트의 총 디스크 공간 바이트.  | `number`        |
| `processes`                  | 서버에서 실행 중인 프로세스 배열.          | `Array<Object>` |
| `processes[].pid`            | 프로세스 ID.                               | `number`        |
| `processes[].name`           | 프로세스 이름.                             | `string`        |
| `processes[].command`        | 프로세스를 시작하는 데 사용된 명령.        | `string`        |
| `failureCause`               | 서버 확인이 실패한 경우 실패 원인.         | `string`        |

### 합성 모니터

합성 모니터는 여러 브라우저(Chromium, Firefox, Webkit)와 화면 크기(모바일, 태블릿, 데스크탑)에서 동일한 스크립트를 실행하여 구성당 하나의 응답을 생성합니다. 각 실행은 `syntheticResponses` 배열을 통해 노출됩니다 — 인덱스로 특정 실행에 액세스하거나 (`{{syntheticResponses[0].browserType}}`) `{{#each syntheticResponses}}`로 반복합니다.

| 변수                                     | 설명                                                                   | 유형                                      |
| ---------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| `failureCause`                           | 합성 확인이 실패한 경우 실패 원인.                                     | `string`                                  |
| `syntheticResponses`                     | 스크립트가 실행된 브라우저/화면 크기 조합당 하나의 항목이 포함된 배열. | `Array<Object>`                           |
| `syntheticResponses[].executionTimeInMs` | 이 실행에 대한 밀리초 단위의 실행 시간.                                | `number`                                  |
| `syntheticResponses[].result`            | 이 실행에서 반환된 결과.                                               | `string`, `number`, `boolean` 또는 `JSON` |
| `syntheticResponses[].scriptError`       | 이 실행 중 발생한 오류.                                                | `string`                                  |
| `syntheticResponses[].logMessages`       | 이 실행 중 생성된 로그 메시지.                                         | `Array<string>`                           |
| `syntheticResponses[].screenshots`       | 이 실행 중 캡처된 스크린샷.                                            | `Object`                                  |
| `syntheticResponses[].browserType`       | 이 실행에 사용된 브라우저.                                             | `string`                                  |
| `syntheticResponses[].screenSizeType`    | 이 실행에 사용된 화면 크기.                                            | `string`                                  |

### 커스텀 JavaScript 코드 모니터

| 변수                | 설명                                         | 유형                                      |
| ------------------- | -------------------------------------------- | ----------------------------------------- |
| `executionTimeInMs` | 커스텀 코드를 실행하는 데 걸린 시간(밀리초). | `number`                                  |
| `result`            | 커스텀 코드에서 반환된 결과.                 | `string`, `number`, `boolean` 또는 `JSON` |
| `scriptError`       | 코드 실행 중 발생한 오류.                    | `string`                                  |
| `logMessages`       | 실행 중 생성된 로그 메시지 배열.             | `Array<string>`                           |

### SNMP 모니터

| 변수                   | 설명                                                 | 유형                   |
| ---------------------- | ---------------------------------------------------- | ---------------------- |
| `isOnline`             | SNMP 장치가 온라인이고 응답하는지 여부.              | `boolean`              |
| `responseTimeInMs`     | 밀리초 단위의 SNMP 쿼리 응답 시간.                   | `number`               |
| `failureCause`         | SNMP 쿼리가 실패한 경우 실패 원인.                   | `string`               |
| `isTimeout`            | SNMP 쿼리가 타임아웃되었는지 여부.                   | `boolean`              |
| `oidResponses`         | oid, name, value, type이 있는 OID 응답 객체 배열.    | `Array<Object>`        |
| `oidResponses[].oid`   | 쿼리된 OID.                                          | `string`               |
| `oidResponses[].name`  | OID의 친숙한 이름 (제공된 경우).                     | `string`               |
| `oidResponses[].value` | OID에서 반환된 값.                                   | `string` 또는 `number` |
| `oidResponses[].type`  | 값의 SNMP 데이터 유형.                               | `string`               |
| `{{OID_NAME}}`         | 이름으로 OID 값에 직접 액세스 (예: `{{sysUpTime}}`). | `string` 또는 `number` |

## 기본 사용법

모니터 기준 인스턴스 내의 인시던트/알림 양식에서 다음과 같이 작성할 수 있습니다:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

모니터 응답 상태 코드가 `502`이고 시간이 `842`이면 저장된 제목은 다음과 같이 됩니다:

```
API returned 502 in 842ms
```

중첩된 JSON 액세스는 JavaScript 표현식과 동일한 방식으로 작동합니다:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

배열 인덱싱이 지원됩니다:

```
First User: {{responseBody.users[0].name}}
```

경로가 존재하지 않으면 기본적으로 빈 문자열로 확인됩니다.

## 고급 사용법

### 배열 요소 액세스

```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### 중첩된 객체 액세스

```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### `{{#each}}`를 사용한 배열 반복

`{{#each path}}...{{/each}}` 블록 구문을 사용하여 배열을 반복할 수 있습니다. 데이터에 항목 목록이 포함되어 있고 각 항목을 인시던트나 알림 설명에 포함하려는 경우에 유용합니다.

**구문:**

```
{{#each arrayPath}}
  ...각 요소의 {{property}}를 사용하는 본문...
{{/each}}
```

루프 본문 내에서:

- `{{propertyName}}`은 현재 배열 요소를 기준으로 확인됩니다
- `{{nested.property}}` 점 표기법 액세스는 현재 요소에서 작동합니다
- `{{@index}}`는 현재 반복의 0부터 시작하는 인덱스로 확인됩니다
- `{{this}}`는 현재 요소 값으로 확인됩니다 (문자열/숫자 배열에 유용)
- 현재 요소에서 찾을 수 없는 변수는 부모 저장 맵으로 폴백됩니다

**예시 — 알림 배열이 있는 수신 요청 (예: Grafana 웹훅):**

수신 요청 본문이 다음과 같은 경우:

```json
{
  "status": "firing",
  "alerts": [
    { "status": "firing", "labels": { "label": "Coralpay" } },
    { "status": "firing", "labels": { "label": "capitecpay" } },
    { "status": "resolved", "labels": { "label": "capricorn" } }
  ]
}
```

다음과 같은 템플릿을 작성할 수 있습니다:

```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

결과:

```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**예시 — 서버 디스크 메트릭:**

```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**예시 — `{{@index}}` 사용:**

```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**예시 — `{{this}}`를 사용한 기본 배열:**

```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**예시 — 중첩 루프:**

다중 레벨 배열에 대해 `{{#each}}` 블록을 중첩할 수 있습니다:

```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **참고**: 경로가 배열로 확인되지 않으면 전체 `{{#each}}...{{/each}}` 블록이 출력에서 제거됩니다. 빈 배열은 블록에 대한 출력을 생성하지 않습니다.

## 예시

### 웹사이트/API 모니터 인시던트 제목

```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### 웹사이트/API 모니터 인시던트 설명

```
### API Error
Status: **{{responseStatusCode}}**
Latency: **{{responseTimeInMs}}ms**
Body Snippet: `{{responseBody.error.message}}`
```

### 수신 요청 알림 제목

```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### SSL 인증서 알림 제목

```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### 서버 모니터 알림 설명

```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**
Last Check: {{requestReceivedAt}}
```

### Ping 모니터 알림 제목

```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### 포트 모니터 알림 설명

```
Port connectivity issue
Target port status: {{isOnline}}
Response time: {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### 합성 모니터 알림

인덱스로 특정 브라우저/화면 크기 실행에 액세스:

```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

`{{#each}}`를 사용하여 모든 브라우저/화면 크기 조합 반복:

```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

### 커스텀 코드 모니터 알림

```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### SNMP 모니터 알림 제목

```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### SNMP 모니터 알림 설명

```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### 배열 루프를 사용한 수신 요청 (Grafana 웹훅)

제목:

```
[{{requestBody.status}}] {{requestBody.receiver}}
```

설명:

```
### Alerts from {{requestBody.receiver}}

{{#each requestBody.alerts}}
**Alert {{@index}}**: {{labels.alertname}}
- Label: {{labels.label}}
- Status: {{status}}
- Values: {{valueString}}
- Source: {{generatorURL}}
{{/each}}
```

### 디스크 루프를 사용한 서버 모니터

설명:

```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**

**Disk Usage:**
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used ({{freePercent}}% free)
{{/each}}

**Running Processes:**
{{#each processes}}
- [{{pid}}] {{name}}: {{command}}
{{/each}}
```

### OID 루프를 사용한 SNMP 모니터

설명:

```
### SNMP Device Status
Online: {{isOnline}}
Response: {{responseTimeInMs}}ms

**OID Values:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
