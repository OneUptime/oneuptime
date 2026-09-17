# 指令稿撰寫與 CI/CD

OneUptime CLI 是為了自動化而設計的。它支援以環境變數為基礎的驗證、用於程式化解析的 JSON 輸出，以及適合管線整合的對應結束代碼。

## 環境變數

設定這些環境變數即可在沒有已儲存內容環境的情況下進行驗證：

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

這些變數的優先順序高於已儲存的內容環境，但會被 CLI 旗標覆寫。

## 結束代碼

| 代碼 | 意義                         |
| ---- | ---------------------------- |
| `0`  | 成功                         |
| `1`  | 一般錯誤                     |
| `2`  | 驗證錯誤（缺少或無效的憑證） |
| `3`  | 找不到（404）                |

在指令稿中使用結束代碼來處理錯誤：

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## 使用 jq 處理 JSON

使用 `-o json` 來產生機器可讀的輸出：

```bash
# Extract all incident titles
oneuptime incident list -o json | jq '.[].title'

# Get the ID of a newly created monitor
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# Count incidents by severity
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## 從檔案建立資源

使用 `--file` 從 JSON 檔案建立資源，這對於受版本控管的基礎架構很有用：

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## 批次作業

在迴圈中處理多個資源：

```bash
# Create multiple monitors from a JSON array file
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## CI/CD 管線範例

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

### 通用 CI/CD 指令稿

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

## 在指令稿中使用特定的內容環境

如果您儲存了多個內容環境，可以指定其中一個：

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
