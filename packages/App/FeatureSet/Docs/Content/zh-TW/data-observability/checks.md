# 檢查與對帳

資料表健康說明資料表是否在變更。**檢查** 說明資料表中保存的內容是否正確，**對帳** 說明資料的兩個複本是否一致，**dbt 的測試** 則回報 dbt 所建置資料表的情況。它們都在資料庫的收集執行的地方執行（由 OneUptime 或其探測器執行），離開資料庫的只有一個數字，除非專案選擇保留失敗資料列的遮蔽樣本。

## 檢查

在資料表的 **檢查** 索引標籤上新增檢查：

| 檢查 | 讀取的內容 |
| --- | --- |
| **NULL 比例** | 該欄為空的列所占的百分比 |
| **重複比例** | 與其他列的值重複的值所占的百分比 |
| **去重計數** | 該欄包含多少個不同的值 |
| **最小值**、**最大值**、**平均**、**總和** | 數值欄的相應值（沒有列時總和為 0） |
| **無效值比例** | 不在你提供的清單中的值所占的百分比 |
| **格式不符比例** | 不是你所選格式（例如 Email、UUID 或 Country Code）的值，或不符合你的規則運算式的值所占的百分比（SQL Server 和 Dataverse 以外的所有引擎） |
| **孤立資料列數** | 其值在另一個資料表的欄中找不到相符項目的列 |
| **資料列數** | 資料表中的列數，搭配 **分群依據** 使用最有用 |
| **自訂 SQL** | 你的一個唯讀 SELECT 所傳回、名為 `value` 的數字（在 MongoDB 中為聚合管線傳回的數字） |
| **失敗的資料列** | 你的一個唯讀 SELECT 傳回多少列：那些不該存在的列。0 表示健康（在 MongoDB 中為管線最後得到的文件） |

每個檢查每 15 分鐘、每小時、每 6 小時或每天執行一次，作為一個彙總陳述式，在設有陳述式逾時的唯讀交易中執行。它的值會寫入為 `oneuptime.data.check.value`，並帶有 `oneuptime.data.check.id`、`oneuptime.data.check.name` 和 `oneuptime.data.check.segment`。

## 建議的檢查

同一個索引標籤上的 **建議的檢查** 會只根據欄的名稱和類型，提供資料表的欄所需要的檢查：id 是唯一的、`customer_id` 在 `customers` 中有相符的列、電子郵件看起來像電子郵件、金額不是負數、狀態保持其通常的值，以及依租用戶拆分的資料表依租用戶計數。資料安全得知保存電子郵件地址、電話號碼或 IP 位址的欄，無論它叫什麼名稱，都會依該格式檢查。你可以新增一個、全部新增，或永久隱藏某一個。

## 用一句話撰寫檢查

**用一句話撰寫檢查** 會把「訂單的總額從不為負」這樣的規則，以你的引擎本身的 SQL 轉換成計算違反該規則之列的自訂 SQL 檢查，並在有任何違反時發出警示。在以 **新增檢查** 新增之前，你可以先閱讀查詢，它也受到與任何自訂 SQL 檢查相同的所有限制。這需要為專案開啟 OneUptime AI。在 MongoDB 上，結果是一個聚合管線。

## 區段

**分群依據** 會針對某一欄的每個值（例如租用戶或區域）各執行一次檢查：最大的 100 個區段各有一個序列和一個警示。分區段的資料列數檢查會在某個租用戶停止傳送資料、而其他租用戶仍持續傳送時發出警示。

## 檢查的警示

設定 **警示條件** 以針對檢查發出警示：

- **異常偏高** 或 **異常偏低** 會把每個值與它自己在每週該時段學習到的基準線進行比較。
- **高於** 或 **低於** 會把它與閾值進行比較。

儲存檢查時，會以你的身分、依你的權限為它建立一個指標監測器。清除該條件會移除該監測器。

檢查的 **狀態** 會在 **檢查** 頁面和其所在資料表的 **檢查** 分頁上說明它的情況：警示開啟時為 **失敗**，未開啟時為 **已通過**，查詢失敗時為 **無法執行**。沒有警示的檢查只會顯示 **已執行**，表示它的查詢執行了。失敗的檢查以及無法執行的檢查也會出現在 **概覽** 上。

## 檢查的成本

檢查會與你的應用程式爭用資料庫，而在依查詢讀取量計費的資料倉儲上，它會花錢。有三項設定可以控制：

- **取樣百分比** 只讀取一部分列而不是全部，適用於讀取比率的檢查：NULL 比例、平均、無效值比例和格式不符比例。大多數引擎會略過資料表的整個頁面；MySQL、Redshift、ClickHouse 和 MongoDB 仍會讀取每一列，只是省去其餘部分的處理工作。Dataverse 不會取樣：其上的檢查會讀取每一列。檢視可能會拒絕它，檢查會如實說明。
- **單次檢查最多可讀取量 (GB)**（在 **設定** 下）會在 BigQuery 或 Athena 上的檢查讀取超過該吉位元組數之前將它停止。在你變更之前為 10。
- **資料庫忙碌時等待**（在 **設定** 下）會在 PostgreSQL、MySQL 或 SQL Server 資料庫看起來忙碌時，把到期的檢查留到下一次收集。在你關閉之前它一直是開啟的，資料庫會說明檢查何時等待過。

## 失敗的資料列

數字說明有地方出錯；幾列資料則說明是哪裡。**設定** 下的 **保留 Failing Rows** 會保留「失敗的資料列」、「無效值比例」、「格式不符比例」或「孤立資料列數」檢查找到的最多 20 列，檢查上的 **失敗的資料列** 會顯示它們。此設定在你開啟之前一直是關閉的。敏感欄位在讀取該列的地方就會被遮蔽，依資料安全在其中找到的內容或依其名稱，因此離開資料庫或探測器的內容已經是遮蔽過的。沒有被任何掃描找到、名稱也看不出來的敏感欄位，會按原樣保留。

這些資料列儲存在 OneUptime 中：使用 OneUptime Cloud 時儲存在 OneUptime 的伺服器上，使用自行代管的安裝時儲存在你自己的伺服器上。能夠讀取專案檢查的人都可以看到它們。每個檢查只保留最後一次執行的資料列，關閉 **保留 Failing Rows** 會刪除每個檢查保留的內容。

## 檔案中的檢查

手動撰寫的檢查會與變更資料表的程式碼產生偏差。把它們保存在你的儲存庫中，並在同一個 pull request 中審查：

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

使用 [OneUptime CLI](/docs/cli/index) 和 API 金鑰，從 CI 套用它：

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

同一個資料表上名稱相同的檢查就是同一個檢查，因此把檔案套用兩次不會改變任何東西。檔案中任何一處有錯誤，就不會套用任何內容，並以錯誤結束，所以請在 pull request 上執行 `--dry-run`，在合併時再套用。使用 `--prune` 時，先前的 apply 所建立、但檔案中已不再提到的檢查會被刪除。你手動新增的檢查絕不會被刪除。來自檔案的檢查會在其資料列上說明這一點，下一次套用會覆寫以手動做過的變更。

這些鍵為 `name`、`table`、`database`、`type`、`column`、`segment`、`accepted_values`、`format`、`pattern`、`references`、`query`、`sample_percent`、`every`、`alert`、`description` 和 `enabled`。

## 對帳

複本會產生偏差：資料倉儲中的訂單比應用程式的資料庫少，或一次移轉遺失了列。對帳會在 **對帳** 下比較兩個資料表（位於同一個資料庫或兩個資料庫中）的一個量值：

- **資料列數**
- 某一欄的 **總和**
- 某一欄的 **去重計數**
- **自訂 SQL**：傳回一個名為 `value` 之數字的唯讀查詢

它有一個容差：一個 **絕對值** 數量，或來源值的一個 **百分比**。每一端都由對帳建立並維護的專屬檢查讀取，並隨其資料庫的收集一起進行，因此對帳可以把你網路中的 PostgreSQL 資料表與它在 Snowflake 中的複本進行比較。兩個值都在彼此相隔 15 分鐘內被讀取後，才會進行比較。對帳會寫入：

- `oneuptime.data.reconciliation.drifted`：兩者的偏差超出容差時為 1，一致時為 0。它的監測器讀取的就是這個值。
- `oneuptime.data.reconciliation.difference`：目標的值減去來源的值。
- `oneuptime.data.reconciliation.difference_percent`：該差值占來源值的百分比。

依排程載入的複本會落後其來源：可以用自訂 SQL 比較兩者都已穩定的量值，例如一小時以前的列，或在容差中為延遲預留空間。

## dbt 測試

dbt 建置完成後，`oneuptime dbt upload` 會傳送專案的建置成品（請參閱 [血緣與管線](/docs/data-observability/lineage-and-pipelines)）。之後，受監看資料表的每個測試都會顯示在該資料表的 **檢查** 索引標籤上，並附上它的最新結果和它找到的失敗列。選擇 **失敗時發出警示**，即可讓失敗的測試開啟一個警示。

## 後續步驟

:::cards
- [血緣與管線](/docs/data-observability/lineage-and-pipelines): 傳送 dbt 的建置成品，並查看失敗的檢查背後的執行。
- [資料產品](/docs/data-observability/data-products): 向使用資料的人承諾資料是新鮮的。
:::
