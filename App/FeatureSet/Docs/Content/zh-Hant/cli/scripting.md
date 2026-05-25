# 腳本與 CI/CD

OneUptime CLI 專爲自動化而設計。它支持基於環境變量的認證、用於程序化解析的 JSON 輸出，以及適合流水線集成的退出碼。

## 環境變量

設置以下環境變量，無需保存上下文即可進行認證：

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

這些變量優先於已保存的上下文，但會被 CLI 標誌覆蓋。

## 退出碼

| 代碼 | 含義 |
|------|------|
| `0` | 成功 |
| `1` | 通用錯誤 |
| `2` | 認證錯誤（憑據缺失或無效） |
| `3` | 未找到（404） |

在腳本中使用退出碼處理錯誤：

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## 使用 jq 處理 JSON

使用 `-o json` 生成機器可讀的輸出：

```bash
# 提取所有事件標題
oneuptime incident list -o json | jq '.[].title'

# 獲取新創建監控器的 ID
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# 按嚴重程度統計事件
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## 從文件創建資源

使用 `--file` 從 JSON 文件創建資源，適用於版本控制的基礎設施：

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## 批量操作

在循環中處理多個資源：

```bash
# 從 JSON 數組文件創建多個監控器
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## CI/CD 流水線示例

### GitHub Actions

```yaml
name: Check Active Incidents
on:
  schedule:
    - cron: '*/5 * * * *'

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

### 通用 CI/CD 腳本

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# 創建部署事件並捕獲 ID
# 注意：currentIncidentStateId 和 incidentSeverityId 必須引用您項目中已存在的狀態/嚴重程度 ID
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# 在此處運行部署步驟...

# 成功部署後解決事件
oneuptime incident update "$INCIDENT_ID" --data '{"currentIncidentStateId":"'"$RESOLVED_STATE_ID"'"}'
```

### Docker

```dockerfile
FROM node:20-slim
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

## 在腳本中使用特定上下文

如果您保存了多個上下文，可以針對特定上下文：

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
