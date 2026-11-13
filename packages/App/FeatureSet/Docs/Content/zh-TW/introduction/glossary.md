# 詞彙表

OneUptime 使用的每個詞彙，都用一兩句話說明，並附上它的其他名稱，以及完整介紹它的頁面。這些詞彙依照你接觸它們的順序分組：第一組是每個專案都會經歷的流程，最後一組是有多種意思的詞彙。

:::cards
- [從這裡開始](#從這裡開始): 每個專案都會經歷的流程，從監測器到呼叫，再到狀態頁面。
- [你監看的對象](#你監看的對象): 服務、主機、叢集、雲端，以及你為它們設定的目標。
- [處理問題](#處理問題): 狀態、嚴重程度、擁有者和標籤，以及其他類型的問題。
- [遙測和儀表板](#遙測和儀表板): 你的系統傳送什麼，以及要在哪裡查看。
- [自動化與 AI](#自動化與-ai): 哪些會自動執行，以及 OneUptime AI 會做什麼。
- [你安裝的元件和金鑰](#你安裝的元件和金鑰): 你執行的代理程式，以及每個代理程式使用的金鑰。
- [有多種意思的詞彙](#有多種意思的詞彙): 規則、角色、資源、設定，以及其他身兼數職的詞彙。
:::

## 從這裡開始

### 專案

你設定的一切都存放在這裡：監測器、事件、待命、狀態頁面、遙測和設定。一個專案中的任何內容在另一個專案中都看不到，大多數公司只需要一個專案。

參閱 [核心概念](/docs/introduction/core-concepts#專案和人員)。

### 帳戶

就是你自己：你用來登入的電子郵件和密碼，以及你的姓名、時區和語言。一個帳戶可以屬於任意數量的專案。

參閱 [您的帳戶](/docs/introduction/your-account)。

### 團隊

專案中的一群人，團隊的權限決定其成員可以做什麼。每個新專案一開始都有三個團隊：Owners、Admin 和 Members。在 **使用者** 下邀請成員，並在 **團隊** 下將他們分組。

參閱 [使用者、團隊與權限](/docs/permissions/index)。

### 監測器

檢查你所執行的某一樣東西，例如網站、API、伺服器或 Kubernetes 叢集，並判斷它是否正常運作。當它的條件相符時，它會變更自己的狀態，並可以宣告事件或建立警示。

參閱 [建立監測器](/docs/monitor/create-monitor)。

### 條件

監測器的規則：每個檢查結果代表什麼。條件會依序檢查，第一個相符的條件可以變更監測器的狀態、宣告事件、建立警示，或三者都做。

又稱：**監測條件**、**監測器條件**、**Monitor Steps**。參閱 [條件與狀態](/docs/monitor/criteria-and-statuses)。

### 監測器狀態

監測器此刻的狀況。每個新專案都有三種監測器狀態：**運作中**、**效能下降** 和 **離線**，你也可以新增自己的狀態。

參閱 [條件與狀態](/docs/monitor/criteria-and-statuses)。

### 探測器

依排程執行監測器檢查的機器：它會請求頁面、呼叫 API 或 ping 主機。OneUptime Cloud 在多個區域執行探測器，而你在自己網路中執行的自訂探測器，可以檢查只有該網路才能連到的內容。

又稱：**自訂探針**。參閱 [自訂探針](/docs/probe/custom-probe)。

### 事件

影響使用者的問題，例如服務中斷或變慢，也是問題持續期間團隊據以工作的紀錄。它可以呼叫待命人員，並顯示在你的狀態頁面上。

參閱 [事件概觀](/docs/incidents/index)。

### 警示

需要團隊在使用者察覺之前調查的問題，例如快要寫滿的磁碟或即將到期的憑證。它可以呼叫待命人員，但絕不會顯示在狀態頁面上。

參閱 [警示概觀](/docs/alerts/index)。

### 片段

一組相關的事件或相關的警示，團隊把它們當作一個整體處理，共用一組擁有者和一個狀態。分組規則決定哪些屬於同一個片段。

又稱：**事件片段**、**警示片段**。參閱 [片段](/docs/incidents/episodes)。

### 待命策略

決定針對事件、警示或片段呼叫誰，以及沒人確認時下一個呼叫誰。它的各個層級就是上報規則。

又稱：**待命**、**On-Call Duty Policy**、`OnCallDutyPolicy`。參閱 [待命策略](/docs/on-call/policies)。

### 上報規則

待命策略的一個層級：呼叫誰，以及在呼叫下一個層級之前要等多久讓人確認。一個層級可以呼叫人員、團隊或待命排程。

參閱 [上報規則](/docs/on-call/escalation-rules)。

### 待命排程

任何時刻由誰待命：大家輪流待命，每個人再交接給下一個人。呼叫某個排程的上報規則，會呼叫該排程中目前待命的人。

又稱：**Rotation**、**待命策略排程**。參閱 [待命排程](/docs/on-call/schedules)。

### 層

待命排程中的一個輪值：誰輪流待命、多久交接一次，以及它涵蓋哪些時段。有人待命的最上層會被呼叫，因此主要輪值放在最上面，備援待命放在下面。

參閱 [待命排程](/docs/on-call/schedules#層)。

### 通知方式

OneUptime 在專案中可以聯絡到你的位址：電子郵件地址、用於簡訊或電話的電話號碼、你的 Slack 或 Microsoft Teams 帳戶，或你手機上的 OneUptime 應用程式。每個人都在 **使用者設定** 下新增自己的通知方式。

參閱 [通知方式](/docs/notifications/notification-methods)。

### 如何聯絡我

你自己的被呼叫規則：呼叫時要嘗試你的哪些通知方式，以及間隔多久。一個階梯適用於每個事件、警示和片段，某個嚴重程度也可以有自己的規則。每個人在 **使用者設定** 下設定自己的規則。

又稱：**個人待命規則**。參閱 [如何聯絡我](/docs/notifications/on-call-rules)。

### 狀態頁面

向客戶展示你的服務是否正常運作，以及影響它們的事件和維護的頁面。它可以是公開的，也可以只對你允許的人開放。

參閱 [狀態頁概觀](/docs/status-pages/index)。

### 訂閱者

透過電子郵件、簡訊、Slack、Microsoft Teams 或 Webhook 追蹤某個狀態頁面的人，當頁面上的事件或維護開始、變更和結束時，他們會收到通知。

參閱 [訂閱者與公告](/docs/status-pages/subscribers)。

### 排定維護

事先公告的計畫性工作。每個維護事件會依序經歷維護狀態 **已排定**、**進行中**、**已結束** 和 **已完成**，顯示它的狀態頁面會告知訪客和訂閱者。

又稱：**排定維護事件**、**排定事件**、**事件**。參閱 [排定維護概觀](/docs/scheduled-maintenance/index)。

### 遙測

你的系統傳送給 OneUptime 的內容：日誌、指標、追蹤、例外狀況和效能剖析資料。應用程式透過 OpenTelemetry 傳送，OneUptime 的代理程式則從主機、叢集和其他基礎設施傳送，每個傳送端都使用一把擷取金鑰。

參閱 [OpenTelemetry](/docs/telemetry/open-telemetry)。

## 你監看的對象

### 監測器群組

把多個監測器彙總為一個狀態（取其中最差的），並擁有自己的正常運作時間。狀態頁面可以把整個群組顯示為一列。在 **專案設定 → 進階 → 功能旗標** 下開啟監測器群組。

參閱 [監測器群組](/docs/monitor/monitor-groups)。

### 服務

你執行的應用程式或微服務。它的遙測第一次到達時，OneUptime 會新增它，以它的 `service.name` 命名，並把它的日誌、追蹤、指標、例外、事件和擁有者彙集到一個頁面上。

又稱：**服務目錄**、**遙測服務**。參閱 [服務](/docs/telemetry/services)。

### 主機

透過 OpenTelemetry Collector 傳送其指標、處理程序、日誌和服務狀態的 Linux、Windows 或 macOS 機器。**新增主機** 用一個指令安裝收集器，OneUptime 會讓它的設定保持最新。

參閱 [主機](/docs/telemetry/hosts)。

### Kubernetes

你的 Kubernetes 叢集，以及它們的節點、Pod、工作負載、事件和日誌，由你用 Helm 安裝的 Kubernetes 代理程式傳送。

參閱 [Kubernetes 代理程式](/docs/telemetry/kubernetes-agent)。

### 基礎設施

選單中彙集你所執行的機器和平台的一組項目：主機、Kubernetes、Docker、Docker Swarm、Podman、Proxmox、OpenStack、VMware、Ceph、儲存陣列、網路和 IoT。每一項都由代理程式或連線填入，並顯示其中每台機器、每個叢集或每台裝置的運作狀況。

參閱 [主機](/docs/telemetry/hosts)。

### 網路

你的交換器、路由器、防火牆、無線基地台，以及網路上任何有位址的裝置，無論它是否支援 SNMP。

參閱 [網路設備監控](/docs/monitor/network-device-monitor)。

### 雲端

你的 AWS 帳戶、Azure 訂用帳戶和 Google Cloud 專案，從儀表板連線。OneUptime 會列出其中的每項資源，讀取它們的關鍵指標，並記錄其中發生的變更。

參閱 [連線雲端帳戶](/docs/telemetry/cloud-accounts)。

### 應用程式平台

你在代管平台上執行的應用程式，例如 Amazon ECS 和 Fargate、Google Cloud Run 以及 Azure App Service。它們執行的每個地方都是一個雲端環境，OneUptime 會在其遙測第一次到達時建立它。

又稱：**雲端環境**。參閱 [雲端環境](/docs/telemetry/cloud-environments)。

### 無伺服器

你的無伺服器函式，例如 AWS Lambda、Google Cloud Functions 和 Azure Functions，一旦它們的 OpenTelemetry 資料到達，就會連同其追蹤、日誌和指標一起列出。

又稱：**無伺服器函式**。參閱 [無伺服器函式](/docs/telemetry/serverless-functions)。

### 資料庫

你的應用程式查詢的每個資料庫，由你的追蹤、資料庫本身的指標以及 OneUptime 能讀取的其他來源彙整而成，並顯示其引擎的運作狀況。

參閱 [資料庫](/docs/telemetry/databases)。

### 佇列

你的服務使用的訊息佇列和主題，例如 Apache Kafka、RabbitMQ 和 Amazon SQS，資訊來自你的追蹤和訊息代理的指標。

參閱 [佇列](/docs/telemetry/queues)。

### 真實使用者監測

真實使用者在你的 Web 和行動應用程式中的體驗：頁面載入、請求、錯誤和 Core Web Vitals，由應用程式本身而非探測器回報。

參閱 [RUM 概觀](/docs/rum/index)。

### 清單

一份清單，彙整了 OneUptime 對你的環境所知道的一切：服務、主機、Kubernetes 物件、虛擬機器、網路裝置、雲端資源，以及完全不傳送遙測的東西。其中大部分會自動填入。

參閱 [資產清單概觀](/docs/inventory/overview)。

### 拓撲

一張呈現你的系統如何相互連接的地圖：哪些服務呼叫哪些服務、什麼在哪裡執行，根據你已經傳送的遙測繪製。

參閱 [拓撲](/docs/telemetry/topology)。

### SLO

為你所監控的對象設定的可靠性目標，例如在 30 天內 99.9% 的時間可用。OneUptime 每 5 分鐘根據其監測器測量一次每個 SLO。

又稱：**Service Level Objective**。參閱 [SLO 概觀](/docs/slo/introduction)。

### 錯誤預算

SLO 的目標所允許的停機時間：目標為 30 天內 99.9% 時，就是 43 分 12 秒。餘裕充足時可以承擔風險；餘裕不多時，就要放慢腳步，投入穩定性。

參閱 [錯誤預算](/docs/slo/error-budget)。

## 處理問題

### 狀態

事件或警示在你的應變中進行到哪一步。每個新專案一開始都有 **已識別**、**已確認** 和 **已解決**：確認表示已經有人在處理，並阻止呼叫下一個上報層級；解決則將其關閉。

又稱：**事件狀態**、**警示狀態**。參閱 [事件狀態與嚴重程度](/docs/incidents/states-and-severities)。

### 嚴重程度

事件或警示有多重要。新專案一開始為事件提供 Critical Incident、Major Incident 和 Minor Incident，為警示提供 **高** 和 **低**；你可以重新命名、變更顏色或新增自己的嚴重程度。

又稱：**事件嚴重性**、**警示嚴重性**。參閱 [事件狀態與嚴重程度](/docs/incidents/states-and-severities)。

### 擁有者

對某筆紀錄（例如監測器、事件或狀態頁面）負責的人員或團隊。當他們擁有的內容發生狀況時，擁有者會收到通知。

參閱 [標籤與擁有者規則](/docs/configuration/label-and-owner-rules)。

### 標籤

一種標記，例如 Production 或 Checkout，你把它加在監測器、事件、狀態頁面和大多數其他紀錄上，用於篩選和分組。團隊的權限可以限定在帶有某些標籤的紀錄上。

參閱 [標籤與擁有者規則](/docs/configuration/label-and-owner-rules)。

### 例外

你的程式碼擲回的錯誤。OneUptime 把同一個錯誤的每次發生歸為一個例外，並附上它的堆疊追蹤、趨勢以及發生它的請求。

又稱：**例外狀況追蹤**、`/telemetry-exception`。參閱 [例外](/docs/telemetry/exceptions)。

### AI 洞察

OneUptime 在任何呼叫發生之前就在你的遙測中發現的問題：新出現和激增的例外、錯誤日誌暴增、變慢的追蹤、指標漂移，以及讓情況變糟的部署。洞察絕不會呼叫任何人，也絕不會開啟事件；它們會在收件匣中等待，直到有人查看。產品或紀錄的 AI 區段中的 **洞察** 頁面，是 OneUptime AI 在那裡學到的內容。

又稱：**洞察**。參閱 [AI SRE](/docs/ai/ai-sre#洞察主動偵測)。

### 安全事件

OneUptime 的 SIEM：來自你的日誌、安全工具以及你傳送的其他任何內容的安全事件，以統一的格式保存在你的遙測旁邊，並透過偵測規則從中找出威脅。

又稱：**SIEM**。參閱 [安全性事件(SIEM)](/docs/telemetry/security-events)。

### 安全案例

一件值得調查的事，來自偵測規則、威脅情資或已連線的資安產品，關於同一個使用者、主機或位址的每次偵測都歸入其中。分析師在佇列中處理案例，劇本則對其做出回應。

又稱：**案例**。參閱 [安全案件與劇本(SOAR)](/docs/telemetry/security-cases)。

## 遙測和儀表板

### 日誌

你的服務、主機和代理程式寫下的日誌行，你可以在日誌瀏覽器中搜尋它們，並用日誌監測器監看它們。

參閱 [日誌瀏覽器](/docs/telemetry/logs-explorer)。

### 指標

你的服務和基礎設施隨時間回報的數值，例如請求數、延遲、CPU 和佇列深度。

參閱 [指標瀏覽器](/docs/telemetry/metrics-explorer)。

### 追蹤

一個請求逐步通過你的服務的路徑。每一步都是一個 span，帶有它的耗時和結果。

參閱 [追蹤瀏覽器](/docs/telemetry/traces-explorer)。

### 效能剖析

你的應用程式如何逐一函式地使用 CPU 時間和記憶體，由推送到 OneUptime 的 Pyroscope 相容 API 的效能剖析器傳送。

又稱：**效能設定檔**、**持續效能剖析**。參閱 [效能剖析](/docs/telemetry/profiles)。

### AI / LLM

你的 AI 應用程式和代理程式進行的對話：每次模型呼叫，連同其權杖數、成本、延遲、提示和回答，根據你的應用程式傳送的 OpenTelemetry span 建立。

又稱：**AI / LLM 可觀察性**。參閱 [AI / LLM 可觀測性](/docs/telemetry/ai-llm-observability)。

### 資料可觀測性

監看你的資料庫和資料倉儲中的資料表，在資料延遲、遺漏或錯誤時通知你，並指出是哪次執行、哪次部署或哪張資料表造成的。

參閱 [資料可觀測性概覽](/docs/data-observability/index)。

### 資料安全

找出你的公司保存的敏感資料，無論它們在雲端儲存貯體、資料庫、資料倉儲還是你傳送的遙測中，並告訴你它們的保存方式有什麼問題。

參閱 [資料安全概覽](/docs/data-security/index)。

### 儀表板

由你自行擺放的小工具組成的頁面：指標、日誌和追蹤的圖表，事件和監測器的清單，你的 SLO 等等。在你分享之前，儀表板只有你的專案看得到。

參閱 [儀表板概觀](/docs/dashboards/index)。

### Public Dashboard

透過公開連結分享的儀表板，給不登入你專案的人查看。你可以用密碼保護它、限制只有某些 IP 位址可以存取，或在你自己的網域上代管它。

參閱 [共用與公開儀表板](/docs/dashboards/sharing)。

## 自動化與 AI

### 工作流程

不需撰寫程式碼的自動化：畫布上的區塊在其觸發器觸發時執行，例如在宣告事件時發文到 Slack，或呼叫另一個工具。

參閱 [工作流程概觀](/docs/workflows/index)。

### 操作手冊

可重複使用的應變程序：團隊在事件、警示或維護活動上執行的手動和自動步驟，可以手動執行，也可以在 Runbook 規則相符時自動執行。

參閱 [Runbook 概觀](/docs/runbooks/index)。

### 劇本

回應安全案例的步驟，例如保全證據、呼叫待命人員或停用某個使用者，可以自動執行，也可以一鍵執行。

又稱：**安全劇本**。參閱 [安全案件與劇本(SOAR)](/docs/telemetry/security-cases#劇本)。

### AI 規則

決定 OneUptime AI 調查並修復哪些新的事件或警示，以及如何處理。沒有 AI 規則時，它會調查每一個，因此大多數專案都不需要 AI 規則。

又稱：**自動修復規則**。參閱 [AI SRE](/docs/ai/ai-sre#哪些事件會被調查和修正)。

### OneUptime AI

OneUptime 的 AI 網站可靠性工程師：它會在你的遙測中調查每個新的事件和警示，並把發現發布到它們的時間軸上。**專案設定** 中的 **啟用 AI** 開關可以把它全部關閉。

又稱：**AI SRE**。參閱 [AI SRE](/docs/ai/ai-sre)。

### 詢問 AI

以你專案資料為基礎的對話。它會查詢你的日誌、追蹤、指標、事件、監測器等，並為每項陳述附上引用來源。

又稱：**聊天**。參閱 [詢問 AI](/docs/ai/ask-ai)。

### 程式碼

你在這裡請 OneUptime AI 在你的程式碼儲存庫中工作，就像請程式設計代理程式幫忙一樣：修復錯誤、撰寫測試或進行變更，然後收到一個 pull request。

又稱：**任務**。參閱 [程式碼](/docs/ai/ai-agent)。

### 表單

任何擁有連結的人都可以填寫的頁面，不需要帳戶。每次提交都會建立一個事件（用於問題回報）或一個排定維護事件（用於變更請求）。

參閱 [表單概覽](/docs/forms/index)。

## 你安裝的元件和金鑰

### 基礎設施代理程式

Server / VM 監測器背後的 `oneuptime-infrastructure-agent` 服務：它每 30 秒回報一次一台機器的 CPU、記憶體、磁碟和處理程序，並以該監測器的秘密金鑰簽署。

參閱 [伺服器 / 虛擬機器監控](/docs/monitor/server-monitor)。

### Kubernetes 代理程式

一個 Helm chart，用於收集叢集的指標、事件和 Pod 日誌，並透過 eBPF 收集其追蹤，再用擷取金鑰傳送。

參閱 [Kubernetes 代理程式](/docs/telemetry/kubernetes-agent)。

### OpenTelemetry Collector

接收、處理和傳送遙測的開源代理程式。**新增主機** 會把它安裝到機器上，Docker 代理程式也是這樣的收集器，而你自己的收集器則用擷取金鑰傳送到 OneUptime。

又稱：**收集器**。參閱 [主機](/docs/telemetry/hosts) 和 [主機 OpenTelemetry Collector](/docs/telemetry/host-otel-collector)。

### Runner

你在自己的基礎設施中執行的小型程序，負責執行操作手冊中的 JavaScript、Bash、SSH 和 kubectl 步驟。它使用自己的 Runner ID 和金鑰對外連線到 OneUptime。

又稱：**Runbook 代理程式**。參閱 [Runbook 代理程式](/docs/runbooks/agents)。

### 擷取金鑰

讓某樣東西能把遙測傳送到你專案的金鑰：使用 OpenTelemetry 的應用程式、收集器和代理程式。它放在 `x-oneuptime-token` 標頭中，專案的 API 金鑰無法取代它。

又稱：**遙測擷取 Key**、`oneuptime.apiKey`。參閱 [擷取金鑰](/docs/telemetry/ingestion-keys)。

### API 金鑰

一種金鑰，讓指令碼、CLI、Terraform 或 AI 助理透過 API 讀取和變更你的專案，權限由你授予。在 **專案設定 → 進階 → API 金鑰** 下建立。

參閱 [使用者、團隊與權限](/docs/permissions/index#api-金鑰)。

## 有多種意思的詞彙

### 規則

OneUptime 中有許多東西都是規則，每一種都替你做一個決定：呼叫誰（**待命規則**、**上報規則**），誰擁有新紀錄以及要加上什麼標籤（**擁有者規則**、**標籤規則**），哪些屬於同一組（**分組規則**），以及 OneUptime AI 做什麼（**AI 規則**）。監測器本身的規則就是它的條件。

參閱 [核心概念](/docs/introduction/core-concepts#規則的種類)。

### 角色

四種不同的東西：團隊授予的權限，例如 Project Owner 或 Project Admin；你用權限組合而成的 **自訂角色**；**事件角色**，也就是某人在一次事件中擔任的職責；以及 **Network Device Role**，也就是網路上某台裝置的用途。

參閱 [使用者、團隊與權限](/docs/permissions/index)。

### 資源

最常見的是指 OneUptime 記錄的基礎設施，例如主機、叢集、資料庫和雲端資源。事件的 **受影響的資源** 是它涉及的監測器和基礎設施，狀態頁面的資源是它顯示的監測器和群組，而 OpenTelemetry 的資源屬性則說明遙測來自哪裡。

參閱 [資產清單概觀](/docs/inventory/overview)。

### 設定

每個層級都有自己的設定：針對整個專案的 **專案設定**、決定 OneUptime 如何聯絡你的 **使用者設定**，以及產品側邊選單中它自己的 **設定**，例如 **事件** 下的事件狀態和範本。自架伺服器的設定位於 Admin Dashboard 中。

參閱 [專案設定](/docs/configuration/project-settings)。

### 策略

最常見的是 **待命策略**：呼叫誰，以及下一個是誰。來電策略為你的團隊提供一個會撥給待命人員的電話號碼，而錯誤預算策略則寫明 SLO 的預算即將用完時，你的團隊要做什麼。

參閱 [待命策略](/docs/on-call/policies)。

### 範本

儲存下來的起點：監測器範本用來建立監測器，事件和警示範本用來填入新紀錄，備註和事後分析範本為你要寫的內容起個頭，儀表板範本則建立儀表板的小工具。

參閱 [監測器範本](/docs/monitor/monitor-templates)。

### 工作區

你在 **工作區連線** 下連線到 OneUptime 的 Slack 或 Microsoft Teams 工作區，用來把更新發布到你的頻道，並在聊天中處理事件。其他一些工具所說的工作區，在 OneUptime 中就是專案。

參閱 [Slack](/docs/workspace-connections/slack)。

### 代理程式

你安裝的、向 OneUptime 回報或代表它採取行動的程式：基礎設施、Kubernetes 和 Docker 代理程式會傳送它們收集的資料，Runner 執行操作手冊步驟，AI 代理程式則讓 OneUptime AI 查看叢集或主機。你交給 **程式碼** 的任務就是 AI 代理程式任務。

參閱 [該用哪一個？](/docs/introduction/which-one#探測器代理程式收集器還是-runner)。

### 待命規則

在 **事件** 和 **警示** 下，待命規則會挑選新事件或警示要執行的待命策略。每個人決定呼叫如何送達自己的規則，過去也叫待命規則：現在是 **使用者設定** 下的 **如何聯絡我**。

參閱 [事件設定與自動化](/docs/incidents/settings#事件待命規則) 和 [如何聯絡我](/docs/notifications/on-call-rules)。

### 通知設定

在 **使用者設定** 下，決定關於你所擁有內容的哪些更新會通知你，以及透過哪些管道。專案的簡訊和電話開關、訊息餘額，以及它自己的 SMTP 和 Twilio，過去也叫通知設定：現在是 **專案設定** 下的 **通知管道**。

參閱 [通知設定](/docs/notifications/notification-settings)。

## 後續步驟

:::cards
- [該用哪一個？](/docs/introduction/which-one): 事件還是警示、工作流程還是操作手冊，以及其他相似項目的並排比較。
- [核心概念](/docs/introduction/core-concepts): 各部分如何關聯，全在一個頁面上。
- [快速開始](/docs/introduction/quickstart): 在十五分鐘內把這些詞彙付諸實踐。
:::
