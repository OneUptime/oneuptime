# نمونه‌ها

پیکربندی‌های آماده کپی-چسباندن برای رایج‌ترین منابع OneUptime. هر نمونه از مجموعه آزمون سرتاسری ارائه‌دهنده اقتباس شده است، پس ویژگی‌هایی که اینجا نشان داده شده‌اند واقعی‌اند و بلوک‌ها تمیز اعمال می‌شوند.

همه نمونه‌ها این راه‌اندازی ارائه‌دهنده را فرض می‌گیرند:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 11.0"
    }
  }
}

provider "oneuptime" {
  # api_key from ONEUPTIME_API_KEY; oneuptime_url only needed when self-hosted.
}
```

## برچسب‌ها

برچسب‌ها ارزان‌ترین بلوک سازنده‌اند — نخست بسازیدشان و با `labels = [...]` (مجموعه‌ای بدون ترتیب از شناسه‌های برچسب) به تقریباً هر چیزی بچسبانیدشان.

```hcl
resource "oneuptime_label" "production" {
  name        = "production"
  description = "Production infrastructure"
  color       = "#FF5733"
}
```

## مانیتورها

### مانیتور HTTP با بررسی‌های صریح

مانیتوری از نوع `Website` با کنترل کامل بر اینکه چه چیزی بررسی می‌شود و کی بالا یا پایین در نظر گرفته می‌شود. ویژگی‌های تودرتوی `monitor_steps` خط‌به‌خط در [مراحل مانیتور](/docs/terraform/monitor-steps) توضیح داده شده‌اند.

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
  description  = "Homepage availability and status code check"
  monitor_type = "Website"

  monitor_steps = [{
    monitor_destination      = "https://example.com"
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name                  = "Online"
        description           = "Website responds with 200"
        filter_condition      = "All"
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
            value       = "200"
          }
        ]
      },
      {
        name                  = "Offline"
        description           = "Website is unreachable"
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
      }
    ]
  }]
}
```

*(اقتباس از آزمون سرتاسری `35-monitor-with-steps`.)*

### مانیتور پینگ

مانیتورهای پینگ به‌جای نشانی، مقصدی از نوع `Hostname` (یا `IP`) می‌گیرند:

```hcl
resource "oneuptime_monitor" "ping" {
  name         = "Gateway Ping"
  description  = "ICMP reachability of the gateway host"
  monitor_type = "Ping"

  monitor_steps = [{
    monitor_destination      = "gateway.example.com"
    monitor_destination_type = "Hostname"

    criteria = [
      {
        name                  = "Reachable"
        description           = "Host responds to ping"
        filter_condition      = "All"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

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

*(اقتباس از آزمون سرتاسری `35-monitor-with-steps`.)*

### مانیتور دستی

مانیتورهای دستی هیچ بررسی فعالی ندارند — وضعیت را دست یا خودکارسازی تنظیم می‌کند. اصلاً به `monitor_steps` نیازی ندارند:

```hcl
resource "oneuptime_monitor" "third_party" {
  name                = "Payment Provider (manual)"
  description         = "Tracked manually during vendor incidents"
  monitor_type        = "Manual"
  monitoring_interval = "Every 5 minutes"
}
```

*(اقتباس از آزمون سرتاسری `26-monitor-steps-basic`.)*

دیگر مقادیر معتبر `monitor_type` که به همین شکل به کار می‌روند: `"API"`، `"Port"`، `"IP"`، `"SSL Certificate"`، `"Incoming Request"`، `"Server"`. مانیتورهای Server و Incoming Request کلیدهای محرمانه محاسبه‌شده (`server_monitor_secret_key`، `incoming_request_secret_key`) را برای عامل‌هایشان در معرض می‌گذارند.

## صفحه وضعیت با دامنه سفارشی

سه منبع با هم کار می‌کنند: یک `domain` تأییدشده پروژه، خودِ `status_page`، و یک `status_page_domain` که آن‌ها را پیوند می‌دهد. مقادیر `full_domain` و `cname_verification_token` را کارساز محاسبه می‌کند — تنظیمشان نکنید.

```hcl
resource "oneuptime_domain" "company" {
  domain = "example.com"
}

resource "oneuptime_status_page" "public" {
  name                     = "Public Status"
  description              = "Customer-facing status page"
  page_title               = "System Status"
  page_description         = "Check our system status and incident history"
  is_public_status_page    = true
  enable_email_subscribers = true
  enable_sms_subscribers   = false
}

resource "oneuptime_status_page_domain" "status" {
  domain_id      = oneuptime_domain.company.id
  status_page_id = oneuptime_status_page.public.id
  subdomain      = "status"
}

output "status_domain" {
  # Computed by the server: subdomain + domain, e.g. status.example.com
  value = oneuptime_status_page_domain.status.full_domain
}
```

*(اقتباس از آزمون‌های سرتاسری `25-status-page-with-domain` و `12-status-page-domain`. دامنه‌های جدید پیش از فعال شدن دامنه صفحه وضعیت باید تأیید DNS را بگذرانند.)*

## تیم‌ها و اعضا

```hcl
resource "oneuptime_team" "sre" {
  name        = "SRE"
  description = "Site reliability engineering"
}

resource "oneuptime_team_member" "alice" {
  team_id = oneuptime_team.sre.id
  user_id = "5f8a1b2c3d4e5f6a7b8c9d0e" # user's id — visible in the dashboard URL on their profile
}
```

*(تیم اقتباس از آزمون سرتاسری `33-team-crud`. کاربر ارجاع‌شده باید از پیش بخشی از پروژه باشد؛ عضویت پس از پذیرش دعوت‌نامه توسط کاربر تأیید می‌شود.)*

## سیاست کشیک با تشدید

یک سیاست کشیک به‌علاوه قاعده‌ای تشدید که پس از ۵ دقیقه بدون تصدیق، تشدید می‌کند:

```hcl
resource "oneuptime_on_call_policy" "primary" {
  name                                 = "Primary On-Call"
  description                          = "First line for production incidents"
  repeat_policy_if_no_one_acknowledges = true
}

resource "oneuptime_escalation_rule" "first_line" {
  on_call_duty_policy_id     = oneuptime_on_call_policy.primary.id
  name                       = "First line"
  description                = "Page the on-call engineer immediately"
  order                      = 1
  escalate_after_in_minutes  = 5
}
```

*(سیاست اقتباس از آزمون سرتاسری `31-on-call-duty-policy-crud`.)*

## نگهداری زمان‌بندی‌شده

```hcl
resource "oneuptime_scheduled_maintenance_event" "db_upgrade" {
  title                     = "Database maintenance"
  description               = "Planned PostgreSQL upgrade — writes paused briefly"
  starts_at                 = "2026-08-01T02:00:00Z"
  ends_at                   = "2026-08-01T04:00:00Z"
  is_visible_on_status_page = true
}
```

*(اقتباس از آزمون سرتاسری `30-scheduled-maintenance-crud`. مهرهای زمانی RFC3339 هستند؛ لحظه‌های برابر در نمادگذاری‌های متفاوت انحراف تولید نمی‌کنند.)*

## شدت‌ها و وضعیت‌های حادثه

رده‌بندی حادثه خود را سفارشی کنید — شدت‌ها اثر را رتبه‌بندی می‌کنند، وضعیت‌ها چرخه زندگی را مدل می‌کنند. مقدار `order` جایگاه نمایش را کنترل می‌کند.

```hcl
resource "oneuptime_incident_severity" "sev1" {
  name        = "SEV-1"
  description = "Full outage, all hands"
  color       = "#e74c3c"
  order       = 1
}

resource "oneuptime_incident_state" "mitigated" {
  name        = "Mitigated"
  description = "Impact contained, fix in progress"
  color       = "#f39c12"
  order       = 3
}
```

*(اقتباس از آزمون‌های سرتاسری `03-incident-severity` و `04-incident-state`. منابع `oneuptime_alert_severity` و `oneuptime_alert_state` برای هشدارها یکسان کار می‌کنند.)*

### اعلام یک حادثه از Terraform

حادثه‌ها معمولاً توسط مانیتورها ساخته می‌شوند، اما منابع معمولی هم هستند — برای روزهای تمرین مفیدند:

```hcl
resource "oneuptime_incident" "drill" {
  title                     = "DR drill"
  description               = "Disaster recovery exercise"
  incident_severity_id      = oneuptime_incident_severity.sev1.id
  current_incident_state_id = oneuptime_incident_state.mitigated.id
}
```

*(اقتباس از آزمون سرتاسری `28-incident-crud`.)*

## پروب‌ها

پروب‌های سفارشی بررسی‌های مانیتورینگ را از زیرساخت خودتان اجرا می‌کنند:

```hcl
resource "oneuptime_probe" "eu_west" {
  key           = "probe-eu-west-1"
  name          = "EU West Probe"
  description   = "Probe running in eu-west-1"
  probe_version = "1.0.0"

  should_auto_enable_probe_on_new_monitors = true
}
```

*(اقتباس از آزمون سرتاسری `23-probe-crud`.)*

## بیشتر

- [مراحل مانیتور](/docs/terraform/monitor-steps) — طرحواره کامل `monitor_steps`، پالایه‌های معیار و اشتباه‌های رایج
- [وارد کردن منابع](/docs/terraform/importing-resources) — پذیرفتن منابع ساخته‌شده در داشبورد در این الگوها
- مرجع ویژگی‌ها به تفکیک منبع: [مستندات رجیستری Terraform](https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs)
