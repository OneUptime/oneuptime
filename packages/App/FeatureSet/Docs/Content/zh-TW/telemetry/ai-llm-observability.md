# 使用 OneUptime 實現 AI / LLM 可觀測性

閱讀 AI 進行過的每一段對話，依當時的節奏重新播放，並在 AI 回答不佳時收到通知。一切都以標準 OpenTelemetry 運作，不需要專有 SDK：只要應用程式送出的 span 遵循 OpenTelemetry **GenAI 語意慣例**（`gen_ai.*`），OneUptime 就會把它們變成對話、警示、使用量和成本。

## 你會得到什麼

在導覽列的「可觀測性」底下開啟 **AI / LLM**：

- **對話** — AI 進行過的每一段對話：大家問了什麼、AI 答了什麼、用了哪些工具、哪裡出了問題。清單上方有五個數字：對話數、AI 回答數、需要注意的數量、成本，以及一次回答通常需要多久。開啟一段對話即可閱讀或重新播放。
- **呼叫** — 每一次 LLM、嵌入、代理程式和工具呼叫，可依服務、提供者、模型、作業、人員和團隊篩選。點選某次呼叫即可在追蹤檢視器中開啟。
- **使用量** — 某段時間內的呼叫、token 和成本，以及誰花了多少：依支出排序的員工、團隊、模型、提供者和應用程式。
- **警示** — 針對 AI 回答不佳的現成警示，以及你的 AI / LLM 監測器。
- **預算** — 每日成本上限，以指標形式發布，可據此設定警示。
- **定價** — 你自訂的各模型價格，用於內建目錄不認得的模型。
- **設定** — 下列五個步驟，以及你專案的端點。

在追蹤檢視器中，每次 AI 呼叫的 span 還有一個 **AI / LLM** 面板，顯示模型、token 數、成本、要求參數，以及提示詞和補全內容。

## 步驟 1 — 傳送你的 AI 呼叫

建立遙測擷取金鑰：開啟 **專案設定 → 遙測與 APM → 擷取金鑰**，然後點選 **建立擷取金鑰**。你的應用程式會把金鑰當作 OTLP 標頭傳遞。（螢幕截圖請見 [OpenTelemetry 指南](/docs/telemetry/open-telemetry)。）

接著用任一 OpenTelemetry GenAI 程式庫為應用程式加入檢測：

- **OpenLLMetry**（Traceloop）— OpenAI、Anthropic、Cohere、Bedrock、LangChain、LlamaIndex、CrewAI 等。
- **OpenInference**（Arize）— OpenAI、LangChain、LlamaIndex、DSPy 等。
- **Vercel AI SDK**，或適用於 OpenAI、Anthropic 和 Gemini 的 **OpenTelemetry 檢測程式庫**。

你的 LLM 流量會經過 **LiteLLM** 或 **Portkey** 之類的閘道嗎？從閘道匯出追蹤即可，不必為每個應用程式加入檢測 — 請參閱 [觀測 AI 閘道](/docs/telemetry/ai-gateways)。在找工程師使用的程式設計助理 — Claude Code、Cursor、Codex、Gemini CLI、Copilot？它們會匯出自己的 OpenTelemetry，你不需要做任何事：請參閱 [AI 程式設計助理可觀測性](/docs/telemetry/ai-coding-assistants)。

### Python (OpenLLMetry)

```bash
pip install traceloop-sdk opentelemetry-exporter-otlp
```

```python
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",   # or your self-hosted host + /otlp
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

# Your normal OpenAI / Anthropic / LangChain calls are now traced automatically.
```

### Node.js / TypeScript (OpenLLMetry)

```bash
npm install @traceloop/node-server-sdk
```

```ts
import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-agent",
  baseUrl: "https://oneuptime.com/otlp", // or your self-hosted host + /otlp
  headers: { "x-oneuptime-token": "YOUR_INGESTION_TOKEN" },
});
```

### 純 OpenTelemetry 環境變數

如果你使用原生 OpenTelemetry SDK 加入檢測，請把 OTLP 匯出器指向 OneUptime：

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

自行託管 OneUptime？請把 `https://oneuptime.com/otlp` 換成 `https://YOUR-ONEUPTIME-HOST/otlp`。

## 步驟 2 — 記錄說了什麼

當你的檢測記錄了內容時，對話會顯示大家問了什麼、AI 答了什麼。OpenLLMetry 預設會記錄提示詞和補全內容，除非你將其關閉（`TRACELOOP_TRACE_CONTENT=false`）。OpenTelemetry 檢測程式庫只有在你要求時才會記錄：

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

沒有這些內容時，對話仍會顯示耗時、成本和問題，並說明內容未被記錄。提示詞可能包含敏感資料：若要在儲存前加以遮蔽，請參閱 [隱私與遮蔽](#隱私與遮蔽)。

## 步驟 3 — 把呼叫歸入對話

聊天應用程式每一輪都會呼叫一次模型。在每次 AI 呼叫上把 `gen_ai.conversation.id`（或 `session.id`）設為你的聊天 ID，不論用了多少次呼叫和多少條追蹤，每個聊天都會顯示為一段對話。使用 OpenLLMetry 時，每個要求設定一次關聯屬性即可：

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

沒有對話 ID 的呼叫也會顯示，一次一個要求（一條追蹤）。

## 步驟 4 — 說明是誰問的

設定 `user.id` 或 `user.email`（上面的關聯屬性會設定電子郵件），就能看到每段對話的對象是誰、依人員搜尋清單，並在「使用量」分頁依員工排序支出。[員工與團隊歸屬](#員工與團隊歸屬) 列出了 OneUptime 讀取的每一個鍵。

## 步驟 5 — 標記不佳的回答

OneUptime 會在每個回答抵達時檢查它，並標出其中的問題：

| 問題     | 意義                                              | 判斷依據                                                                                                                                       |
| -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 失敗     | 呼叫以錯誤結束，因此沒有收到回答                  | span 狀態為 Error、`error.type`，或結束原因為 `error`                                                                                          |
| 拒絕     | AI 拒絕了，或被安全篩選器擋下                     | 拒絕或安全類的結束原因（`content_filter`、`refusal`、`SAFETY` 等）、回答中的拒絕，或以常見英文拒絕語開頭的回答                                 |
| 截斷     | 回答在 token 上限處停止                           | 結束原因為 `length`、`max_tokens` 或 `MAX_TOKENS`                                                                                              |
| 空白     | AI 的回答既沒有文字也沒有工具呼叫                 | 記錄下來的內容為空，或輸出 token 為 0                                                                                                          |
| 已標記   | 你的應用程式送出的評估認為該回答不佳              | 一個 `gen_ai.evaluation.result` 事件                                                                                                           |

前四種不需要你做任何事。若要標記其餘情況（被你的防護機制、eval 或自有 LLM 評審拒絕的回答），請在該回答的 span 上加入一個 `gen_ai.evaluation.result` 事件，並把 `gen_ai.evaluation.score.label` 設為 `fail`：

```python
from opentelemetry import trace

trace.get_current_span().add_event(
    "gen_ai.evaluation.result",
    {
        "gen_ai.evaluation.name": "relevance",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.explanation": "The answer is about another product.",
    },
)
```

`incorrect`、`wrong`、`unhelpful`、`toxic`、`unsafe` 和 `hallucination` 等標籤也算作未通過。該事件必須位於所評判回答的 span 上，並且要在該 span 仍處於開啟狀態時加入。

OneUptime 絕不會把你的對話送給另一個 AI 評判：每項檢查只會讀取呼叫本身攜帶的內容。

## 閱讀和重新播放一段對話

對話會完整開啟，就像聊天應用程式顯示歷史紀錄那樣：對方說的話在右側，AI 的回答在左側並附上模型、時間、token 和成本，工具呼叫夾在中間，出錯的地方在發生處標出。回答下方的 **詳細資料** 會顯示其結束原因和評估，並附上連到「追蹤」中該次呼叫的連結。

底部的播放列會依對方經歷的方式重新播放這段對話：

- **重新播放** 從第一則訊息開始，依當時的節奏播放；回答還在路上時，「AI 正在回答…」會持續計時。點選任一訊息的時間即可從那裡開始播放。
- **略過等待** 預設開啟，會縮短超過 3 秒的停頓。速度按鈕可依 1×、2×、4× 或 8× 播放。
- **K** 播放或暫停，**J** 或 **←** 後退一則訊息，**L** 或 **→** 前進一則。
- 網址會記住播放停在哪則訊息（`?step=`），因此連結會在那一刻開啟。

## AI 回答不佳時收到通知

**警示** 分頁提供大多數 AI 應用程式需要的警示。選擇其中一個會開啟已填好的「建立監測器」，儲存前你可以修改任何內容：

| 警示           | 何時通知你                                                                         |
| -------------- | ---------------------------------------------------------------------------------- |
| 回答出現問題   | 15 分鐘內超過 5% 的回答失敗、被拒絕、被截斷、為空白或被標記                        |
| AI 呼叫失敗    | 5 分鐘內超過 10% 的模型呼叫以錯誤結束                                              |
| AI 拒絕回答    | 30 分鐘內超過 5% 的回答是拒絕                                                      |
| 回答遭到截斷   | 30 分鐘內有 3 個以上的回答停在 token 上限                                          |
| 回答被標記     | 有評估把某個回答標記為不佳                                                         |
| 回答變慢       | 15 分鐘內超過 10% 的回答耗時超過 30 秒                                             |
| AI 停止回答    | AI 在 30 分鐘內沒有給出任何回答                                                    |

依比例觸發的警示還會等到至少有 3 個不佳回答，這樣兩個回答中有一個不佳時不會把人吵醒。

每個警示都是一個 **AI / LLM** 監測器。它的設定決定什麼算是不佳回答（上述問題、比你設定的上限更慢的回答，或兩者皆是）、監看哪些應用程式和哪個模型，以及每次檢查往回看多久。設定下方的預覽會顯示監測器此刻會計入什麼。它的條件比較三個數字：**不佳回答的比例**（%）、**不佳回答的數量** 和 **回答的數量**。現成的警示會觸發一個能自動解除的警示，並在回答不佳期間把監測器顯示為「效能下降」；若要呼叫某人，請改為開啟它的事件。

支出由 [每日成本預算](#每日成本預算) 監看。

## OneUptime 辨識的屬性

OneUptime 會優先讀取 OpenTelemetry GenAI 慣例，並退回到 OpenLLMetry 和 OpenInference 的變體，讓常用程式庫開箱即用。

| 內容                     | 主要屬性                     | 也接受                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 提供者 / 系統            | `gen_ai.provider.name`       | `gen_ai.system`（慣例中已淘汰，但仍被廣泛送出）、`llm.system`、`llm.provider`                                                                                                                                                                                            |
| 作業                     | `gen_ai.operation.name`      | `llm.request.type`、`openinference.span.kind`                                                                                                                                                                                                                             |
| 要求的模型               | `gen_ai.request.model`       | `llm.model_name`、`llm.request.model`                                                                                                                                                                                                                                     |
| 回應的模型               | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| 輸入 token               | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`、`llm.token_count.prompt`、`llm.usage.prompt_tokens`                                                                                                                                                                                         |
| 輸出 token               | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`、`llm.token_count.completion`、`llm.usage.completion_tokens`                                                                                                                                                                             |
| token 總數               | `gen_ai.usage.total_tokens`  | `llm.token_count.total`、`llm.usage.total_tokens`；都未回報時由輸入 + 輸出推算                                                                                                                                                                                           |
| 成本（USD）              | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`、`gen_ai.usage.total_cost`、`llm.usage.total_cost`、`gen_ai.cost.total_cost`（LiteLLM）、`litellm.cost.total`                                                                                                                                     |
| 代理程式名稱             | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| 工具名稱                 | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| 對話 / 工作階段 ID       | `gen_ai.conversation.id`     | `session.id`、`langfuse.session.id`、`traceloop.association.properties.session_id`                                                                                                                                                                                        |
| 員工（發起呼叫的人）     | `user.id`                    | `enduser.id`、`litellm.metadata.user_api_key_user_id` 和 `metadata.user_api_key_user_id`（LiteLLM OTel v2 和 v1 的寫法，兩者都會讀取）、`traceloop.association.properties.user_id`、`langfuse.user.id`、`user.account_uuid`、`user.account_id`、`cursor.user.id` |
| 員工電子郵件             | `user.email`                 | `traceloop.association.properties.user_email`、`enduser.email`                                                                                                                                                                                                            |
| 團隊 / 成本中心          | `team.id`                    | `team`、`cost_center`、`department`、`litellm.metadata.user_api_key_team_id` 和 `litellm.team.id`（LiteLLM OTel v2）、`metadata.user_api_key_team_id`（LiteLLM OTel v1）、`cursor.team.id`                                                                                |

`traceloop.association.properties.*` 底下的子鍵 **由呼叫端提供**：Traceloop 定義前綴，你的程式碼提供其下的內容。`gen_ai.usage.total_tokens` 和 `gen_ai.usage.cost` 是 **事實標準** 的鍵，而不是 GenAI 語意慣例 — 慣例既沒有定義 token 總數屬性，也沒有定義成本屬性 — OneUptime 會讀取它們，是因為常見的檢測程式庫會送出它們。`gen_ai.system` 是慣例本身為 `gen_ai.provider.name` 設立、現已淘汰的前身；兩者都會讀取。

**三列身分屬性也會帶 `resource.` 前綴比對。** OTLP 擷取會把每個 _資源_ 屬性以 `resource.` 前綴展開到 span 的屬性對應中，因此 `OTEL_RESOURCE_ATTRIBUTES=team.id=platform` 抵達時是 `resource.team.id`。OneUptime 會先查找整個不帶前綴的清單，再查找整個 `resource.` 清單，所以 span 屬性（描述一次呼叫）優先於資源屬性（描述整個處理程序）。其他列只依不帶前綴的鍵比對：它們是每次呼叫各自的值。

**提示詞和補全內容** 從以下位置讀取：`gen_ai.client.inference.operation.details` 事件；span 屬性 `gen_ai.input.messages`、`gen_ai.output.messages` 和 `gen_ai.system_instructions`；舊版檢測程式庫仍在送出的 **已淘汰** 依角色事件（`gen_ai.system.message`、`gen_ai.user.message`、`gen_ai.tool.message`、`gen_ai.assistant.message`、`gen_ai.choice`）；帶索引的屬性（`gen_ai.prompt.N.content` 和 `gen_ai.completion.N.content`，以及 OpenInference 的 `llm.input_messages.N.message.content` 和 `llm.output_messages.N.message.content`）；以及 JSON 訊息陣列（`gen_ai.prompt`、`gen_ai.completion`、`input.value`、`output.value`）。

### 成本如何計算

如果你的檢測回報了成本（`gen_ai.usage.cost`），OneUptime 會原樣使用：回報的值一律優先。沒有回報成本時，OneUptime 會根據 span 的 token 數和內建的定價目錄計算 **擷取時的估算成本**，該目錄涵蓋 OpenAI、Anthropic、Google Gemini、Mistral、DeepSeek、xAI、Cohere、Amazon Nova 和 Meta Llama 的常見模型。模型依名稱前綴比對，因此像 `gpt-4o-2024-08-06` 這樣帶日期的快照，以及像 `us.anthropic.claude-3-5-sonnet-20241022-v2:0` 這樣帶廠商修飾的 ID 都能正確辨識。未知或自訂模型絕不猜測 — 在你於 **定價** 分頁為其設定價格之前，它們的成本維持 `0`。估算使用牌價，不考慮快取或批次折扣。

自行託管 OneUptime？目錄位於 `packages/Common/Types/Telemetry/LlmCostCatalog.ts`。

## 員工與團隊歸屬

「上個月是哪位工程師在 Opus 上花了 4,000 美元？」是一個關於人的問題，除非 span 上有內容指明某個人，否則沒有任何 LLM span 能回答。OneUptime 會在擷取時把發起動作的人複製到可查詢的欄位中，所以你可以依欄位分組和篩選，而不必撰寫屬性查找。

上表中的三列身分屬性就是整個機制；依列出的順序，第一個存在的鍵勝出。`user.id` 排在最前面，因為它是 OpenTelemetry 中表示人類操作者的標準鍵，也是你自行設定身分時應統一採用的鍵。**有一個例外：Claude Code** 送出的 `user.id` 是儲存在 `~/.claude.json` 中的隨機匿名識別碼，而不是某個人。在它的指標資料點上這無關緊要，因為那裡的清單以電子郵件優先；但如果你啟用 Claude Code 的追蹤搶先版，span 上匿名的 `user.id` 會排在 `user.email` 之前：請在該批裝置的收集器處理器中移除或重新對應 `user.id`。`enduser.id` 仍是語意慣例中的有效屬性，可作為同等別名。`cursor.user.id` 排在最後，因為它是一個不透明、以團隊為範圍的整數，需要透過 Cursor 的管理 API 才能對應到具體的人。

身分只會在已被辨識為 LLM 呼叫的 span 上讀取：`user.id`、`user.email` 和 `team.id` 是通用的鍵，瀏覽器和一般後端的 span 也會帶有。**指標資料點** 帶有一份較短、以電子郵件優先的清單 — `user.email`、`user.id`、`user.account_uuid`、`user.account_id`、`cursor.user.id`，團隊則來自 `team.id`、`team`、`cost_center`、`department` 和 `cursor.team.id`，每一個也都會帶 `resource.` 前綴比對 — 因為只送指標而不送 span 的程式設計代理程式 CLI 會原生送出 `user.email`。目前沒有任何功能會從 **記錄項目** 讀取身分。

### 設定團隊和成本中心

沒有任何檢測程式庫會送出 `team.id`、`team`、`cost_center` 或 `department`：它們由你的組織設定，通常透過處理程序上的 `OTEL_RESOURCE_ATTRIBUTES` 設定：

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

它們會以 `resource.team.id`、`resource.team`、`resource.cost_center` 和 `resource.department` 的形式抵達 OneUptime；不論你的匯出器把這些鍵留在 OTLP 資源區塊中，還是複製到每個 span 上（Claude Code 屬於後者），這兩個層級在 span 和指標資料點上都能被辨識。直接設定在 span 上、不帶前綴的 `team.id` 仍然優先。

閘道的寫法不需要你做任何設定就會抵達。LiteLLM 在兩種 OpenTelemetry 模式下為屬性取的名稱不同 — 預設的 v1 `otel` 回呼使用單純的 `metadata.` 前綴（`metadata.user_api_key_user_id`、`metadata.user_api_key_user_email`、`metadata.user_api_key_team_id`），可選擇啟用的 v2 模式（`LITELLM_OTEL_V2=true`）使用 `litellm.` 命名空間 — **OneUptime 兩者都會讀取**。

### 刻意排除客戶相關的鍵

一個 LLM span 可能帶有 **兩個** 不同的人：發起呼叫的員工，以及這次呼叫所服務的下游 **客戶**。以下的鍵帶的是客戶，OneUptime 刻意 **一個都不** 讀入身分欄位：

- `gen_ai.user` 和 `llm.user` — 檢測程式庫對 OpenAI 要求參數 `user` 的回傳，OpenAI 將其描述為「a stable identifier for your end-users」（現已淘汰，改用 `safety_identifier` 和 `prompt_cache_key`）。
- `litellm.metadata.user_api_key_end_user_id`、`metadata.user_api_key_end_user_id` 和 `litellm.end_user.id` — LiteLLM 三種寫法下的明確終端使用者 ID，與金鑰擁有者 ID 不同；金鑰擁有者 ID **就是** 員工，**會被** 讀取。

原因在於成本分攤的正確性：如果把客戶 ID 讀入員工欄位，一個服務 40,000 名客戶的客服機器人就會憑空造出 40,000 名「員工」，而真正擁有這筆支出的工程師看起來卻一毛錢都沒花。這些屬性會保留在原始屬性對應中，你可以直接查詢。

### 身分欄位會被清理

員工電子郵件欄位存放的是真實的個人資料。你在 **屬性** 範圍下的遙測 **清理規則** 對該欄位的作用與對其來源屬性完全相同，因此遮蔽電子郵件的規則同樣適用於該欄位。請在 **追蹤 → 設定** 底下設定清理規則和捨棄過濾器。

## span 和指標是備援，而不是相加

**GenAI span 是權威來源。只有在 span 串流什麼都沒有回報時才會參考指標串流，兩者絕不相加。** 一個 span 在一列中帶有模型、token 和成本，因此只要有 span，它就能回答任何問題。沒有 span 的地方 — 程式設計代理程式 CLI 只發布 token 和成本的 _指標_，不送 GenAI span — 由指標串流補上。之所以不相加，是因為許多檢測程式庫會為同一次呼叫同時送出兩種訊號（OpenLLMetry 就是常見的例子），相加會把每一美元算兩次。

需要事先考慮的後果：**一旦你的 GenAI span 回報了非零值，僅有指標的來源對該值的貢獻就不會顯示。** 備援是依數值、依細分進行的，而不是依送出端：

| 位置                                       | 退回到指標的內容                                     | 條件                                  |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------- |
| 使用量 → 輸入 token / 輸出 token           | 輸入和輸出 token 的合計                              | span 的兩項 token 合計都為 0          |
| 使用量 → 成本（USD）                       | 成本，以 USD 和微 USD 計，換算後相加                 | span 的成本合計為 0                   |
| 使用量 → LLM 呼叫                          | 無 — 僅 span                                         | —                                     |
| 使用量 → 員工、團隊、模型                  | 僅成本。呼叫和 token 欄位顯示為 `—`                  | 該細分沒有傳回任何 span 列            |
| 使用量 → 提供者、應用程式 / 服務           | 無 — 僅 span                                         | —                                     |
| 對話                                       | 無 — 對話由 span 建構                                | —                                     |

「提供者」和「應用程式 / 服務」沒有指標備援，因為程式設計代理程式的計數器不帶 GenAI 提供者屬性，也沒有連結到任何 OneUptime 遙測服務。凡是來自指標的數值，頁面都會標示 **來自 GenAI 指標**，因為來自指標的數值在「呼叫」清單中沒有對應的列。

**如果你需要單獨查看某個僅有指標的工具的支出，請給它一個獨立的專案**，這樣它的 span 串流才會真正為空，備援才會生效。預算也是如此：依服務分別設定預算，而不是把送出 span 的服務和只送出指標的服務混在一起。

## 儀表板與指標警示

GenAI 指標會以一般 OpenTelemetry 指標的形式抵達，因此你可以建立繪製 `gen_ai.client.token.usage`、`gen_ai.client.operation.duration` 等指標的 **儀表板**，並在其上建立 **指標監測器** — 例如當 `gen_ai.client.operation.duration` 的 p95 依模型分組後超過閾值時。請參閱 [指標監控](/docs/monitor/metrics-monitor)。

## 每日成本預算

**預算** 分頁會設定以 USD 計的每日上限，依 UTC 日曆日評估。背景工作程序每 15 分鐘彙總一次當天 LLM span 的成本（回報的或計算的），記錄到預算上，並發布兩個 gauge 指標：

| 指標                                | 意義                                   |
| ----------------------------------- | -------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | 當天到目前為止的支出，單位 USD         |
| `oneuptime.llm.budget.percent.used` | 支出占每日上限的百分比                 |

兩者都帶有 `oneuptime.llm.budget.id` 和 `oneuptime.llm.budget.name` 屬性，若設定了預算的服務、提供者和模型範圍，也會一併帶上。請依穩定的 **`oneuptime.llm.budget.id`** 篩選監測器；重新命名預算時名稱會改變。

**警示透過針對這些指標的 [指標監控](/docs/monitor/metrics-monitor) 實現。** 對於經典的 80% / 100% 模式，請在 `oneuptime.llm.budget.percent.used` 上建立監測器，依 `oneuptime.llm.budget.id` 篩選，並加入兩個條件：`>= 80` 建立警告等級的警示，`>= 100` 建立嚴重等級的警示。**把監測器的滾動時間設為 30 分鐘**：預算每 15 分鐘才發布一個點，所以預設的 1 分鐘視窗在兩次彙總之間只會看到空序列。

預算可以限定到某個遙測服務、某個 LLM 提供者或某個確切的模型，也可以涵蓋整個專案，而且可以同時存在多個。預算監測器還可以呼叫一個工作流程來停止失控的代理程式 — 請參閱 [為失控的 AI 代理程式設定斷路器](/docs/telemetry/ai-agent-circuit-breaker)。

## 隱私與遮蔽

提示詞和補全內容可能包含敏感資料。OneUptime 會像對待其他任何追蹤一樣，把你的遙測 **清理規則** 和 **捨棄過濾器** 套用到 LLM span 上，因此你可以在儲存前遮蔽屬性或捨棄 span；請在 **追蹤 → 設定** 底下設定它們。員工電子郵件欄位也受相同規則約束 — 請參閱 [身分欄位會被清理](#身分欄位會被清理)。

讀取對話需要與讀取追蹤相同的權限：能讀取專案追蹤的人就能讀取它的對話，其他人則不能。

## 相關內容

- [AI 程式設計助理可觀測性](/docs/telemetry/ai-coding-assistants) — Claude Code、Cursor、Codex、Gemini CLI、Copilot、Cline 等工具的支援矩陣，以及依員工統計的支出如何跨這些工具運作。
- [監控 Claude Code](/docs/telemetry/claude-code)
- [監控 Cursor](/docs/telemetry/cursor)
- [監控 OpenAI Codex CLI](/docs/telemetry/openai-codex)
- [監控 Gemini CLI 與 GitHub Copilot](/docs/telemetry/gemini-cli-and-copilot)
- [觀測 AI 閘道（LiteLLM 與 Portkey）](/docs/telemetry/ai-gateways)
- [為失控的 AI 代理程式設定斷路器](/docs/telemetry/ai-agent-circuit-breaker)
