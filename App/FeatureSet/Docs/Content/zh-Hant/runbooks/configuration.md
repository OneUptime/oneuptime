# Runbook 配置與安全

## Bash 與 JavaScript 究竟是怎麼跑的

Bash 和 JavaScript 步驟**絕不在 OneUptime Worker 上執行**。它們被作爲任務派發到某個特定的 [Runbook 代理](/docs/runbooks/agents) — 你在自己基礎設施內某臺主機上安裝的一個小進程。

派發模型：

1. Runbook 步驟的作者在寫步驟時從下拉列表裏選定一個 Runbook 代理。
2. 步驟運行時，Worker 在 `RunbookAgentJob` 裏插入一行，把 `targetAgentId` 設爲該代理 ID，狀態爲 `Pending`。
3. 那個特定的代理（且只有它）原子性地領取任務，在本地執行腳本 — Bash 走 `bash -c <script>`，JavaScript 在 `isolated-vm` 沙箱中 — 然後回報結果。
4. Worker 拿到結果後繼續推進 Runbook。

不再有 `RUNBOOK_BASH_ENABLED` 這樣的環境變量開關。一個部署裏 Bash 或 JavaScript 步驟能不能跑，完全取決於該項目裏是否至少有一個已連接的 Runbook 代理。

## 輸出上限與超時

- 每步輸出：**50&nbsp;KB**。超過部分會帶標記被截斷。
- 每步執行超時默認值：JavaScript、Bash 和 HTTP 都是 **30 秒**。可按步驟配置。
- Bash 與 JavaScript 步驟的 **領取超時**：**2 分鐘** — Worker 在判定失敗前等待被選定代理來領任務的時長。

## 權限

Runbook 權限位於 `Runbook` 權限組：

- `CreateRunbook`、`EditRunbook`、`DeleteRunbook`、`ReadRunbook` — 管理 Runbook 模板。
- `CreateRunbookExecution`、`EditRunbookExecution`、`ReadRunbookExecution` — 啓動、勾選與查看執行。
- `CreateRunbookRule`、`EditRunbookRule`、`DeleteRunbookRule`、`ReadRunbookRule` — 管理自動觸發規則。
- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent` — 管理那些在你自己基礎設施中執行 Bash 與 JavaScript 步驟的 Runbook 代理。
- `RunbookAdmin`、`RunbookMember`、`RunbookViewer`（角色） — 分配給團隊以分別授予完整控制、日常使用或只讀訪問。`RunbookAdmin` 把上述細粒度權限打包在一起。

## 隊列 & worker

Runbook 執行運行在 `Runbook` 這條 BullMQ 隊列上。worker 併發爲 25 — 同時運行數多時請在你的部署裏調整。

手動步驟通過 API 被勾選後，執行會被重新入隊，從下一步繼續。這樣 worker 在剩餘的 Runbook 期間保持熱。

## 加固說明

- **JavaScript 和 Bash** 跑在你控制的 Runbook 代理主機上，而不是 OneUptime Worker 上。JavaScript 被包在 `isolated-vm` 沙箱裏，加常規前奏（切斷原型鏈、移除 `Function`/`eval`、凍結內置原型）。Bash 在代理上通過 `bash -c` 跑，並在代理側強制執行超時。
- **HTTP 步驟** 使用寬鬆的狀態驗證器，所以 4xx 或 5xx 響應會被記錄爲失敗的步驟而非拋錯。這樣捕獲的輸出能反映上游實際返回的內容。
- **代理認證** 通過設置在代理容器上的 ID + 密鑰環境變量完成。服務端權威的代理身份來自由所提交 ID/密鑰定位到的數據庫行——即便密鑰被泄露，客戶端也不能冒充別的代理。

## 數據庫表

- `Runbook` — 模板（name、slug、description、isEnabled、steps JSON）。
- `RunbookExecution` — 每次運行一行，帶可空的 `incidentId`、`alertId` 和 `scheduledMaintenanceId` 外鍵，以及一個 JSON `stepExecutions` 數組，對步驟和每步狀態做快照。
- `RunbookRule` — 自動觸發規則，帶 `triggerEntityType` 區分（Incident、Alert、ScheduledMaintenance），以及與要啓動的 Runbook 的多對多關係。
- `RunbookAgent` — 每個已安裝代理一行：name、secret key、`lastAlive`、`connectionStatus`、主機信息。
- `RunbookAgentJob` — 每個派發的 Bash 或 JavaScript 步驟一行：`targetAgentId`（步驟作者選定的代理）、步驟類型、腳本、狀態（`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`）、領取截止、租約、輸出、退出碼。

## 運營建議

- **確認你在步驟裏挑選的代理是健康的。** 如果你需要冗餘，運行第二個代理把步驟拆開，或者維護一個面向另一個代理的備用 Runbook。
- **捕獲 URL，而不是大塊數據。** 如果某步產生超過幾 KB 的輸出，把它寫到 S3 或日誌棧，然後返回 URL。
- **冪等性很重要。** 自動步驟（HTTP、JavaScript、Bash）在 worker 在步驟中途重啓時，或者代理租約在腳本仍在跑時到期時，可能不止跑一次；把它們設計成可以安全重試。
