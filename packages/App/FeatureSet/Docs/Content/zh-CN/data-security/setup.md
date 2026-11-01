# 设置数据安全

数据安全只读取你允许它读取的内容。每个云连接按三个级别之一读取，你运行的数据库通过你提供的连接字符串读取，遥测则无需任何设置。本页说明每种选择允许 OneUptime 读取什么、它授予的确切权限，以及 OneUptime 会保留所读内容中的哪些部分。

:::cards
- [选择级别](#为每个连接选择级别): 关闭、仅配置，或配置和内容样本。
- [每个级别授予的权限](#每个级别授予的权限): AWS 操作，以及 Azure 和 Google Cloud 角色。
- [扫描你运行的数据库](#扫描你运行的数据库): 只读连接字符串，或你网络中的探测器。
- [OneUptime 保留的内容](#oneuptime-保留的内容): 计数、位置和脱敏样本，从不保留值本身。
- [让数据安全关闭暴露](#让数据安全关闭暴露): 连接唯一可以获得的写入权限，在你开启之前一直关闭。
:::

## 为每个连接选择级别

| 级别 | 在表单中 | OneUptime 读取的内容 |
| --- | --- | --- |
| 关闭 | **关闭** | 不读取任何数据存储的配置或内容。数据安全仍会列出你的云资源清单所知道的数据存储，以及清单中关于它们的信息：RDS 数据库是否加密、是否公开、是否有删除保护、是否有备份，以及 DynamoDB 表能否恢复到某个时间点。 |
| 配置 | **仅配置** | 每个数据存储的设置方式：谁可以访问它，以及它如何加密、备份、版本控制、记录日志、复制和打标签。从不读取数据，也从不读取密钥。 |
| 内容 | **配置和内容样本** | 上述内容，以及 S3 存储桶、Azure 存储账户、Cloud Storage 存储桶和 BigQuery 数据集中所保存内容的样本。 |

每个连接一开始都是 **关闭**。[连接云账户](/docs/telemetry/cloud-accounts#数据安全) 逐字给出了每个级别在每种云上运行的命令。要更改连接的级别：

:::steps
### 打开连接

前往 **云 → 连接**。在连接上选择 **编辑**，或连接一个新账户。

### 选择级别

在 **更多字段** 下，将 **数据安全** 设为你想要的级别。

### 再次运行命令

表单显示的命令会随级别而变化。像连接时那样，在你的云的终端中运行它：它只授予新级别所需的权限，不会多授予任何东西。然后选择 **保存更改**；如果是新连接，则选择 **连接**。
:::

按新级别进行的读取会在一小时内开始，在数据存储上选择 **立即检查** 或 **立即扫描** 则会立即开始一次读取。无论角色仍然允许什么，OneUptime 都只读取连接级别所规定的内容：一旦降低级别，相应的读取就会立即停止。如果还要收回访问权限，请运行新的命令：在 AWS 上，它会用较低级别的策略替换原策略。**关闭** 不添加任何内容，因此会保留之前的命令所授予的权限。请自行移除这些权限：在 AWS 上使用 `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`，在 Azure 和 Google Cloud 上则移除内容级别添加的角色。

## 每个级别授予的权限

### Amazon Web Services

配置级别会在角色上添加第二个内联策略 `OneUptimeDataSecurity`，与只读策略并列。它只包含数据安全读取器所调用的读取操作。每个操作都只读取一项设置，没有任何操作会读取数据或写入任何内容：

| OneUptime 的用途 | 操作 |
| --- | --- |
| 列出存储桶，并读取谁可以访问每个存储桶，以及它如何加密、版本控制、记录日志、复制和打标签 | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| 读取数据库如何被访问、加密和备份，以及它们的手动快照共享给了谁 | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| 读取搜索域、缓存和文件系统的设置方式 | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| 区分 AWS 自己的密钥（alias/aws/...）和你管理的密钥 | `kms:ListAliases` |

内容级别会向同一个策略添加三个操作，每个操作只作用于各自的资源：

| 操作 | 允许的资源 | 用途 |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | 列出存储桶中的对象名称 |
| `s3:GetObject` | `arn:aws:s3:::*/*` | 读取被抽样对象开头的若干字节 |
| `kms:Decrypt` | `*`，仅当 `kms:ViaService` 为 `s3.*.amazonaws.com` 时 | 读取用 KMS 密钥加密的对象，且只能通过 S3：绝不会直接解密该密钥保护的任何其他内容 |

如果使用 **访问密钥** 而不是角色，该策略会放在密钥的用户所加入的一个组 `OneUptimeDataSecurity` 上：IAM 将一个用户自身的内联策略总共限制在 2,048 个字符以内，而只读策略已经占用了其中的大部分。读取整个 AWS Organization 的连接会把同一个策略放进每个账户的角色中。

:::details 内容级别的完整策略
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

配置级别不添加任何内容：连接的 **Monitoring Reader** 角色已经通过 Azure Resource Manager 读取每个资源的配置。内容级别会添加内置的 **Storage Blob Data Reader** 角色，范围与连接相同：订阅，或租户的根管理组。

### Google Cloud

配置级别不添加任何内容：连接的 **Cloud Asset Viewer** 角色已经读取每个资源的配置和 IAM 策略。内容级别会在项目或组织上添加两个角色 `roles/storage.objectViewer` 和 `roles/bigquery.dataViewer`，并启用 BigQuery API `bigquery.googleapis.com`。

## 让数据安全关闭暴露

除非你另行选择，否则连接只会读取。**更多字段** 下 **数据安全** 旁边的 **数据安全响应** 还能让数据安全阻止数据存储的公开访问并停止共享其快照：可以在数据存储的问题中通过 **在此修复** 来做（请参阅 [数据安全检查与问题](/docs/data-security/checks-and-issues#在此修复)），也可以通过安全运营的剧本来做。在你选择 **阻止公开访问和共享** 之前，它一直是 **关闭**；选择之后，表单显示的命令会单独授予一项范围很窄的写入权限：

| 云 | 命令添加的内容 | 它可以做什么 |
| --- | --- | --- |
| AWS | 第三个内联策略 `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` 和 `rds:ModifyDBClusterSnapshotAttribute`：存储桶的 Block Public Access，以及手动快照共享给了谁 |
| Azure | 连接范围上的自定义角色 `OneUptime Data Security Response` | `Microsoft.Storage/storageAccounts/read` 和 `Microsoft.Storage/storageAccounts/write`：存储账户的设置，例如匿名 Blob 访问，从不涉及其密钥 |
| Google Cloud | 自定义角色 `oneuptimeDataSecurityResponse` | `storage.buckets.get` 和 `storage.buckets.update`：存储桶的设置，例如禁止公开访问 |

它授予的任何权限都不会读取数据、删除任何内容或更改谁可以登录。把它改回 **关闭**，数据安全就会立即停止使用它。如果还要在 AWS 上收回访问权限，请用 `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse` 删除该策略。

## 为什么内容样本是可选的

配置级别能找出暴露的内容：公开的存储桶、向互联网开放的数据库，以及缺失的加密、备份或访问日志。它无法判断数据存储中保存着什么，因此未找到任何内容的数据存储按公开计算，这是最低的敏感度，其问题的严重程度与公开数据的相同。一个存放网站图片的公开存储桶并不紧急；一个存放卡号的公开存储桶则十分紧急。

内容样本能区分这两种情况。它们根据数据存储中保存的内容设置其敏感度，因此同一个问题在卡号上为严重，在图片上为低。它们还能找出只有内容才能揭示的东西：密钥、银行卡安全码、按输入时原样保存的密码，以及测试数据存储中的生产数据副本。

因此，大多数团队的做法是：先在所有地方使用配置级别，再在需要了解数据存储中保存着什么的地方使用内容样本。也可以用数据存储 **设置** 中的 **扫描内容** 为单个数据存储关闭内容扫描，或为整个项目关闭内容扫描。

## 内容扫描读取什么

一次扫描会在项目的限制范围内读取数据存储的一小部分内容，并在 8 分钟后停止，无论还剩下多少。下一次扫描会从那里继续：它会跳过自上次读取以来没有变化的对象，除非上次读取是在 7 天或更久之前。

- **存储桶和容器** 按种类抽样，而不是按数量。首先列出对象名称，最多为扫描可读取数量的十倍，且绝不超过 200,000 个。每个名称都会变成它的模式：日期、UUID、长串十六进制字符和数字都变成 `*`，因此 `exports/2026-10-27/users-0001.csv` 会变成 `exports/*/users-*.csv`。读取的是每个模式中最新的对象：先每个模式各读一个，再读任何模式的第二个，同一模式最多读 5 个。每个对象都从头开始读取：每个对象最多读取 **每个对象字节数**，总共最多读取 **每次扫描字节数**。一次扫描最多对 Azure 存储账户的 10 个容器抽样。
- **文件按其实际格式读取。** CSV 和 TSV 按列读取，JSON 和 JSON Lines 按路径读取，`.env`、`.ini`、`.properties`、TOML 和 YAML 按键读取，XML 和 HTML 读取其文本，Word、Excel 和 PowerPoint 文件读取其文本和单元格，其他任何内容都作为自由文本读取。gzip 文件会先解压。图片、Parquet、Avro、PDF 和其他二进制格式不会被读取，扫描会说明这一点。
- **数据集和数据库** 逐表读取：最多读取 **每次扫描表数** 个表，每个表读取 **每个表的行数** 行。

每次扫描都会按名称记录它读取的内容：对象、表或服务，从不记录它们的内容。它未能读取的内容（云拒绝的请求、截止时间、字节预算）会成为该扫描上的警告，扫描会被标记为 **部分成功**。

## 扫描你运行的数据库

数据安全可以用两种方式之一对 PostgreSQL 和 MySQL 数据库抽样。Database 产品监控的数据库，或服务地图上你的服务所连接的数据库，本身就已经是数据存储。任何扫描都找不到的数据库，请自行添加为数据存储。

- **从 OneUptime 的工作进程读取。** 在数据存储的 **设置** 中，将 **连接字符串** 设为一个只能读取的连接字符串，例如 `postgresql://reader:password@db.internal:5432/app`。它会被静态加密，API 也从不返回它。请为它使用一个只能读取、不能做其他任何事的数据库用户。
- **从你网络中的探测器读取。** 在 **从探测器扫描** 下选择探测器，并在 **探测器连接变量** 中输入该探测器上保存连接字符串的环境变量的名称。探测器从你的网络内部读取数据库，只发回它找到的内容：连接字符串永远不会到达 OneUptime。要运行探测器，请参阅 [自定义探测器](/docs/probe/custom-probe)。

## OneUptime 保留的内容

对于在每个位置（列、字段、对象模式、遥测属性）找到的每种数据类型，一个发现会保留：

- 在多少个抽样值中有多少个包含它，以及其中有多少是众所周知的测试值；
- 有多少个不同的值匹配，这是根据只保存在扫描器内存中、随扫描结束一起丢弃的哈希估算的；
- 置信度，以及位置的名称是否指向了该数据类型；
- 最多三个脱敏样本，在任何内容离开扫描器之前就已在扫描器内部完成脱敏。

它从不保留原始值。每种值都经过脱敏，使人能够认出它，但永远无法使用它：

| 值 | 脱敏样本 |
| --- | --- |
| 电子邮件地址 | `j***@e******.com`：名称和域名的首字母，以及顶级标签 |
| 卡号 | `**** **** **** 4242`：最后四位数字，这是 PCI DSS 允许的卡号显示方式 |
| 密钥 | 较长时保留前四个和后四个字符，较短时保留前两个字符，私钥只保留其标头 |
| URL 或连接字符串 | 除密码外的全部内容 |
| IP 地址 | 它的第一部分（即网络），其余部分隐藏 |
| 按名称找到的值 | 它的第一个字符，后接 `****` |
| 文档标记 | 按原样保留的标记，例如“Confidential”：它说明了这是什么文档 |
| 其他任何值 | 最后两到四个字符，保留分隔符，例如 `***-**-6789` |

在项目设置中关闭 **保留脱敏样本**，即可只保留计数：从每个数据存储的下一次扫描开始，扫描写入的发现都不再保留样本。

数据存储之间的数据副本通过指纹而不是值来查找：每种数据类型 128 个 16 位数字，并用项目自己的密钥进行哈希（请参阅 [指纹如何保持私密](/docs/data-security/flows-access-residency#指纹如何保持私密)）。

一个发现在扫描最后一次看到它之后的 30 天内仍计入其数据存储，因为抽样可能会漏掉仍然存在的内容。90 天未见的发现会被删除。一个数据存储最多保留 2,000 个发现。

## 设置

数据安全的设置每个项目一套，位于数据安全菜单的 **设置** 部分。它们的默认值如下：

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| **检查配置** | 开启 | 对每个数据存储运行检查。关闭时，不会有任何问题被打开、更改或关闭。 |
| **扫描内容** | 开启 | 在已授予内容权限的地方对数据存储的内容抽样。 |
| **扫描遥测** | 开启 | 对项目的日志、追踪、异常、回放和 AI 对话抽样。 |
| **保留脱敏样本** | 开启 | 为每个发现保留最多三个脱敏样本。关闭时只保留计数。 |
| **打开安全案例** | 开启 | 当严重级别的问题被打开时，打开一个按数据存储分组的安全案例。 |
| **触发警报** | 关闭 | 当严重级别的问题被打开时触发警报，呼叫值班人员。 |
| **警报严重性** | 空 | 这些警报的严重程度。为空时使用项目中最严重的严重程度。 |
| **声明事件** | 关闭 | 当严重级别的问题被打开时声明一个事件，由你的事件流程处理。 |
| **事件严重性** | 空 | 这些事件的严重程度。为空时使用项目中最严重的严重程度。 |
| **通知所有者** | 开启 | 当数据存储上打开问题时，给它的所有者发送电子邮件。 |
| **每次扫描对象数** | 2,000 | 对一个存储桶的一次扫描最多读取的对象数，范围为 10 到 50,000。 |
| **每个对象字节数** | 65,536（64 KB） | 从一个对象最多读取的字节数，范围为 1,024 到 4,194,304。 |
| **每次扫描字节数** | 52,428,800（50 MB） | 一次内容扫描总共最多读取的字节数，范围为 65,536 到 1,073,741,824。 |
| **每个表的行数** | 1,000 | 从一个表最多读取的行数，范围为 10 到 100,000。 |
| **每次扫描表数** | 200 | 一次扫描最多读取的表数，范围为 1 到 5,000。 |
| **遥测样本大小** | 500 | 一次遥测扫描为每个服务和信号读取多少条最近的记录，范围为 10 到 10,000。 |
| **扫描间隔（小时）** | 24 | 多久对数据存储的内容重新抽样一次，范围为 1 到 720。 |
| **从不敏感** | 空 | 永远不会成为发现的值，例如你自己的支持邮箱地址。 |
| **已关闭的数据类型** | 空 | 项目的扫描不会查找的内置数据类型：即 **内置数据类型** 下的开关。 |

## 故障排除

:::details 数据存储显示其内容未被扫描
扫描会说明原因：“内容扫描需要连接的内容权限，或数据库的连接字符串。”请将数据存储的连接设为 **配置和内容样本** 并再次运行其命令，或为数据库提供连接字符串。另外，请检查数据存储和项目设置中的 **扫描内容** 是否都已开启。
:::

:::details 检查显示无法判断
读取器无法读取的事实（角色没有的权限、未启用的 API）会被视为未知，绝不会被猜测。相应的检查会报告它无法判断，而它已经打开的问题会保持打开：不能因为 OneUptime 无法查看就断定问题已经修复。配置读取的警告会说明它无法读取什么。再次运行连接的命令即可授予缺失的权限。
:::

:::details 没有显示任何 S3 存储桶或 BigQuery 数据集
它们来自配置读取，而不是云资源清单。请将连接设为 **仅配置** 或更高级别，然后再次运行其命令。
:::

:::details 扫描被标记为部分成功
它在读完所有内容之前达到了某个限制：8 分钟、**每次扫描字节数** 或 **每次扫描对象数**，或者云拒绝了某个请求。它的警告会说明是哪一个。下一次扫描会继续，并跳过未发生变化的内容；你也可以提高限制。
:::

## 后续步骤

:::cards
- [敏感数据类型](/docs/data-security/data-types): 扫描器在读取的内容中查找什么。
- [数据安全检查与问题](/docs/data-security/checks-and-issues): 配置读取的结果会接受哪些检查。
- [遥测中的敏感数据](/docs/data-security/telemetry): 你的日志、追踪和 AI 对话，无需任何设置。
- [连接云账户](/docs/telemetry/cloud-accounts): 首先连接 AWS、Azure 或 Google Cloud。
:::
