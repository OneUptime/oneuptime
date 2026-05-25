# LLM 提供商

OneUptime 支持與各種大型語言模型（LLM）提供商集成，以在整個平臺中啓用 AI 功能。本指南將幫助您配置自己的 LLM 提供商。

## LLM 提供商能做什麼？

OneUptime 中的 LLM 提供商可幫助您自動化並增強事件管理工作流：

- **事件備註**：自動生成詳細的事件備註和更新
- **警報備註**：創建有意義的警報描述和上下文信息
- **計劃維護備註**：自動生成維護事件備註
- **事件事後分析**：自動起草全面的事件事後分析報告
- **代碼改進**：如果您將代碼倉庫連接到 OneUptime，我們將使用您的 LLM 提供商分析遙測數據（日誌、追蹤、指標、異常）並提出代碼改進建議

## OneUptime SaaS 用戶

如果您使用 **OneUptime SaaS**（雲託管版本），默認情況下無需任何額外配置即可使用**全局 LLM 提供商**。全局 LLM 提供商已預先配置好，可用於所有 AI 功能。

如果您希望使用自己的 API 密鑰或特定提供商，仍可按照以下說明配置自定義 LLM 提供商。

## 支持的提供商

OneUptime 目前支持以下 LLM 提供商：

| 提供商 | 描述 | 是否需要 API 密鑰 | 是否需要基礎 URL |
|--------|------|------------------|-----------------|
| **OpenAI** | GPT-4、GPT-4o、GPT-3.5 Turbo 及其他 OpenAI 模型 | 是 | 否（使用默認值） |
| **Anthropic** | Claude 3 Opus、Claude 3 Sonnet、Claude 3 Haiku 及其他 Claude 模型 | 是 | 否（使用默認值） |
| **Ollama** | 自託管開源模型，如 Llama 2、Mistral、CodeLlama 等 | 否 | 是 |

## 設置 LLM 提供商

### 第一步：導航至 LLM 提供商設置

1. 登錄您的 OneUptime 控制台
2. 前往 **項目設置** > **AI** > **LLM 提供商**
3. 點擊 **創建 LLM 提供商** 以添加新提供商

### 第二步：配置您的提供商

填寫以下字段：

- **名稱**：此 LLM 配置的友好名稱（例如"生產 OpenAI"、"本地 Ollama"）
- **描述**（可選）：幫助標識此提供商用途的描述
- **LLM 類型**：選擇提供商類型（OpenAI、Anthropic 或 Ollama）
- **API 密鑰**：您的 API 密鑰（OpenAI 和 Anthropic 必填）
- **模型名稱**：要使用的具體模型（例如 `gpt-4o`、`claude-3-opus-20240229`、`llama2`）
- **基礎 URL**（可選）：自定義 API 端點 URL（Ollama 必填，其他可選）

## 各提供商的具體配置

### OpenAI

1. 從 [OpenAI Platform](https://platform.openai.com/api-keys) 獲取您的 API 密鑰
2. 選擇 **OpenAI** 作爲 LLM 類型
3. 輸入您的 API 密鑰
4. 選擇模型名稱：
   - `gpt-4o` - 能力最強的模型，適合複雜任務
   - `gpt-4o-mini` - 更快且更具成本效益
   - `gpt-4-turbo` - 能力與速度的良好平衡
   - `gpt-3.5-turbo` - 快速且經濟實惠

**示例配置：**
```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. 從 [Anthropic Console](https://console.anthropic.com/) 獲取您的 API 密鑰
2. 選擇 **Anthropic** 作爲 LLM 類型
3. 輸入您的 API 密鑰
4. 選擇模型名稱：
   - `claude-3-opus-20240229` - 能力最強的模型
   - `claude-3-sonnet-20240229` - 智能與速度的良好平衡
   - `claude-3-haiku-20240307` - 最快且最緊湊
   - `claude-3-5-sonnet-20241022` - 最新的 Sonnet 模型

**示例配置：**
```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama（自託管）

Ollama 允許您在本地或自己的基礎設施上運行開源 LLM。

1. 從 [ollama.ai](https://ollama.ai) 安裝 Ollama
2. 拉取所需的模型：`ollama pull llama2`
3. 確保 Ollama 正在運行且可訪問
4. 選擇 **Ollama** 作爲 LLM 類型
5. 輸入基礎 URL（例如 `http://localhost:11434`）
6. 輸入您拉取的模型名稱

**示例配置：**
```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**常用 Ollama 模型：**
- `llama2` - Meta 的 Llama 2 模型
- `llama3` - Meta 的 Llama 3 模型
- `mistral` - Mistral AI 的模型
- `codellama` - 專注於代碼的 Llama 模型
- `mixtral` - Mistral 的混合專家模型

## 使用自定義基礎 URL

對於企業部署或使用代理服務時，您可以指定自定義基礎 URL：

- **Azure OpenAI**：使用您的 Azure 端點 URL
- **兼容 OpenAI 的 API**：任何遵循 OpenAI API 規範的 API
- **私有 Ollama 實例**：您的內部 Ollama 服務器 URL

## 最佳實踐

1. **使用描述性名稱**：清晰地命名您的提供商（例如"生產 GPT-4"、"開發 Ollama"）
2. **保護您的 API 密鑰**：API 密鑰在靜態儲存時已加密，但避免共享它們
3. **測試您的配置**：設置完成後，驗證提供商是否能正常用於 AI 功能
4. **監控使用情況**：跟蹤 API 使用情況以管理成本

## 故障排查

### 連接問題

- **OpenAI/Anthropic**：驗證您的 API 密鑰有效且有足夠的額度
- **Ollama**：確保 Ollama 服務器正在運行且基礎 URL 正確
- **防火牆**：檢查您的網絡是否允許出站連接到提供商的 API

### 找不到模型

- 驗證模型名稱拼寫是否正確
- 對於 Ollama，確保已使用 `ollama pull <model-name>` 拉取該模型
- 檢查該模型是否在您的地區可用（某些模型有地區限制）

## 需要幫助？

如果您在設置 LLM 提供商時遇到問題，請：

1. 查看 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) 瞭解已知問題
2. 如果您是企業計劃用戶，請聯繫支持團隊
