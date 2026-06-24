# Runbook 代理程式

**Runbook 代理程式（Runbook Agent）** 是一個小型的自我託管程序，會 **在您自己的基礎架構內** 執行 runbook 的 Bash _與_ JavaScript 步驟。OneUptime Worker 永遠不會執行您的指令碼，它只會將指令碼排入佇列，而由步驟作者所選定的 Runbook 代理程式來認領、執行，並將結果回傳。

JavaScript 仍然在 `isolated-vm` 沙箱中執行，差別在於該沙箱位於您的代理程式主機上，而不是我們的主機上。

本頁說明如何安裝代理程式、將 Bash 與 JavaScript 步驟指向它，以及如何進行日常運維。

## 為什麼需要代理程式

OneUptime 較早的版本會在 Worker 上執行 Bash 與 JavaScript 步驟。JavaScript 有沙箱保護（透過 `isolated-vm`），Bash 則沒有。對於單一租戶自我託管以外的任何情境，兩者都有問題：

- **信任邊界。** 任何能夠撰寫 runbook 的人，都可以在 Worker 上執行程式碼，並能存取 Worker 所擁有的任何環境變數與檔案系統。JavaScript 沙箱能夠阻擋顯而易見的行為，但無法阻止有心人士探測從我們的網路所能觸及的範圍。
- **觸及範圍。** 大多數有用的步驟想要操作的是 _客戶的_ 基礎架構（「重新啟動這個服務」、「在我們的叢集上執行 kubectl」、「查詢我們內部資料庫中的某筆記錄」），而不是 OneUptime 的。

Runbook 代理程式將這一點反轉過來。Bash 與 JavaScript 步驟不會在我們這邊執行，而是在您所控制的主機上執行，並且由您決定該主機能做什麼。

## 運作方式

1. 您在 OneUptime 中建立一個 Runbook 代理程式。OneUptime 會產生一個 ID 與一把祕密金鑰。
2. 您在基礎架構內的某台主機上，使用該 ID/金鑰加上您的 OneUptime URL 來執行代理程式容器。
3. 代理程式每隔幾秒就會向 OneUptime 輪詢，詢問「有沒有我的工作？」
4. 當您撰寫 Bash 或 JavaScript 步驟時，您會從下拉選單中挑選代理程式，該步驟就會被綁定到那個特定的代理程式。
5. 當步驟執行時，Worker 會插入一筆作業列，並將 `targetAgentId` 設為該代理程式。只有那個代理程式才能認領它。
6. 代理程式會在本機執行該指令碼（Bash 使用 `bash -c <script>`，JavaScript 使用 `isolated-vm` 沙箱），擷取結果，並將其回傳。Worker 接著會帶著該結果繼續執行 runbook。

代理程式只需要對您的 OneUptime 執行個體進行 **對外的 HTTPS** 連線。它不接受任何對內的連線。

## 安裝代理程式

### 1. 建立代理程式記錄

前往 **Runbooks → Settings → Agents** 並建立一個新的代理程式。填入：

| 欄位            | 說明                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Name**        | 一個易記的名稱，通常採用 `where-it-runs-and-what-it-can-do` 形式，例如 `prod-eu-west-1`。撰寫步驟時，下拉選單中顯示的就是這個名稱。 |
| **Description** | 選填。用一句話描述這台主機能觸及哪些範圍。未來的你會感謝現在的你。                                                                  |

### 2. 複製安裝指令

建立代理程式後，在其所在列點選 **Show setup instructions**。您會看到一個已預先填入此代理程式 ID 與金鑰的 `docker run` 指令。**請立即儲存這把金鑰**，您稍後可以重設它，但在關閉此對話框之後，就無法再次檢視相同的金鑰值。

### 3. 在基礎架構內的某台主機上執行它

在您環境中任何能符合下列條件的主機上執行此 Docker 指令：

- 能透過 HTTPS 連到您的 OneUptime 執行個體，並且
- 能執行您希望 Bash/JavaScript 步驟所執行的事情（例如 SSH 連到其他主機、`kubectl`、與資料庫溝通）。

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. 確認代理程式已連線

回到 **Runbooks → Settings → Agents**。約在 60 秒內，該代理程式所在列應會切換為 `Connected`，並顯示一個最新的 **Last seen** 時間戳記。如果它仍維持在 `Disconnected`：

- 檢查容器記錄（`docker logs oneuptime-runbook-agent`），看看是否有驗證錯誤或網路失敗。
- 以 `curl` 確認該主機能連到您的 OneUptime URL。
- 確認 ID 與金鑰在複製時沒有夾帶空白字元。

## 將步驟指向代理程式

在您的 runbook 中，新增一個 Bash 或 JavaScript 步驟。表單上有一個 **Runbook Agent** 下拉選單，列出目前專案中的每一個代理程式（並附有已連線／未連線的指示）：

- 挑選應該執行此步驟的代理程式。
- 在下方的編輯器中撰寫您的指令碼。

當 runbook 執行並抵達該步驟時，Worker 會排入一筆以該代理程式 ID 為目標的作業。只有那個代理程式才能認領它。Bash 透過 `bash -c` 執行，JavaScript 則在代理程式上的 `isolated-vm` 沙箱中執行（無檔案系統、無網路、無 `Function`/`eval`）。

需要不只一個代理程式嗎？建立多個，再將個別步驟指向最適合的那一個。如果您想要備援，可以撰寫兩份 runbook（每個代理程式一份），或將步驟分散到不同的代理程式上。

## 運維注意事項

### 逾時

每個 Bash 或 JavaScript 步驟都套用兩種逾時設定：

| 逾時                  | 預設值 | 控制的內容                                                                                                                                                                |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claim timeout**     | 2 分鐘 | Worker 等待所選代理程式認領該作業的時間長度。如果代理程式未能及時接手，該步驟會以 `TimedOut` 失敗，而 runbook 會繼續往下執行（或停止，視 **Continue on failure** 而定）。 |
| **Execution timeout** | 30 秒  | 代理程式在終止指令碼之前，會讓它執行多久。可依步驟個別設定。（Bash 會收到 `SIGKILL`；JavaScript 的 isolate 會被拆除。）                                                   |

Worker 的整體等待時間區間為 `claim timeout + execution timeout + a few seconds`。請挑選符合該步驟的數值。

### 租約與心跳

當代理程式認領一筆作業時，會取得一份短期租約（預設為 30 秒）。在指令碼執行期間，代理程式每 10 秒會續訂一次租約。如果代理程式在指令碼執行到一半時當機或失去網路連線，租約便會到期，Worker 會將該作業標記為 `TimedOut`，而不是無止盡地等待。

租約到期時，Bash 子程序 **不會** 自動被取消（JavaScript isolate 若有結束的一天，也會被任其執行完畢），但 Worker 會停止等待它們，而且一旦另一個認領已接手，該代理程式就無法再提交結果。如果您在意「恰好執行一次」，請將指令碼設計成可以安全地重新執行。

### 沒有代理程式上線

如果步驟執行的當下，所選的代理程式處於離線狀態，該作業會維持在 `Pending`，直到 claim timeout 經過為止，接著以一則明確的「no agent claimed the job」訊息失敗。代理程式頁面就是您在認真執行 runbook 之前，用來確認涵蓋範圍的地方。

### 輸出上限

每個步驟合併後的 stdout + stderr 上限為 **50 KB**。超出的輸出會被截斷並加上標記。如果您需要完整記錄，請在指令碼內將它寫入 S3 或您的記錄儲存區，並 `echo` 出該 URL。

### 取消

取消一次 runbook 執行（從執行檢視畫面或 API）會立即將其所有 `Pending`／`Claimed`／`Running` 的 Bash 與 JavaScript 作業標記為 `Cancelled`。已在指令碼執行中的代理程式會完成它的工作，但其結果不會被伺服器接受。

### 並行

每個代理程式預設一次執行一筆作業。若要允許更多筆，請在代理程式容器上設定 `RUNBOOK_AGENT_CONCURRENCY`，但請記得該代理程式是與該主機上的其他任何東西共用這台主機的。

## 環境變數

代理程式在啟動時會讀取以下這些變數：

| 變數                                      | 是否必填 | 預設值  | 說明                                                                       |
| ----------------------------------------- | -------- | ------- | -------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                           | 是       | —       | 您 OneUptime 執行個體的基底 URL，例如 `https://oneuptime.yourdomain.com`。 |
| `RUNBOOK_AGENT_ID`                        | 是       | —       | 代理程式設定對話框中所顯示的 UUID。                                        |
| `RUNBOOK_AGENT_KEY`                       | 是       | —       | 代理程式設定對話框中所顯示的祕密金鑰。                                     |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`          | 否       | `5000`  | 代理程式輪詢新作業的頻率。                                                 |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`     | 否       | `60000` | 代理程式回報存活狀態的頻率。                                               |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | 否       | `10000` | 代理程式續訂執行中作業租約的頻率。                                         |
| `RUNBOOK_AGENT_CONCURRENCY`               | 否       | `1`     | 此代理程式上同時執行的作業數上限。                                         |

## 輪替代理程式金鑰

如果金鑰外洩，請在 OneUptime 中開啟該代理程式並重設其金鑰。舊金鑰會立即失效。請以新金鑰更新代理程式容器並重新啟動它。

## 權限

代理程式的管理隸屬於既有的 Runbooks 權限群組：

- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent` — 管理代理程式記錄。
- `RunbookAdmin`、`RunbookMember`、`RunbookViewer`（角色）— 指派給團隊，以分別授予完整控制、日常使用，或唯讀存取權限。`RunbookAdmin` 包含上述所有細部權限。

_觸發_ runbook（並因而導致 Bash 與 JavaScript 步驟被派發）的權限，仍然是 `CreateRunbookExecution` / `EditRunbookExecution`。

## 代理程式端 API

供有興趣者參考 — 代理程式使用這些端點，掛載在 `/runbook-agent-ingest` 之下。它們透過 JSON 主體中的代理程式 ID + 金鑰（或 `x-agent-id` / `x-agent-key` 標頭）進行驗證。

| 端點                         | 用途                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /heartbeat`            | 存活狀態；更新 `lastAlive`、`connectionStatus`、`hostInfo`、`agentVersion`。                                  |
| `POST /claim-next-job`       | 以不可分割的方式認領以此代理程式 ID 為目標、最舊的 `Pending` 作業。當沒有事情可做時，會回傳 `{ job: null }`。 |
| `POST /job/:jobId/heartbeat` | 更新作業的租約。一旦租約已逾期或作業已進入終態，便會回傳 404。                                                |
| `POST /job/:jobId/result`    | 提交最終結果。如果租約已經移轉，便會被忽略。                                                                  |

您應該不需要親手呼叫這些端點，內建的代理程式會處理。在此記錄它們，是為了讓您在內建代理程式無法符合您某項限制時，能夠打造自己的代理程式。
