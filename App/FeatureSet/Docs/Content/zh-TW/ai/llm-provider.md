# LLM 供應商

OneUptime 支援整合各種大型語言模型（LLM）供應商，以在整個平台中啟用 AI 驅動的功能。本指南將協助您設定您自己的 LLM 供應商。

## LLM 供應商可以做什麼？

OneUptime 中的 LLM 供應商可協助您自動化並強化事件管理工作流程：

- **事件備註**：自動產生詳細的事件備註與更新
- **警示備註**：建立有意義的警示描述與背景資訊
- **排程維護備註**：自動產生維護事件備註
- **事件事後檢討**：自動草擬完整的事件事後檢討報告
- **程式碼改進**：如果您將程式碼儲存庫連接到 OneUptime，我們將使用您的 LLM 供應商來分析遙測資料（記錄檔、追蹤、指標、例外狀況）並建議程式碼改進

## OneUptime SaaS 使用者

如果您使用的是 **OneUptime SaaS**（雲端託管版本），預設情況下您可以使用 **Global LLM Provider**，無需任何額外設定。Global LLM Provider 已預先設定完成，可供所有 AI 功能使用。

如果您偏好使用自己的 API 金鑰或特定供應商，您仍然可以依照以下說明設定自訂的 LLM 供應商。

## 支援的供應商

OneUptime 目前支援以下 LLM 供應商：

| 供應商        | 描述                                                              | 需要 API 金鑰 | 需要 Base URL    |
| ------------- | ----------------------------------------------------------------- | ------------- | ---------------- |
| **OpenAI**    | GPT-4、GPT-4o、GPT-3.5 Turbo 及其他 OpenAI 模型                   | 是            | 否（使用預設值） |
| **Anthropic** | Claude 3 Opus、Claude 3 Sonnet、Claude 3 Haiku 及其他 Claude 模型 | 是            | 否（使用預設值） |
| **Ollama**    | 自行託管的開源模型，例如 Llama 2、Mistral、CodeLlama 等           | 否            | 是               |

## 設定 LLM 供應商

### 步驟 1：前往 LLM Providers 設定

1. 登入您的 OneUptime 儀表板
2. 前往 **AI Agents** > **LLM Providers**
3. 點選 **Create LLM Provider** 以新增供應商

### 步驟 2：設定您的供應商

填寫以下欄位：

- **Name**：此 LLM 設定的易記名稱（例如「Production OpenAI」、「Local Ollama」）
- **Description**（選填）：協助識別此供應商用途的描述
- **LLM Type**：選擇供應商類型（OpenAI、Anthropic 或 Ollama）
- **API Key**：您的 API 金鑰（OpenAI 與 Anthropic 為必填）
- **Model Name**：要使用的特定模型（例如 `gpt-4o`、`claude-3-opus-20240229`、`llama2`）
- **Base URL**（選填）：自訂 API 端點 URL（Ollama 為必填，其他則為選填）

## 各供應商專屬設定

### OpenAI

1. 從 [OpenAI Platform](https://platform.openai.com/api-keys) 取得您的 API 金鑰
2. 選擇 **OpenAI** 作為 LLM Type
3. 輸入您的 API 金鑰
4. 選擇模型名稱：
   - `gpt-4o` - 能力最強的模型，最適合複雜任務
   - `gpt-4o-mini` - 更快速且更具成本效益
   - `gpt-4-turbo` - 能力與速度的良好平衡
   - `gpt-3.5-turbo` - 快速且經濟實惠

**範例設定：**

```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. 從 [Anthropic Console](https://console.anthropic.com/) 取得您的 API 金鑰
2. 選擇 **Anthropic** 作為 LLM Type
3. 輸入您的 API 金鑰
4. 選擇模型名稱：
   - `claude-3-opus-20240229` - 能力最強的模型
   - `claude-3-sonnet-20240229` - 智慧與速度的良好平衡
   - `claude-3-haiku-20240307` - 最快速且最精簡
   - `claude-3-5-sonnet-20241022` - 最新的 Sonnet 模型

**範例設定：**

```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama（自行託管）

Ollama 讓您可以在本機或您自己的基礎設施上執行開源 LLM。

1. 從 [ollama.ai](https://ollama.ai) 安裝 Ollama
2. 拉取您想要的模型：`ollama pull llama2`
3. 確保 Ollama 正在執行且可供存取
4. 選擇 **Ollama** 作為 LLM Type
5. 輸入 Base URL（例如 `http://localhost:11434`）
6. 輸入您所拉取的模型名稱

**範例設定：**

```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**熱門的 Ollama 模型：**

- `llama2` - Meta 的 Llama 2 模型
- `llama3` - Meta 的 Llama 3 模型
- `mistral` - Mistral AI 的模型
- `codellama` - 程式碼專用的 Llama 模型
- `mixtral` - Mistral 的混合專家模型

## 使用自訂 Base URL

對於企業部署或使用代理服務時，您可以指定自訂的 Base URL：

- **Azure OpenAI**：使用您的 Azure 端點 URL
- **OpenAI 相容 API**：任何遵循 OpenAI API 規範的 API
- **私有 Ollama 執行個體**：您的內部 Ollama 伺服器 URL

## 最佳實務

1. **使用具描述性的名稱**：清楚地為您的供應商命名（例如「Production GPT-4」、「Development Ollama」）
2. **保護您的 API 金鑰**：API 金鑰在靜態時會加密，但請避免分享它們
3. **測試您的設定**：設定完成後，請驗證供應商能與 AI 功能正常運作
4. **監控使用量**：持續追蹤 API 使用量以管理成本

## 疑難排解

### 連線問題

- **OpenAI/Anthropic**：請確認您的 API 金鑰有效且有足夠的額度
- **Ollama**：請確保 Ollama 伺服器正在執行且 Base URL 正確
- **防火牆**：請檢查您的網路是否允許對外連線至供應商的 API

### 找不到模型

- 請確認模型名稱拼寫正確
- 對於 Ollama，請確保您已使用 `ollama pull <model-name>` 拉取該模型
- 請檢查該模型在您的所在地區是否可用（部分模型有地區限制）

## 需要協助嗎？

如果您在設定 LLM 供應商時遇到問題，請：

1. 查看 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) 以了解已知問題
2. 如果您使用的是企業方案，請聯絡支援團隊
