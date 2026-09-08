# ارائه‌دهنده Terraform

ارائه‌دهنده Terraform مربوط به OneUptime، منابع OneUptime — مانیتورها، صفحات وضعیت، تیم‌ها، برچسب‌ها، سیاست‌های آنکال، حوادث، پراب‌ها و موارد دیگر — را به‌صورت زیرساخت‌به‌مثابه‌کدِ اعلانی مدیریت می‌کند. هم با OneUptime Cloud و هم با نصب‌های خودمیزبان OneUptime کار می‌کند.

این ارائه‌دهنده روی رجیستری Terraform منتشر شده است: [registry.terraform.io/providers/oneuptime/oneuptime](https://registry.terraform.io/providers/oneuptime/oneuptime)، و روی رجیستری OpenTofu: [search.opentofu.org/provider/oneuptime/oneuptime](https://search.opentofu.org/provider/oneuptime/oneuptime/latest). **[OpenTofu](/docs/terraform/opentofu) پشتیبانی و آزمایش می‌شود** — مجموعه آزمون سرتاسری در هر تغییر روی هر دو موتور اجرا می‌شود.

## پیکربندی کمینه

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
  # oneuptime_url defaults to https://oneuptime.com.
  # Self-hosted users: set this to your own instance URL.
  api_key = var.oneuptime_api_key
}
```

کلید API باید یک **کلید API پروژه** باشد که در داشبورد OneUptime از مسیر **Project Settings > API Keys** ساخته شده است. برای راهنمای کامل، [شروع سریع](/docs/terraform/quick-start) را ببینید.

## مستندات

| صفحه | چه چیزی را پوشش می‌دهد |
|------|----------------|
| [شروع سریع](/docs/terraform/quick-start) | ساخت یک کلید API و اعمال اولین منابع در حدود ۱۰ دقیقه |
| [راهنمای کامل](/docs/terraform/complete-guide) | احراز هویت، ساختار پروژه، وابستگی‌ها، منابع داده، وضعیت |
| [مراحل مانیتور](/docs/terraform/monitor-steps) | بررسی عمیق ویژگی‌های تودرتوی `monitor_steps` و فیلترهای معیار |
| [نمونه‌ها](/docs/terraform/examples) | پیکربندی‌های قابل کپی برای هر نوع منبع اصلی |
| [وارد کردن منابع](/docs/terraform/importing-resources) | آوردن منابع موجود OneUptime زیر مدیریت Terraform |
| [رفع اشکال](/docs/terraform/troubleshooting) | مرجع نشانه‌به‌راه‌حل برای رایج‌ترین خطاها |
| [راه‌اندازی خودمیزبان](/docs/terraform/self-hosted) | نشانی نمونه، انتخاب نسخه، آینه کردن برای شبکه ایزوله، TLS |
| [استفاده از رجیستری](/docs/terraform/registry) | نحوه انتشار نسخه‌های ارائه‌دهنده و انتخاب یکی از آن‌ها |
| [OpenTofu](/docs/terraform/opentofu) | استفاده از ارائه‌دهنده با `tofu` و معدود تفاوت‌هایی که اهمیت دارند |

## ارائه‌دهنده چه چیزی را مدیریت می‌کند

منابع از الگوی نام‌گذاری `oneuptime_<snake_case_resource>` پیروی می‌کنند. پرکاربردترین منابع:

| منبع | هدف |
|----------|---------|
| `oneuptime_monitor` | مانیتورهای وب‌سایت، API، ping، پورت، IP، گواهی SSL، سرور، درخواست ورودی و دستی |
| `oneuptime_monitor_status` | تعریف وضعیت‌های مانیتور (عملیاتی، تضعیف‌شده، آفلاین و ...) |
| `oneuptime_monitor_group` | گروه‌بندی مانیتورها برای وضعیت تجمیعی |
| `oneuptime_status_page` | صفحات وضعیت عمومی و خصوصی |
| `oneuptime_status_page_domain` | دامنه‌های سفارشی برای صفحات وضعیت |
| `oneuptime_domain` | دامنه‌های راستی‌آزمایی‌شده در سطح پروژه |
| `oneuptime_label` | برچسب‌ها برای سازمان‌دهی و فیلتر کردن منابع |
| `oneuptime_team` | تیم‌ها |
| `oneuptime_team_member` | عضویت تیمی |
| `oneuptime_on_call_policy` | سیاست‌های کشیک آنکال |
| `oneuptime_escalation_rule` | قواعد تشدید متصل به سیاست‌های آنکال |
| `oneuptime_incident` / `oneuptime_incident_severity` / `oneuptime_incident_state` | حوادث و رده‌بندی آن‌ها |
| `oneuptime_alert` / `oneuptime_alert_severity` / `oneuptime_alert_state` | هشدارها و رده‌بندی آن‌ها |
| `oneuptime_scheduled_maintenance_event` | پنجره‌های تعمیر و نگهداری زمان‌بندی‌شده |
| `oneuptime_probe` | پراب‌های سفارشی پایش |

هر منبع یک **منبع داده** متناظر با همان نام هم دارد (برای نمونه `data "oneuptime_label"`) که یک منبع موجود را با `id` یا با `name` پیدا می‌کند.

مرجع کامل و تولیدشده شِمای هر منبع در [زبانه مستندات رجیستری Terraform](https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs) قرار دارد.

## ارائه‌دهنده چگونه پیکربندی پیچیده را مدل می‌کند

شِماهای منابع OneUptime مستقیماً به API OneUptime نگاشت می‌شوند:

- **ویژگی‌های اسکالر** رشته‌ها، اعداد و بولی‌های ساده Terraform هستند (`name`، `description`، `monitor_type`، `is_public_status_page` و ...).
- **ارجاع به موجودیت‌ها** رشته‌های شناسه هستند (`incident_severity_id`، `monitor_id`). آرایه‌هایی از ارجاع، مانند `labels`، مجموعه‌های بدون ترتیب از رشته‌های شناسه‌اند — تغییر ترتیبشان هیچ تفاوتی تولید نمی‌کند.
- **پیکربندی تودرتوی پیچیده** — به‌ویژه `monitor_steps` یک مانیتور — از ویژگی‌های تودرتوی نوع‌دار استفاده می‌کند که مستقیم در HCL نوشته می‌شوند، به‌همراه دریچه‌های فرار JSON خام به ازای هر نوع مانیتور برای پیکربندی‌های عمیق کوئری تله‌متری. [مراحل مانیتور](/docs/terraform/monitor-steps) را ببینید.
- **ویژگی‌های تاریخ/زمان** رشته‌های RFC3339 هستند (برای نمونه `2026-08-01T02:00:00Z`). ارائه‌دهنده مهرهای زمانی هم‌معنا را برابر در نظر می‌گیرد، بنابراین نرمال‌سازی سمت سرور باعث انحراف نمی‌شود.

## نسخه‌بندی

نسخه‌های ارائه‌دهنده نسخه‌های پلتفرم OneUptime را دنبال می‌کنند.

- **OneUptime Cloud**: از `version = "~> 11.0"` استفاده کنید.
- **خودمیزبان**: تازه‌ترین نسخه منتشرشده ارائه‌دهنده را به کار ببرید که **کوچک‌تر یا مساوی** نسخه پلتفرم OneUptime شماست. نسخه وصله‌ای دقیق را پین نکنید — هر انتشار وصله‌ای پلتفرم روی رجیستری منتشر نمی‌شود. [راه‌اندازی خودمیزبان](/docs/terraform/self-hosted) را ببینید.

## پشتیبانی

- باگ‌ها و درخواست قابلیت: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues)
- کد منبع ارائه‌دهنده از مشخصات OpenAPI OneUptime در [مخزن اصلی OneUptime](https://github.com/OneUptime/oneuptime) تولید می‌شود؛ مخزن منتشرشده ارائه‌دهنده فقط‌خواندنی است.
