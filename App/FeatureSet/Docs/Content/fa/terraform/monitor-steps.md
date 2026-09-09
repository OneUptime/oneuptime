# گام‌های مانیتور

مقدار `monitor_steps` صفتی است که به مانیتوری فعال می‌گوید *چه چیزی را بررسی کند* و *چگونه درباره نتیجه تصمیم بگیرد* — مقصد، درخواست، و معیارهایی که پاسخ‌ها را به وضعیت‌های مانیتور، حادثه‌ها و هشدارها نگاشت می‌کنند. قدرتمندترین صفت ارائه‌دهنده است. این صفحه ساختارش را به‌طور کامل توضیح می‌دهد.

## صفت‌های تودرتوی نوع‌دار، نه JSON

مقدار `monitor_steps` یک **صفت تودرتوی نوع‌دار** است: فهرستی از شیءهای گام که مستقیم در HCL نوشته می‌شوند. نه `jsonencode()`ای هست، نه پاکت‌های `{_type, value}`، نه کلیدهای camelCase، و نه شناسه‌های دست‌نویس — ارائه‌دهنده HCL شما را به قالب سیمی API ترجمه می‌کند و کارساز همه شناسه‌های درونی را تولید می‌کند.

```hcl
resource "oneuptime_monitor" "example" {
  name         = "Example"
  description  = "Minimal shape of monitor_steps"
  monitor_type = "Website"

  monitor_steps = [{
    monitor_destination      = "https://example.com"
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name             = "Check if online"
        description      = "Website responds successfully"
        filter_condition = "All"

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          }
        ]
      }
    ]
  }]
}
```

> **از ارائه‌دهنده ۱.x مهاجرت می‌کنید؟** پیش‌تر `monitor_steps` رشته‌ای JSON بود که با `jsonencode({ _type = "MonitorSteps", value = { ... } })` نوشته می‌شد. آن را با بلوک‌های تودرتوی این صفحه جایگزین کنید: پاکت‌ها را بیندازید، کلیدهای camelCase را به snake_case تبدیل کنید (`monitorDestination` → `monitor_destination` + `monitor_destination_type`، `filterCondition` → `filter_condition`، `checkOn` → `check_on`)، و **هر فیلد `id` را حذف کنید** — شناسه‌های تولیدشده کارساز به‌کل از پیکربندی رفته‌اند (این سردرگمی کهنه «شناسه‌های تصادفی کدشده» از مسئله [#2291](https://github.com/OneUptime/oneuptime/issues/2291) را هم برمی‌دارد). وضعیت رشته‌ JSON کهنه خودکار ارتقا نمی‌یابد؛ با نحو تازه دوباره apply کنید.

دو قرارداد همه‌جا در `monitor_steps` صدق می‌کنند:

- **آنچه به کار نمی‌برید را حذف کنید.** صفت‌های اختیاری تنظیم‌نشده صرفاً به API فرستاده نمی‌شوند. هرگز `[]`، `{}` یا `""` را به‌عنوان جانگهدار ندهید — ارائه‌دهنده رشته‌ها، فهرست‌ها و نگاشت‌های خالی را رد می‌کند تا «غایب» همیشه معنای «تنظیم‌نشده» بدهد.
- **مقادیر پالایه رشته‌اند.** مقادیر مقایسه همیشه رشته‌اند، حتی برای عددها: `value = "200"`، نه `value = 200`. (‏`port` استثناست — عددی واقعی است.)

## نمونه کامل حاشیه‌نویسی‌شده

این پیکربندی‌ای کارآمد از مجموعه E2E ارائه‌دهنده است (آزمون `35-monitor-with-steps`) — مانیتور وب‌سایت متعارف «آنلاین / آفلاین»:

```hcl
resource "oneuptime_monitor_status" "operational" {
  name                 = "Operational"
  description          = "Monitor is operational"
  color                = "#2ecc71"
  priority             = 1
  is_operational_state = true
}

resource "oneuptime_monitor_status" "offline" {
  name                 = "Offline"
  description          = "Monitor is offline"
  color                = "#e74c3c"
  priority             = 3
  is_operational_state = false
}

resource "oneuptime_monitor" "website" {
  name         = "Website"
  description  = "Website monitor with explicit steps"
  monitor_type = "Website"

  monitor_steps = [{
    monitor_destination      = "https://example.com" # what to hit
    monitor_destination_type = "URL"                 # URL | Hostname | IP
    request_type             = "GET"                 # HTTP method for Website/API monitors

    criteria = [ # evaluated in order; first match wins, so alerting first and healthy last
      {
        name                  = "Offline"
        description           = "Check if website is offline"
        filter_condition      = "Any"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.offline.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "False"
          }
        ]
      },
      {
        name                  = "Online"
        description           = "Check if website is online"
        filter_condition      = "All" # All = AND the filters, Any = OR them
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          },
          {
            check_on    = "Response Status Code"
            filter_type = "Equal To"
            value       = "200" # comparison values are strings
          }
        ]
      }
    ]
  }]
}
```

ارجاع به منابع دیگر Terraform — مانند `oneuptime_monitor_status.operational.id` بالا — حالا HCL ساده است. این راه پیشنهادی سیم‌کشی معیارها به وضعیت‌هاست.

## صفت‌های گام

هر عنصر `monitor_steps` یک هدف پروب است:

| صفت | نوع | به کار رفته توسط | یادداشت |
|-----------|------|---------|-------|
| `monitor_destination` | رشته | Website، API، Ping، Port، IP، SSL Certificate | نشانی، نام میزبان یا IPای که پروب شود. به `monitor_destination_type` نیاز دارد. |
| `monitor_destination_type` | رشته | همان | `URL`، `Hostname` یا `IP` — باید با نوع مانیتور بخواند (نشانی برای Website/API/SSL Certificate؛ نام میزبان یا IP برای Ping/Port/IP). |
| `port` | عدد | Port | درگاه TCPای که پروب شود، مثلاً `443`. |
| `request_type` | رشته | Website، API | روش HTTP: `GET`، `POST`، `PUT`، `DELETE`، `HEAD`، `PATCH`. پیش‌فرض کارساز `GET` است. |
| `request_headers` | map(string) | API | نگاشت رشته ساده: `{ "Accept" = "application/json" }`. |
| `request_body` | رشته | API | رشته بدنه خام درخواست. |
| `do_not_follow_redirects` | bool | Website، API | به‌جای دنبال کردن تغییرمسیرها در نخستین پاسخ بایستد. |
| `allow_self_signed_certificates` | bool | Website، API | گواهی‌های TLS خودامضا را بپذیرد. |
| `tls_client_certificate` | رشته | Website، API | گواهی کارخواه mTLS (‏PEM یا ارجاع `{{monitorSecrets.name}}`). |
| `tls_client_key` | رشته (حساس) | Website، API | کلید خصوصی کارخواه mTLS. همراه گواهی الزامی است. |
| `tls_client_key_passphrase` | رشته (حساس) | Website، API | عبارت عبور کلید کارخواه. |
| `request_timeout_in_ms` | عدد | پروب‌محور | مهلت هر گام؛ سمت کارساز به ۶۰۰۰۰ میلی‌ثانیه محدود می‌شود. |
| `retry_count` | عدد | پروب‌محور | تلاش دوباره وقتی بررسی‌ای شکست بخورد؛ سمت کارساز به ۳ محدود می‌شود. |
| `custom_code` | رشته | Custom JavaScript Code، Synthetic | اسکریپتی که این گام اجرا می‌کند. |
| `screen_size_types` | list(string) | Synthetic | `Mobile`، `Tablet`، `Desktop`. |
| `browser_types` | list(string) | Synthetic | `Chromium`، `Firefox`. |
| `retry_count_on_error` | عدد | Synthetic | تلاش دوباره هنگام خطای اسکریپت. |
| `criteria` | فهرست (الزامی) | همه | درخت تصمیم — پایین را ببینید. |

نوع‌های مانیتور تله‌متری و زیرساخت پیکربندی پرس‌وجویشان را در صفت‌های **دریچه فرار** به ازای هر نوع حمل می‌کنند — رشته‌هایی اختیاری که JSON خام زیرپیکربندی را نگه می‌دارند و با `jsonencode()` نوشته می‌شوند: `log_monitor`، `trace_monitor`، `metric_monitor`، `exception_monitor`، `profile_monitor`، `dns_monitor`، `domain_monitor`، `dnssec_monitor`، `sql_monitor`، `database_monitor`، `external_status_page_monitor`، `network_device_monitor`، `kubernetes_monitor`، `docker_monitor`، `docker_swarm_monitor`، `host_monitor`، `podman_monitor`، `proxmox_monitor`، `vmware_monitor`، `ceph_monitor`، `iot_monitor`. نمونه‌ای برای مانیتور Logs:

```hcl
monitor_steps = [{
  log_monitor = jsonencode({
    attributes          = {}
    body                = "error"
    severityTexts       = ["Error"]
    telemetryServiceIds = [oneuptime_telemetry_service.app.id]
    lastXSecondsOfLogs  = 300
  })

  criteria = [
    {
      name             = "Errors found"
      filter_condition = "Any"
      filters = [
        {
          check_on    = "Log Count"
          filter_type = "Greater Than"
          value       = "0"
        }
      ]
    }
  ]
}]
```

این دریچه‌های فرار آینه JSON داشبورد برای هر نوع مانیتورند — دریچه فرارند، نه پیش‌فرض. هر چیزی مربوط به پروب کاملاً نوع‌دار است.

## صفت‌های معیار

هر مدخل `criteria` یک قاعده است: *اگر این پالایه‌ها بخوانند، این کارها را بکن.*

**ترتیب مهم است، و ترتیب یعنی نخست هشداردهنده.** معیارها از بالا به پایین سنجیده می‌شوند و نخستین معیاری که بخواند برنده است — سنجش همان‌جا می‌ایستد، و در آن بررسی به هر معیاری زیرش هرگز نگاه نمی‌شود. پس معیارهای هشداردهنده‌تان را نخست فهرست کنید، شدیدترین اول (بحرانی، سپس اخطار)، و معیارهای «سالم» / بازیابی را **آخر** بگذارید.

نخست گذاشتن معیار «سالم» رایج‌ترین راه ساختن مانیتوری است که هرگز هشدار نمی‌دهد. قاعده سالم فراخی — `Is Online` برابر `True`، یا مقدار سنجه‌ای `Greater Than` `0` — تقریباً در هر بررسی می‌خواند، سنجش را تصاحب می‌کند، و معیار «قطعی» زیرش هرگز اجرا نمی‌شود. با ترتیب برعکس، معیار قطعی نخست شانسش را می‌گیرد و معیار سالم فقط وقتی می‌خواند که چیزی بالایش نخوانده باشد، که دقیقاً همان چیزی است که می‌خواهید.

**مانیتورهای سنجه گروه‌شده تنها استثنای «نخستین تطبیق برنده» هستند.** وقتی پرس‌وجوی مانیتور سنجه گروه شده باشد — با `groupByAttributeKeys` تنظیم‌شده درون JSON دریچه فرار، در `metricViewConfig.queryConfigs[].metricQueryData.groupByAttributeKeys` — مانیتور *به ازای هر گروه* یک هشدار/حادثه بلند می‌کند (به ازای هر میزبان، هر ظرف، هر نقطه اتصال) و هر معیاری سنجیده می‌شود، پس معیاری «بحرانی» و معیاری «اخطار» می‌توانند در همان بررسی روی میزبان‌های متفاوت شلیک کنند. میزبانی که هر دو را نقض کند هنوز یک بار فرا می‌خواند، از نخستین معیار مطابق، پس هنوز شدیدترین‌اول صدق می‌کند. [مانیتور سنجه‌ها](/docs/monitor/metrics-monitor) را ببینید.

| صفت | نوع | معنا |
|-----------|------|---------|
| `name` | رشته (الزامی) | در داشبورد نشان داده می‌شود. |
| `description` | رشته | در داشبورد نشان داده می‌شود. |
| `filter_condition` | رشته (الزامی) | `All` (هر پالایه‌ای باید بخواند) یا `Any` (دست‌کم یکی). |
| `filters` | فهرست (الزامی) | شرط‌ها — دست‌کم یکی. |
| `change_monitor_status` | bool | آیا تطبیق وضعیت مانیتور را تغییر می‌دهد. |
| `monitor_status_id` | رشته | شناسه `oneuptime_monitor_status`ای که به آن جابه‌جا شود. وقتی `change_monitor_status` برابر `true` باشد الزامی است. |
| `create_incidents` | bool | آیا تطبیق حادثه‌ای باز می‌کند. |
| `incidents` | فهرست | قالب‌های حادثه — مگر `create_incidents = true` باشد حذفش کنید. |
| `create_alerts` | bool | آیا تطبیق هشداری باز می‌کند. |
| `alerts` | فهرست | قالب‌های هشدار — مگر `create_alerts = true` باشد حذفش کنید. |
| `is_enabled` | bool | سمت کارساز پیش‌فرض `true` است؛ برای نگه داشتن معیاری بدون سنجیدنش `false` بگذارید. |
| `incident_grouping` | رشته (JSON) | فقط مانیتورهای Incoming Request: به ازای هر مقدار استخراج‌شده از بار، حادثه‌ای پخش کنید (`jsonencode({ groupByJSONPath = "..." })`). |

قالب‌های حادثه (`incidents`) از این‌ها پشتیبانی می‌کنند: `title` (الزامی)، `description` (الزامی)، `incident_severity_id`، `auto_resolve_incident`، `remediation_notes`، `on_call_policy_ids`، `label_ids`، `owner_team_ids`، `owner_user_ids`، `show_incident_on_status_page`، `is_private`. قالب‌های هشدار (`alerts`) از همان شکل با `alert_severity_id` و `auto_resolve_alert` پشتیبانی می‌کنند:

```hcl
criteria = [
  {
    name                  = "Offline"
    description           = "Site is unreachable"
    filter_condition      = "Any"
    change_monitor_status = true
    monitor_status_id     = oneuptime_monitor_status.offline.id
    create_incidents      = true

    filters = [
      {
        check_on    = "Is Online"
        filter_type = "False"
      }
    ]

    incidents = [
      {
        title                 = "Website is down"
        description           = "The website did not respond to the probe."
        incident_severity_id  = oneuptime_incident_severity.critical.id
        auto_resolve_incident = true
      }
    ]
  }
]
```

## مرجع پالایه

پالایه‌ای `check_on` (چه چیزی بازرسی شود)، `filter_type` (مقایسه) و `value` (عملوند — رشته‌ای؛ برای مقایسه‌های بولی مانند `True` / `False` حذفش کنید) دارد. پالایه‌هایی که روی پنجره‌ای زمانی می‌سنجند علاوه بر آن `evaluate_over_time = true`، `evaluate_over_time_minutes` و `evaluate_over_time_type` (`Average`، `Sum`، `Maximum Value`، `Minimum Value`، `All Values`، `Any Value`) می‌گیرند.

مقدار `All Values` یعنی «هر بررسی‌ای در پنجره نقض کرد»، پس فقط وقتی می‌خواند که پنجره واقعاً با داده پوشیده شده باشد — مانیتوری که تازه ساخته شده به‌جای تطبیق در نخستین بررسی‌اش منتظر پر شدن پنجره می‌ماند. پنجره‌ای دست‌کم دو برابر `monitoring_interval` مانیتور بدهیدش، وگرنه پنجره فقط می‌تواند یک نمونه نگه دارد و «همه مقادیر» همان معنای «هر مقداری» را می‌دهد. مقدار `Any Value` عمداً روی یک بررسی نقض‌کننده می‌خواند.

مقدار `evaluate_over_time_no_data_policy` تصمیم می‌گیرد پالایه تا وقتی پنجره نمی‌تواند پشتیبانی‌اش کند چه کند: `Ignore` (پیش‌فرض) نمی‌خواند، `Trigger` داده غایب را همان شکست می‌گیرد (معناشناسی ضربان قلب)، و `Treat As Zero` پنجره را به‌عنوان صفری واحد مقایسه می‌کند.

مقادیر رایج `check_on` به تفکیک نوع مانیتور:

| نوع مانیتور | مقادیر معمول `check_on` |
|--------------|---------------------------|
| هر مانیتور فعالی | `Is Online`، `Response Time (in ms)` |
| Website / API | `Response Status Code`، `Response Body`، `Response Header`، `JavaScript Expression`، `Is Request Timeout` |
| SSL Certificate | `Is Valid Certificate`، `Is Self Signed Certificate`، `Is Expired Certificate`، `Expires In Days`، `Expires In Hours` |
| Ping / IP / Port | `Is Online`، `Response Time (in ms)`، `Packet Loss (in %)`، `Jitter (in ms)` |
| Incoming Request | `Incoming Request`، `Request Body`، `Request Header` |
| Server | `CPU Usage (in %)`، `Memory Usage (in %)`، `Disk Usage (in %)` (به `disk_path` نیاز دارد)، `Server Process Name` |
| Logs / Traces / Exceptions / Metrics | `Log Count`، `Span Count`، `Exception Count`، `Metric Value` (پالایه‌های سنجه می‌توانند JSON‏ `metric_monitor_options` را حمل کنند) |
| Custom Code / Synthetic | `Result Value`، `Error`، `Execution Time (in ms)` |
| DNS / Domain / DNSSEC | `DNS Is Online`، `DNS Record Value`، `Domain Is Expired`، `DNSSEC Chain Is Valid` |
| SQL Query | `SQL Is Online`، `SQL Query Row Count`، `SQL Query Scalar Value` |
| Database Health | `Database Is Online`، `Database Metric` (به JSON‏ `database_monitor_options`ای نیاز دارد که سری را نام ببرد، مثلاً `jsonencode({ metricType = "oneuptime.monitor.database.connections.used.percent" })`)، `Database Collection Error` |
| External Status Page | `External Status Page Is Online`، `External Status Page Active Incidents`، `External Status Page Component Status` |
| Network Device (SNMP) | `SNMP Device Is Online` (با ping یا SNMP دست‌یافتنی)، `SNMP Walk Is Succeeding` (نادرست یعنی دست‌یافتنی اما غیرقابل پیمایش)، `SNMP OID Value` (پالایه‌های SNMP می‌توانند JSON‏ `snmp_monitor_options` را حمل کنند) |

مقادیر رایج `filter_type`:

| رده | مقادیر |
|----------|--------|
| بولی | `True`، `False` |
| عددی | `Equal To`، `Not Equal To`، `Greater Than`، `Less Than`، `Greater Than Or Equal To`، `Less Than Or Equal To` |
| متنی | `Contains`، `Not Contains`، `Starts With`، `Ends With`، `Is Empty`، `Is Not Empty` |
| ضربان قلب | `Recieved In Minutes`، `Not Recieved In Minutes` *(املا همان است که API انتظار دارد)* |
| اسکریپت‌نویسی | `Evaluates To True` |
| ناهنجاری (سنجه‌ها) | `Anomalously High`، `Anomalously Low`، `Anomalous` |

نمونه — وقتی گواهی ظرف ۳۰ روز منقضی می‌شود مانیتور گواهی SSL را تنزل دهید:

```hcl
filters = [
  {
    check_on    = "Expires In Days"
    filter_type = "Less Than"
    value       = "30"
  }
]
```

ارائه‌دهنده `check_on`، `filter_type` و دیگر صفت‌های شمارشی را هنگام plan اعتبارسنجی می‌کند، پس غلط تایپی پیش از فرستاده شدن چیزی به API شکست می‌خورد. فهرست‌های کامل در ویرایشگر معیار داشبورد دیدنی‌اند؛ هر چیزی که داشبورد بپذیرد اینجا معتبر است، دقیقاً با همان برچسبی که داشبورد نشان می‌دهد.

## اشتباه‌های رایج

1. **دادن جانگهدارهای خالی.** ‏`incidents = []`، `request_headers = {}` یا `description = ""` رد می‌شوند — به‌جایش صفت را حذف کنید. غایب همیشه یعنی «تنظیم‌نشده».
2. **عدد جایی که رشته انتظار می‌رود.** مقدار `value` پالایه حتی برای مقایسه‌های عددی رشته است: `value = "200"`. فقط `port` و دیگر صفت‌های واقعاً عددی (`retry_count`، `request_timeout_in_ms`، `evaluate_over_time_minutes`، …) عدد می‌گیرند.
3. **نوع مقصد اشتباه.** ‏`monitor_destination_type = "URL"` با نام میزبانی برهنه (یا `Hostname` با نشانی کامل) پروب کردن را شکست می‌دهد. Website/API نشانی می‌گیرند؛ Ping/Port نام میزبان یا IP.
4. **‏`change_monitor_status = true` بدون `monitor_status_id`.** معیار آنگاه می‌خواند اما وضعیتی برای جابه‌جا شدن ندارد.
5. **نوشتن شناسه‌ها.** دیگر هیچ صفت `id`ای هیچ‌جای `monitor_steps` نیست. اگر JSON کهنه مهاجرت می‌دهید، حذفشان کنید — کارساز شناسه‌ها را تولید می‌کند.
6. **دریچه‌های فرار با رشته‌های دست‌ساز.** ‏`log_monitor` و همتایانش را با `jsonencode()` بنویسید تا Terraform نقل‌قول‌ها را رسیدگی کند و JSON متعارف تولید کند (برای `metric_monitor`، شکل کامل شیئی را که داشبورد تولید می‌کند بگنجانید — کارساز عادی‌سازی‌اش می‌کند).

## حذف کامل monitor_steps

اگر `monitor_steps` را حذف کنید، کارساز برای آن نوع مانیتور پیکربندی پیش‌فرضی تولید می‌کند (برای `Website`: نشانی را بررسی کن، وقتی دست‌نیافتنی است آفلاین) و وضعیت Terraform شما صفت را `null` نگه می‌دارد — پیش‌فرض‌های کارساز رانش **نمی‌سازند**. مانیتورهای `Manual` بررسی فعالی ندارند و هرگز به گام نیاز ندارند.

## پیش‌زمینه: قالب سیمی

روی سیم، API هنوز JSON پاکت نوع‌دار خودش را حرف می‌زند — هر شیء غنی‌ای به‌صورت `{_type, value}` پوشیده می‌شود:

```json
{
  "_type": "MonitorSteps",
  "value": {
    "monitorStepsInstanceArray": [
      {
        "_type": "MonitorStep",
        "value": {
          "monitorDestination": { "_type": "URL", "value": "https://example.com" },
          "requestType": "GET",
          "monitorCriteria": {
            "_type": "MonitorCriteria",
            "value": { "monitorCriteriaInstanceArray": [ { "_type": "MonitorCriteriaInstance", "value": { "...": "..." } } ] }
          }
        }
      }
    ]
  }
}
```

ارائه‌دهنده هنگام نوشتن این پاکت را از HCL شما می‌سازد و هنگام خواندن دوباره نگاشتش می‌کند، و افزوده‌های مدیریت‌شده کارساز (شناسه‌های تولیدشده، پیش‌فرض‌های تزریق‌شده) را نادیده می‌گیرد. فقط وقتی به دانستن این شکل نیاز دارید که پاسخ‌های خام API را می‌خوانید — برای نمونه در اسکریپت‌هایی که مستقیم `monitorSteps` را پرس‌وجو می‌کنند.

## صفحه‌های مرتبط

- [نمونه‌ها](/docs/terraform/examples) — گونه‌های ping، درگاه، SSL و API این الگو
- [عیب‌یابی](/docs/terraform/troubleshooting) — از جمله «نتیجه ناسازگار پس از apply» روی مانیتورها
