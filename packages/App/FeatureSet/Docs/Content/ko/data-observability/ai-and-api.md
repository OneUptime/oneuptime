# OneUptime AI와 API

OneUptime AI는 데이터를 압니다. 테이블에 쓰는 주체, 실행, 계보에서 출발해 데이터 경고를 조사하고, 어디서 묻든 테이블이 최신인지, 무엇으로 만들어지는지 답하며, 문장 하나로 말한 규칙으로 검사를 작성합니다. 데이터 옵저버빌리티가 보여 주는 모든 것은 엔드포인트, 메트릭, MCP 서버를 통해 여러분의 도구에서도 쓸 수 있습니다.

## OneUptime AI

- **데이터 경고 조사.** OneUptime AI가 테이블, 파이프라인 또는 데이터베이스의 경고를 조사할 때는 그 주변에서 시작합니다. 테이블의 최신성과 열린 경고, 그 경고를 일으킨 원인 경고, 전날부터 그 테이블에 쓴 파이프라인의 실행(오류가 있는 실패한 실행 또는 오지 않은 실행), 그 테이블에 쓰는 서비스와 그 서비스의 실패한 쓰기, 배포와 기타 변경, 그 테이블의 계보(그 테이블을 만드는 테이블과 그 테이블로 만드는 테이블. 문제가 있는 것이 먼저이고, 그 경고를 일으킨 원인 경고가 그 안의 어디에 있는지, 그 경고가 일으킨 경고가 어느 테이블에 있는지도 담깁니다), 그리고 바뀐 열입니다. 열 하나에 대한 검사에서 생긴 경고라면 그 열도 계보를 따라 추적합니다. 업스트림에서 그 열을 만드는 열과 다운스트림에서 그 열로 만드는 열을, 계보의 소스가 부르는 이름으로 테이블마다 알려 줍니다. 경고의 배후에 있는 실행, 배포 또는 업스트림 테이블을 지목합니다. [AI SRE](/docs/ai/ai-sre)를 참고하세요.
- **이 테이블은 최신인가요?** [AI에게 질문](/docs/ai/ask-ai), Slack 또는 Microsoft Teams에서 "orders 테이블은 최신인가요?"라고 물어보세요. 답변에는 테이블 자체의 리듬에 따른 최신성, 마지막으로 바뀐 시점, 열린 경고, 테이블에 쓰는 주체의 최신 실행, 그리고 테이블이 속한 데이터 제품이 담깁니다. 여러 데이터베이스가 같은 이름을 쓰면 각각에 대해 답하므로, 엉뚱한 테이블이 최신이라는 답을 듣는 일이 없습니다.
- **이 테이블은 무엇으로 만들어지나요?** "revenue 테이블에는 무엇이 들어오나요?" 또는 "raw.orders가 더 이상 적재되지 않으면 무엇이 깨지나요?"라고 물어보세요. 답변은 테이블의 계보를 방향마다 3단계, 요청하면 최대 5단계까지 따라가며 잘못된 것을 먼저 보여 줍니다. 늦었거나, 삭제되었거나, 열린 경고가 있거나, 파이프라인이 마지막 실행에 실패한 업스트림과 다운스트림 테이블을 가까운 순서로, 각각 몇 단계 떨어져 있는지와 그 사이의 테이블과 함께 보여 줍니다. 그다음 나머지 테이블, OneUptime이 감시하는 범위 밖에서 원본을 적재하는 파이프라인, 그 테이블 위에 만든 BI 대시보드가 이어집니다. 열린 경고는 이름 없이 개수만 세며, 묻는 사람이 볼 수 있는 경고만 셉니다.
- **문장으로 만드는 검사.** 테이블의 **점검** 탭에서 **문장으로 검사 작성** 은 규칙을 엔진의 SQL로 된 사용자 지정 SQL 검사로 바꿉니다. [검사 및 대사](/docs/data-observability/checks)를 참고하세요.

- **느린 드리프트.** 테이블의 행 수나 검사 값이 일주일 만에 오분의 일 이상 움직였지만 어떤 경고가 울리기에는 너무 느린 경우, AI 인사이트에 살펴볼 항목으로 전달됩니다. 아무도 호출하지 않습니다.
- **AI 앱 뒤의 오래된 데이터.** 모델을 호출하면서 테이블도 읽는 서비스는 그 테이블의 AI 소비자입니다. 그런 테이블이 늦어지면 AI 제품의 **대화** 페이지에 그렇게 표시됩니다. 오래된 데이터로 답하는 앱은 자체 트레이스에서는 아무 문제도 보이지 않기 때문입니다.

이 기능들은 모두 프로젝트에서 OneUptime AI가 켜져 있어야 하며, 묻는 사람의 권한으로 동작합니다.

## AI 에이전트와 MCP 서버

AI 에이전트는 데이터를 쓰기 전에 그 데이터가 최신인지, 테이블을 바꾸기 전에 그 테이블로 무엇이 만들어지는지 확인해야 합니다. [MCP 서버](/docs/ai/mcp-server)에는 이를 위한 읽기 전용 도구가 있습니다.

| 도구 | 답하는 내용 |
| --- | --- |
| `get_data_table_freshness` | 감시 중인 테이블이 최신인지, 마지막으로 바뀐 시점, 열린 경고, 테이블에 쓰는 주체의 최신 실행, 그리고 데이터 제품. `table` 은 `schema.table`, 테이블 이름만, 또는 테이블 ID로 지정합니다 |
| `get_data_table_lineage` | 감시 중인 테이블이 무엇으로 만들어지고 그 테이블로 무엇이 만들어지는지, 방향마다 3단계 또는 최대 5단계. 문제가 있는 테이블을 가까운 순서로 먼저, 그다음 나머지, 바깥에서 원본을 적재하는 파이프라인, 그 위에 만든 BI 대시보드. `table` 은 최신성과 같은 방식으로, `depth` 는 1에서 5로 지정합니다 |

두 도구 모두 읽기 전용 로그인으로 작동하며, 로그인한 사람 또는 API 키로서 답합니다.

## 엔드포인트

| 엔드포인트 | 용도 | 서명 수단 |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | Airflow, Dagster, Spark, dbt 또는 Flink의 OpenLineage 이벤트 | 텔레메트리 수집 키 |
| `POST /telemetry/dbt/v1/artifacts` | dbt 빌드의 `manifest` 와 `run_results` | 텔레메트리 수집 키 |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetran의 동기화 웹훅 | Fivetran의 서명 시크릿으로 쓰는 수집 키 |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbyte의 동기화 웹훅 | URL에 담긴 수집 키 |
| `POST /api/data-observability/tables/freshness` | MCP 도구가 답하는 것과 같은 테이블의 최신성. `{ "table": "public.orders" }` 로 요청합니다 | API 키 |
| `POST /api/data-observability/tables/lineage` | 테이블의 계보를 방향마다 몇 단계씩, 각 테이블의 지금 상태와 함께 돌려줍니다. **계보** 탭이 그리는 것과 같습니다. `{ "dataAssetId": "<table ID>", "depth": 3 }` 로 요청합니다. `"withColumns": true` 를 더하면 각 화살표가 전달하는 열도 돌려줍니다 | API 키 |
| `POST /api/data-observability/tables/lineage/answer` | MCP 도구가 답하는 것과 같은, 말로 풀어 쓴 테이블의 계보. 문제가 있는 테이블이 먼저입니다. `{ "table": "public.orders", "depth": 3 }` 로 요청합니다 | API 키 |
| `POST /api/data-observability/pipelines/lineage` | 파이프라인이 읽는 테이블과 쓰는 테이블을 각 테이블의 지금 상태와 함께 돌려줍니다. 파이프라인 페이지가 그리는 것과 같습니다. `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` 로 요청합니다 | API 키 |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | 데이터 경고의 계보를, 그 경고를 일으킨 경고와 그 경고가 일으킨 경고로 가는 경로와 함께 돌려줍니다. 경고 페이지가 그리는 것과 같습니다. 열 하나에 대한 검사에서 생긴 경고라면 그 `column` 과 각 화살표가 전달하는 열도 돌려줍니다 | API 키 |
| `POST /api/data-observability/lineage/expand` | 계보 다이어그램의 카드가 그리지 않은 다음 테이블을, 그 개수를 선택했을 때처럼 돌려줍니다. 카드는 `nodeId` 와 그 `side` 로, 그려진 것은 `focusNodeId`, `tables`, `dataDashboardIds` 로 보냅니다 | API 키 |
| `POST /api/data-observability/checks/apply` | `oneuptime data-checks apply` 처럼 프로젝트의 검사를 파일과 일치시킵니다. `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` 로 요청합니다 | API 키 |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | 데이터 제품의 "data as of" 배지 | 배지 자체의 토큰 |

테이블, 검사, 대사, 파이프라인, 데이터 제품, BI 연결, 웨어하우스 작업은 [API](/docs/api-reference/api-reference)의 평범한 리소스이기도 하며, 해당 권한이 있는 API 키로 읽고 변경할 수 있고, MCP 서버와 워크플로에서도 쓸 수 있습니다.

## 메트릭

데이터 옵저버빌리티가 보관하는 모든 숫자는 차트로 그리고, 대시보드에 올리고, 경고를 걸 수 있는 메트릭입니다. 각 테이블의 `oneuptime.data.table.*`, 각 검사의 `oneuptime.data.check.value`, 각 대사의 `oneuptime.data.reconciliation.*`, 각 파이프라인의 `oneuptime.data.pipeline.*`, 각 데이터 제품의 `oneuptime.data.product.*` 입니다. 이 메트릭은 OneUptime 자체의 운영 데이터이며, 텔레메트리로 과금되지 않습니다.

## 다음 단계

:::cards
- [MCP 서버](/docs/ai/mcp-server): AI 에이전트를 OneUptime에 연결합니다.
- [데이터 옵저버빌리티](/docs/data-observability/index): 개요로 돌아갑니다.
:::
