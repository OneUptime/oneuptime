# یکپارچه‌سازی ServiceNow

هر بار که یک حادثه در OneUptime ساخته می‌شود، به‌صورت خودکار یک incident در [ServiceNow](https://www.servicenow.com) باز کنید — تا ITSM و پایش هم‌گام بمانند.

این یکپارچه‌سازی **خروجی** است: OneUptime [Table API مربوط به ServiceNow](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) را فراخوانی می‌کند. از یک **[گردش کاری](/docs/workflows/index)** در OneUptime با تریگر **Incident → On Create** و یک **مؤلفه API** استفاده می‌کند.

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## پیش‌نیازها

- یک نمونه ServiceNow (`https://your-instance.service-now.com`).
- یک کاربر ServiceNow با نقش‌های `rest_api_explorer` / `itil` (یا دسترسی کافی برای ساخت رکورد `incident`). احراز هویت Basic با اعتبارنامه‌های همین کاربر ساده‌ترین شروع است؛ برای محیط عملیاتی OAuth توصیه می‌شود.
- یک پروژه OneUptime که در آن بتوانید گردش کاری بسازید.

## گام ۱ — ذخیره اعتبارنامه‌ها به‌عنوان راز

Table API در ServiceNow احراز هویت **Basic** را می‌پذیرد.

1. یک بار `username:password` را با base64 رمزگذاری کنید:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. در OneUptime به **Workflows → Global Variables → Create** بروید، نام آن را `SERVICENOW_AUTH` بگذارید، رشته base64 را در آن بگذارید و **Is Secret** را روشن کنید.

## گام ۲ — ساخت گردش کاری

1. **Workflows → Create Workflow** را باز کنید، نامش را `Incidents → ServiceNow` بگذارید و **Builder** را باز کنید.
2. یک تریگر **Incident** با تنظیم **On Create** اضافه کنید. نامش را به `Incident` تغییر دهید.
3. یک بلوک **API** متصل به تریگر اضافه کنید:

   - **Method**: `POST`
   - **URL**: `https://your-instance.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   مقدار `correlation_id` پیوندی به حادثه OneUptime نگه می‌دارد — اگر بعداً یک گام رفع اضافه کنید مفید است. مقادیر `urgency`/`impact` در ServiceNow برابر `1` (بالا)، `2` (متوسط) و `3` (پایین) هستند.

4. **Save** بزنید، فعالش کنید و یک حادثه آزمایشی بسازید. پاسخ `201 Created` در گزارش‌های گردش کاری، `sys_id` و `number` رکورد جدید را برمی‌گرداند (برای نمونه `INC0012345`).

## گام ۳ — رفع هنگام رفع در OneUptime (اختیاری)

1. یک گردش کاری **دوم** با تریگر **Incident → On Update** و یک بلوک **Conditions** بسازید که بررسی کند حادثه برطرف شده است.
2. برای به‌روزرسانی رکورد درست در ServiceNow به `sys_id` آن نیاز دارید. یا آن را در گام ۲ روی حادثه OneUptime ذخیره کنید (مقدار `{{CreateRecord.response-body.result.sys_id}}` را بخوانید و با **Update Incident** در یک برچسب بنویسید)، یا ابتدا رکورد را با یک `GET` روی `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}` پیدا کنید.
3. یک بلوک **API** اضافه کنید: **Method** برابر `PATCH`، **URL** برابر `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`، و بدنه `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (مقدار `state` برابر `6` در گردش کاری پیش‌فرض ITIL یعنی Resolved).

## رفع اشکال

- **`401`** — مقدار `username:password` را با `printf` دوباره رمزگذاری کنید (نه با `echo` که یک خط جدید اضافه می‌کند) و `SERVICENOW_AUTH` را به‌روز کنید.
- **`403`** — کاربر دسترسی نوشتن در جدول `incident` را ندارد؛ نقش `itil` را اضافه کنید.
- **`400`** — نام یا مقدار فیلدی برای سفارشی‌سازی‌های نمونه شما نادرست است. نام فیلدها را در **System Definition → Tables → incident** بررسی کنید.
- **نمونه فراخوان را رد می‌کند** — برخی نمونه‌ها Table API را محدود می‌کنند؛ مطمئن شوید REST فعال است و IP شما با یک ACL مسدود نشده است.

## در ادامه چه بخوانیم

- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوها و راهنمای سریع احراز هویت.
- [Jira](/docs/integrations/jira) — همین الگوی خروجی برای Jira.
- [مؤلفه API](/docs/workflows/components#api) — خواندن بدنه پاسخ.
