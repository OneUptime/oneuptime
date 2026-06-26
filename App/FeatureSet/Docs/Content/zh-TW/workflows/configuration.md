# 設定與安全性

本頁面說明在您將工作流程指向真實流量之前，值得了解的設定與安全性限制。

## 開啟或關閉工作流程

每個工作流程在 **Settings** 中都有一個 **Enabled** 開關。當它關閉時，工作流程不會執行 — webhook 呼叫、排程時間以及 OneUptime 事件都會被忽略。新的工作流程預設為停用狀態。

將此開關當作您的「準備就緒」關卡：

1. 建立工作流程。
2. 使用真實的 payload 點擊 **Run Manually**。
3. 檢查 **Logs** — 確認每個區塊都依您預期的方向執行。
4. 開啟 **Enabled**。

關閉工作流程不會停止已在進行中的執行；它只會阻止新的執行開始。

## 擁有者與標籤

- **Owners** — 列為擁有者的使用者與團隊可存取該工作流程，並可在工作流程失敗時選擇加入通知。請在 **Settings → Owners** 下設定。
- **Labels** — 用於分組工作流程的標籤。工作流程清單可讓您依標籤篩選，這讓繁忙的專案更容易瀏覽。當您依團隊、整合或環境來組織工作流程時相當有用。
- **Label rules** — 在 **Workflows → Settings → Label Rules** 下，根據名稱或描述模式自動套用標籤到新的工作流程。
- **Owner rules** — 在 **Workflows → Settings → Owner Rules** 下，自動指派擁有者給新的工作流程。

## Secrets

如果全域變數包含敏感內容，請將其標記為 **secret**。該值會被加密，在您儲存後於 UI 中隱藏，並在執行日誌中隱藏（顯示為 `[REDACTED]`）。

請在以下情況使用 secret 變數：

- 外部服務的 API 金鑰。
- 驗證權杖（authentication tokens）。
- Webhook 簽署金鑰。
- 任何您不希望具有唯讀存取權的人看到的內容。

不要將 secret 直接貼到區塊中 — 像 `Authorization: Bearer eyJh...` 這樣的值最終會在工作流程與日誌中可見。請改用 `{{variable.MY_SECRET}}`。

## 一次執行可花費的時間

每次執行都有最大長度。如果執行未在時間內完成，它會被標記為 **Timeout**，且進行中的區塊會被取消。預設值相當充裕 — 足以應付一般 HTTP 呼叫與區塊鏈。

個別區塊在其中各自有自己的時間限制 — 例如，API 區塊會在整次執行結束之前就放棄一個卡住的對外請求。

## 呼叫其他工作流程的限制

**Execute Workflow** 元件可讓一個工作流程呼叫另一個。為了防止工作流程 A 呼叫 B、B 又再次呼叫 A 這類意外的迴圈，鏈的深度有一個上限。超過此限制的執行會以明確的錯誤結束。

如果您確實需要長鏈（例如每次執行處理一個項目的工作），通常使用 **Custom Code** 在單一工作流程內進行迴圈會更簡單。

## Webhook 安全性

Webhook 觸發器會給您一個唯一的 URL。任何知道該 URL 的人都可以呼叫它。為了防範意外或不受歡迎的呼叫者：

- 將此 URL 視為密碼。不要公開分享或將其提交到公開的儲存庫。
- 對於敏感的工作流程，請要求呼叫端系統以標頭（例如 `X-Webhook-Token`）傳送一個共用權杖，並在執行任何重要操作之前，使用 **Conditions** 區塊進行檢查。將預期的權杖儲存為 secret 變數。
- 對於極為敏感的工作流程，請優先使用 OneUptime 事件觸發器與手動匯入步驟，而非公開的 webhook。

## 對外網路存取

API 與其他 HTTP 區塊會從 OneUptime 發出其請求。如果您自行託管，請確保您的安裝能夠連線到您所呼叫的服務。如果您使用 OneUptime Cloud，我們的對外 IP 範圍列於 [IP Addresses](/docs/configuration/ip-addresses)，您可以在另一端允許它們。

## 權限

工作流程遵循您專案的角色型存取控制（RBAC）。相關的權限：

- **Create / Read / Edit / Delete Workflow** — 工作流程本身的基本權限。
- **Run Workflow** — 點擊 **Run Manually** 或透過 API 觸發工作流程所需。
- **Read Workflow Log** — 檢視執行所需。
- **Read / Create / Edit / Delete Workflow Variable** — 對全域變數清單的控制權。

大多數工程師應對工作流程擁有 create/edit/read 權限，但不應對變數擁有這些權限。請將變數編輯權限保留給管理您專案 secret 的人員。

## 方案限制

OneUptime Cloud 在較小的方案上會限制每月的執行次數。您目前的限制顯示於 **Project Settings → Billing** 下。當您達到上限時，新的觸發器會被拒絕，直到下一個計費週期為止。自行託管的安裝沒有此限制。

## 何時工作流程不是合適的工具

有幾種情況下您應該選用其他工具：

- **繁重的運算或大型資料集** — 工作流程的設計用於輕量的黏合工作，而非數字運算。請在您自己的基礎架構中執行繁重的工作，並讓工作流程啟動它。
- **跨越數小時的長時間執行程序** — 單次執行的目的是快速完成。如果您需要「執行 A、等待兩小時、執行 B」，請使用外部排程器，在時機到來時將 webhook 送回 OneUptime。
- **有人員參與的逐步事件回應** — 那正是 [Runbooks](/docs/runbooks/index) 的用途。工作流程是用於無人值守的自動化。

## 接下來閱讀

- [Workflows Overview](/docs/workflows/index) — 整體概覽。
- [Components](/docs/workflows/components) — 逐區塊的參考。
- [Runbooks](/docs/runbooks/index) — 何時改用 runbook。
