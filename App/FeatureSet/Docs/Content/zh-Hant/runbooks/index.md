# Runbook 概覽

Runbook 是可複用的響應流程——由手動或自動步驟組成的有序列表——你可以將它附加到事件、警報或計劃維護上。它把"現在該怎麼辦？"這種臨時的 Slack 討論，變成同事在凌晨三點也能從零接手的工作。

## 一覽

- OneUptime 儀表板 **分析與自動化 → Runbooks** 下的**頂層功能**。
- **四種步驟類型**：手動清單、JavaScript（沙箱）和 Bash（兩者都在你自己的基礎設施中的 [Runbook 代理](/docs/runbooks/agents) 上運行）、HTTP 請求。
- **三條觸發路徑**：匹配事件 / 警報 / 計劃維護的規則，或者在任意事件上手動點擊"運行 Runbook"。
- **快照語義**：Runbook 啓動時，它的步驟會被拷貝到執行上。之後編輯模板永遠不會改變正在進行中的執行。
- **完整審計軌跡**：每個步驟的狀態、輸出、錯誤信息和耗時永遠保留在執行上。

## 爲什麼用 Runbook？

事件響應往往是一分鐘小問題與幾小時大故障之間的分界。Runbook 幫你：

- **沉澱部落知識**——"隊列堵塞時怎麼辦"放在團隊找得到的地方。
- **降低平均恢復時間 (MTTR)**——自動步驟秒級完成；手動步驟消除決策癱瘓。
- **審計響應動作**——每個步驟、每個輸出、每次響應者點擊都記錄在執行上。
- **賦能初級工程師**——他們能放心運行 Runbook，而不必凌晨三點呼叫資深同事。
- **靠數據而非記憶寫事後回顧**——保留下來的執行就是當時實際發生了什麼的凍結記錄。

## 關鍵概念

後面文檔中會反覆出現的幾個術語，先理順：

| 術語 | 含義 |
| --- | --- |
| **Runbook** | 模板。一段命名的可複用流程，包含有序的步驟列表和 `isEnabled` 開關。 |
| **步驟** | Runbook 中的一項。具有類型（Manual / JavaScript / HTTP / Bash）、標題、描述和該類型專屬配置。 |
| **Runbook 規則** | 當事件、警報或計劃維護的標題或描述匹配正則時，自動附加一個或多個 Runbook 的模式。 |
| **執行** | Runbook 的一次運行。規則觸發、有人在事件上點"運行 Runbook"、或在 Runbook 上點"立即運行"時創建。保存步驟快照以及每步的狀態/輸出。 |
| **快照** | Runbook 步驟在每次執行上的凍結副本。讓你隨後能修改模板而不改寫歷史。 |

## Runbook 的生命週期

1. **撰寫** — 創建一個 Runbook，混合 Manual、JavaScript、HTTP 和 Bash 步驟，保存。
2. **（可選）添加規則** — 在事件、警報或計劃維護的設置中，讓 OneUptime 在事件標題或描述匹配正則時啓動這個 Runbook。
3. **觸發** — 要麼匹配事件被創建時規則自動觸發，要麼響應者在事件上手動點擊 **運行 Runbook**。
4. **執行** — 創建一個新執行並附帶步驟快照。自動步驟在 Runbook worker 上運行；遇到 Manual 步驟就暫停，等待有人勾選。
5. **審計** — 執行永遠留在事件的 **Runbooks** 標籤和 Runbook 的執行列表中。每步的輸出、錯誤和時間都保留，供事後回顧用。

## 何時用哪種步驟類型

快速決策指南。更詳細的拆解見 [編寫 Runbook](/docs/runbooks/authoring)。

| 步驟類型 | 適用場景 | 例子 |
| --- | --- | --- |
| **Manual** | 必須由人來驗證、判斷或執行 OneUptime 無法觀察的動作。 | "在負載均衡器儀表板上確認副本區域流量。" |
| **JavaScript** | 需要一個小的、封閉的計算——查詢配置服務、轉換 payload、在下一步前執行邏輯。在你自己的基礎設施中的 [Runbook 代理](/docs/runbooks/agents) 上以沙箱方式運行。 | 計算當前副本延遲並決定是否繼續。 |
| **HTTP 請求** | 你在調用一個已有的 API——自己的管理端點、雲供應商、PagerDuty、Slack。 | 向你的故障切換編排器 `POST`。 |
| **Bash** | 你需要在自己的基礎設施上執行 shell 命令——重啓服務、跑 `kubectl`、調用部署腳本。需要在你的環境中安裝 [Runbook 代理](/docs/runbooks/agents)。 | 重啓服務、跑 `kubectl rollout restart`、執行恢復腳本。 |

四種類型可以混在同一個 Runbook 裏——Runbook 的優勢就在於讓人爲校驗和自動化交織。

## Runbook 在儀表板的位置

| 頁面 | 在那裏做什麼 |
| --- | --- |
| **分析與自動化 → Runbooks** | 瀏覽、創建和編輯 Runbook 模板。 |
| Runbook 的 **步驟** 標籤 | 編寫步驟列表並調整順序。 |
| Runbook 的 **執行** 標籤 | 按狀態篩選查看此 Runbook 的所有運行。 |
| Runbook 的 **立即運行** 按鈕 | 啓動一次不附屬任何事件的臨時執行。 |
| **事件 / 警報 / 計劃維護 → 設置 → Runbook 規則** | 按實體類型創建自動觸發規則。 |
| 事件 / 警報 / 維護事件 → **Runbooks** 標籤 | 查看附加到該事件的執行，並點擊 **運行 Runbook** 手動運行。 |

## 常見用法

團隊常用 Runbook 解決的幾個模式：

- **數據庫故障切換** — 用 JavaScript 捕獲當前狀態，由 Manual 讓值班 DBA 確認副本健康，用 HTTP 調用編排器 API，用 Manual 勾選"DNS 已更新"，用 HTTP 在 Slack 發恢復通告。
- **緩存刷新** — 一個 HTTP 步驟加一個 Manual 步驟"在儀表板上確認緩存命中率正在恢復"。
- **影響客戶的事件** — Manual：發佈狀態頁更新。HTTP：在 `#customer-incidents` 通知客戶成功團隊。JavaScript：從內部 API 拉取受影響賬戶列表。
- **計劃維護前置檢查** — JavaScript：快照當前指標。Manual：與相關方確認變更窗口。HTTP：在負載均衡器上啓用維護模式。
- **常駐衛生檢查** — 標題模式爲空的規則會在每個事件上捕獲系統狀態，無論標題是什麼——非常適合事後回顧。

## 完整示例

假設你希望所有標題裏包含"db-primary"的事件都自動觸發一個五步的 DB 故障切換 Runbook。

**1. 創建 Runbook。** 在 **Runbooks → 創建 Runbook** 中命名爲"DB primary failover"，並添加這些步驟：

| # | 類型 | 標題 |
| --- | --- | --- |
| 1 | JavaScript | 捕獲故障切換前的副本延遲 |
| 2 | Manual | 在 DBA 儀表板上確認副本健康 |
| 3 | HTTP | 向故障切換編排器 `POST` |
| 4 | Manual | 驗證寫入已轉向新主庫 |
| 5 | HTTP | 在 `#db-incidents` Slack 通告恢復 |

**2. 添加規則。** 在 **事件 → 設置 → Runbook 規則** 中創建：

```
標題模式：    ^db-primary
Runbooks：    [DB primary failover]
```

**3. 觸發。** 一次監控警報打開了事件 `INC-4821 · db-primary connection timeout`。規則匹配，執行被創建，然後：

- 步驟 1 (JavaScript) 在 worker 上立刻運行——它的 `return { lagMs: 412 }` 值被捕獲。
- 步驟 2 (Manual) 暫停了執行。值班人員在事件頁看到"正在等你"標記，點開儀表板，並勾選步驟。
- 步驟 3 (HTTP) 在步驟 2 被勾選後立即運行——`POST` 響應體被捕獲。
- 步驟 4 (Manual) 再次暫停。
- 步驟 5 (HTTP) 運行後執行結束。

**4. 審計。** 執行留在事件的 **Runbooks** 標籤上。每個步驟的輸出一鍵可看。下週你寫事後回顧時不必再問"那個腳本返回了什麼？"——它就在那兒。

## Runbook 如何與 OneUptime 的其他部分配合

- **監控** 打開事件和警報；**Runbook 規則** 把那些事件變成 Runbook 執行。兩者一起構成"檢測 → 觸發 → 響應 → 記錄"的閉環。
- **工作區連接**（Slack、Microsoft Teams）是 Runbook HTTP 步驟天然的目標——髮狀態更新、通知頻道。
- **狀態頁** 通常作爲影響客戶的 Runbook 中 Manual 步驟來更新。
- **值班排班** 決定誰會被呼叫；Runbook 決定那個人醒來之後做什麼。

## 接下來讀什麼

- [編寫 Runbook](/docs/runbooks/authoring) — 創建 Runbook、四種步驟類型以及各自的作用。
- [Runbook 規則](/docs/runbooks/rules) — 把 Runbook 自動附加到事件、警報和計劃維護。
- [運行 Runbook](/docs/runbooks/running) — 手動觸發、執行視圖，以及手動步驟與自動步驟的互動。
- [Runbook 代理](/docs/runbooks/agents) — 安裝在你自己的基礎設施中運行 Bash 步驟的代理。
- [配置與安全](/docs/runbooks/configuration) — 輸出限制、權限和加固說明。
