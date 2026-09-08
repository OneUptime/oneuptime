# راهنمای کامل

این راهنما هر چیزی فراتر از اولین اعمال را پوشش می‌دهد: الگوهای احراز هویت، نحوه ساختاردهی یک پروژه Terraform برای OneUptime، وابستگی منابع، منابع داده، مدیریت وضعیت و ارتقاها.

اگر هرگز از این ارائه‌دهنده استفاده نکرده‌اید، از [شروع سریع](/docs/terraform/quick-start) آغاز کنید.

## پیکربندی ارائه‌دهنده

بلوک ارائه‌دهنده دو ویژگی می‌پذیرد:

| ویژگی | الزامی | متغیر محیطی | پیش‌فرض |
|-----------|----------|----------------------|---------|
| `api_key` | خیر (به متغیر محیطی بازمی‌گردد) | `ONEUPTIME_API_KEY` | — |
| `oneuptime_url` | خیر | `ONEUPTIME_URL` | `https://oneuptime.com` |

اگر نه از بلوک ارائه‌دهنده و نه از محیط کلید APIای در دسترس نباشد، ارائه‌دهنده در زمان پیکربندی با خطایی صریح شکست می‌خورد — پیش از آنکه هیچ کار plan یا apply انجام شود.

کلید باید یک **کلید API پروژه** باشد (Project Settings > API Keys) با دسترسی Create/Read/Update/Delete روی نوع‌های منبعی که پیکربندی شما مدیریت می‌کند. کلیدهای ارشد و کلیدهای کاربر کار نمی‌کنند — [رفع اشکال](/docs/terraform/troubleshooting) را ببینید.

### گزینه ۱: متغیرهای محیطی (توصیه‌شده)

اعتبارنامه‌ها را کلاً بیرون از پیکربندی خود نگه دارید:

```bash
export ONEUPTIME_API_KEY="your-project-api-key"
# Only needed for self-hosted instances:
export ONEUPTIME_URL="https://oneuptime.example.com"
```

```hcl
provider "oneuptime" {}
```

### گزینه ۲: متغیرها با یک فایل tfvars

```hcl
variable "oneuptime_api_key" {
  description = "OneUptime project API key"
  type        = string
  sensitive   = true
}

provider "oneuptime" {
  api_key = var.oneuptime_api_key
}
```

مقدار را در `terraform.tfvars` بگذارید (و آن فایل را به `.gitignore` اضافه کنید):

```hcl
oneuptime_api_key = "your-project-api-key"
```

### گزینه ۳: اسرار CI/CD

در CI، کلید را به‌عنوان یک متغیر محیطی پوشانده‌شده تزریق کنید. نمونه GitHub Actions:

```yaml
env:
  ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
steps:
  - uses: hashicorp/setup-terraform@v3
  - run: terraform init
  - run: terraform plan -input=false
  - run: terraform apply -auto-approve -input=false
```

همین الگو در GitLab CI (متغیرهای پوشانده‌شده)، CircleCI (بافتارها) و Terraform Cloud (متغیرهای محیطی روی فضای کاری) هم کار می‌کند.

## ساختار پروژه

چیدمانی که برای پیکربندی‌های OneUptime خوب کار می‌کند:

```
oneuptime/
├── main.tf          # terraform {} and provider {} blocks
├── variables.tf     # input variables
├── outputs.tf       # exported IDs
├── labels.tf        # labels, teams — shared building blocks
├── monitors.tf      # monitors and monitor statuses
├── status-pages.tf  # status pages and domains
├── on-call.tf       # on-call policies and escalation rules
└── environments/
    ├── production.tfvars
    └── staging.tfvars
```

دو قرارداد که ارزشش را دارند:

- **یک ریشه Terraform به ازای هر پروژه OneUptime.** کلیدهای API به پروژه محدودند، پس یک ماژول ریشه به‌طور طبیعی به یک پروژه نگاشت می‌شود. برای چند پروژه، از ماژول‌های ریشه جداگانه (یا نام‌های مستعار ارائه‌دهنده با یک کلید برای هر کدام) استفاده کنید.
- **بلوک‌های سازنده مشترک (برچسب‌ها، تیم‌ها، وضعیت‌های مانیتور) را یک بار** در فایل خودشان تعریف کنید و همه‌جای دیگر با آدرس منبع به آن‌ها ارجاع دهید.

## وابستگی منابع

Terraform وابستگی‌ها را از روی ارجاع‌ها استنتاج می‌کند. یک گراف معمول — برچسب‌ها و تیم‌ها به مانیتورها خوراک می‌دهند و مانیتورها به یک صفحه وضعیت:

```hcl
resource "oneuptime_label" "payments" {
  name        = "payments"
  description = "Payment infrastructure"
  color       = "#2ecc71"
}

resource "oneuptime_team" "payments_oncall" {
  name        = "Payments On-Call"
  description = "Owns payment service availability"
}

resource "oneuptime_monitor" "checkout_api" {
  name         = "Checkout API"
  description  = "Availability of the checkout API"
  monitor_type = "API"
  labels       = [oneuptime_label.payments.id]
}

resource "oneuptime_status_page" "payments" {
  name                     = "Payments Status"
  description              = "Customer-facing payments status"
  page_title               = "Payments Status"
  page_description         = "Live status of payment processing"
  is_public_status_page    = true
  enable_email_subscribers = true
  enable_sms_subscribers   = false
  labels                   = [oneuptime_label.payments.id]
}
```

چون `oneuptime_monitor.checkout_api` به `oneuptime_label.payments.id` ارجاع می‌دهد، Terraform ابتدا برچسب را می‌سازد و آخر از همه نابودش می‌کند. به `depends_on` صریح به‌ندرت نیاز است — فقط وقتی اضافه‌اش کنید که ترتیب واقعی‌ای بدون ارجاع به ویژگی لازم باشد.

ویژگی‌هایی مانند `labels` **مجموعه‌های بدون ترتیب از رشته‌های شناسه** هستند: تغییر ترتیب مدخل‌ها هیچ تفاوتی تولید نمی‌کند.

## منابع داده

هر منبع یک منبع داده متناظر با همان نام دارد. از منابع داده برای ارجاع به منابعی استفاده کنید که این پیکربندی مدیریتشان *نمی‌کند* — منابعی که در داشبورد ساخته شده‌اند یا ریشه Terraform دیگری مالکشان است.

جستجو بر اساس `name`:

```hcl
data "oneuptime_label" "critical" {
  name = "critical"
}

resource "oneuptime_monitor" "db" {
  name         = "Database Health"
  description  = "Managed here, but reuses a dashboard-created label"
  monitor_type = "Manual"
  labels       = [data.oneuptime_label.critical.id]
}
```

یا جستجو بر اساس `id`:

```hcl
data "oneuptime_status_page" "main" {
  id = "5f8a1b2c3d4e5f6a7b8c9d0e"
}
```

قواعد جستجو:

- یا `id` **یا** `name` بدهید.
- اگر چیزی مطابقت نکند، منبع داده خطا برمی‌گرداند (نام را اصلاح کنید یا منبع را بسازید).
- اگر بیش از یک منبع با یک `name` مطابقت کند، منبع داده هم خطا می‌دهد — نام‌هایی که برای جستجو به کار می‌روند باید یکتا باشند. به‌جایش با `id` جستجو کنید.

> **توجه:** اگر می‌خواهید منبعی موجود را به‌جای صرفاً ارجاع دادن *مدیریت* کنید، آن را وارد کنید — [وارد کردن منابع](/docs/terraform/importing-resources) را ببینید.

## مدیریت وضعیت

وضعیت Terraform برای پیکربندی‌های OneUptime شامل شناسه‌های منبع و مقادیر ویژگی‌هاست — از جمله هر چیز حساسی که تنظیم کرده‌اید. متناسب با آن رفتار کنید:

- **برای هر چیزی فراتر از یک آزمایش شخصی از یک بک‌اند راه دور استفاده کنید**، تا وضعیت مشترک، قفل‌شده و بیرون از پوشه لپ‌تاپ باشد. هر [بک‌اند استاندارد](https://developer.hashicorp.com/terraform/language/backend) کار می‌کند — S3 + DynamoDB، Terraform Cloud، azurerm، GCS:

```hcl
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "oneuptime/production.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}
```

- **هرگز وضعیت را دستی ویرایش نکنید.** اگر به جراحی نیاز دارید از `terraform state mv` / `terraform state rm` استفاده کنید.
- **هرگز `terraform.tfstate` یا `*.tfvars` حاوی اسرار را** در کنترل نسخه کامیت نکنید.

## مهرهای زمانی و انحراف

ویژگی‌های تاریخ/زمان (برای نمونه `starts_at` / `ends_at` روی `oneuptime_scheduled_maintenance_event`، یا فیلدهای محاسبه‌شده `created_at`) رشته‌های RFC3339 هستند. ارائه‌دهنده مهرهای زمانی را از نظر معنایی مقایسه می‌کند: `2026-08-01T02:00:00Z` و شکل نرمال‌شده سمت سرور همان لحظه برابر در نظر گرفته می‌شوند، پس نرمال‌سازی مهر زمانی تفاوت کاذب تولید نمی‌کند.

وقتی مهرهای زمانی را با توابعی مانند `timestamp()` یا `timeadd()` تولید می‌کنید، *مقدار تولیدشده* در هر اجرا تغییر می‌کند — این رفتار Terraform است، نه ارائه‌دهنده. یا از مقادیر ایستا استفاده کنید یا پس از ساخت، تغییرها را نادیده بگیرید:

```hcl
resource "oneuptime_scheduled_maintenance_event" "db_upgrade" {
  title       = "Database upgrade"
  description = "Planned PostgreSQL upgrade"
  starts_at   = "2026-08-01T02:00:00Z"
  ends_at     = "2026-08-01T04:00:00Z"
}
```

## ارتقای ارائه‌دهنده

1. یادداشت‌های انتشار را در [صفحه رجیستری](https://registry.terraform.io/providers/oneuptime/oneuptime) یا [انتشارهای GitHub](https://github.com/OneUptime/terraform-provider-oneuptime/releases) بخوانید.
2. محدودیت نسخه را بالا ببرید (برای نمونه `~> 11.0` از پیش همه انتشارهای 11.x را مجاز می‌کند؛ رفتن به یک نسخه اصلی جدید نیازمند ویرایش محدودیت است).
3. برای گرفتن نسخه جدید `terraform init -upgrade` را اجرا کنید.
4. پیش از اعمال، `terraform plan` را اجرا کنید و مطمئن شوید طرح خالی است (یا فقط تغییرهایی دارد که انتظارشان را دارید).

نصب‌های خودمیزبان باید نسخه ارائه‌دهنده را در سطح نسخه پلتفرم یا پایین‌تر نگه دارند — ابتدا OneUptime را ارتقا دهید و سپس ارائه‌دهنده را. [راه‌اندازی خودمیزبان](/docs/terraform/self-hosted) را ببینید.

## خواندن بیشتر

- [نمونه‌ها](/docs/terraform/examples) — پیکربندی‌های واقعی برای هر نوع منبع
- [مراحل مانیتور](/docs/terraform/monitor-steps) — بررسی عمیق ویژگی‌های تودرتوی `monitor_steps`
- [وارد کردن منابع](/docs/terraform/importing-resources) — پذیرفتن منابع موجود
- [رفع اشکال](/docs/terraform/troubleshooting) — خطاهای رایج و راه‌حل‌ها
