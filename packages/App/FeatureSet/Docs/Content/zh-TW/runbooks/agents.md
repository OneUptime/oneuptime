# Runbook 代理程式

**Runbook 代理程式** 在儀表板中稱為 **Runner** ，是一個小型的自行託管處理程序，它 **在您自己的基礎架構中** 執行 Runbook 的 JavaScript、Bash、SSH 和 kubectl 步驟。OneUptime Worker 絕不會執行您的指令碼：它把指令碼放入佇列，由步驟作者選擇的 Runner 認領每項工作、執行它並傳回結果。本頁面向安裝和維運 Runner 的人員。 未選擇 Runner 的步驟會在您設定的 [專案預設 Runner](#專案預設-runner) 上執行；如果沒有設定，JavaScript 步驟會在 [全域 Runner](#全域-runner) 上執行，也就是 OneUptime 為所有專案執行的 Runner。

:::cards
- [安裝 Runner](#安裝-runner): 五個步驟，從儀表板到已連線的容器。
- [為步驟指定 Runner](#為步驟指定-runner): 把步驟繫結到應執行它的 Runner。
- [專案預設 Runner](#專案預設-runner): 未選擇 Runner 的步驟和程式碼儲存庫執行所在的 Runner。
- [全域 Runner](#全域-runner): OneUptime 為所有專案執行的 Runner，以及它們執行什麼。
- [逾時](#逾時): 認領逾時和執行逾時，以及兩者如何搭配。
- [環境變數](#環境變數): 容器啟動時讀取的內容。
:::

## 運作方式

```mermaid title="Runner 與 OneUptime 之間的網路往來"
flowchart TB
    subgraph cloud["OneUptime"]
        direction LR
        worker["Worker 將步驟放入佇列"]
        ingest["Runner API"]
    end
    subgraph yours["您的基礎架構"]
        direction LR
        runner["Runner 容器"]
        targets["主機、叢集、內部服務"]
    end
    worker --> ingest
    runner -->|"對外 HTTPS，Runner ID 和金鑰"| ingest
    ingest -->|"已認領的工作及其密鑰"| runner
    runner -->|"指令碼、SSH 或 Kubernetes API"| targets
```

1. 您在 OneUptime 中建立一個 Runner。OneUptime 會為它產生一個 ID 和一把秘密金鑰。
2. 您在自己基礎架構中的一台主機上執行 Runner 容器，並提供該 ID、金鑰和您的 OneUptime URL。
3. Runner 每 5 秒向 OneUptime 要求一次工作，每 60 秒回報一次自己仍在運作。
4. 撰寫 JavaScript、Bash、SSH 或 kubectl 步驟時，您從步驟 **更多欄位** 中的下拉式清單選擇 Runner。步驟會繫結到該 Runner。 未選擇 Runner 的步驟會在您設定的專案預設 Runner 上執行；如果沒有設定，JavaScript 步驟會在 **全域 Runner** 上執行。
5. 步驟執行時，Worker 會把一項 `targetAgentId` 設為該 Runner 的工作放入佇列。只有該 Runner 能認領它。
6. Runner 在本機執行該工作（Bash 和 kubectl 使用 `bash -c <script>`，JavaScript 使用 `isolated-vm` 沙箱，SSH 使用在機器上以 bash 執行指令碼的 SSH 連線），記錄結果，隱藏其中步驟的機密，然後回傳。Worker 用該結果繼續執行 Runbook。

Runner 只需要連到您 OneUptime 執行個體的 **對外 HTTPS** 。它不接受任何連入連線。

Runner 只保存自己的 ID 和金鑰。其餘一切都隨它認領的工作一起收到：已填入其引用的 [Runbook 變數](/docs/runbooks/variables) 的指令碼，以及 SSH 步驟的金鑰或密碼，或 kubectl 步驟的 kubeconfig。只有在機密允許時，它才會收到該機密。因此任何持有 Runner 金鑰的人都能以該 Runner 的身分行事：請像對待它可以使用的機密一樣對待這個金鑰。

## 為什麼指令碼在 Runner 上執行

在 OneUptime Worker 上執行指令碼有兩個問題：

- **信任邊界。** 任何能撰寫 Runbook 的人都能在 Worker 上執行程式碼，並存取 Worker 能存取的一切。
- **可及範圍。** 大多數有用的步驟作用於 _您的_ 基礎架構（「重新啟動這個服務」「在我們的內部資料庫中查詢一筆紀錄」），而不是 OneUptime 的。

有了 Runner，這些步驟會在您掌控的主機上執行，由您決定這台主機可以做什麼。HTTP 請求和 AI 步驟仍在 Worker 上執行，因為它們不需要您網路中的任何東西。

## 全域 Runner

全域 Runner 是 OneUptime 為所有專案執行的 Runner。未選擇自己 Runner 的 JavaScript 步驟會在其中一個上執行（除非專案有 [預設 Runner](#專案預設-runner) ），因此您可以在安裝任何東西之前就撰寫它。 **運行手冊 → Runbook 代理程式** 會在 **全域 Runner** 下列出它們，位於您自己的 Runner 上方；JavaScript 步驟的 **Runner** 下拉式清單會最先提供 **全域 Runner** ，或緊接在專案預設 Runner 之後提供。 Bash、SSH 或 kubectl 步驟的下拉式清單會把它以灰色顯示在最後，並顯示 **僅執行 JavaScript 步驟。** 這些步驟在您自己網路內的 Runner 上執行，絕不會在所有專案共用的 Runner 上執行。

| | 全域 Runner | 您自己的 Runner |
| --- | --- | --- |
| 執行的步驟 | JavaScript | JavaScript、Bash、SSH 和 kubectl |
| 步驟可以存取的位址 | 公用網際網路位址 | 其主機可以存取的位址 |
| 步驟的最長執行時間 | 5 分鐘 | 1 小時 |
| 機密變數 | 您允許全域 Runner 使用的那些 | 列出了它的那些 |
| OneUptime AI 的 Bash 指令 | 從不執行 | 選擇它的 AI 規則的指令 |
| OneUptime AI 的程式碼修復 | 不建置也不測試，直接開啟供審查 | 在拉取請求開啟前建置並測試 |

全域 Runner 會執行許多專案的步驟，因此每個步驟都與其他所有步驟彼此隔離：

- 每個步驟都在自己的 `isolated-vm` 沙箱中執行，這個沙箱為該步驟建立，並在步驟結束後丟棄：沒有檔案、沒有處理程序、沒有環境變數，也不會從一個步驟保留任何東西到下一個步驟。
- 它的 HTTP 請求只能到達公用網際網路位址，絕不會到達私人、回送或鏈路本機位址或雲端中繼資料端點，因此全域 Runner 永遠無法存取您的網路。
- 只有當機密變數的 **全域 Runner 可以使用** 開關開啟時，它才會收到該變數，而且只用於該變數所屬專案的步驟。
- 一個專案在全域 Runner 上同時最多執行三個步驟，因此沒有專案能獨占它們。

全域 Runner 也負責 OneUptime AI 的程式碼修復，涵蓋每個在 **全域 Runner** 上工作的程式碼儲存庫。它撰寫每個修復並開啟拉取請求，但不執行任何指令，連儲存庫的設定、建置與測試指令也不執行，因此拉取請求會說明其驗證已略過。它只透過 HTTPS 存取網際網路上的 Git 伺服器；但在自行託管的 OneUptime 上，它也可以存取伺服器本身可以存取的私有 Git 伺服器。它只為自己接手的修復工作，並且只在為某個儲存庫處理修復期間取得該儲存庫的權杖。GitHub 儲存庫的權杖只能存取那一個儲存庫，並會在修復結束時被撤銷。

對於需要存取您網路的步驟，或要讓步驟留在您掌控的主機上，請為它選擇您自己的 Runner。若要讓每個步驟都在您自己的 Runner 上執行，請在 **運行手冊 → Runbook 代理程式** 底部關閉 **使用全域 Runner** 。之後，未選擇 Runner 的 JavaScript 步驟會在專案預設 Runner 上執行；如果沒有設定預設 Runner，它會失敗並說明原因，直到它選擇您的某個 Runner；選擇了您的某個 Runner 的步驟無論如何都會保留它。在程式碼的設定中沒有選擇 Runner 的程式碼儲存庫同樣在專案預設 Runner 上工作，沒有設定預設 Runner 時在全域 Runner 上工作，而在關閉該開關時需要您的某個 Runner；請參閱 [程式碼](/docs/ai/ai-agent#選擇儲存庫的-runner)。

### 全域 Runner 從哪裡來

在 OneUptime Cloud 上，由 OneUptime 執行它們。自行託管的安裝預設會執行一個自己的全域 Runner，就像它執行自己的全域探測器一樣：Docker Compose 中的 `global-runner` 服務，以及 Helm chart 中的 `globalRunner` 部署。它持有自己的金鑰 `GLOBAL_RUNNER_KEY`，不持有伺服器的任何其他東西。

主管理員可以新增更多全域 Runner，以便從其他主機執行步驟與程式碼修復：在 Admin Dashboard 中依序開啟 **設定** 、 **全域 Runner** ，建立一個，然後在可以存取網際網路的主機上執行其 **顯示 ID 和金鑰** 提供的命令。

若要關閉內建的全域 Runner，請在 Docker Compose 的 `config.env` 中設定 `GLOBAL_RUNNER_REPLICAS=0`，或在 Helm chart 中將 `globalRunner.enabled` 設為 `false`。完全沒有全域 Runner 時， **運行手冊 → Runbook 代理程式** 只會列出您自己的 Runner，每個 JavaScript 步驟與每個程式碼儲存庫都要選擇其中一個。

## 開始之前

- 您基礎架構中 **一台安裝了 Docker 的主機** ，能透過 HTTPS 連到您的 OneUptime URL，並能連到步驟要操作的系統。
- **能建立 Runner 的角色。** Project Owner、Project Admin、Project Member 和 Runbook Admin 可以建立 Runner。只有 Project Owner、Project Admin 或 Runbook Admin 能看到 Runner 的金鑰，而安裝指令中包含這把金鑰。

## 安裝 Runner

### 1. 建立代理程式紀錄

前往 **運行手冊 → Runbook 代理程式** ，建立一個新的代理程式。點選 **建立Runner** ，在同一頁上填寫它的欄位：

| 欄位 | 位置 | 說明 |
| --- | --- | --- |
| **名稱** | 頁面上 | 易讀的名稱，通常寫明它在哪裡執行、能連到什麼，例如 `prod-eu-west-1`。撰寫步驟時您選擇的就是這個名稱。 |
| **描述** | 頁面上 | 選用。用一句話說明這台主機能連到什麼。 |
| **執行操作手冊** | **更多欄位** 下 | 預設開啟。讓此 Runner 認領 Runbook 步驟。 |
| **標籤** | **更多欄位** 下 | 選用。 |

Runner 會在下一次心跳時取得功能的變更，不需要重新啟動。AI 不是一項功能。程式碼儲存庫會在程式碼的設定中選擇 AI 在其中工作所用的 Runner，Runner 的頁面會列出選擇了它的儲存庫。AI 規則選擇 OneUptime AI 執行其指令所用的 Runner：正是在那裡選擇 Runner，才讓 OneUptime AI 的指令可以在其上執行。Runner 的頁面也會列出選擇了它的 AI 規則。

### 2. 複製安裝指令

在 Runner 所在列點選 **顯示設定說明** 。 **操作手冊代理程式設定** 對話方塊會顯示一個 `docker run` 指令，其中已包含該 Runner 的 ID 和金鑰。同樣的指令也位於 Runner 本身頁面的 **設定說明** 下。

只有 Project Owner、Project Admin 或 Runbook Admin 能讀取金鑰。其他人看到的不是指令，而是「您沒有檢視此操作手冊代理程式金鑰的權限」。

### 3. 在您基礎架構中的主機上執行

在您環境中符合以下條件的主機上執行該指令：

- 能透過 HTTPS 連到您的 OneUptime 執行個體，而且
- 能完成步驟所需的動作，例如透過 SSH 連到其他主機、呼叫叢集的 API 伺服器或與資料庫溝通。

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

### 4. 確認代理程式已連線

回到 **運行手冊 → Runbook 代理程式** 。容器啟動後一分鐘內，Runner 的 **狀態** 應顯示為 **已連線** ，並有新的 **上次出現** 時間。在 Runner 本身的頁面上， **操作手冊代理程式狀態** 卡片會顯示它的 **操作手冊代理程式版本** 和 **主機** 。如果一直顯示 **從未連線** 或 **已中斷** ，請參閱 [疑難排解](#疑難排解)。

### 5. 讓代理程式保持最新

當代理程式執行的版本比您的 OneUptime 舊時，其頁面上的 **操作手冊代理程式版本** 旁會出現警告標記。選擇它即可查看升級方式：拉取新的映像檔，移除容器，然後重新執行第 2 步的安裝指令。由 Kubernetes 代理程式的 Chart 安裝的代理程式，則改用該 Chart 升級。

```bash
docker pull oneuptime/runner:release
docker rm -f oneuptime-runner
```

## 為步驟指定 Runner

:::steps
### 新增在 Runner 上執行的步驟

在 Runbook 的 **步驟** 中新增 JavaScript、Bash、SSH 或 kubectl 步驟。

### 選擇 Runner

開啟步驟的 **更多欄位** ：其中的 **Runner** 下拉式清單會列出專案中的所有 Runner 以及它們是否已連線，摺疊後的那一行會顯示步驟執行所在的 Runner。如果專案中還沒有 Runner，步驟會提示這一點，並引導您前往 **Runbooks › Runners** 。 第一個選項就是未選擇 Runner 的步驟執行所在的位置：標有 **專案預設** 的 [專案預設 Runner](#專案預設-runner) ；如果沒有，對於 JavaScript 步驟則是 **全域 Runner** 。

### 儲存步驟

點選 **儲存步驟** 。執行到達該步驟時，Worker 會為該 Runner 的 ID 放入一項工作，只有該 Runner 能認領它。 選擇 **全域 Runner** 的步驟會等待任何一個空閒的全域 Runner。
:::

Bash 以 `bash -c` 執行。JavaScript 在 Runner 上的 `isolated-vm` 沙箱中執行，無法存取檔案系統或處理程序；它可以用 `axios` 呼叫公開的 HTTP API，但無法呼叫私人網路上的位址。SSH 和 kubectl 步驟使用機密 [Runbook 變數](/docs/runbooks/variables) 登入，該變數必須在 **可以使用它的 Runner** 中列出步驟的 Runner。

需要多個 Runner？分別建立，並為每個步驟指定合適的 Runner。若要備援，可以再執行一個 Runner 並把步驟分配給兩者，或者準備一個步驟指向另一個 Runner 的備用 Runbook。

## 專案預設 Runner

專案可以把自己的某個 Runner 設為預設，就像把某個 Twilio 設定設為預設一樣。之後，所有未選擇 Runner 的運行手冊步驟都會在它上面執行：Bash、SSH 和 kubectl 步驟，以及原本會在全域 Runner 上執行的 JavaScript 步驟。在程式碼的設定中沒有選擇 Runner 的程式碼儲存庫，其中的 AI 也在它上面工作。

若要把某個 Runner 設為預設，請前往 **運行手冊 → Runbook 代理程式** ，開啟該 Runner 所在列的 **⋯** 選單，點選 **設為專案預設** ，然後在對話方塊中確認。也可以開啟該 Runner，在它的 **專案預設值** 卡片上開啟 **用作專案預設** 。清單會在預設 Runner 的名稱旁標出 **專案預設** ，步驟的 **Runner** 下拉式清單也會在第一個選項上這樣標出。一個專案只有一個預設 Runner：把另一個 Runner 設為預設會取代它。同一選單中的 **不再用作專案預設** ，或 Runner 頁面上的開關，可以停止使用它。

未選擇 Runner 的步驟在哪裡執行：

| 專案 | JavaScript 步驟 | Bash、SSH 或 kubectl 步驟 |
| --- | --- | --- |
| 有預設 Runner | 預設 Runner | 預設 Runner |
| 沒有，並且使用全域 Runner | 全域 Runner | 無處可執行：步驟失敗，並說明它沒有 Runner |
| 沒有，並且不使用全域 Runner | 無處可執行：步驟失敗並說明原因 | 無處可執行：步驟失敗，並說明它沒有 Runner |

選擇了 Runner 的步驟無論預設是什麼都會保留它，JavaScript 步驟仍然可以自己選擇 **全域 Runner** 。設定預設 Runner 不會變更任何已儲存的步驟。

預設 Runner 必須是專案自己的、執行運行手冊步驟的 Runner：不能是全域 Runner，不能是 Kubernetes 代理程式安裝的叢集內 Runner，也不能是關閉了 **執行操作手冊** 的 Runner。只要某個 Runner 是預設 Runner，它的 **執行操作手冊** 就保持開啟。預設 Runner 未連線時，步驟的下拉式清單會提示這一點，在它上面的步驟會像對待任何 Runner 一樣等待它，直到 claim timeout 結束。

未選擇 Runner 的運行手冊步驟和程式碼儲存庫使用預設 Runner，並在另一個 Runner 成為預設時隨之轉移。AI 規則選擇自己的 Runner，新規則從預設 Runner 開始。

## 維運說明

### 逾時

在 Runner 上執行的每個步驟都有兩種逾時：

| 逾時 | 預設值 | 控制內容 |
| --- | --- | --- |
| **領取逾時** | 2 分鐘 | Worker 等待所選 Runner 認領工作的時間。如果 Runner 沒有及時認領，步驟會因逾時而失敗，Runbook 則繼續進行（或停止，取決於 **失敗時繼續** ）。 |
| **執行逾時** | 30 秒 | Runner 在停止步驟之前允許其執行的時間。Bash 會收到 `SIGKILL`；JavaScript 的沙箱會被拆除。 |

兩者都可以按步驟設定。開啟 **Runbooks › 您的 Runbook › 步驟** ，展開步驟，並在其 **更多欄位** 中填寫 **執行逾時** 和 **領取逾時** （以秒為單位）。留空則使用預設值。每種逾時都接受 1 秒到 1 小時；超出該範圍的值會在步驟執行時被限制在範圍內。

Worker 的總等待時間是 `claim timeout + execution timeout + a few seconds`。請選擇適合該步驟的值。

縮短 claim timeout 時要記得兩件事：

- Runner 依輪詢週期要求工作（`ONEUPTIME_RUNNER_POLL_INTERVAL_MS`，預設 5 秒）。短於一個週期的 claim timeout 可能在完全健康的 Runner 看到工作之前就已到期，此時步驟失敗時顯示的訊息與 Runner 離線時相同。
- Runner 預設一次執行一項工作（`ONEUPTIME_RUNNER_CONCURRENCY`）。當一個長步驟佔用它時，指向同一 Runner 的其他步驟會一直等到各自的 claim timeout 到期。如果您把某個 execution timeout 調高到幾分鐘，請相應調高共用該 Runner 之步驟的 claim timeout，或為它們指定另一個 Runner。

### 租約與心跳

```mermaid title="OneUptime 與其 Runner 之間的一項工作"
sequenceDiagram
    participant O as OneUptime
    participant R as Runner
    O->>O: 為此 Runner 將工作放入佇列
    R->>O: 認領下一項工作
    O-->>R: 附 30 秒租約的工作
    loop 執行期間每 10 秒
        R->>O: 續約
    end
    R->>O: 傳送結果
    O->>O: 記錄輸出並繼續執行
```

Runner 認領工作時會取得一個短租約（預設 30 秒）。步驟執行期間，Runner 每 10 秒續約一次。如果 Runner 在指令碼執行到一半時當機或失去網路，租約就會到期，Worker 會將工作標記為 `TimedOut`，而不是一直等待。

租約到期時，Bash 子處理程序 **不會** 被自動取消（JavaScript 沙箱如果能結束，也會被允許執行完畢），但 Worker 會停止等待它們，而且在另一次認領接手之後，Runner 便無法再提交結果。如果「剛好執行一次」對您很重要，請把指令碼設計成可以安全地重新執行。

### 如果 OneUptime Worker 在步驟進行中重新啟動

一次 Runbook 執行從開始到結束都在一個 Worker 上進行，因此部署或當機可能會在步驟進行中打斷它。接下來會發生什麼事，取決於執行是否會被重新認領：

- **執行恢復。** 認領它的 Worker 會找到您的步驟已經建立的工作，並 **重新連上它** 。它會等待這項工作，而不是再傳一份指令碼副本給您的 Runner。如果 Runner 已經完成，會直接使用記錄下來的結果。每次執行中，一個步驟最多只會傳送給 Runner 一次。
- **執行不恢復。** 如果執行再也沒有被認領，清理作業會在它超過目前步驟的認領和執行時間範圍後，將其標記為 `Failed`，並附上指出該步驟的訊息。執行永遠不會卡在 `Running`。

唯一無法得知的是：Worker 消失之前，指令碼執行到了哪裡。執行到一半的步驟會被回報為失敗，並附註它可能只執行了一部分：再次執行 Runbook 之前，請先檢查目標系統。

### 沒有在線的代理程式

如果步驟執行時所選的 Runner 離線，工作會以 `Pending` 等待到 claim timeout 結束，然後步驟失敗，訊息為「No runbook agent picked up this step before the wait window expired.」在正式執行 Runbook 之前，可以在 **Runbook 代理程式** 頁面上檢查涵蓋範圍。 全域 Runner 上的步驟則會失敗，訊息為「No global Runner picked up this step before the wait window expired.」

### 輸出上限

stdout 和 stderr 合計每個步驟上限為 **50 KB** 。更長的輸出會被截斷並加上標記。如果需要完整的記錄，請在指令碼中把它寫入記錄儲存區或物件儲存區，並用 `echo` 輸出其 URL。

### 取消

從執行頁面或 API 取消一次 Runbook 執行，會立即把它處於 `Pending`、`Claimed` 和 `Running` 的所有工作標記為 `Cancelled`。已經在執行指令碼的 Runner 會把工作做完，但伺服器不會接受結果，Runbook 中之後的步驟也不會再被送出。

### 並行

每個 Runner 預設一次執行一項工作。若要允許更多，請在容器上設定 `ONEUPTIME_RUNNER_CONCURRENCY`，但請記得，Runner 會與該主機上執行的其他一切共用這台主機。

## 環境變數

Runner 在啟動時讀取以下變數：

| 變數 | 必要 | 預設值 | 說明 |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | 是 | — | 您 OneUptime 執行個體的基礎 URL，例如 `https://oneuptime.yourdomain.com`。 |
| `ONEUPTIME_RUNNER_ID` | 是 | — | 安裝指令中的 Runner ID。 |
| `ONEUPTIME_RUNNER_KEY` | 是 | — | 安裝指令中的 Runner 秘密金鑰。 |
| `ONEUPTIME_RUNNER_POLL_INTERVAL_MS` | 否 | `5000` | Runner 要求新工作的頻率。低於 `1000` 的值會改用預設值。 |
| `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS` | 否 | `60000` | Runner 回報自己仍在運作的頻率。低於 `5000` 的值會改用預設值。 |
| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` | 否 | `10000` | Runner 為執行中的工作續約的頻率。低於 `1000` 的值會改用預設值。 |
| `ONEUPTIME_RUNNER_CONCURRENCY` | 否 | `1` | 此 Runner 上同時執行的工作數上限。 |
| `ONEUPTIME_RUNNER_ENABLE_RUNBOOKS` | 否 | — | 設為 `false` 可讓此 Runner 停止認領 Runbook 步驟，無論儀表板如何設定。它只能關閉此功能。 |
| `ONEUPTIME_RUNNER_ENABLE_CODE_FIXES` | 否 | — | 設為 `false` 可讓此 Runner 停止認領 AI 程式碼修復，即使是選擇了它的程式碼儲存庫。 |
| `ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS` | 否 | — | 設為 `false` 可讓此 Runner 停止執行 AI 修復指令，無論儀表板如何設定。 |

## 輪替代理程式金鑰

如果金鑰外洩，請重設它。舊金鑰會立即失效。

:::steps
### 重設金鑰

從 **運行手冊 → Runbook 代理程式** 開啟 Runner，點選 **重設操作手冊代理程式金鑰** 並確認。在取得新金鑰之前，Runner 將無法連線。

### 以新金鑰執行容器

從 Runner 的 **設定說明** 複製新指令，移除舊容器，然後在同一台主機上執行新指令：

```bash
docker rm -f oneuptime-runner
```

### 確認它重新連線

在 **運行手冊 → Runbook 代理程式** 下，Runner 的 **狀態** 會在一分鐘內恢復為 **已連線** 。
:::

## 權限

代理程式管理位於現有的 Runbooks 權限群組中：

- `CreateRunner`、`EditRunner`、`DeleteRunner`、`ReadRunner` —— 管理代理程式紀錄。
- `RunbookAdmin`、`RunbookMember`、`RunbookViewer`（角色）—— `RunbookAdmin` 建構 Runbook、其規則以及執行它們的 Runner，並執行 Runbook。`RunbookMember` 開啟 Runbook 及其執行並執行它們（啟動執行、完成或略過其步驟、取消執行），但不建立、變更或刪除任何 Runbook 或 Runner。`RunbookViewer` 只讀取 Runbook 及其執行，不執行任何東西。`RunbookAdmin` 包含上述所有細部權限。
- 全域 Runner 不屬於任何專案：只有主管理員可以在 Admin Dashboard 中新增、變更或移除全域 Runner。任何能讀取專案 Runner 的人都能看到它們，而關閉 **使用全域 Runner** 需要編輯專案的權限。

觸發 Runbook（從而把其步驟傳送給 Runner）需要一個執行 Runbook 的角色——`ProjectOwner`、`ProjectAdmin`、`ProjectMember`、`RunbookAdmin` 或 `RunbookMember`——或 `CreateRunbookExecution`；完成、略過或取消執行時也接受 `EditRunbookExecution`。角色只會執行其範圍所及的 Runbook。

只有 Project Owner、Project Admin 和 Runbook Admin 能讀取 Runner 的金鑰。

## 供代理程式使用的 API

供好奇的讀者參考：Runner 使用以下掛載在 `/runner-ingest` 下的端點。合併之前的路徑 `/runbook-agent-ingest` 仍會為尚未重新部署的代理程式提供服務，因此升級伺服器不會讓它們失效。它們使用 JSON 本文中的 Runner ID 和金鑰（`agentId` 和 `agentKey`），或標頭 `x-agent-id` 和 `x-agent-key` 進行驗證。

| 端點 | 用途 |
| --- | --- |
| `POST /heartbeat` | 存活訊號。更新 Runner 的上次出現時間、版本和主機資訊，並傳回專案授予它的功能。 |
| `POST /claim-next-job` | 以不可分割的方式認領指向此 Runner ID、最早的 `Pending` 工作。沒有工作時傳回 `{ job: null }`。 全域 Runner 則會認領正在等待任何全域 Runner 的最早步驟。 |
| `POST /job/:jobId/heartbeat` | 為工作續約。租約已到期或工作已結束時傳回 404。 |
| `POST /job/:jobId/result` | 提交最終結果。如果租約已經轉移，則忽略。 |
| `POST /disconnect` | 正常關閉時登出。 |

您不需要手動呼叫它們：Runner 容器會呼叫。在這裡記錄它們，是為了在我們的代理程式不符合您的限制時，您可以自行建構代理程式。

## 疑難排解

:::details Runner 一直顯示從未連線或已中斷
- 用 `docker logs oneuptime-runner` 檢查容器記錄中的驗證或網路錯誤。
- 確認主機能連到您的 OneUptime URL，例如使用 `curl`。
- 確認 ID 和金鑰在複製時沒有帶到空白，並且 `ONEUPTIME_URL` 是您開啟 OneUptime 時使用的位址。

**從未連線** 表示 Runner 從未回報過。 **已中斷** 表示它回報過，但過去 5 分鐘內沒有。
:::

:::details 步驟失敗，顯示「No runbook agent picked up this step before the wait window expired.」
步驟的 Runner 沒有在其 claim timeout 內認領工作。請確認 Runner 為 **已連線** 、已為它開啟 **執行操作手冊** ，以及它沒有被長步驟佔用：除非您調高 `ONEUPTIME_RUNNER_CONCURRENCY`，否則它一次只執行一項工作。短於輪詢間隔的 claim timeout 也會以同樣方式失敗。
:::

:::details 步驟失敗，顯示「The runbook agent stopped responding while this step was running.」
Runner 認領了工作，然後停止續約：它當機了、重新啟動了或失去網路。請確認它已上線，然後在再次執行 Runbook 之前檢查目標系統。
:::

:::details Runner 記錄顯示「No capability is enabled」
此 Runner 的所有功能都已關閉。請在 OneUptime 中 Runner 的頁面上開啟 **執行操作手冊** 。它會在下一次心跳時取得此變更。
:::

:::details 步驟失敗，因為其 Runner 不能使用某個機密變數
該步驟引用的機密變數不允許其 Runner 使用，因此 Runner 沒有收到它，步驟也沒有執行。錯誤會指出該機密以及需要修改的內容。在 **運行手冊 → 設定 → 全域變數** 或 Runbook 的 **設定 → 變數** 中，把該 Runner 加入 **可以使用它的 Runner** ，或者對於全域 Runner 上的步驟，開啟 **全域 Runner 可以使用** 。也可以選擇一個機密允許的 Runner。
:::

:::details kubectl 步驟失敗，因為其 Runner 太舊
步驟失敗並顯示 "This kubectl step runs a script, and this Runner is too old to run one, so it was not run." 早於 kubectl 指令碼的 Runner 無法執行指令碼。升級時遷移為 kubectl 指令碼的 Kubernetes 步驟，在其指令碼或 kubeconfig 被變更之前，仍會以撰寫時的操作在這樣的 Runner 上執行。按 [讓代理程式保持最新](#5-讓代理程式保持最新) 中的說明更新 Runner，然後再次執行 Runbook。
:::

## 後續步驟

:::cards
- [撰寫 Runbook](/docs/runbooks/authoring): 撰寫在您的 Runner 上執行的步驟。
- [Runbook 變數](/docs/runbooks/variables): 步驟使用的值和機密，以及接收它們的 Runner。
- [Runbook 設定與安全](/docs/runbooks/configuration): 限制、權限和強化。
:::
