# عملیات روی منابع

CLI مربوط به OneUptime عملیات کامل CRUD (ساخت، خواندن، به‌روزرسانی، حذف) را برای همه منابع پشتیبانی‌شده فراهم می‌کند. منابع به‌صورت خودکار از نمونه OneUptime شما کشف می‌شوند.

## منابع در دسترس

برای دیدن همه نوع‌های منبع در دسترس، این دستور را اجرا کنید:

```bash
oneuptime resources
```

می‌توانید بر اساس نوع فیلتر کنید:

```bash
# Show only database resources
oneuptime resources --type database

# Show only analytics resources
oneuptime resources --type analytics
```

منابع رایج:

| منبع                          | دستور                                   |
| ----------------------------- | --------------------------------------- |
| حادثه                         | `oneuptime incident`                    |
| هشدار                         | `oneuptime alert`                       |
| مانیتور                       | `oneuptime monitor`                     |
| وضعیت مانیتور                 | `oneuptime monitor-status`              |
| وضعیت حادثه                   | `oneuptime incident-state`              |
| صفحه وضعیت                    | `oneuptime status-page`                 |
| سیاست آنکال                   | `oneuptime on-call-policy`              |
| تیم                           | `oneuptime team`                        |
| رویداد تعمیر و نگهداری زمان‌بندی‌شده | `oneuptime scheduled-maintenance-event` |

## فهرست کردن منابع

فهرستی از منابع را با فیلتر، صفحه‌بندی و مرتب‌سازی اختیاری دریافت کنید.

```bash
oneuptime <resource> list [options]
```

**گزینه‌ها:**

| گزینه                   | توضیحات                   | پیش‌فرض |
| ----------------------- | ------------------------- | ------- |
| `--query <json>`        | معیار فیلتر به‌صورت JSON  | ندارد   |
| `--limit <n>`           | بیشینه تعداد نتایج        | `10`    |
| `--skip <n>`            | تعداد نتایجی که رد شوند   | `0`     |
| `--sort <json>`         | ترتیب مرتب‌سازی به‌صورت JSON | ندارد   |
| `-o, --output <format>` | قالب خروجی                | `table` |

**نمونه‌ها:**

```bash
# List the 10 most recent incidents
oneuptime incident list

# Filter incidents by state ID
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# List with pagination
oneuptime incident list --limit 20 --skip 40

# Sort by creation date (descending)
oneuptime incident list --sort '{"createdAt":-1}'

# Output as JSON
oneuptime incident list -o json
```

## دریافت یک منبع

یک منبع را با شناسه‌اش دریافت کنید.

```bash
oneuptime <resource> get <id>
```

**آرگومان‌ها:**

| آرگومان  | توضیحات                 |
| -------- | ----------------------- |
| `<id>`   | شناسه منبع (UUID)       |

**نمونه‌ها:**

```bash
# Get a specific incident
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Get a monitor as JSON
oneuptime monitor get abc-123 -o json
```

## ساخت یک منبع

یک منبع جدید از روی JSON درون‌خطی یا یک فایل بسازید.

```bash
oneuptime <resource> create [options]
```

**گزینه‌ها:**

| گزینه                   | توضیحات                                        |
| ----------------------- | ---------------------------------------------- |
| `--data <json>`         | داده منبع به‌صورت یک شیء JSON                  |
| `--file <path>`         | مسیر یک فایل JSON که داده منبع را دارد         |
| `-o, --output <format>` | قالب خروجی                                     |

باید یکی از `--data` یا `--file` را بدهید.

**نمونه‌ها:**

```bash
# Create an incident with inline JSON
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Create from a JSON file
oneuptime incident create --file incident.json

# Create and output as JSON to capture the ID
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## به‌روزرسانی یک منبع

یک منبع موجود را با شناسه به‌روزرسانی کنید.

```bash
oneuptime <resource> update <id> [options]
```

**آرگومان‌ها:**

| آرگومان  | توضیحات      |
| -------- | ------------ |
| `<id>`   | شناسه منبع   |

**گزینه‌ها:**

| گزینه                   | توضیحات                                |
| ----------------------- | -------------------------------------- |
| `--data <json>`         | فیلدهایی که باید به‌روز شوند به‌صورت JSON (الزامی) |
| `-o, --output <format>` | قالب خروجی                             |

**نمونه‌ها:**

```bash
# Change incident state (e.g., to resolved)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Rename a monitor
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## حذف یک منبع

یک منبع را با شناسه حذف کنید.

```bash
oneuptime <resource> delete <id> [--force]
```

**آرگومان‌ها:**

| آرگومان  | توضیحات      |
| -------- | ------------ |
| `<id>`   | شناسه منبع   |

**گزینه‌ها:**

| گزینه     | توضیحات                    |
| --------- | -------------------------- |
| `--force` | رد کردن درخواست تأیید      |

**نمونه‌ها:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Skip confirmation
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## شمارش منابع

منابع منطبق با معیار فیلتر اختیاری را بشمارید.

```bash
oneuptime <resource> count [options]
```

**گزینه‌ها:**

| گزینه            | توضیحات                   |
| ---------------- | ------------------------- |
| `--query <json>` | معیار فیلتر به‌صورت JSON  |

**نمونه‌ها:**

```bash
# Count all incidents
oneuptime incident count

# Count incidents by state
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Count monitors
oneuptime monitor count
```

## منابع تحلیلی

منابع تحلیلی در مقایسه با منابع پایگاه داده از مجموعه محدودتری از عملیات پشتیبانی می‌کنند:

| عملیات    | پشتیبانی می‌شود |
| --------- | --------------- |
| `list`    | بله             |
| `create`  | بله             |
| `count`   | بله             |
| `get`     | خیر             |
| `update`  | خیر             |
| `delete`  | خیر             |

برای دیدن اینکه چه منابع تحلیلی روی نمونه شما در دسترس است از `oneuptime resources --type analytics` استفاده کنید.
