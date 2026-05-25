# 編寫 Runbook

在 **Runbooks → 創建 Runbook** 中創建 Runbook，然後打開它並進入 **步驟** 標籤。

## 步驟的結構

每個步驟都有：

| 字段 | 用途 |
| --- | --- |
| **標題** | 清單 UI 中顯示的簡短標籤。必填。 |
| **描述** | 給響應者的可選上下文。支持 Markdown 文本。 |
| **失敗時繼續** | 打開後，失敗的步驟不會中斷運行——下一步仍會執行。 |
| **需要審批** | 打開後，Runbook 在該步驟後暫停，並等待用戶審批後再執行下一步。 |
| **類型相關配置** | 腳本、URL、代理等——見下文。 |

步驟按**順序**執行。可在步驟編輯器上用上下箭頭調整順序。

## 步驟類型

### Manual

由響應者勾選的複選框。Runbook 執行到 Manual 步驟時暫停，狀態保持 `WaitingForManualStep`，直到有人把它標記爲完成（或跳過）。

用於只有人能驗證的事情："已確認在負載均衡器儀表板上流量已切換到副本區域。"

### JavaScript

在沙箱 `isolated-vm` 中運行的 JavaScript 片段。沙箱住在你自己的基礎設施內的 [Runbook 代理](/docs/runbooks/agents) 上——而不在 OneUptime Worker 上。

JavaScript 步驟上需要配置兩件事：

- **Runbook 代理** — 從下拉列表中選定應運行此步驟的代理。只有被選定的代理才能領取任務。
- **腳本** — 要運行的 JavaScript。

```js
const start = Date.now();
// ... your logic ...
return { durationMs: Date.now() - start };
```

返回值會被記錄到步驟執行上。`console.log` 輸出會作爲日誌行被捕獲。默認執行超時：30 秒。默認領取超時（Worker 等待代理領任務的時長）：2 分鐘。

### HTTP 請求

發起一次出站 HTTP 調用。配置方法（GET/POST/PUT/PATCH/DELETE/HEAD）、URL、可選 JSON 頭部以及可選請求體。響應狀態、頭部和正文都會被捕獲（總計上限 50KB）。

適用場景：觸發 PagerDuty 事件、向 Slack 發消息、調用自己的管理 API 等。HTTP 步驟直接在 OneUptime Worker 上運行；不需要代理。

### Bash

bash 腳本（`bash -c <script>`）在你自己的基礎設施內的 [Runbook 代理](/docs/runbooks/agents) 上運行。Bash 絕不會在 OneUptime Worker 上執行。

Bash 步驟上需要配置兩件事：

- **Runbook 代理** — 從下拉列表中選定應運行此步驟的代理。只有被選定的代理才能領取任務。
- **腳本** — 要運行的 bash。輸出（stdout + stderr）會被捕獲，最多 50 KB；超時時進程會被 kill。

如果 Runbook 到達此步驟時所選代理離線，步驟會等待至 **領取超時**（默認 2 分鐘）然後以 `TimedOut` 失敗。在依賴 Bash 步驟之前，請先在 **Runbooks → 設置 → 代理** 中添加代理。

## 保存與編輯

按 **保存步驟** 持久化。舊版本 Runbook 的進行中執行不受影響——它們繼續使用自己的快照。

## 多個步驟與失敗處理

默認情況下，失敗的步驟會中斷運行，把執行標記爲 `Failed`。如果你在某個步驟上設置了 **失敗時繼續**，失敗會被記錄但下一步仍會運行。這適合"試這三件事，然後通知"這種模式。

## 完整示例

一個簡單的"DB 主庫不可達" Runbook：

1. **JavaScript** — 從配置服務獲取當前主庫主機並記錄到日誌。
2. **Manual** — "確認副本上的複製延遲低於 5 秒。"
3. **HTTP 請求** — 向你的故障切換編排器 API POST。
4. **Manual** — "驗證寫入已轉向新主庫。"
5. **HTTP 請求** — 向 Slack POST 一條"恢復"消息。

響應者會看着一個自動步驟運行，勾選一個手動步驟，再看下一個自動步驟運行，以此類推。每個步驟的輸出都爲事後回顧被捕獲。
