# یکپارچه‌سازی PagerDuty

هر بار که یک حادثه در OneUptime ساخته می‌شود یک incident در [PagerDuty](https://www.pagerduty.com) فعال کنید، و وقتی OneUptime آن را برطرف کرد رفعش کنید. وقتی PagerDuty مالک تشدید و زمان‌بندی‌های آنکال شماست و می‌خواهید پایش OneUptime به آن خوراک بدهد مفید است.

این یکپارچه‌سازی **خروجی** است: OneUptime [Events API v2 مربوط به PagerDuty](https://developer.pagerduty.com/docs/events-api-v2/overview/) را فراخوانی می‌کند. از یک **[گردش کاری](/docs/workflows/index)** در OneUptime با تریگر **Incident → On Create** و یک **مؤلفه API** استفاده می‌کند.

> OneUptime آنکال و تشدید داخلی خودش را دارد — [آنکال](/docs/on-call/incoming-call-policy) را ببینید. از این یکپارچه‌سازی فقط وقتی استفاده کنید که به‌طور مشخص می‌خواهید رویدادها در PagerDuty هم ثبت شوند.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## پیش‌نیازها

- یک سرویس PagerDuty با یکپارچه‌سازی **Events API v2**. در PagerDuty: **Service → Integrations → Add integration → Events API v2**. مقدار **Integration Key** (که _routing key_ هم نامیده می‌شود) را کپی کنید.
- یک پروژه OneUptime که در آن بتوانید گردش کاری بسازید.

## گام ۱ — ذخیره routing key

1. به **Workflows → Global Variables → Create** بروید.
2. نام آن را `PAGERDUTY_ROUTING_KEY` بگذارید، کلید یکپارچه‌سازی را در آن بگذارید و **Is Secret** را روشن کنید.

## گام ۲ — ساخت گردش کاری «فعال‌سازی»

1. **Workflows → Create Workflow** را باز کنید، نامش را `Incidents → PagerDuty` بگذارید و **Builder** را باز کنید.
2. یک تریگر **Incident** با تنظیم **On Create** اضافه کنید. نامش را به `Incident` تغییر دهید.
3. یک بلوک **API** متصل به تریگر اضافه کنید:

   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   مقدار **`dedup_key`** این incident در PagerDuty را به حادثه OneUptime گره می‌زند تا بعداً بتوانید آن را رفع کنید. استفاده از شناسه حادثه OneUptime آن را یکتا و قابل پیش‌بینی نگه می‌دارد.

4. **Save** بزنید، فعالش کنید و یک حادثه آزمایشی بسازید. پاسخ `202` در گزارش‌های گردش کاری یعنی PagerDuty رویداد را پذیرفته است.

## گام ۳ — رفع هنگام رفع در OneUptime (توصیه‌شده)

1. یک تریگر **Incident** دوم در **همان** گردش کاری اضافه کنیم؟ نه — هر گردش کاری یک تریگر دارد. به‌جای آن یک گردش کاری **دوم** با نام `Resolve PagerDuty` و تریگر **Incident → On Update** بسازید.
2. یک بلوک **Conditions** اضافه کنید تا بررسی کند حادثه اکنون برطرف شده است (روی وضعیت حادثه / `{{Incident.currentIncidentState.name}}` انشعاب بزنید و آن را با نام وضعیت برطرف‌شده خود بسنجید).
3. از شاخه **Yes** یک بلوک **API** به PagerDuty اضافه کنید با **همان `dedup_key`** و `event_action` برابر `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty با `dedup_key` تطبیق می‌دهد و incident اصلی را می‌بندد.

## نگاشت شدت (اختیاری)

مقدار `severity` در PagerDuty یکی از `critical`، `error`، `warning` یا `info` را می‌پذیرد. برای نگاشت از شدت‌های OneUptime، پیش از بلوک API انشعاب‌های **Conditions** روی `{{Incident.incidentSeverity.name}}` اضافه کنید و از هر شاخه بدنه متفاوتی بفرستید.

## ورودی (اختیاری)

برای مسیر معکوس — باز کردن یک حادثه OneUptime از روی یک رویداد PagerDuty — یک گردش کاری با تریگر **Webhook** اضافه کنید و یک [وب‌هوک نسخه ۳ در PagerDuty](https://developer.pagerduty.com/docs/webhooks/v3-overview/) (یا یک Events Orchestration) را به نشانی آن بدهید، سپس از **Create Incident** استفاده کنید. [الگوی ورودی](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime) را ببینید.

## رفع اشکال

- **`400` با پیام `"invalid routing key"`** — یکپارچه‌سازی باید **Events API v2** باشد، نه Events API v1 قدیمی یا نوع دیگری از یکپارچه‌سازی. کلید را دوباره کپی کنید.
- **رفع چیزی را نمی‌بندد** — مقدار `dedup_key` در فراخوان رفع باید دقیقاً با فراخوان فعال‌سازی یکی باشد.
- **چیزی در گزارش‌ها نیست** — مطمئن شوید گردش کاری **Enabled** است و تریگر روی **On Create** تنظیم شده است.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوها و راهنمای سریع احراز هویت.
- [آنکال](/docs/on-call/incoming-call-policy) — تشدید داخلی OneUptime.
- [Opsgenie](/docs/integrations/opsgenie) — همین ایده برای Opsgenie.
