# معیار پایش: عبارت JavaScript

می‌توانید با عبارت‌های JavaScript معیارهای پایش سفارشی بسازید. عبارت در بافتار شیء پایش‌شده ارزیابی می‌شود. عبارت باید یک مقدار بولی برگرداند. اگر عبارت `true` برگرداند، معیار پایش برقرار است. اگر `false` برگرداند، معیار برقرار نیست.

عبارت JavaScript به‌عنوان معیار پایش برای این نوع‌های پایش در دسترس است: API، وب‌سایت و درخواست ورودی.

### مانیتورهای وب‌سایت و API

این متغیرها در بافتار شیء پایش‌شده در دسترس‌اند:

| متغیر                | توضیحات                                                                                                                                         | نوع                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `responseBody`       | شیء بدنه پاسخ. اگر بدنه پاسخ HTML / XML باشد از نوع رشته است. اگر بدنه پاسخ JSON باشد، این مقدار JSON خواهد بود                                  | `string` یا `JSON`   |
| `responseHeaders`    | شیء هدرهای پاسخ.                                                                                                                                | `Dictionary<string>` |
| `responseStatusCode` | کد وضعیت پاسخ.                                                                                                                                  | `number`             |
| `responseTimeInMs`   | زمان پاسخ به میلی‌ثانیه.                                                                                                                        | `number`             |

#### نمونه

نمونه زیر نشان می‌دهد چگونه با یک عبارت JavaScript، یک وب‌سایت را برای رشته‌ای مشخص در بدنه پاسخ پایش کنید:

```javascript

/**
 *
 * If response body is in JSON then responseBody will be a JSON object
 * {
 *    "item": "hello"
 * }
 *
 *  **/

"{{responseBody.item}}" === "hello"

// or you can use response headers

"{{responseHeaders.contentType}} === "application/json"


// you can also use regular expressions

"{{responseBody.item}}".match(/hello/)

// you can also use response status code

{{responseStatusCode}} === 200

// you can combine multiple expressions using logical operators

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// for arrays you can use the following

/**
 *
 * If response body is:
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 *
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### مانیتورهای درخواست ورودی

این متغیرها در بافتار شیء پایش‌شده در دسترس‌اند:

| متغیر            | توضیحات                     | نوع                  |
| ---------------- | --------------------------- | -------------------- |
| `requestBody`    | شیء بدنه درخواست.           | `string` یا `JSON`   |
| `requestHeaders` | شیء هدرهای درخواست.         | `Dictionary<string>` |

#### نمونه

نمونه زیر نشان می‌دهد چگونه با یک عبارت JavaScript، یک درخواست ورودی را برای رشته‌ای مشخص در بدنه درخواست پایش کنید:

```javascript
"{{requestBody.item}}" === "hello";

// or you can use request headers

"{{requestHeaders.contentType}}" === "text/html";

// you can also use regular expressions

"{{requestBody.item}}".match(/hello/);

// you can combine multiple expressions using logical operators

"{{requestBody.item}}" === "hello" &&
  "{{requestHeaders.contentType}}" === "text/html";

// you can use the following for arrays

"{{requestBody.items[0].name}}" === "hello";
```

### نکته‌هایی که باید در نظر بگیرید

- اسکریپت‌ها وقفه‌ای ۱ ثانیه‌ای دارند؛ اگر اجرای اسکریپت بیش از ۱ ثانیه طول بکشد `false` برمی‌گرداند.
- `{{var}}` متغیر را با مقدارش جایگزین می‌کند، بنابراین اگر می‌خواهید یک رشته را مقایسه کنید باید آن را در گیومه بگذارید، برای نمونه `"{{responseBody.item}}" === "hello"`، و اگر می‌خواهید یک عدد را مقایسه کنید نیازی به گیومه نیست، برای نمونه `{{responseStatusCode}} === 200`
