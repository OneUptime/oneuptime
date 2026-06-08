import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";

/*
 * Shared builder for the OpenTelemetry-entity membership columns added to
 * every signal table (Span / Log / Metric / ExceptionInstance / Profile /
 * ProfileSample). One source of truth so the column shape, index names and
 * codecs stay identical across tables — only the per-table access-control
 * permission set differs.
 *
 * The columns:
 *  - `entityKeys`  Array(String) — the universal membership superset; every
 *    entity key this signal belongs to (primary included). Bloom-indexed
 *    exactly like the proven `attributeKeys` column on `Span`. Cross-cutting
 *    reads use `has(entityKeys, :key)`.
 *  - scalar per-type keys (`serviceEntityKey`, `hostEntityKey`,
 *    `k8sPodEntityKey`, `k8sNodeEntityKey`, `k8sClusterEntityKey`,
 *    `containerEntityKey`) — the fast path for the hot, well-known types. A
 *    signal has at most one entity per type, so each is a single Nullable
 *    bloom-indexed String enabling point lookups, projections and per-type
 *    rollup MVs.
 *
 * All columns are NON-key and additive: adding them is a metadata-only
 * `ALTER TABLE ADD COLUMN` / `ADD INDEX`. `serviceId` and the sort/primary
 * key are unchanged. See Internal/Docs/OpenTelemetryEntities.md §3.
 */

export interface EntityMembershipColumnsOptions {
  accessControl: ColumnAccessControl;
}

const SCALAR_KEY_COLUMNS: Array<{
  key: string;
  title: string;
  indexName: string;
}> = [
  {
    key: "serviceEntityKey",
    title: "Service Entity Key",
    indexName: "idx_service_entity_key",
  },
  {
    key: "hostEntityKey",
    title: "Host Entity Key",
    indexName: "idx_host_entity_key",
  },
  {
    key: "k8sPodEntityKey",
    title: "Kubernetes Pod Entity Key",
    indexName: "idx_k8s_pod_entity_key",
  },
  {
    key: "k8sNodeEntityKey",
    title: "Kubernetes Node Entity Key",
    indexName: "idx_k8s_node_entity_key",
  },
  {
    key: "k8sClusterEntityKey",
    title: "Kubernetes Cluster Entity Key",
    indexName: "idx_k8s_cluster_entity_key",
  },
  {
    key: "containerEntityKey",
    title: "Container Entity Key",
    indexName: "idx_container_entity_key",
  },
];

/*
 * Logical column keys produced here, in the order they are appended to a
 * table. Reused by the ingest stamping and the ADD COLUMN migration so the
 * three stay in lockstep.
 */
export const ENTITY_KEYS_COLUMN: string = "entityKeys";
export const SCALAR_ENTITY_KEY_COLUMNS: Array<string> = SCALAR_KEY_COLUMNS.map(
  (c: { key: string }) => {
    return c.key;
  },
);
export const ALL_ENTITY_MEMBERSHIP_COLUMNS: Array<string> = [
  ENTITY_KEYS_COLUMN,
  ...SCALAR_ENTITY_KEY_COLUMNS,
];

export function getEntityMembershipColumns(
  options: EntityMembershipColumnsOptions,
): Array<AnalyticsTableColumn> {
  const columns: Array<AnalyticsTableColumn> = [];

  /*
   * Universal membership array — superset of every entity this signal
   * belongs to. Same shape as the existing `attributeKeys` column.
   */
  columns.push(
    new AnalyticsTableColumn({
      key: ENTITY_KEYS_COLUMN,
      title: "Entity Keys",
      description:
        "Every OpenTelemetry-entity key this signal belongs to (service, host, k8s.pod, k8s.node, k8s.cluster, container, …). Superset that always includes the primary entity's key. Queried with has(entityKeys, :key).",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      skipIndex: {
        name: "idx_entity_keys",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: options.accessControl,
    }),
  );

  // Scalar fast-path keys for the hot, well-known entity types.
  for (const scalar of SCALAR_KEY_COLUMNS) {
    columns.push(
      new AnalyticsTableColumn({
        key: scalar.key,
        title: scalar.title,
        description:
          "Stable entity key of this signal's " +
          scalar.title.replace(" Entity Key", "") +
          " entity, if any. Fast-path scalar for point lookups, projections and per-type rollup MVs. Null when the signal has no entity of this type.",
        required: false,
        type: TableColumnType.Text,
        codec: { codec: "ZSTD", level: 1 },
        skipIndex: {
          name: scalar.indexName,
          type: SkipIndexType.BloomFilter,
          params: [0.01],
          granularity: 1,
        },
        accessControl: options.accessControl,
      }),
    );
  }

  return columns;
}
