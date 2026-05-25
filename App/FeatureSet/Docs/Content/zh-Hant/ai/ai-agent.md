# AI 代理

OneUptime 中的 AI 代理可自動修復您代碼中的錯誤、性能問題和數據庫查詢。基於 OpenTelemetry 可觀測性數據，AI 代理會創建包含修復方案的 Pull Request，而不僅僅是發送警報。

## AI 代理能做什麼？

AI 代理分析您的可觀測性數據（追蹤、日誌和指標），以檢測並自動修復代碼庫中的問題：

- **自動修復錯誤**：當 AI 代理在追蹤或日誌中發現異常時，會自動修復問題並創建 Pull Request。
- **修復性能問題**：分析執行時間最長的追蹤，並創建包含性能優化的 Pull Request。
- **修復數據庫查詢**：識別慢速或低效的數據庫查詢，並通過適當的索引和查詢重寫進行優化。
- **修復前端問題**：自動處理前端特有的性能問題、渲染問題和 JavaScript 錯誤。
- **自動添加遙測數據**：只需單擊即可向代碼庫添加追蹤、指標和日誌。無需手動埋點。
- **GitHub 和 GitLab 集成**：與您現有的代碼倉庫無縫集成。Pull Request 直接在您的工作流中創建。
- **CI/CD 集成**：與您現有的 CI/CD 流水線集成。修復在創建 PR 之前會經過測試和驗證。
- **Terraform 支持**：自動修復基礎設施問題。支持 Terraform 和 OpenTofu 進行基礎設施即代碼管理。
- **問題跟蹤器集成**：與 Jira、Linear 等問題跟蹤器連接。自動將修復關聯到相關問題。

## 工作原理

1. **收集數據**：OpenTelemetry 從您的應用程序收集追蹤、日誌和指標
2. **檢測問題**：AI 識別錯誤、性能瓶頸和慢速查詢
3. **生成修復**：AI 分析您的代碼庫並自動創建修復方案
4. **創建 PR**：包含修復和詳細報告的 Pull Request 準備好供審查

## LLM 提供商靈活性

OneUptime 支持任意 LLM 提供商。您可以使用：

- **OpenAI GPT** 模型
- **Anthropic Claude** 模型
- **Meta Llama**（通過 Ollama 或其他提供商）
- **自定義自託管**模型

自託管您的 AI 模型，讓您的代碼完全保持私密。

## 隱私

無論您使用哪種方案，OneUptime 都不會查看、儲存或用您的代碼進行訓練：

- **不訪問代碼**：您的代碼保留在您的基礎設施上
- **不儲存數據**：零數據保留策略
- **不用於訓練**：您的代碼永遠不會用於 AI 訓練

## 全局 AI 代理與自託管 AI 代理

### 全局 AI 代理

如果您使用 **OneUptime SaaS**（雲託管版本），全局 AI 代理由 OneUptime 提供，已預先配置並可直接使用。這些代理由 OneUptime 管理，無需額外設置。

全局 AI 代理默認對所有項目可用，除非在項目設置中禁用。

### 自託管 AI 代理

對於需要在自己基礎設施內運行 AI 代理的組織（例如出於安全、合規或網絡訪問要求），OneUptime 支持自託管 AI 代理。

自託管 AI 代理：
- 在您的私有網絡內運行
- 可訪問內部資源和系統
- 讓您完全控制代理的環境
- 可根據您的特定需求進行定製

## 設置自託管 AI 代理

### 第一步：在 OneUptime 中創建 AI 代理

1. 登錄您的 OneUptime 控制台
2. 前往 **項目設置** > **AI 代理**
3. 點擊 **創建 AI 代理** 以添加新代理
4. 填寫必填字段：
   - **名稱**：您的 AI 代理的友好名稱
   - **描述**（可選）：代理用途的描述
5. 創建後，您將獲得 `AI_AGENT_ID` 和 `AI_AGENT_KEY`

**重要提示**：請妥善保存您的 `AI_AGENT_KEY`。它只會顯示一次，之後無法找回。

### 第二步：部署 AI 代理

#### Docker

要運行 AI 代理，請確保已安裝 Docker。使用以下命令運行代理：

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

如果您是自託管 OneUptime，請將 `ONEUPTIME_URL` 更改爲您自定義的自託管實例 URL。

#### Docker Compose

您也可以使用 docker-compose 運行 AI 代理。創建一個 `docker-compose.yml` 文件：

```yaml
version: "3"

services:
  oneuptime-ai-agent:
    image: oneuptime/ai-agent:release
    container_name: oneuptime-ai-agent
    environment:
      - AI_AGENT_KEY=<ai-agent-key>
      - AI_AGENT_ID=<ai-agent-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

然後運行：

```bash
docker compose up -d
```

#### Kubernetes

創建一個 `oneuptime-ai-agent.yaml` 文件：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-ai-agent
spec:
  selector:
    matchLabels:
      app: oneuptime-ai-agent
  template:
    metadata:
      labels:
        app: oneuptime-ai-agent
    spec:
      containers:
      - name: oneuptime-ai-agent
        image: oneuptime/ai-agent:release
        env:
          - name: AI_AGENT_KEY
            value: "<ai-agent-key>"
          - name: AI_AGENT_ID
            value: "<ai-agent-id>"
          - name: ONEUPTIME_URL
            value: "https://oneuptime.com"
```

應用配置：

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### 環境變量

AI 代理支持以下環境變量：

#### 必填變量

| 變量 | 描述 |
|------|------|
| `AI_AGENT_KEY` | 來自您 OneUptime 控制台的 AI 代理密鑰 |
| `AI_AGENT_ID` | 來自您 OneUptime 控制台的 AI 代理 ID |
| `ONEUPTIME_URL` | 您的 OneUptime 實例 URL（默認：https://oneuptime.com） |


## 驗證您的 AI 代理

部署 AI 代理後：

1. 在您的 OneUptime 控制台中，前往 **項目設置** > **AI 代理**
2. 您的代理應在幾分鐘內顯示爲 **已連接**
3. 如果狀態顯示爲 **已斷開連接**，請檢查容器日誌以獲取錯誤信息

查看容器日誌：

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## 故障排查

### 代理無法連接

1. **驗證憑據**：確保 `AI_AGENT_KEY` 和 `AI_AGENT_ID` 正確
2. **檢查網絡**：確保代理能夠訪問您的 OneUptime 實例
3. **查看日誌**：檢查容器日誌中的錯誤信息
4. **防火牆規則**：確保允許出站 HTTPS（端口 443）流量

### 代理持續斷開連接

1. **檢查資源限制**：確保容器有足夠的內存和 CPU
2. **網絡穩定性**：驗證網絡連接是否穩定
3. **查看日誌**：在日誌中查找超時或連接錯誤

## 需要幫助？

如果您在使用 AI 代理時遇到問題：

1. 查看 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) 瞭解已知問題
2. 如果您的問題尚未被報告，請創建新 Issue
3. 如果您是企業計劃用戶，請聯繫[支持團隊](https://oneuptime.com/support)
