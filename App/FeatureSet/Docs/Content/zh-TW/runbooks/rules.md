# Runbook 規則

當建立**事件 (incident)**、**警示 (alert)** 或**排程維護事件 (scheduled maintenance event)** 時，Runbook 規則會自動附加 runbook。這些規則於各實體的「設定」選單中進行管理：

- Incidents → Settings → **Runbook Rules**
- Alerts → Settings → **Runbook Rules**
- Scheduled Maintenance → Settings → **Runbook Rules**

這三個頁面所編輯的是相同的底層規則模型，只是經過篩選，僅顯示該實體類型的規則。

## 規則的結構

| 欄位 | 用途 |
| --- | --- |
| **Name** | 簡短、易讀的標籤。會顯示於稽核紀錄中。 |
| **Description** | 提供給團隊成員的選填情境說明。 |
| **Enabled** | 切換以暫停某規則，而無需將其刪除。 |
| **Title Pattern** | 不分大小寫的正規表示式，用於比對實體的標題。留空 = 比對任何標題。 |
| **Description Pattern** | 不分大小寫的正規表示式，用於比對實體的描述。留空 = 比對任何描述。 |
| **Runbooks to Start** | 當規則觸發時要啟動的一個或多個 runbook。 |

## 比對語意

當**所有指定的條件皆通過**時，規則即符合。留空的條件會被略過，因此：

- 未設定任何模式的規則，會在其類型的每個事件上執行（一個全域的「永遠執行」規則）。
- 僅設定標題模式的規則，會在標題符合該正規表示式的事件上觸發。
- 多個規則可比對同一個事件——每個符合的規則都會觸發，並執行其 runbook 的聯集（每個 runbook 都會取得自己的執行）。

## 範例：針對資料庫事件的 DB 容錯移轉

```
Name:           Start DB failover for DB incidents
Trigger:        Incident
Title Pattern:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB failover playbook, Notify DBA team]
```

每當建立標題中含有「db」、「database」、「postgres」等字樣的事件時，這將會建立兩個 runbook 執行。

## 範例：永遠執行的整備規則

```
Name:                 Always-run pre-flight check
Trigger:              Incident
Title Pattern:        (empty)
Description Pattern:  (empty)
Runbooks:             [Capture pre-incident state]
```

會在每個事件上觸發——對於擷取系統狀態快照、頁面指標等用途相當有用。

## 規則觸發時會發生什麼

1. 載入該 runbook。
2. 將其步驟**快照**到一個新的 runbook 執行上。
3. 該執行會被加入 Runbook 佇列工作程式 (queue worker)。
4. 該執行會連結至來源實體——它會顯示在該事件、警示或排程維護事件的頁面上，以及該 runbook 的「Executions」清單中。

您可以在 **Runbooks → Executions** 下查看所有由規則觸發的執行，並依狀態、runbook 或日期進行篩選。

## 已停用的 runbook

如果某規則參照的 runbook 其 `isEnabled = false`，該規則仍會符合，但會略過該 runbook 執行。重新啟用該 runbook 即可恢復。

## 測試規則

在正式環境中依賴某規則之前，請建立一個標題符合該模式的測試事件（或警示），並確認預期的 runbook 會觸發。規則是在建立的當下進行評估的——之後再編輯事件的標題並不會重新觸發規則。
