# Runbook 代理

**Runbook 代理** 是一個小型的自託管進程，**在你自己的基礎設施內**執行 Runbook 的 Bash *和* JavaScript 步驟。OneUptime Worker 永遠不會自己執行你的腳本——它只把任務放入隊列，由步驟作者所挑選的 Runbook 代理把它們取走、執行，並將結果回報。

JavaScript 仍然在 `isolated-vm` 沙箱中運行；區別在於沙箱住在你的代理主機上，而不是我們這邊。

本頁說明如何安裝代理、如何把 Bash 與 JavaScript 步驟指向它，以及日常的運營。

## 爲什麼需要代理

更早版本的 OneUptime 把 Bash 和 JavaScript 步驟跑在 Worker 上。JavaScript 被沙箱化（通過 `isolated-vm`），Bash 則不是。兩者對單租戶自託管之外的任何場景都有問題：

- **信任邊界。** 任何能寫 Runbook 的人都能在 Worker 上執行代碼，並訪問 Worker 自己的環境變量與文件系統。JavaScript 沙箱擋住了明顯的攻擊，但擋不住一個有決心的用戶去探測從我們網絡可達的範圍。
- **觸達範圍。** 大多數有用的步驟想操作的是*客戶的*基礎設施（"重啓這個服務"、"在我們集羣上跑 kubectl"、"在我們內部數據庫裏查一條記錄"），而不是 OneUptime 的。

Runbook 代理把這件事翻轉過來。Bash 和 JavaScript 步驟不再跑在我們這裏。它們跑在你控制的主機上，而那臺主機能做什麼由你決定。

## 工作方式

1. 你在 OneUptime 中創建一個 Runbook 代理。OneUptime 會生成一個 ID 和密鑰。
2. 你在基礎設施內的主機上運行代理容器，傳入該 ID/密鑰以及你的 OneUptime URL。
3. 代理每隔幾秒鐘輪詢 OneUptime，問"我有活幹嗎？"
4. 當你編寫一個 Bash 或 JavaScript 步驟時，從下拉列表裏選定代理——這個步驟被綁定到那個特定的代理。
5. 步驟運行時，Worker 會插入一行任務，把 `targetAgentId` 設成那個代理。只有那個代理能領取它。
6. 代理在本地執行腳本——Bash 走 `bash -c <script>`，JavaScript 進 `isolated-vm` 沙箱——捕獲結果並回報。Worker 收到結果後繼續推進 Runbook。

代理只需要 **對外 HTTPS** 即可連到你的 OneUptime 實例。它不接受任何入站連接。

## 安裝代理

### 1. 創建代理記錄

進入 **Runbooks → 設置 → 代理** 並新建一個代理。填寫：

| 字段 | 說明 |
| --- | --- |
| **名稱** | 友好名 — 通常寫成 `它在哪運行、能做什麼`，例如 `prod-eu-west-1`。這就是寫步驟時下拉列表裏看到的名字。 |
| **描述** | 可選。用一句話說明這臺主機能觸達什麼。未來的你會感謝。 |

### 2. 複製安裝命令

創建代理後，在它那一行點 **顯示設置說明**。你會看到一個預填了該代理 ID 和密鑰的 `docker run` 命令。**現在就把密鑰保存好** — 之後可以重置它，但關閉對話框後就再也看不到同一份密鑰值。

### 3. 在基礎設施內的主機上運行

在你環境中能做到以下兩件事的任意一臺主機上運行 Docker 命令：

- 通過 HTTPS 觸達你的 OneUptime 實例，並且
- 做你希望 Bash/JavaScript 步驟做的事（例如 SSH 到其他主機、`kubectl`、與數據庫通信）。

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. 確認代理已連接

回到 **Runbooks → 設置 → 代理**。約 60 秒之內，這個代理的那一行應該切換到 `Connected`，並顯示新的 **最近活躍** 時間戳。如果它一直 `Disconnected`：

- 查看容器日誌（`docker logs oneuptime-runbook-agent`）尋找認證錯誤或網絡失敗。
- 用 `curl` 驗證主機能否觸達你的 OneUptime URL。
- 驗證 ID 與密鑰拷貝時沒有夾帶空白字符。

## 把步驟指向某個代理

在你的 Runbook 中添加一個 Bash 或 JavaScript 步驟。表單裏有一個 **Runbook 代理** 下拉框，列出當前項目裏的全部代理（帶連接/未連接標識）：

- 選定應當運行此步驟的代理。
- 在下方編輯器中編寫你的腳本。

Runbook 運行到該步驟時，Worker 會排入一條任務，目標即爲該代理的 ID。只有那個代理能領取。Bash 通過 `bash -c` 執行；JavaScript 跑在代理上的 `isolated-vm` 沙箱（無文件系統、無網絡、無 `Function`/`eval`）。

需要多個代理？把它們都建好，然後把不同步驟分別指向最合適的那個。如果你想要冗餘，可以寫兩個 Runbook（每個對應一個代理），或者把步驟拆到不同代理上。

## 運營注意事項

### 超時

每個 Bash 或 JavaScript 步驟會受兩個超時控制：

| 超時 | 默認值 | 控制的內容 |
| --- | --- | --- |
| **領取超時** | 2 分鐘 | Worker 等待被選定代理來領任務的時長。代理沒及時領的話，步驟會以 `TimedOut` 失敗，Runbook 繼續走（或停下，取決於 **失敗時繼續**）。 |
| **執行超時** | 30 秒 | 代理允許腳本運行的最長時間，到時會終止它。可按步驟配置。（Bash 收到 `SIGKILL`；JavaScript 的 isolate 被銷燬。） |

Worker 的整體等待窗口是 `領取超時 + 執行超時 + 幾秒`。挑能配得上步驟的數字。

### 租約與心跳

代理領到任務時會獲得一段短的租約（默認 30 秒）。腳本運行期間，代理每 10 秒續約一次。如果代理在腳本運行途中死掉或斷網，租約到期後 Worker 會把任務標記爲 `TimedOut`，而不是無限等待。

租約到期時 Bash 子進程**並不會**被自動取消（JavaScript 的 isolate 也會被放任跑完）——但 Worker 不再等它們，而且一旦有別的領取接管之後，代理也無法再提交結果。如果你在意"恰好一次"，請把腳本設計成可以安全重跑。

### 沒有在線代理時

如果步驟運行那一刻被選中的代理是離線的，任務會保持 `Pending` 直到領取超時到點，然後以一條清晰的"沒有代理領取任務"信息失敗。在正經上 Runbook 之前，去代理頁面確認覆蓋情況。

### 輸出上限

每步合併的 stdout + stderr 上限是 **50 KB**。更大的輸出會被帶標記截斷。如果你需要完整日誌，在腳本里把它寫到 S3 或你的日誌儲存，然後 `echo` 那個 URL。

### 取消

取消 Runbook 執行（從執行視圖或 API）會立即把其中所有 `Pending`/`Claimed`/`Running` 的 Bash 與 JavaScript 任務標爲 `Cancelled`。已經在跑腳本的代理仍會跑完手頭的活，但它的結果不會被服務器接受。

### 併發

每個代理默認一次只跑一個任務。要允許更多，在代理容器上設置 `RUNBOOK_AGENT_CONCURRENCY` — 但記住代理是和該主機上其他東西共享資源的。

## 環境變量

代理在啓動時讀取以下變量：

| 變量 | 必填 | 默認值 | 說明 |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | 是 | — | 你的 OneUptime 實例基礎 URL，例如 `https://oneuptime.yourdomain.com`。 |
| `RUNBOOK_AGENT_ID` | 是 | — | 代理設置對話框中顯示的 UUID。 |
| `RUNBOOK_AGENT_KEY` | 是 | — | 代理設置對話框中顯示的密鑰。 |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | 否 | `5000` | 代理輪詢新任務的頻率。 |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | 否 | `60000` | 代理上報存活的頻率。 |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | 否 | `10000` | 代理爲運行中任務續約的頻率。 |
| `RUNBOOK_AGENT_CONCURRENCY` | 否 | `1` | 該代理上最多同時跑的任務數。 |

## 輪換代理密鑰

如果密鑰泄漏，到 OneUptime 中打開該代理並重置其密鑰。舊密鑰會立即失效。用新密鑰更新代理容器並重啓。

## 權限

代理管理位於現有 Runbooks 權限組之下：

- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent` — 管理代理記錄。
- `RunbookAdmin`、`RunbookMember`、`RunbookViewer`（角色） — 分配給團隊以分別授予完整控制、日常使用或只讀訪問。`RunbookAdmin` 把上面所有細粒度權限打包在一起。

*觸發* Runbook（從而讓 Bash 與 JavaScript 步驟被派發）的權限仍是 `CreateRunbookExecution` / `EditRunbookExecution`。

## 面向代理的 API

供好奇者參考——代理使用以下端點。所有端點都掛在 `/runbook-agent-ingest` 下，通過 JSON 體裏的代理 ID + 密鑰（或 `x-agent-id` / `x-agent-key` 頭）認證。

| 端點 | 用途 |
| --- | --- |
| `POST /heartbeat` | 存活上報；更新 `lastAlive`、`connectionStatus`、`hostInfo`、`agentVersion`。 |
| `POST /claim-next-job` | 原子性地領取目標爲該代理 ID 的最早一條 `Pending` 任務。沒有可做的事時返回 `{ job: null }`。 |
| `POST /job/:jobId/heartbeat` | 續約任務租約。租約已失效或任務終止時返回 404。 |
| `POST /job/:jobId/result` | 提交最終結果。如果租約已經轉移，會被忽略。 |

你不需要手動調這些 API — 自帶的代理會做。把它們記在這裏是爲了在我們的代理不滿足你某個約束時，你能寫自己的代理。
