# AI 代理人

OneUptime 中的 AI 代理人會自動修正程式碼中的錯誤、效能問題與資料庫查詢。AI 代理人以 OpenTelemetry 可觀測性資料為基礎，會建立包含修正內容的拉取請求（pull request），而不只是發出警示。

## AI 代理人能做什麼？

AI 代理人會分析您的可觀測性資料（追蹤、日誌與指標），以偵測並自動修正程式碼庫中的問題：

- **自動修正錯誤**：當 AI 代理人在您的追蹤或日誌中發現例外狀況時，會自動修正問題並建立拉取請求。
- **修正效能問題**：分析執行時間最長的追蹤，並建立包含效能最佳化的拉取請求。
- **修正資料庫查詢**：找出緩慢或低效的資料庫查詢，並透過適當的索引建立與查詢改寫來最佳化它們。
- **修正前端問題**：自動處理前端特有的效能問題、轉譯問題以及 JavaScript 錯誤。
- **自動加入遙測**：只需點擊一下，即可為您的程式碼庫加入追蹤、指標與日誌。無需手動進行檢測。
- **GitHub 與 GitLab 整合**：與您現有的儲存庫無縫整合。PR 會直接在您的工作流程中建立。
- **CI/CD 整合**：與您現有的 CI/CD 流水線整合。修正內容會在建立 PR 之前先經過測試與驗證。
- **Terraform 支援**：自動修正基礎架構問題。支援 Terraform 與 OpenTofu 進行基礎架構即程式碼（infrastructure-as-code）。
- **問題追蹤器整合**：可連接 Jira、Linear 以及其他問題追蹤器。自動將修正內容連結到相關的問題。

## 運作方式

1. **收集資料**：OpenTelemetry 從您的應用程式收集追蹤、日誌與指標
2. **偵測問題**：AI 找出錯誤、效能瓶頸與緩慢查詢
3. **產生修正**：AI 分析您的程式碼庫並自動建立修正內容
4. **建立 PR**：包含修正內容與詳細報告的拉取請求即可供審查

## LLM 供應商彈性

OneUptime 可搭配任何 LLM 供應商使用。您可以使用：

- **OpenAI GPT** 模型
- **Anthropic Claude** 模型
- **Meta Llama**（透過 Ollama 或其他供應商）
- **自訂自架（custom self-hosted）** 模型

自行託管您的 AI 模型，讓您的程式碼完全保持私密。

## 隱私

無論您使用哪種方案，OneUptime 都不會查看、儲存您的程式碼，也不會使用您的程式碼進行訓練：

- **無程式碼存取**：您的程式碼會保留在您的基礎架構上
- **無資料儲存**：零資料保留政策
- **不用於訓練**：您的程式碼絕不會被用於 AI 訓練

## 全域 AI 代理人 vs 自架 AI 代理人

### 全域 AI 代理人

如果您使用的是 **OneUptime SaaS**（雲端託管版本），全域 AI 代理人由 OneUptime 提供，已預先設定完成且可立即使用。這些代理人由 OneUptime 管理，無需額外設定。

除非在您的專案設定中停用，否則全域 AI 代理人會自動提供給所有專案使用。

### 自架 AI 代理人

對於需要在自有基礎架構內執行 AI 代理人的組織（例如基於安全性、合規性或網路存取需求），OneUptime 支援自架 AI 代理人。

自架 AI 代理人：
- 在您的私有網路內執行
- 可存取內部資源與系統
- 讓您完全掌控代理人的執行環境
- 可依您的特定需求進行客製化

## 設定自架 AI 代理人

### 步驟 1：在 OneUptime 中建立 AI 代理人

1. 登入您的 OneUptime 儀表板
2. 前往 **Project Settings** > **AI Agents**
3. 點擊 **Create AI Agent** 以新增代理人
4. 填寫必填欄位：
   - **Name**：為您的 AI 代理人取一個易記的名稱
   - **Description**（選填）：對代理人用途的描述
5. 建立後，您會收到 `AI_AGENT_ID` 與 `AI_AGENT_KEY`

**重要**：請妥善保存您的 `AI_AGENT_KEY`。它只會顯示一次，之後無法再取得。

### 步驟 2：部署 AI 代理人

#### Docker

若要執行 AI 代理人，請確認您已安裝 Docker。使用以下指令執行代理人：

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

如果您是自行託管 OneUptime，請將 `ONEUPTIME_URL` 變更為您自訂的自架執行個體 URL。

#### Docker Compose

您也可以使用 docker-compose 來執行 AI 代理人。建立一個 `docker-compose.yml` 檔案：

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

接著執行：

```bash
docker compose up -d
```

#### Kubernetes

建立一個 `oneuptime-ai-agent.yaml` 檔案：

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

套用此設定：

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### 環境變數

AI 代理人支援以下環境變數：

#### 必要變數

| 變數 | 說明 |
|----------|-------------|
| `AI_AGENT_KEY` | 來自您 OneUptime 儀表板的 AI 代理人金鑰 |
| `AI_AGENT_ID` | 來自您 OneUptime 儀表板的 AI 代理人 ID |
| `ONEUPTIME_URL` | 您 OneUptime 執行個體的 URL（預設值：https://oneuptime.com） |


## 驗證您的 AI 代理人

部署 AI 代理人之後：

1. 在您的 OneUptime 儀表板中前往 **Project Settings** > **AI Agents**
2. 您的代理人應在幾分鐘內顯示為 **Connected**
3. 如果狀態顯示為 **Disconnected**，請檢查容器日誌是否有錯誤

若要查看容器日誌：

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## 疑難排解

### 代理人無法連線

1. **驗證憑證**：確認 `AI_AGENT_KEY` 與 `AI_AGENT_ID` 正確無誤
2. **檢查網路**：確認代理人能夠連線到您的 OneUptime 執行個體
3. **檢視日誌**：檢查容器日誌中的錯誤訊息
4. **防火牆規則**：確認允許對外的 HTTPS（連接埠 443）

### 代理人持續中斷連線

1. **檢查資源限制**：確認容器具有足夠的記憶體與 CPU
2. **網路穩定性**：確認網路連線穩定
3. **檢視日誌**：在日誌中尋找逾時或連線錯誤

## 需要協助嗎？

如果您在使用 AI 代理人時遇到問題：

1. 查看 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) 中已知的問題
2. 如果您的問題尚未被回報，請建立一個新的 issue
3. 如果您使用的是企業方案，請聯絡 [support](https://oneuptime.com/support)
