# قالب‌بندی پویای حادثه و هشدار

می‌توانید از همان نحو جانگهدار `{{variable}}` که عبارت‌های JavaScript در معیارهای مانیتور به کار می‌برند استفاده کنید تا Title، Description و Remediation Notes حادثه‌ها و هشدارها را — وقتی خودکار از معیارهای مانیتور ساخته می‌شوند — پویا پر کنید.

## نوع‌های مانیتور و متغیرهای پشتیبانی‌شده

نوع‌های مانیتور زیر با متغیرهای مربوط به خودشان از قالب‌بندی پویا پشتیبانی می‌کنند:

- **مانیتورهای وب‌سایت و API**: داده پاسخ، هدرها، کدهای وضعیت، زمان‌بندی
- **مانیتورهای درخواست ورودی**: داده درخواست، هدرها، روش‌ها، زمان‌بندی
- **مانیتورهای Ping**: وضعیت اتصال، زمان‌های پاسخ، علت‌های شکست
- **مانیتورهای پورت**: اتصال پورت، زمان‌های پاسخ، وضعیت اتمام مهلت
- **مانیتورهای IP**: دست‌یافتنی بودن IP، زمان‌های ping، اطلاعات شکست
- **مانیتورهای گواهی SSL**: جزئیات گواهی، وضعیت اعتبارسنجی، اطلاعات انقضا
- **مانیتورهای سرور / ماشین مجازی**: سنجه‌های سامانه (CPU، حافظه، دیسک)، فرایندها، نام میزبان
- **مانیتورهای مصنوعی**: نتایج اجرای اسکریپت، عکس‌ها، جزئیات مرورگر
- **مانیتورهای کد سفارشی JavaScript**: نتایج اجرا، زمان‌بندی، پیام‌های خطا
- **مانیتورهای دستگاه شبکه (SNMP)**: دست‌یافتنی بودن دستگاه، زمان پیمایش SNMP، مقادیر OID

> **یادداشت**: مانیتورهای Logs، Traces و Metrics در حال حاضر از قالب‌بندی حادثه/هشدار پشتیبانی نمی‌کنند، چون سازوکارهای برانگیزش متفاوتی به کار می‌برند.

## نوع‌های مانیتور و متغیرهای پشتیبانی‌شده

### مانیتورهای وب‌سایت و API

| متغیر                | توضیحات                                                                        | نوع                  |
| -------------------- | ------------------------------------------------------------------------------ | -------------------- |
| `responseBody`       | شیء بدنه پاسخ. اگر HTML / XML باشد رشته است. اگر JSON باشد شیء JSON است.       | `string` یا `JSON`   |
| `responseHeaders`    | شیء هدرهای پاسخ (کلیدها با حروف کوچک).                                         | `Dictionary<string>` |
| `responseStatusCode` | کد وضعیت پاسخ HTTP.                                                            | `number`             |
| `responseTimeInMs`   | زمان پاسخ به میلی‌ثانیه.                                                       | `number`             |
| `isOnline`           | اینکه مانیتور آنلاین به‌شمار می‌آید یا نه.                                     | `boolean`            |

### مانیتورهای درخواست ورودی

| متغیر                       | توضیحات                                                    | نوع                  |
| --------------------------- | ---------------------------------------------------------- | -------------------- |
| `requestBody`               | شیء بدنه درخواست.                                          | `string` یا `JSON`   |
| `requestHeaders`            | شیء هدرهای درخواست (کلیدها با حروف کوچک).                  | `Dictionary<string>` |
| `requestMethod`             | روش HTTP درخواست ورودی (GET، POST و مانند آن).             | `string`             |
| `incomingRequestReceivedAt` | تاریخ و زمانی که درخواست ورودی دریافت شد.                  | `Date`               |

وقتی در معیار گزینه **Group incidents and alerts by a payload field** روشن باشد، کلید گروه‌بندی استخراج‌شده هم در دسترس است، زیر متغیری که نامش از **آخرین بخش** مسیر گروه‌بندی گرفته شده. گروه‌بندی بر پایه `requestBody.alerts[*].labels.alertname` به شما `{{alertname}}` می‌دهد؛ گروه‌بندی بر پایه `requestBody.alerts[*].fingerprint` به شما `{{fingerprint}}` می‌دهد. مقدار کامل `requestBody` همچنان در کنارش در دسترس است.

> **یادداشت:** ‏`[*]` فقط در خود فیلدهای مسیر گروه‌بندی فهمیده می‌شود — اینجا تفکیک نمی‌شود، پس جانگهدار عیناً با آکولادهایش چاپ می‌شود. درون عنوان یا توضیحات، `{{requestBody.alerts[0].annotations.summary}}` همیشه نخستین هشدار محموله را می‌خواند، نه هشداری که حادثه برایش باز شده است. به‌جایش متغیر گروه‌بندی و فیلدهای مشترک محموله (`commonLabels`، `commonAnnotations`) را به کار ببرید. [مانیتور درخواست ورودی](/docs/monitor/incoming-request-monitor) را ببینید.

### مانیتورهای Ping

| متغیر              | توضیحات                                       | نوع       |
| ------------------ | --------------------------------------------- | --------- |
| `isOnline`         | اینکه هدف ping آنلاین به‌شمار می‌آید یا نه.   | `boolean` |
| `responseTimeInMs` | زمان پاسخ ping به میلی‌ثانیه.                 | `number`  |
| `failureCause`     | دلیل شکست، اگر ping شکست خورده باشد.          | `string`  |
| `isTimeout`        | اینکه مهلت درخواست ping تمام شده است یا نه.   | `boolean` |

### مانیتورهای پورت

| متغیر              | توضیحات                                                                 | نوع       |
| ------------------ | ----------------------------------------------------------------------- | --------- |
| `isOnline`         | اینکه پورت آنلاین/در دسترس به‌شمار می‌آید یا نه.                        | `boolean` |
| `responseTimeInMs` | زمان کل اتصال (جست‌وجوی DNS به‌علاوه اتصال TCP) به میلی‌ثانیه.           | `number`  |
| `failureCause`     | دلیل شکست، اگر بررسی پورت شکست خورده باشد.                              | `string`  |
| `isTimeout`        | اینکه مهلت اتصال پورت تمام شده است یا نه.                               | `boolean` |

### مانیتورهای IP

| متغیر              | توضیحات                                        | نوع       |
| ------------------ | ---------------------------------------------- | --------- |
| `isOnline`         | اینکه نشانی IP آنلاین به‌شمار می‌آید یا نه.    | `boolean` |
| `responseTimeInMs` | زمان پاسخ ping به میلی‌ثانیه.                  | `number`  |
| `failureCause`     | دلیل شکست، اگر بررسی IP شکست خورده باشد.       | `string`  |
| `isTimeout`        | اینکه مهلت درخواست ping به IP تمام شده یا نه.  | `boolean` |

### مانیتورهای گواهی SSL

| متغیر                | توضیحات                                            | نوع       |
| -------------------- | -------------------------------------------------- | --------- |
| `isOnline`           | اینکه بررسی گواهی SSL موفق بوده است یا نه.         | `boolean` |
| `isSelfSigned`       | اینکه گواهی SSL خودامضاست یا نه.                   | `boolean` |
| `createdAt`          | تاریخی که گواهی SSL ساخته شده است.                 | `Date`    |
| `expiresAt`          | تاریخی که گواهی SSL منقضی می‌شود.                  | `Date`    |
| `commonName`         | نام مشترک (CN) در گواهی.                           | `string`  |
| `organizationalUnit` | واحد سازمانی (OU) در گواهی.                        | `string`  |
| `organization`       | سازمان (O) در گواهی.                               | `string`  |
| `locality`           | محل (L) در گواهی.                                  | `string`  |
| `state`              | استان/ایالت (ST) در گواهی.                         | `string`  |
| `country`            | کشور (C) در گواهی.                                 | `string`  |
| `serialNumber`       | شماره سریال گواهی.                                 | `string`  |
| `fingerprint`        | اثر انگشت SHA-1 گواهی.                             | `string`  |
| `fingerprint256`     | اثر انگشت SHA-256 گواهی.                           | `string`  |
| `failureCause`       | دلیل شکست، اگر بررسی SSL شکست خورده باشد.          | `string`  |

### مانیتورهای سرور / ماشین مجازی

| متغیر                        | توضیحات                                                         | نوع             |
| ---------------------------- | --------------------------------------------------------------- | --------------- |
| `hostname`                   | نام میزبان سرور پایش‌شده.                                       | `string`        |
| `requestReceivedAt`          | تاریخ و زمانی که درخواست مانیتور سرور دریافت شد.                | `Date`          |
| `cpuUsagePercent`            | درصد مصرف CPU.                                                  | `number`        |
| `cpuCores`                   | شمار هسته‌های CPU.                                              | `number`        |
| `memoryUsagePercent`         | درصد مصرف حافظه.                                                | `number`        |
| `memoryFreePercent`          | درصد حافظه آزاد.                                                | `number`        |
| `memoryTotalBytes`           | کل حافظه به بایت.                                               | `number`        |
| `diskMetrics`                | آرایه سنجه‌های دیسک برای همه دیسک‌های سوارشده.                  | `Array<Object>` |
| `diskMetrics[].diskPath`     | مسیر نقطه اتصال دیسک.                                           | `string`        |
| `diskMetrics[].usagePercent` | درصد مصرف دیسک برای این نقطه اتصال.                             | `number`        |
| `diskMetrics[].freePercent`  | درصد فضای آزاد دیسک برای این نقطه اتصال.                        | `number`        |
| `diskMetrics[].totalBytes`   | کل فضای دیسک به بایت برای این نقطه اتصال.                       | `number`        |
| `processes`                  | آرایه فرایندهای در حال اجرا روی سرور.                           | `Array<Object>` |
| `processes[].pid`            | شناسه فرایند.                                                   | `number`        |
| `processes[].name`           | نام فرایند.                                                     | `string`        |
| `processes[].command`        | فرمانی که فرایند با آن آغاز شده است.                            | `string`        |
| `failureCause`               | دلیل شکست، اگر بررسی سرور شکست خورده باشد.                      | `string`        |

### مانیتورهای مصنوعی

مانیتورهای مصنوعی همان اسکریپت را روی چند مرورگر (Chromium، Firefox، Webkit) و چند اندازه صفحه (موبایل، تبلت، دسکتاپ) اجرا می‌کنند و به ازای هر پیکربندی یک پاسخ تولید می‌کنند. هر اجرا از راه آرایه `syntheticResponses` عرضه می‌شود — به اجرایی مشخص با نمایه دسترسی بگیرید (`{{syntheticResponses[0].browserType}}`) یا با `{{#each syntheticResponses}}` روی آن‌ها تکرار کنید.

| متغیر                                    | توضیحات                                                                                  | نوع                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `failureCause`                           | دلیل شکست، اگر بررسی مصنوعی شکست خورده باشد.                                             | `string`                                 |
| `syntheticResponses`                     | آرایه‌ای که به ازای هر ترکیب مرورگر / اندازه صفحه که اسکریپت روی آن اجرا شده مدخلی دارد. | `Array<Object>`                          |
| `syntheticResponses[].executionTimeInMs` | زمان اجرا به میلی‌ثانیه برای این اجرا.                                                   | `number`                                 |
| `syntheticResponses[].result`            | نتیجه‌ای که این اجرا برگردانده است.                                                      | `string`، `number`، `boolean` یا `JSON`  |
| `syntheticResponses[].scriptError`       | هر خطایی که در جریان این اجرا رخ داده است.                                               | `string`                                 |
| `syntheticResponses[].logMessages`       | پیام‌های گزارشی که در جریان این اجرا تولید شده‌اند.                                      | `Array<string>`                          |
| `syntheticResponses[].screenshots`       | عکس‌هایی که در جریان این اجرا گرفته شده‌اند.                                             | `Object`                                 |
| `syntheticResponses[].browserType`       | مرورگری که برای این اجرا به کار رفته است.                                                | `string`                                 |
| `syntheticResponses[].screenSizeType`    | اندازه صفحه‌ای که برای این اجرا به کار رفته است.                                         | `string`                                 |

### مانیتورهای کد سفارشی JavaScript

| متغیر               | توضیحات                                                    | نوع                                      |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `executionTimeInMs` | زمانی که اجرای کد سفارشی طول کشیده، به میلی‌ثانیه.         | `number`                                 |
| `result`            | نتیجه‌ای که کد سفارشی برگردانده است.                       | `string`، `number`، `boolean` یا `JSON`  |
| `scriptError`       | هر خطایی که در جریان اجرای کد رخ داده است.                 | `string`                                 |
| `logMessages`       | آرایه پیام‌های گزارشی تولیدشده در جریان اجرا.              | `Array<string>`                          |

### مانیتورهای دستگاه شبکه (SNMP)

| متغیر                  | توضیحات                                                        | نوع                  |
| ---------------------- | -------------------------------------------------------------- | -------------------- |
| `isOnline`             | اینکه دستگاه دست‌یافتنی است یا نه — با ping **یا** SNMP. در هر سرکشی تنظیم می‌شود. | `boolean` |
| `responseTimeInMs`     | زمان پاسخ **پیمایش** SNMP به میلی‌ثانیه — هرگز زمان رفت‌وبرگشت ping نیست. | `number` |
| `failureCause`         | دلیل شکست، اگر پیمایش SNMP شکست خورده باشد.                    | `string`             |
| `isTimeout`            | اینکه مهلت پیمایش SNMP تمام شده است یا نه.                     | `boolean`            |
| `oidResponses`         | آرایه شیءهای پاسخ OID با oid، ‏name، ‏value و type.             | `Array<Object>`      |
| `oidResponses[].oid`   | ‏OIDی که پرس‌وجو شد.                                           | `string`             |
| `oidResponses[].name`  | نام خوانای OID (اگر داده شده باشد).                            | `string`             |
| `oidResponses[].value` | مقداری که OID برگردانده است.                                   | `string` یا `number` |
| `oidResponses[].type`  | نوع داده SNMP آن مقدار.                                        | `string`             |
| `{{OID_NAME}}`         | دسترسی مستقیم به مقدار OID با نام (برای نمونه `{{sysUpTime}}`).| `string` یا `number` |
| `sysName`              | نام دستگاه از گروه system در SNMP.                             | `string`             |
| `sysDescr`             | توضیح دستگاه از گروه system در SNMP.                           | `string`             |
| `sysObjectId`          | ‏OID سازمانی ثبت‌شده فروشنده (اثر انگشت دستگاه).               | `string`             |
| `sysLocation`          | محل دستگاه از گروه system در SNMP.                             | `string`             |
| `downInterfaces`       | رابط‌هایی که از نظر مدیریتی بالا اما از نظر عملیاتی پایین‌اند، به‌صورت `{name, alias, interfaceIndex}`. به پایش رابط نیاز دارد. | `Array<Object>` |
| `interfacesTotal`      | شمار کل رابط‌های پیمایش‌شده.                                   | `number`             |
| `interfacesUp`         | رابط‌هایی که از نظر مدیریتی و عملیاتی بالا هستند.              | `number`             |
| `interfacesDown`       | رابط‌هایی که از نظر مدیریتی بالا اما از نظر عملیاتی پایین‌اند. | `number`            |
| `interfaceWalkFailure` | پیام خطا وقتی پیمایش رابط‌ها شکست خورده باشد.                  | `string`             |
| `trapOid`              | ‏OID تله — فقط وقتی تنظیم می‌شود که بررسی را تله‌ای SNMP برانگیخته باشد. | `string`          |
| `trapSourceIp`         | ‏IP مبدأیی که تله از آن دریافت شد — فقط بررسی‌های برانگیخته با تله. | `string`         |
| `trapVarbinds`         | متغیرهای پیوندشده‌ای که تله حمل می‌کند، به‌صورت `{oid, value}` — فقط بررسی‌های برانگیخته با تله. | `Array<Object>` |

هر دستگاه شبکه در هر سرکشی ping می‌شود و فقط وقتی اعتبارنامه داشته باشد از راه SNMP پیمایش می‌شود، پس **`isOnline` تنها متغیری از بالاست که دستگاهی فقط-ping آن را پر می‌کند** — هر متغیر دیگری از پیمایش SNMP می‌آید و بدون آن خالی است. در قالب‌هایی که ممکن است روی دستگاه‌های بدون اعتبارنامه اعمال شوند، `{{isOnline}}` و نام خود دستگاه را جلو بیندازید. برای اینکه بدانید هر گونه سرکشی چه جمع می‌کند [مانیتور دستگاه شبکه](/docs/monitor/network-device-monitor#what-a-poll-actually-does) را ببینید.

### مانیتورهای سلامت پایگاه داده

| متغیر                     | توضیحات                                                                                                              | نوع             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------- |
| `isOnline`                | اینکه پروب توانسته وصل شود و پرس‌وجوی پایه را اجرا کند. سنجه‌های گمشده هرگز این را نادرست نمی‌کنند.                   | `boolean`       |
| `responseTimeInMs`        | زمان وصل شدن و اجرای پرس‌وجوی پایه.                                                                                  | `number`        |
| `failureCause`            | دلیل شکست بررسی، وقتی شکست خورده باشد.                                                                               | `string`        |
| `connectionError`         | خطای اتصال پاک‌سازی‌شده. هرگز اعتبارنامه یا رشته اتصال در بر ندارد.                                                  | `string`        |
| `engineVersion`           | رشته نسخه‌ای که کارساز پایگاه داده گزارش کرده است.                                                                   | `string`        |
| `collectedGroups`         | گروه‌های سنجه‌ای که در این بررسی مقدار تولید کرده‌اند.                                                               | `Array<string>` |
| `unavailableGroups`       | گروه‌هایی که نتوانسته‌اند جمع شوند، به‌صورت `{group, reason, message, remediation}`.                                  | `Array<Object>` |
| `collectionIssueSummary`  | یک خط که هر گروه در دسترس نبوده را خلاصه می‌کند، آماده چسباندن در هشدار.                                             | `string`        |
| `metrics`                 | مقادیر جمع‌شده که با نام سری کلید خورده‌اند، برای نمونه `{{metrics['oneuptime.monitor.database.connections.used.percent']}}`. | `Object`  |

سنجه‌ای که جمع نشده باشد به‌جای صفر بودن از `metrics` **غایب** است،
پس وقتی ممکن است گروهی روی پایگاه داده‌ای که می‌پایید در دسترس نباشد،
محتاطانه قالبش کنید — `{{#if metrics.[...]}}`.

## کاربرد پایه

در فرم Incident / Alert درون نمونه‌ای از معیار مانیتور می‌توانید بنویسید:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

اگر کد وضعیت پاسخ مانیتور `502` و زمان `842` باشد، عنوان ذخیره‌شده این می‌شود:

```
API returned 502 in 842ms
```

دسترسی تودرتو به JSON همان‌گونه کار می‌کند که در عبارت‌های JavaScript:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

نمایه‌گذاری آرایه پشتیبانی می‌شود:

```
First User: {{responseBody.users[0].name}}
```

اگر مسیری وجود نداشته باشد، جانگهدار دقیقاً همان‌گونه که نوشته شده در خروجی می‌ماند — `{{responseBody.error.id}}` عیناً، با آکولادهایش، در عنوان حادثه پدیدار می‌شود. تنها بلوک‌های `{{#each}}` روی مسیری گمشده حذف می‌شوند.

## کاربرد پیشرفته

### دسترسی به عناصر آرایه

```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### دسترسی به شیءهای تودرتو

```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### تکرار روی آرایه‌ها با `{{#each}}`

می‌توانید با نحو بلوکی `{{#each path}}...{{/each}}` روی آرایه‌ها تکرار کنید. این وقتی به کار می‌آید که داده فهرستی از اقلام داشته باشد و بخواهید هرکدام را در توضیحات حادثه یا هشدارتان بگنجانید.

**نحو:**

```
{{#each arrayPath}}
  ...body using {{property}} from each element...
{{/each}}
```

درون بدنه حلقه:

- ‏`{{propertyName}}` نسبت به عنصر جاری آرایه تفکیک می‌شود
- دسترسی نقطه‌ای `{{nested.property}}` روی عنصر جاری کار می‌کند
- ‏`{{@index}}` به نمایه صفرپایه تکرار جاری تفکیک می‌شود
- ‏`{{this}}` به مقدار عنصر جاری تفکیک می‌شود (برای آرایه‌های رشته/عدد به کار می‌آید)
- متغیرهایی که روی عنصر جاری پیدا نشوند به نگاشت ذخیره‌سازی والد بازمی‌گردند

**نمونه — درخواست ورودی با آرایه‌ای از هشدارها (برای نمونه وب‌هوک‌های Grafana):**

اگر بدنه درخواست ورودی‌تان چنین باشد:

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

می‌توانید قالبی چنین بنویسید:

```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

که این را تولید می‌کند:

```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**نمونه — سنجه‌های دیسک سرور:**

```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**نمونه — به کار بردن `{{@index}}`:**

```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**نمونه — آرایه مقادیر ابتدایی با `{{this}}`:**

```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**نمونه — حلقه‌های تودرتو:**

می‌توانید برای آرایه‌های چندسطحی بلوک‌های `{{#each}}` را تودرتو کنید:

```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **یادداشت**: اگر مسیر به آرایه‌ای تفکیک نشود، کل بلوک `{{#each}}...{{/each}}` از خروجی حذف می‌شود. آرایه‌های خالی برای آن بلوک هیچ خروجی‌ای تولید نمی‌کنند.

## نمونه‌ها

### عنوان حادثه مانیتور وب‌سایت/API

```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### توضیحات حادثه مانیتور وب‌سایت/API

```
### API Error
Status: **{{responseStatusCode}}**
Latency: **{{responseTimeInMs}}ms**
Body Snippet: `{{responseBody.error.message}}`
```

### عنوان هشدار درخواست ورودی

```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### عنوان هشدار گواهی SSL

```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### توضیحات هشدار مانیتور سرور

```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**
Last Check: {{requestReceivedAt}}
```

### عنوان هشدار مانیتور Ping

```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### توضیحات هشدار مانیتور پورت

```
Port connectivity issue
Target port status: {{isOnline}}
Total connection time (DNS + TCP): {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### هشدار مانیتور مصنوعی

به اجرای مرورگر / اندازه صفحه مشخصی با نمایه دسترسی بگیرید:

```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

با `{{#each}}` روی هر ترکیب مرورگر / اندازه صفحه تکرار کنید:

```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

### هشدار مانیتور کد سفارشی

```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### عنوان هشدار مانیتور دستگاه شبکه

سه نمونه بعدی فرض می‌گیرند دستگاه اعتبارنامه SNMP دارد — هر چیزی جز `{{isOnline}}` از پیمایش می‌آید، پس روی دستگاهی فقط-ping خالی ترسیم می‌شوند.

```
SNMP walk failing: {{failureCause}} ({{responseTimeInMs}}ms)
```

### توضیحات هشدار مانیتور دستگاه شبکه

```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### درخواست ورودی با حلقه آرایه (وب‌هوک Grafana)

عنوان:

```
[{{requestBody.status}}] {{requestBody.receiver}}
```

توضیحات:

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

### مانیتور سرور با حلقه دیسک

توضیحات:

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

### مانیتور دستگاه شبکه با حلقه OID

توضیحات:

```
### SNMP Device Status
Online: {{isOnline}}
Response: {{responseTimeInMs}}ms

**OID Values:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
