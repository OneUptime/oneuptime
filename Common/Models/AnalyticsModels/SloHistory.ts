import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

/**
 * Time-bucketed history of computed SLO / Error Budget numbers, written
 * by the SLO evaluation worker and read by dashboard charts through this
 * model's auto-generated `/aggregate` endpoint.
 *
 * Why a dedicated table (and NOT MetricItemV3): MetricItemV3 partitions
 * by `toYYYYMMDD(time)` with `ttl_only_drop_parts = 1`, so a single
 * 400-day SLO row per day would pin every daily raw-telemetry partition
 * for 400 days. This table owns its retention (monthly partitions,
 * `bucketStart + INTERVAL 400 DAY` TTL) so history rows never interfere
 * with telemetry retention — and SLO rows stay out of telemetry usage
 * billing entirely.
 *
 * History is POINT-IN-TIME: the evaluator writes exactly one
 * minute-floored bucket per series per run, once, holding the numbers as
 * computed at that moment. Retroactive edits to the underlying
 * MonitorStatusTimeline are NOT restated into already-written buckets —
 * the SLO overview page recomputes its current numbers from Postgres and
 * so self-heals, while these rows remain a record of what was reported
 * at the time. (Possible future work: restate a trailing window of
 * buckets on every run so retroactive edits propagate into charts; the
 * version column below already supports it, but nothing writes such
 * rewrites today.)
 *
 * Why ReplacingMergeTree + `version` (MutableMetric precedent): writes
 * are at-least-once, so the same dedupe identity
 * (projectId, sloId, metricName, bucketStart) can rarely be written
 * twice — a retried job, or two runs landing in the same minute. Those
 * rows collapse to the highest `version` at merge time rather than
 * double-counting. Merges are asynchronous, so a naive reader can
 * transiently see both rows: read through `/aggregate` (its GROUP BY on
 * the bucketed timestamp collapses duplicates, which is what the
 * dashboard charts do) or dedupe explicitly via
 * `argMax(value, version) ... GROUP BY <identity>`.
 *
 * `metricName` values: "sli.percent", "error.budget.remaining.percent",
 * "burn.rate", "good.count", "total.count".
 */
export default class SloHistory extends AnalyticsBaseModel {
  public constructor() {
    const readPermissions: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ];

    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: {
        read: readPermissions,
        create: [],
        update: [],
      },
    });

    const sloIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "sloId",
      title: "SLO ID",
      description: "ID of the Service Level Objective this row belongs to.",
      required: true,
      type: TableColumnType.ObjectID,
      accessControl: {
        read: readPermissions,
        create: [],
        update: [],
      },
    });

    const metricNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "metricName",
      isLowCardinality: true,
      title: "Metric Name",
      description:
        "Which SLO series this row belongs to: sli.percent, error.budget.remaining.percent, burn.rate, good.count, or total.count.",
      required: true,
      type: TableColumnType.Text,
      accessControl: {
        read: readPermissions,
        create: [],
        update: [],
      },
    });

    const bucketStartColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "bucketStart",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Bucket Start",
      description:
        "Start of the time bucket this value was computed for. Also drives the monthly partition key and the 400-day TTL.",
      required: true,
      type: TableColumnType.Date,
      accessControl: {
        read: readPermissions,
        create: [],
        update: [],
      },
    });

    const valueColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "value",
      codec: [{ codec: "Gorilla" }, { codec: "ZSTD", level: 1 }],
      title: "Value",
      description: "Computed value for this SLO series at this bucket.",
      required: true,
      type: TableColumnType.Decimal,
      accessControl: {
        read: readPermissions,
        create: [],
        update: [],
      },
    });

    const versionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "version",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Version",
      description:
        "Monotonic write version (unix millis at write time) for ReplacingMergeTree dedupe and version-aware reads.",
      required: true,
      type: TableColumnType.UInt64,
      accessControl: {
        read: readPermissions,
        create: [],
        update: [],
      },
    });

    super({
      tableName: AnalyticsTableName.SloHistory,
      /*
       * ReplacingMergeTree resolves to Replicated*ReplacingMergeTree(version)
       * in ClusterConfig.getStorageEngine — the version column MUST be
       * named exactly `version` (same mechanism as MutableMetric).
       */
      tableEngine: AnalyticsTableEngine.ReplacingMergeTree,
      singularName: "SLO History",
      pluralName: "SLO History",
      crudApiPath: new Route("/slo-history"),
      tableDescription:
        "Historical SLI, error-budget, and burn-rate values per SLO, written by the SLO evaluation worker. Query via /aggregate for charts.",
      accessControl: {
        read: readPermissions,
        create: [],
        update: [],
        delete: [],
      },
      tableColumns: [
        projectIdColumn,
        sloIdColumn,
        metricNameColumn,
        bucketStartColumn,
        valueColumn,
        versionColumn,
      ],
      projections: [],
      sortKeys: ["projectId", "sloId", "metricName", "bucketStart"],
      primaryKeys: ["projectId", "sloId", "metricName", "bucketStart"],
      /*
       * Monthly partitions: volume is tiny (~1 row/min/SLO across 5
       * series) and every row in a partition shares its bucketStart
       * month, so the fixed-interval TTL below expires whole partitions
       * cleanly under ttl_only_drop_parts.
       */
      partitionKey: "toYYYYMM(bucketStart)",
      /*
       * Co-locate all of one SLO's series on a single shard so the
       * read-side argMax dedupe GROUP BY aggregates per-shard cleanly.
       */
      shardingKey: "cityHash64(projectId, sloId)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "bucketStart + INTERVAL 400 DAY",
      defaultSortColumn: "bucketStart",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get sloId(): ObjectID | undefined {
    return this.getColumnValue("sloId") as ObjectID | undefined;
  }

  public set sloId(v: ObjectID | undefined) {
    this.setColumnValue("sloId", v);
  }

  public get metricName(): string | undefined {
    return this.getColumnValue("metricName") as string | undefined;
  }

  public set metricName(v: string | undefined) {
    this.setColumnValue("metricName", v);
  }

  public get bucketStart(): Date | undefined {
    return this.getColumnValue("bucketStart") as Date | undefined;
  }

  public set bucketStart(v: Date | undefined) {
    this.setColumnValue("bucketStart", v);
  }

  public get value(): number | undefined {
    return this.getColumnValue("value") as number | undefined;
  }

  public set value(v: number | undefined) {
    this.setColumnValue("value", v);
  }

  public get version(): number | undefined {
    return this.getColumnValue("version") as number | undefined;
  }

  public set version(v: number | undefined) {
    this.setColumnValue("version", v);
  }
}
