# LLM 提供者

LLM 提供者是 OneUptime 中每項 AI 功能背後的模型：調查、詢問 AI、草稿和修正拉取請求都依賴它。本頁說明某項功能使用哪個提供者，如何新增你自己的提供者（OpenAI、Azure OpenAI 和 Microsoft Foundry、Anthropic、Groq、Mistral、Ollama，或任何相容 OpenAI 的伺服器），以及如何讓 OneUptime 使用你自己執行的模型。

:::cards
- [AI 使用哪個提供者](#ai-使用哪個提供者): 專案的預設提供者，否則使用全域提供者。
- [自行託管：透過環境變數零設定](#自行託管透過環境變數零設定): 透過伺服器的設定，為每個專案提供一個提供者。
- [設定 LLM 提供者](#設定-llm-提供者): 為專案新增提供者，並進行測試。
- [為自行託管的模型選擇基底 URL](#為自行託管的模型選擇基底-url): OneUptime 伺服器能夠連到的位址。
:::

## 提供者驅動的功能

- **調查**：OneUptime AI 調查新的事件和警示，並在時間軸上發布附有引用的根本原因分析。請參閱 [AI SRE](/docs/ai/ai-sre)。
- **問題**：**詢問 AI** 根據你專案的資料作答，每個論點都附有引用。請參閱 [詢問 AI](/docs/ai/ask-ai)。
- **草稿**：事件、警示和排定維護的備註中的 **AI 起草**，以及依需求或在事件解決時起草的事後檢討。
- **程式碼**：修正例外、緩慢追蹤以及調查所發現原因的拉取請求，可從 OneUptime 或 GitHub 發起。請參閱 [程式碼](/docs/ai/ai-agent)。
- **其他一切**：AI Insights 的分流、工作流程和運行手冊中的 AI 步驟，以及 Slack 和 Microsoft Teams 中的回答。

## AI 使用哪個提供者

AI 功能使用專案的預設提供者。沒有預設提供者的專案會使用全域提供者（如果有的話）。詢問 AI 也可以把對話切換到專案的另一個提供者，或某個全域提供者。

```mermaid title="AI 功能使用哪個提供者"
flowchart TB
    F["AI 功能<br/>需要一個模型"] --> D{"專案是否有<br/>預設提供者？"}
    D -->|"是"| P["專案的<br/>預設提供者"]
    D -->|"否"| G{"是否有<br/>全域提供者？"}
    G -->|"是"| GP["全域提供者：<br/>OneUptime Cloud<br/>上的 AI 額度"]
    G -->|"否"| N["什麼都不執行，<br/>AI 頁面提示<br/>缺少提供者"]
```

當 **設為預設** 開啟時，提供者就是專案的預設提供者，每個新提供者都是如此。如果專案的所有提供者都關閉了這一項，專案就會改用全域提供者，就像它沒有任何提供者一樣。

每條 OneUptime AI 規則——AI 規則和事後分析規則——都可以改為在 **更多欄位** 中選擇自己的提供者：專案的某個提供者或某個全域提供者，用於該規則啟動的一切工作。不選擇提供者的規則使用預設提供者，所選提供者不再能使用時也會改用預設提供者。請參閱 [規則使用哪個 LLM 提供商](/docs/ai/ai-sre#規則使用哪個-llm-提供商)。

## OneUptime Cloud

在 **OneUptime Cloud** 上，每個專案都可以免設定使用全域提供者。它可用於每項 AI 功能，費用從專案的 AI 額度中支付。

如果想改用你自己的 API 金鑰或某個特定模型，請依下文新增你自己的提供者：在你自己的提供者上執行的 AI 不會向你收費。

全域 LLM 提供者的費用從專案的 AI 額度中支付。要限制 AI 每天能花費的金額，請在 **專案設定 → 人工智慧 → AI Features → 更多設定** 下設定 **每日 AI 支出限制 (USD)**；那裡的 **每日 AI Token 限制** 會限制任何提供者上的權杖，包括你自己的提供者。請參閱 [專案自身的每日限制](/docs/ai/ai-sre#專案自身的每日限制)。

OneUptime Cloud 只能連到公用網際網路上的 LLM 端點。它無法連線到你私人網路中的模型，例如自行託管的 Ollama 或 vLLM 伺服器。要使用你自己執行的模型，請在能夠連到該模型的網路中自行託管 OneUptime，或把模型發布到公用端點：請參閱 [為自行託管的模型選擇基底 URL](#為自行託管的模型選擇基底-url)。

## 自行託管：透過環境變數零設定

在自行託管的執行個體上，**一次為所有專案** 開啟 AI 的最快方式，是在 OneUptime 伺服器上設定 `GLOBAL_LLM_PROVIDER_*` 環境變數：Docker Compose 寫在 `config.env` 中，Helm 則透過 values 設定。啟動時，OneUptime 會據此註冊一個全域 LLM 提供者並保持同步；任何專案都無需設定，沒有自有提供者的專案，其 AI 修正任務也會使用它。

| 變數 | 說明 |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | 開啟時必需。取值為 `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` 之一 |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API 金鑰：OpenAI、Azure OpenAI、Anthropic、Groq 和 Mistral 必需；Ollama 或無金鑰的 OpenAI 相容伺服器不需要 |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | 端點：Azure OpenAI、Ollama 和 OpenAI 相容伺服器必需 |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | 要使用的模型。選填：不設定時，OneUptime 使用提供者的預設模型；在 OpenAI 相容伺服器上，使用伺服器列出的第一個模型 |
| `GLOBAL_LLM_PROVIDER_NAME` | 可選的易記名稱，顯示在儀表板中 |

:::tabs
@tab Ollama
```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```
@tab OpenAI
```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```
:::

同步是宣告式的：修改變數後，提供者會在下次重新啟動時隨之更新；取消設定 `GLOBAL_LLM_PROVIDER_TYPE`，提供者就會被移除。在 Admin Dashboard 中手動建立的全域提供者永遠不會被變更。專案仍然可以在 **專案設定 → 人工智慧 → LLM 提供商** 下新增自己的提供者，而且專案擁有的提供者始終優先。

## 支援的提供者

| 提供者 | 用途 | 需要 API 金鑰 | 需要基底 URL |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 以及其他 OpenAI 模型 | 是 | 否（使用預設值） |
| **Azure OpenAI / Microsoft Foundry** | 你在 Microsoft Foundry 或 Azure OpenAI 中部署的模型：OpenAI 模型、Foundry Models 和 Claude | 是 | 是 |
| **Anthropic** | Claude Sonnet 5.5、Claude Opus 5.5、Claude Haiku 5.5 以及其他 Claude 模型 | 是 | 否（使用預設值） |
| **Groq** | Llama、Mixtral 等開放模型的快速推論 | 是 | 否（使用預設值） |
| **Mistral** | Mistral 託管的模型 | 是 | 否（使用預設值） |
| **Ollama** | 你自己執行的開放原始碼模型，例如 Llama 3.1、Mistral 或 Qwen | 否 | 是 |
| **OpenAI Compatible** | 任何相容 OpenAI 的伺服器：vLLM、LocalAI、LM Studio 等 | 否（選填） | 是 |

## 設定 LLM 提供者

:::steps
### 開啟 LLM 提供者

前往 **專案設定 → 人工智慧 → LLM 提供商**（側邊選單的 **人工智慧** 區段預設是收合的），然後點選 **建立LLM 提供商**。

### 選擇提供者

在 **提供者** 中選擇你的 **LLM 提供商**：OpenAI、Anthropic、Azure OpenAI / Microsoft Foundry、Groq、Mistral、Ollama 和任何 OpenAI 相容伺服器各有一張卡片，每張都用一行說明它是什麼。

### 建立連線

在 **連線** 中，表單只詢問該提供者用到的內容，每個欄位下方都有對應的說明：

- **API 金鑰**：你的 API 金鑰，OpenAI、Azure OpenAI、Anthropic、Groq 和 Mistral 必需，OpenAI 相容伺服器選填；Ollama 不需要填寫
- **基底 URL**：端點，Azure OpenAI、Ollama 和 OpenAI Compatible 必需；其他提供者僅在經由代理或閘道時填寫
- **模型名稱**：要使用的模型，例如 `gpt-5.1`、`claude-sonnet-5-5` 或 `llama3.1`。留空時，OneUptime 使用提供者的預設模型；OpenAI 相容伺服器沒有預設模型，因此 OneUptime 會詢問它提供哪些模型，並使用它列出的第一個模型
- **名稱**：在你輸入自己的名稱之前，沿用提供者的名稱，例如 "Production OpenAI" 或 "Local Ollama"
- **更多欄位**，收合在上述欄位下方：**描述**；**設為預設**，新提供者預設開啟，因為 AI 功能只使用專案的預設提供者；以及 **其他參數**，一個選填的 JSON 物件，其中的額外參數會隨每個請求傳送給提供者（例如 `{"temperature": 0.2}`）

**誰可以看到提供者。** 專案的 LLM 提供者只有能讀取專案設定的成員才能讀取：**專案擁有者**、**專案管理員**、**專案成員**、**檢視者**、**設定管理員**、**設定成員**、**設定檢視者** 和 **Read LLM**。提供者的 **API 金鑰** 和 **其他參數** 只有專案的擁有者和管理員才能讀取，因為參數會隨每個請求傳送給提供者，而且可能像金鑰一樣帶有權杖或標頭。其他成員只能看到是否儲存了參數，而看不到參數內容。可以編輯提供者的成員仍然可以在不讀取的情況下替換其 API 金鑰或參數：在編輯表單中這些欄位一開始是空的，留空則保留已儲存的值。要刪除參數，請儲存 `{}`。只有專案的擁有者和管理員才能修改提供者的 **基底 URL**，因為它的 API 金鑰和其他參數會被傳送到該位址；其他可以編輯提供者的成員可以修改其餘所有內容。任何能讀取提供者的人都能讀取它的 **基底 URL**，所以絕不要在其中放入金鑰、權杖或密碼：請使用 **API 金鑰**。同一頁面上的 **全域 LLM 供應商** 清單（專案改用的共用提供者）會向任何已登入的人顯示它們的名稱、描述和價格，此外不顯示任何資訊。

### 測試它

**測試提供者。** 提供者頁面上或其所在列選單中的 **測試**，會用提供者的 **API 金鑰**、**模型名稱**、**基底 URL** 和 **其他參數** 傳送一個簡短的提示，並告訴你它是否作出回應並呼叫了工具，這是 OneUptime 的 AI 功能所需要的。測試失敗時，會先說明應檢查什麼，再說明提供者的回答。能修改提供者的人就能測試它：**專案擁有者**、**專案管理員**、**專案成員**、**設定管理員**、**設定成員** 和 **Edit LLM**。其他能看到該提供者的人會發現 **測試** 處於鎖定狀態。全域 LLM 提供者由伺服器管理員在 Admin Dashboard 的 **設定 → 全域 LLM 供應商** 下測試。
:::

## 各提供者的設定

### OpenAI

1. 從 [OpenAI Platform](https://platform.openai.com/api-keys) 取得 API 金鑰
2. 選擇 **OpenAI** 作為 LLM 提供者
3. 輸入你的 API 金鑰
4. 選擇模型名稱：
   - `gpt-5.1` - 建議的預設值，擅長工具呼叫和複雜調查
   - `gpt-5.1-mini` - 更快、更經濟

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. 從 [Anthropic Console](https://console.anthropic.com/) 取得 API 金鑰
2. 選擇 **Anthropic** 作為 LLM 提供者
3. 輸入你的 API 金鑰
4. 選擇模型名稱：
   - `claude-sonnet-5-5` - 建議的預設值，在智慧、速度和成本之間取得最佳平衡
   - `claude-opus-5-5` - 能力更強，適合最困難的調查
   - `claude-haiku-5-5` - 最快、最經濟

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 及之後的所有 Claude 模型會自行選擇取樣方式，並拒絕設定了 `temperature`、`top_p` 或 `top_k` 的請求。OneUptime 對這些模型不傳送這些設定。如果某個模型仍然拒絕其中某項設定，OneUptime 會去掉它重新傳送請求，並為該提供者記住這一點。

Claude 5 模型會先思考再回答，而思考會計入回覆的權杖上限，所以 OneUptime 會為此保留空間。要讓它們少思考、更快更省地回答，請在提供者的 **其他參數** 中設定 `{"output_config": {"effort": "low"}}`。OneUptime 會把你在那裡新增的設定隨每個請求傳送給 Anthropic，但 `model`、`messages`、`system`、`tools`、`tool_choice` 和 `stream` 除外，這些由它自己設定。

OneUptime 使用 Anthropic 的提示快取。調查或詢問 AI 回答的每次呼叫都會重新傳送系統提示、工具和到目前為止的對話，OneUptime 會將它們標記為可快取：對於之前的呼叫已傳送的內容，呼叫只需支付十分之一或更低的價格；對於新內容，呼叫會將其寫入快取，並支付比原價高四分之一的價格。 如果 Claude 前面的閘道拒絕快取標記，OneUptime 會不帶標記重新傳送請求，並為該提供者記住這一點。[如何計算 token](/docs/ai/ai-sre#如何計算-token) 說明了快取的 token 如何計入你的限制。

### Azure OpenAI 和 Microsoft Foundry

對於你在 Microsoft Foundry 或 Azure OpenAI 中部署的模型（OpenAI 模型、其他 Foundry Models 和 Claude），請使用 **Azure OpenAI / Microsoft Foundry**。把資源的某個金鑰填為 **API 金鑰**，把部署名稱填為 **模型名稱**，把資源的端點填為 **基底 URL**，例如 `https://contoso-ai.openai.azure.com/openai/v1`。[Microsoft Foundry 和 Azure OpenAI](/docs/ai/microsoft-foundry) 介紹了 Azure 一側的設定：資源、權限、模型部署、網路需求和疑難排解。

### Ollama（自行託管）

Ollama 在你自己的機器上執行開放原始碼模型。

1. 從 [ollama.ai](https://ollama.ai) 安裝 Ollama
2. 拉取一個模型：`ollama pull llama3.1`
3. 確保 Ollama 正在執行，而且 OneUptime 伺服器能連到它。原生安裝只監聽 `127.0.0.1`，所以要用 `OLLAMA_HOST=0.0.0.0:11434` 啟動它，以接受來自其他機器和容器的連線（官方的 `ollama/ollama` Docker 映像檔已經這樣做了）
4. 選擇 **Ollama** 作為 LLM 提供者
5. 輸入基底 URL：OneUptime 伺服器連到 Ollama 伺服器時使用的位址，例如 `http://ollama:11434`（OneUptime 會自行加上 `/api/chat`）。`localhost` 無法使用：請參閱 [為自行託管的模型選擇基底 URL](#為自行託管的模型選擇基底-url)
6. 輸入你拉取的模型名稱

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**加大上下文視窗。** 除非另有設定，Ollama 會依照它找到的 GPU 記憶體決定模型的上下文視窗大小：低於 24 GiB 時為 4k 權杖，48 GiB 以內為 32k，更高則為 256k（舊版本使用 2,048 或 4,096 個權杖）。OneUptime 的 AI 功能都是代理程式。每個請求都帶有它們的系統提示和工具定義，在任何問題之前就超過 10,000 個權杖，而 AI 調查在進行過程中會把每個查詢結果加入對話。當請求再也放不下時，Ollama 會丟棄最早的訊息，問題也隨之遺失。依模型和 Ollama 版本的不同，模型隨後會在沒有問題或沒有工具的情況下作答，或者請求會以 "no user query found in messages"（Qwen 3.8 及更新版本）或 "the prompt is longer than the context length currently available to the model" 失敗。OneUptime 會把這些失敗回報為 "…the request is larger than the model's context window"，並且不會再次執行調查。請在提供者的 **其他參數** 中設定更大的 `num_ctx`：

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime 會把這個 `options` 物件合併到它傳送給 Ollama 的選項中，所以只需列出你想修改的設定。65,536 個權杖是 Ollama 為代理程式建議的值，足以涵蓋大多數調查。較長的調查可能會用得更多，因為 OneUptime 只有在對話超過大約 75,000 個權杖後才開始縮短舊的查詢結果：如果模型支援且你的 GPU 容納得下，請使用 131,072。更大的上下文視窗需要更多記憶體，`ollama ps` 會顯示每個已載入模型獲得的上下文。若要改為提高所有用戶端的預設值，請在 Ollama 伺服器上設定 `OLLAMA_CONTEXT_LENGTH`。當 OneUptime 透過 Ollama 相容 OpenAI 的 `/v1` API（**OpenAI Compatible** 提供者）連到它時，這是唯一的辦法，因為該 API 會忽略 `num_ctx`。對於透過 `GLOBAL_LLM_PROVIDER_*` 變數註冊的全域提供者，請在 Admin Dashboard 的 **設定 → 全域 LLM 供應商** 下設定 **其他參數**；啟動時的同步不會變更該欄位。

**常用的 Ollama 模型：**

- `llama3.1` - Meta 的 Llama 3.1 模型，支援工具呼叫的最早的 Llama
- `llama3.3` - Meta 的 Llama 3.3 模型
- `qwen2.5` - Alibaba 的 Qwen 2.5 模型
- `mistral-nemo` - Mistral AI 的 Nemo 模型

> [!NOTE]
> OneUptime 的 AI 功能都是代理程式：它們高度依賴工具呼叫。請使用 `llama3.1` 或更新版本，或其他能呼叫工具的模型。小模型或不支援工具呼叫的模型（例如 `llama2` 或最初的 `llama3`）回答效果很差：它無法查詢你的監視器、事件或遙測資料，因此調查結果會是空的或捏造的。

### 為自行託管的模型選擇基底 URL

自行託管模型的基底 URL，無論是 Ollama、vLLM、LM Studio 還是其他任何相容 OpenAI 的伺服器，都必須是 **OneUptime 伺服器** 能連到的位址。你的瀏覽器從不連線到它。

**回送位址一律被拒絕。** 在連線之前，OneUptime 會檢查基底 URL 的主機名稱解析到的每一個位址。`localhost`、`127.0.0.1`、`[::1]` 和 `0.0.0.0`，以及 `169.254.169.254` 這類的連結本機位址和雲端中繼資料位址，在所有部署中都會被拒絕，自行託管也不例外。這是刻意的設計：提供者的基底 URL 不能被用來連到 OneUptime 伺服器本身的服務。在 Docker Compose 或 Kubernetes 中，`localhost` 無論如何都會指向 OneUptime 容器，而不是執行你模型的機器。

請改用私人位址或內部主機名稱：

| 模型伺服器執行的位置 | 基底 URL |
| --- | --- |
| OneUptime 的 Docker Compose 網路（`oneuptime`）中的服務 | 服務名稱，例如 `http://ollama:11434` |
| 與 OneUptime 相同的 Kubernetes 叢集 | Service 的 DNS 名稱，例如 `http://ollama.<namespace>.svc.cluster.local:11434`，與 [內建的 vLLM](#在-kubernetes-上自行託管-vllmhelm) 相同的模式 |
| 主機本身，在任何容器之外 | 主機的區域網路 IP，例如 `http://192.168.1.20:11434`，在 Docker Desktop 上則為 `http://host.docker.internal:11434` |
| 你網路中的另一台機器 | 它的私人 IP 或內部主機名稱，例如 `http://10.0.0.12:11434` |

相容 OpenAI 的伺服器遵循相同的規則，使用各自的連接埠和 `/v1` 路徑，例如 `http://vllm:8000/v1`，LM Studio 則為 `http://192.168.1.20:1234/v1`。與原生安裝的 Ollama 一樣，LM Studio 在你於其伺服器設定中開啟 **Serve on Local Network** 之前只監聽 `127.0.0.1`。

**私人位址在自行託管的安裝中可用。** 自行託管的 OneUptime 可以連到私人網路位址，例如 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10` 和 IPv6 `fc00::/7`，除非你設定了 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`，它會像 OneUptime Cloud 一樣拒絕這些位址。該設定不適用於全域 LLM 提供者，因為它由管理員（透過 `GLOBAL_LLM_PROVIDER_*` 變數或在 Admin Dashboard 中）而不是專案設定：它仍然可以連到私人位址。對每個提供者，回送位址和連結本機位址都始終被拒絕。

**OneUptime Cloud（SaaS）無法連到私人網路。** 對每個 LLM 提供者，它都會拒絕私人網路位址，以及解析到這些位址的主機名稱。要使用執行在你自己基礎架構上的模型，要麼在能連到該模型的網路中自行託管 OneUptime，要麼把模型發布到可公開存取的端點。請用 API 金鑰保護公用端點：**Ollama** 提供者不傳送任何憑證，而 **OpenAI Compatible** 會把 API 金鑰作為 bearer 權杖傳送（Ollama 也在 `/v1` 下提供相容 OpenAI 的 API，所以它可以放在一個驗證金鑰的反向代理後面）。

### OpenAI Compatible（vLLM、LocalAI、LM Studio 等）

對於任何實作了 OpenAI `/chat/completions` API 但本身不是 OpenAI 的伺服器，請使用 **OpenAI Compatible** 提供者，例如 [vLLM](https://docs.vllm.ai)、[LocalAI](https://localai.io)、[LM Studio](https://lmstudio.ai) 或 text-generation-webui。它們通常執行在你自己的位址上，而且往往沒有身分驗證。

1. 啟動你的 OpenAI 相容伺服器，並記下它的基底 URL（通常以 `/v1` 結尾）
2. 選擇 **OpenAI Compatible** 作為 LLM 提供者
3. 輸入 **基底 URL**（必填），例如 `http://your-server:8000/v1`。OneUptime 伺服器必須能連到它，所以不能用 `localhost`：請參閱 [為自行託管的模型選擇基底 URL](#為自行託管的模型選擇基底-url)
4. 輸入 **模型名稱**，或留空：留空時 OneUptime 會詢問你的伺服器提供哪些模型，並使用它列出的第一個模型（在 vLLM 上就是它提供的模型）。輸入的名稱必須與你的伺服器提供的某個模型一致
5. 只有在你的伺服器要求時才輸入 **API 金鑰**；對於無金鑰的伺服器請留空

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> 儲存後，使用提供者的 **測試** 檢查連線、模型名稱和基底 URL。

### 在 Kubernetes 上自行託管 vLLM（Helm）

如果你用 Helm chart 自行託管 OneUptime，就可以在叢集內執行 [vLLM](https://docs.vllm.ai)（一個相容 OpenAI 的推論伺服器），在你自己的 GPU 上提供本機模型。任何資料都不會離開你的基礎架構。

1. 在你的 Helm values 中開啟它（需要 NVIDIA GPU 節點）：

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. 執行 `helm upgrade`，等待 vLLM 的 Pod 變為 Ready（首次啟動會下載模型）
3. 就這樣：vLLM 會在啟動時自動註冊為全域 LLM 提供者（`vllm.globalProvider.enabled`，預設 `true`），因此 AI 功能對所有專案都可用，包括 AI 修正任務。（在任何地方，無論雲端還是自行託管，當專案沒有自有提供者時，代理程式的修正任務都會使用全域提供者；在雲端，這部分用量依計量的 AI 權杖計費。專案擁有的提供者始終優先。）

如果你關閉了自動註冊（`vllm.globalProvider.enabled: false`），請手動建立提供者：

1. 選擇 **OpenAI Compatible** 作為 LLM 提供者（vLLM 使用 OpenAI API）
2. 輸入叢集內的基底 URL：`http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`（如果你修改過 `global.clusterDomain`，請替換 `cluster.local`）
3. 輸入模型名稱：完整的 Hugging Face 模型 id（如果你設定了 `vllm.servedModelName`，則用它），或留空以使用 vLLM 提供的模型
4. 只有在你設定了 `vllm.apiKey` 時才輸入 API 金鑰；對於無金鑰的 vLLM 請留空

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

在開啟計費的情況下，或設定了 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`（Helm values 中的 `outboundConnections.blockPrivateNetwork: true`）時，專案自有的提供者無法連到這個叢集內位址，因為它解析到一個私人的叢集 IP。請改為在 Admin Dashboard 的 **設定 → 全域 LLM 供應商** 下用相同的欄位建立提供者：全域 LLM 提供者可以連到該位址。

有關 GPU 排程、受限模型和調校選項，請參閱 [Helm chart 的 vLLM 指南](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md)。

## 最佳做法

- **為提供者取清楚的名稱**，例如 "Production OpenAI" 或 "Development Ollama"，讓隊友知道哪個是哪個。
- **把金鑰放在 API 金鑰欄位中。** API 金鑰在儲存時會被加密，只有專案的擁有者和管理員能讀取。
- **每次修改後都進行測試**，使用提供者的 **測試**。
- **留意 AI 的成本。** 每次呼叫及其權杖和成本都列在 **專案設定 → 人工智慧 → AI 日誌** 下。

## 疑難排解

:::details 無法連到提供者
- **OpenAI 或 Anthropic**：檢查你的 API 金鑰是否有效並且有餘額
- **Azure OpenAI / Microsoft Foundry**：錯誤訊息會先說明需要修改什麼。[Microsoft Foundry 和 Azure OpenAI](/docs/ai/microsoft-foundry) 說明了 Azure 回傳的每種錯誤
- **Ollama**：檢查 Ollama 伺服器是否在執行，是否監聽在 OneUptime 伺服器能連到的位址上（原生安裝使用 `OLLAMA_HOST=0.0.0.0:11434`），以及基底 URL 是否指向該位址
- **OpenAI Compatible**：檢查基底 URL 是否以 `/v1` 結尾（或與你的伺服器相符），如果填寫了模型名稱，它是否與你的伺服器提供的模型一致，以及是否只在伺服器要求時才設定了 API 金鑰。如果模型名稱留空，而伺服器的 `/models` 端點沒有列出任何模型，請填寫模型名稱
- **"…points to an address OneUptime is not allowed to connect to"**：基底 URL 解析到了被拒絕的位址：`localhost` 或其他回送位址，或者在 OneUptime Cloud 上是私人網路位址。（OneUptime Cloud 會把被拒絕的主機名稱回報為 "…could not be reached"。）請參閱 [為自行託管的模型選擇基底 URL](#為自行託管的模型選擇基底-url)
- **防火牆**：檢查你的網路是否允許向提供者的 API 發起輸出連線
:::

:::details 找不到模型
檢查模型名稱的拼寫。對於 Ollama，請先用 `ollama pull <model-name>` 拉取模型。有些模型只在部分區域可用。
:::

:::details 上下文視窗太小
- **"…the request is larger than the model's context window"**：請求放不進模型的上下文視窗，通常是因為 AI 調查收集了大量證據。請在提供者的 **其他參數** 中提高 `num_ctx`，或在 Ollama 伺服器上提高 `OLLAMA_CONTEXT_LENGTH`；請參閱 [Ollama（自行託管）](#ollama自行託管)
- **"no user query found in messages"**：同一個問題，這是 Qwen 的回報方式。OneUptime 一律會傳送問題；是 Ollama 為了放下請求的其餘部分而把它丟棄了
:::

還是沒有解決？請在 [OneUptime 的 GitHub issues](https://github.com/OneUptime/oneuptime/issues) 中搜尋你的錯誤，如果你的方案包含支援服務，也可以聯絡支援。

## 後續步驟

:::cards
- [程式碼](/docs/ai/ai-agent): 你的提供者撰寫的拉取請求，以及它們從哪裡開始。
- [AI SRE](/docs/ai/ai-sre): OneUptime AI 有了提供者之後會做什麼。
- [詢問 AI](/docs/ai/ask-ai): 向你的專案提問，並切換對話的提供者。
:::
