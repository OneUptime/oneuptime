# 데이터 보안 설정하기

데이터 보안은 허용한 것만 읽습니다. 각 클라우드 연결은 세 가지 수준 중 하나로 읽고, 직접 운영하는 데이터베이스는 제공한 연결 문자열로 읽으며, 텔레메트리는 아무것도 필요하지 않습니다. 이 페이지에서는 각 선택이 OneUptime에 무엇을 읽도록 허용하는지, 정확히 어떤 권한을 부여하는지, 그리고 OneUptime이 읽은 것 중 무엇을 보관하는지 설명합니다.

:::cards
- [수준 선택하기](#연결마다-수준-선택하기): 꺼짐, 구성만, 또는 구성 및 콘텐츠 샘플.
- [각 수준이 부여하는 권한](#각-수준이-부여하는-권한): AWS 작업, 그리고 Azure와 Google Cloud 역할.
- [직접 운영하는 데이터베이스 스캔하기](#직접-운영하는-데이터베이스-스캔하기): 읽기 전용 연결 문자열, 또는 네트워크 안의 프로브.
- [OneUptime이 보관하는 것](#oneuptime이-보관하는-것): 개수, 위치, 마스킹된 샘플. 값 자체는 절대 보관하지 않습니다.
- [데이터 보안이 노출을 차단하도록 허용하기](#데이터-보안이-노출을-차단하도록-허용하기): 연결에 줄 수 있는 유일한 쓰기 권한으로, 직접 켜기 전까지는 꺼져 있습니다.
:::

## 연결마다 수준 선택하기

| 수준 | 양식에서 | OneUptime이 읽는 것 |
| --- | --- | --- |
| 꺼짐 | **꺼짐** | 어떤 저장소의 구성이나 콘텐츠도 읽지 않습니다. 그래도 데이터 보안은 클라우드 인벤토리가 알고 있는 저장소를 인벤토리가 알려 주는 정보와 함께 나열합니다. RDS 데이터베이스가 암호화되어 있는지, 공개되어 있는지, 삭제로부터 보호되는지, 백업되는지, 그리고 DynamoDB 테이블을 특정 시점으로 복원할 수 있는지입니다. |
| 구성 | **구성만** | 모든 데이터 저장소가 어떻게 설정되어 있는지: 누가 접근할 수 있는지, 그리고 암호화, 백업, 버전 관리, 로깅, 복제, 태그 지정이 어떻게 되어 있는지. 데이터는 절대 읽지 않으며, 시크릿도 절대 읽지 않습니다. |
| 콘텐츠 | **구성 및 콘텐츠 샘플** | 위의 내용에 더해 S3 버킷, Azure 스토리지 계정, Cloud Storage 버킷, BigQuery 데이터 세트에 담긴 내용의 샘플. |

모든 연결은 **꺼짐** 에서 시작합니다. [클라우드 계정 연결](/docs/telemetry/cloud-accounts#데이터-보안)에는 각 수준이 각 클라우드에서 실행하는 명령이 그대로 나와 있습니다. 연결의 수준을 바꾸려면 다음과 같이 하세요.

:::steps
### 연결 열기

**클라우드 → 연결** 로 이동합니다. 연결의 **편집** 을 선택하거나, 새 계정을 연결합니다.

### 수준 고르기

**추가 필드** 에서 **데이터 보안** 을 원하는 수준으로 설정합니다.

### 명령 다시 실행하기

양식에 표시되는 명령은 수준에 따라 바뀝니다. 연결할 때처럼 클라우드의 셸에서 실행하세요. 새 수준에 필요한 권한만 부여하고 그 이상은 부여하지 않습니다. 그런 다음 **변경 사항 저장** 을 선택하거나, 새 연결이라면 **연결** 을 선택합니다.
:::

새 수준의 읽기는 한 시간 안에 시작되며, 저장소의 **지금 검사** 나 **지금 스캔** 은 읽기를 즉시 시작합니다. OneUptime은 역할이 여전히 무엇을 허용하든 연결의 수준이 정한 것만 읽습니다. 수준을 낮추면 읽기가 즉시 멈춥니다. 접근 권한까지 회수하려면 새 명령을 실행하세요. AWS에서는 이 명령이 정책을 낮은 수준의 정책으로 바꿉니다. **꺼짐** 은 아무것도 추가하지 않으므로, 이전 명령이 부여한 권한을 그대로 남깁니다. 이 권한은 직접 제거하세요. AWS에서는 `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity` 로, Azure와 Google Cloud에서는 콘텐츠 수준이 추가한 역할을 제거해서 회수합니다.

## 각 수준이 부여하는 권한

### Amazon Web Services

구성 수준은 역할에 읽기 전용 정책 옆에 두 번째 인라인 정책인 `OneUptimeDataSecurity` 를 추가합니다. 이 정책에는 데이터 보안 리더가 호출하는 읽기 작업만 정확히 들어 있습니다. 각 작업은 설정 하나를 읽으며, 데이터를 읽거나 무엇인가를 쓰는 작업은 없습니다.

| OneUptime의 용도 | 작업 |
| --- | --- |
| 버킷을 나열하고, 각 버킷에 누가 접근할 수 있는지와 암호화, 버전 관리, 로깅, 복사, 태그 지정이 어떻게 되어 있는지 읽음 | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| 데이터베이스에 어떻게 접근하고 어떻게 암호화하고 백업하는지, 그리고 수동 스냅샷이 누구와 공유되는지 읽음 | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| 검색 도메인, 캐시, 파일 시스템이 어떻게 설정되어 있는지 읽음 | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| AWS 자체 키(alias/aws/...)와 직접 관리하는 키를 구분함 | `kms:ListAliases` |

콘텐츠 수준은 같은 정책에 작업 세 개를 추가하며, 각 작업은 자신의 리소스에만 허용됩니다.

| 작업 | 허용 대상 | 용도 |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | 버킷의 객체 이름 나열 |
| `s3:GetObject` | `arn:aws:s3:::*/*` | 샘플링한 객체의 처음 몇 바이트 읽기 |
| `kms:Decrypt` | `*`, 단 `kms:ViaService` 가 `s3.*.amazonaws.com` 일 때만 | KMS 키로 암호화된 객체를 S3를 통해서만 읽기: 그 키가 보호하는 다른 것을 직접 복호화하는 일은 절대 없음 |

역할 대신 **액세스 키** 를 사용하면, 정책은 키의 사용자가 추가되는 그룹인 `OneUptimeDataSecurity` 에 들어갑니다. IAM은 사용자 자체의 인라인 정책을 모두 합쳐 2,048자로 제한하는데, 읽기 전용 정책이 그 대부분을 차지하기 때문입니다. AWS Organization 전체를 읽는 연결은 모든 계정의 역할에 같은 정책을 둡니다.

:::details 콘텐츠 수준의 전체 정책
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

구성 수준은 아무것도 추가하지 않습니다. 연결의 **Monitoring Reader** 역할이 이미 Azure Resource Manager를 통해 모든 리소스의 구성을 읽기 때문입니다. 콘텐츠 수준은 기본 제공 **Storage Blob Data Reader** 역할을 연결과 같은 범위, 즉 구독 또는 테넌트의 루트 관리 그룹에 추가합니다.

### Google Cloud

구성 수준은 아무것도 추가하지 않습니다. 연결의 **Cloud Asset Viewer** 역할이 이미 모든 리소스의 구성과 IAM 정책을 읽기 때문입니다. 콘텐츠 수준은 프로젝트 또는 조직에 `roles/storage.objectViewer` 와 `roles/bigquery.dataViewer` 두 역할을 추가하고, BigQuery API인 `bigquery.googleapis.com` 을 켭니다.

## 데이터 보안이 노출을 차단하도록 허용하기

달리 선택하지 않는 한 연결은 읽기만 합니다. **데이터 보안 대응** 은 **추가 필드** 에서 **데이터 보안** 옆에 있으며, 데이터 보안이 저장소의 공개 액세스를 차단하고 스냅샷 공유를 중단할 수 있게 합니다. 저장소의 이슈에서 **여기서 수정** 으로 하거나([데이터 보안 검사 및 이슈](/docs/data-security/checks-and-issues#여기서-수정) 참고), 보안 운영 플레이북에서 합니다. 기본값은 **꺼짐** 이며, **공개 액세스 및 공유 차단** 을 고르면 양식에 표시되는 명령이 범위가 좁은 쓰기 권한 하나만 따로 부여합니다.

| 클라우드 | 명령이 추가하는 것 | 할 수 있는 일 |
| --- | --- | --- |
| AWS | 세 번째 인라인 정책인 `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute`, `rds:ModifyDBClusterSnapshotAttribute`: 버킷의 공개 액세스 차단 설정, 그리고 수동 스냅샷을 누구와 공유하는지 |
| Azure | 연결의 범위에 부여되는 사용자 지정 역할인 `OneUptime Data Security Response` | `Microsoft.Storage/storageAccounts/read` 와 `Microsoft.Storage/storageAccounts/write`: 익명 Blob 액세스 같은 스토리지 계정의 설정. 키는 절대 다루지 않음 |
| Google Cloud | 사용자 지정 역할인 `oneuptimeDataSecurityResponse` | `storage.buckets.get` 과 `storage.buckets.update`: 공개 액세스 방지 같은 버킷의 설정 |

이 설정이 부여하는 권한으로는 데이터를 읽거나, 무엇인가를 삭제하거나, 누가 로그인할 수 있는지 바꿀 수 없습니다. 다시 **꺼짐** 으로 설정하면 데이터 보안은 즉시 이 권한을 사용하지 않습니다. AWS에서 접근 권한까지 회수하려면 `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse` 로 정책을 삭제하세요.

## 콘텐츠 샘플이 선택 사항인 이유

구성 수준은 노출된 것을 찾습니다. 공개 버킷, 인터넷에 열린 데이터베이스, 빠진 암호화, 백업, 액세스 로그입니다. 하지만 저장소에 무엇이 담겨 있는지는 알 수 없으므로, 아무것도 발견되지 않은 저장소는 가장 낮은 민감도인 공개로 간주되며, 그 이슈의 심각도도 공개 데이터일 때와 같습니다. 웹사이트 이미지가 담긴 공개 버킷은 긴급 상황이 아니지만, 카드 번호가 담긴 공개 버킷은 긴급 상황입니다.

콘텐츠 샘플은 이 둘을 구분합니다. 각 저장소의 민감도를 담긴 내용으로 정하므로, 같은 문제라도 카드 번호에서는 심각이고 이미지에서는 낮음입니다. 또한 콘텐츠에서만 드러나는 것도 찾습니다. 시크릿, 카드 보안 코드, 입력한 그대로 보관된 비밀번호, 그리고 테스트 저장소에 있는 프로덕션 데이터의 복사본입니다.

그래서 대부분의 팀은 이 순서로 진행합니다. 먼저 모든 곳에 구성 수준을 적용하고, 그다음 저장소에 무엇이 담겨 있는지 알아야 하는 곳에 콘텐츠 샘플을 적용합니다. 콘텐츠 스캔은 저장소의 **설정** 에 있는 **콘텐츠 스캔** 으로 저장소 하나에 대해 끄거나, 프로젝트 전체에 대해 끌 수도 있습니다.

## 콘텐츠 스캔이 읽는 것

스캔은 프로젝트의 한도 안에서 저장소를 조금 읽으며, 8분이 지나면 남은 것이 있어도 멈춥니다. 다음 스캔은 거기서부터 이어집니다. 읽은 뒤로 바뀌지 않은 객체는 건너뛰지만, 읽은 지 7일 이상 지났다면 다시 읽습니다.

- **버킷과 컨테이너** 는 개수가 아니라 종류별로 샘플링합니다. 먼저 객체 이름을 나열하는데, 스캔이 읽을 수 있는 수의 최대 열 배까지 나열하며 절대 200,000개를 넘지 않습니다. 각 이름은 날짜, UUID, 긴 hex 문자열, 숫자를 `*` 로 바꾼 패턴이 되므로, `exports/2026-10-27/users-0001.csv` 는 `exports/*/users-*.csv` 가 됩니다. 각 패턴의 최신 객체를 읽되, 어느 패턴에서든 두 번째 객체를 읽기 전에 모든 패턴에서 하나씩 읽고, 한 패턴에서는 최대 5개까지 읽습니다. 각 객체는 처음부터 읽습니다. 객체 하나에서 최대 **객체당 바이트** 만큼, 전체로는 최대 **스캔당 바이트** 만큼 읽습니다. 스캔은 Azure 스토리지 계정 하나에서 최대 10개의 컨테이너를 샘플링합니다.
- **파일은 형식에 맞게 읽습니다.** CSV와 TSV는 열별로, JSON과 JSON Lines는 경로별로, `.env`, `.ini`, `.properties`, TOML, YAML은 키별로, XML과 HTML은 텍스트로, Word, Excel, PowerPoint 파일은 텍스트와 셀로, 그 밖의 모든 것은 자유 텍스트로 읽습니다. gzip 파일은 먼저 압축을 풉니다. 이미지, Parquet, Avro, PDF 및 기타 바이너리 형식은 읽지 않으며, 스캔에 그렇다고 표시됩니다.
- **데이터 세트와 데이터베이스** 는 테이블 단위로 읽습니다. 최대 **스캔당 테이블 수** 만큼의 테이블을, 각 테이블에서 **테이블당 행 수** 만큼의 행을 읽습니다.

각 스캔은 읽은 것의 기록을 이름으로 남깁니다. 객체, 테이블 또는 서비스의 이름이며, 그 내용은 절대 남기지 않습니다. 읽지 못한 것(클라우드가 거부한 요청, 시간 제한, 바이트 예산)은 스캔에 경고로 남고, 스캔은 **부분적으로 성공** 으로 표시됩니다.

## 직접 운영하는 데이터베이스 스캔하기

데이터 보안은 PostgreSQL과 MySQL 데이터베이스를 두 가지 방법 중 하나로 샘플링합니다. Database 제품이 모니터링하는 데이터베이스나 서비스 맵에서 서비스가 통신하는 데이터베이스는 이미 저장소입니다. 어떤 스캔으로도 찾을 수 없는 데이터베이스는 직접 저장소로 추가하세요.

- **OneUptime의 워커에서.** 저장소의 **설정** 에서 **연결 문자열** 을 `postgresql://reader:password@db.internal:5432/app` 처럼 읽기만 할 수 있는 연결 문자열로 설정합니다. 연결 문자열은 저장 시 암호화되며 API로 절대 반환되지 않습니다. 읽기만 하고 그 밖에는 아무것도 할 수 없는 데이터베이스 사용자를 지정하세요.
- **네트워크 안의 프로브에서.** **프로브에서 스캔** 항목에서 프로브를 고르고, **프로브 연결 변수** 에 그 프로브에서 연결 문자열을 담고 있는 환경 변수의 이름을 입력합니다. 프로브는 네트워크 안에서 데이터베이스를 읽고 찾은 것만 돌려보내므로, 연결 문자열은 OneUptime에 절대 전달되지 않습니다. 프로브를 실행하려면 [사용자 지정 프로브](/docs/probe/custom-probe)를 참고하세요.

## OneUptime이 보관하는 것

각 위치(열, 필드, 객체 패턴, 텔레메트리 속성)에서 찾은 데이터 유형마다 발견 사항은 다음을 보관합니다.

- 샘플링한 값 중 몇 개에 그 데이터 유형이 있었는지와 전체 값의 수, 그리고 그중 몇 개가 잘 알려진 테스트 값이었는지
- 일치한 서로 다른 값의 수(스캐너의 메모리에만 머물고 스캔과 함께 폐기되는 해시로 추정)
- 신뢰도, 그리고 위치의 이름이 그 데이터 유형을 가리켰는지 여부
- 최대 세 개의 마스킹된 샘플. 무엇이든 스캐너 밖으로 나가기 전에 스캐너 안에서 마스킹됩니다.

원시 값은 절대 보관하지 않습니다. 각 종류의 값은 사람이 알아볼 수는 있지만 사용할 수는 없도록 마스킹됩니다.

| 값 | 마스킹된 샘플 |
| --- | --- |
| 이메일 주소 | `j***@e******.com`: 이름과 도메인의 첫 글자, 그리고 최상위 레이블 |
| 카드 번호 | `**** **** **** 4242`: PCI DSS가 카드 표시에 허용하는 대로 마지막 네 자리 |
| 시크릿 | 길면 처음 네 글자와 마지막 네 글자, 짧으면 처음 두 글자, 그리고 개인 키는 헤더만 |
| URL 또는 연결 문자열 | 비밀번호를 제외한 전체 |
| IP 주소 | 첫 부분인 네트워크만 보이고 나머지는 숨김 |
| 이름으로 찾은 값 | 첫 글자 뒤에 `****` |
| 문서 표시 | "기밀"처럼 적힌 그대로의 표시. 문서가 무엇인지 알려 줍니다 |
| 그 밖의 모든 값 | 구분 기호는 그대로 두고 마지막 두 글자에서 네 글자까지. 예: `***-**-6789` |

개수만 보관하려면 프로젝트 설정에서 **마스킹된 샘플 보관** 을 끄세요. 각 저장소의 다음 스캔부터 그 스캔이 기록하는 발견 사항에는 샘플이 보관되지 않습니다.

저장소 간 데이터 복사본은 값이 아니라 핑거프린트로 찾습니다. 데이터 유형마다 16비트 숫자 128개이며, 프로젝트 고유의 키로 해시됩니다([핑거프린트가 비공개로 유지되는 방식](/docs/data-security/flows-access-residency#지문이-비공개로-유지되는-방식) 참고).

발견 사항은 스캔에서 마지막으로 확인된 뒤 30일 동안 저장소에 반영됩니다. 샘플은 아직 남아 있는 것을 놓칠 수 있기 때문입니다. 90일 동안 확인되지 않은 발견 사항은 삭제됩니다. 저장소 하나에는 발견 사항을 최대 2,000개까지 보관합니다.

## 설정

데이터 보안의 설정은 프로젝트마다 한 세트이며, 데이터 보안 메뉴의 **설정** 섹션에 있습니다. 기본값은 다음과 같습니다.

| 설정 | 기본값 | 하는 일 |
| --- | --- | --- |
| **구성 검사** | 켜짐 | 모든 저장소에서 검사를 실행합니다. 끄면 이슈가 열리거나, 바뀌거나, 닫히지 않습니다. |
| **콘텐츠 스캔** | 켜짐 | 콘텐츠 권한이 부여된 곳에서 저장소의 콘텐츠를 샘플링합니다. |
| **텔레메트리 스캔** | 켜짐 | 프로젝트의 로그, 트레이스, 예외, 리플레이, AI 대화를 샘플링합니다. |
| **마스킹된 샘플 보관** | 켜짐 | 발견 사항마다 마스킹된 샘플을 최대 세 개까지 보관합니다. 끄면 개수만 보관합니다. |
| **보안 케이스 열기** | 켜짐 | 심각 이슈가 열리면 저장소별로 묶은 보안 케이스를 엽니다. |
| **경고 생성** | 꺼짐 | 심각 이슈가 열리면 경고를 생성해 온콜 담당자를 호출합니다. |
| **알림 심각도** | 비어 있음 | 그 경고의 심각도입니다. 비어 있으면 프로젝트에서 가장 높은 심각도를 사용합니다. |
| **인시던트 선언** | 꺼짐 | 심각 이슈가 열리면 인시던트를 선언해 인시던트 프로세스가 처리하게 합니다. |
| **인시던트 심각도** | 비어 있음 | 그 인시던트의 심각도입니다. 비어 있으면 프로젝트에서 가장 높은 심각도를 사용합니다. |
| **소유자에게 알림** | 켜짐 | 저장소에 이슈가 열리면 저장소의 소유자에게 이메일을 보냅니다. |
| **스캔당 객체 수** | 2,000 | 버킷 스캔 한 번이 읽는 최대 객체 수로, 10에서 50,000 사이입니다. |
| **객체당 바이트** | 65,536 (64 KB) | 객체 하나에서 읽는 최대 바이트 수로, 1,024에서 4,194,304 사이입니다. |
| **스캔당 바이트** | 52,428,800 (50 MB) | 콘텐츠 스캔 한 번이 모두 합쳐 읽는 최대 바이트 수로, 65,536에서 1,073,741,824 사이입니다. |
| **테이블당 행 수** | 1,000 | 테이블 하나에서 읽는 최대 행 수로, 10에서 100,000 사이입니다. |
| **스캔당 테이블 수** | 200 | 스캔 한 번이 읽는 최대 테이블 수로, 1에서 5,000 사이입니다. |
| **텔레메트리 샘플 크기** | 500 | 텔레메트리 스캔이 서비스와 신호마다 읽는 최근 레코드 수로, 10에서 10,000 사이입니다. |
| **스캔 주기(시간)** | 24 | 저장소의 콘텐츠를 다시 샘플링하는 주기로, 1에서 720 사이입니다. |
| **항상 민감하지 않음** | 비어 있음 | 회사의 지원 주소처럼 절대 발견 사항이 되지 않는 값입니다. |
| **꺼진 데이터 유형** | 비어 있음 | 프로젝트의 스캔이 찾지 않는 기본 제공 데이터 유형입니다. **기본 제공 데이터 유형** 아래의 스위치로 정합니다. |

## 문제 해결

:::details 저장소에 콘텐츠가 스캔되지 않았다고 표시됨
스캔에 이유가 표시됩니다: "콘텐츠 스캔에는 연결의 콘텐츠 권한 또는 데이터베이스의 연결 문자열이 필요합니다." 저장소의 연결을 **구성 및 콘텐츠 샘플** 로 설정하고 명령을 다시 실행하거나, 데이터베이스에 연결 문자열을 지정하세요. 저장소와 프로젝트 설정 모두에서 **콘텐츠 스캔** 이 켜져 있는지도 확인하세요.
:::

:::details 검사가 판단할 수 없다고 표시함
리더가 읽지 못한 사실(역할에 없는 권한, 켜져 있지 않은 API)은 알 수 없음으로 처리되며, 절대 추측하지 않습니다. 그 검사는 판단할 수 없다고 보고하고, 이미 연 이슈는 열린 채로 남습니다. OneUptime이 확인할 수 없었다는 이유로 문제가 해결되었다고 결론 내려서는 안 되기 때문입니다. 구성 읽기의 경고에 읽지 못한 것이 표시됩니다. 빠진 권한을 부여하려면 연결의 명령을 다시 실행하세요.
:::

:::details S3 버킷이나 BigQuery 데이터 세트가 표시되지 않음
이들은 클라우드 인벤토리가 아니라 구성 읽기에서 나옵니다. 연결을 **구성만** 이상으로 설정하고 명령을 다시 실행하세요.
:::

:::details 스캔이 부분적으로 성공으로 표시됨
모든 것을 읽기 전에 한도에 도달했습니다. 8분, **스캔당 바이트** 나 **스캔당 객체 수**, 또는 클라우드가 거부한 요청입니다. 어느 것인지는 스캔의 경고에 표시됩니다. 다음 스캔이 바뀌지 않은 것을 건너뛰며 이어서 읽으며, 한도를 올릴 수도 있습니다.
:::

## 다음 단계

:::cards
- [민감한 데이터 유형](/docs/data-security/data-types): 스캐너가 읽은 것에서 찾는 것.
- [데이터 보안 검사 및 이슈](/docs/data-security/checks-and-issues): 구성 읽기 결과에서 검사하는 항목.
- [텔레메트리의 민감한 데이터](/docs/data-security/telemetry): 설정이 필요 없는 로그, 트레이스, AI 대화.
- [클라우드 계정 연결](/docs/telemetry/cloud-accounts): 먼저 AWS, Azure 또는 Google Cloud를 연결합니다.
:::
