# OpenTofu

ارائه‌دهنده OneUptime علاوه بر Terraform با [OpenTofu](https://opentofu.org) هم کار می‌کند، و در [رجیستری OpenTofu](https://search.opentofu.org/provider/oneuptime/oneuptime/latest) منتشر شده است.

این مسیری آزموده است نه فرضی به ارث رسیده از سازگاری با Terraform: مجموعه سرتاسری ارائه‌دهنده در هر درخواست ادغام همان دستگاه‌های آزمون را روی هر دو موتور اجرا می‌کند، و شکستی زیر `tofu` ساخت را شکست می‌دهد.

## استفاده از ارائه‌دهنده با OpenTofu

هیچ‌چیز در پیکربندی شما تغییر نمی‌کند. ارائه‌دهنده را دقیقاً همان‌گونه که برای Terraform می‌کردید اعلام کنید و با `tofu` برانیدش:

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
  # api_key is read from ONEUPTIME_API_KEY.
  # oneuptime_url defaults to https://oneuptime.com — set it only if self-hosted.
}
```

```bash
export ONEUPTIME_API_KEY="your-project-api-key"
tofu init
tofu plan
tofu apply
```

کلید API باید کلید API یک **پروژه** باشد، دقیقاً همان‌طور که در [شروع سریع](/docs/terraform/quick-start) توضیح داده شده است. هر چیزی در [راهنمای کامل](/docs/terraform/complete-guide)، [مراحل مانیتور](/docs/terraform/monitor-steps)، [نمونه‌ها](/docs/terraform/examples) و [وارد کردن منابع](/docs/terraform/importing-resources) بدون تغییر صدق می‌کند — روی خط فرمان به‌جای `terraform` بگذارید `tofu`.

## چرا نشانی منبع نام رجیستری را نمی‌برد

مقدار `source = "oneuptime/oneuptime"` هیچ نام میزبانی حمل نمی‌کند، پس هر موتور آن را در برابر رجیستری پیش‌فرض خودش تفکیک می‌کند: `registry.opentofu.org` زیر OpenTofu، ‏`registry.terraform.io` زیر Terraform. ارائه‌دهنده در هر دو منتشر شده است، پس یک نشانی منبع هر دو موتور را پوشش می‌دهد.

نوشتن `source = "registry.terraform.io/oneuptime/oneuptime"` پیکربندی را به رجیستری Terraform سنجاق می‌کند و در محیط‌های هوابرید یا با رجیستری محدود، زیر OpenTofu شکستش می‌دهد. نام میزبان را نگذارید.

## تفاوت‌هایی که دانستنشان می‌ارزد

| موضوع | رفتار |
|-------|-----------|
| بلوک `terraform` | `terraform` می‌ماند. کلیدواژه‌ای از زبان است، نه ارجاعی به CLI ‏Terraform، و OpenTofu همان‌طور که هست می‌خواندش. |
| فایل‌های `.tf` در برابر `.tofu` | `.tf` زیر هر دو کار می‌کند. OpenTofu افزون بر آن فایل‌های `.tofu` را می‌خواند و هر فایل `.tf`ای را که خواهر `.tofu` داشته باشد نادیده می‌گیرد — دریچه فراری برای پیکربندی فقط OpenTofu، به قیمت سازگاری با Terraform. |
| `required_version` | سری نسخه OpenTofu از ۱٫۶٫۰ آغاز می‌شود، پس محدودیتی که برای Terraform نوشته شده (`>= 1.5.0`) با هر انتشار OpenTofu برآورده می‌شود. |
| فایل‌های قفل | هر دو `.terraform.lock.hcl` می‌نویسند، اما فایل قفل رجیستری‌ای را که در برابرش تفکیک شده ثبت می‌کند — فایل قفل یک موتور دیگری را برآورده نمی‌کند. آن یکی را که CI شما به کار می‌برد کامیت کنید، و پس از جابه‌جایی `tofu init -upgrade` را اجرا کنید. |
| فایل‌های وضعیت | قالب و نام فایل یکسان. وضعیت موجود بدون تبدیل میان موتورها جابه‌جا می‌شود. |
| فایل پیکربندی CLI | ‏OpenTofu فایل `~/.tofurc` را می‌خواند (با بازگشت به `~/.terraformrc`)؛ هر دو موتور به متغیر محیطی `TF_CLI_CONFIG_FILE` احترام می‌گذارند. |
| متغیرها | ‏OpenTofu علاوه بر `TOFU_VAR_*` مقدار `TF_VAR_*` را هم می‌خواند، پس ابزارها و CI موجود به کار کردن ادامه می‌دهند. |

## انتخاب نسخه

نسخه‌های ارائه‌دهنده نسخه‌های پلتفرم OneUptime را دنبال می‌کنند، و قاعده زیر هر دو موتور یکی است:

- **‏OneUptime Cloud**: `version = "~> 11.0"`.
- **خودمیزبان**: تازه‌ترین نسخه منتشرشده ارائه‌دهنده که **کوچک‌تر یا مساوی** نسخه پلتفرم شما باشد. [راه‌اندازی خودمیزبان](/docs/terraform/self-hosted) را ببینید.

نسخه وصله دقیقی را سنجاق نکنید — هر وصله پلتفرم منتشر نمی‌شود. توضیح کامل در [استفاده از رجیستری](/docs/terraform/registry) است؛ چون هر دو رجیستری همان انتشارها را سرو می‌کنند، برای رجیستری OpenTofu هم صدق می‌کند.

## نمونه‌ها و یک ماژول قابل استفاده دوباره

پیکربندی‌های اجراشدنی OpenTofu در [`Examples/opentofu/`](https://github.com/OneUptime/oneuptime/tree/master/Examples/opentofu) در مخزن OneUptime زندگی می‌کنند:

| پوشه | چیست |
|-----------|------------|
| `quickstart/` | کوچک‌ترین پیکربندی مفید — یک برچسب، یک مانیتور، یک صفحه وضعیت |
| `monitoring-and-incident-response/` | دو سرویس که از راه ماژول زیر سیم‌کشی شده‌اند |
| `modules/monitoring-and-incident-response/` | ماژول قابل استفاده دوباره: مانیتورها، چرخش کشیک، و یک صفحه وضعیت |

این ماژول به سرویسی مانیتورهای HTTP، سیاست کشیکی که هنگام شکستشان فراخوانده می‌شود، و صفحه وضعیتی که فهرستشان می‌کند می‌دهد:

```hcl
module "storefront" {
  source = "github.com/OneUptime/terraform-provider-oneuptime//modules/monitoring-and-incident-response?ref=v11.7.4"

  service_name          = "storefront"
  status_page_is_public = true

  monitors = {
    homepage = { url = "https://example.com" }
    checkout = { url = "https://example.com/checkout" }
    api      = { url = "https://api.example.com/health", expected_status_code = "204" }
  }
}
```

منبعش به‌جای مخزن اصلی OneUptime، مخزن منتشرشده ارائه‌دهنده است تا `tofu init` به‌جای کل تک‌مخزن، مخزنی کوچک را کلون کند. مقدار `ref` را به برچسبی منتشرشده از ارائه‌دهنده سنجاق کنید — مخزن ارائه‌دهنده در هر انتشار بازتولید می‌شود. ماژول زیر Terraform هم کار می‌کند؛ HCL مستقل از موتور است.

عمداً وضعیت مانیتور یا شدت حادثه نمی‌سازد. OneUptime آن‌ها را به ازای هر پروژه بذر می‌پاشد، و ماژولی که به ازای هر سرویس یک بار نمونه‌سازی شود در هر فراخوان مجموعه‌ای تکراری می‌افزود. به‌جایش آن‌ها را با نام جستجو می‌کند — اگر پروژه‌تان تغییر نامشان داده است `operational_monitor_status_name`، `offline_monitor_status_name` یا `incident_severity_name` را بازنویسی کنید.

## محیط‌های هوابرید

فرمان `tofu providers mirror` ارائه‌دهنده را داخلی آینه می‌کند، همان‌طور که `terraform providers mirror` می‌کند. راهنمای گام‌به‌گام در [راه‌اندازی خودمیزبان](/docs/terraform/self-hosted) با جایگزینی `tofu` به‌جای `terraform` صدق می‌کند.

## پشتیبانی

- اشکال‌ها و درخواست قابلیت، از جمله هر چیز ویژه OpenTofu: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues)
- ارائه‌دهنده از مشخصات OpenAPI در [مخزن اصلی OneUptime](https://github.com/OneUptime/oneuptime) تولید می‌شود؛ مخزن منتشرشده ارائه‌دهنده خروجی ساختِ فقط‌خواندنی است.
