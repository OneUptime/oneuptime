# یکپارچه‌سازی Datadog

هشدارهای مانیتورهای [Datadog](https://www.datadoghq.com) را به حوادث OneUptime تبدیل کنید تا تشخیص Datadog به پاسخ به حادثه و صفحات وضعیت OneUptime خوراک بدهد.

این یکپارچه‌سازی **ورودی** است: [یکپارچه‌سازی Webhooks در Datadog](https://docs.datadoghq.com/integrations/webhooks/) به یک **[گردش کاری](/docs/workflows/index)** در OneUptime که با یک **تریگر وب‌هوک** شروع می‌شود درخواست POST می‌فرستد.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## پیش‌نیازها

- یک حساب Datadog که در آن بتوانید یکپارچه‌سازی‌ها و مانیتورها را پیکربندی کنید.
- یک پروژه OneUptime که در آن بتوانید گردش کاری بسازید.

## گام ۱ — ساخت گردش کاری در OneUptime

1. **Workflows → Create Workflow** را باز کنید، نامش را `Datadog → Incidents` بگذارید و **Builder** را باز کنید.
2. یک تریگر **Webhook** اضافه کنید و **نشانی آن را کپی کنید**. نام بلوک را به `Datadog` تغییر دهید.
3. یک بلوک **Conditions** متصل به تریگر اضافه کنید:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. از شاخه **Yes** یک بلوک **Create Incident** اضافه کنید:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: یکی را انتخاب کنید.
5. **Save** بزنید (تا پیش از آزمایش، غیرفعال بماند).

## گام ۲ — ساخت وب‌هوک در Datadog

1. در Datadog به **Integrations → Webhooks** بروید (اگر یکپارچه‌سازی **Webhooks** را نصب نکرده‌اید، نصبش کنید).
2. **یک وب‌هوک اضافه کنید**:

   - **Name**: `oneuptime` (این به `@webhook-oneuptime` تبدیل می‌شود).
   - **URL**: نشانی وب‌هوک گردش کاری شما.
   - **Payload** — Datadog اجازه می‌دهد بدنه JSON را با [متغیرهای قالب](https://docs.datadoghq.com/integrations/webhooks/#usage) تعریف کنید:

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. وب‌هوک را ذخیره کنید.

## گام ۳ — فرستادن هشدارهای یک مانیتور به وب‌هوک

شناسه وب‌هوک را به مانیتورهایی که می‌خواهید ارجاع داده شوند اضافه کنید. در **پیام اعلان** هر مانیتور این را بگنجانید:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

این کار هم هشدار و هم بازیابی را به OneUptime می‌فرستد. (برای ارجاع همه‌چیز، می‌توانید `@webhook-oneuptime` را بدون شرط هم به یک مانیتور اضافه کنید.)

## گام ۴ — آزمایش

1. گردش کاری را فعال کنید.
2. از یک مانیتور، **Test Notifications → Alert** را بزنید، یا بگذارید یک مانیتور واقعی فعال شود.
3. زبانه **Logs** گردش کاری و فهرست **Incidents** خود را بررسی کنید.

## رفع هنگام بازیابی (اختیاری)

وقتی یک مانیتور به حالت عادی برمی‌گردد، `$ALERT_TRANSITION` برابر `Recovered` می‌شود. یک انشعاب **Conditions** دوم اضافه کنید (`transition == Recovered`)، حادثه متناظر را پیدا کنید (بر اساس `id` که فرستاده‌اید) و با **Update Incident** آن را به وضعیت برطرف‌شده ببرید.

## رفع اشکال

- **هیچ اجرایی ظاهر نمی‌شود** — مطمئن شوید پیام مانیتور شامل `@webhook-oneuptime` است و گردش کاری **Enabled** است.
- **فیلدها خالی‌اند** — Datadog فقط متغیرهای قالبی را جایگزین می‌کند که به آن رویداد مربوط باشند. خروجی تریگر را در زبانه **Logs** بررسی کنید و محموله وب‌هوک خود را تنظیم کنید.
- **حوادث تکراری** — مانیتوری که دوباره هشدار می‌دهد (renotify) چند رویداد `Triggered` می‌فرستد؛ پیش از ساخت، با یک بررسی **Find Incident** روی `id` تکراری‌ها را حذف کنید.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوی ورودی.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) و [Grafana](/docs/integrations/grafana) — سایر منابع ورودی.
- [تریگر وب‌هوک](/docs/workflows/triggers#webhook) — نحوه کار نشانی دریافت‌کننده.
