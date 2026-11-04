# 데이터베이스 연결

데이터 옵저버빌리티는 각 데이터베이스를 카탈로그만 읽는 로그인으로 읽습니다. 어떤 테이블과 뷰가 있는지, 그 열, 행 수, 크기, 그리고 언제 바뀌었는지입니다. 이 페이지에서는 각 엔진에 필요한 최소한의 권한과, 프로브로 연결 문자열을 네트워크 안에 두는 방법을 설명합니다.

## 시작하기 전에

- **데이터베이스를 연결할 수 있는 역할**: Project Owner, Project Admin 또는 Telemetry Admin.
- **읽기 전용 로그인**. 아래 SQL 문으로 만듭니다. 나중에 추가하는 검사는 검사 대상 테이블의 행을 읽으므로, 그 테이블에 대한 `SELECT` 는 검사를 추가할 때에만 로그인에 부여하세요.

## 연결 주체 선택하기

**데이터 관측 가능성 > 데이터베이스** 에서 **Connect a Database** 를 선택한 다음, 아래 중 하나를 고릅니다.

- **OneUptime connects**: 연결 문자열을 붙여 넣습니다. 연결 문자열은 암호화되어 저장되고, OneUptime의 워커만 사용하며, 다시는 표시되지 않습니다.
- **A probe in my network connects**: 프로브 하나를 고르고, 그 프로브에서 연결 문자열을 담고 있는 환경 변수의 이름(예: `ORDERS_DB_URL`)을 지정합니다. 연결 문자열은 절대 네트워크 밖으로 나가지 않습니다. [사용자 지정 프로브](/docs/probe/custom-probe)를 참고하세요.

데이터 보안을 위해 이미 연결된 데이터베이스도 따로 연결하지 않아도 감시되며, [클라우드 연결](/docs/telemetry/cloud-accounts)이 찾은 모든 BigQuery 데이터 세트도 마찬가지입니다.

## 엔진별 읽기 전용 로그인

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

연결 문자열은 `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require` 입니다. OneUptime은 `pg_class`, `pg_stat_user_tables`, `pg_attribute` 를 읽습니다. 삽입, 업데이트, 삭제 카운터가 움직이면 테이블이 바뀐 것이고, 스캔 카운터가 움직이면 테이블이 읽힌 것입니다.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` 가 있으면 OneUptime이 수집과 수집 사이의 쓰기와 읽기를 볼 수 있습니다. 없더라도 `information_schema.TABLES` 로 각 테이블이 마지막으로 바뀐 시점은 알 수 있습니다.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` 가 있으면 OneUptime이 크기, 마지막 업데이트, 마지막 읽기를 읽을 수 있습니다.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

클러스터 또는 작업 그룹 엔드포인트에 `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require` 같은 PostgreSQL 연결 문자열로 연결합니다. `SYSLOG ACCESS UNRESTRICTED` 가 있으면 OneUptime이 행 수와 크기, 모든 사용자의 마지막 쓰기와 읽기, 그리고 쿼리 로그에서 리니지를 읽을 수 있습니다. 없더라도 테이블의 행 수가 바뀌면 언제 바뀌었는지는 알 수 있습니다.
@tab Snowflake
```sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
```

Snowflake는 키 페어 인증을 사용해 SQL API로 읽습니다. JSON으로 연결합니다.

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

카탈로그는 웨어하우스가 필요 없는 `SHOW` 로 읽으므로, 수집에는 크레딧이 들지 않습니다. 웨어하우스에서는 검사만, 지정한 일정에 따라 실행됩니다.
@tab Google BigQuery
클라우드 연결이 찾은 모든 데이터 세트는 그 연결의 서비스 계정으로 감시됩니다. 카탈로그를 읽도록 프로젝트에 대해 **BigQuery Metadata Viewer** 와 **BigQuery Job User** 를, 검사가 읽는 테이블에 대해 **BigQuery Data Viewer** 를, 작업에서 리니지를 얻도록 **BigQuery Resource Viewer** 를 부여하세요.

각 수집은 데이터 세트의 `__TABLES__`(행 수, 바이트, 마지막 변경을 비용 없이 제공)와 `INFORMATION_SCHEMA.COLUMNS`(BigQuery의 최소 과금 단위인 10MB로 과금)를 읽습니다. 클라우드 연결 없이 데이터 세트를 연결하려면 서비스 계정 키가 담긴 JSON을 입력합니다.

```json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
```
@tab ClickHouse
```sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
```

ClickHouse는 HTTP 인터페이스로 읽으며, 포트는 TLS를 쓰면 8443(ClickHouse Cloud), 쓰지 않으면 8123입니다. 예: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. 데이터베이스 이름을 지정하면 그 데이터베이스만 감시하고, 생략하면 서버 자체의 데이터베이스를 뺀 모든 데이터베이스를 감시합니다. `system.parts` 로 OneUptime이 각 삽입을 볼 수 있고(병합은 세지 않음), 서버가 보관하는 경우 `system.part_log` 에서 각 삽입의 시각을, `system.query_log` 에서 마지막 읽기와 리니지를 한 시간에 한 번 얻습니다. 모든 문은 읽기 전용으로 실행되므로, 쓰기가 가능한 로그인이라도 쓸 수 없습니다.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Unity Catalog의 카탈로그 하나가 데이터베이스 하나입니다. 서비스 주체로 연결하거나, `clientId` 와 `clientSecret` 대신 개인용 액세스 토큰을 `"token"` 으로 지정해 연결합니다.

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

카탈로그, 그 열, 각 Delta 테이블의 마지막 커밋은 SQL 웨어하우스 없이 Unity Catalog의 REST API에서 가져오므로, 수집에는 컴퓨팅 비용이 들지 않습니다. 검사, 그리고 한 시간에 한 번 `system.access.table_lineage` 에서 가져오는 리니지와 마지막 읽기는 지정한 SQL 웨어하우스에서 실행됩니다. 서비스 주체에 그 웨어하우스에 대한 **Can use** 를 부여하세요.
:::

## 읽는 항목과 주기

| 항목 | 시점 |
| --- | --- |
| 테이블, 뷰, 열, 행 수, 크기, 마지막 변경 | 5분마다 |
| 검사 | 각 검사의 설정에 따라 15분, 1시간, 6시간 또는 하루마다 |
| 쿼리 기록에서 얻는 리니지와 마지막 읽기 | 한 시간에 한 번, 마지막으로 읽은 시점까지 거슬러 올라가며 |

모든 문은 읽기 전용으로 실행되며, 엔진이 지원하면 문 시간 제한과 잠금 시간 제한이 걸립니다. 연결 문자열은 절대 로그에 남지 않으며, 모든 오류 메시지에서 제거됩니다. 로그인이 읽을 수 없는 통계는 수집 실패로 처리하지 않고, 데이터베이스에 경고를 남긴 채 제외합니다.

## 문제 해결

- **데이터베이스에 "실패"가 표시됩니다.** 메시지에 이유가 나옵니다. OneUptime이 도달할 수 없는 호스트, 거부된 로그인, 서버가 받아들이지 않는 TLS 모드 같은 것입니다. 네트워크 안에 있는 데이터베이스라면 프로브를 통해 연결하세요.
- **테이블에 마지막 변경이 표시되지 않습니다.** 로그인이 엔진의 통계를 읽을 수 없습니다. 엔진 탭에 나열된 권한을 부여하거나, 테이블의 행 수가 두 번 바뀔 때까지 기다리세요.
- **테이블이 보이지 않습니다.** 로그인이 사용할 수 없는 스키마에 있거나, 데이터베이스에서 제외되어 있습니다. 그 스키마에 대한 `USAGE` 를 부여하거나, 제외를 해제하세요.

## 다음 단계

:::cards
- [테이블 상태](/docs/data-observability/table-health): 각 수집이 모든 테이블에 대해 알아내는 것과 권장하는 경고.
- [검사 및 대사](/docs/data-observability/checks): 테이블에 담긴 내용에 대한 규칙.
:::
