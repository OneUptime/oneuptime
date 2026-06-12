# OneUptime 업그레이드

이 가이드는 자체 호스팅 OneUptime 설치를 안전하게 업그레이드하는 방법을 다룹니다.

## 일반 지침

- 주요 버전 간에는 단계적으로 업그레이드합니다 (예: 6 → 7 → 8). 주요 버전을 건너뛰지 마십시오.
- 릴리스 노트를 따르는 한 부 버전/패치 버전은 건너뛸 수 있습니다 (예: 8.1 → 8.4).
- 업그레이드 전에 항상 백업을 수행하고 복원할 수 있는지 확인합니다.

## OneUptime 10 → 11 업그레이드

OneUptime 11은 ClickHouse 텔레메트리 스토리지를 새로 구축합니다. 이 페이지에서는
무엇이 변경되는지, 누가 조치해야 하는지, 그리고 과거 텔레메트리를
계속 사용하려는 설치 환경을 위해 필요한 모든 쿼리를 설명합니다.

### v11에서 변경되는 사항

텔레메트리(로그, 트레이스, 메트릭, 예외, 프로필, 모니터 로그,
감사 로그)가 시간 기반 파티셔닝, 컬럼별 압축 코덱, 새로운 엔티티 모델
컬럼을 갖춘 새 ClickHouse 테이블로 이동합니다:

| 기존 테이블           | 새 테이블             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

모든 텔레메트리 테이블에서 두 개의 컬럼 이름이 변경됩니다: `serviceId` →
`primaryEntityId`, `serviceType` → `primaryEntityType`. 이는 되돌릴 수 없는
이름 변경입니다 — **OneUptime 분석 API를 `serviceId`/`serviceType` 필터로
직접 쿼리하는 경우, 새 이름으로 업데이트해야 합니다.**
OneUptime 내부의 대시보드, 모니터, 알림은 자동으로
마이그레이션됩니다.

이번 전환은 **앞으로만(forward-only)** 진행됩니다: 새 테이블은 비어 있는
상태로 시작하고, 업그레이드 이후 수집되는 모든 텔레메트리는 즉시 새 테이블에
저장되며, 시간이 지남에 따라 이력이 자연스럽게 채워집니다. 기존 테이블은
디스크 공간 회수를 위해 업그레이드 중에 **자동으로 삭제됩니다** — 이력을
이전할 가능성을 남겨 두려면 업그레이드 **전에** 테이블 이름을 변경하십시오
(아래 0단계).

> **이미 11.0.0 또는 11.0.1을 사용 중이신가요?** 해당 릴리스는 기존
> 테이블을 유지했습니다(TTL에 따라 비워졌고, 복사는 “업그레이드 후
> 언제든지” 실행할 수 있었습니다). 이후의 모든 업데이트는 **부팅 시 기존
> 테이블을 삭제합니다**. 이력 복사를 아직 하지 않았고 여전히 원한다면,
> 업데이트를 적용하기 전에 아래 0단계를 실행하십시오.

### 조치가 필요한 대상

- **신규 설치:** 할 일이 없습니다.
- **업그레이드 이전 텔레메트리를 UI에서 볼 필요가 없는 경우:** 할 일이
  없습니다. 텔레메트리 페이지에는 업그레이드 시점 이후의 데이터만 표시되며,
  기존 테이블은 업그레이드 중에 삭제됩니다.
- **업그레이드 이전 텔레메트리를 계속 보고 싶은 경우:** 업그레이드 **전에**
  기존 테이블의 이름을 변경한 다음(아래 0단계), 업그레이드 후 언제든지
  수동 복사를 실행합니다.

항상 그렇듯이: 주요 버전은 단계적으로 업그레이드하고(10 → 11, 건너뛰지
마십시오), 업그레이드 전에 Postgres와 ClickHouse를 백업합니다.

### 선택 사항: 텔레메트리 이력 이전

0단계는 **업그레이드 전에** 실행하고, 1단계부터는 모두 **업그레이드가
완전히 기동된 후**에 실행합니다(새 테이블과 해당 materialized view가
존재해야 합니다). ClickHouse 호스트에서 직접 연결하십시오 — 네이티브
프로토콜에는 HTTP 타임아웃이 없으므로 몇 시간이 걸리는 문(statement)도
문제없이 실행됩니다:

```bash
clickhouse-client --database oneuptime
```

시작하기 전에 알아두면 좋은 사항:

- 복사는 OneUptime이 운영 중인 상태에서 실행해도 안전합니다. 새 텔레메트리는
  독립적으로 새 테이블에 기록되며, 복사된 이력은 그 뒤에 채워집니다.
- 대규모 환경(수백 GB)에서는 몇 시간이 걸릴 수 있습니다.
- 아래의 모든 문에는 `insert_deduplication_token`이 포함되어 있고, 새
  테이블에는 중복 제거 윈도우가 기본 적용되어 있으므로 — **도중에 실패한
  문을 다시 실행해도 안전합니다**(메트릭 롤업을 포함하여 이미 삽입된
  블록은 건너뜁니다). 단, 합리적인 시간 내에 다시 실행해야 합니다. 라이브
  수집량이 많으면 윈도우(테이블당 최근 10,000개의 삽입 블록)에서 오래된
  토큰이 결국 제거됩니다.
- 메트릭을 복사하면 사전 집계된 대시보드 롤업도 자동으로 재구축됩니다
  (복사된 각 행이 롤업 materialized view에 다시 공급됨) — 이 때문에 메트릭
  복사는 다른 복사보다 느리므로 마지막에 실행하십시오.

#### 1단계 — 소스 파티션 나열

각 기존 테이블에는 최대 16개의 파티션이 있습니다. 각 소스 테이블에 대해 다음을 실행합니다:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### 2단계 — 복사 문 생성

설치 환경에 따라 컬럼 구성이 약간 다를 수 있으므로(오래된 배포에는
최근에 추가된 컬럼이 없을 수 있음), 고정된 문을 복사해 붙여넣는 대신
실제 운영 중인 스키마에서 문을 생성하십시오. `WITH` 절의 `src`와 `dst`를
위 표의 테이블 쌍 중 하나로 설정하고 실행합니다:

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

생성된 문은 두 테이블이 공유하는 컬럼만 복사하고(새 컬럼은 기본값을
사용), `serviceId`/`serviceType`을 즉석에서 이름 변경하며, 재시도 시
동일하고 중복 제거 가능한 블록이 만들어지도록 행을 결정적으로 정렬하고,
이 규모의 문에 필요한 실행 시간 및 파티션 수 제한을 해제합니다.

#### 3단계 — 파티션별로 하나씩 실행

생성된 문에서 `{PARTITION}`(두 곳에 나타납니다 — `WHERE` 절과 토큰)을
1단계에서 확인한 각 파티션 ID로 치환합니다. 문을 한 번에 하나씩 실행한
다음, 각 테이블 쌍에 대해 1–3단계를 반복합니다.

문이 도중에 실패하면 **동일한** 문을 곧바로 다시 실행하십시오 — 이미
커밋된 블록은 중복 제거됩니다. 한참 후에 다시 실행하는 경우에는 먼저
행 수를 비교하십시오(5단계).

#### 4단계(선택 사항) — 호스트별 메트릭 롤업 이력

복사된 원시 메트릭 행은 서비스 수준 롤업을 자동으로 재구축하지만,
**호스트별** 롤업은 재구축하지 않습니다(기존 행에는 호스트 엔티티 키가
없음). 업그레이드는 의도적으로 기존 호스트별 롤업 테이블을 그대로
유지하므로, 호스트 이름에서 새 키를 계산하여 이력을 이전할 수 있습니다:

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

#### 5단계 — 검증

테이블 쌍별로 합계를 비교합니다(새 테이블에는 업그레이드 이후의 행도
포함되므로 기존 테이블보다 크거나 같아야 합니다):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### 6단계(선택 사항) — 디스크 공간 조기 회수

기존 테이블은 TTL에 따라 자체적으로 비워지지만, 복사 결과에 만족했다면
즉시 삭제할 수 있습니다:

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

> 팁: 모든 주요 업그레이드와 마찬가지로 먼저 스테이징 환경에서 테스트하고,
> 프로덕션에서 복사 결과에 의존하기 전에 텔레메트리가 새 테이블로
> 유입되는지 확인하십시오.



## OneUptime 9 → 10 업그레이드

수동 조치가 필요한 변경 사항은 없습니다. 표준 업그레이드 절차를 따르기만 하면 됩니다.

## OneUptime 8 → 9 업그레이드

Helm 차트는 더 이상 Kubernetes Ingress 리소스를 프로비저닝하지 않습니다. OneUptime은 이미 TLS를 종료하고 플랫폼의 상태 페이지 도메인을 관리하며 트래픽을 라우팅하는 ingress gateway 컨테이너를 제공하므로 클러스터 ingress 컨트롤러가 더 이상 필요하지 않습니다.

- 업그레이드하기 전에 커스텀 `values.yaml` 파일에서 `oneuptimeIngress` 재정의를 제거합니다. 해당 키는 이제 무시되며 그대로 두면 유효성 검사 오류가 발생합니다.
- `nginx.service.type`이 번들된 ingress gateway를 노출하는 방법을 반영하는지 확인합니다 (예: `LoadBalancer`, `NodePort` 또는 외부 로드 밸런서가 있는 `ClusterIP`).
- 상태 페이지 또는 기본 호스트의 DNS 레코드가 OneUptime ingress gateway 앞에 있는 서비스 또는 로드 밸런서를 여전히 가리키는지 확인합니다.
- 업그레이드 후 TLS 인증서가 임베디드 게이트웨이를 통해 계속 갱신되고 상태 페이지 도메인이 올바르게 확인되는지 확인합니다.


## OneUptime 7 → 8 업그레이드

Kubernetes에서 실행하는 경우 중요한 변경 사항이 있습니다:

- [Bitnami 라이선스 변경](https://github.com/bitnami/charts/issues/35164)으로 인해 더 이상 Postgres, Redis 및 ClickHouse에 Bitnami 차트를 사용하지 않습니다
- 이러한 변경 사항은 이전 버전과 호환되지 않습니다. Helm 차트 `values.yaml`의 새 구조를 따라야 합니다.
- 업그레이드 전에 데이터를 백업합니다 (Postgres, ClickHouse 및 영구 볼륨).


> 팁: 먼저 스테이징 환경에서 업그레이드를 테스트합니다. 프로덕션을 업그레이드하기 전에 워크로드가 정상이고 데이터가 온전한지 확인합니다.
