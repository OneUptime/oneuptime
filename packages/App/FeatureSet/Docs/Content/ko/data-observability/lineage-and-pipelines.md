# 리니지와 파이프라인

리니지는 각 테이블이 어떤 테이블로부터 만들어지고, 어떤 파이프라인이 그 테이블에 쓰는지 알려 줍니다. 데이터 옵저버빌리티는 OpenLineage 이벤트, dbt, Fivetran과 Airbyte 동기화, 뷰, 그리고 각 데이터베이스 자체의 쿼리 기록이라는 다섯 곳에서 동시에 리니지를 모으고, 이를 사용해 늦어지거나 깨진 모든 테이블을 그 배후의 실행과 연결하므로, 문제 하나에는 경고 하나만 열립니다.

## 리니지의 출처

| 소스 | 제공하는 것 |
| --- | --- |
| **OpenLineage** | Airflow, Dagster, Spark, dbt, Flink 작업의 모든 실행과, 그 실행이 읽고 쓴 테이블 |
| **dbt** | 각 모델이 무엇으로부터 만들어지는지, 실행으로서의 각 빌드, 그리고 각 테스트의 결과 |
| **Fivetran과 Airbyte** | 커넥터의 실행으로서의 각 동기화와, 그 동기화가 적재하는 원시 테이블 |
| **뷰** | 뷰는 그 정의에 쓰인 테이블로부터 만들어집니다(PostgreSQL, Redshift, MySQL 8, SQL Server, ClickHouse 구체화된 뷰, Databricks) |
| **쿼리 기록** | 한 테이블을 읽고 다른 테이블에 쓴 쿼리(BigQuery의 작업, Redshift의 쿼리 로그, ClickHouse의 쿼리 로그, Databricks의 리니지 테이블) |

테이블의 **계보** 탭에는 그 테이블을 만드는 테이블, 그 테이블에 쓰는 파이프라인과 그 최신 실행, 그리고 그 테이블로부터 만들어지는 테이블이 표시됩니다. 각 엣지에는 그것이 어디서 확인되었는지가 나옵니다.

## OpenLineage

텔레메트리 [수집 키](/docs/telemetry/ingestion-keys)로 OpenLineage 이벤트를 수정 없이 그대로 OneUptime에 보냅니다.

- **URL:** `https://oneuptime.com/telemetry/openlineage` (자체 호스팅 OneUptime에서는 자체 주소)
- **엔드포인트:** `api/v1/lineage`, OpenLineage의 기본값
- **API 키:** 수집 키. `Authorization: Bearer` 로 보내거나 `x-oneuptime-token` 을 설정합니다

Airflow의 OpenLineage 공급자의 경우:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

다른 OpenLineage 클라이언트에서는 `OPENLINEAGE_URL` 과 `OPENLINEAGE_API_KEY` 를 설정합니다. 데이터 세트는 OpenLineage 명명 규격에 따라 테이블에 대응됩니다. 예를 들어 `postgres://host:5432` 의 `database.schema.table`, `snowflake://account` 의 `database.schema.table`, `clickhouse://host:8443` 의 `database.table`, `databricks://workspace-host` 의 `catalog.schema.table` 입니다.

## dbt

`dbt build`(또는 run, test, seed, snapshot) 후에 [OneUptime CLI](/docs/cli/index)로 프로젝트의 아티팩트를 보냅니다.

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

CI에서는 빌드가 실패하더라도 빌드 다음 단계로 `oneuptime dbt upload` 를 실행해, 실패한 테스트가 기록되게 하세요. dbt가 빌드하는 각 테이블에는 개요에 **dbt** 카드가, 모델의 리니지가, 그리고 **점검** 탭에 테스트가 표시되며, 각 빌드는 프로젝트 파이프라인의 실행 하나입니다.

## Fivetran과 Airbyte

이들의 웹훅은 각 동기화가 언제 시작하고 끝나는지 알려 줍니다. **파이프라인 > Fivetran 또는 Airbyte 연결** 은 수집 키 중 하나로 URL을 채워 줍니다.

- **Fivetran:** Fivetran의 REST API로 만드는 웹훅으로, `sync_start` 와 `sync_end` 이벤트에 대해 `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>` 로 보내며, 수집 키를 시크릿으로 씁니다. Fivetran은 모든 전송에 이 키로 서명하므로, 키가 URL에 담겨 전달되는 일은 없습니다.
- **Airbyte:** 워크스페이스의 웹훅을 `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>` 로 설정하고, 실패한 동기화와 성공한 동기화에 대해 켭니다. Airbyte에는 전용 키를 주세요.

API 속도 제한 때문에 일정이 변경된 Fivetran 동기화는 **일정 변경됨** 으로 끝납니다. 실패가 아니므로 아무도 호출하지 않습니다.

## 파이프라인

각 작업, dbt 프로젝트, 동기화는 그 실행과 함께 **파이프라인** 아래에 나타납니다. 각 실행이 언제 시작하고 끝났는지, 얼마나 걸렸는지, 그리고 실패한 실행의 오류입니다. 각 파이프라인은 실행이 다섯 번 쌓이면, 자신의 실행에서 한 번의 실행이 보통 얼마나 걸리는지와 일정상 실행 사이가 얼마나 벌어지는지를 학습합니다. 파이프라인 페이지는 세 가지 모니터를 권장합니다.

- **Pipeline Run Failed**: 실행이 실패하거나 중단되었습니다.
- **Pipeline Run Unusually Long**: 실행이 평소 시간의 두 배 이상 걸리고 있습니다. 실행 중에는 5분마다 확인하므로, 멈춘 실행은 끝나기 전에 발견됩니다.
- **Pipeline Is Late**: 일정이 허용하는 시간보다 오래 실행이 시작되지 않았습니다.

## 원인 하나에 경고 하나

테이블이 오래되면 그 테이블로부터 만들어지는 모든 테이블도 오래됩니다. 데이터 경고가 열리기 전에, OneUptime은 리니지를 조회해 그 테이블이나 파이프라인의 원천에 이미 열린 경고가 있는지 찾습니다. 업스트림 테이블, 그 테이블에 쓰는 파이프라인, 그리고 그 테이블이 있는 데이터베이스를 최대 다섯 단계 위까지 찾습니다. 찾으면 새 경고는 그 경고의 결과가 됩니다.

- **인지됨** 상태로 시작하므로 문제 하나로 누구도 두 번 호출되지 않으며, 데이터가 회복되면 저절로 회복됩니다.
- 피드와 **데이터** 카드에 어떤 경고가 원인인지 표시되며, 원인의 에피소드에 합류합니다.

원인의 **데이터** 카드에는 **Downstream Impact** 가 나열됩니다. 그 원인이 일으킨 모든 경고입니다. 테이블 경고의 카드에는 테이블에 쓰는 서비스도 표시되며, 그 서비스의 실패한 쓰기, 그리고 경고 전 하루 동안의 배포와 기타 변경이 함께 나옵니다.

## 다음 단계

:::cards
- [데이터 제품](/docs/data-observability/data-products): 사람들이 사용하는 테이블에 대한 최신성 SLA.
- [OneUptime AI와 API](/docs/data-observability/ai-and-api): 테이블에 쓰는 주체와 실행에서 시작하는 조사.
:::
