# Synthetic Monitor

Synthetic monitoring user interactions simulate करके आपके applications को proactively monitor करने का एक तरीका है। आप दुनिया के विभिन्न स्थानों से अपने applications की availability और performance जांचने के लिए एक synthetic monitor बना सकते हैं।

#### उदाहरण

निम्नलिखित उदाहरण दिखाता है कि Synthetic Monitor कैसे उपयोग करें:

```javascript
// script के context में उपलब्ध Objects हैं:

// - axios: HTTP requests करने के लिए Axios module
// - page: browser के साथ interact करने के लिए Playwright Page object
// - browserType: वर्तमान run context में Browser type - Chromium, Firefox, Webkit
// - screenSizeType: वर्तमान run context में Screen size type - Mobile, Tablet, Desktop

// आप browser के साथ interact करने और HTTP requests करने के लिए इन objects का उपयोग कर सकते हैं।

await page.goto("https://playwright.dev/");

// Playwright Documentation यहाँ: https://playwright.dev/docs/intro

// यहाँ कुछ variables हैं जो आप monitored object के context में उपयोग कर सकते हैं:

console.log(browserType); // यह वर्तमान run context में browser type list करेगा - Chromium, Firefox, Webkit

console.log(screenSizeType); // यह वर्तमान run context में screen size type list करेगा - Mobile, Tablet, Desktop

// Playwright page object उस specific browser context का है, इसलिए आप browser के साथ interact करने के लिए इसका उपयोग कर सकते हैं।

// Screenshots लेने के लिए, उन्हें script context में provided `screenshots` object को assign करें।
// इस तरह capture किए गए Screenshots preserved रहते हैं चाहे script बाद में throw करे — failed runs debug करने के लिए उपयोगी।

screenshots["screenshot-name"] = await page.screenshot(); // आप multiple screenshots save कर सकते हैं और उन्हें अलग-अलग names दे सकते हैं।

// जब आप value return करना चाहते हैं, तो data को prop के रूप में return statement उपयोग करें।

// data log करने के लिए, console.log उपयोग करें
// console.log('Hello World');

// यदि आवश्यक हो तो आप page.context() के माध्यम से browser context access कर सकते हैं (उदाहरण के लिए, एक नया page बनाने या popups handle करने के लिए)।

return {
  data: "Hello World",
};
```

### Playwright का उपयोग

हम user interactions simulate करने के लिए Playwright उपयोग करते हैं। आप Playwright `page` object का उपयोग browser के साथ interact करने और buttons clicking, forms filling और screenshots लेने जैसे actions perform करने के लिए कर सकते हैं।

### Screenshots

script context में एक pre-declared `screenshots` object उपलब्ध है। script में किसी भी point पर इसे screenshots assign करें — ये screenshots **चाहे script throw करे** (assertion failures, timeouts, या unexpected errors सहित) capture होते हैं, इसलिए आप देख सकते हैं कि run fail होने पर page कैसा दिखता था। Captured screenshots उस specific monitor run के लिए OneUptime Dashboard में दिखाई देते हैं।

```javascript
// `screenshots` side-channel के माध्यम से Screenshots capture करें — ये success और failure दोनों पर preserved होते हैं।

await page.goto("https://app.example.com/login");
screenshots["login-page"] = await page.screenshot();

await page.fill("#email", "user@example.com");
await page.fill("#password", "wrong");
await page.click("button[type=submit]");

// यदि अगला assertion throw करता है, तो ऊपर का `login-page` screenshot अभी भी capture होगा।
await page.waitForSelector(".dashboard", { timeout: 5000 });

screenshots["dashboard"] = await page.screenshot();

return {
  data: "Login succeeded",
};
```

#### Screenshots return करना (legacy)

Backward compatibility के लिए, आप script से return value के हिस्से के रूप में screenshots return भी कर सकते हैं। इस तरह return किए गए Screenshots **केवल** तभी capture होते हैं जब script normally complete होती है — यदि script throw करती है तो वे lost हो जाते हैं। जब आप failures का evidence चाहते हैं तो ऊपर के side-channel pattern को prefer करें।

```javascript
// Legacy pattern — screenshots केवल successful return पर capture होते हैं।
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
};
```

### Monitor Secrets का उपयोग

#### एक secret जोड़ना

secret जोड़ने के लिए, कृपया OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret पर जाएं।

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

आप चुन सकते हैं कि कौन से monitors को secret तक पहुंच हो। इस मामले में हमने `ApiKey` secret जोड़ा और monitors को उस तक पहुंच देने के लिए चुना।

**कृपया ध्यान दें**: Secrets encrypted और सुरक्षित रूप से stored होते हैं। यदि आप secret खो देते हैं, तो आपको एक नया secret बनाना होगा। Save होने के बाद आप secret देख या update नहीं कर सकते।

#### एक secret का उपयोग

script में Monitor Secrets उपयोग करने के लिए, आप script के context में `monitorSecrets` object उपयोग कर सकते हैं।

```javascript
// यदि आपका secret string type का है तो आपको इसे quotes में wrap करना होगा
let stringSecret = '{{monitorSecrets.StringSecret}}';

// यदि आपका secret number या boolean type का है तो आप इसे directly उपयोग कर सकते हैं
let numberSecret = {{monitorSecrets.NumberSecret}};

// यदि आपका secret boolean type का है तो आप इसे directly उपयोग कर सकते हैं
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// आप console log भी कर सकते हैं यह देखने के लिए कि secrets सही तरीके से fetch हो रहे हैं
console.log(stringSecret);
```

### Custom Metrics

आप `oneuptime.captureMetric()` function का उपयोग करके अपने script से custom metrics capture कर सकते हैं।

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (string, आवश्यक): metric name (जैसे `"dashboard.load.time"`)। इसे automatically `custom.monitor.` prefix के साथ stored किया जाएगा।
- `value` (number, आवश्यक): numeric metric value।
- `attributes` (object, वैकल्पिक): अतिरिक्त context के लिए Key-value pairs।

#### उदाहरण

```javascript
await page.goto("https://app.example.com");

const startTime = Date.now();
await page.waitForSelector("#dashboard-loaded");
const loadTime = Date.now() - startTime;

// page load time को custom metric के रूप में capture करें
oneuptime.captureMetric("dashboard.load.time", loadTime, {
  page: "dashboard",
});

screenshots["dashboard"] = await page.screenshot();

return {
  data: { loadTime },
};
```

**सीमाएं:**

- प्रति script execution अधिकतम 100 metrics।
- Metric names 200 characters तक सीमित।
- Values numeric होनी चाहिए।

### Script में उपलब्ध Modules

- `page`: आप इस module का उपयोग browser के साथ interact करने के लिए कर सकते हैं। यह एक Playwright Page object है।
- `screenshots`: एक pre-declared object जिसे आप screenshots assign करते हैं। यहाँ assign किए गए Screenshots चाहे script बाद में throw करे preserved होते हैं।
- `axios`: आप इस module का उपयोग HTTP requests करने के लिए कर सकते हैं।
- `crypto`: आप इस module का उपयोग cryptographic operations करने के लिए कर सकते हैं।
- `console.log`: आप इस module का उपयोग console में data log करने के लिए कर सकते हैं।
- `oneuptime.captureMetric`: आप इसका उपयोग अपने script से custom metrics capture करने के लिए कर सकते हैं।
- `http`: HTTP requests के लिए built-in Node.js module।
- `https`: HTTPS requests के लिए built-in Node.js module।

### ध्यान देने योग्य बातें

- `page` object browser के साथ interact करने का primary interface है।
- आप `console.log` का उपयोग console में data log करने के लिए कर सकते हैं।
- आप `return` statement का उपयोग करके script से data return कर सकते हैं। Screenshots को provided `screenshots` object को assign करें।
- आप वर्तमान run context में browser type और screen size type पाने के लिए `browserType` और `screenSizeType` variables उपयोग कर सकते हैं।
- यह एक JavaScript script है, इसलिए आप script में सभी JavaScript features उपयोग कर सकते हैं।
- यदि आप oneuptime.com उपयोग कर रहे हैं, तो script के context में Playwright और browsers का latest version हमेशा उपलब्ध होगा।
- Script का Timeout 2 minutes है। यदि script 2 minutes से अधिक लेती है, तो इसे terminate कर दिया जाएगा।
