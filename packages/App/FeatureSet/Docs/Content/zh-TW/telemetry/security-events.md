# 安全性事件(SIEM)

OneUptime 把安全性事件與你的日誌、追蹤和指標存放在一起，並且無論它們以什麼格式抵達，都統一成同一種結構：[OCSF](https://schema.ocsf.io/)（Open Cybersecurity Schema Framework）。你可以從任何來源傳送事件、搜尋它們，並用 Sigma 偵測規則、威脅情資和監測器找出重要的事件。它們發現的問題會成為需要處理的 [案件](/docs/telemetry/security-cases)，並由劇本做出回應。

:::cards
- [傳送事件](#傳送安全性事件): 一個 HTTPS POST、一個 Fluent Bit 輸出，或與安全性產品的連線。
- [搜尋和關聯分析](#探索安全性事件): 事件探索器和關聯分析圖。
- [偵測規則](#偵測規則): 會開啟案件和警示的 Sigma 規則。
- [監測器](#安全性事件監測器): 滾動時間窗內的計數，以及會恢復的狀態。
:::

## 運作方式

```mermaid title="從安全性來源到警示"
flowchart TB
    subgraph sources["來源"]
        direction LR
        api["擷取 API"] ~~~ connections["連線：Sentinel、<br/>CrowdStrike 等"]
    end
    sources --> normalize["正規化為 OCSF，<br/>並加上威脅情資標籤"]
    normalize --> events["安全性事件"]
    events --> rules["偵測規則<br/>（Sigma）"]
    events --> monitors["安全性事件<br/>監測器"]
    rules --> act["案件、警示<br/>和偵測結果"]
    monitors --> act
```

在 **可觀測性** 下開啟 **產品 → Security Events**。它的選單為安全性的每個部分設了一個區段，其中每一項都有自己的頁面：

| 頁面 | 區段 | 用途 |
| --- | --- | --- |
| **概覽** | 概覽 | 安全性的設定情況、現在需要有人處理的內容，以及案件處理的速度 |
| **未結案例** | 安全案例 | 佇列：每個尚未關閉的案件，依所涉及的對象分組 |
| **指派給我** | 安全案例 | 指派給你的未結案件 |
| **無人認領** | 安全案例 | 還沒有人認領的未結案件 |
| **已關閉案例** | 安全案例 | 已給出結論並關閉的案件，最近的在前 |
| **全部案例** | 安全案例 | 每個案件，無論未結還是已關閉 |
| **事件** | 事件 | 搜尋和篩選每個事件，並開啟某個事件查看它的所有欄位 |
| **實體風險** | 事件 | 依本週發現評分的每個使用者、主機和位址，風險最高的在前 |
| **關聯分析** | 事件 | 共用同一主機、使用者或 IP 位址的事件構成的圖 |
| **偵測規則** | Detections | 依排程執行並開啟案件的 Sigma 規則 |
| **規則庫** | Detections | 可直接新增的現成偵測規則，每條都會顯示它讀取的事件以及這些事件是否送達，建議的規則會加上標記 |
| **威脅情報** | Detections | 已知惡意指標的 STIX/TAXII 情資來源 |
| **ATT&CK 涵蓋範圍** | Detections | 你的規則涵蓋的 MITRE ATT&CK 技術 |
| **劇本** | Playbooks | 在案件上自動或手動執行的步驟 |
| **待核准** | Playbooks | 等待有人核准或拒絕的劇本步驟 |
| **劇本執行記錄** | Playbooks | 每個劇本逐步做了什麼 |
| **受保護的實體** | Playbooks | 任何劇本都不會圍堵的使用者和主機 |
| **設定** | 人工智慧 | OneUptime AI 是否研判每個新案件 |
| **連線** | Connections | 您的日誌、OneUptime 輪詢的安全產品，以及它傳送到的 SIEM |
| **設定指南** | Connections | 傳送事件的程式碼片段，已填入你的擷取金鑰 |
| **案例優先順序** | 設定 | 案件有多緊急：專案自己的優先順序，最緊急的在前 |
| **案例狀態** | 設定 | 案件經歷的各個步驟，以及每個步驟中的案件被視為什麼 |
| **風險評分** | 設定 | 實體風險是否開啟案件、在多高風險時開啟，以及每個實體的重要程度 |

只需設定一次的 **偵測**、**人工智慧**、**連線** 和 **設定** 會保持摺疊，直到你開啟它們。剛開始使用安全性功能？[安全性入門](/docs/telemetry/security-getting-started) 按兩下即可完成設定。

## 開始之前

只有 Project Owner 和 Project Admin 角色，以及三個 Security 角色可以讀取安全性資料；其他角色在 Security Events 中什麼也看不到。請參閱 [角色](/docs/permissions/reference#角色)。

| 角色 | 能做什麼 |
| --- | --- |
| Security Admin | 一切：事件、案件、劇本、偵測規則、威脅情資來源和連線 |
| Security Member | 讀取事件和威脅情資，處理案件，執行劇本並核准其步驟，以及建立、變更和刪除偵測規則和情資來源。不能設定劇本或連線，也不能刪除安全性資料。 |
| Security Viewer | 讀取事件、案件、劇本、規則、情資來源、指標和連線 |

## 傳送安全性事件

:::steps
### 建立擷取金鑰

開啟 **專案設定 → 遙測與 APM → 擷取金鑰** ，按一下 **建立擷取金鑰** 。安全性事件與其他遙測資料使用相同的金鑰。

### 傳送你的事件

把 JSON 傳送到 `/security-events/v1/ingest`，並在 `x-oneuptime-token` 中攜帶金鑰：

:::tabs
@tab OCSF
```bash
curl -X POST "https://oneuptime.com/security-events/v1/ingest?format=ocsf" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_INGESTION_TOKEN" \
  -H "x-oneuptime-service-name: my-security-source" \
  -d '{ "events": [ { "class_uid": 3002, "severity_id": 4, "status": "Failure", "message": "Failed logon for alice", "actor": { "user": { "name": "alice" } }, "src_endpoint": { "ip": "203.0.113.7", "hostname": "laptop-alice" } } ] }'
```
@tab Google UDM
```bash
curl -X POST "https://oneuptime.com/security-events/v1/ingest?format=udm" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_INGESTION_TOKEN" \
  -d '{ "events": [ { "metadata": { "event_type": "USER_LOGIN" }, "principal": { "hostname": "laptop-alice", "user": { "userid": "alice" }, "ip": ["203.0.113.7"] }, "security_result": [{ "severity": "HIGH", "action": ["BLOCK"] }] } ] }'
```
@tab Generic JSON
```bash
curl -X POST "https://oneuptime.com/security-events/v1/ingest" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_INGESTION_TOKEN" \
  -d '{ "events": [ { "severity": "high", "event_type": "ssh_brute_force", "message": "12 failed SSH logins in 60s", "username": "root", "hostname": "web-01", "src_ip": "203.0.113.7" } ] }'
```
:::

事件進入佇列後，端點會回應 `200`。像這些範例一樣不帶時間的事件，會放在它到達的那一刻。

### 在事件中找到它們

開啟 **產品 → Security Events → 事件** 。幾秒鐘內事件就會出現，嚴重程度、類別、使用者、主機和 IP 位址都已填好。
:::

### 格式

| `format` | 讀取的內容 | 也接受 |
| --- | --- | --- |
| `ocsf` | OCSF 事件 JSON（`class_uid`、`severity_id` 等） | 無 |
| `udm` | Google SecOps（Chronicle）UDM 事件（`metadata.event_type` 等） | `chronicle`、`google-secops` |
| `google-secops-alert` | Google SecOps 偵測和警示：SOAR Webhook 和偵測串流 | `secops-alert`、`detection` |
| `generic` | 任何其他 JSON，依常見欄位名稱讀取 | 無 |

可以用 `?format=`、`x-oneuptime-security-event-format` 標頭，或最上層的 `"format"` 欄位指定格式。不指定時，每個事件的格式會個別判斷，所以一個 Webhook 可以混合傳送偵測和原始事件。

- 內文可以是一個事件、一個事件陣列，或 `{ "events": [...] }`。
- `x-oneuptime-service-name` 標頭指定事件所屬的遙測服務。沒有它時，事件屬於以第一個事件的產品或供應商命名的服務，或屬於 `Security Events`。
- 不會因為無法對應而捨棄任何內容：來源的每個欄位都會進入事件的屬性。

### 一般 JSON 欄位

一般事件依常見欄位名稱讀取：

| 事件的欄位 | 從下列第一個存在的欄位讀取 |
| --- | --- |
| `message` | `message`、`msg`、`summary`、`description`、`title` |
| `severityName` | `severity`、`severity_name`、`level`、`priority`、`risk_level` |
| `time` | `timestamp`、`time`、`@timestamp`、`event_time`、`created_at` |
| `principalUser` | `user`、`username`、`user_name`、`account`、`actor` |
| `principalHost` | `host`、`hostname`、`computer`、`device`、`machine` |
| `principalIp` | `source_ip`、`src_ip`、`client_ip`、`ip` |
| `targetIp` | `destination_ip`、`dest_ip`、`dst_ip`、`target_ip` |
| `className` | `event_type`、`category`、`type`、`action` |
| `ruleName` | `rule`、`rule_name`、`signature`、`detection` |
| `productName` | `product`、`product_name`、`source`、`log_source` |
| `processName` | `process_name`、`process.name`、`proc.name`、`comm` |
| `processPath` | `process_path`、`Image`、`NewProcessName`、`exe`、`process.executable` |
| `processCommandLine` | `command_line`、`CommandLine`、`cmdline`、`process.command_line`、`proc.cmdline`、`process` |
| `parentProcessName` | `parent_process_name`、`process.parent.name`、`proc.pname` |
| `parentProcessPath` | `parent_process_path`、`ParentImage`、`ParentProcessName`、`process.parent.executable` |
| `parentProcessCommandLine` | `parent_command_line`、`ParentCommandLine`、`process.parent.command_line`、`proc.pcmdline` |

表示嚴重程度的字詞會變成 OCSF 等級：`info` 讀作 Informational，`warning` 讀作 Low，`error` 讀作 Medium，`alert` 讀作 Critical，`emergency` 讀作 Fatal。

### 用 Fluent Bit 轉送

若要傳送你已經在收集的安全性日誌，例如 auditd、syslog 或 Falco，請為 Fluent Bit 新增一個 `http` 輸出：

```ini title="fluent-bit.conf"
[OUTPUT]
    Name             http
    Match            security.*
    Host             oneuptime.com
    Port             443
    tls              On
    URI              /security-events/v1/ingest
    Format           json
    Json_date_key    timestamp
    Json_date_format iso8601
    Header           x-oneuptime-token YOUR_INGESTION_TOKEN
    Header           x-oneuptime-service-name my-security-source
    Retry_Limit      5
```

**連線** 下的 **設定指南** 頁面提供這些程式碼片段，並已填入你自己的主機和金鑰。

### 在日誌中尋找安全性事件

**連線** 頂端的 **你的日誌** 會把您已經傳送到 OneUptime 的日誌變成一個來源。開啟 **在日誌中尋找安全事件** 後，專案的新日誌每分鐘都會被讀取，其中的每次 SSH 登入、sudo 命令、Kubernetes 稽核記錄、AWS CloudTrail 變更和 Web 攻擊都會儲存為安全性事件。各類內容的範圍請參閱 [安全性入門](/docs/telemetry/security-getting-started#在日誌中尋找安全性事件)。

### 連線安全性產品

**連線** 會替你輪詢安全性產品，並把它的新記錄匯入為安全性事件。連線會保存產品的設定和加密的認證資訊；工作程序會依你設定的間隔輪詢它，並略過已經匯入過的記錄。

| 產品 | 匯入內容 | 設定指南 |
| --- | --- | --- |
| Google SecOps (Chronicle) | 規則偵測、精選偵測和警示，作為 Detection Finding | [Google SecOps](/docs/integrations/google-secops) |
| Microsoft Sentinel | 事件（incident），作為 Incident Finding | [Microsoft Sentinel](/docs/integrations/microsoft-sentinel) |
| Microsoft Defender XDR | 警示，作為 Detection Finding | [Microsoft Defender XDR](/docs/integrations/microsoft-defender-xdr) |
| CrowdStrike Falcon | 警示，作為 Detection Finding | [CrowdStrike Falcon](/docs/integrations/crowdstrike-falcon) |
| Splunk Enterprise Security | Notable 事件或任意搜尋，作為 Detection Finding | [Splunk Enterprise Security](/docs/integrations/splunk) |
| Elastic Security | 偵測警示，作為 Detection Finding | [Elastic Security](/docs/integrations/elastic-security) |
| AWS Security Hub | Finding，作為 Detection Finding 和 Compliance Finding | [AWS Security Hub](/docs/integrations/aws-security-hub) |
| Okta System Log | 登入、MFA、帳戶和原則事件 | [Okta System Log](/docs/integrations/okta) |

- 產品本身的警示，只要等級達到或高於 **Open Cases From**（預設為 **高及以上**，你也可以選擇其他等級或 **從未**），就會開啟 [案件](/docs/telemetry/security-cases)，並依它們涉及的使用者、主機或位址分組。
- 連線依產品建立記錄的時間讀取記錄，而不是依記錄所描述活動的時間。每小時執行一次的 SIEM 規則會在它符合的事件之後很久才建立偵測，這些偵測仍然會被匯入。
- 第一次輪詢會回溯 24 小時，所以新連線會立即顯示最近的記錄。
- 連線所在列中的 **測試連線** 會檢查對產品的存取，以及 OneUptime 自己的工作程序是否在執行，不會匯入任何內容。**立即執行** 會立即輪詢。

## 事件包含什麼

每個事件都會與型別化欄位和來源承載資料一起儲存：

| 群組 | 欄位 |
| --- | --- |
| 分類 | `categoryName`、`className`、`activityName`、`statusName`，以及它們的 OCSF ID（`categoryUid`、`classUid`） |
| 嚴重程度 | `severityName`，值為 Unknown、Informational、Low、Medium、High、Critical、Fatal 或 Other 之一，以及 `severityId` |
| 誰做的 | `principalUser`、`principalHost`、`principalIp`、`principalProcess` |
| 涉及了什麼 | `targetUser`、`targetHost`、`targetIp`、`targetPort`、`targetResource` |
| 處理程序 | `processName`、`processPath` 和 `processCommandLine`：在處理程序活動事件中是被啟動、開啟、注入或結束的處理程序，其他事件中是執行動作的處理程序。`parentProcessName`、`parentProcessPath` 和 `parentProcessCommandLine`：啟動它的處理程序 |
| 來源 | `productName`、`vendorName`、`ruleId`、`ruleName`、`eventUid` |
| 內容 | `message`、`mitreTactics`、`mitreTechniques` 和 `observables`：從事件中擷取出的每個使用者、主機、IP 位址、網域和雜湊 |
| 屬性 | 完整的來源承載資料，展平為以點分隔的鍵 |

在 OneUptime 14.0.84 之前儲存的事件，處理程序欄位為空，只以 `principalProcess`（執行動作的處理程序）記錄其處理程序。之後不會補齊：在保留期結束之前，它們保持儲存時的內容。

## 探索安全性事件

**事件** 是一個與日誌和追蹤探索器類似的遙測探索器：一張依嚴重程度顯示時間窗內事件的圖表、一個面向側邊欄、事件清單，以及一個顯示所開啟事件每個欄位和屬性的面板。時間窗、篩選條件和搜尋都保存在 URL 中，所以篩選後的檢視可以分享，重新整理後也不會遺失。

### 搜尋

搜尋列使用與其他遙測探索器相同的語法（請參閱 [搜尋語法](/docs/telemetry/search-syntax)）：

| 語法 | 意思 | 範例 |
| --- | --- | --- |
| 自由文字 | 訊息中包含它 | `failed logon` |
| `"quoted phrase"` | 這些字詞連在一起 | `"brute force"` |
| `<field>:<value>` | 型別化欄位 | `severity:Critical` |
| `@<attribute>:<value>` | 來源屬性 | `@threat.matched:true` |
| `-<filter>` | 排除這一項 | `-severity:Informational` |
| `<field>:(a OR b)` | 這些值中的任一個 | `severity:(High OR Critical)` |
| `<field>:a*` | `*` 代表任意文字，`?` 代表一個字元 | `host:web-*` |
| `@<attribute>:*` | 存在該屬性 | `@threat.indicator_id:*` |
| `@<attribute>:~text` | 屬性包含該文字 | `@finding_info.title:~ransom` |

欄位要麼是簡稱（`severity`、`class`、`category`、`activity`、`status`、`vendor`、`product`、`rule`、`user`、`host`、`ip`、`targetuser`、`targethost`、`targetip`、`processname`、`commandline`、`parentprocessname`、`observable`、`tactic`、`technique`），要麼是欄位本身的名稱，例如 `severityName` 或 `principalHost`。任何其他名稱都會被讀作來源屬性。`observable:<value>` 會找出提到某個值的每個事件，無論該值出現在活動的哪一方。

### 面向

側邊欄依 **來源**、**嚴重程度**、**事件類別**、**類別**、**活動**、**狀態**、**供應商**、**產品**、**偵測規則**、**來源使用者**、**來源主機**、**處理程序** 和 **父處理程序** 統計時間窗內的事件。按一下某個值只保留它的事件，按一下旁邊的減號則排除它們。再按一下即可復原。圖表和每個計數描述的正是清單中的事件。

### 關聯分析

**關聯分析** 會圍繞一個主機、使用者或 IP 位址繪製事件：在你搜尋的值周圍顯示它們的事件類別，並依最嚴重的嚴重程度標示，同一批事件中出現的其他值則顯示在外圈。按一下某個類別可以列出它的事件，按一下某個值可以接著依它進行關聯分析。**事件** 中事件面板裡的每個 observable 都可以直接在 **關聯分析** 中開啟。

## 偵測規則

偵測規則是一條 [Sigma](https://sigmahq.io/) 規則，一種描述可疑活動的開放 YAML 格式，OneUptime 會依排程對你的事件執行它。符合時，它會開啟或併入一個 [案件](/docs/telemetry/security-cases)、開啟一個警示，可選擇開啟一個事件（incident），並把一個 Detection Finding 寫回安全性事件中。**規則庫** 提供可作為起點的現成規則。

```mermaid title="偵測規則如何觸發"
flowchart TB
    tick["每分鐘：執行到期的<br/>規則"] --> query["自規則上次執行<br/>以來的事件"]
    query --> count["依 Group By Field<br/>的每個值計數"]
    count --> check{"計數達到<br/>Match Count Threshold？"}
    check -->|"是"| fire["案件、警示、<br/>選用的事件<br/>和 Detection Finding"]
    check -->|"否"| wait["什麼也不做，<br/>直到下次執行"]
```

### 建立規則

:::steps
1. 開啟 **產品 → Security Events → 偵測 → 偵測規則** ，按一下 **建立偵測規則** 。
2. 在 **Sigma 規則** 中，把規則的 YAML 貼到 **Sigma 規則（YAML）** 中。儲存時會剖析它，所以錯誤會顯示在表單中。
3. **名稱** 會用規則的 `title` 填好：改寫它即可給規則取別的名字。新規則會直接執行；**已啟用** 在它的編輯表單中。
4. 在 **符合時** 中讓 **符合時開啟案例** 保持開啟，依規則的分組值把它的符合項目歸入案件。
5. 在 **警示和事件** 下選擇符合還會引發什麼：**建立警示**（預設）、**宣告事件**、**兩者** 或 **都不**，以及選用的 **警示嚴重性** 或 **事件嚴重性**。
6. **更多欄位** 中有 **描述**、**符合時寫入 Detection Finding**（開啟）以及符合的計數方式；請參閱 [評估設定](#評估設定)。
:::

第一條規則，符合來自 `10.x.x.x` 以外的登入失敗：

```yaml title="failed-logon-burst.yml"
title: Failed logon burst
description: Repeated authentication failures from one source.
level: high
tags:
  - attack.t1110
  - attack.ta0006
detection:
  selection:
    className: Authentication
    statusName: Failure
  filter_internal:
    principalIp|startswith: '10.'
  condition: selection and not filter_internal
```

### 規則能表達什麼

OneUptime 會執行 Sigma 的布林核心：

- 選取項目是欄位對應（每個欄位都必須符合；值清單符合其中任一個即可），或是關鍵字清單，在訊息中的任何位置符合。
- 條件用 `and`、`or`、`not` 和括號，或用 `1 of selection_*`、`all of selection_*`、`any of them` 和 `all of them` 組合選取項目。
- 欄位修飾詞：`contains`、`startswith`、`endswith`、`all`、`re`、`cased`、`gt`、`gte`、`lt`、`lte`、`cidr`、`exists` 和 `windash`。除非你加上 `cased`，否則文字比較不區分大小寫。
- 欄位可以是型別化欄位（`principalUser`）、它在 Sigma 中的常見寫法（`CommandLine`、`src_ip`、`Hostname`），或任何屬性鍵，依它在事件中的寫法拼寫（`threat.matched`）。
- `Image` 和 `CommandLine` 讀取事件所涉及的處理程序，在處理程序啟動事件中即被啟動的處理程序（`processPath`、`processCommandLine`），`ParentImage` 和 `ParentCommandLine` 讀取啟動它的處理程序（`parentProcessPath`、`parentProcessCommandLine`）。`principalProcess` 是執行動作的處理程序，在處理程序啟動中即父處理程序。
- `level` 設定嚴重程度：`informational`、`low`、`medium`、`high` 或 `critical`，缺少時為 `medium`。`tags` 中的 ATT&CK ID（`attack.t1110`、`attack.ta0006`）會填入偵測結果的 MITRE 欄位。

像 `| count() by principalIp > 5` 這樣的彙總會在儲存時遭到拒絕：請改用 [關聯規則](#關聯規則)，或 **分組欄位** 和 **符合次數閾值** 。`logsource` 只有說明作用，不會縮小任何範圍：請把這種篩選放進選取項目，例如 `className: Authentication`。`timeframe` 會被忽略，因為規則的間隔決定了它的時間窗。

### 關聯規則

[Sigma 關聯](https://sigmahq.io/docs/meta/correlations.html) 在多個事件一起出現時觸發，而不是在單一事件上。把它和它讀取的規則一起貼到 **Sigma 規則（YAML）** 中，作為以 `---` 分隔的 YAML 文件，或依 Sigma 的 `name` 或 `id` 指定專案中已有的規則。**規則庫** 中有現成的規則，例如登入失敗後緊接一次成功登入。

| 類型 | 觸發條件 | 顯示為 |
| --- | --- | --- |
| `event_count` | 一個群組在 `timespan` 內達到一定數量的事件 | 事件數 |
| `value_count` | 一個群組在 `timespan` 內出現某欄位一定數量的不同值 | 不同值 |
| `temporal` | 在 `timespan` 內同一群組的每條規則都符合，順序不限 | 同時發生的事件 |
| `temporal_ordered` | 在 `timespan` 內同一群組的規則依順序符合 | Sequence |
| `new_value` | 一個群組出現了它在 `timespan` 內沒有出現過的欄位值 | First seen |

```yaml title="failed-then-success.yml"
title: Failed sign-ins, then a success from the same address
level: high
correlation:
  type: temporal_ordered
  rules:
    - failed_sign_ins
    - successful_sign_in
  group-by:
    - principalIp
  timespan: 10m
---
title: Five failed sign-ins
name: failed_sign_ins
correlation:
  type: event_count
  rules:
    - failed_sign_in
  group-by:
    - principalIp
  timespan: 10m
  condition:
    gte: 5
---
title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection
```

- 群組是 `group-by` 欄位的值，例如一個位址。計數是滾動的：被兩次執行分開的一陣突發，在其 `timespan` 內仍會被完整計數，該時間跨度最長 24 小時。
- `new_value` 是 OneUptime 自有的類型，因為 Sigma 沒有「首次出現」關聯：它會與最多 30 天的歷史比較。`value_sum`、`value_avg`、`value_percentile` 和 `value_median` 會在儲存時遭到拒絕。
- **偵測規則** 的 **類型** 欄會寫出每條規則的種類，表單會用一句話說明規則在找什麼。

### 評估設定

| 欄位 | 作用 |
| --- | --- |
| **評估間隔（分鐘）** | 規則執行的頻率：整數分鐘，1 到 1440。新規則的表單從 5 開始。 |
| **分組欄位** | 選用。此欄位值相同的符合，例如 `principalHost`，會一起計數、一起發出警示、一起去重：每台主機一個警示，而不是成百上千個。 |
| **去重計數欄位** | 選用。統計此欄位不同值的數量，而不是符合的事件數。空值不計入。 |
| **符合次數閾值** | 只有當一個群組在一次執行中的計數達到這個數字時才會觸發：1 到 1000000，設為 1 時任何符合都會觸發。 |

Group By 和 Distinct Count 使用與規則相同的欄位名稱。有了它們，閾值的意思就是「同一個對象、在一次執行中、達到這麼多」，不需要再在上面疊加監測器：

| 目標 | Group By Field | Distinct Count Field | 閾值 |
| --- | --- | --- | --- |
| 對任何符合發出警示 | 空白 | 空白 | 1 |
| 每台主機一個警示 | `principalHost` | 空白 | 1 |
| 暴力破解：來自同一個 IP 的 5 次登入失敗 | `principalIp` | 空白 | 5 |
| 密碼噴灑：同一個 IP 在 5 個不同帳戶上失敗 | `principalIp` | `principalUser` | 5 |
| 連接埠掃描：同一個 IP 存取 20 個不同連接埠 | `principalIp` | `targetPort` | 20 |

### 規則何時執行

OneUptime 每分鐘檢查一次已啟用、且自上次執行以來已經過了間隔時間的規則。每次執行會讀取事件時間落在上次執行與兩分鐘前之間的事件，然後繼續往前。這兩分鐘為仍在路上的事件保留餘裕，例如寫入一分鐘後才被讀取的日誌行：

- 時間窗首尾相接，不會滾動。間隔為 10 分鐘時，09:58 和 10:01 的失敗可能落在不同的執行中、被分開計數，所以選擇閾值時請保留餘裕。
- 出現空檔之後，例如工作程序中斷或規則重新開啟，下一次執行會涵蓋整個空檔，最多涵蓋最近 24 小時。
- 在某次執行已經涵蓋其時間之後、晚到超過兩分鐘的事件，會被儲存並可以搜尋，但那條規則永遠不會讀取它。
- 每個達到門檻的群組都會成為一個 Detection Finding，每次執行最多 10,000 個。警示、事件和案件只為計數最高的 100 個群組開啟；其餘群組共用一個關於該規則的案件，規則的 **最近的錯誤** 會說明有多少群組符合。

### 嚴重程度

規則的 `level` 就是它的偵測結果的嚴重程度：`informational`、`low`、`medium`、`high` 和 `critical` 分別變為 Informational、Low、Medium、High 和 Critical。它的警示和事件會依下列順序取用你專案中的某個嚴重程度：

1. 規則的 **警示嚴重性**（或 **事件嚴重性** ），如果已設定。
2. 與等級同名的嚴重程度，例如 High，不區分大小寫。
3. 依等第：`critical` 和 `high` 規則取用你最嚴重的嚴重程度，其他規則取用最輕的。

> [!TIP]
> 依 Sigma 等級（Critical、High、Medium、Low、Informational）為你的警示嚴重程度命名，每條規則不需個別設定就會落在正確的嚴重程度上。

### 警示和偵測結果

每個觸發的群組都會開啟一個標題為 `[Detection] <rule name> — <group value>` 的警示，沒有 Group By Field 的規則則為 `[Detection] <rule name>`。警示開啟期間，該群組的更多符合不會再開啟新的警示。規則只看得到符合，無法判斷攻擊是否已經停止，所以它的警示會一直保持開啟，直到有人解決。

Detection Finding 是來自產品 `OneUptime Detections`、類別為 `Detection Finding`（OCSF 類別 2004）的安全性事件，帶有規則的 MITRE 標籤、位於 `observables` 第一位的群組值，以及下列屬性：

| 屬性 | 值 |
| --- | --- |
| `oneuptime.detection.rule_id` | 觸發的規則的 ID |
| `oneuptime.detection.rule_name` | 規則的名稱 |
| `oneuptime.detection.match_count` | 這個偵測結果背後有多少個事件 |
| `oneuptime.detection.distinct_count` | 背後有多少個不同的值，適用於設定了 Distinct Count Field 的規則 |
| `oneuptime.detection.group_value` | 群組的值，適用於設定了 Group By Field 的規則 |
| `oneuptime.detection.sigma_id` | Sigma 規則自己的 `id` |

偵測結果就是一般的事件：可以在 **事件** 中搜尋它們，在 **關聯分析** 中以它們為中心展開分析。若要低調試用一條新規則，請在信任它之前關閉偵測結果以外的所有動作。

## 安全性事件監測器

安全性事件監測器會在滾動時間窗內統計符合其篩選條件的事件，並對計數執行一般的監測器條件：它會改變監測器的狀態、開啟警示或事件，並呼叫待命人員。請在 **監測 → 建立監測器** 下建立，類型選擇 **安全事件** ；它會和您的其他監測器一起列在那裡。

它的表單會顯示 **Monitor events that include this text**、**Monitor Security Events for (time)**、**Event Severity** 和 **事件類別** 。**依遙測服務篩選** 和 **依屬性篩選** 位於 **更多欄位** 下，其標題會顯示監測器正在使用哪些。它的條件會檢查 **Security Event Count** 。

| | 偵測規則 | 安全性事件監測器 |
| --- | --- | --- |
| 符合依據 | 一條 Sigma 規則 | 針對嚴重程度、類別、訊息、服務和屬性的篩選條件 |
| 時間窗 | 首尾相接，每次執行一個 | 滾動：最近 5 秒到 24 小時 |
| 依群組計數 | 是，透過 **分組欄位** | 否：所有符合合計一個計數 |
| 開啟的內容 | 警示、事件和偵測結果 | 狀態、警示和事件 |
| 會恢復 | 否：警示會保持開啟直到被解決 | 是：計數恢復時狀態也隨之恢復 |

請把偵測本身寫成規則，並帶上它的閾值。當你需要滾動時間窗、能自行恢復的狀態、狀態頁面，或依條件使用不同的待命策略時，再使用監測器。

### 監看你的偵測

偵測結果就是事件，所以監測器可以監看規則本身：

- 風暴：在 `Detection Finding` 類別上建立一個監測器，統計每個偵測結果。一小時內有二十條不同的規則觸發，是任何單一規則都看不到的訊號。
- 頻率變化：依某條規則的 `oneuptime.detection.rule_id` 篩選。一條每週觸發一次的規則突然每小時觸發五十次，需要不同的因應方式。
- 沉默：平常總能看到幾個的偵測結果降到零，通常代表某個來源停止傳送了。請使用檢查計數是否低於某個數字的條件。

規則所在列中的 **建立監測器** 動作會開啟一個已經這樣設定好的新監測器：`Detection Finding` 類別、規則的 ID（絕不用名稱，因為重新命名會改變名稱），以及最近一小時。這樣的監測器統計的是偵測結果，每次執行每個群組一個，而不是它們背後的事件。若要在任何東西觸發之前要求一定數量的事件，請使用規則的 **符合次數閾值** 。

## 威脅情資

**威脅情報** 會訂閱已知惡意 IP 位址、網域、URL、電子郵件地址和檔案雜湊的 STIX/TAXII 情資來源。提到其中之一的事件會在抵達時被加上 `threat.*` 屬性，規則和監測器可以依這些屬性篩選；此外每分鐘都會把最近的事件與情資來源比對，像規則一樣開啟警示和偵測結果。請參閱 [威脅情資](/docs/telemetry/threat-intelligence)。

## 保留和計費

與其他遙測資料一樣，安全性事件依擷取的 GB 計費，並依你的遙測保留期保存：也就是專案在 **專案設定 → 遙測與 APM → 資料保留** 下的 **預設保留期（天）** ，或在其所屬遙測服務上設定的保留期。事件的保留期結束時，它就會被刪除。

## 疑難排解

:::details 事件沒有出現
檢查 `x-oneuptime-token` 中的金鑰和路徑 `/security-events/v1/ingest`。接著檢查 **事件** 中的時間窗，除非你變更過，它是過去一天：事件依它自己的時間放置，所以時間戳記較早的事件會落在時間窗之外。
:::

:::details 規則從不符合
檢查它的 **狀態** ： **已停用** 的規則不會執行；顯示 **執行失敗** 時，可以透過它所在列的 **檢視錯誤** 查看原因。開啟一個你預期會符合的事件，逐一欄位與規則比對：一般值必須等於整個欄位，所以要符合其中一部分時，請使用 `contains` 或 `*`。屬性依它在事件中的名稱書寫（寫 `threat.matched`，而不是 `attributes.threat.matched`）。閾值大於 1 時，這些符合必須落在同一次執行中。
:::

:::details 規則符合了，但沒有開啟警示
**警示和事件** 設為 **宣告事件** 或 **都不**，或者同一規則和群組值的警示仍處於開啟狀態，之後的符合都會併入其中。專案至少需要一個警示嚴重程度，規則才能開啟警示。
:::

:::details 規則開啟的警示太多
**分組欄位** 的每個值都會有自己的警示：請依較粗的粒度分組、提高閾值，或新增一個 Distinct Count Field。如果你在意的是頻率而不是每一次符合，請把 **警示和事件** 設為 **都不** ，並在規則的偵測結果上設定一個監測器。
:::

## 後續步驟

:::cards
- [威脅情資](/docs/telemetry/threat-intelligence): 將你的事件與 STIX/TAXII 情資來源比對。
- [安全案件與劇本](/docs/telemetry/security-cases): 處理規則發現的問題，並用劇本做出回應。
- [Google SecOps](/docs/integrations/google-secops): 匯入 Chronicle 的偵測和事件。
- [搜尋語法](/docs/telemetry/search-syntax): 搜尋列能理解的一切。
- [權限參考](/docs/permissions/reference): Security 角色以及每個角色能做什麼。
:::
