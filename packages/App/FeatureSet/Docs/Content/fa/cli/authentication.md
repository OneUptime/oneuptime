# احراز هویت

CLI مربوط به OneUptime چند راه برای احراز هویت با نمونه OneUptime شما دارد. می‌توانید از بافتارهای نام‌گذاری‌شده، متغیرهای محیطی، یا دادن مستقیم اعتبارنامه‌ها به‌صورت پرچم استفاده کنید.

## ورود

با یک کلید API به نمونه OneUptime خود وارد شوید:

```bash
oneuptime login <api-key> <instance-url>
```

**آرگومان‌ها:**

| آرگومان          | توضیحات                                                      |
| ---------------- | ------------------------------------------------------------ |
| `<api-key>`      | کلید API شما در OneUptime (برای نمونه `sk-your-api-key`)     |
| `<instance-url>` | نشانی نمونه OneUptime شما (برای نمونه `https://oneuptime.com`) |

**گزینه‌ها:**

| گزینه                   | توضیحات                                       |
| ----------------------- | --------------------------------------------- |
| `--context-name <name>` | نام این بافتار (پیش‌فرض: `"default"`)         |

**نمونه‌ها:**

```bash
# Login with default context
oneuptime login sk-abc123 https://oneuptime.com

# Login with a named context
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Set up multiple environments
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## بافتارها

بافتارها به شما امکان می‌دهند چند محیط OneUptime (برای نمونه عملیاتی، آزمایشی، توسعه) را ذخیره کنید و بین آن‌ها جابه‌جا شوید.

### فهرست بافتارها

```bash
oneuptime context list
```

همه بافتارهای پیکربندی‌شده را نمایش می‌دهد. بافتار فعلی با `*` نشانه‌گذاری می‌شود.

### تعویض بافتار

```bash
oneuptime context use <name>
```

برای همه دستورهای بعدی به یک بافتار نام‌گذاری‌شده دیگر بروید.

```bash
# Switch to staging
oneuptime context use staging

# Switch to production
oneuptime context use production
```

### مشاهده بافتار فعلی

```bash
oneuptime context current
```

بافتار فعال فعلی را همراه با نشانی نمونه و کلید API پوشانده‌شده نمایش می‌دهد.

### حذف یک بافتار

```bash
oneuptime context delete <name>
```

یک بافتار نام‌گذاری‌شده را حذف می‌کند. اگر بافتار حذف‌شده همان بافتار فعلی باشد، CLI به‌صورت خودکار به اولین بافتار باقی‌مانده می‌رود.

## تشخیص اعتبارنامه‌ها

اعتبارنامه‌ها به این ترتیب اولویت تشخیص داده می‌شوند:

1. **پرچم‌های CLI** (`--api-key` و `--url`)
2. **متغیرهای محیطی** (`ONEUPTIME_API_KEY` و `ONEUPTIME_URL`)
3. **بافتار نام‌گذاری‌شده** (از طریق پرچم `--context`)
4. **بافتار فعلی** (از پیکربندی ذخیره‌شده)

می‌توانید منابع را ترکیب کنید — برای نمونه، برای کلید API از متغیر محیطی و برای نشانی از یک بافتار ذخیره‌شده استفاده کنید.

### استفاده از پرچم‌های CLI

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### استفاده از متغیرهای محیطی

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### استفاده از یک بافتار مشخص

```bash
oneuptime --context production incident list
```

## راستی‌آزمایی احراز هویت

وضعیت احراز هویت فعلی خود را بررسی کنید:

```bash
oneuptime whoami
```

این‌ها را نمایش می‌دهد:

- نشانی نمونه
- کلید API پوشانده‌شده
- نام بافتار فعلی (فقط اگر بافتار ذخیره‌شده‌ای فعال باشد)

اگر احراز هویت نشده باشید، دستور پیامی راهنما نشان می‌دهد و اجرای `oneuptime login` را پیشنهاد می‌کند.

## فایل پیکربندی

اعتبارنامه‌ها در `~/.oneuptime/config.json` با دسترسی محدود (`0600`) ذخیره می‌شوند.

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
