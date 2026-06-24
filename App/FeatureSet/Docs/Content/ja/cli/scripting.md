# スクリプティングと CI/CD

OneUptime CLI は自動化向けに設計されています。環境変数ベースの認証、プログラムによる解析のための JSON 出力、パイプライン統合のための適切な終了コードをサポートしています。

## 環境変数

保存されたコンテキストなしで認証するには、以下の環境変数を設定します。

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

これらは保存されたコンテキストよりも優先されますが、CLI フラグで上書きできます。

## 終了コード

| コード | 意味                                   |
| ------ | -------------------------------------- |
| `0`    | 成功                                   |
| `1`    | 一般的なエラー                         |
| `2`    | 認証エラー（認証情報が欠落または無効） |
| `3`    | 見つからない（404）                    |

スクリプトでエラーを処理するために終了コードを使用します。

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## jq を使用した JSON 処理

機械可読な出力を生成するために `-o json` を使用します。

```bash
# すべてのインシデントタイトルを抽出
oneuptime incident list -o json | jq '.[].title'

# 新しく作成したモニターの ID を取得
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# 重大度別にインシデントをカウント
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## ファイルからリソースを作成する

バージョン管理されたインフラに役立てるため、JSON ファイルからリソースを作成するには `--file` を使用します。

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## バッチ操作

ループで複数のリソースを処理します。

```bash
# JSON 配列ファイルから複数のモニターを作成
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## CI/CD パイプラインの例

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

### 汎用 CI/CD スクリプト

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# デプロイインシデントを作成して ID を取得
# 注意: currentIncidentStateId と incidentSeverityId はプロジェクト内の既存の状態/重大度 ID を参照する必要があります
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# ここにデプロイステップを実行...

# デプロイ成功後にインシデントを解決
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

## スクリプトでの特定コンテキストの使用

複数のコンテキストが保存されている場合、特定のコンテキストを指定します。

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
