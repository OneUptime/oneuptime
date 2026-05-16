# 합성 모니터

합성 모니터링은 사용자 인터랙션을 시뮬레이션하여 애플리케이션을 사전 예방적으로 모니터링하는 방법입니다. 합성 모니터를 생성하여 전 세계 다양한 위치에서 애플리케이션의 가용성과 성능을 확인할 수 있습니다.

#### 예시

다음 예시는 합성 모니터를 사용하는 방법을 보여줍니다:

```javascript

// 스크립트 컨텍스트에서 사용 가능한 객체:

// - axios: HTTP 요청을 만들기 위한 Axios 모듈
// - page: 브라우저와 상호 작용하기 위한 Playwright Page 객체
// - browserType: 현재 실행 컨텍스트의 브라우저 유형 - Chromium, Firefox, Webkit
// - screenSizeType: 현재 실행 컨텍스트의 화면 크기 유형 - Mobile, Tablet, Desktop

// 이러한 객체를 사용하여 브라우저와 상호 작용하고 HTTP 요청을 만들 수 있습니다.

await page.goto('https://playwright.dev/');

// Playwright 문서: https://playwright.dev/docs/intro

// 모니터링되는 객체의 컨텍스트에서 사용할 수 있는 변수:

console.log(browserType) // 현재 실행 컨텍스트의 브라우저 유형을 나열합니다 - Chromium, Firefox, Webkit

console.log(screenSizeType) // 현재 실행 컨텍스트의 화면 크기 유형을 나열합니다 - Mobile, Tablet, Desktop

// Playwright page 객체는 해당 브라우저 컨텍스트에 속하므로 브라우저와 상호 작용하는 데 사용할 수 있습니다.

// 스크린샷을 찍으려면 스크립트 컨텍스트에서 제공되는 `screenshots` 객체에 할당합니다.
// 이 방법으로 캡처된 스크린샷은 스크립트가 나중에 실패해도 보존됩니다 — 실패한 실행 디버깅에 유용합니다.

screenshots['screenshot-name'] = await page.screenshot(); // 여러 스크린샷을 저장하고 다른 이름을 붙일 수 있습니다.

// 값을 반환하려면 data 속성이 있는 return 문을 사용합니다.

// 데이터를 로그하려면 console.log를 사용합니다
// console.log('Hello World');

// 필요한 경우 page.context()를 통해 브라우저 컨텍스트에 액세스할 수 있습니다 (예: 새 페이지 만들기 또는 팝업 처리).


return {
    data: 'Hello World'
};
```

### Playwright 사용

사용자 인터랙션을 시뮬레이션하기 위해 Playwright를 사용합니다. Playwright `page` 객체를 사용하여 브라우저와 상호 작용하고 버튼 클릭, 양식 작성, 스크린샷 찍기와 같은 작업을 수행할 수 있습니다. 

### 스크린샷

스크립트 컨텍스트에서 미리 선언된 `screenshots` 객체를 사용할 수 있습니다. 스크립트의 어느 지점에서나 스크린샷을 할당합니다 — 이 스크린샷은 스크립트가 실패해도 (어설션 실패, 타임아웃 또는 예상치 못한 오류 포함) **캡처됩니다**. 따라서 실행이 실패했을 때 페이지가 어떻게 보였는지 정확히 확인할 수 있습니다. 캡처된 스크린샷은 해당 특정 모니터 실행에 대한 OneUptime 대시보드에 나타납니다.

```javascript

// 성공 및 실패 시 모두 보존되는 스크린샷 사이드 채널을 통해 캡처합니다.

await page.goto('https://app.example.com/login');
screenshots['login-page'] = await page.screenshot();

await page.fill('#email', 'user@example.com');
await page.fill('#password', 'wrong');
await page.click('button[type=submit]');

// 다음 어설션이 실패해도 위의 'login-page' 스크린샷은 여전히 캡처됩니다.
await page.waitForSelector('.dashboard', { timeout: 5000 });

screenshots['dashboard'] = await page.screenshot();

return {
    data: 'Login succeeded'
};

```

#### 스크린샷 반환 (레거시)

하위 호환성을 위해 반환 값의 일부로 스크립트에서 스크린샷을 반환할 수도 있습니다. 이 방법으로 반환된 스크린샷은 스크립트가 정상적으로 완료될 때만 캡처됩니다 — 스크립트가 실패하면 손실됩니다. 실패의 증거를 원한다면 위의 사이드 채널 패턴을 사용하십시오.

```javascript
// 레거시 패턴 — 성공적인 반환 시에만 스크린샷이 캡처됩니다.
const screenshots = {};
screenshots['screenshot-name'] = await page.screenshot();

return {
    data: 'Hello World',
    screenshots: screenshots
};
```


### 모니터 시크릿 사용

#### 시크릿 추가

시크릿을 추가하려면 OneUptime 대시보드 -> 프로젝트 설정 -> 모니터 시크릿 -> 모니터 시크릿 생성으로 이동하십시오.

![시크릿 생성](/docs/static/images/CreateMonitorSecret.png)

어느 모니터가 시크릿에 액세스할 수 있는지 선택할 수 있습니다. 이 경우 `ApiKey` 시크릿을 추가하고 액세스할 모니터를 선택했습니다.

**참고**: 시크릿은 암호화되어 안전하게 저장됩니다. 시크릿을 분실하면 새 시크릿을 생성해야 합니다. 저장 후에는 시크릿을 보거나 업데이트할 수 없습니다. 

#### 시크릿 사용

스크립트에서 모니터 시크릿을 사용하려면 스크립트 컨텍스트에서 `monitorSecrets` 객체를 사용할 수 있습니다.

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

- `name` (문자열, 필수): 메트릭 이름 (예: `"dashboard.load.time"`). `custom.monitor.` 접두사가 자동으로 저장됩니다.
- `value` (숫자, 필수): 숫자 메트릭 값.
- `attributes` (객체, 선택 사항): 추가 컨텍스트를 위한 키-값 쌍.

#### 예시

```javascript
await page.goto('https://app.example.com');

const startTime = Date.now();
await page.waitForSelector('#dashboard-loaded');
const loadTime = Date.now() - startTime;

// 페이지 로드 시간을 커스텀 메트릭으로 캡처
oneuptime.captureMetric('dashboard.load.time', loadTime, {
    page: 'dashboard'
});

screenshots['dashboard'] = await page.screenshot();

return {
    data: { loadTime }
};
```

캡처된 후 이러한 메트릭은 `custom.monitor.dashboard.load.time`과 같은 이름으로 메트릭 탐색기에 나타납니다. 대시보드 차트에 추가하고 알림을 설정하며 모니터, 프로브, 브라우저 유형, 화면 크기 또는 제공한 커스텀 속성으로 필터링할 수 있습니다.

**제한 사항:**
- 스크립트 실행당 최대 100개의 메트릭.
- 메트릭 이름은 200자로 제한됩니다.
- 값은 숫자여야 합니다.

### 스크립트에서 사용 가능한 모듈
- `page`: 브라우저와 상호 작용하는 데 사용할 수 있습니다. 버튼 클릭, 양식 작성, 스크린샷 찍기와 같은 작업을 수행할 수 있는 Playwright Page 객체입니다. 필요한 경우 `page.context()`를 통해 브라우저 컨텍스트에 액세스할 수 있습니다 (예: 새 페이지 만들기 또는 팝업 처리).
- `screenshots`: 스크린샷을 할당하는 미리 선언된 객체 (예: `screenshots['login-page'] = await page.screenshot()`). 여기에 할당된 스크린샷은 스크립트가 나중에 실패해도 캡처됩니다.
- `axios`: HTTP 요청을 만들 수 있습니다. 브라우저와 Node.js를 위한 프로미스 기반 HTTP 클라이언트입니다.
- `crypto`: 암호화 작업을 수행할 수 있습니다. OpenSSL의 해시, HMAC, 암호화, 복호화, 서명 및 검증 함수에 대한 래퍼를 제공하는 내장 Node.js 모듈입니다.
- `console.log`: 콘솔에 데이터를 로그할 수 있습니다. 디버깅 목적에 유용합니다.
- `oneuptime.captureMetric`: 스크립트에서 커스텀 메트릭을 캡처하는 데 사용합니다. 위의 커스텀 메트릭 섹션을 참조하십시오.
- `http`: HTTP 요청을 만들 수 있습니다. HTTP 클라이언트와 서버를 제공하는 내장 Node.js 모듈입니다.
- `https`: HTTPS 요청을 만들 수 있습니다. HTTPS 클라이언트와 서버를 제공하는 내장 Node.js 모듈입니다.

### 고려해야 할 사항

- `page` 객체는 브라우저와 상호 작용하는 기본 인터페이스입니다. 이것은 Playwright Page 클래스에서 가져옵니다. 필요한 경우 `page.context()`를 통해 브라우저 컨텍스트에 액세스할 수 있습니다.
- `console.log`를 사용하여 콘솔에 데이터를 로그할 수 있습니다. 이는 모니터의 로그 섹션에서 사용할 수 있습니다.
- `return` 문을 사용하여 스크립트에서 데이터를 반환할 수 있습니다. 스크립트가 실패해도 보존되도록 제공된 `screenshots` 객체에 스크린샷을 할당합니다.
- `browserType` 및 `screenSizeType` 변수를 사용하여 현재 실행 컨텍스트의 브라우저 유형과 화면 크기 유형을 가져올 수 있습니다.
- 이것은 JavaScript 스크립트이므로 스크립트에서 모든 JavaScript 기능을 사용할 수 있습니다.
- 스크립트에서 HTTP 요청을 만들기 위해 `axios` 모듈을 사용할 수 있습니다.
- oneuptime.com을 사용하는 경우 항상 스크립트 컨텍스트에서 최신 버전의 Playwright 및 브라우저를 사용할 수 있습니다. 자체 호스팅하는 경우 최신 버전의 Playwright와 브라우저를 갖도록 프로브를 업데이트하십시오.
- 스크립트 타임아웃은 2분입니다. 스크립트가 2분 이상 걸리면 종료됩니다.
