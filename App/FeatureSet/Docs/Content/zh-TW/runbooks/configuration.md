# Runbook 設定與安全性

## Bash 與 JavaScript 實際如何執行

Bash 與 JavaScript 步驟**絕不會在 OneUptime Worker 上執行**。它們會被分派為工作，交給特定的 [Runbook Agent](/docs/runbooks/agents)——一個你安裝在自有基礎架構主機上的小型程序。

分派模型：

1. Runbook 步驟的作者在撰寫步驟時，從下拉選單中挑選一個 Runbook Agent。
2. 當步驟執行時，Worker 會在 `RunbookAgentJob` 中插入一列，將 `targetAgentId` 設為該 agent 的 ID，狀態為 `Pending`。
3. 該特定 agent（且只有該 agent）會以原子方式認領這份工作，於本機執行該指令稿——Bash 透過 `bash -c <script>`、JavaScript 則在 `isolated-vm` 沙箱中執行——並將結果回傳。
4. Worker 以該結果繼續執行 runbook。

現在已不再有 `RUNBOOK_BASH_ENABLED` 環境旗標。在某個部署中 Bash 或 JavaScript 步驟是否能運作，完全取決於專案中是否至少有一個已連線的 Runbook Agent。

## 輸出上限與逾時

- 每步驟輸出：**50&nbsp;KB**。較大的輸出會被截斷並附上標記。
- 每步驟執行逾時預設值：JavaScript、Bash 與 HTTP 均為 **30 秒**。可依步驟設定。
- Bash 與 JavaScript 步驟的每步驟**認領逾時**：**2 分鐘**——即 Worker 在判定失敗之前，等待所選 agent 認領該工作的時間。

## 權限

Runbook 權限位於 `Runbook` 權限群組中：

- `CreateRunbook`、`EditRunbook`、`DeleteRunbook`、`ReadRunbook`——管理 runbook 範本。
- `CreateRunbookExecution`、`EditRunbookExecution`、`ReadRunbookExecution`——啟動、勾選與讀取執行。
- `CreateRunbookRule`、`EditRunbookRule`、`DeleteRunbookRule`、`ReadRunbookRule`——管理自動觸發規則。
- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent`——管理在你自有基礎架構中執行 Bash 與 JavaScript 步驟的 Runbook Agent。
- `RunbookAdmin`、`RunbookMember`、`RunbookViewer`（角色）——指派給團隊，分別授予完整控制權、日常使用權或唯讀存取權。`RunbookAdmin` 涵蓋上述所有細部權限。

## 佇列與 worker

Runbook 執行會在 `Runbook` BullMQ 佇列上執行。Worker 並行數為 25——如果你有大量同時執行的工作，請在部署中調整此值。

當手動步驟透過 API 被勾選時，執行會被重新排入佇列，以便從下一個步驟繼續。這能讓 worker 在 runbook 的其餘部分維持熱機狀態。

## 強化注意事項

- **JavaScript 與 Bash** 在你控管的 Runbook Agent 主機上執行，而非在 OneUptime Worker 上。JavaScript 會被包覆在 `isolated-vm` 沙箱中，並搭配一般的前置處理（切斷原型鏈、移除 `Function`/`eval`、凍結內建原型）。Bash 則在 agent 上透過 `bash -c` 執行並施加逾時限制。
- **HTTP 步驟** 使用寬鬆的狀態驗證器，因此 4xx 或 5xx 回應會被記錄為失敗步驟，而非拋出例外。如此一來，所擷取的輸出能反映上游實際回傳的內容。
- **Agent 驗證** 是以 ID + 密鑰進行，在 agent 容器上設定為環境變數。在伺服器端，權威的 agent 身分來自以所提供之 ID/key 為鍵的 DB 列——即使金鑰外洩，用戶端也無法冒充其他 agent。

## 資料庫表格

- `Runbook`——範本（name、slug、description、isEnabled、steps JSON）。
- `RunbookExecution`——每次執行一列，包含可為 null 的 `incidentId`、`alertId` 與 `scheduledMaintenanceId` 外鍵，以及一個 JSON `stepExecutions` 陣列，用以快照步驟與各步驟狀態。
- `RunbookRule`——自動觸發規則，帶有 `triggerEntityType` 鑑別欄位（Incident、Alert、ScheduledMaintenance），以及與要啟動的 runbook 之間的多對多關係。
- `RunbookAgent`——每個已安裝的 agent 一列：name、密鑰、`lastAlive`、`connectionStatus`、主機資訊。
- `RunbookAgentJob`——每個已分派的 Bash 或 JavaScript 步驟一列：`targetAgentId`（步驟作者所挑選的 agent）、步驟類型、指令稿、狀態（`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`）、認領期限、租約、輸出、結束代碼。

## 維運提示

- **確保你在步驟中挑選的 agent 是健康的。** 如果你需要備援，請執行第二個 agent 並將步驟分散在兩者之間，或保留一份以另一個 agent 為目標的備用 runbook。
- **擷取 URL，而非大塊資料。** 如果某個步驟產生超過數 KB 的輸出，請將其寫入 S3 或你的記錄堆疊，並回傳該 URL。
- **冪等性很重要。** 自動化步驟（HTTP、JavaScript、Bash）在 worker 於步驟執行途中重新啟動，或在指令稿仍在執行時 agent 租約到期的情況下，可能會執行不只一次；請將其設計成可安全重試。
