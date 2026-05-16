# 커스텀 코드 모니터

커스텀 코드 모니터를 사용하면 애플리케이션을 모니터링하기 위한 커스텀 스크립트를 작성할 수 있습니다. 이 기능을 사용하면 기존 모니터로는 불가능한 방식으로 애플리케이션을 모니터링할 수 있습니다. 예를 들어 다단계 API 요청을 구현할 수 있습니다.

#### 예시

다음 예시는 커스텀 코드 모니터를 사용하는 방법을 보여줍니다:

```javascript
// axios 모듈을 사용할 수 있습니다.

await axios.get('https://api.example.com/');

// Axios 문서: https://axios-http.com/docs/intro

return {
    data: 'Hello World' // 원하는 데이터를 반환합니다. 
};
```


### 모니터 시크릿 사용

#### 시크릿 추가

시크릿을 추가하려면 OneUptime 대시보드 -> 프로젝트 설정 -> 모니터 시크릿 -> 모니터 시크릿 생성으로 이동하십시오.

![시크릿 생성](/docs/static/images/CreateMonitorSecret.png)

어느 모니터가 시크릿에 액세스할 수 있는지 선택할 수 있습니다. 이 경우 `ApiKey` 시크릿을 추가하고 액세스할 모니터를 선택했습니다.

**참고**: 시크릿은 암호화되어 안전하게 저장됩니다. 시크릿을 분실하면 새 시크릿을 생성해야 합니다. 저장 후에는 시크릿을 보거나 업데이트할 수 없습니다. 

#### 시크릿 사용

스크립트에서 모니터 시크릿을 사용하려면 스크립트 컨텍스트에서 `monitorSecrets` 객체를 사용할 수 있습니다. 모니터에 추가한 시크릿에 액세스하는 데 사용할 수 있습니다.

```javascript
// 시크릿이 문자열 유형인 경우 따옴표로 감싸야 합니다
let stringSecret = '{{monitorSecrets.StringSecret}}';

// 시크릿이 숫자 또는 불리언 유형인 경우 직접 사용할 수 있습니다
let numberSecret = {{monitorSecrets.NumberSecret}};

// 시크릿이 불리언 유형인 경우 직접 사용할 수 있습니다
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// console.log를 사용하여 시크릿이 올바르게 가져와지는지 확인할 수 있습니다
console.log(stringSecret); 
```


### 커스텀 메트릭

`oneuptime.captureMetric()` 함수를 사용하여 스크립트에서 커스텀 메트릭을 캡처할 수 있습니다. 이러한 메트릭은 OneUptime에 저장되며 메트릭 탐색기를 사용하여 대시보드에 차트화할 수 있습니다.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (문자열, 필수): 메트릭 이름 (예: `"api.response.time"`). `custom.monitor.` 접두사가 자동으로 저장됩니다.
- `value` (숫자, 필수): 숫자 메트릭 값.
- `attributes` (객체, 선택 사항): 추가 컨텍스트를 위한 키-값 쌍.

#### 예시

```javascript
const response = await axios.get('https://api.example.com/health');

// 간단한 메트릭 캡처
oneuptime.captureMetric('api.response.time', response.data.latency);

// 속성과 함께 메트릭 캡처
oneuptime.captureMetric('api.queue.depth', response.data.queueDepth, {
    region: 'us-east-1',
    environment: 'production'
});

return {
    data: response.data
};
```

캡처된 후 이러한 메트릭은 `custom.monitor.api.response.time`과 같은 이름으로 메트릭 탐색기에 나타납니다. 대시보드 차트에 추가하고 알림을 설정하며 모니터, 프로브 또는 제공한 커스텀 속성으로 필터링할 수 있습니다.

**제한 사항:**
- 스크립트 실행당 최대 100개의 메트릭.
- 메트릭 이름은 200자로 제한됩니다.
- 값은 숫자여야 합니다.

### 스크립트에서 사용 가능한 모듈
- `axios`: HTTP 요청을 만들 수 있습니다. 브라우저와 Node.js를 위한 프로미스 기반 HTTP 클라이언트입니다.
- `crypto`: 암호화 작업을 수행할 수 있습니다. OpenSSL의 해시, HMAC, 암호화, 복호화, 서명 및 검증 함수에 대한 래퍼를 제공하는 내장 Node.js 모듈입니다.
- `console.log`: 콘솔에 데이터를 로그할 수 있습니다. 디버깅 목적에 유용합니다.
- `oneuptime.captureMetric`: 스크립트에서 커스텀 메트릭을 캡처하는 데 사용합니다. 위의 커스텀 메트릭 섹션을 참조하십시오.
- `http`: HTTP 요청을 만들 수 있습니다. HTTP 클라이언트와 서버를 제공하는 내장 Node.js 모듈입니다.
- `https`: HTTPS 요청을 만들 수 있습니다. HTTPS 클라이언트와 서버를 제공하는 내장 Node.js 모듈입니다.

### 고려해야 할 사항

- `console.log`를 사용하여 콘솔에 데이터를 로그할 수 있습니다. 이는 모니터의 로그 섹션에서 사용할 수 있습니다 (프로브 > 로그 보기).
- `return` 문을 사용하여 스크립트에서 데이터를 반환할 수 있습니다. 
- 이것은 JavaScript 스크립트이므로 스크립트에서 모든 JavaScript 기능을 사용할 수 있습니다.
- 스크립트 타임아웃은 2분입니다. 스크립트가 2분 이상 걸리면 종료됩니다.
