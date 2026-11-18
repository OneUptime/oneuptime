/*
 * The Data Observability Documentation page in Korean: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Korean words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Data Observability가 감시하는 것

연결된 각 데이터베이스의 모든 테이블과 뷰를 5분마다 감시합니다.

- **행 수와 크기**: 엔진 자체의 통계에서 가져옵니다.
- **마지막으로 변경된 시점**: MySQL과 SQL Server는 이를 보고합니다. PostgreSQL에서는 OneUptime이 삽입, 업데이트, 삭제 카운터를 지켜보고 카운터가 움직인 시점을 기록합니다.
- **열**: 추가, 제거, 이름 변경, 형식 변경되거나 nullable로 바뀐 열은 테이블의 타임라인과 스키마 변경에 기록됩니다.
- **평소 리듬**: 테이블이 보통 얼마나 자주 변경되는지입니다. 리듬을 크게 넘긴 테이블은 **지연됨**으로 표시됩니다.

데이터베이스의 카탈로그만 읽으며, MongoDB에서는 컬렉션의 최신 문서에 있는 필드 이름도 읽습니다. 어떤 값도 데이터베이스 밖으로 나가지 않습니다.

카탈로그는 내부 관리 작업만 바뀌었는데도 테이블이 변경되었다고 하거나, 아무것도 알려주지 않을 수 있습니다. 테이블의 **설정**에서 \`updated_at\` 같은 **Freshness 열**을 지정하면 그 열의 최신 값이 테이블의 마지막 변경 시점이 됩니다. 로그인에 그 열을 읽을 권한이 있어야 하며, 열에는 인덱스가 있는 것이 좋습니다.

PostgreSQL이나 SQL Server의 읽기 복제본은 쓰기 카운터가 움직이지 않으므로, OneUptime은 그곳에서 카운터를 제외하고 데이터베이스에 그 사실을 표시합니다.

## 개요

**개요**는 데이터가 지금 어떤 상태인지 알려 줍니다. 프로젝트 설정이 끝날 때까지는 남은 단계를 나열합니다: 모든 데이터베이스의 경고, 테이블 소유자, 검사 하나, 파이프라인 실행입니다. **조치 필요**는 누군가의 조치가 필요한 항목을 가장 심각한 것부터 나열합니다: 읽지 못한 데이터베이스, 실패했거나 지연된 파이프라인 실행, 실패 중이거나 실행하지 못한 검사, 어긋난 대사, 지연된 데이터 제품이나 테이블입니다. 각 항목에는 누구의 소유인지, 경고가 열려 있는지(또는 데이터베이스에 켜진 경고가 없어 아무도 알림을 받지 않는다는 사실)가 표시되며, 문제를 고칠 페이지를 엽니다. **데이터베이스**는 각 데이터베이스의 마지막 읽기가 어떻게 되었는지, 경고가 켜져 있는지를 보여 줍니다. 메뉴에서 **개요** 옆의 숫자는 조치가 필요한 항목을 세고, 그 바로 아래의 **이슈** 는 그 항목을 모두 한 페이지씩 나열하며, 종류, 데이터베이스, 소유자(또는 **소유자 없음**), 경고가 열려 있는지로 필터링할 수 있습니다. **개요** 의 각 숫자는 해당 목록을 엽니다. **조치 필요** 는 **이슈** 를, **지연된 테이블** 은 지연된 테이블만 보여 주는 **테이블** 을, **실패 중인 검사** 는 실패 중인 검사만 보여 주는 **점검** 을 엽니다.

## 데이터베이스 연결

**읽기 전용 로그인**을 사용하세요. 개요나 데이터베이스에서 **데이터베이스 연결**을 선택한 다음, 둘 중 하나를 고릅니다.

- **OneUptime이 연결합니다**: 연결 문자열을 붙여 넣습니다. 암호화되어 저장되며 다시는 표시되지 않습니다.
- **내 네트워크의 프로브가 연결합니다**: 이 프로젝트의 프로브 중 하나를 고르고, 연결 문자열을 담은 프로브의 환경 변수 이름을 지정합니다(예: \`ORDERS_DB_URL\`). 연결 문자열은 네트워크 밖으로 나가지 않습니다. 먼저 프로브를 최신 버전으로 업데이트하세요.

데이터 보안용으로 이미 연결된 데이터베이스도 감시됩니다.

같은 페이지의 **연결할 수 있는 데이터베이스**에는 프로젝트가 이미 알고 있지만 아무도 연결하지 않은 데이터베이스가 나열됩니다: 트레이스가 통신하는 데이터베이스, 클라우드 계정에 있는 데이터베이스, 데이터베이스 모니터링이 감시하는 데이터베이스입니다. **연결**을 선택하면 각각에 대해 알려진 정보로 양식이 채워집니다. 연결하기 전에는 아무것도 읽지 않습니다.

## 스토리지 경로

매일 밤 버킷에 도착하는 내보내기 파일도 다른 테이블처럼 늦거나 일부가 빠질 수 있습니다. **스토리지 경로**에서 클라우드 연결이 찾은 버킷(Amazon S3, Google Cloud Storage, Azure 스토리지 계정)에 대해 **경로 편집**을 선택하고, 중요한 경로를 한 줄에 하나씩 지정합니다. 각 경로는 **테이블**에 표시됩니다: 가장 최신 객체가 마지막 변경 시점이고, 객체가 행이며, 같은 경고가 적용됩니다. 이름, 크기, 시간만 읽고 객체 자체는 읽지 않습니다.

### 엔진별 읽기 전용 로그인

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL 및 MariaDB(\`performance_schema\`를 사용하면 OneUptime이 수집 사이의 쓰기를 볼 수 있습니다):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server(\`VIEW DATABASE STATE\`를 사용하면 OneUptime이 크기와 마지막 업데이트를 읽을 수 있습니다):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: 클러스터나 작업 그룹의 엔드포인트에 PostgreSQL 연결 문자열로 연결합니다. 예: \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\`를 사용하면 OneUptime이 행 수와 크기(\`svv_table_info\`), 모든 사용자 쿼리의 마지막 쓰기와 읽기(\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, 며칠간 보관), 모든 사용자 쿼리의 계보를 읽을 수 있습니다. 이 권한이 없어도 테이블의 행이 바뀌면 언제 변경되었는지는 알 수 있습니다.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: 키 쌍(비밀번호 없음)을 가진 사용자를 만들고, 계정 식별자, 사용자, 개인 키(암호화되지 않은 PKCS#8), 데이터베이스, 검사용 웨어하우스를 지정한 JSON으로 연결합니다.

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

수집은 웨어하우스가 필요 없는 SHOW로 카탈로그를 읽으므로 크레딧이 들지 않습니다. 웨어하우스에서는 데이터 검사만, 지정한 일정에 따라 실행됩니다. Snowflake는 어떤 테이블의 마지막 변경 시점도 알려 주지 않으므로, 행이나 바이트가 움직였을 때 테이블이 변경된 것으로 봅니다.

\`\`\`sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
-- Warehouse spend reads SNOWFLAKE.ACCOUNT_USAGE.
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
-- Checks read rows: SELECT on the tables they check.
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
\`\`\`

Google BigQuery: Google Cloud 연결이 찾은 모든 데이터 세트는 그 연결의 서비스 계정으로 이미 감시되고 있으므로, 따로 연결할 필요가 없습니다. 서비스 계정에 프로젝트에 대한 **BigQuery Metadata Viewer**와 **BigQuery Job User**, 검사가 읽는 테이블에 대한 **BigQuery Data Viewer**를 부여하세요. 각 수집은 데이터 세트의 \`__TABLES__\`(행, 바이트, 마지막 변경, 무료)와 \`INFORMATION_SCHEMA.COLUMNS\`(BigQuery의 최소 청구량 10MB로 청구)를 읽습니다. 작업의 계보를 1시간에 한 번 읽으려면 프로젝트에 **BigQuery Resource Viewer**를 추가하세요(「데이터베이스가 알려 주는 계보」 참고). Google Cloud 연결 없이 데이터 세트를 연결하려면 **Google BigQuery**를 선택하고 서비스 계정 키가 담긴 JSON을 입력합니다.

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: HTTP 인터페이스로 연결합니다. TLS를 쓰면 포트 8443(ClickHouse Cloud), 쓰지 않으면 8123입니다. 예: \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. 데이터베이스를 지정하면 그 데이터베이스만 감시하고, 생략하면 서버 자체의 데이터베이스를 제외한 모든 데이터베이스를 감시합니다. \`system.parts\`를 사용하면 OneUptime이 수집 사이의 모든 삽입을 볼 수 있고(병합은 세지 않음), 서버가 기록하는 경우 \`system.part_log\`가 각 삽입의 시각을 알려 주며, \`system.query_log\`가 1시간에 한 번 각 테이블의 마지막 읽기와 \`INSERT ... SELECT\`의 계보를 알려 줍니다. 모든 문은 \`readonly\`가 설정된 상태로 실행되므로, 쓰기가 가능한 로그인이라도 쓸 수 없습니다.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: Unity Catalog의 카탈로그 하나가 데이터베이스 하나입니다. 스키마, 테이블, 뷰, 열과 각 Delta 테이블의 마지막 커밋은 SQL 웨어하우스 없이 Unity Catalog의 REST API에서 읽으므로, 수집에 컴퓨팅 비용이 들지 않습니다. 데이터 검사와, 시스템 테이블 \`system.access.table_lineage\`의 계보, 마지막 쓰기, 마지막 읽기(1시간에 한 번)는 지정한 SQL 웨어하우스에서 실행됩니다. 서비스 주체로 연결합니다(\`clientId\`와 \`clientSecret\` 대신 개인용 액세스 토큰을 쓸 수도 있습니다: \`"token": "dapi..."\`).

\`\`\`json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
\`\`\`

\`\`\`sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE SCHEMA ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE CATALOG ON CATALOG system TO \`oneuptime-reader\`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO \`oneuptime-reader\`;
-- Checks read rows: SELECT on the tables they check. And CAN USE on the SQL warehouse.
\`\`\`

Oracle: \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\` 또는 JSON \`{ "user", "password", "connectString" }\`으로 연결합니다. Oracle 자체 프로토콜로 읽으므로 Oracle 클라이언트를 설치할 필요가 없습니다. 로그인은 읽기가 허용된 테이블만 봅니다: 감시할 각 테이블에 \`READ\`를 부여하세요(쿼리는 할 수 있지만 잠그거나 변경할 수는 없습니다). \`SELECT_CATALOG_ROLE\`을 사용하면 OneUptime이 모든 테이블의 크기를 읽을 수 있습니다. 이 역할이 없으면 로그인 자신의 테이블만 크기를 알 수 있습니다. \`ALL_TAB_MODIFICATIONS\`는 마지막 통계 이후 각 테이블의 삽입, 업데이트, 삭제와 마지막으로 변경된 시점을 알려 줍니다.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: Glue 데이터베이스 하나가 데이터베이스 하나입니다. 테이블과 뷰, 그 열과 통계, 각 Iceberg 테이블의 마지막 커밋은 Glue Data Catalog의 API에서 가져오며, 이 API는 데이터를 읽지 않고 비용도 들지 않습니다. 검사는 지정한 작업 그룹에서 Athena 쿼리로 실행됩니다. Glue 데이터베이스를 읽고 Athena 쿼리를 실행할 수 있는 IAM 사용자나 역할의 키로 연결합니다.

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

데이터베이스와 그 테이블에 대한 \`glue:GetDatabase\`와 \`glue:GetTables\`, 검사를 위해 작업 그룹에 대한 \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\`, \`athena:StopQueryExecution\`이 필요하며, 테이블의 S3 데이터에 대한 읽기 권한과 출력 위치에 대한 쓰기 권한도 필요합니다.

MongoDB: 연결 문자열로 연결합니다 - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\` 또는 복제본 세트의 호스트를 지정한 \`mongodb://\`. 경로에 데이터베이스를 지정하면 그 데이터베이스만 감시하고, 지정하지 않으면 로그인이 읽을 수 있는 모든 데이터베이스를 감시합니다. 각 컬렉션의 문서, 크기, 쓰기는 \`$collStats\`에서, 마지막으로 문서를 받은 시점은 최신 \`_id\`에서 가져옵니다. 필드는 유효성 검사기의 JSON 스키마에서 가져오고, 없으면 최신 문서 100개의 필드 이름과 형식에서 가져옵니다. 이 계산은 데이터베이스 안에서 이루어지므로 어떤 값도 밖으로 나가지 않습니다. 보조 노드가 있으면 문서는 보조 노드에서 읽습니다. 뷰의 원본 컬렉션은 계보가 되고, 사용자 지정 검사는 JSON으로 된 집계 파이프라인입니다.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

데이터베이스 하나만 감시하려면 \`readAnyDatabase\` 대신 \`{ role: "read", db: "orders" }\`를 부여합니다.

Microsoft Dataverse: 환경 하나가 데이터베이스 하나이며, 그 테이블은 SQL 엔드포인트가 부르는 대로 \`dbo\`에 있습니다. OneUptime은 앱으로 로그인합니다: Microsoft Entra ID에 클라이언트 암호가 있는 앱을 등록하고, 테이블을 읽을 수 있는 보안 역할과 함께 환경에 애플리케이션 사용자로 추가하세요(Power Platform admin center > the environment > Settings > Users + permissions > Application users). JSON이나 \`AuthType=ClientSecret\`을 지정한 Dataverse 연결 문자열로 연결합니다. 테넌트는 생략할 수 있습니다: 환경이 어느 테넌트에 있는지 알려 줍니다.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

5분마다 Web API가 각 테이블의 정의, Dataverse가 하루에 한 번 만드는 스냅샷의 행 수(따라서 최대 하루 늦습니다), 마지막 변경 시점인 최신 \`modifiedon\`을 제공합니다. 열은 1시간에 한 번 읽습니다. 모든 읽기는 앱의 Dataverse 요청 한도에 포함되며, 속도를 줄이라는 요청을 받은 수집은 나머지를 다음 수집으로 넘깁니다. 환경에는 자체 테이블이 수백 개 있으므로, 핵심 업무 테이블(거래처, 연락처, 잠재 고객, 영업 기회, 견적, 주문, 청구서, 제품, 사례, 이메일, 전화 통화, 약속, 작업, 메모)과 직접 만든 사용자 지정 테이블만 감시합니다. Microsoft 앱의 테이블(\`msdyn_\`, \`adx_\`, 기타 \`ms\` 접두사)은 제외됩니다: 감시하려는 다른 테이블은 \`"tables": ["msdyn_workorder"]\`처럼 지정하세요.

데이터 검사는 환경의 TDS 엔드포인트(포트 1433 또는 5558)에서 읽기 전용 SQL로 실행됩니다. 관리자가 끄지 않는 한 켜져 있으며, 사용자 수준 액세스 제어가 켜져 있는 경우 앱의 역할에 **Allow user to access TDS endpoint** 권한이 필요합니다. 그 SQL에는 정규식, \`WITH\`, 샘플링이 없습니다.

## 각 테이블이 기록하는 메트릭

각 수집은 모든 테이블에 대해 다음 메트릭을 기록하므로, 다른 메트릭처럼 차트로 그리고, 대시보드에 올리고, 경고를 설정할 수 있습니다.

| 메트릭 | 의미 |
| --- | --- |
| \`oneuptime.data.table.row_count\` | 테이블의 행 수 |
| \`oneuptime.data.table.size\` | 테이블과 인덱스가 차지하는 바이트 |
| \`oneuptime.data.table.seconds_since_change\` | 마지막으로 행이 삽입, 업데이트, 삭제된 후 지난 초 |
| \`oneuptime.data.table.overdue_seconds\` | 테이블이 보통 변경되는 시점을 넘긴 초. 제때이면 0. 리듬을 학습한 뒤에 기록됩니다 |
| \`oneuptime.data.table.row_count_change_percent\` | 이전 수집 이후 행 수가 변한 비율(백분율, -50은 행의 절반이 사라졌다는 뜻). 1,000행 미만인 테이블은 제외됩니다 |
| \`oneuptime.data.table.schema_changes\` | 이전 수집 이후 변경된 열 |
| \`oneuptime.data.table.breaking_schema_changes\` | 이전 수집 이후 제거, 이름 변경, 형식 변경된 열 |

모든 행에는 \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\`, \`oneuptime.data.table.key\`(\`schema.table\`)가 붙습니다. \`oneuptime.data.table.key\`로 그룹화한 메트릭 모니터는 테이블마다 한 번 경고하며, **비정상적으로 높음**과 **비정상적으로 낮음** 필터는 각 테이블을 그 요일·시간대의 자체 평소 값과 비교하므로 임계값을 설정할 필요가 없습니다.

## 경고

연결한 데이터베이스는 **권장 경고**에서 열립니다. 나중에는 **데이터베이스**에서 그 데이터베이스의 경고를 고를 수 있습니다. 각 권장 항목은 데이터베이스 전체에 대한 메트릭 모니터 하나로, 테이블마다 한 번 경고하므로 나중에 만든 테이블도 감시됩니다.

| 경고 | 발생 조건 |
| --- | --- |
| **테이블이 지연됨** | 테이블이 보통 변경되는 시점을 15분 동안 넘긴 상태 - **지연됨** 표시와 같은 규칙 |
| **행 수가 급감함** | 두 번의 수집 사이에 테이블이 행의 절반 이상을 잃음 |
| **행 수가 비정상적으로 적음** | 테이블의 행이 그 요일·시간대의 평소보다 훨씬 적음(2주 동안 학습) |
| **스키마가 변경됨** | 테이블의 열이 제거, 이름 변경, 형식 변경됨. 열 추가는 아무것도 망가뜨리지 않으며 타임라인에 남습니다 |
| **테이블 상태 보고가 끊김** | 데이터베이스의 어떤 테이블도 15분 동안 읽히지 않음 |

만들 때 심각도, 온콜 정책, 소유자, 레이블을 고르세요. 그 뒤로는 일반 모니터와 같습니다: 다른 모니터처럼 편집하고, 음소거하고, 상태 페이지에 올릴 수 있습니다.

백필이나 마이그레이션 때문에 누군가를 호출해서는 안 됩니다. 유지 관리 이벤트의 **Data Observability 데이터베이스**에 데이터베이스를 지정하거나 그 데이터베이스 서버를 이벤트에 넣으면, 이벤트가 진행되는 동안 데이터 경고가 울리지 않습니다.

## 소유자와 레이블

테이블의 **소유자** 탭에는 테이블이 속한 사람과 팀이 표시되며, 테이블의 경고는 그들에게 갑니다. 소유자가 없으면 데이터베이스의 소유자에게 갑니다. **소유자 규칙**과 **레이블 규칙**은 각 테이블이 처음 나타날 때, 레이블이나 이름·스키마·데이터베이스에 대한 정규식으로 일치시켜 적용됩니다. \`Owned\`로 범위가 지정된 권한은 그 보유자나 보유자의 팀이 소유한 테이블과, 그 테이블의 검사, 활동, 보고된 문제에만 미칩니다. 데이터베이스를 소유한다고 해서 그 테이블의 소유자가 되지는 않습니다: 팀에 데이터베이스 전체를 맡기려면 소유자 규칙을 사용하세요.

## 경고가 열리면

테이블의 경고에는 **데이터** 카드가 있어, 경고가 발생했을 가능성이 높은 이유를 순서대로 보여 줍니다: 업스트림의 경고, 실패한 실행, 테이블에 쓰는 서비스의 배포, 실패한 쓰기, 변경된 열, 데이터베이스나 그것이 실행되는 서버입니다. 그 아래에는 테이블에 의존하는 것이 표시됩니다: 테이블, 대시보드, 서비스, 그리고 그것을 소유한 사람입니다. 경고의 **계보** 카드처럼, 내 역할이 읽을 수 있는 테이블과 파이프라인만 알려 줍니다.

어떻게 생각했는지 알려 주세요: **유용함**, **예상됨**(계획된 이벤트: 아무것도 바뀌지 않음), 또는 **문제 아님**(테이블의 허용 범위를 넓혀 다음에는 같은 일로 울리지 않게 함). 사람이 먼저 문제를 발견했다면 테이블의 **문제 보고**로 기록할 수 있습니다. **개요**는 그 결과를 보여 줍니다: 주당 유용한 경고 수, 그중 노이즈가 아니었던 수, 누군가 보고하기 전에 문제를 발견한 빈도와 그 속도, 추정 원인이 실제 원인이었던 빈도입니다.


## 데이터 제품

데이터를 사용하는 사람(분석가, 재무, 경영진, AI 에이전트)은 데이터베이스가 아니라 자신이 사용하는 것, 예를 들어 "매출 대시보드의 테이블"로 생각합니다. 데이터 제품은 그런 테이블에 이름을 붙이고, 소유자, 소비자, 최신성 SLA를 함께 지정합니다. **데이터 제품**에서 만드세요. SLA는 다음 중 하나 또는 둘 다입니다.
- **하루 중 특정 시각까지 최신(UTC):** 매일의 데이터가 그날 그 시각까지 도착합니다. 그 시각부터는 모든 테이블이 그날 변경되어 있어야 하며, 그 전까지는 어제의 적재가 유효합니다. 항상 30분 늦는 적재는 매일 그 30분 동안 지연 상태입니다.
- **최대 경과 시간:** 어떤 테이블의 마지막 변경도 이보다 오래되어서는 안 됩니다.

5분마다 각 제품의 테이블을 SLA와 비교합니다. 테이블 중 하나라도 지연되면 제품은 **지연됨**이 되고, 제품 데이터의 시점은 그중 가장 오래된 마지막 변경입니다. 제품은 \`oneuptime.data.product.late_tables\`와 \`oneuptime.data.product.data_age\`를 기록하므로, 모든 제품의 최신성을 나란히 차트로 볼 수 있습니다.

제품을 저장하면 사용자 본인으로, 사용자의 권한으로 다음도 만들어집니다.
- **모니터**: 상태 페이지에서 제품을 나타냅니다. 테이블이 지연되는 동안 성능 저하 상태가 되며, 프로젝트에서 가장 낮은 심각도로 인시던트와 경고를 열고, 이들은 저절로 해결됩니다. 비공개 또는 공개 상태 페이지에 리소스로 추가하세요: 구독한 소비자는 제품이 지연될 때와 다시 최신이 될 때 알림을 받습니다.
- **SLO**: 그 모니터에 대한 SLO로, 30일 동안 데이터가 제때였던 시간의 비율을 제품의 SLA 목표와 비교하며, 모든 SLO가 기본으로 갖는 빠른·느린 번 레이트 경고가 붙습니다.

제품을 삭제하면 둘 다 삭제됩니다. 각 제품에는 데이터가 언제 기준인지 알려 주는 **배지**도 있어, 제때인 동안은 초록색, 그렇지 않으면 "late"가 붙은 호박색으로 표시됩니다. 제품의 개요에서 BI 대시보드, 위키 페이지, README에 삽입할 수 있습니다. 링크에는 로그인이 필요 없으므로 공유 링크처럼 다루세요. **배지 링크 재설정**은 새 링크를 만들고 이전 링크를 폐기합니다.

## 테이블 값에 대한 검사

테이블 상태는 테이블이 변하는지를 알려 줍니다. **검사**는 테이블에 담긴 내용이 올바른지를 알려 줍니다. 테이블의 **점검** 탭에서 추가하세요.

| 검사 | 읽는 내용 |
| --- | --- |
| **NULL 비율** | 열이 비어 있는 행의 비율 |
| **중복 비율** | 다른 행의 값과 중복되는 값의 비율 |
| **고유 값 개수** | 열에 담긴 서로 다른 값의 개수 |
| **최소**, **최대**, **평균**, **합계** | 숫자 열의 값(행이 없는 경우 합계는 0) |
| **잘못된 값 비율** | 지정한 목록에 없는 값의 비율 |
| **형식 불일치 비율** | 이메일, UUID, 국가 코드 등 고른 형식에 맞지 않거나, 직접 작성한 정규식에 일치하지 않는 값의 비율(SQL Server를 제외한 모든 엔진) |
| **고아 행 수** | 값이 다른 테이블의 열에 일치하는 것이 없는 행 |
| **행 수** | 테이블의 행 수. **분할 기준**과 함께 쓰면 가장 유용합니다 |
| **사용자 지정 SQL** | 직접 작성한 읽기 전용 SELECT가 반환하는 숫자 |

같은 탭의 **제안된 검사**는 열의 이름과 형식만 보고, 테이블의 열에 필요한 검사를 제안합니다.
- id가 고유합니다.
- \`customer_id\`에 일치하는 행이 \`customers\`에 있습니다.
- 이메일 주소가 이메일 주소처럼 보이고, 금액이 음수가 아닙니다.
- 상태가 평소 값을 유지합니다.
- 테넌트별로 나뉜 테이블을 테넌트별로 셉니다.

하나만 추가하거나, 모두 추가하거나, 하나를 영구히 무시할 수 있습니다.

**분할 기준**은 테넌트나 리전처럼 열의 값마다 검사를 한 번씩 실행합니다: 가장 큰 100개 세그먼트에 대해 각각 하나의 시리즈와 하나의 경고가 생깁니다. 분할한 행 수는 한 테넌트가 데이터 전송을 멈추면 경고합니다.

검사는 데이터베이스의 수집과 함께, OneUptime이나 그 프로브에서 15분, 1시간, 6시간, 1일마다 실행됩니다. 각 검사는 문 시간 제한이 있는 읽기 전용 트랜잭션에서 하나의 집계 문으로 실행됩니다: 프로젝트가 실패한 행의 마스킹된 샘플을 보관하기로 하지 않는 한, 데이터베이스 밖으로 나가는 것은 숫자뿐입니다. 값은 \`oneuptime.data.check.value\`로, \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\`, \`oneuptime.data.check.segment\`와 함께 기록됩니다.

검사에서 경고하려면 **경고 조건**을 설정합니다.
- **비정상적으로 높음** 또는 **비정상적으로 낮음**은 각 값을 그 요일·시간대에 대해 학습한 자체 기준선과 비교합니다.
- **초과** 또는 **미만**은 임계값과 비교합니다.

검사를 저장하면 사용자 본인으로, 사용자의 권한으로 그 검사용 메트릭 모니터가 만들어집니다. 조건을 지우면 모니터가 제거됩니다.

**실패한 행**은 직접 작성한 읽기 전용 SELECT가 반환하는 행, 즉 있어서는 안 되는 행을 셉니다. 0이면 정상입니다.

검사 비용은 세 가지로 관리합니다. **샘플 비율**은 비율을 읽는 검사에서 행의 일부만 읽습니다. **설정**의 **검사가 읽을 수 있는 최대량(GB)**은 BigQuery나 Athena의 검사가 그보다 많이 읽기 전에 멈춥니다. 같은 곳의 **데이터베이스가 바쁠 때 대기**는 PostgreSQL, MySQL, SQL Server 데이터베이스가 바빠 보이면 실행할 차례가 된 검사를 다음 수집으로 미룹니다.

**설정**의 **실패한 행 보관**은 검사당 최대 20개의 실패한 행을 보관하며, 민감한 열은 데이터베이스를 떠나기 전에 마스킹됩니다. 켜기 전까지는 꺼져 있습니다. 행은 OneUptime에 저장되며(OneUptime Cloud에서는 OneUptime의 서버, 자체 호스팅 설치에서는 사용자의 서버), 끄면 삭제됩니다.

검사를 저장소의 파일에 두고 CI에서 \`oneuptime data-checks apply checks.yaml\`로 적용하세요. 풀 리퀘스트에서는 \`--dry-run\`과 함께 실행합니다. 파일 어디에든 오류가 있으면 아무것도 적용되지 않습니다. 파일 형식은 문서를 참고하세요.


## 대사

복사본은 어긋나기 마련입니다: 웨어하우스의 주문이 애플리케이션 데이터베이스보다 적거나, 마이그레이션 중에 행이 사라집니다. 대사는 하나 또는 두 데이터베이스에 있는 두 테이블의 측정값 하나를 비교합니다.
- **행 수**
- 열의 **합계**
- 열의 **고유 값 개수**
- **사용자 지정 SQL**: \`value\`라는 이름의 숫자 하나를 반환하는 읽기 전용 쿼리.

허용 범위로 **절대값** 양이나 원본 값의 **백분율**을 가집니다. **대사**에서 만드세요.

각 쪽은 대사가 만들고 관리하는 자체 데이터 검사가, 그 데이터베이스의 수집과 함께(OneUptime이나 데이터베이스의 프로브에서) 읽습니다. 그래서 대사는 네트워크 안의 PostgreSQL 테이블을 Snowflake나 BigQuery에 있는 그 복사본과 비교할 수 있습니다. 대사의 검사는 각 테이블의 점검 탭에 표시되며, 대사에서만 변경할 수 있습니다.

두 값은 둘 다 서로 15분 이내에 읽힌 시점에 비교되며, 그 뒤 두 쪽이 다시 함께 읽히도록 예약됩니다. 대사는 다음을 기록합니다.
- \`oneuptime.data.reconciliation.drifted\`: 둘이 허용 범위를 넘어 어긋나면 1, 일치하면 0. 대사의 모니터가 이것을 읽고, 어긋나면 경고합니다.
- \`oneuptime.data.reconciliation.difference\`: 대상의 값에서 원본의 값을 뺀 값.
- \`oneuptime.data.reconciliation.difference_percent\`: 그 차이를 원본 값에 대한 백분율로 나타낸 값.

검사가 실패한 쪽은 그 이유를 알려 줍니다. 일정에 따라 적재되는 복사본은 원본보다 늦습니다: 1시간보다 오래된 행처럼 둘 다 안정된 측정값을 사용자 지정 SQL로 비교하거나, 허용 범위에 지연을 반영하세요.

## OpenLineage의 파이프라인과 계보

Airflow, Dagster, Spark, dbt, Flink는 작업의 모든 실행을 [OpenLineage](https://openlineage.io) 이벤트로 기술합니다. 텔레메트리 수집 키를 사용해 그대로 OneUptime에 보내세요(프로젝트 설정 > 텔레메트리 및 APM > 수집 키).

- **URL:** \`https://oneuptime.com/telemetry/openlineage\`(자체 호스팅 OneUptime에서는 사용자의 주소)
- **엔드포인트:** \`api/v1/lineage\`, OpenLineage의 기본값
- **API 키:** 수집 키. \`Authorization: Bearer\`로 전송되며, \`x-oneuptime-token\`을 설정할 수도 있습니다.

Airflow의 OpenLineage 공급자의 경우:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

모든 OpenLineage 클라이언트에서는 \`OPENLINEAGE_URL\`과 \`OPENLINEAGE_API_KEY\`를 설정합니다.

각 작업은 **파이프라인**에 최신 실행(시작과 종료 시각, 소요 시간, 실패한 실행의 오류)과 함께 표시됩니다. OneUptime이 감시하는 테이블을 읽고 쓰는 실행은 **계보**가 됩니다: 테이블의 **계보** 탭에는 그 테이블의 바탕이 되는 테이블, 그 테이블에 쓰는 파이프라인과 그 최신 실행, 그 테이블로 만들어지는 테이블이 표시됩니다.

데이터 세트는 OpenLineage의 명명 규격에 따라 테이블과 일치시킵니다: \`postgres://host:5432\`는 \`database.schema.table\`, \`mysql://host:3306\`은 \`database.table\`, \`sqlserver://host:1433\`과 \`redshift://cluster:5439\`는 \`database.schema.table\`, \`snowflake://account\`는 \`database.schema.table\`, \`bigquery\`는 \`project.dataset.table\`, \`clickhouse://host:8443\`은 \`database.table\`, \`databricks://workspace-host\`는 \`catalog.schema.table\`입니다.

각 파이프라인은 자신의 실행에서 한 번의 실행에 보통 걸리는 시간(최근 완료된 20번 실행의 중앙값)과, 일정에 따른 실행 간격(최근 50번 시작 중 일회성이 아닌 가장 긴 간격)을 학습합니다. 둘 다 5번 실행 후에 알 수 있으며, 5분마다 실행되는 작업에도 야간에 실행되는 작업에도 똑같이 맞습니다. Airflow처럼 스케줄러가 OpenLineage의 \`nominalTime\` 패싯을 보내면, 실행의 예약 시각을 시작 시각으로 보므로 백필도 여전히 일정대로 읽힙니다.

파이프라인 페이지에서는 각각 한 번의 클릭으로 만들 수 있는 세 가지 모니터를 권장합니다.
- **파이프라인 실행 실패**: 실행이 실패하거나 중단됨.
- **파이프라인 실행이 비정상적으로 김**: 실행이 평소의 두 배 이상 걸림. 실행 중에는 5분마다 확인하므로, 멈춘 실행은 끝나기 전에 발견됩니다.
- **파이프라인이 지연됨**: 일정이 허용하는 시간보다 오래 실행이 시작되지 않음. 간격의 4분의 1, 최소 15분의 여유를 둡니다.

이들은 다음 메트릭을 읽으며, 각 메트릭에는 \`oneuptime.data.pipeline.id\`와 \`oneuptime.data.pipeline.name\` 태그가 붙습니다.
- \`oneuptime.data.pipeline.run_failed\`: 각 실행이 끝날 때 1 또는 0.
- \`oneuptime.data.pipeline.run_duration\`: 각 실행이 끝날 때 초 단위 시간.
- \`oneuptime.data.pipeline.run_duration_ratio\`: 실행 시간을 평소 실행 시간(최소 1분으로 계산)으로 나눈 값. 각 실행이 끝날 때와 실행 중에는 5분마다.
- \`oneuptime.data.pipeline.overdue_seconds\`: 다음 실행이 일정을 얼마나 넘겼는지, 5분마다. 제때이면 0.

파이프라인 페이지에는 그 **계보**가 그려집니다. 실행이 실패하거나 늦을 때 가장 먼저 볼 곳입니다: 왼쪽에는 읽는 테이블, 오른쪽에는 쓰는 테이블과 각각의 현재 상태가 표시됩니다. 단계를 늘리면 그 테이블의 바탕이 되는 것과 그 테이블로 만들어지는 것을 볼 수 있으며, 파이프라인이나 테이블 카드에 표시된 그려지지 않은 테이블 수를 선택하면 그 자리에 더 그려집니다. 같은 계보는 자체 도구용으로 \`POST /api/data-observability/pipelines/lineage\`에서도 얻을 수 있습니다. 파이프라인이 쓰는 열 하나를 선택하면 파이프라인을 가로질러 그 열을 따라갈 수 있습니다. 위로는 읽는 각 테이블에서 그 열의 원본 열까지, 아래로는 그 열을 쓰는 각 테이블까지 따라갑니다. 자체 도구에서는 실행이 옮긴 열을 받으려면 \`"withColumns": true\`를 보냅니다.



## Fivetran 및 Airbyte 동기화

Fivetran과 Airbyte는 원시 테이블을 적재하고 OpenLineage 이벤트는 보내지 않지만, 웹훅으로 각 동기화의 시작과 끝을 알려 줍니다. 각 Fivetran 커넥터와 각 Airbyte 연결은 **파이프라인**의 파이프라인이 되고, 각 동기화는 실행이 되며, 실행 기록, 학습된 소요 시간과 일정, 경고(실패한 실행, 비정상적으로 긴 실행, 지연된 실행)는 다른 파이프라인과 같습니다. **파이프라인 > Fivetran 또는 Airbyte 연결**은 아래 URL에 수집 키 하나를 채워 줍니다.

- **Fivetran:** Fivetran의 REST API로 계정이나 대상 그룹 하나에 대한 웹훅을 만들고, 이벤트 \`sync_start\`와 \`sync_end\`를 지정합니다. URL은 \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`이고, 비밀은 그 수집 키입니다. Fivetran은 모든 전송에 비밀로 서명하므로 키 자체가 URL에 실리지 않으며, 그 키로 서명되지 않은 전송은 거부됩니다.
- **Airbyte:** 작업 공간의 알림 설정에서 웹훅을 \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\`로 설정하고, 실패한 동기화와 성공한 동기화에 대해 켭니다. Airbyte는 아무것도 서명하지 않으므로 URL에 키가 포함됩니다: Airbyte에는 전용 키를 주세요.

파이프라인의 이름은 도구가 커넥터나 연결에 붙인 이름이며, \`fivetran://<destination group>\` 또는 \`airbyte://<workspace>\` 아래에 놓입니다. 실패한 동기화의 실행에는 도구의 오류가 표시됩니다. API 속도 제한 때문에 일정이 다시 잡힌 Fivetran 동기화는 **일정 변경됨**으로 끝납니다: 실패가 아니므로 아무도 호출하지 않으며, 그 시간은 소요 시간 학습에 쓰이지 않습니다.

Fivetran 커넥터는 대상에서 커넥터 이름이 붙은 스키마를 적재합니다. 그 스키마를 가진 감시 대상 데이터베이스가 정확히 하나라면, 그 데이터베이스의 테이블은 커넥터를 자신의 작성자로 기록합니다: 오래된 테이블은 자신을 적재했어야 할 동기화를 가리키고, 실패한 동기화의 경고가 테이블 경고의 원인이 됩니다(「원인 하나에 문제 하나」 참고). Airbyte는 테이블 이름을 알려 주지 않습니다.

## BI 도구의 대시보드

잘못된 데이터의 실제 영향은 누군가 여는 대시보드에서 나타납니다. **BI 대시보드**에서, 대시보드를 읽을 수 있는 자격 증명과 함께 BI 도구를 추가하세요.

| 도구 | 자격 증명(JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\`(또는 사용자의 \`username\`과 \`password\`) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, 개인용 액세스 토큰 |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, API 클라이언트 |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, Power BI의 관리 API를 사용할 수 있는 서비스 주체 |
| **Hightouch** | \`{ "apiKey": "..." }\`: 각 동기화를 테이블에 의존하는 또 하나의 대상으로 읽습니다 |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: 각 동기화를 테이블에 의존하는 또 하나의 대상으로 읽습니다 |

매시간, 그리고 도구를 추가하거나 **지금 읽기**를 선택할 때, OneUptime은 각 대시보드와 그 뒤의 테이블을 읽습니다: 카드의 테이블과 네이티브 질문의 SQL(Metabase), 데이터 세트의 테이블이나 가상 데이터 세트의 SQL(Superset), Metadata API의 업스트림 테이블(Tableau), 각 타일의 explore(Looker), 각 보고서의 데이터 세트(Power BI, 작업 영역 스캔에서)입니다. 각 테이블은 데이터베이스, 스키마, 이름으로 감시 대상 테이블과 일치시키며, 여전히 감시 대상 테이블 두 개에 맞는 이름은 일치시키지 않고 둡니다. 테이블의 **계보** 탭, 그 경고의 **데이터** 카드, 프로덕션 리뷰에는 그 테이블 위에, 그리고 그 테이블로 만들어지는 테이블 위에 만든 대시보드가 나열됩니다. 이름과 링크만 읽고, 대시보드의 데이터는 읽지 않습니다.

Power BI 도구는 데이터 세트의 새로 고침 실패에 대해서도 경고할 수 있습니다. **새로 고침 실패 시 경고**가 켜져 있으면(지금 추가하는 도구에서는 켜져 있습니다), OneUptime은 도구마다 모니터 하나를 유지하며, 마지막 새로 고침이 실패하거나 취소된 데이터 세트마다 경고를 열고(경고 제목에 데이터 세트 이름이 들어감), 이후 새로 고침이 완료되면 해결합니다. 모니터는 \`oneuptime.data.bi.refresh_failed\`를 읽으며, 이 메트릭에는 \`oneuptime.data.bi.dataset.name\`과 \`oneuptime.data.bi.workspace.name\` 태그가 붙습니다: 5분마다, 매시간 읽기에서 실패로 확인된 각 데이터 세트는 1을 기록하고, 이후 새로 고침이 완료된 뒤 1시간 동안은 0을 기록합니다. 아직 실행 중인 새로 고침은 아무것도 바꾸지 않으므로, 매시간 읽기가 몇 번 보든 실패 하나는 경고 하나입니다.

## 트레이스 속 작업

Kubernetes CronJob이나 타이머로 동작하는 함수는 아무것도 설치하지 않아도 파이프라인으로 나타납니다: \`k8s.cronjob.name\`이나 \`k8s.job.name\`이 있는 스팬, 또는 \`faas.trigger\`가 \`timer\`나 \`datasource\`인 \`faas.name\`이 있는 스팬은 그 실행, 그리고 데이터베이스 호출이 건드린 테이블과 함께 파이프라인이 됩니다. 각 실행은 트레이스와 로그로 연결되며, 실행이 멈춘 CronJob은 지연으로 감지됩니다.

## 데이터베이스가 알려 주는 계보

계보에는 OpenLineage를 보내는 파이프라인이 필요하지 않습니다. 각 데이터베이스가 스스로 그 일부를 알려 주며, OneUptime은 데이터베이스 수집과 함께 그것을 읽습니다.
- **뷰:** 뷰는 PostgreSQL, Redshift, MySQL 8, SQL Server에서 정의의 바탕이 된 테이블로 만들어집니다. 뷰가 다시 정의되거나 삭제되면 예전 계보도 함께 사라집니다.
- **쿼리 기록:** 예약된 쿼리, dbt 모델, MERGE처럼 한 테이블을 읽고 다른 테이블에 쓴 쿼리도 계보입니다. 이는 BigQuery의 작업(데이터 세트의 프로젝트와 위치에 대한 \`INFORMATION_SCHEMA.JOBS\` 뷰, **BigQuery Resource Viewer** 필요)과 Redshift의 쿼리 로그(\`stl_insert\`와 \`stl_scan\`, \`SYSLOG ACCESS UNRESTRICTED\` 필요)에서 가져옵니다. 작업 뷰에는 데이터 세트 자체 프로젝트에서 실행된 작업만 들어 있습니다.

계보는 1시간에 한 번, 마지막 읽기까지 거슬러 올라가 읽으며, 데이터베이스의 첫 수집에서는 1주일 전까지 거슬러 올라가므로 처음부터 갖춰져 있습니다. BigQuery 읽기는 읽은 작업의 시간만큼 청구되며, 대부분 BigQuery의 최소 청구량 10MB입니다.

테이블의 **계보** 탭에 있는 각 에지에는 그것이 어디서 확인되었는지가 표시됩니다: 파이프라인의 실행, 쿼리 기록(데이터를 옮긴 쿼리의 로그인 포함), 또는 뷰의 정의입니다. 모든 출처의 계보가 **원인 하나에 문제 하나**에 사용됩니다.

테이블의 **계보** 탭 맨 위에는 테이블의 계보를 양쪽으로 몇 단계(3단계, 또는 1, 2, 5 중 선택) 그린 다이어그램이 있습니다: 왼쪽에는 테이블의 바탕이 되는 것, 오른쪽에는 테이블로 만들어지는 테이블과 대시보드, 그리고 데이터가 들어오는 곳에는 외부에서 데이터를 적재하는 파이프라인이 있습니다. 각 카드에는 현재 상태(지연, 열린 경고, 실패한 실행)가 표시되며, 파이프라인의 최신 실행이 실패하면 화살표가 빨간색으로 바뀌므로, 지연된 테이블에서 그것을 망가뜨린 실행까지 따라갈 수 있습니다. 아무 테이블이나 열면 다이어그램이 그 테이블을 중심으로 표시됩니다. 카드에는 방향마다 최대 10개의 테이블이 그려지고 나머지는 **+14**처럼 개수로 표시됩니다: 그 개수를 선택하면 다음 테이블이 그 자리에 그려지고, **다이어그램 재설정**으로 되돌아갑니다. 출처가 열을 알려 주는 경우, **열 따라가기**에서 테이블의 열 하나를 고르면 그 열이 어디에서 와서 어디로 가는지가, 도중에 이름이 바뀌더라도 강조 표시됩니다. 같은 계보는 자체 도구용으로 \`POST /api/data-observability/tables/lineage\`에서도 얻을 수 있습니다: 각 화살표의 열을 받으려면 \`"withColumns": true\`를 보내고, 카드의 다음 테이블은 \`POST /api/data-observability/lineage/expand\`에 요청하세요. 계보는 내 역할이 읽을 수 있는 테이블과 파이프라인만 보여 줍니다. 읽을 수 없는 것은 그려지지도, 화살표에 이름이 나오지도, 개수에 포함되지도 않습니다.

## dbt

\`dbt build\`(또는 run, test, seed, snapshot) 후에 CLI와 텔레메트리 수집 키로 프로젝트의 아티팩트를 보내세요. CLI는 \`target/manifest.json\`과 \`target/run_results.json\`을 읽고, Data Observability가 읽는 부분만 보냅니다.

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

CI에서는 빌드가 실패해도 실패한 테스트가 기록되도록, 빌드 다음 단계로 \`oneuptime dbt upload\`를 실행하세요. dbt Cloud 작업의 경우 dbt Cloud의 API로 아티팩트를 내려받은 다음 \`--manifest\`와 \`--run-results\`로 업로드합니다. 직접 보낼 수도 있습니다: \`POST /telemetry/dbt/v1/artifacts\`에 \`{ "manifest": ..., "run_results": ... }\`를 보내고, 키는 \`x-oneuptime-token\`에 넣습니다.

각 업로드가 하는 일:
- **테이블:** OneUptime이 감시하는 테이블에 해당하는 각 모델, seed, snapshot, 소스는 개요에 **dbt** 카드를 받습니다: 노드, 구체화 방식, 소유자, 태그, 마지막 빌드입니다. 테이블 설명이 비어 있으면 dbt 설명으로 채워집니다. 테이블은 PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse, Databricks에 대해 데이터베이스, 스키마, 이름으로 일치시킵니다. dbt는 호스트를 모르므로, 감시 대상 데이터베이스 두 개가 같은 이름을 쓰면 둘 중 하나에만 테이블이 있는 경우가 아니라면 그 테이블은 일치시키지 않고 둡니다.
- **계보:** 각 모델의 바탕이 되는 것이 프로젝트의 파이프라인을 통해 테이블의 **계보** 탭에서 계보가 됩니다.
- **테스트:** 감시 대상 테이블의 각 테스트는 그 테이블의 **점검** 탭에, 마지막 결과와 실패로 찾은 행과 함께 표시됩니다. **실패 시 경고**를 클릭하면 실패한 테스트가 경고를 엽니다.
- **빌드:** 각 빌드는 **파이프라인**에 있는 프로젝트 파이프라인(네임스페이스 \`dbt\`)의 실행입니다. 오류나 실패한 테스트가 있는 빌드는 실패한 실행이므로, 파이프라인 경고(실패, 비정상적으로 김, 지연)는 dbt 빌드에서도 작동합니다.

## 사용되지 않는 테이블

각 엔진은 자체 통계에서 각 테이블의 읽기를 셉니다.
- PostgreSQL: 스캔.
- MySQL: performance_schema의 읽기.
- SQL Server: seek, scan, lookup과 마지막 것의 시각.

각 수집은 카운터를 마지막으로 저장한 값과 비교하므로, 테이블의 **마지막 읽기**를 시간 단위로 알 수 있고, 읽기가 없어진 시점도 알 수 있습니다. 테이블의 첫 수집에서 카운터가 0이면 엔진 통계가 시작된 이후 읽힌 적이 없다는 뜻이므로, 사용되지 않는 테이블은 몇 달 동안 지켜본 뒤가 아니라 처음부터 사용되지 않음으로 표시됩니다. 서비스의 데이터베이스 스팬에서 확인된 읽기도 셉니다.

**사용되지 않는 테이블**에는 90일 동안 아무도 읽지 않은 테이블이 큰 것부터, 각각 마지막으로 쓰인 시점과 함께 나열됩니다: 계속 쓰이지만 읽히지 않는 테이블은 쓰기와 스토리지 비용이 듭니다. 개요에는 그 개수와 내용이 표시됩니다. 뷰는 자체 카운터가 없으므로 나열되지 않습니다. 데이터베이스 로그인이 카운터를 읽을 수 없으면, 테이블의 마지막 읽기는 알 수 없습니다.

## 웨어하우스 지출

1시간에 한 번, 각 웨어하우스의 수집과 함께, OneUptime은 Snowflake와 BigQuery가 지난 하루 동안 쓴 비용을 작업별로 읽습니다: Snowflake의 컴퓨팅 크레딧은 \`QUERY_ATTRIBUTION_HISTORY\`에서(\`SNOWFLAKE\` 데이터베이스에 대한 \`IMPORTED PRIVILEGES\` 필요, 연결의 웨어하우스에서 실행), BigQuery의 청구 바이트는 작업 뷰에서(**BigQuery Resource Viewer** 필요) 읽습니다. 작업이란 반복해서 실행되는 하나의 쿼리입니다 - Snowflake의 매개변수화된 쿼리, 리터럴을 뺀 BigQuery의 쿼리 - 쿼리 태그나 레이블, 또는 하는 일과 쓰는 테이블로 이름이 붙으며, 쿼리 텍스트로 이름이 붙지는 않습니다.

**웨어하우스 지출**에는 그날의 크레딧과 청구 바이트가 팀별(작업의 쿼리 태그나 레이블의 \`team\`, 없으면 실행한 사람)로, 쓰기 비용이 가장 큰 테이블(Snowflake의 ACCESS_HISTORY나 BigQuery의 대상 테이블이 어떤 테이블인지 알려 주는 경우, 작업의 비용을 쓰는 테이블에 나눔), 실패한 작업, 그리고 90일 동안 아무도 읽지 않은 테이블에만 쓰는 작업에 드는 비용이 표시됩니다.

## 원인 하나에 문제 하나

테이블이 오래되면, 그 테이블로 만들어지는 모든 테이블도 오래됩니다. 데이터 경고를 열기 전에 OneUptime은 계보를 따라, 테이블이나 파이프라인의 바탕이 되는 것(업스트림 테이블, 그 테이블에 쓰는 파이프라인, 그 테이블이 있는 데이터베이스, 최대 5단계 위까지)에 이미 열린 경고가 있는지 찾습니다. 찾으면 새 경고는 그 경고의 영향 대상이 됩니다.
- **확인됨** 상태로 시작하므로, 문제 하나로 두 번 호출되는 사람이 없습니다. 데이터가 회복되면 저절로 회복됩니다.
- 피드에 어떤 경고가 원인인지 표시되며, **데이터** 카드에도 표시됩니다.
- 원인이 에피소드에 속해 있으면 그 에피소드에 합류합니다.

원인의 **데이터** 카드에는 그 **다운스트림 영향**, 즉 원인이 된 모든 경고가 나열됩니다. 테이블 경고의 카드에는 테이블에 쓰는 서비스와 그 실패한 쓰기, 경고 전날의 배포와 기타 변경도 표시됩니다.

**데이터** 카드 아래에는 경고 페이지에 그 **계보**가 그려집니다: 테이블의 **계보** 탭처럼 테이블을 중심으로, 또는 파이프라인을 중심으로 그려지며, 원인이 된 경고까지 올라가는 길과 원인이 된 각 경고까지 내려가는 길이 강조 표시되고, 원인에는 **원인**, 원인이 된 각 경고에는 **영향 대상** 표시가 붙습니다. 원인이 화살표 위에 그려진 파이프라인에 있으면, 화살표의 파이프라인 이름 아래에 **원인**이 표시됩니다. 열 하나에 대한 검사(예: \`customer_id\`에 대한 NULL 비율 검사)에서 온 경고는, 테이블의 **계보** 탭에서처럼 이 길들 옆에서 그 열을 따라간 상태로 열립니다. 그곳에서 테이블의 다른 열을 고르거나, 선택을 지워 길만 볼 수 있습니다. 원인이 된 경고를 볼 권한이 없는 사람에게는 **데이터** 카드도 계보도 표시되지 않으며, 볼 권한이 없는 원인이 된 경고는 강조 표시되지도 집계되지도 않습니다. 같은 계보는 \`POST /api/data-observability/alerts/<alert ID>/lineage\`에서도 얻을 수 있으며, 열 검사의 경고가 읽는 \`column\`과 각 화살표가 나르는 열이 포함됩니다. 화살표 위에 그려진 파이프라인에서 일으킨 경고도 같은 방식으로 **영향 대상**(이)라고 표시되며, 열 선택기는 먼저 검사의 열을, 이어서 테이블의 다른 열을 테이블 자체의 순서대로 보여 줍니다.


## OneUptime AI

- **데이터 경고 조사.** OneUptime AI가 테이블, 파이프라인, 데이터베이스의 경고를 조사할 때는 그 주변에 있는 것을 읽습니다: 테이블의 최신성과 열린 경고, 이 경고가 영향 대상으로 속한 원인 경고, 전날부터 그 테이블에 쓰는 파이프라인의 실행(실패한 실행과 그 오류), 그 테이블에 쓰는 서비스와 그 실패한 쓰기, 배포와 기타 변경, 그리고 계보: 테이블의 바탕이 되는 테이블과 테이블로 만들어지는 테이블(문제가 있는 것이 먼저), 원인 경고가 어디에 있는지, 원인이 된 경고가 어느 테이블에 있는지입니다. 열 하나에 대한 검사에서 온 경고라면, 그 열도 계보를 따라 추적합니다: 업스트림에서 그 열의 바탕이 되는 열과 다운스트림에서 그 열로 만들어지는 열을 테이블별로 따라갑니다. 경고 뒤에 있는 실행, 배포, 업스트림 테이블을 짚어 냅니다. 경고를 볼 수 있는 모든 사람이 그 보고서를 읽으므로, 조사는 아무도 **소유자** 나 **레이블** 로 구분해 두지 않은 테이블과 파이프라인, 그리고 경고 자체의 테이블이나 파이프라인만 읽습니다. 그 밖의 것은 시작하는 정보에서도, 도중에 묻는 내용에서도 이름을 대거나 세지 않습니다.
- **문장으로 만드는 검사.** 테이블의 점검 탭에서 **문장으로 검사 작성**을 사용하면 "주문의 합계는 절대 음수가 아니다" 같은 규칙이, 그 규칙을 어기는 행을 세는 사용자 지정 SQL 검사가 되고, 위반이 있으면 경고합니다. **검사 추가**로 추가하기 전에 쿼리를 확인할 수 있으며, 이 쿼리에는 모든 사용자 지정 SQL 검사에 적용되는 제약이 똑같이 적용됩니다: 읽기 전용 트랜잭션에서 실행되는 하나의 읽기 전용 문입니다.
- **이 테이블은 최신인가요?** AI에게 질문, Slack, Microsoft Teams에서 OneUptime AI에게 물어보세요("orders 테이블은 최신이야?"). 테이블 자체의 리듬에 따른 최신성, 마지막으로 변경된 시점, 열린 경고, 작성자의 최신 실행, 테이블이 속한 데이터 제품으로 답합니다. AI 에이전트는 데이터를 사용하기 전에 MCP 서버의 \`get_data_table_freshness\` 도구로 같은 것을 묻습니다.
- **이 테이블은 무엇으로 만들어지나요?** 같은 방식으로 물어보세요("revenue 테이블에는 무엇이 들어와?", "raw.orders 적재가 멈추면 무엇이 망가져?"). 테이블의 계보를 양쪽으로 3단계(요청하면 최대 5단계) 따라가며, 지연되었거나, 삭제되었거나, 열린 경고가 있거나, 파이프라인이 마지막 실행에서 실패한 업스트림·다운스트림 테이블을 가까운 것부터, 각각 몇 단계 떨어져 있는지와 그 사이의 테이블과 함께 먼저 보여 줍니다. 그다음에 나머지, 즉 OneUptime이 감시하지 않는 외부에서 소스를 적재하는 파이프라인과, 그 테이블 위에 만든 BI 대시보드를 보여 줍니다. 열린 경고는 개수만 알려 주고 이름은 밝히지 않으며, 묻는 사람이 볼 수 있는 것만 대상입니다. AI 에이전트는 테이블을 변경하기 전에 MCP 서버의 \`get_data_table_lineage\` 도구로 같은 것을 묻습니다. 답에서 말한 테이블보다 더 멀리 있는 테이블은 말한 테이블 몇 개와 이웃하든 각각 한 번만 셉니다. 테이블 페이지에서 연 AI에게 질문은(는) '이 테이블'이 어느 테이블인지 알고, 여러 데이터베이스에 같은 이름의 테이블이 있어도 바로 그 테이블에 대해 묻습니다. 다른 모든 계보 화면처럼, 묻는 사람이 읽을 수 있는 테이블과 파이프라인만 알려 줍니다.

## 각 테이블을 사용하는 서비스

테이블의 **서비스** 탭에는 그 테이블에 쓰거나 읽는 것으로 확인된 서비스가, 각 서비스가 실행한 문, 지난 1시간의 호출과 실패, 마지막으로 확인된 시점과 함께 나열됩니다. 이는 서비스가 이미 OpenTelemetry로 보내는 데이터베이스 스팬에서 가져옵니다: \`db.system.name\`, \`db.namespace\`, \`db.collection.name\`(또는 \`db.sql.table\`, 또는 \`INSERT orders\` 같은 이름의 스팬)이 있는 클라이언트 스팬입니다. 추가로 설치할 것은 없습니다. 15분마다 업데이트됩니다.

각 서비스에는 호출을 하는 엔드포인트도 표시되며, 모델도 호출하면 **AI 앱**으로 표시됩니다. **이 테이블을 언급하는 오류**에는 테이블에 쓰는 서비스의 해결되지 않은 예외와 지난 하루의 오류 로그 중 테이블 이름을 언급한 것이 나열됩니다.

스팬은 그 데이터베이스가 수집에서 읽은 데이터베이스일 때만 테이블에 연결되며, 두 데이터베이스가 같은 이름을 쓰는 경우에는 그 \`server.address\`가 둘 중 하나의 것일 때만 연결됩니다. 확실하지 않으면 그 스팬은 제외됩니다.

이 메트릭은 OneUptime 자체의 운영 데이터이며 텔레메트리로 청구되지 않습니다.
`;

export default DOCUMENTATION;
