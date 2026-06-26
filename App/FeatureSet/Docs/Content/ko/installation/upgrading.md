# OneUptime 업그레이드

이 가이드는 자체 호스팅 OneUptime 설치를 안전하게 업그레이드하는 방법을 다룹니다.

## 일반 지침

- 주요 버전 간에는 단계적으로 업그레이드합니다 (예: 6 → 7 → 8). 주요 버전을 건너뛰지 마십시오.
- 릴리스 노트를 따르는 한 부 버전/패치 버전은 건너뛸 수 있습니다 (예: 8.1 → 8.4).
- 업그레이드 전에 항상 백업을 수행하고 복원할 수 있는지 확인합니다.

## OneUptime 10 → 11 업그레이드

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

OneUptime 11은 ClickHouse 텔레메트리 스토리지를 새로 구축합니다. 이 페이지에서는 무엇이 바뀌는지, 누가 조치해야 하는지, 그리고 과거 텔레메트리를 이어가려는 설치 환경을 위해 필요한 모든 쿼리를 설명합니다.

### v11에서 바뀌는 것

텔레메트리(로그, 트레이스, 메트릭, 예외, 프로파일, 모니터 로그, 감사 로그)는 시간 기반 파티셔닝, 열별 압축 코덱, 새로운 엔티티 모델 열을 갖춘 새 ClickHouse 테이블로 이동합니다:

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

모든 텔레메트리 테이블에서 두 개의 열 이름이 변경됩니다: `serviceId` → `primaryEntityId`, `serviceType` → `primaryEntityType`. 이것은 엄격한 이름 변경입니다 — **OneUptime analytics API를 `serviceId`/`serviceType` 필터로 직접 쿼리하고 있다면 새 이름으로 업데이트하세요.** OneUptime 내부의 대시보드, 모니터, 알림은 자동으로 마이그레이션됩니다.

이 전환은 **전방 전용**입니다: 새 테이블은 비어 있는 상태로 시작하고, 업그레이드 이후 수집되는 모든 텔레메트리는 즉시 새 테이블에 들어가며, 이력은 시간이 지나면서 자연스럽게 채워집니다. 기존 테이블은 디스크 공간을 회수하기 위해 업그레이드 중에 **자동으로 삭제됩니다** — 이력을 이어갈 선택지를 남겨 두려면 업그레이드 **전에** 테이블 이름을 변경하세요(아래 Step 0).

> **이미 11.0.0 또는 11.0.1을 사용 중인가요?** 해당 릴리스에서는 기존 테이블이 유지되었습니다(TTL로 서서히 비워졌고, 복사는 "업그레이드 후 언제든지" 실행할 수 있었습니다). 이후의 모든 업데이트는 **시작 시 기존 테이블을 삭제합니다**. 이력 복사를 아직 하지 않았고 앞으로 하려 한다면, 업데이트를 적용하기 전에 아래 Step 0을 실행하세요.

### 누가 조치해야 하나

- **신규 설치:** 할 일이 없습니다.
- **업그레이드 이전 텔레메트리가 UI에 필요 없는 업그레이드:** 할 일이 없습니다. 텔레메트리 페이지는 업그레이드 시점 이후의 데이터만 표시하며, 기존 테이블은 업그레이드 중에 삭제됩니다.
- **업그레이드 이전 텔레메트리를 보고 싶은 업그레이드:** 업그레이드 **전에** 기존 테이블의 이름을 변경하고(아래 Step 0), 이후 언제든지 수동 복사를 실행하세요.

언제나처럼 메이저 버전은 단계별로 업그레이드하고(10 → 11, 건너뛰지 마세요), 업그레이드 전에 Postgres와 ClickHouse를 백업하세요.

### 선택 사항: 텔레메트리 이력 이어가기

Step 0은 **업그레이드 전에** 실행합니다. Step 1부터는 모두 **업그레이드가 완전히 부팅된 후에** 실행합니다(새 테이블과 해당 머티리얼라이즈드 뷰가 존재해야 합니다). ClickHouse 호스트에서 직접 접속하세요 — 네이티브 프로토콜에는 HTTP 타임아웃이 없으므로 몇 시간짜리 문장도 문제없습니다:

```bash
clickhouse-client --database oneuptime
```

시작하기 전에 알아 두면 좋은 것:

- 복사는 OneUptime이 운영 중인 상태에서도 안전하게 실행할 수 있습니다. 새 텔레메트리는 독립적으로 새 테이블에 기록되고, 복사된 이력은 그 뒤에서 채워집니다.
- 대규모(수백 GB)에서는 몇 시간이 걸릴 수 있습니다.
- 아래 모든 문장은 `insert_deduplication_token`을 가지며, 새 테이블에는 중복 제거 윈도우가 내장되어 있습니다 — 따라서 **중간에 실패한 문장을 다시 실행해도 안전합니다**(이미 삽입된 블록은 메트릭 롤업을 포함해 건너뜁니다). 단, 적당히 빨리 다시 실행해야 합니다. 라이브 수집이 많은 환경에서는 윈도우(테이블당 최근 10,000개의 insert 블록)가 결국 오래된 토큰을 밀어냅니다.
- 메트릭을 복사하면 사전 집계된 대시보드 롤업도 자동으로 재구축됩니다(복사된 각 행이 롤업 머티리얼라이즈드 뷰에 다시 공급됩니다) — 그래서 메트릭 복사는 다른 것보다 느립니다. 마지막에 실행하세요.

#### Step 0 — 업그레이드 전에 기존 테이블 이름 변경

업그레이드는 시작 시 기존 테이블을 삭제하므로, 복사 원본으로 쓸 테이블을 먼저 그 손이 닿지 않는 곳으로 옮기세요. OneUptime을 중지하고(디플로이먼트를 0으로 스케일) 아무것도 테이블에 쓰거나 다시 만들 수 없게 한 뒤 이름을 변경합니다 — `RENAME TABLE`은 즉각적인 메타데이터 작업이며, `IF EXISTS` 덕분에 설치 환경에 없던 테이블은 건너뜁니다(10.0.x 중반 이전의 디플로이먼트에는 `AuditLogV1`이나 일부 `…V2` 테이블이 없을 수 있습니다 — 그런 경우 복사할 해당 유형의 이력이 없는 것입니다):

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

그런 다음 업그레이드하고 계속하기 전에 OneUptime이 완전히 부팅될 때까지 기다리세요.

> 이름 변경 후 v10으로 롤백하는 경우(v10은 시작 시 기존 이름의 빈 테이블을 다시 만듭니다), v10을 재시작하기 전에 `_backup` 테이블을 원래 이름으로 되돌리세요 — 그러지 않으면 롤백 중에 수집된 텔레메트리가 다시 만들어진 테이블에 들어가고, 이후 업그레이드에서 삭제됩니다.

#### Step 1 — 원본 파티션 나열

각 기존 테이블의 파티션은 최대 16개입니다. 각 원본 테이블에 대해:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Step 2 — 복사 문장 생성

열 구성은 설치 환경마다 약간 다를 수 있으므로(오래된 디플로이먼트에는 최근 추가된 열이 없을 수 있음), 고정된 문장을 붙여 넣지 말고 실제 스키마에서 문장을 생성하세요. `WITH` 절의 `src`와 `dst`를 위 표의 테이블 쌍 중 하나로 설정하고(원본에는 Step 0의 `_backup` 접미사가 붙습니다) 실행합니다:

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

생성된 문장은 두 테이블이 공유하는 열만 복사하고(새 열은 기본값을 가짐), `serviceId`/`serviceType`을 즉석에서 이름 변경하며, 재실행 시 동일하고 중복 제거 가능한 블록이 생성되도록 행을 결정론적으로 정렬하고, 이 정도 규모의 문장에 필요한 실행 시간 및 파티션 수 제한을 해제합니다.

#### Step 3 — 한 번에 한 파티션씩 실행

생성된 문장에서 `{PARTITION}`(`WHERE`와 토큰에 두 번 등장)을 Step 1의 각 파티션 id로 치환하세요. 문장을 하나씩 실행한 뒤, 각 테이블 쌍에 대해 Step 1–3을 반복합니다.

> 참고: 원본 테이블이 설치 환경에 존재하지 않아 Step 0에서 건너뛰었다면, 해당 쌍의 Step 1은 `UNKNOWN_TABLE`로 실패합니다 — 그 쌍은 그냥 건너뛰세요. 복사할 해당 유형의 이력이 없습니다.

문장이 중간에 실패하면 **같은** 문장을 즉시 다시 실행하세요 — 이미 커밋된 블록은 중복 제거됩니다. 한참 후에 다시 실행한다면 먼저 행 수를 비교하세요(Step 5).

#### Step 4(선택) — 호스트별 메트릭 롤업 이력

복사된 원시 메트릭 행은 서비스 수준 롤업을 자동으로 재구축하지만, **호스트별** 롤업은 재구축하지 않습니다(기존 행에는 호스트 엔티티 키가 없음). Step 0에서 이름을 변경한 기존 롤업 테이블이 이 이력의 유일한 원본입니다. 호스트 이름에서 새 키를 계산해 이어가세요:

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

`ORDER BY`가 중요합니다: 재실행 시 중복 제거 토큰이 인식할 수 있는 동일한 insert 블록을 생성합니다. 이것이 없으면 재실행이 조용히 건너뛰어지거나 이중으로 집계될 수 있습니다. (예외 사례: `\`, `|`, `=`가 포함된 호스트 이름 — RFC 1123에서 허용되지 않는 호스트 이름 문자 — 은 애플리케이션과 다른 키를 계산합니다. 그런 호스트가 있다는 것을 알지 못하는 한 무시하세요.)

#### Step 5 — 검증

테이블 쌍별로 합계를 비교하세요(새 테이블에는 업그레이드 이후의 행도 포함되므로 기존 테이블보다 크거나 같아야 합니다):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Step 6 — 백업 삭제

이름이 변경된 테이블은 보존 TTL을 유지하므로 스스로 비워지고 줄어듭니다 — 그러나 복사 결과에 만족했다면 즉시 디스크를 회수하도록 삭제하세요:

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

(`max_table_size_to_drop = 0`은 해당 문장에 한해 서버의 50 GB 삭제 보호를 해제합니다.)

> 팁: 다른 모든 메이저 업그레이드와 마찬가지로, 먼저 스테이징 환경에서 테스트하고 프로덕션에서 복사본에 의존하기 전에 텔레메트리가 새 테이블로 흘러 들어가는지 확인하세요.

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
