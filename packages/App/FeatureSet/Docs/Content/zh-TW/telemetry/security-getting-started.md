# 安全性入門

OneUptime 會從您已有的資料中找出威脅——您的日誌、您使用的安全工具，以及您傳送給它的一切——把找到的內容歸入案件，並用劇本回應。按兩下即可完成設定，不需要安裝任何東西。

:::cards
- [完成設定](#完成設定): 開啟大多數團隊需要的功能，再看一次測試攻擊開啟一個案件。
- [運作方式](#運作方式): 來源、偵測、案件和劇本，以及它們各自的作用。
- [您的日誌](#在日誌中尋找安全性事件): 您傳送到 OneUptime 的日誌中已經有的安全性事件。
- [您的 SIEM](#把-oneuptime-的發現傳送到您的-siem): 把 OneUptime 的發現傳送到 Google SecOps。
:::

## 開始之前

設定安全性需要 Project Owner、Project Admin 或 Security Admin 角色。Security Member 和 Security Viewer 角色可以查看找到的內容；請參閱 [角色](/docs/permissions/reference#角色)。

## 完成設定

:::steps
### 開啟大多數團隊需要的功能

開啟 **產品 → Security Events**。在 **概覽** 上按一下 **開啟推薦設定**。它會一次開啟三項：**在日誌中尋找安全事件**、建議的偵測規則，以及 **Enrich New Cases**——一個將每個新案件與威脅情資比對、並在其中留下分流檢查清單的劇本。

### 傳送測試攻擊

按一下 **傳送測試攻擊**。來自一個文件專用位址的十幾次登入失敗會經過真實的處理流程：它們會被儲存，暴力破解規則會偵測到它們，並開啟一個案件。不會呼叫任何人，也不會有 SIEM 收到它們。

### 開啟案件

按一下 **開啟案例**。真實的發現就是這個樣子：背後的事件、涉及的位址，以及 **Enrich New Cases** 找到的內容。完成後，請把它當作測試關閉。
:::

從此以後，**概覽** 會先顯示需要有人處理的內容：您的未結案件、無人認領的案件，以及等待核准的劇本步驟；沒有這些時會顯示 **一切正常**。

## 運作方式

```mermaid title="從您的資料到案件"
flowchart LR
    sources["來源: 日誌和<br/>安全工具"] --> rules["偵測: 規則和<br/>威脅情資"]
    rules --> cases["安全案件"]
    cases --> playbooks["劇本"]
    rules --> siem["您的 SIEM"]
```

| 部分 | 位置 | 作用 |
| --- | --- | --- |
| **Sources** | **Connections** | 您的日誌、OneUptime 輪詢的安全產品，以及您傳送的一切 |
| **Detections** | **Detections** | 在每個事件中尋找威脅的 Sigma 規則和威脅情資來源 |
| **Security Cases** | **Security Cases** | 找到的內容，依其涉及的使用者、主機或位址分組 |
| **Playbooks** | **Playbooks** | 在新案件上執行的步驟：補充資訊、傳送通知、建立事件或進行圍堵 |

**概覽** 頂端的橫條會顯示每個部分及其數字：來源及其最近 24 小時的事件、已開啟的規則、未結案件，以及進行回應的劇本。

## 在日誌中尋找安全性事件

**Connections** 頂端的 **你的日誌** 不需要安裝任何東西。開啟 **在日誌中尋找安全事件** 後，OneUptime 每分鐘讀取專案的新日誌，並把辨識出的行轉成安全性事件：

| 日誌 | 會變成安全性事件的內容 |
| --- | --- |
| SSH 登入 | 伺服器驗證日誌、journal 或 syslog 中失敗與成功的 SSH 登入 |
| sudo | 以其他使用者身分執行的命令、錯誤的 sudo 密碼，以及不允許使用 sudo 的人 |
| Kubernetes 稽核日誌 | 對叢集的變更、在 Pod 中開啟的 shell、被讀取的 secret 和被拒絕的要求 |
| AWS CloudTrail | 主控台登入、在您的 AWS 帳戶中所做的變更，以及被 AWS 拒絕的呼叫 |
| Web 攻擊 | Web 伺服器存取日誌中嘗試 SQL 注入、路徑周遊或 Log4Shell 的要求 |

您的日誌會保持原樣。只有對安全性重要的行才會變成事件：絕不會是 Web 伺服器回傳的每個頁面，也不會是對 API 的每次讀取。

## 把 OneUptime 的發現傳送到您的 SIEM

如果您的團隊已經在使用 SIEM，OneUptime 也會把找到的內容傳送到那裡。在 **Connections → 傳送到你的 SIEM** 下按一下 **新增目的地**，填寫您的 Google SecOps 的區域、執行個體和服務帳戶金鑰，並在儲存前按一下 **傳送測試事件**。請參閱 [將安全性事件傳送到 Google SecOps](/docs/integrations/google-secops#將安全性事件傳送到-google-secops)。

## 疑難排解

:::details Turn on recommended 呈現灰色
您的角色無法新增偵測規則、劇本或日誌來源。請聯絡 Project Owner、Project Admin 或 Security Admin，或請他們為您指派 Security Admin 角色。
:::

:::details 測試攻擊沒有開啟案件
案件通常會在按鈕回應之前開啟；如果規則仍在追趕進度，它會說明這一點，案件會在一分鐘內開啟。請再次查看 **Security Cases**，並在 **Detections** 下確認暴力破解規則已開啟。
:::

:::details 我的日誌沒有產生安全性事件
請確認 **在日誌中尋找安全事件** 已開啟，且 **你的日誌** 顯示了上次檢查的時間。只有上表中的那幾類行才會變成事件：不傳送 SSH、sudo、稽核、CloudTrail 或存取日誌的伺服器，沒有可以找到的內容。
:::

## 後續步驟

:::cards
- [安全性事件(SIEM)](/docs/telemetry/security-events): 傳送事件、搜尋事件並撰寫偵測規則。
- [安全案件與劇本(SOAR)](/docs/telemetry/security-cases): 處理案件，並用劇本回應。
- [威脅情資(STIX/TAXII)](/docs/telemetry/threat-intelligence): 將您的事件與已知的惡意指標進行比對。
- [Google SecOps](/docs/integrations/google-secops): 匯入 Google SecOps 的偵測結果，並把 OneUptime 的發現傳送過去。
:::
