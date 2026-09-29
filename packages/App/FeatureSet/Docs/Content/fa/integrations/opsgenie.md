# یکپارچه‌سازی Opsgenie

هر بار که یک حادثه در OneUptime ساخته می‌شود یک هشدار در [Opsgenie](https://www.atlassian.com/software/opsgenie) بسازید، و وقتی OneUptime آن را برطرف کرد هشدار را ببندید.

این یکپارچه‌سازی **خروجی** است: OneUptime [Alert API مربوط به Opsgenie](https://docs.opsgenie.com/docs/alert-api) را فراخوانی می‌کند. از یک **[گردش کاری](/docs/workflows/index)** در OneUptime با تریگر **Incident → On Create** و یک **مؤلفه API** استفاده می‌کند.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## پیش‌نیازها

- یک **کلید API** از Opsgenie که از یک یکپارچه‌سازی API گرفته شده باشد: **Settings → Integrations → Add → API**. کلید را کپی کنید.
- منطقه خود را بدانید. میزبان پیش‌فرض API برابر `https://api.opsgenie.com` است؛ حساب‌های اروپا از `https://api.eu.opsgenie.com` استفاده می‌کنند.
- یک پروژه OneUptime که در آن بتوانید گردش کاری بسازید.

## گام ۱ — ذخیره کلید API

1. به **Workflows → Global Variables → Create** بروید.
2. نام آن را `OPSGENIE_KEY` بگذارید، کلید API را در آن بگذارید و **Is Secret** را روشن کنید.

## گام ۲ — ساخت گردش کاری «ساخت هشدار»

1. **Workflows → Create Workflow** را باز کنید، نامش را `Incidents → Opsgenie` بگذارید و **Builder** را باز کنید.
2. یک تریگر **Incident** با تنظیم **On Create** اضافه کنید. نامش را به `Incident` تغییر دهید.
3. یک بلوک **API** متصل به تریگر اضافه کنید:

   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts` _(برای اروپا از `api.eu.opsgenie.com` استفاده کنید)_
   - **Headers**:

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   مقدار **`alias`** این هشدار Opsgenie را به حادثه OneUptime گره می‌زند تا بعداً بتوانید آن را با همین نام مستعار ببندید. توجه کنید که شیوه احراز هویت Opsgenie، واژه تحت‌اللفظی `GenieKey` و سپس یک فاصله و کلید شماست.

4. **Save** بزنید، فعالش کنید و یک حادثه آزمایشی بسازید. پاسخ `202 Accepted` در گزارش‌های گردش کاری یعنی Opsgenie هشدار را در صف گذاشته است.

## گام ۳ — بستن هنگام رفع در OneUptime (توصیه‌شده)

1. یک گردش کاری **دوم** با نام `Close Opsgenie` و تریگر **Incident → On Update** بسازید.
2. یک بلوک **Conditions** اضافه کنید که بررسی کند حادثه اکنون برطرف شده است (روی `{{Incident.currentIncidentState.name}}` انشعاب بزنید).
3. از شاخه **Yes** یک بلوک **API** اضافه کنید:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: همان `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie هشدار را با نام مستعار پیدا می‌کند و می‌بندد.

## نگاشت اولویت (اختیاری)

اولویت‌های Opsgenie از `P1` تا `P5` است. با انشعاب‌های **Conditions** روی `{{Incident.incidentSeverity.name}}` پیش از بلوک API، از شدت‌های OneUptime به آن‌ها نگاشت کنید.

## رفع اشکال

- **`401`/`403`** — کلید نادرست، میزبان منطقه نادرست، یا یکپارچه‌سازی دسترسی ساخت هشدار ندارد. مطمئن شوید از کلید یکپارچه‌سازی **API** و میزبان متناظر `api`/`api.eu` استفاده می‌کنید.
- **بستن `404` برمی‌گرداند** — مقدار `alias` در فراخوان بستن باید دقیقاً با فراخوان ساخت یکی باشد و `identifierType=alias` باید در رشته کوئری باشد.
- **هیچ اتفاقی نمی‌افتد** — مطمئن شوید گردش کاری **Enabled** است.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوها و راهنمای سریع احراز هویت.
- [PagerDuty](/docs/integrations/pagerduty) — همین ایده برای PagerDuty.
- [آنکال](/docs/on-call/incoming-call-policy) — تشدید داخلی OneUptime.
