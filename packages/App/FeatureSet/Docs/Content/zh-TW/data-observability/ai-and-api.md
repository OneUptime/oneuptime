# OneUptime AI 與 API

OneUptime AI 了解你的資料：它從資料表的寫入者、執行和上游資料表著手調查資料警示，無論在哪裡被問到都能回答某個資料表是否新鮮，還能根據用一句話說出的規則撰寫檢查。資料可觀測性顯示的一切，也都可以透過它的端點、指標和 MCP 伺服器提供給你自己的工具。

## OneUptime AI

- **資料警示的調查。** 當 OneUptime AI 調查某個資料表、管線或資料庫上的警示時，它會從與之相鄰的內容著手：資料表的新鮮度和開啟的警示、造成這個警示的那個警示、自前一天以來寫入該資料表的管線的執行（帶有錯誤的失敗執行，或從未到來的執行）、寫入該資料表的服務及其失敗的寫入、部署和其他變更，以及建置該資料表的資料表。它會指出警示背後的執行、部署或上游資料表。請參閱 [AI SRE](/docs/ai/ai-sre)。
- **這個資料表新鮮嗎？** 在 [詢問 AI](/docs/ai/ask-ai)、Slack 或 Microsoft Teams 中提問：「orders 資料表新鮮嗎？」。答案會提供依資料表本身節奏判斷的新鮮度、它最後一次變更的時間、開啟的警示、寫入者的最新執行，以及它所屬的資料產品。多個資料庫共用的名稱會針對每個資料庫分別回答，因此不會有人被告知錯誤的資料表是新鮮的。
- **用一句話撰寫檢查。** 在資料表的 **檢查** 索引標籤上，**用一句話撰寫檢查** 會把一條規則轉換成使用你的引擎 SQL 的自訂 SQL 檢查。請參閱 [檢查與對帳](/docs/data-observability/checks)。

這些功能都需要為專案開啟 OneUptime AI，並以提問者的權限執行操作。

## AI 代理和 MCP 伺服器

AI 代理應該在使用資料之前，先檢查資料是否新鮮。[MCP 伺服器](/docs/ai/mcp-server) 為此提供了一個唯讀工具：

| 工具 | 它回答什麼 |
| --- | --- |
| `get_data_table_freshness` | 受監看的資料表是否新鮮、它最後一次變更的時間、開啟的警示、寫入者的最新執行，以及它的資料產品。`table` 可以是 `schema.table`、單獨的資料表名稱或資料表的 ID |

它可以使用唯讀登入運作，並以登入的使用者或 API 金鑰的身分回答。

## 端點

| 端點 | 用途 | 簽署方式 |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | 來自 Airflow、Dagster、Spark、dbt 或 Flink 的 OpenLineage 事件 | 遙測擷取金鑰 |
| `POST /telemetry/dbt/v1/artifacts` | dbt 建置的 `manifest` 和 `run_results` | 遙測擷取金鑰 |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetran 的同步 Webhook | 擷取金鑰，作為 Fivetran 的簽署密碼 |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbyte 的同步 Webhook | URL 中的擷取金鑰 |
| `POST /api/data-observability/tables/freshness` | 資料表的新鮮度，與 MCP 工具的回答相同，要求內容為 `{ "table": "public.orders" }` | API 金鑰 |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | 資料產品的「data as of」徽章 | 徽章本身的權杖 |

資料表、檢查、對帳、管線和資料產品也是 [API](/docs/api-reference/api-reference) 中的一般資源，可以使用具有相應權限的 API 金鑰讀取和變更。

## 指標

資料可觀測性保存的每個數字都是一個指標，你可以為它繪製圖表、放到儀表板上或據此發出警示：每個資料表的 `oneuptime.data.table.*`、每個檢查的 `oneuptime.data.check.value`、每個對帳的 `oneuptime.data.reconciliation.*`、每個管線的 `oneuptime.data.pipeline.*`，以及每個資料產品的 `oneuptime.data.product.*`。它們是 OneUptime 本身的營運資料，不以遙測計費。

## 後續步驟

:::cards
- [MCP 伺服器](/docs/ai/mcp-server): 將 AI 代理連接到 OneUptime。
- [資料可觀測性](/docs/data-observability/index): 返回概覽。
:::
