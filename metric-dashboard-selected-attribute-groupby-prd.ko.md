# Metric Dashboard Selected Attribute GroupBy PRD

## 1. 문제 정의

OneUptime metric dashboard에서 `groupByAttributeKeys`를 사용하면 사용자가 선택한 attribute key만 group by 되는 것이 아니라 `attributes` 전체 `Map(String, String)`이 group by 된다.

예를 들어 사용자가 다음처럼 cluster 하나만 선택해도:

```json
{
  "groupByAttributeKeys": ["resource.k8s.cluster.name"]
}
```

기존 aggregate 요청은 서버에 다음처럼 전달된다.

```json
{
  "groupBy": { "attributes": true }
}
```

그 결과 ClickHouse는 다음과 같은 형태로 집계한다.

```sql
GROUP BY time_bucket, attributes
```

Istio, Cilium, Kubernetes metric은 한 row에 수십 개 attribute를 가진다. 전체 attributes map으로 group by 하면 series 수가 폭발하고, aggregate API의 고정 `LIMIT 10000`이 최신 row만 반환한다. 이 때문에 사용자가 6시간/24시간 range를 선택해도 차트의 과거 구간이 비어 보인다.

## 2. 목표

사용자가 dashboard chart에서 attribute group by를 설정했을 때, OneUptime은 선택된 attribute key만 group by 해야 한다.

예:

```json
{
  "groupByAttributeKeys": ["destination_service", "response_code"]
}
```

은 ClickHouse에서 다음 의미로 실행되어야 한다.

```sql
GROUP BY time_bucket,
         attributes['destination_service'],
         attributes['response_code']
```

전체 `attributes` map group by는 dashboard metric chart 경로에서 사용하지 않는다.

## 3. 사용자 가치

- Istio/Cilium/Kubernetes dashboard에서 긴 time range를 조회해도 과거 bucket이 잘리지 않는다.
- cluster, namespace, destination service, response code 같은 label별 series chart를 안정적으로 볼 수 있다.
- 기존 OneUptime dashboard UX를 유지하면서 Grafana/Datadog에 가까운 label group by 동작을 제공한다.

## 4. 기능 요구사항

### FR-1. Dashboard query serialization

Dashboard metric chart는 `groupByAttributeKeys`가 있을 때 `groupBy: { attributes: true }`를 주입하지 않아야 한다.

대신 aggregate request에 다음 필드를 그대로 전달한다.

```ts
groupByAttributeKeys?: string[]
```

### FR-2. Aggregate API contract

`AggregateBy<T>`는 selected attribute grouping을 표현할 수 있어야 한다.

```ts
groupByAttributeKeys?: Array<string> | undefined;
```

이 필드는 `Metric.attributes` map 안의 key 이름 목록이다.

### FR-3. Server-side selected attribute grouping

`MetricService.toAggregateStatement()`는 `groupByAttributeKeys`가 존재하면 generic aggregate path 대신 selected attribute aggregate path를 사용한다.

지원해야 하는 aggregation:

- `Avg`
- `Sum`
- `Count`
- `Min`
- `Max`
- `P50`
- `P90`
- `P95`
- `P99`

### FR-4. Histogram percentile 유지

Percentile aggregation은 기존 histogram-aware percentile semantics를 유지해야 한다.

- Histogram은 bucket midpoint + bucket count 기반으로 percentile 계산.
- ExponentialHistogram은 positive buckets 기반으로 percentile 계산.
- Summary는 matching quantile value 기반으로 계산.
- Gauge/Sum fallback은 scalar value 기반으로 계산.

### FR-5. Response shape 호환성

기존 chart renderer는 aggregated row의 `attributes` map을 사용해 series label을 만든다.

따라서 selected attribute aggregate path는 결과 row에 compact attributes map을 반환해야 한다.

예:

```json
{
  "timestamp": "2026-06-23T09:00:00.000Z",
  "value": 175,
  "attributes": {
    "resource.k8s.cluster.name": "internal-seoul-eks"
  }
}
```

### FR-6. Legacy groupBy 호환성

`groupByAttributeKeys`와 legacy `groupBy: { attributes: true }`가 동시에 들어오면, selected attribute grouping이 우선한다.

단, `groupBy`에 `attributes` 외 다른 top-level column이 들어오면 selected attribute path는 사용하지 않고 기존 generic path로 fallback한다.

## 5. 비기능 요구사항

### NFR-1. 기간 보존

Selected attribute group by query는 고정 `LIMIT`이 time bucket을 최신 구간만 남기도록 만들면 안 된다. 이번 단계에서는 full attributes map group by 제거로 row 폭발을 줄인다.

후속 단계에서 다음을 추가한다.

- `maxPointsPerSeries = 1500`
- automatic rollup interval
- optional top series cap

### NFR-2. 기존 no-group chart 성능 유지

`groupByAttributeKeys`가 없는 chart는 기존 MV fast path를 계속 사용할 수 있어야 한다.

- `MetricItemAggMV1m`
- `MetricItemAggMV1mByHostV2`

### NFR-3. 안전한 ClickHouse SQL

Attribute key는 SQL literal로 직접 붙이지 않고 parameter binding을 사용한다.

```sql
attributes[{p0:String}]
```

### NFR-4. 브라우저 호환성

Chart renderer와 formula evaluator의 response shape를 깨지 않는다.

## 6. 비목표

이번 작업에는 포함하지 않는다.

- 새 ClickHouse rollup table/materialized view 생성.
- 모든 tag 조합 pre-aggregation.
- Datadog식 top series ranking.
- automatic bucket interval planner.
- dashboard UI에 max series 설정 추가.
- PromQL 호환 query language 추가.

## 7. 수용 기준

### AC-1. Hidden full attributes group by 제거

Dashboard chart에서 `groupByAttributeKeys`가 설정되어도 aggregate request에 `groupBy: { attributes: true }`가 자동 주입되지 않아야 한다.

### AC-2. 선택 key만 group by

다음 설정:

```json
{
  "groupByAttributeKeys": ["resource.k8s.cluster.name"]
}
```

은 ClickHouse에서 실질적으로 다음 group by가 되어야 한다.

```sql
GROUP BY time_bucket, attributes['resource.k8s.cluster.name']
```

### AC-3. 결과 attributes map 유지

Aggregate response row에는 선택된 key만 담긴 `attributes` map이 있어야 한다.

### AC-4. Istio latency chart 개선

`istio_request_duration_milliseconds`를 cluster로 group by 한 chart에서 최근 6시간 조회 시 최신 40~50분만 보이고 과거가 비는 문제가 없어야 한다.

### AC-5. Percentile chart 동작

`P95`/`P99` aggregation을 사용하는 histogram metric도 selected attribute group by로 조회되어야 한다.

## 8. 검증 계획

### Static checks

- 변경 파일 ESLint 통과.
- TypeScript compile은 repo dependency 상태가 갖춰진 환경에서 통과해야 한다.

### SQL validation

Live ClickHouse에서 다음 형태를 검증한다.

Scalar:

```sql
SELECT avg(__metric_value), bucket, map('resource.k8s.cluster.name', __attr_0)
FROM (... attributes['resource.k8s.cluster.name'] AS __attr_0 ...)
GROUP BY bucket, __attr_0
```

Percentile:

```sql
SELECT quantileExactWeighted(0.95)(...), bucket, map('resource.k8s.cluster.name', __attr_0)
FROM (... arrayJoin(histogram fanout) ...)
GROUP BY bucket, __attr_0
```

### Runtime validation

- Dashboard: `Istio & Cilium`
- Metric: `istio_request_duration_milliseconds`
- Range: 6h 이상
- Group by: `resource.k8s.cluster.name` 또는 `oneuptime.kubernetes.cluster.name`
- Expected: 전체 기간에 data point가 표시되고, series label은 선택한 cluster value로 나뉜다.

## 9. 후속 개선

1. Histogram bucket rollup table
   - 현재 percentile/histogram selected attribute query는 raw `MetricItemV3`를 사용한다.
   - 별도 bucket-state rollup table 없이는 정확한 percentile을 pre-aggregate할 수 없다.

2. `Other` series
   - top series 밖의 나머지 series를 합산해서 표시하는 선택 기능.


## 10. 현재 구현 범위

현재 구현은 two-step safe cut이다.

포함:

- selected attribute aggregate API contract
- dashboard query serialization 변경
- MetricService selected attribute SQL path
- compact attributes response mapping
- scalar selected-attribute 1-minute rollup table
  - `MetricItemAttributeAggMV1m`
  - materialized view: `MetricItemAttributeAggMV1m_mv`
  - allowlisted keys:
    - `oneuptime.kubernetes.cluster.name`
    - `resource.k8s.cluster.name`
    - `resource.k8s.namespace.name`
    - `destination_service`
    - `source_workload`
    - `response_code`
    - `http.response.status_code`
    - `http.request.method`
    - `request_protocol`

제외:

- histogram bucket rollup table
- `Other` series

구현됨:

- automatic rollup interval
  - <= 24h: minute
  - <= 60d: hour
  - <= 4y: day
  - <= 20y: week
  - <= 120y: month
- selected-attribute scalar top-series cap
  - top series max: 100
  - effective series cap is `min(100, floor(limit / bucketCount))`
