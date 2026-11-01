# 設定資料安全

資料安全只讀取你允許它讀取的內容。每個雲端連線會以三個層級之一讀取，你自行執行的資料庫會透過你提供的連線字串讀取，遙測則不需要任何設定。本頁說明每種選擇讓 OneUptime 讀取什麼、它確切授予哪些權限，以及 OneUptime 會保留所讀取內容的哪些部分。

:::cards
- [選擇層級](#為每個連線選擇層級): 關閉、僅設定，或設定和內容樣本。
- [每個層級授予的權限](#每個層級授予的權限): AWS 動作，以及 Azure 和 Google Cloud 角色。
- [掃描你自行執行的資料庫](#掃描你自行執行的資料庫): 唯讀連線字串，或你網路中的探測器。
- [OneUptime 保留的內容](#oneuptime-保留的內容): 計數、位置和遮罩樣本，從不保留值本身。
- [讓資料安全關閉暴露](#讓資料安全關閉暴露): 連線唯一可獲得的寫入權限，在你開啟之前保持關閉。
:::

## 為每個連線選擇層級

| 層級 | 表單中的選項 | OneUptime 讀取的內容 |
| --- | --- | --- |
| 關閉 | **關閉** | 不讀取任何資料儲存區的設定或內容。資料安全仍會列出你的雲端資源清單所知的資料儲存區，以及資源清單對它們的描述：RDS 資料庫是否已加密、是否公開、是否受刪除保護、是否已備份，以及 DynamoDB 資料表是否可以還原到某個時間點。 |
| 設定 | **僅設定** | 每個資料儲存區的設定方式：誰可以存取它，以及它如何加密、備份、版本控制、記錄日誌、複寫和加上標記。從不讀取資料，也從不讀取祕密。 |
| 內容 | **設定和內容樣本** | 上述內容，以及 S3 儲存貯體、Azure 儲存體帳戶、Cloud Storage 儲存貯體和 BigQuery 資料集所保存內容的樣本。 |

每個連線一開始都是 **關閉**。[連線雲端帳戶](/docs/telemetry/cloud-accounts#資料安全) 逐字列出每個層級在每種雲端上執行的指令。若要變更連線的層級：

:::steps
### 開啟連線

前往 **雲端 → 連線**。在該連線上選擇 **編輯**，或連線新的帳戶。

### 選擇層級

在 **更多欄位** 下，將 **資料安全** 設為你要的層級。

### 再次執行指令

表單顯示的指令會隨層級而改變。請像連線時一樣，在你的雲端的終端機中執行它：它只授予新層級所需的權限，不會多給。然後選擇 **儲存變更**，如果是新連線則選擇 **連線**。
:::

新層級的讀取會在一小時內開始，在資料儲存區上選擇 **立即檢查** 或 **立即掃描** 則會立即開始一次。無論角色仍允許什麼，OneUptime 只讀取連線層級所指定的內容：降低層級後，讀取會立即停止。若要同時收回存取權，請執行新的指令：在 AWS 上，它會以較低層級的政策取代原有的政策。**關閉** 不會新增任何內容，因此會保留先前指令所授予的權限。請自行移除這些權限：在 AWS 上使用 `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`，在 Azure 和 Google Cloud 上則移除內容層級所新增的角色。

## 每個層級授予的權限

### Amazon Web Services

設定層級會在角色上，於唯讀政策之外再加上第二個內嵌政策 `OneUptimeDataSecurity`。它恰好包含資料安全讀取器所呼叫的讀取動作。每個動作都只讀取一項設定，沒有任何動作會讀取資料或寫入任何內容：

| OneUptime 的用途 | 動作 |
| --- | --- |
| 列出儲存貯體，並讀取誰可以存取每個儲存貯體，以及它如何加密、版本控制、記錄日誌、複製和加上標記 | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| 讀取資料庫的存取、加密和備份方式，以及其手動快照與誰共用 | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| 讀取搜尋網域、快取和檔案系統的設定方式 | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| 區分 AWS 自有的金鑰（alias/aws/...）和你管理的金鑰 | `kms:ListAliases` |

內容層級會在同一個政策中新增三個動作，每個動作各自作用於其資源：

| 動作 | 允許的資源 | 用途 |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | 列出儲存貯體的物件名稱 |
| `s3:GetObject` | `arn:aws:s3:::*/*` | 讀取取樣物件的前幾個位元組 |
| `kms:Decrypt` | `*`，僅限 `kms:ViaService` 為 `s3.*.amazonaws.com` 時 | 讀取以 KMS 金鑰加密的物件，且只能透過 S3：從不直接解密該金鑰保護的其他任何內容 |

如果使用 **存取金鑰** 而不是角色，政策會放在金鑰的使用者所加入的群組 `OneUptimeDataSecurity` 上：IAM 將使用者自身的內嵌政策總長度限制為 2,048 個字元，而唯讀政策已占用其中大部分。讀取整個 AWS Organization 的連線，會在每個帳戶的角色中放入相同的政策。

:::details 內容層級的完整政策
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetReplicationConfiguration",
        "s3:GetBucketTagging",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots",
        "rds:DescribeDBSnapshotAttributes",
        "rds:DescribeDBClusterSnapshots",
        "rds:DescribeDBClusterSnapshotAttributes",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "redshift:DescribeClusters",
        "redshift:DescribeLoggingStatus",
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
        "kms:ListAliases"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "kms:ViaService": "s3.*.amazonaws.com"
        }
      }
    }
  ]
}
```
:::

### Microsoft Azure

設定層級不會新增任何內容：連線的 **Monitoring Reader** 角色已經會透過 Azure Resource Manager 讀取每個資源的設定。內容層級會在與連線相同的範圍上新增內建的 **Storage Blob Data Reader** 角色，也就是訂用帳戶，或租用戶的根管理群組。

### Google Cloud

設定層級不會新增任何內容：連線的 **Cloud Asset Viewer** 角色已經會讀取每個資源的設定和 IAM 政策。內容層級會在專案或組織上新增兩個角色 `roles/storage.objectViewer` 和 `roles/bigquery.dataViewer`，並啟用 BigQuery API `bigquery.googleapis.com`。

## 讓資料安全關閉暴露

除非你另行選擇，否則連線只會讀取。**更多欄位** 下位於 **資料安全** 旁的 **資料安全回應**，還能讓資料安全封鎖資料儲存區的公開存取並停止共用其快照：可以在資料儲存區的問題中透過 **在此修正** 執行（請參閱 [資料安全檢查與問題](/docs/data-security/checks-and-issues#在此修正)），也可以透過 Security Operations 劇本執行。在你選擇 **封鎖公開存取和共用** 之前，它都是 **關閉**，選擇之後，表單顯示的指令會單獨授予一項範圍很窄的寫入權限：

| 雲端 | 指令新增的內容 | 它可以做什麼 |
| --- | --- | --- |
| AWS | 第三個內嵌政策 `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` 和 `rds:ModifyDBClusterSnapshotAttribute`：儲存貯體的封鎖公開存取設定，以及手動快照與誰共用 |
| Azure | 位於連線範圍上的自訂角色 `OneUptime Data Security Response` | `Microsoft.Storage/storageAccounts/read` 和 `Microsoft.Storage/storageAccounts/write`：儲存體帳戶的設定，例如匿名 Blob 存取，從不涉及其金鑰 |
| Google Cloud | 自訂角色 `oneuptimeDataSecurityResponse` | `storage.buckets.get` 和 `storage.buckets.update`：儲存貯體的設定，例如禁止公開存取 |

它授予的權限都不會讀取資料、刪除任何內容或變更誰可以登入。將它設回 **關閉**，資料安全就會立即停止使用它。若要在 AWS 上同時收回存取權，請使用 `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse` 刪除該政策。

## 為什麼內容樣本是選用的

設定層級會找出暴露的內容：公開的儲存貯體、對網際網路開放的資料庫，以及缺少的加密、備份或存取日誌。它無法得知資料儲存區保存了什麼，因此沒有發現任何內容的資料儲存區會被視為「公開」，也就是最低的敏感度，其問題的嚴重程度與公開資料相同。保存網站圖片的公開儲存貯體並不緊急；保存卡號的公開儲存貯體則很緊急。

內容樣本能區分這兩者。它們會根據每個資料儲存區保存的內容設定其敏感度，因此同一個缺失在卡號上是「嚴重」，在圖片上是「低」。它們還能找出只有內容才會顯示的東西：祕密、卡片安全碼、依輸入時原樣保存的密碼，以及測試資料儲存區中的正式環境資料複本。

因此，大多數團隊的做法是：先在所有地方使用設定層級，再在需要了解資料儲存區保存什麼的地方使用內容樣本。內容掃描也可以透過資料儲存區 **設定** 中的 **掃描內容** 針對單一資料儲存區關閉，或針對整個專案關閉。

## 內容掃描讀取的內容

一次掃描會在專案的限制內讀取資料儲存區的一小部分，並在 8 分鐘後停止，無論還剩下多少。下一次掃描會從那裡繼續：它會略過自上次讀取後沒有變更的物件，除非上次讀取已是 7 天或更久以前。

- **儲存貯體和容器** 依種類取樣，而不是依數量。系統會先列出物件名稱，數量最多為掃描可讀取數量的十倍，且絕不超過 200,000 個。每個名稱都會轉換為其模式，其中的日期、UUID、長串十六進位字元和數字會變為 `*`，因此 `exports/2026-10-27/users-0001.csv` 會變為 `exports/*/users-*.csv`。系統會讀取每種模式中最新的物件，先讀取每種模式各一個，才會讀取任何模式的第二個，且同一種模式最多讀取 5 個。每個物件都從開頭讀取：每個物件最多讀取 **每個物件的位元組數**，總共最多讀取 **每次掃描的位元組數**。一次掃描最多對 Azure 儲存體帳戶的 10 個容器取樣。
- **檔案依其實際格式讀取。** CSV 和 TSV 依欄讀取，JSON 和 JSON lines 依路徑讀取，`.env`、`.ini`、`.properties`、TOML 和 YAML 依鍵讀取，XML 和 HTML 讀取其文字，Word、Excel 和 PowerPoint 檔案讀取其文字和儲存格，其他任何檔案則作為自由文字讀取。gzip 檔案會先解壓縮。圖片、Parquet、Avro、PDF 和其他二進位格式不會被讀取，掃描會註明這一點。
- **資料集和資料庫** 逐一資料表讀取：最多讀取 **每次掃描的資料表數** 個資料表，每個資料表最多讀取 **每個資料表的列數** 列。

每次掃描都會依名稱記錄它讀取了什麼：物件、資料表或服務，從不記錄其內容。它無法讀取的部分（雲端拒絕的請求、時限、位元組預算）會成為該掃描上的警告，而該掃描會標示為 **部分成功**。

## 掃描你自行執行的資料庫

資料安全會以下列兩種方式之一對 PostgreSQL 和 MySQL 資料庫取樣。Database 產品所監控的資料庫，或服務地圖上你的服務所連線的資料庫，本身就已經是資料儲存區。對於任何掃描都找不到的資料庫，請自行將它新增為資料儲存區。

- **從 OneUptime 的工作程序。** 在資料儲存區的 **設定** 中，將 **連線字串** 設為只能讀取的連線字串，例如 `postgresql://reader:password@db.internal:5432/app`。它會以加密形式儲存，且 API 從不傳回它。請為它提供一個只能讀取、不能做其他任何事的資料庫使用者。
- **從你網路中的探測器。** 在 **從探測器掃描** 下選擇探測器，並在 **探測器連線變數** 中輸入該探測器上保存連線字串的環境變數名稱。探測器會從你的網路內部讀取資料庫，只傳回它找到的內容：連線字串永遠不會到達 OneUptime。若要執行探測器，請參閱 [自訂探測器](/docs/probe/custom-probe)。

## OneUptime 保留的內容

對於在每個位置（資料欄、欄位、物件模式、遙測屬性）找到的每種資料類型，一項發現會保留：

- 在多少個取樣值中有多少個包含它，以及其中有多少個是常見的測試值；
- 有多少個不同的值符合，這是根據雜湊估算的，這些雜湊只保留在掃描器的記憶體中，並隨掃描一起捨棄；
- 信賴度，以及位置的名稱是否指向該資料類型；
- 最多三個遮罩樣本，在任何內容離開掃描器之前就已在掃描器內部完成遮罩。

它從不保留原始值。每種值的遮罩方式都讓人能認出它，卻無法使用它：

| 值 | 遮罩樣本 |
| --- | --- |
| 電子郵件地址 | `j***@e******.com`：名稱和網域的第一個字母，以及頂層網域標籤 |
| 卡號 | `**** **** **** 4242`：最後四位數字，這是 PCI DSS 允許顯示卡號的方式 |
| 祕密 | 較長時保留其前四個和後四個字元，較短時保留其前兩個字元，私密金鑰則只保留標頭 |
| URL 或連線字串 | 除密碼外的全部內容 |
| IP 位址 | 保留其第一部分（即網路），其餘部分隱藏 |
| 依名稱找到的值 | 其第一個字元，後接 `****` |
| 文件標記 | 依原文保留標記，例如「機密」：它說明文件屬於哪一類 |
| 其他任何值 | 其最後二到四個字元，並保留分隔符號，例如 `***-**-6789` |

在專案的設定中關閉 **保留遮罩樣本**，即可只保留計數：從每個資料儲存區的下一次掃描開始，它寫入的發現都不會保留樣本。

資料儲存區之間的資料複本是透過指紋而不是值找到的：每種資料類型 128 個 16 位元的數字，以專案自己的金鑰進行雜湊（請參閱 [指紋如何保持私密](/docs/data-security/flows-access-residency#指紋如何保持私密)）。

掃描最後一次看到某項發現後的 30 天內，它仍會計入其資料儲存區，因為取樣可能會遺漏仍然存在的內容。90 天未再出現的發現會被刪除。一個資料儲存區最多保留 2,000 項發現。

## 設定

資料安全的設定每個專案一組，位於資料安全選單的 **設定** 區段中。它們的預設值如下：

| 設定 | 預設值 | 作用 |
| --- | --- | --- |
| **檢查設定** | 開啟 | 對每個資料儲存區執行檢查。關閉時，不會有任何問題開啟、變更或關閉。 |
| **掃描內容** | 開啟 | 在已授予內容權限的地方，對資料儲存區的內容取樣。 |
| **掃描遙測** | 開啟 | 對專案的日誌、追蹤、例外、重播和 AI 對話取樣。 |
| **保留遮罩樣本** | 開啟 | 每項發現最多保留三個遮罩樣本。關閉時只保留計數。 |
| **開啟安全案例** | 開啟 | 「嚴重」問題開啟時，開啟一個依資料儲存區分組的安全案例。 |
| **發出警示** | 關閉 | 「嚴重」問題開啟時發出警示，呼叫正在待命的人員。 |
| **警示嚴重性** | 空白 | 這些警示的嚴重程度。空白時使用專案中最嚴重的嚴重程度。 |
| **宣告事件** | 關閉 | 「嚴重」問題開啟時宣告事件，交由你的事件處理流程處理。 |
| **事件嚴重性** | 空白 | 這些事件的嚴重程度。空白時使用專案中最嚴重的嚴重程度。 |
| **通知擁有者** | 開啟 | 資料儲存區上開啟問題時，以電子郵件通知其擁有者。 |
| **每次掃描的物件數** | 2,000 | 對儲存貯體的一次掃描最多讀取的物件數，從 10 到 50,000。 |
| **每個物件的位元組數** | 65,536 (64 KB) | 從一個物件最多讀取的位元組數，從 1,024 到 4,194,304。 |
| **每次掃描的位元組數** | 52,428,800 (50 MB) | 一次內容掃描總共最多讀取的位元組數，從 65,536 到 1,073,741,824。 |
| **每個資料表的列數** | 1,000 | 從一個資料表最多讀取的列數，從 10 到 100,000。 |
| **每次掃描的資料表數** | 200 | 一次掃描最多讀取的資料表數，從 1 到 5,000。 |
| **遙測樣本大小** | 500 | 一次遙測掃描讀取的每個服務和每種訊號的最近記錄數，從 10 到 10,000。 |
| **掃描間隔（小時）** | 24 | 多久重新對資料儲存區的內容取樣一次，從 1 到 720。 |
| **絕不視為敏感** | 空白 | 永遠不會成為發現的值，例如你自己的支援地址。 |
| **已關閉的資料類型** | 空白 | 專案的掃描不會尋找的內建資料類型：即 **內建資料類型** 下的開關。 |

## 疑難排解

:::details 資料儲存區顯示其內容未被掃描
掃描會說明原因：「內容掃描需要連線的內容權限，或資料庫的連線字串。」請將資料儲存區的連線設為 **設定和內容樣本** 並再次執行其指令，或為資料庫提供連線字串。另外，也請檢查資料儲存區和專案設定中的 **掃描內容** 是否已開啟。
:::

:::details 檢查顯示無法判斷
讀取器無法讀取的事實（角色沒有的權限、未啟用的 API）會被視為未知，絕不會被猜測。其檢查會回報無法判斷，而它已開啟的問題會保持開啟：任何人都不能因為 OneUptime 無法查看，就斷定缺失已修正。設定讀取的警告會說明它無法讀取什麼。再次執行連線的指令，即可授予缺少的權限。
:::

:::details 沒有出現任何 S3 儲存貯體或 BigQuery 資料集
它們來自設定讀取，而不是雲端資源清單。請將連線設為 **僅設定** 或更高層級，並再次執行其指令。
:::

:::details 掃描標示為部分成功
它在讀取完所有內容之前達到了某項限制：8 分鐘、**每次掃描的位元組數** 或 **每次掃描的物件數**，或者雲端拒絕了某個請求。其警告會說明是哪一項。下一次掃描會繼續進行並略過未變更的內容，你也可以提高限制。
:::

## 後續步驟

:::cards
- [敏感資料類型](/docs/data-security/data-types): 掃描器會在讀取的內容中尋找什麼。
- [資料安全檢查與問題](/docs/data-security/checks-and-issues): 會針對設定讀取的結果檢查哪些項目。
- [遙測中的敏感資料](/docs/data-security/telemetry): 你的日誌、追蹤和 AI 對話，不需要任何設定。
- [連線雲端帳戶](/docs/telemetry/cloud-accounts): 首先連線 AWS、Azure 或 Google Cloud。
:::
