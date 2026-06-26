# 升級 OneUptime

本指南說明如何安全地升級您自行託管的 OneUptime 安裝環境。

## 一般指引

- 跨主要版本時請逐步升級（例如 6 → 7 → 8）。請勿跳過主要版本。
- 只要您依循發行說明，便可跨越多個次要／修補版本（例如 8.1 → 8.4）。
- 升級前請務必進行備份，並驗證您能夠成功還原這些備份。

## 從 OneUptime 10 升級到 11

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, sign-in through them is disabled after the upgrade,
and the settings pages show an upgrade prompt instead of the configuration
form. Your existing provider records are **preserved in the database** —
nothing is deleted — they simply become inactive until the instance runs the
Enterprise Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11 重建了 ClickHouse 遙測儲存。本頁說明有哪些變更、誰需要採取行動,以及——對於想保留歷史遙測資料的安裝環境——完成這件事所需的每一條查詢。

### v11 的變更

遙測資料(日誌、追蹤、指標、例外、效能分析、監控日誌、稽核日誌)遷移到新的 ClickHouse 資料表,新表採用基於時間的分割、逐欄壓縮編解碼器以及新的實體模型欄位:

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

所有遙測資料表中有兩個欄位被重新命名:`serviceId` → `primaryEntityId`,`serviceType` → `primaryEntityType`。這是硬性重新命名——**如果你直接以 `serviceId`/`serviceType` 篩選條件查詢 OneUptime analytics API,請更新為新名稱。** OneUptime 內部的儀表板、監控器和警示會自動遷移。

這次切換**只向前進行**:新表從空白開始,升級後攝入的所有遙測資料會立即寫入新表,歷史資料隨時間自然回填。舊表會在升級過程中**自動刪除**以回收磁碟空間——如果你想保留遷移歷史資料的選項,請在升級**之前**重新命名它們(見下方步驟 0)。

> **已經在使用 11.0.0 或 11.0.1?** 這些版本會保留舊表(它們透過 TTL 逐漸清空,複製可以「升級後隨時」執行)。之後的任何更新都會**在啟動時刪除它們**。如果你仍想進行歷史資料複製且尚未完成,請在套用更新之前執行下方的步驟 0。

### 誰需要採取行動

- **全新安裝:** 無需任何操作。
- **介面中不需要升級前遙測資料的升級:** 無需任何操作。遙測頁面只顯示升級時刻之後的資料;舊表會在升級過程中被刪除。
- **希望看到升級前遙測資料的升級:** 在升級**之前**重新命名舊表(見下方步驟 0),然後在升級後隨時執行手動複製。

一如既往:主版本要逐級升級(10 → 11,不要跳版),並在升級前備份 Postgres 和 ClickHouse。

### 選用:遷移遙測歷史資料

步驟 0 在**升級之前**執行;從步驟 1 開始的所有操作都在**升級完全啟動之後**執行(新表及其物化檢視必須已存在)。請直接在 ClickHouse 主機上連線——原生協定沒有 HTTP 逾時,因此執行數小時的陳述式也沒有問題:

```bash
clickhouse-client --database oneuptime
```

開始之前需要瞭解:

- 複製可以在 OneUptime 上線運行時安全執行。新的遙測資料獨立寫入新表;複製的歷史資料在其後填充。
- 大規模資料(數百 GB)預計需要數小時。
- 下面每條陳述式都帶有 `insert_deduplication_token`,且新表內建去重視窗——因此**重新執行中途失敗的陳述式是安全的**(已插入的區塊會被跳過,包括指標彙總中的區塊),前提是盡快重試。在高強度即時攝入下,視窗(每表最近 10,000 個插入區塊)最終會淘汰舊權杖。
- 複製指標還會自動重建預先彙總的儀表板彙總(每條複製的列都會重新饋入彙總物化檢視)——這使得指標複製比其他複製更慢;請最後執行。

#### 步驟 0——升級前重新命名舊表

升級會在啟動時刪除舊表,所以請先把你要作為複製來源的表移出它的影響範圍。停止 OneUptime(將部署縮減到零),確保沒有任何程序寫入或能重建這些表,然後重新命名——`RENAME TABLE` 是瞬時的中繼資料操作,`IF EXISTS` 讓整個區塊跳過你的安裝環境從未有過的表(早於 10.0.x 中期的部署可能沒有 `AuditLogV1` 或某些 `…V2` 表——那就沒有該類型的歷史資料可複製):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

然後執行升級,等 OneUptime 完全啟動後再繼續。

> 如果在重新命名後回滾到 v10(v10 啟動時會以舊名稱重建空表),請在重新啟動 v10 之前把 `_backup` 表改回原名——否則回滾期間攝入的遙測資料會進入重建的表,並在之後的升級中被刪除。

#### 步驟 1——列出來源分割區

每張舊表最多有 16 個分割區。對每張來源表執行:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### 步驟 2——產生複製陳述式

不同安裝環境的欄位集合可能略有差異(較舊的部署可能缺少最近新增的欄位),因此請基於你的實際 schema 產生陳述式,而不是照搬固定陳述式。把 `WITH` 子句中的 `src` 和 `dst` 設定為上表中的一對表(來源表帶有步驟 0 的 `_backup` 後綴),然後執行:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
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

產生的陳述式只複製兩張表共有的欄位(新欄位取預設值),即時重新命名 `serviceId`/`serviceType`,對列進行確定性排序以便重試產生完全相同、可去重的區塊,並解除這種規模的陳述式所需的執行時間和分割區數量限制。

#### 步驟 3——逐一分割區執行

取產生的陳述式,將 `{PARTITION}`(出現兩次——在 `WHERE` 和權杖中)替換為步驟 1 得到的每個分割區 id。逐條執行陳述式,然後對每對表重複步驟 1–3。

> 注意:如果某張來源表因在你的安裝環境中不存在而在步驟 0 被跳過,該表對的步驟 1 會以 `UNKNOWN_TABLE` 失敗——直接跳過該表對即可;沒有該類型的歷史資料可複製。

如果陳述式中途失敗,請盡快重新執行**同一條**陳述式——已提交的區塊會被去重。如果間隔很久才重試,請先比較列數(步驟 5)。

#### 步驟 4(選用)——按主機的指標彙總歷史

複製的原始指標列會自動重建服務層級彙總,但不會重建**按主機**的彙總(舊列沒有主機實體鍵)。步驟 0 重新命名的舊彙總表是這部分歷史的唯一來源;透過從主機名稱計算新鍵來遷移它:

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
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

`ORDER BY` 很重要:它確保重試產生完全相同的插入區塊,從而能被去重權杖識別。沒有它,重試可能被悄悄跳過或重複計算。(邊緣情況:包含 `\`、`|` 或 `=` 的主機名稱——這些不是合法的 RFC 1123 主機名稱字元——計算出的鍵會與應用程式不同;除非你確定有這樣的主機,否則可以忽略。)

#### 步驟 5——驗證

按表對比較總數(新表還包含升級後的列,因此應大於或等於舊表):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### 步驟 6——刪除備份表

重新命名後的表保留其保留期 TTL,因此會自行清空和縮小——但一旦你對複製結果滿意,就刪除它們以立即回收磁碟:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` 僅為該條陳述式解除伺服器 50 GB 的刪除保護。)

> 提示:與所有主版本升級一樣,請先在預備環境中測試,並確認遙測資料正流入新表,再於正式環境依賴複製結果。

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
