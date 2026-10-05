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

OneUptime SaaS 只能連線到公用網際網路上的 LLM 端點，無法連線到您私有網路中的模型，例如自行託管的 Ollama 或 vLLM 伺服器。若要使用您自己執行的模型，請在能連到該模型的網路中自行託管 OneUptime，或將模型公開在公用端點上——請參閱[為自行託管的模型選擇基底 URL](#為自行託管的模型選擇基底-url)。

## 自行託管：只用環境變數完成設定

在自行託管的執行個體上，要**一次為所有專案**啟用 AI 功能，最快的方式是在 OneUptime 伺服器上設定 `GLOBAL_LLM_PROVIDER_*` 環境變數——Docker Compose 寫在 `config.env` 中，Helm 則透過 values 設定。啟動時，OneUptime 會依據這些變數註冊一個 Global LLM Provider（並保持同步）；不需要在儀表板中逐一為每個專案設定，專案沒有自己的供應商時，AI 修正任務也會使用它。

| 變數 | 描述 |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | 啟用時必填。可為下列其中之一：`OpenAI`、`AzureOpenAI`、`Anthropic`、`Groq`、`Mistral`、`Ollama`、`OpenAICompatible` |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API 金鑰——OpenAI、Azure OpenAI、Anthropic、Groq 與 Mistral 為必填；Ollama 或不需金鑰的 OpenAI 相容伺服器則不需要 |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API 端點——Azure OpenAI、Ollama 與 OpenAI 相容伺服器為必填 |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | 要使用的模型（OpenAI 相容伺服器為必填，其他情況建議填寫） |
| `GLOBAL_LLM_PROVIDER_NAME` | 選填的易記名稱，會顯示在儀表板中 |

**範例：自行託管的 Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# OneUptime 伺服器能連線到的位址。絕不能用 localhost：
# 請參閱下文 "為自行託管的模型選擇基底 URL"。
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# 不需要 API 金鑰——Ollama 不使用金鑰。
```

**範例：OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

同步是宣告式的：變更變數後，供應商會在下次重新啟動時更新；移除 `GLOBAL_LLM_PROVIDER_TYPE` 則會將其刪除。在管理儀表板中手動建立的全域供應商永遠不會被更動。專案仍可在 **專案設定** > **人工智慧** > **LLM 提供商** 下新增自己的供應商——專案自有的供應商一律優先於全域供應商。

## 支援的供應商

OneUptime 目前支援以下 LLM 供應商：

| 供應商                | 描述                                                              | 需要 API 金鑰 | 需要 Base URL    |
| --------------------- | ----------------------------------------------------------------- | ------------- | ---------------- |
| **OpenAI**            | GPT-4、GPT-4o、GPT-3.5 Turbo 及其他 OpenAI 模型                   | 是            | 否（使用預設值） |
| **Azure OpenAI**      | 部署在您的 Azure 環境上的 OpenAI 模型                             | 是            | 是               |
| **Anthropic**         | Claude 3 Opus、Claude 3 Sonnet、Claude 3 Haiku 及其他 Claude 模型 | 是            | 否（使用預設值） |
| **Groq**              | 針對 Llama、Mixtral 及其他開源模型提供快速推論                    | 是            | 否（使用預設值） |
| **Mistral**           | Mistral 託管的模型                                                | 是            | 否（使用預設值） |
| **Ollama**            | 自行託管的開源模型，例如 Llama 2、Mistral、CodeLlama 等           | 否            | 是               |
| **OpenAI Compatible** | 任何與 OpenAI 相容的伺服器（vLLM、LocalAI、LM Studio 等）         | 否（選填）    | 是               |

## 設定 LLM 供應商

### 步驟 1：前往 LLM Providers 設定

1. 登入您的 OneUptime 儀表板
2. 前往 **AI 代理** > **LLM 提供商**
3. 點選 **Create LLM Provider** 以新增供應商

### 步驟 2：設定您的供應商

填寫以下欄位：

- **名稱**：此 LLM 設定的易記名稱（例如「Production OpenAI」、「Local Ollama」）
- **描述**（選填）：協助識別此供應商用途的描述
- **LLM 提供商**：選擇供應商類型（OpenAI、Azure OpenAI、Anthropic、Groq、Mistral、Ollama 或 OpenAI Compatible）
- **API 金鑰**：您的 API 金鑰（OpenAI、Azure OpenAI、Anthropic、Groq 與 Mistral 為必填；Ollama 與 OpenAI 相容伺服器則為選填）
- **模型名稱**：要使用的特定模型（例如 `gpt-4o`、`claude-3-opus-20240229`、`llama2`）
- **基底 URL**（選填）：自訂 API 端點 URL（Azure OpenAI、Ollama 與 OpenAI Compatible 為必填，其他則為選填）

## 各供應商專屬設定

### OpenAI

1. 從 [OpenAI Platform](https://platform.openai.com/api-keys) 取得您的 API 金鑰
2. 選擇 **OpenAI** 作為 LLM 提供商
3. 輸入您的 API 金鑰
4. 選擇模型名稱：
   - `gpt-4o` - 能力最強的模型，最適合複雜任務
   - `gpt-4o-mini` - 更快速且更具成本效益
   - `gpt-4-turbo` - 能力與速度的良好平衡
   - `gpt-3.5-turbo` - 快速且經濟實惠

**範例設定：**

```
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. 從 [Anthropic Console](https://console.anthropic.com/) 取得您的 API 金鑰
2. 選擇 **Anthropic** 作為 LLM 提供商
3. 輸入您的 API 金鑰
4. 選擇模型名稱：
   - `claude-3-opus-20240229` - 能力最強的模型
   - `claude-3-sonnet-20240229` - 智慧與速度的良好平衡
   - `claude-3-haiku-20240307` - 最快速且最精簡
   - `claude-3-5-sonnet-20241022` - 最新的 Sonnet 模型

**範例設定：**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama（自行託管）

Ollama 讓您可以在本機或您自己的基礎設施上執行開源 LLM。

1. 從 [ollama.ai](https://ollama.ai) 安裝 Ollama
2. 拉取您想要的模型：`ollama pull llama3.1`
3. 確保 Ollama 正在執行，且 OneUptime 伺服器可以連到它。原生安裝只會監聽 `127.0.0.1`，因此請以 `OLLAMA_HOST=0.0.0.0:11434` 啟動，讓它接受來自其他機器與容器的連線（官方 Docker 映像檔 `ollama/ollama` 已經這樣設定）
4. 選擇 **Ollama** 作為 LLM 提供商
5. 輸入 Base URL：OneUptime 伺服器連到 Ollama 伺服器時所用的位址，例如 `http://ollama:11434`（`/api/chat` 由 OneUptime 自動加上）。`localhost` 無法使用——請參閱[為自行託管的模型選擇基底 URL](#為自行託管的模型選擇基底-url)
6. 輸入您所拉取的模型名稱

**範例設定（Ollama 以名為 `ollama` 的服務執行於 OneUptime 的 Docker Compose 網路上）：**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**加大上下文視窗。** 除非另外設定，Ollama 會以較小的上下文視窗執行模型（目前版本為 4096 個 token，舊版本為 2048），並默默截斷放不下的內容。OneUptime 的 AI 功能在每個請求中都會送出工具定義，光是這些就可能佔用數千個 token。工具定義被截斷時不會出現錯誤：模型只會回答它沒有可用於該問題的工具。請在供應商的 **其他參數** 中設定更大的 `num_ctx`：

```json
{ "options": { "num_ctx": 16384 } }
```

OneUptime 會把這個 `options` 物件合併到它送給 Ollama 的選項中，因此只需列出您要變更的設定。上下文視窗越大，需要的記憶體越多，請選擇模型支援且硬體能承受的大小。若想改為提高所有用戶端的預設值，請在 Ollama 伺服器上設定 `OLLAMA_CONTEXT_LENGTH`。對於透過 `GLOBAL_LLM_PROVIDER_*` 變數註冊的全域供應商，請在管理儀表板的 **設定** > **全域 LLM 供應商** 中設定該欄位；啟動時的同步不會動到它。

**熱門的 Ollama 模型：**

- `llama3.1` - Meta 的 Llama 3.1 模型，最早支援工具呼叫的 Llama
- `llama3.3` - Meta 的 Llama 3.3 模型
- `qwen2.5` - 阿里巴巴的 Qwen 2.5 模型
- `mistral-nemo` - Mistral AI 的 Nemo 模型

> 注意：OneUptime 的 AI 功能屬於代理式——高度依賴工具呼叫。請使用 `llama3.1` 或更新版本（或其他支援工具呼叫的模型）。小型模型或不支援工具呼叫的模型（例如 `llama2`、最初的 `llama3`）效果不佳：它們無法查詢您的監視器、事件或遙測資料，因此調查結果會是空的或憑空捏造的。

### 為自行託管的模型選擇基底 URL

自行託管模型（Ollama、vLLM、LM Studio 或任何其他與 OpenAI 相容的伺服器）的基底 URL 必須是 **OneUptime 伺服器** 能連到的位址。您的瀏覽器從不連線到它。

**回送位址一律會被拒絕。** 連線之前，OneUptime 會檢查基底 URL 的主機名稱解析出的每個位址。`localhost`、`127.0.0.1`、`[::1]` 與 `0.0.0.0`，以及連結本機位址和 `169.254.169.254` 這類雲端中繼資料位址，在所有部署中都會被拒絕，自行託管也不例外。這是刻意的設計：供應商的基底 URL 不能被用來連到 OneUptime 伺服器本身的服務。況且在 Docker Compose 或 Kubernetes 中，`localhost` 指的是 OneUptime 容器，而不是執行模型的機器。

請改用私有位址或內部主機名稱：

| 模型伺服器的執行位置 | 基底 URL |
| --- | --- |
| OneUptime 的 Docker Compose 網路（`oneuptime`）上的服務 | 服務名稱，例如 `http://ollama:11434` |
| 與 OneUptime 相同的 Kubernetes 叢集 | Service 的 DNS 名稱，例如 `http://ollama.<namespace>.svc.cluster.local:11434`——與[內建 vLLM](#在-kubernetes-上自行託管-vllmhelm) 的模式相同 |
| 主機本身，不在任何容器內 | 主機的區域網路 IP，例如 `http://192.168.1.20:11434`；在 Docker Desktop 上也可以用 `http://host.docker.internal:11434` |
| 您網路中的另一台機器 | 它的私有 IP 或內部主機名稱，例如 `http://10.0.0.12:11434` |

與 OpenAI 相容的伺服器也遵循相同規則，使用各自的連接埠與 `/v1` 路徑，例如 `http://vllm:8000/v1`，或 LM Studio 的 `http://192.168.1.20:1234/v1`。和原生安裝的 Ollama 一樣，LM Studio 在您於其伺服器設定中開啟 **Serve on Local Network** 之前，只會監聽 `127.0.0.1`。

**自行託管的部署可以使用私有位址。** 自行託管的 OneUptime 可以連到私有網路位址，例如 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10` 與 IPv6 `fc00::/7`，除非您設定了 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`，這會讓它們像在 OneUptime Cloud 上一樣被拒絕。

**OneUptime Cloud（SaaS）無法連到私有網路。** 對所有 LLM 供應商，它都會拒絕私有網路位址，以及解析到這些位址的主機名稱。若要使用在您自己基礎設施上執行的模型，請在能連到該模型的網路中自行託管 OneUptime，或將模型公開在可公開存取的端點上。請用 API 金鑰保護公用端點：**Ollama** 供應商不會送出任何憑證，而 **OpenAI Compatible** 會把 API 金鑰當成 Bearer 權杖送出（Ollama 也在 `/v1` 下提供與 OpenAI 相容的 API，因此可以放在會檢查金鑰的反向代理之後）。

### OpenAI Compatible（vLLM、LocalAI、LM Studio 等）

**OpenAI Compatible** 供應商適用於任何實作了 OpenAI `/chat/completions` API、但本身並非 OpenAI 的伺服器，例如 [vLLM](https://docs.vllm.ai)、[LocalAI](https://localai.io)、[LM Studio](https://lmstudio.ai) 或 text-generation-webui。這類伺服器通常自行託管於您自己的 URL，且經常在沒有驗證的情況下執行。

1. 啟動您的 OpenAI 相容伺服器，並記下其 Base URL（通常以 `/v1` 結尾）
2. 選擇 **OpenAI Compatible** 作為 LLM 提供商
3. 輸入 **基底 URL**（必填），例如 `http://your-server:8000/v1`。它必須能從 OneUptime 伺服器連到，因此不能用 `localhost`——請參閱[為自行託管的模型選擇基底 URL](#為自行託管的模型選擇基底-url)
4. 輸入 **模型名稱**（必填）——必須符合您伺服器所提供的模型
5. 只有在您的伺服器需要驗證時才輸入 **API 金鑰**；若不需要驗證，請留空

**範例設定（無需金鑰的 vLLM）：**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> 提示：儲存後，請使用供應商上的 **測試** 按鈕，確認連線、模型名稱與 Base URL 皆正確。

### 在 Kubernetes 上自行託管 vLLM（Helm）

如果您使用 Helm chart 自行託管 OneUptime，您可以在叢集中執行 [vLLM](https://docs.vllm.ai)——一個與 OpenAI 相容的推論伺服器——並在您自己的 GPU 上提供本地模型服務。資料不會離開您的基礎設施。

1. 在您的 Helm values 中啟用它（需要 NVIDIA GPU 節點）：

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. 執行 `helm upgrade`，並等待 vLLM Pod 變為 Ready（首次啟動會下載模型）
3. 完成——vLLM 會在啟動時自動註冊為 Global LLM Provider（`vllm.globalProvider.enabled`，預設為 `true`），因此所有專案的 AI 功能皆可使用。注意：專案範圍的 AI Agents 無法使用全域供應商，仍需要專案專屬的 LLM Provider。

如果您停用了自動註冊（`vllm.globalProvider.enabled: false`），請手動建立供應商：

1. 選擇 **OpenAI Compatible** 作為 LLM 提供商（vLLM 使用 OpenAI API）
2. 輸入叢集內部的 Base URL：`http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`（若您變更了 `global.clusterDomain`，請替換 `cluster.local`）
3. 輸入 Model Name：完整的 HuggingFace 模型 ID（若您已設定 `vllm.servedModelName`，則輸入該值）
4. 只有在您設定了 `vllm.apiKey` 時才需要輸入 API Key；若為無需金鑰的 vLLM，請留空

**範例設定：**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

請參閱 [Helm chart 的 vLLM 指南](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md)，以了解 GPU 排程、受限模型與調校選項。

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
- **Ollama**：請確保 Ollama 伺服器正在執行、監聽 OneUptime 伺服器能連到的位址（原生安裝請使用 `OLLAMA_HOST=0.0.0.0:11434`），且 Base URL 指向該位址
- **OpenAI Compatible**：請確認 Base URL 以 `/v1` 結尾（或符合您伺服器的設定）、Model Name 符合您伺服器所提供的模型，且僅在您的伺服器需要驗證時才設定 API Key
- **"…points to an address OneUptime is not allowed to connect to"**：Base URL 解析到了被拒絕的位址——`localhost` 或其他回送位址，或在 OneUptime Cloud 上是私有網路位址。（OneUptime Cloud 會改以 "…could not be reached" 回報被拒絕的主機名稱。）請參閱[為自行託管的模型選擇基底 URL](#為自行託管的模型選擇基底-url)
- **防火牆**：請檢查您的網路是否允許對外連線至供應商的 API

### 找不到模型

- 請確認模型名稱拼寫正確
- 對於 Ollama，請確保您已使用 `ollama pull <model-name>` 拉取該模型
- 請檢查該模型在您的所在地區是否可用（部分模型有地區限制）

## 需要協助嗎？

如果您在設定 LLM 供應商時遇到問題，請：

1. 查看 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) 以了解已知問題
2. 如果您使用的是企業方案，請聯絡支援團隊
