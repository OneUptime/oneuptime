# یکپارچه‌سازی Prometheus Alertmanager

اعلان‌های [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) را به حادثه‌های OneUptime تبدیل کنید. Prometheus قواعد هشدارتان را می‌سنجد، Alertmanager مسیردهی‌شان می‌کند، و OneUptime ثبت و تشدیدشان می‌کند.

این یکپارچه‌سازی **ورودی** است، و دو راه برای ساختنش هست:

| رویکرد | وقتی به کارش ببرید که |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[مانیتور درخواست ورودی](/docs/monitor/incoming-request-monitor)** (توصیه‌شده) | می‌خواهید هشدارها با تشدید کشیک به حادثه تبدیل شوند، به ازای هر هشدار یک حادثه، و برطرف شدن خودکار هنگام بهبود. بدون منطق سفارشی برای نگهداری. |
| **[گردش کاری](/docs/workflows/index) با تریگر وب‌هوک** | به منطق مسیردهی‌ای نیاز دارید که OneUptime به‌صورت بومی انجامش نمی‌دهد — فراخوانی سامانه‌های دیگر، بازشکل دادن محموله‌ها، شاخه‌زنی شرطی. |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## پیش‌نیازها

- راه‌اندازی Prometheus + Alertmanager که بتوانید `alertmanager.yml` را در آن ویرایش کنید.
- ‏Alertmanager باید بتواند روی HTTPS به نمونه OneUptime شما برسد.
- پروژه‌ای در OneUptime که بتوانید در آن مانیتور (یا گردش کاری) بسازید.

## گزینه ۱ — مانیتور درخواست ورودی

### گام ۱ — ساخت مانیتور

1. به **Monitors → Create Monitor** بروید و **Incoming Request** را برگزینید.
2. مانیتور را باز کنید و در منوی چپ روی **Documentation** کلیک کنید. نشانی را کپی کنید:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   اگر خودمیزبان هستید میزبان خودتان را به کار ببرید. کلید محرمانه در مسیر تنها اعتبارنامه است.

### گام ۲ — نشانه گرفتن Alertmanager به آن

در `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

تنظیم `send_resolved: true` الزامی است — همان چیزی است که به OneUptime می‌گوید هشداری بهبود یافته است. Alertmanager را با `curl -X POST http://localhost:9093/-/reload` بازبارگذاری کنید، یا بازراه‌اندازی‌اش کنید.

‏Alertmanager هدر `Content-Type: application/json` می‌فرستد، که OneUptime برای خواندن فیلدها از محموله لازمش دارد.

### گام ۳ — پیکربندی معیارها

بخش **Criteria** مانیتور را باز کنید و نخستین معیار را ویرایش کنید.

**پالایه**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  گیومه‌های دور جانگهدار برای مقایسه رشته‌ای الزامی‌اند. اگر ترجیح می‌دهید عبارت به کار نبرید، پالایه `Request Body` / `Contains` / `"status":"firing"` هم کار می‌کند.

**کنش‌ها**

- گزینه _When filters match, change monitor status_ را روشن کنید و روی **Offline** (یا Degraded) بگذارید.
- گزینه _When filters match, declare an incident_ را روشن کنید. **Title**، **Severity** و **On-Call Policies**ای را که باید فراخوانده شوند تنظیم کنید.
- زیر **Advanced Options** آن حادثه، **Auto Resolve Incident** را روشن کنید. بدون این، اعلان‌های بهبود نادیده گرفته می‌شوند و حادثه‌ها برای همیشه باز می‌مانند.

**Settings → گروه‌بندی حادثه‌ها و هشدارها بر پایه فیلدی از محموله**

این را روشن کنید تا یک نقطه پایانی بتواند چند حادثه هم‌زمان نگه دارد — به ازای هر هشدار یکی — به‌جای یک حادثه تنها به ازای هر اعلان.

| فیلد | مقدار |
| ---------------------------------- | ----------------------------------- |
| به ازای هر … حادثه‌ای جدا باز کن | `requestBody.alerts[*].fingerprint` |
| فیلدی که بهبود را نشان می‌دهد | `requestBody.alerts[*].status` |
| مقداری که یعنی بهبودیافته | `resolved` |
| بیشینه حادثه به ازای هر درخواست | `100` |

نماد `[*]` روی آرایه `alerts` در Alertmanager پخش می‌شود و به ازای هر مقدار استخراج‌شده **متمایز** یک حادثه باز می‌کند. چون هر دو مسیر `[*]` به کار می‌برند، بهبود به ازای هر هشدار داوری می‌شود: در محموله‌ای که یک هشدار برطرف شده و دو تا هنوز شلیک می‌کنند، فقط همان برطرف‌شده بسته می‌شود.

> **هشدار:** بر پایه چیزی گروه‌بندی کنید که واقعاً به ازای هر هشدار یکتاست. مقدار `fingerprint` در Alertmanager درهم‌سازی از مجموعه کامل برچسب‌های هشدار است، پس همیشه یکتاست. برچسبی فقط وقتی کار می‌کند که **درون** یک اعلان تغییر کند — و هیچ برچسبی که در `group_by` مسیرتان فهرست شده باشد هرگز چنین نیست، چون همان چیزی است که گروه تجمیع را تعریف می‌کند. با `group_by: ["alertname", "instance"]` بالا، گروه‌بندی بر پایه `requestBody.alerts[*].labels.alertname` همان مقدار را از هر هشدار محموله استخراج می‌کند، پس همه‌شان در یک حادثه تنها فرو می‌ریزند. بدتر آنکه مقادیر تکراری فقط **نخستین** رخدادشان را نگه می‌دارند، پس محموله‌ای که نخستین هشدارش `resolved` است آن حادثه را می‌بندد در حالی که باقی هنوز شلیک می‌کنند.

### گام ۴ — نوشتن عنوان و توضیحات حادثه

کلید گروه‌بندی به‌عنوان متغیری با نام آخرین بخش مسیر در دسترس است، پس `requestBody.alerts[*].fingerprint` به شما `{{fingerprint}}` می‌دهد. آن یک درهم‌سازی است، نه چیزی که به پاسخ‌دهنده نشان دهید — به‌جایش حادثه را از برچسب‌های مشترک در سراسر اعلان عنوان‌گذاری کنید. `commonLabels` هر برچسبی را که در `group_by` مسیرتان است حمل می‌کند، پس با پیکربندی بالا هم `alertname` و هم `instance` در دسترس‌اند:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

فیلدهای `commonLabels` و `commonAnnotations` آنچه را در سراسر اعلان مشترک است نگه می‌دارند. مسیری به ازای هر هشدار مانند `requestBody.alerts[0].annotations.summary` همیشه _نخستین_ هشدار محموله را می‌خواند، نه هشداری که این حادثه خاص برایش باز شده — پس اگر می‌خواهید هر حادثه متن حاشیه‌نویسی خودش را حمل کند `group_by` را تنگ نگه دارید. مسیری که تفکیک نشود عیناً با آکولادها و همه‌چیز چاپ می‌شود، نه اینکه خالی رها شود. برای فهرست کامل متغیرها [قالب‌بندی پویای حادثه و هشدار](/docs/monitor/incident-alert-templating) را ببینید.

### گام ۵ — بازگرداندن مانیتور به Operational (اختیاری)

معیارها فقط وقتی مطابقت کنند عمل می‌کنند، پس معیار دومی بیفزایید تا مانیتور پس از پاک شدن همه‌چیز آفلاین نماند:

- **Filter Type**: `JavaScript Expression`، **Value**: `"{{requestBody.status}}" === "resolved"`
- _تغییر وضعیت مانیتور به_ **Operational**، و اعلام نکردن هیچ حادثه‌ای.

### گام ۶ — آزمایشش کنید

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

باید دو حادثه بگیرید — به ازای هر `fingerprint` یکی. دوباره با `status` هر دو هشدار روی `resolved` بفرستید و هر دو باید بسته شوند.

می‌توانید با `amtool` هشداری واقعی هم شلیک کنید:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## گزینه ۲ — گردش کاری

وقتی به منطقی فراتر از «هشدار به حادثه تبدیل می‌شود» نیاز دارید از این استفاده کنید.

1. **Workflows → Create Workflow** را باز کنید، نامش را `Alertmanager → Incidents` بگذارید و **Builder** را باز کنید.
2. تریگر **Webhook** بیفزایید و **نشانی‌اش را کپی کنید**. نام بلوک را به `Alertmanager` تغییر دهید.
3. بلوک **Conditions** وصل‌شده به تریگر بیفزایید:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. از **Yes**، بلوک **Create Incident** بیفزایید:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: یکی برگزینید (یا نخست روی `{{Alertmanager.Request Body.commonLabels.severity}}` شاخه بزنید).
5. **Save** کنید، سپس نشانی `webhook_configs` در گام ۲ بالا را به‌جایش به نشانی گردش کاری نشانه بگیرید.

برای یک حادثه به ازای هر هشدار، بلوک [کد سفارشی](/docs/workflows/components#custom-code) بیفزایید که روی `Request Body.alerts` حلقه بزند. با `send_resolved: true`، شاخه **Conditions** دومی روی `status == resolved` بیفزایید که حادثه مطابق را می‌یابد و با **Update Incident** به وضعیت برطرف‌شده شما می‌بردش.

## کلید مرد مرده

هیچ‌کدام از این دو گزینه به شما نمی‌گویند کی خودِ Prometheus از کار افتاده — نرسیدن هیچ هشداری دقیقاً مانند این به نظر می‌رسد که هیچ‌چیز خراب نیست. پاسخ معمول، هشداری همیشه‌شلیک است که به مانیتوری مسیردهی شود که روی زمان‌بندی انتظارش را دارد. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) یکی به نام `Watchdog` دارد؛ روی Prometheus ساده، قاعده هشداری با عبارتی که همیشه درست است (`vector(1)`) بیفزایید.

مانیتور درخواست ورودی **دومی** بسازید، `Watchdog` را با `repeat_interval` کوتاهی به آن مسیردهی کنید، و به آن مانیتور معیاری با **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes** بدهید. این تنها موردی است که معیار درخواست‌نرسیده روی گیرنده هشدار جا دارد.

این پیکربندی گام ۲ است با مسیر و گیرنده دیده‌بان ادغام‌شده — زیرمسیر پیش از گیرنده خود والد تطبیق می‌شود، پس `Watchdog` به مانیتور دوم می‌رود و باقی همه‌چیز همچنان به اولی:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## رفع اشکال

- **چیزی نمی‌رسد** — تأیید کنید Alertmanager می‌تواند به نشانی برسد؛ گزارش‌هایش را برای خطاهای تحویل بررسی کنید. OneUptime به هر درخواستی پیش از اعتبارسنجی هر چیزی با `200` خالی پاسخ می‌دهد، پس `200` تأیید نمی‌کند که محموله پذیرفته شده است. به‌جایش خط زمانی مانیتور را بررسی کنید.
- **حادثه‌ها باز می‌شوند اما هرگز بسته نمی‌شوند** — مقدار `send_resolved: true` در Alertmanager، فیلد و مقدار بهبود روی معیارها (مقایسه به بزرگی و کوچکی حروف حساس است)، و **Auto Resolve Incident** زیر **Advanced Options** حادثه را بررسی کنید. دو علت ظریف‌تر: محموله‌ای که کلیدهای متمایز بیشتری از **بیشینه حادثه به ازای هر درخواست** حمل کند، آن‌هایی را که از سقف گذشته‌اند از بهبود هم پنهان می‌کند؛ و اگر اعلان `resolved` همان باشد که با یکپارچه‌سازی دریافت (پایین‌تر) انداخته می‌شود، حادثه برای همیشه سرگردان می‌ماند، چون Alertmanager اعلان‌های شلیک را تکرار می‌کند اما اعلان‌های برطرف‌شده را نه. آن‌ها را دستی ببندید.
- **اصلاً حادثه‌ای نیست، وضعیت مانیتور تغییر نکرده** — مسیر گروه‌بندی باید با `requestBody.` تحت‌اللفظی آغاز شود، و فقط نخستین `[*]` در مسیر جانشین است. هر دو اشتباه خاموش شکست می‌خورند.
- **متن حادثه جانگهدارهای خام `{{...}}` را نشان می‌دهد** — مسیر تفکیک نشد، و OneUptime جانگهدارهای تفکیک‌نشده را به‌جای خالی کردن سر جایشان می‌گذارد. قواعد مختلف حاشیه‌نویسی‌های مختلفی تنظیم می‌کنند، پس به فیلدهایی ارجاع دهید که واقعاً برای قواعد شما وجود دارند (`commonAnnotations` در برابر `annotations` به ازای هر هشدار).
- **فقط یک حادثه برای محموله‌ای پر از هشدار** — بر پایه برچسبی گروه‌بندی کرده‌اید که درون یک اعلان تغییر نمی‌کند، غالباً همان که در `group_by` مسیرتان هم هست. به‌جایش بر پایه `requestBody.alerts[*].fingerprint` گروه‌بندی کنید.
- **حادثه‌های بیش از حد** — `group_by` / `group_interval` را گشاد کنید تا Alertmanager هشدارهای مرتبط را دسته کند. پایین آوردن **بیشینه حادثه به ازای هر درخواست** سقفشان می‌گذارد، اما کلیدهای پس از سقف را از بهبود هم پنهان می‌کند.
- **برخی اعلان‌ها زیر جهش‌های سنگین رد‌شده به نظر می‌رسند** — درخواست‌های همان مانیتور در دریافت یکپارچه می‌شوند تا یک فرستنده نتواند مانیتوری را غرق کند، که وقتی اعلان‌ها پشت‌سرهم می‌رسند می‌تواند محموله‌ای میانی را بیندازد. بالا بردن `group_wait` و `group_interval` فاصله‌شان می‌دهد. یکپارچه‌سازی را متغیر محیطی `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` کانتینر برنامه کنترل می‌کند، که پیش‌فرضش روشن است؛ اپراتورهای خودمیزبانی که لازم دارند هر محموله سنجیده شود می‌توانند روی آن کانتینر `false` تنظیمش کنند.

## در ادامه چه بخوانیم

- [مانیتور درخواست ورودی](/docs/monitor/incoming-request-monitor) — این نوع مانیتور، معیارهایش و گروه‌بندی حادثه به‌طور کامل.
- [نمای کلی یکپارچه‌سازی‌ها](/docs/integrations/index) — الگوهای ورودی و خروجی.
- [Grafana](/docs/integrations/grafana) — همان ایده، با هشداردهی Grafana.
- [تریگر وب‌هوک](/docs/workflows/triggers#webhook) — نشانی گیرنده گردش کاری چگونه کار می‌کند.
