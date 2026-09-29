# Monitoring Criteria: JavaScript Expression

आप custom monitoring criteria बनाने के लिए JavaScript expressions उपयोग कर सकते हैं। expression को monitored object के context में evaluate किया जाता है। expression एक boolean value return करना चाहिए। यदि expression `true` return करता है, तो monitoring criteria पूरी होती है। यदि expression `false` return करता है, तो monitoring criteria पूरी नहीं होती।

Monitoring criteria के रूप में JavaScript expression निम्नलिखित monitoring types के लिए उपलब्ध है: API, Website, और Incoming Request।

### Website और API monitors

निम्नलिखित variables monitored object के context में उपलब्ध हैं:

| Variable             | विवरण                                                                                                                         | Type                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `responseBody`       | response body object। यदि response body HTML/XML में है तो यह string type होगा। यदि response body JSON में है तो यह JSON होगा | `string` या `JSON`   |
| `responseHeaders`    | response headers object।                                                                                                      | `Dictionary<string>` |
| `responseStatusCode` | response status code।                                                                                                         | `number`             |
| `responseTimeInMs`   | milliseconds में response time।                                                                                               | `number`             |

#### उदाहरण

निम्नलिखित उदाहरण दिखाता है कि response body में एक specific string के लिए website monitor करने के लिए JavaScript expression कैसे उपयोग करें:

```javascript

/**
 *
 * यदि response body JSON में है तो responseBody एक JSON object होगा
 * {
 *    "item": "hello"
 * }
 *
 *  **/

"{{responseBody.item}}" === "hello"

// या आप response headers उपयोग कर सकते हैं

"{{responseHeaders.contentType}} === "application/json"


// आप regular expressions भी उपयोग कर सकते हैं

"{{responseBody.item}}".match(/hello/)

// आप response status code भी उपयोग कर सकते हैं

{{responseStatusCode}} === 200

// आप logical operators का उपयोग करके multiple expressions combine कर सकते हैं

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// arrays के लिए आप निम्नलिखित उपयोग कर सकते हैं

/**
 *
 * यदि response body है:
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 *
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### Incoming Request monitors

निम्नलिखित variables monitored object के context में उपलब्ध हैं:

| Variable         | विवरण                   | Type                 |
| ---------------- | ----------------------- | -------------------- |
| `requestBody`    | request body object।    | `string` या `JSON`   |
| `requestHeaders` | request headers object। | `Dictionary<string>` |

#### उदाहरण

निम्नलिखित उदाहरण दिखाता है कि request body में एक specific string के लिए incoming request monitor करने के लिए JavaScript expression कैसे उपयोग करें:

```javascript
"{{requestBody.item}}" === "hello";

// या आप request headers उपयोग कर सकते हैं

"{{requestHeaders.contentType}}" === "text/html";

// आप regular expressions भी उपयोग कर सकते हैं

"{{requestBody.item}}".match(/hello/);

// आप logical operators का उपयोग करके multiple expressions combine कर सकते हैं

"{{requestBody.item}}" === "hello" &&
  "{{requestHeaders.contentType}}" === "text/html";

// arrays के लिए आप निम्नलिखित उपयोग कर सकते हैं

"{{requestBody.items[0].name}}" === "hello";
```

### ध्यान देने योग्य बातें

- scripts का timeout 1 second है, यदि script 1 second से अधिक समय लेती है तो यह `false` return करेगी।
- `{{var}}` variable को value से replace करेगा, इसलिए यदि आप string compare करना चाहते हैं, तो आपको इसे quotes में wrap करना होगा, जैसे `"{{responseBody.item}}" === "hello"` और यदि आप number compare करना चाहते हैं, तो आपको quotes में wrap करने की आवश्यकता नहीं है, जैसे `{{responseStatusCode}} === 200`
