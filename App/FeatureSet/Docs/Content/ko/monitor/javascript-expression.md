# 모니터링 기준: JavaScript 표현식

JavaScript 표현식을 사용하여 커스텀 모니터링 기준을 생성할 수 있습니다. 표현식은 모니터링되는 객체의 컨텍스트에서 평가됩니다. 표현식은 불리언 값을 반환해야 합니다. 표현식이 `true`를 반환하면 모니터링 기준이 충족됩니다. 표현식이 `false`를 반환하면 모니터링 기준이 충족되지 않습니다.

JavaScript 표현식을 모니터링 기준으로 사용하는 것은 다음 모니터링 유형에서 사용할 수 있습니다: API, 웹사이트 및 수신 요청.

### 웹사이트 및 API 모니터

다음 변수는 모니터링되는 객체의 컨텍스트에서 사용할 수 있습니다:

| 변수                 | 설명                                                          | 유형                 |
| -------------------- | ------------------------------------------------------------- | -------------------- |
| `responseBody`       | 응답 본문 객체. HTML/XML이면 문자열 유형. JSON이면 JSON 형식. | `string` 또는 `JSON` |
| `responseHeaders`    | 응답 헤더 객체.                                               | `Dictionary<string>` |
| `responseStatusCode` | 응답 상태 코드.                                               | `number`             |
| `responseTimeInMs`   | 밀리초 단위의 응답 시간.                                      | `number`             |

#### 예시

다음 예시는 JavaScript 표현식을 사용하여 응답 본문의 특정 문자열에 대한 웹사이트를 모니터링하는 방법을 보여줍니다:

```javascript

/**
 *
 * 응답 본문이 JSON인 경우 responseBody는 JSON 객체가 됩니다
 * {
 *    "item": "hello"
 * }
 *
 *  **/

"{{responseBody.item}}" === "hello"

// 또는 응답 헤더를 사용할 수 있습니다

"{{responseHeaders.contentType}} === "application/json"


// 정규식을 사용할 수도 있습니다

"{{responseBody.item}}".match(/hello/)

// 응답 상태 코드를 사용할 수도 있습니다

{{responseStatusCode}} === 200

// 논리 연산자를 사용하여 여러 표현식을 결합할 수 있습니다

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// 배열의 경우 다음을 사용할 수 있습니다

/**
 *
 * 응답 본문이 다음과 같은 경우:
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 *
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### 수신 요청 모니터

다음 변수는 모니터링되는 객체의 컨텍스트에서 사용할 수 있습니다:

| 변수             | 설명            | 유형                 |
| ---------------- | --------------- | -------------------- |
| `requestBody`    | 요청 본문 객체. | `string` 또는 `JSON` |
| `requestHeaders` | 요청 헤더 객체. | `Dictionary<string>` |

#### 예시

다음 예시는 JavaScript 표현식을 사용하여 요청 본문의 특정 문자열에 대한 수신 요청을 모니터링하는 방법을 보여줍니다:

```javascript
"{{requestBody.item}}" === "hello";

// 또는 요청 헤더를 사용할 수 있습니다

"{{requestHeaders.contentType}}" === "text/html";

// 정규식을 사용할 수도 있습니다

"{{requestBody.item}}".match(/hello/);

// 논리 연산자를 사용하여 여러 표현식을 결합할 수 있습니다

"{{requestBody.item}}" === "hello" &&
  "{{requestHeaders.contentType}}" === "text/html";

// 배열에는 다음을 사용할 수 있습니다

"{{requestBody.items[0].name}}" === "hello";
```

### 고려해야 할 사항

- 스크립트의 타임아웃은 1초이며, 스크립트 실행이 1초 이상 걸리면 `false`를 반환합니다.
- `{{var}}`는 변수를 값으로 교체합니다. 문자열을 비교하려면 따옴표로 감싸야 합니다 (예: `"{{responseBody.item}}" === "hello"`). 숫자를 비교하는 경우 따옴표가 필요하지 않습니다 (예: `{{responseStatusCode}} === 200`).
