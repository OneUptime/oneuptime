# راه‌اندازی خودمیزبان

هر آنچه مخصوص استفاده از ارائه‌دهنده Terraform در برابر یک نصب خودمیزبان OneUptime است: دادن نشانی نمونه به ارائه‌دهنده، انتخاب نسخه درست ارائه‌دهنده، آینه کردن ارائه‌دهنده برای شبکه‌های ایزوله، و TLS.

خود ارائه‌دهنده برای ابر و خودمیزبان یکسان است — همان منابع، همان ویژگی‌ها. فقط نشانی و قاعده انتخاب نسخه فرق می‌کند.

## نشانی نمونه خود را به ارائه‌دهنده بدهید

مقدار `oneuptime_url` را روی مبدأ نمونه خود بگذارید — فقط طرح و میزبان، بدون پسوند `/api` و بدون مسیر:

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
  oneuptime_url = "https://oneuptime.example.com"
  # api_key from ONEUPTIME_API_KEY, or set explicitly:
  # api_key = var.oneuptime_api_key
}
```

هر دو تنظیم به‌صورت متغیر محیطی هم در دسترس‌اند، که پیکربندی را میان ریشه‌های ابری و خودمیزبان قابل حمل نگه می‌دارد:

```bash
export ONEUPTIME_URL="https://oneuptime.example.com"
export ONEUPTIME_API_KEY="your-project-api-key"
```

کلید API یک **کلید API پروژه** است که در داشبورد نمونه شما از مسیر **Project Settings > API Keys** ساخته می‌شود — دقیقاً مانند ابر. کلیدهای ارشد خودمیزبان کار نمی‌کنند و با خطای `ProjectId required` شکست می‌خورند ([رفع اشکال](/docs/terraform/troubleshooting) را ببینید).

## انتخاب نسخه ارائه‌دهنده

نسخه‌های ارائه‌دهنده نسخه‌های پلتفرم OneUptime را دنبال می‌کنند. قاعده برای خودمیزبان:

> **تازه‌ترین نسخه منتشرشده ارائه‌دهنده را به کار ببرید که کوچک‌تر یا مساوی نسخه پلتفرم OneUptime شماست.**

- هرگز ارائه‌دهنده‌ای *جدیدتر* از پلتفرم خود به کار نبرید — ممکن است فیلدهای APIای را به کار بگیرد که نصب شما هنوز ندارد.
- نسخه وصله‌ای دقیق را پین **نکنید**. هر وصله پلتفرم روی رجیستری منتشر نمی‌شود، بنابراین پین‌هایی به سبک `= 11.0.7` معمولاً با خطای `no matching version found` شکست می‌خورند.

این قاعده را به‌صورت یک محدودیت کران‌دار بیان کنید. برای نمونه، اگر نصب شما انتشار پلتفرم `11.2.x` را اجرا می‌کند:

```hcl
version = ">= 11.0, <= 11.2"
```

آنگاه Terraform تازه‌ترین انتشار منتشرشده 11.x را انتخاب می‌کند که از 11.2 فراتر نرود — و به‌صورت خودکار وصله‌های منتشرنشده را رد می‌کند. اگر نسخه‌های اصلی پلتفرم را به‌صورت آزادانه دنبال می‌کنید و نسبتاً به‌روز می‌مانید، `~> 11.0` هم خوب است.

نسخه پلتفرم خود را در داشبورد مدیریت OneUptime یا از مقادیر استقرار Helm/Docker Compose خود پیدا کنید. نسخه‌های منتشرشده ارائه‌دهنده در [registry.terraform.io/providers/oneuptime/oneuptime/versions](https://registry.terraform.io/providers/oneuptime/oneuptime/versions) فهرست شده‌اند.

**ترتیب ارتقا:** ابتدا پلتفرم OneUptime را ارتقا دهید، سپس محدودیت ارائه‌دهنده را بالا ببرید و `terraform init -upgrade` را اجرا کنید.

## نصب‌های ایزوله از شبکه: آینه کردن ارائه‌دهنده

اگر میزبان‌هایی که Terraform را اجرا می‌کنند به `registry.terraform.io` دسترسی ندارند، ارائه‌دهنده را در شبکه خود آینه کنید. روی ماشینی با دسترسی اینترنت:

```bash
mkdir -p /srv/terraform-mirror
cd /path/to/your/terraform/config   # a directory whose required_providers includes oneuptime
terraform providers mirror /srv/terraform-mirror
```

این کار انتشارهای ارائه‌دهنده منطبق با محدودیت‌های شما را برای همه بسترها در چیدمان پوشه‌ای که Terraform می‌فهمد دانلود می‌کند. پوشه را به داخل منتقل کنید، آن را ارائه دهید (یک سرور فایل ساده HTTPS) یا به‌عنوان یک مسیر سامانه فایل به اشتراک بگذارید، و در پیکربندی CLI (`~/.terraformrc`) نشانی آن را به Terraform بدهید:

```hcl
provider_installation {
  filesystem_mirror {
    path    = "/srv/terraform-mirror"
    include = ["registry.terraform.io/oneuptime/oneuptime"]
  }
  direct {
    exclude = ["registry.terraform.io/oneuptime/oneuptime"]
  }
}
```

اکنون `terraform init` ارائه‌دهنده OneUptime را از آینه و بقیه را از جای همیشگی‌شان نصب می‌کند (برای آینه‌ی محض، بلوک `direct` را حذف کنید). هر بار که محدودیت نسخه خود را بالا بردید، دستور `mirror` را دوباره اجرا کنید.

## نکته‌های TLS

- Terraform یک برنامه Go است: گواهی نمونه شما را در برابر **انبار اعتماد سامانه** ماشینی که Terraform را اجرا می‌کند اعتبارسنجی می‌کند. اگر نمونه شما از گواهی یک CA خصوصی استفاده می‌کند، آن گواهی CA را روی هر ماشین (و هر اجراکننده CI) که Terraform را اجرا می‌کند نصب کنید. روی Debian/Ubuntu: گواهی CA را در `/usr/local/share/ca-certificates/` کپی کنید و `update-ca-certificates` را اجرا کنید.
- عمداً هیچ ویژگی «رد کردن اعتبارسنجی TLS» وجود ندارد. اگر خطای `x509: certificate signed by unknown authority` دیدید، اعتماد را درست کنید — سعی نکنید غیرفعالش کنید.
- HTTP ساده برای محیط‌های آزمایشگاهی کار می‌کند (`oneuptime_url = "http://oneuptime.lab.internal"`)، اما کلید API پروژه با هر درخواست فرستاده می‌شود؛ برای هر چیزی فراتر از یک آزمایشگاه یک‌بارمصرف از TLS استفاده کنید.
- اگر OneUptime پشت یک پراکسی معکوس یا ingress باشد، `oneuptime_url` همان مبدأ *بیرونی*ای است که پراکسی ارائه می‌دهد. مطمئن شوید پراکسی همه مسیرهای `/api` را بدون تغییر ارجاع می‌دهد.

## صفحه‌های مرتبط

- [استفاده از رجیستری](/docs/terraform/registry) — نحوه انتشار نسخه‌ها، یادداشت‌های انتشار
- [رفع اشکال](/docs/terraform/troubleshooting) — خطاهای نشانی، TLS و کلید با جزئیات
- [شروع سریع](/docs/terraform/quick-start) — اولین اعمال، که در خودمیزبان هم یکسان کار می‌کند
