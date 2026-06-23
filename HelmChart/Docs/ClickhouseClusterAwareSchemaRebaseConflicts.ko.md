# `feature/clickhouse-cluster-aware-schema` rebase conflict resolution

브랜치 `feat/telemetry-cold-tier-sharding`를 `origin/feature/clickhouse-cluster-aware-schema` 위로 rebase하면서 해결한 충돌과 판단 근거입니다.

## 기준 원칙

- `origin/feature/clickhouse-cluster-aware-schema`의 cluster-aware analytics schema 동작을 기준으로 유지했습니다.
- operator-managed ClickHouse에서는 앱-facing table이 `Distributed`이고 실제 저장/DDL/mutation 대상은 local storage table이어야 합니다.
- cold-tier 작업에서 추가한 `storage_policy` 렌더링은 보존했습니다.
- cluster mode에서 `non_replicated_deduplication_window`는 `replicated_deduplication_window`로 변환되어야 합니다.
- CHI cluster name과 앱의 `CLICKHOUSE_CLUSTER_NAME`은 반드시 동일해야 합니다.

## 1. `StatementGenerator.ts` table `SETTINGS`

### 충돌

- cluster-aware schema 쪽은 table settings를 local/replicated storage engine에 맞게 변환했습니다.
- cold-tier 쪽은 `storage_policy = '<policy>'`를 table `SETTINGS`에 먼저 넣었습니다.

### 해결

둘 다 유지했습니다.

```ts
const tableSettings: Array<string> = [];
if (this.model.storagePolicy) {
  tableSettings.push(`storage_policy = '${this.model.storagePolicy}'`);
}
const adaptedTableSettings = adaptTableSettingsForStorage(this.model.tableSettings);
if (adaptedTableSettings) {
  tableSettings.push(adaptedTableSettings);
}
```

### 이유

- `storage_policy`는 cold-tier TTL move가 동작하기 위한 필수 설정입니다.
- cluster mode에서는 local table이 `ReplicatedMergeTree`/`ReplicatedAggregatingMergeTree`이므로 `non_replicated_deduplication_window`를 그대로 두면 잘못된 setting입니다.
- 따라서 `storage_policy`와 replicated setting 변환을 모두 적용해야 합니다.

## 2. `StatementGenerator.ts` DDL/mutation target

### 충돌

일부 commit은 model helper 기반 이름을 사용했습니다.

```ts
this.model.getSchemaTableName()
this.model.getMutationTableName()
this.getOnClusterClause()
```

cluster-aware schema 쪽은 centralized helper를 사용했습니다.

```ts
getStorageTableName(this.model.tableName)
onClusterClause()
getStorageEngine(this.model.tableEngine)
```

### 해결

DDL/mutation은 `getStorageTableName(...)` + `onClusterClause()` 기준으로 맞췄습니다.

대상:

- `ALTER TABLE ... UPDATE`
- `ALTER TABLE ... ADD COLUMN`
- `ALTER TABLE ... DROP COLUMN`
- `ALTER TABLE ... ADD/DROP INDEX`
- `ALTER TABLE ... RENAME COLUMN`
- `CREATE TABLE ...`

### 이유

- cluster mode에서 `Distributed` table은 데이터를 저장하지 않습니다.
- schema drift reconciliation, codec 변경, skip index 변경, mutation은 physical local storage table에 적용되어야 합니다.
- `onClusterClause()`는 raw SQL로 append해야 합니다. SQL template interpolation에 넣으면 `ON CLUSTER '<name>'` 전체가 identifier parameter처럼 처리될 수 있습니다.

## 3. `AnalyticsDatabaseService.ts` schema inspection / codec mutation

### 충돌

- 한쪽은 `this.model.getSchemaTableName()`을 조회했습니다.
- 다른 쪽은 `getStorageTableName(this.model.tableName)`을 조회했습니다.

### 해결

`system.columns` 조회와 codec mutation 모두 storage table 기준으로 맞췄습니다.

대상:

- `doesColumnExist`
- `getColumnCodec`
- `getColumnDatabaseType`
- `setColumnCodecIfNotSet`

### 이유

- `Distributed` wrapper의 column metadata만 보고 local table drift를 판단하면 실제 저장 테이블의 missing column/index/codec을 놓칠 수 있습니다.
- schema sync의 목적은 physical storage table을 self-heal하는 것입니다.

## 4. `AnalyticsDatabaseService.ts` delete statement

### 충돌

- single-node path는 lightweight `DELETE FROM <table>`을 유지하려 했습니다.
- cluster path는 local table에 `ALTER TABLE ... ON CLUSTER DELETE`를 적용해야 했습니다.

### 해결

분기 유지:

- single-node: `DELETE FROM <logical-table> WHERE ...`
- cluster mode: `ALTER TABLE <local-table> ON CLUSTER ... DELETE WHERE ...`

### 이유

- ClickHouse `DELETE FROM`은 `Distributed` table + `ON CLUSTER` 조합에 적합하지 않습니다.
- cluster mode에서는 각 shard의 local replicated table에 mutation을 dispatch해야 합니다.
- retention은 TTL이 주경로라 delete mutation 빈도는 낮다고 봤습니다.

## 5. `TableManegement.ts` schema reconciliation target

### 충돌

- 한쪽은 `service.model.getSchemaTableName()`을 사용했습니다.
- cluster-aware schema 쪽은 `getStorageTableName(service.model.tableName)`을 사용했습니다.

### 해결

existing column/index/projection inspection과 projection DDL target을 storage table 기준으로 맞췄습니다.

### 이유

- boot-time schema reconciliation은 실제 data table에 column/index/projection을 맞춰야 합니다.
- app-facing `Distributed` table은 wrapper이고, local table과 분리해서 drift를 판단하면 잘못된 no-op이 될 수 있습니다.

## 6. `clickhouse-altinity-chi.yaml` cluster name

### 충돌

- 한쪽은 CHI cluster name을 `.Values.clickhouseOperator.altinity.cluster.name`에서 직접 읽었습니다.
- 다른 쪽은 `oneuptime.clickhouse.clusterName` helper를 사용했습니다.

### 해결

CHI cluster name은 operator values 기준을 유지했습니다.

```yaml
- name: {{ $altinity.cluster.name | default "oneuptime" }}
```

### 이유

- cluster-aware README와 runtime env contract는 `CLICKHOUSE_CLUSTER_NAME`이 `clickhouseOperator.altinity.cluster.name`과 일치해야 한다고 명시합니다.
- CHI resource의 cluster name은 Altinity operator values가 source of truth입니다.
- sharding helper 기반 이름과 operator cluster name이 diverge하면 app DDL의 `ON CLUSTER '<name>'`이 CHI cluster와 맞지 않아 schema sync가 실패할 수 있습니다.

## 검증 상태

Rebase는 완료됐고 working tree는 clean입니다.

추가로 실행해야 할 권장 검증:

- `npx eslint` on touched files
- `cd Common && npx tsc --noEmit --pretty false`
- 관련 Jest suites
- Helm template for operator path

