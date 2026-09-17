# اسکریپت‌نویسی و CI/CD

CLI مربوط به OneUptime برای خودکارسازی طراحی شده است. از احراز هویت مبتنی بر متغیر محیطی، خروجی JSON برای تجزیه برنامه‌نویسی‌شده، و کدهای خروج مناسب برای یکپارچه‌سازی با خط لوله پشتیبانی می‌کند.

## متغیرهای محیطی

این متغیرهای محیطی را تنظیم کنید تا بدون بافتار ذخیره‌شده احراز هویت کنید:

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

این‌ها بر بافتارهای ذخیره‌شده اولویت دارند اما پرچم‌های CLI بر آن‌ها اولویت دارند.

## کدهای خروج

| کد   | معنا                                                    |
| ---- | ------------------------------------------------------- |
| `0`  | موفق                                                    |
| `1`  | خطای عمومی                                              |
| `2`  | خطای احراز هویت (اعتبارنامه جا افتاده یا نامعتبر)       |
| `3`  | یافت نشد (۴۰۴)                                          |

از کدهای خروج در اسکریپت‌ها برای مدیریت خطا استفاده کنید:

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## پردازش JSON با jq

از `-o json` برای تولید خروجی قابل خواندن توسط ماشین استفاده کنید:

```bash
# Extract all incident titles
oneuptime incident list -o json | jq '.[].title'

# Get the ID of a newly created monitor
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# Count incidents by severity
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## ساخت منابع از روی فایل

از `--file` برای ساخت منابع از فایل‌های JSON استفاده کنید؛ برای زیرساخت تحت کنترل نسخه مفید است:

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## عملیات گروهی

چند منبع را در یک حلقه پردازش کنید:

```bash
# Create multiple monitors from a JSON array file
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## نمونه‌های خط لوله CI/CD

### GitHub Actions

```yaml
name: Check Active Incidents
on:
  schedule:
    - cron: "*/5 * * * *"

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Install OneUptime CLI
        run: npm install -g @oneuptime/cli

      - name: Check for active incidents
        env:
          ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
          ONEUPTIME_URL: https://oneuptime.com
        run: |
          INCIDENT_COUNT=$(oneuptime incident count)
          if [ "$INCIDENT_COUNT" -gt 0 ]; then
            echo "WARNING: $INCIDENT_COUNT incidents found"
            exit 1
          fi
```

### اسکریپت عمومی CI/CD

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# Create a deployment incident and capture the ID
# Note: currentIncidentStateId and incidentSeverityId must reference existing state/severity IDs in your project
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# Run deployment steps here...

# Resolve the incident after successful deployment
oneuptime incident update "$INCIDENT_ID" --data '{"currentIncidentStateId":"'"$RESOLVED_STATE_ID"'"}'
```

### Docker

```dockerfile
FROM node:26-slim
RUN npm install -g @oneuptime/cli
ENV ONEUPTIME_API_KEY=""
ENV ONEUPTIME_URL=""
ENTRYPOINT ["oneuptime"]
```

```bash
docker run --rm \
  -e ONEUPTIME_API_KEY=sk-abc123 \
  -e ONEUPTIME_URL=https://oneuptime.com \
  oneuptime-cli incident list
```

## استفاده از یک بافتار مشخص در اسکریپت‌ها

اگر چند بافتار ذخیره‌شده دارید، یکی را مشخص کنید:

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
