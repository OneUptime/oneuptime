# CLI OneUptime

CLI مربوط به OneUptime یک رابط خط فرمان برای مدیریت منابع OneUptime شما مستقیماً از ترمینال است. از عملیات کامل CRUD روی مانیتورها، حوادث، هشدارها، صفحات وضعیت و موارد دیگر پشتیبانی می‌کند.

## قابلیت‌ها

- **پشتیبانی از چند محیط** با بافتارهای نام‌گذاری‌شده برای محیط عملیاتی، آزمایشی و توسعه
- **کشف خودکار** منابع در دسترس از نمونه OneUptime شما
- **احراز هویت انعطاف‌پذیر** از طریق پرچم‌های CLI، متغیرهای محیطی یا بافتارهای ذخیره‌شده
- **قالب‌بندی هوشمند خروجی** با حالت‌های نمایش JSON، جدولی و گسترده
- **قابل اسکریپت‌نویسی** برای خطوط لوله CI/CD و گردش‌های کاری خودکار

## نصب

```bash
npm install -g @oneuptime/cli
```

## شروع سریع

```bash
# Authenticate with your OneUptime instance
oneuptime login <your-api-key> https://oneuptime.com

# List your monitors
oneuptime monitor list

# View a specific incident
oneuptime incident get <incident-id>

# See all available resources
oneuptime resources
```

## مستندات

| راهنما                                          | توضیحات                                                   |
| ----------------------------------------------- | -------------------------------------------------------- |
| [احراز هویت](./authentication.md)               | ورود، بافتارها و مدیریت اعتبارنامه‌ها                     |
| [عملیات روی منابع](./resource-operations.md)    | عملیات CRUD روی مانیتورها، حوادث، هشدارها و موارد دیگر   |
| [قالب‌های خروجی](./output-formats.md)           | حالت‌های خروجی JSON، جدولی و گسترده                       |
| [اسکریپت‌نویسی و CI/CD](./scripting.md)          | خودکارسازی، متغیرهای محیطی و استفاده در خط لوله          |
| [مرجع دستورها](./command-reference.md)          | مرجع کامل همه دستورها و گزینه‌ها                          |

## گزینه‌های سراسری

این پرچم‌ها را می‌توان با هر دستوری به کار برد:

| پرچم                    | توضیحات                                 |
| ----------------------- | -------------------------------------- |
| `--api-key <key>`       | بازنویسی کلید API برای این دستور        |
| `--url <url>`           | بازنویسی نشانی نمونه برای این دستور     |
| `--context <name>`      | استفاده از یک بافتار نام‌گذاری‌شده مشخص |
| `-o, --output <format>` | قالب خروجی: `json`، `table`، `wide`     |
| `--no-color`            | غیرفعال کردن خروجی رنگی                 |
| `--help`                | نمایش راهنمای دستور                     |
| `--version`             | نمایش نسخه CLI                          |

## گرفتن راهنما

```bash
# General help
oneuptime --help

# Help for a specific command
oneuptime monitor --help
oneuptime monitor list --help
```
