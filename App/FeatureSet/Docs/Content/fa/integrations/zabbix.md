# یکپارچه‌سازی Zabbix

[Zabbix](https://www.zabbix.com) سرورها و شبکه شما را می‌پاید؛ OneUptime پاسخ به حادثه، کشیک و صفحه‌های وضعیت شما را اجرا می‌کند. این دو را وصل کنید تا هر مشکل Zabbix به‌طور خودکار به یک حادثه OneUptime تبدیل شود — تا آدم‌های درست فراخوانده شوند و صفحه وضعیتتان صادق بماند.

این یکپارچه‌سازی **ورودی** است: Zabbix مشکل‌ها را به OneUptime می‌فرستد. در یک سو از یک **نوع رسانه وب‌هوک** در Zabbix و در سوی دیگر از یک **[گردش کاری](/docs/workflows/index)** OneUptime استفاده می‌کند. نه افزونه‌ای، نه سرویس اضافه‌ای.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## چگونه کار می‌کند

1. یک تریگر Zabbix به **PROBLEM** تغییر می‌کند.
2. یک **action** در Zabbix به نوع رسانه **OneUptime** می‌گوید رویداد را بفرستد.
3. اسکریپت نوع رسانه، محموله کوچکی از JSON را به نشانی یک گردش کاری OneUptime POST می‌کند.
4. گردش کاری محموله را می‌خواند و حادثه‌ای می‌سازد (و اختیاراً، وقتی Zabbix بهبود یافت برطرفش می‌کند).

## پیش‌نیازها

- کارسازی Zabbix که مدیرش هستید (این راهنما برای **Zabbix 6.0 LTS / 7.0 LTS** نوشته شده است؛ نوع رسانه وب‌هوک روی ۵٫۰ به بالا هم به همین شکل کار می‌کند).
- کارساز Zabbix شما باید بتواند روی HTTPS به نمونه OneUptime شما برسد.
- پروژه‌ای در OneUptime که بتوانید در آن گردش کاری بسازید.

## بخش ۱ — ساختن گردش کاری OneUptime

این را نخست انجام دهید، چون به نشانی وب‌هوکی که تولید می‌کند نیاز خواهید داشت.

1. **Workflows → Create Workflow** را باز کنید. نامش را `Zabbix → Incidents` بگذارید و زبانه **Builder** را باز کنید.
2. یک تریگر **Webhook** روی بوم بکشید. رویش کلیک کنید و **نشانی یکتایی** را که نشان می‌دهد **کپی کنید**. آن را امن نگه دارید — هر کسی که آن را داشته باشد می‌تواند گردش کاری را شروع کند. نام بلوک را به `Zabbix` تغییر دهید تا متغیرها خوش‌خوان شوند.
3. یک بلوک **Conditions** روی بوم بکشید و خروجی تریگر را به آن وصل کنید. پیکربندی کنید:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1` _(‏Zabbix برای مشکل `1` و برای بهبود `0` می‌فرستد)_
4. یک بلوک **Create Incident** بکشید و آن را به خروجی **Yes** بلوک Conditions وصل کنید. پر کنید:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: شدت حادثه OneUptime دلخواهتان را برگزینید (بعدها می‌توانید با شاخه‌های Conditions بیشتری که شدت‌های Zabbix را نگاشت می‌کنند ریزتنظیمش کنید).
5. ذخیره کنید. فعلاً **Enabled** را _خاموش_ بگذارید — پس از یک آزمایش روشنش می‌کنید.

> **نکته:** گذاشتن `event_id` در توضیحات (یا برچسبی روی حادثه) به شما امکان می‌دهد اگر خواستید هنگام بهبود خودکار برطرف کنید، بعداً همین حادثه را پیدا کنید. [برطرف کردن خودکار](#برطرف-کردن-خودکار-اختیاری) را ببینید.

## بخش ۲ — پیکربندی Zabbix

### گام ۱: ساخت نوع رسانه OneUptime

1. در Zabbix به **Alerts → Media types** بروید (در نسخه‌های قدیمی‌تر: **Administration → Media types**).
2. روی **Create media type** کلیک کنید و **Type** را روی **Webhook** بگذارید.
3. **Name**: `OneUptime`.
4. این **Parameters** را اضافه کنید (برای هرکدام روی _Add_ کلیک کنید). این‌ها [ماکروهای](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) Zabbix را به محموله‌ای تمیز نگاشت می‌کنند:

   | نام | مقدار |
   | ---------------- | ------------------ |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. این را در فیلد **Script** بچسبانید:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader("Content-Type: application/json");

   var payload = {
     source: "zabbix",
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time,
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw (
       "OneUptime responded with HTTP " + request.getStatus() + ": " + response
     );
   }

   return "OK";
   ```

6. روی زبانه **Message templates** کلیک کنید و قالبی برای **Problem** و **Problem recovery** اضافه کنید (بدنه می‌تواند خالی باشد — محموله در اسکریپت ساخته می‌شود). این برای اینکه Zabbix نوع رسانه را برای آن نوع رویدادها به کار ببرد الزامی است.
7. برای ذخیره نوع رسانه **Add** را بزنید.

### گام ۲: ساخت کاربری که وب‌هوک را حمل کند

Zabbix اعلان‌ها را _به یک کاربر_ می‌فرستد. یکی اختصاصی بسازید تا یکپارچه‌سازی به‌آسانی پیدا و غیرفعال شود.

1. به **Users → Users → Create user** بروید. نامش را `OneUptime Webhook` بگذارید، نقشی بدهید که بتواند اعلان بگیرد (برای نمونه **User role**) و به یک گروه کاربری اضافه‌اش کنید.
2. در زبانه **Media** روی **Add** کلیک کنید:
   - **Type**: `OneUptime`
   - **Send to**: **نشانی وب‌هوک گردش کاری** را که در بخش ۱ کپی کردید بچسبانید.
   - **When active** / شدت‌ها: پیش‌فرض‌ها را رها کنید (یا به شدت‌هایی که برایتان مهم است محدود کنید).
3. **Add** و سپس **Update** را بزنید.

### گام ۳: فرستادن مشکل‌ها به OneUptime با یک action

1. به **Alerts → Actions → Trigger actions → Create action** بروید.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (اختیاری): محدودش کنید — برای نمونه _Trigger severity >= Warning_. برای فرستادن همه‌چیز خالی بگذارید.
4. در زبانه **Operations**، عملیاتی اضافه کنید که از راه نوع رسانه **OneUptime** به **User: OneUptime Webhook** بفرستد.
5. برای برطرف کردن بعدی حادثه‌ها هنگام بهبود، **Recovery operations** را هم با همان کاربر/رسانه پر کنید.
6. برای ذخیره **Add** را بزنید و مطمئن شوید action در حالت **Enabled** است.

## بخش ۳ — آزمایشش کنید

1. به گردش کاری OneUptime برگردید و **Enabled** را روشن کنید.
2. در Zabbix، مشکلی آزمایشی راه بیندازید — برای نمونه، موقتاً آستانه یک تریگر را پایین بیاورید، یا از آیتمی آزمایشی استفاده کنید که به وضعیت مشکل می‌رود.
3. زبانه **Logs** گردش کاری‌تان را باز کنید. باید اجرایی با محموله Zabbix ببینید، بلوک Conditions که مسیر **Yes** را می‌گیرد، و ساخته شدن حادثه.
4. در OneUptime **Incidents** را بررسی کنید — مشکل Zabbix شما حالا یک حادثه است.

اگر چیزی نرسید، [رفع اشکال](#رفع-اشکال) را ببینید.

## برطرف کردن خودکار (اختیاری)

گردش کاری اصلی بالا حادثه‌ها را _باز می‌کند_. برای اینکه وقتی Zabbix بهبود یافت _ببندد_شان هم:

1. مطمئن شوید action شما در Zabbix دارای **Recovery operations** پیکربندی‌شده است (گام ۳ بالا) تا رویدادهای بهبود هم فرستاده شوند. هنگام بهبود، `status` با مقدار `0` می‌رسد.
2. در گردش کاری، شاخه **Conditions** دومی اضافه کنید: سمت چپ `{{Zabbix.Request Body.status}}`، عملگر `==`، سمت راست `0`.
3. از خروجی **Yes** آن، بلوک **Find Incident** اضافه کنید که حادثه بازی را که پیش‌تر ساختید جستجو کند — بر پایه `event_id` در Zabbix که در توضیحات یا برچسبی ذخیره کرده‌اید تطبیق دهید.
4. آن را به یک بلوک **Update Incident** وصل کنید و حادثه را به وضعیت _برطرف‌شده_ خود ببرید.

چون برطرف کردن به آن بستگی دارد که وضعیت‌های حادثه را در پروژه‌تان چگونه مدل کرده‌اید، مسیر **ساخت** را هسته قابل اتکا نگه دارید و مسیر برطرف کردن را وقتی لایه‌بندی کنید که تأیید کرده‌اید رویدادها درست جریان دارند. [مؤلفه‌ها → مؤلفه‌های داده OneUptime](/docs/workflows/components#oneuptime-data-components) را ببینید.

## نگاشت شدت‌های Zabbix (اختیاری)

شدت‌های Zabbix (`Not classified`، `Information`، `Warning`، `Average`، `High`، `Disaster`) به‌صورت `{{Zabbix.Request Body.severity}}` می‌رسند. برای نگاشتشان به شدت‌های حادثه OneUptime، پیش از **Create Incident** شاخه‌های **Conditions** اضافه کنید — برای نمونه، `Disaster` و `High` را به حادثه‌ای «بحرانی» و باقی را به «عمده» مسیردهی کنید. به ازای هر شاخه یک بلوک **Create Incident** بسازید.

## رفع اشکال

**گردش کاری هرگز اجرا نمی‌شود.**

- تأیید کنید کلید **Enabled** گردش کاری روشن است.
- از کارساز Zabbix تأیید کنید که می‌تواند به نشانی برسد: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. باید تصدیقی سریع بگیرید.
- در Zabbix **Reports → Action log** را برای خطاهای تحویل بررسی کنید.

**‏Zabbix خطای اسکریپت گزارش می‌دهد.**

- نوع رسانه را باز کنید و با **Test** محموله‌ای نمونه بفرستید. Zabbix خروجی اسکریپت یا خطای پرتاب‌شده را نشان می‌دهد.
- پاسخ غیر ۲xx از OneUptime را `throw` درون اسکریپت نمایان می‌کند — بررسی کنید نشانی گردش کاری دقیقاً درست باشد.

**حادثه ساخته می‌شود اما فیلدها خالی‌اند.**

- زبانه **Logs** گردش کاری را باز کنید و خروجی تریگر را بازرسی کنید. تأیید کنید نام فیلدها زیر **Request Body** با آنچه ارجاع می‌دهید بخواند (`name`، `host`، `severity`، `status`، `event_id`).
- فیلدی که نباشد به‌جای خطا به رشته خالی تفکیک می‌شود — [متغیرها → نکته‌های ریز](/docs/workflows/variables#gotchas) را ببینید.

**همه‌چیز دو بار شلیک می‌شود.**

- احتمالاً هم عملیات مشکل و هم گام تشدید به همان رسانه می‌فرستند. گام‌های **Operations** در action را بررسی کنید.

## یادداشت‌های امنیتی

- نشانی وب‌هوک گردش کاری را مانند یک گذرواژه بدانید. اگر درز کرد، تریگر را حذف کنید و برای چرخاندن نشانی، تریگر تازه‌ای بسازید.
- شرط‌های action در Zabbix را محدود کنید تا فقط شدت‌هایی را بفرستید که سزاوار یک حادثه‌اند.
- اگر OneUptime را خودمیزبان پشت دیوار آتش اجرا می‌کنید، اجازه دهید IP خروجی کارساز Zabbix شما روی HTTPS به آن برسد.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوهای ورودی/خروجی.
- [تریگر وب‌هوک](/docs/workflows/triggers#webhook) — نشانی گیرنده چگونه کار می‌کند.
- [مؤلفه‌ها](/docs/workflows/components) — Conditions، Create Incident و بیشتر.
- [متغیرها](/docs/workflows/variables) — خواندن محموله Zabbix در بلوک‌های بعدی.
