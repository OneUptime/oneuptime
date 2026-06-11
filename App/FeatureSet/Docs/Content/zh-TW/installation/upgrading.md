# 升級 OneUptime

本指南說明如何安全地升級您自行託管的 OneUptime 安裝環境。

## 一般指引

- 跨主要版本時請逐步升級（例如 6 → 7 → 8）。請勿跳過主要版本。
- 只要您依循發行說明，便可跨越多個次要／修補版本（例如 8.1 → 8.4）。
- 升級前請務必進行備份，並驗證您能夠成功還原這些備份。

## 從 OneUptime 10 升級至 11

OneUptime 11 重新建構了 ClickHouse 遙測（telemetry）儲存架構。本頁說明有哪些變更、哪些人需要採取行動，以及——對於希望保留歷史遙測資料的安裝環境——完成此事所需的每一道查詢。

### v11 有哪些變更

遙測資料（日誌、追蹤、指標、例外、效能剖析、監控器日誌、稽核日誌）將移轉至新的 ClickHouse 資料表，新資料表採用以時間為基礎的分割區（partition）、逐欄位的壓縮編解碼器（codec），以及新的實體模型欄位：

| 舊資料表              | 新資料表              |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

每張遙測資料表上有兩個欄位被重新命名：`serviceId` → `primaryEntityId`，以及 `serviceType` → `primaryEntityType`。這是強制性的重新命名——**如果您直接以 `serviceId`／`serviceType` 篩選條件查詢 OneUptime 分析 API，請將其更新為新的欄位名稱。** OneUptime 內部的儀表板、監控器與告警會自動完成移轉。

這次切換為**僅向前生效（forward-only）**：新資料表一開始是空的，升級後攝入的所有遙測資料會立即寫入新資料表，而歷史資料會隨時間自然累積回來。舊資料表會被保留，並透過其保留期限 TTL 逐步自行刪除。

### 哪些人需要採取行動

- **全新安裝：** 無需任何動作。
- **不需要在 UI 中看到升級前遙測資料的升級：** 無需任何動作。遙測頁面只會顯示升級時間點之後的資料；較舊的資料會在無人查看的情況下，於舊資料表中逐漸過期。
- **希望看到升級前遙測資料的升級：** 在升級後的任何時間點，執行下方的手動複製程序。

一如既往：請逐步升級主要版本（10 → 11，請勿跳過），並在升級前備份 Postgres 與 ClickHouse。

### 選用：保留遙測歷史資料

請在**升級完全啟動完成後**再執行下列步驟（新資料表及其物化檢視表（materialized view）必須已存在）。請直接連線至您的 ClickHouse 主機——原生協定沒有 HTTP 逾時限制，因此執行數小時的陳述式也沒有問題：

```bash
clickhouse-client --database oneuptime
```

開始前的注意事項：

- 在 OneUptime 持續運作期間執行複製是安全的。新的遙測資料會獨立寫入新資料表；複製的歷史資料會在背後逐步填入。
- 在大規模環境（數百 GB）下，預期需要數小時。
- 下方每一道陳述式都帶有 `insert_deduplication_token`，且新資料表內建去重複（deduplication）視窗——因此**重新執行中途失敗的陳述式是安全的**（已插入的區塊會被略過，包括指標彙總資料表中的區塊），前提是您在合理的時間內重新執行。在大量即時攝入的情況下，該視窗（每張資料表最近 10,000 個插入區塊）最終會淘汰較舊的 token。
- 複製指標資料時也會自動重建預先彙總的儀表板彙總資料（每一筆複製的資料列都會重新饋入彙總物化檢視表）——這使得指標的複製比其他資料表更慢；請最後再執行。

#### 步驟 1 — 列出來源分割區

每張舊資料表最多有 16 個分割區。針對每張來源資料表執行：

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### 步驟 2 — 產生複製陳述式

不同安裝環境之間的欄位集合可能略有差異（較舊的部署可能缺少近期新增的欄位），因此請從您實際運作中的結構描述（schema）產生陳述式，而不要直接複製貼上固定的版本。請在 `WITH` 子句中將 `src` 與 `dst` 設定為上方表格中的其中一組資料表配對，然後執行：

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

產生的陳述式只會複製兩張資料表共有的欄位（新欄位採用其預設值）、在複製過程中即時重新命名 `serviceId`／`serviceType`、以確定性的方式排序資料列（使重試時產生完全相同、可去重複的區塊），並解除此規模陳述式所需的執行時間與分割區數量限制。

#### 步驟 3 — 逐一分割區執行

取得產生的陳述式後，將其中的 `{PARTITION}`（出現兩次——分別在 `WHERE` 子句與 token 中）替換為步驟 1 列出的各個分割區 ID。請一次執行一道陳述式，然後針對每組資料表配對重複步驟 1–3。

如果陳述式中途失敗，請儘速重新執行**同一道**陳述式——已提交的區塊會自動去重複。如果隔了很久才重新執行，請先比對資料列數（步驟 5）。

#### 步驟 4（選用）— 各主機指標彙總歷史資料

複製的原始指標資料列會自動重建服務層級的彙總資料，但不包含**各主機（per-host）**的彙總（舊資料列沒有主機實體鍵）。升級程序刻意保留了舊的各主機彙總資料表，讓您可以將其轉移過來，並從主機名稱計算出新的鍵值：

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

#### 步驟 5 — 驗證

比對每組資料表配對的總筆數（新資料表也包含升級後寫入的資料列，因此其筆數應大於或等於舊資料表）：

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### 步驟 6（選用）— 提早回收磁碟空間

舊資料表會透過 TTL 自行清空，但一旦您確認複製結果無誤，即可立即刪除它們：

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
```

> 提示：與每次主要版本升級一樣，請先在預備（staging）環境中測試，並在正式環境依賴複製的資料之前，確認遙測資料已正常流入新資料表。



## 從 OneUptime 9 升級至 10

沒有需要手動處理的變更。只需依循標準升級程序即可。

## 從 OneUptime 8 升級至 9

Helm chart 不再佈建 Kubernetes Ingress 資源。OneUptime 隨附一個 ingress gateway 容器，該容器已負責終止 TLS、管理狀態頁面網域，並為平台路由流量，因此不再需要叢集 ingress controller。

- 升級前，請從您自訂的 `values.yaml` 檔案中移除任何 `oneuptimeIngress` 覆寫設定。這些鍵值現已被忽略，若保留將會造成驗證錯誤。
- 確保 `nginx.service.type` 反映您希望如何公開內建的 ingress gateway（例如 `LoadBalancer`、`NodePort`，或搭配外部負載平衡器的 `ClusterIP`）。
- 確認狀態頁面或主要主機的任何 DNS 記錄仍指向位於 OneUptime ingress gateway 前端的 Service 或負載平衡器。
- 升級後，請確認 TLS 憑證持續透過內嵌 gateway 進行更新，且狀態頁面網域可正確解析。


## 從 OneUptime 7 升級至 8

如果您在 Kubernetes 上執行，將會有重要的破壞性變更：

- 由於 [Bitnami 授權變更](https://github.com/bitnami/charts/issues/35164)，我們不再為 Postgres、Redis 與 ClickHouse 使用 Bitnami charts
- 這些變更不向下相容。您必須依循 Helm chart `values.yaml` 中的新結構。
- 升級前請備份您的資料（Postgres、ClickHouse，以及任何持久性磁碟區）。


> 提示：請先在預備（staging）環境中測試升級。在升級正式環境之前，請確認您的工作負載正常且資料完整無損。
