# 撰寫 Runbook

在 **Runbooks → Create Runbook** 下建立一個 runbook，然後開啟它並前往 **Steps** 分頁。

## 步驟的結構

每個步驟都包含：

| 欄位 | 用途 |
| --- | --- |
| **Title** | 顯示在檢查清單 UI 中的簡短標籤。必填。 |
| **Description** | 提供給回應者的選用情境說明。支援 Markdown 的文字。 |
| **Continue on failure** | 若開啟，失敗的步驟不會停止整個執行 — 下一個步驟仍會執行。 |
| **Require approval** | 若開啟，runbook 會在此步驟後暫停，並等待使用者核准後才執行下一個步驟。 |
| **Type-specific config** | Script、URL、agent 等 — 詳見下文。 |

步驟會**依序**執行。使用 Steps 編輯器上的上/下箭頭來重新排序。

## 步驟類型

### Manual

回應者勾選的核取方塊。當 runbook 執行到 Manual 步驟時會暫停，並停留在 `WaitingForManualStep` 狀態，直到有人將其標記為完成（或跳過）。

將此用於只有人才能驗證的事項：「已確認流量已在負載平衡器儀表板中切換至次要區域。」

### JavaScript

在沙箱化的 `isolated-vm` 中執行的一段 JavaScript。該沙箱位於你自己基礎設施中的 [Runbook Agent](/docs/runbooks/agents) 上 — 而非 OneUptime Worker 上。

在 JavaScript 步驟上設定兩項內容：

- **Runbook Agent** — 從下拉選單中挑選應執行此步驟的 agent。只有選定的 agent 才能認領該工作。
- **Script** — 要執行的 JavaScript。

```js
const start = Date.now();
// ... your logic ...
return { durationMs: Date.now() - start };
```

回傳值會擷取在該步驟的執行紀錄上。`console.log` 的輸出會擷取為日誌行。預設執行逾時：30 秒。預設認領逾時（Worker 等待 agent 認領工作的時間）：2 分鐘。

### HTTP request

發出對外的 HTTP 呼叫。設定方法（GET/POST/PUT/PATCH/DELETE/HEAD）、URL、選用的 JSON 標頭，以及選用的內文。回應的狀態、標頭與內文都會被擷取（總計上限 50KB）。

適用於：觸發 PagerDuty 事件、貼文到 Slack、呼叫你自己的管理 API 等。HTTP 步驟直接在 OneUptime Worker 上執行；不需要 agent。

### Bash

在你自己基礎設施中的 [Runbook Agent](/docs/runbooks/agents) 上執行的 bash 腳本（`bash -c <script>`）。Bash 永遠不會在 OneUptime Worker 上執行。

在 Bash 步驟上設定兩項內容：

- **Runbook Agent** — 從下拉選單中挑選應執行此步驟的 agent。只有選定的 agent 才能認領該工作。
- **Script** — 要執行的 bash。輸出（stdout + stderr）最多擷取 50 KB；程序會在逾時時被終止。

若 runbook 執行到此步驟時選定的 agent 處於離線狀態，該步驟最多會等待至**認領逾時**（預設 2 分鐘），然後以 `TimedOut` 失敗。在依賴 Bash 步驟之前，請先在 **Runbooks → Settings → Agents** 下新增一個 agent。

## 儲存與編輯

點擊 **Save Steps** 以保存。runbook 較舊版本正在進行中的執行不受影響 — 它們會繼續使用各自的快照。

## 多個步驟與失敗處理

預設情況下，失敗的步驟會中止整個執行，並將該執行標記為 `Failed`。若你在某個步驟上設定 **Continue on failure**，失敗仍會被記錄，但下一個步驟會繼續執行。這對於「先嘗試這三件事，然後通知」的模式很有用。

## 一個實作範例

針對「DB primary unreachable」的簡單 runbook：

1. **JavaScript** — 從你的設定服務取得目前的 primary 主機並記錄下來。
2. **Manual** — 「確認次要端的複寫延遲低於 5 秒。」
3. **HTTP request** — POST 到你的故障轉移協調器 API。
4. **Manual** — 「驗證寫入現在已導向新的 primary。」
5. **HTTP request** — POST 到 Slack 並附上「all clear」訊息。

回應者觀看一個自動化步驟執行、勾選一個手動步驟、再觀看下一個自動化步驟執行，依此類推。每個步驟的輸出都會被擷取以供事後檢討使用。
