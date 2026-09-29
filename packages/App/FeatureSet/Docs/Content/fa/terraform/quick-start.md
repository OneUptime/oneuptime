# شروع سریع

این راهنما در حدود ۱۰ دقیقه شما را از صفر به منابع مدیریت‌شده OneUptime می‌رساند: ساخت یک کلید API، پیکربندی ارائه‌دهنده، و اعمال یک برچسب، یک مانیتور HTTP و یک صفحه وضعیت.

## پیش‌نیازها

- [Terraform](https://developer.hashicorp.com/terraform/install) نسخه ۱.۵ یا بالاتر
- یک حساب OneUptime با یک پروژه ([oneuptime.com](https://oneuptime.com) یا نمونه خودمیزبان شما)

## گام ۱: ساخت یک کلید API پروژه

ارائه‌دهنده با یک **کلید API محدود به پروژه** احراز هویت می‌کند. در داشبورد OneUptime:

1. پروژه خود را انتخاب کنید.
2. به **Project Settings** > **API Keys** بروید.
3. روی **Create API Key** کلیک کنید.
4. یک نام (برای نمونه `terraform`) و یک تاریخ انقضا بگذارید.
5. دسترسی بدهید. Terraform به دسترسی **Create**، **Read**، **Update (Edit)** و **Delete** روی هر نوع منبعی که می‌خواهید مدیریت کنید نیاز دارد — برای این راهنما: Label، Monitor و Status Page.
6. کلید ساخته‌شده را کپی کنید.

> **هشدار:** از کلید کاربر یا کلید API ارشد خودمیزبان استفاده نکنید. کلیدهای ارشد به یک پروژه محدود نیستند و فراخوان‌های API با آن‌ها با خطای `ProjectId required` شکست می‌خورند. فقط کلیدهای API پروژه با ارائه‌دهنده Terraform کار می‌کنند.

کلید را به‌عنوان متغیر محیطی صادر کنید تا هرگز در فایل‌های Terraform شما ننشیند:

```bash
export ONEUPTIME_API_KEY="your-project-api-key"
```

## گام ۲: پیکربندی ارائه‌دهنده

یک پوشه کاری با فایل `main.tf` بسازید:

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
  # api_key is read from the ONEUPTIME_API_KEY environment variable.
  # oneuptime_url defaults to https://oneuptime.com — set it only if self-hosted:
  # oneuptime_url = "https://oneuptime.example.com"
}
```

کاربران خودمیزبان: مقدار `oneuptime_url` را روی نشانی نمونه خود بگذارید و پیش از پین کردن نسخه ارائه‌دهنده، راهنمای نسخه را در [راه‌اندازی خودمیزبان](/docs/terraform/self-hosted) ببینید.

## گام ۳: تعریف اولین منابع

این را به `main.tf` اضافه کنید. یک برچسب، یک مانیتور وب‌سایت برای صفحه اصلی شما و یک صفحه وضعیت خصوصی می‌سازد:

```hcl
resource "oneuptime_label" "critical" {
  name        = "critical"
  description = "Resources that page on-call when down"
  color       = "#FF5733"
}

resource "oneuptime_monitor" "homepage" {
  name         = "Homepage"
  description  = "Checks that the homepage responds"
  monitor_type = "Website"
  labels       = [oneuptime_label.critical.id]
}

resource "oneuptime_status_page" "internal" {
  name                     = "Internal Status"
  description              = "Status page for internal services"
  page_title               = "Service Status"
  page_description         = "Live status of our services"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

output "monitor_id" {
  value = oneuptime_monitor.homepage.id
}
```

مانیتور `Website` که بدون `monitor_steps` صریح ساخته شود، پیش‌فرض‌های معقول سمت سرور می‌گیرد. برای اینکه خودتان نشانی، نوع درخواست و معیارهای در دسترس بودن را کنترل کنید، ویژگی‌های تودرتوی `monitor_steps` را تنظیم کنید — این‌ها در [مراحل مانیتور](/docs/terraform/monitor-steps) پوشش داده شده‌اند.

## گام ۴: init، plan، apply

```bash
terraform init
terraform plan
terraform apply
```

طرح را مرور کنید (۳ منبع برای افزودن) و با `yes` تأیید کنید. اعمال در چند ثانیه کامل می‌شود و شناسه مانیتور را چاپ می‌کند.

## گام ۵: راستی‌آزمایی در داشبورد

در داشبورد OneUptime:

- **Monitors** — مانیتور `Homepage` با برچسب `critical` فهرست شده است.
- **Status Pages** — `Internal Status` ظاهر می‌شود.
- **Project Settings > Labels** — برچسب `critical` با رنگی که تعیین کردید وجود دارد.

دوباره `terraform plan` را اجرا کنید: گزارش می‌دهد `No changes.` فیلدهایی که سمت سرور محاسبه می‌شوند (اسلاگ‌ها، وضعیت فعلی، مراحل پیش‌فرض پایش) باعث انحراف نمی‌شوند.

## گام ۶: پاک‌سازی

اگر این یک آزمایش بود، هر چیزی را که این پیکربندی ساخته حذف کنید:

```bash
terraform destroy
```

## گام‌های بعدی

- [راهنمای کامل](/docs/terraform/complete-guide) — گزینه‌های احراز هویت، چیدمان پروژه، وابستگی‌ها، منابع داده، وضعیت راه دور
- [نمونه‌ها](/docs/terraform/examples) — پیکربندی برای هر نوع منبع اصلی
- [مراحل مانیتور](/docs/terraform/monitor-steps) — کنترل آنچه مانیتورهای شما بررسی می‌کنند
- [وارد کردن منابع](/docs/terraform/importing-resources) — پذیرفتن منابعی که از قبل در داشبورد ساخته‌اید
