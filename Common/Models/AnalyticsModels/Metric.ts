import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

export enum AggregationTemporality {
  Delta = "Delta",
  Cumulative = "Cumulative",
}

export enum MetricPointType {
  Sum = "Sum",
  Gauge = "Gauge",
  Histogram = "Histogram",
  ExponentialHistogram = "ExponentialHistogram",
  Summary = "Summary",
}

export enum ServiceType {
  OpenTelemetry = "OpenTelemetry",
  Monitor = "Monitor",
  Alert = "Alert",
  Incident = "Incident",
}

export default class Metric extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    // this can also be the monitor id or the telemetry service id.
    const serviceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "serviceId",
      title: "Service ID",
      description: "ID of the Service which created the Metric",
      required: true,
      type: TableColumnType.ObjectID,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    // this can also be the monitor id or the telemetry service id.
    const serviceTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "serviceType",
      title: "Service Type",
      description: "Type of the service that this telemetry belongs to",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_service_type",
        type: SkipIndexType.Set,
        params: [5],
        granularity: 4,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    // add name and description
    const nameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "name",
      title: "Name",
      description: "Name of the Metric",
      required: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_name",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const aggregationTemporalityColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "aggregationTemporality",
        title: "Aggregation Temporality",
        description: "Aggregation Temporality of this Metric",
        required: false,
        type: TableColumnType.Text,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    const metricPointTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "metricPointType",
        title: "Metric Point Type",
        description: "Metric Point Type of this Metric",
        required: false,
        type: TableColumnType.Text,
        skipIndex: {
          name: "idx_metric_point_type",
          type: SkipIndexType.Set,
          params: [5],
          granularity: 4,
        },
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    // this is end time.
    const timeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "time",
      title: "Time",
      description: "When did the Metric happen?",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const startTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "startTime",
      title: "Start Time",
      description: "When did the Metric happen?",
      required: false,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    // end time.
    const timeUnixNanoColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "timeUnixNano",
      title: "Time (in Unix Nano)",
      description: "When did the Metric happen?",
      required: true,
      type: TableColumnType.LongNumber,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const startTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "startTimeUnixNano",
        title: "Start Time (in Unix Nano)",
        description: "When did the Metric happen?",
        required: false,
        type: TableColumnType.LongNumber,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      title: "Attributes",
      description: "Attributes",
      required: true,
      type: TableColumnType.MapStringString,
      defaultValue: {},
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const attributeKeysColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributeKeys",
      title: "Attribute Keys",
      description: "Attribute keys extracted from attributes",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const isMonotonicColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "isMonotonic",
      title: "Is Monotonic",
      description: "Is Monotonic",
      required: false,
      type: TableColumnType.Boolean,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const countColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "count",
      title: "Count",
      description: "Count",
      required: false,
      type: TableColumnType.BigNumber,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const sumColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "sum",
      title: "Sum",
      description: "Sum",
      required: false,
      type: TableColumnType.Decimal,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const valueColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "value",
      title: "Value",
      description: "Value",
      required: false,
      type: TableColumnType.Decimal,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const minColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "min",
      title: "Min",
      description: "Min",
      required: false,
      type: TableColumnType.Decimal,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const maxColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "max",
      title: "Max",
      description: "Max",
      required: false,
      type: TableColumnType.Decimal,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const bucketCountsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "bucketCounts",
      title: "Bucket Counts",
      description: "Bucket Counts",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayBigNumber,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const explicitBoundsColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "explicitBounds",
        title: "Explicit Bounds",
        description:
          "Upper bounds (exclusive of the +inf overflow bucket) for each explicit-bucket histogram bucket. Stored as Float64 so sub-integer boundaries (e.g. 0.005, 0.01) survive ingest — the previous Array(Int64) representation silently truncated those to 0.",
        required: true,
        defaultValue: [],
        type: TableColumnType.ArrayDecimal,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      },
    );

    /*
     * --- ExponentialHistogram-only columns ----------------------------------
     * These are populated only when metricPointType = ExponentialHistogram.
     * For other metric types they are left at their defaults (0 / []).
     */

    const scaleColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "scale",
      title: "Scale",
      description:
        "ExponentialHistogram resolution. base = 2^(2^-scale); bucket index `i` covers (base^i, base^(i+1)].",
      required: false,
      type: TableColumnType.Number,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const zeroCountColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "zeroCount",
      title: "Zero Count",
      description:
        "ExponentialHistogram count of values within the zero region (|v| <= zeroThreshold).",
      required: false,
      type: TableColumnType.BigNumber,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const positiveOffsetColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "positiveOffset",
        title: "Positive Bucket Offset",
        description:
          "Bucket index of the first entry in positiveBucketCounts (ExponentialHistogram).",
        required: false,
        type: TableColumnType.Number,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      },
    );

    const positiveBucketCountsColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "positiveBucketCounts",
        title: "Positive Bucket Counts",
        description:
          "Counts for the positive range of an ExponentialHistogram, indexed from positiveOffset.",
        required: true,
        defaultValue: [],
        type: TableColumnType.ArrayBigNumber,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    const negativeOffsetColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "negativeOffset",
        title: "Negative Bucket Offset",
        description:
          "Bucket index of the first entry in negativeBucketCounts (ExponentialHistogram).",
        required: false,
        type: TableColumnType.Number,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      },
    );

    const negativeBucketCountsColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "negativeBucketCounts",
        title: "Negative Bucket Counts",
        description:
          "Counts for the negative range of an ExponentialHistogram, indexed from negativeOffset.",
        required: true,
        defaultValue: [],
        type: TableColumnType.ArrayBigNumber,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    /*
     * --- Summary-only columns -----------------------------------------------
     * Populated only when metricPointType = Summary. Two parallel arrays
     * keyed by index (mirrors the bucketCounts/explicitBounds convention):
     *   summaryQuantiles[i] in [0,1], summaryValues[i] is value at that quantile.
     */

    const summaryQuantilesColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "summaryQuantiles",
        title: "Summary Quantiles",
        description:
          "Quantile percentages in [0,1] for a Summary metric (parallel to summaryValues).",
        required: true,
        defaultValue: [],
        type: TableColumnType.ArrayDecimal,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    const summaryValuesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "summaryValues",
      title: "Summary Values",
      description:
        "Values corresponding to each quantile in summaryQuantiles for a Summary metric.",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayDecimal,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const traceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceId",
      title: "Trace ID",
      description:
        "Trace ID from an exemplar associated with this metric data point",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_trace_id",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const spanIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "spanId",
      title: "Span ID",
      description:
        "Span ID from an exemplar associated with this metric data point",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_span_id",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      title: "Retention Date",
      description:
        "Date after which this row is eligible for TTL deletion, computed at ingest time as time + service.retainTelemetryDataForDays",
      required: true,
      type: TableColumnType.Date,
      defaultValue: undefined,
    });

    super({
      tableName: AnalyticsTableName.Metric,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Metric",
      pluralName: "Metrics",
      crudApiPath: new Route("/metrics"),
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.EditTelemetryServiceTraces,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.DeleteTelemetryServiceTraces,
        ],
      },
      tableColumns: [
        projectIdColumn,
        serviceIdColumn,
        serviceTypeColumn,
        nameColumn,
        aggregationTemporalityColumn,
        metricPointTypeColumn,
        timeColumn,
        startTimeColumn,
        timeUnixNanoColumn,
        startTimeUnixNanoColumn,
        attributesColumn,
        attributeKeysColumn,
        isMonotonicColumn,
        countColumn,
        sumColumn,
        valueColumn,
        minColumn,
        maxColumn,
        bucketCountsColumn,
        explicitBoundsColumn,
        scaleColumn,
        zeroCountColumn,
        positiveOffsetColumn,
        positiveBucketCountsColumn,
        negativeOffsetColumn,
        negativeBucketCountsColumn,
        summaryQuantilesColumn,
        summaryValuesColumn,
        traceIdColumn,
        spanIdColumn,
        retentionDateColumn,
      ],
      projections: [],
      sortKeys: ["projectId", "name", "serviceId", "time"],
      primaryKeys: ["projectId", "name", "serviceId", "time"],
      partitionKey: "sipHash64(projectId) % 16",
      ttlExpression: "retentionDate DELETE",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get serviceId(): ObjectID | undefined {
    return this.getColumnValue("serviceId") as ObjectID | undefined;
  }

  public get serviceType(): ServiceType | undefined {
    return this.getColumnValue("serviceType") as ServiceType | undefined;
  }

  public get name(): string | undefined {
    return this.getColumnValue("name") as string | undefined;
  }

  public set name(v: string | undefined) {
    this.setColumnValue("name", v);
  }

  public get aggregationTemporality(): AggregationTemporality | undefined {
    return this.getColumnValue("aggregationTemporality") as
      | AggregationTemporality
      | undefined;
  }

  public set aggregationTemporality(v: AggregationTemporality | undefined) {
    this.setColumnValue("aggregationTemporality", v);
  }

  public get metricPointType(): MetricPointType | undefined {
    return this.getColumnValue("metricPointType") as
      | MetricPointType
      | undefined;
  }

  public set metricPointType(v: MetricPointType | undefined) {
    this.setColumnValue("metricPointType", v);
  }

  public get isMonotonic(): boolean | undefined {
    return this.getColumnValue("isMonotonic") as boolean | undefined;
  }

  public set isMonotonic(v: boolean | undefined) {
    this.setColumnValue("isMonotonic", v);
  }

  public set serviceId(v: ObjectID | undefined) {
    this.setColumnValue("serviceId", v);
  }

  public set serviceType(v: ServiceType | undefined) {
    this.setColumnValue("serviceType", v);
  }

  public get time(): Date | undefined {
    return this.getColumnValue("time") as Date | undefined;
  }

  public set time(v: Date | undefined) {
    this.setColumnValue("time", v);
  }

  public get attributes(): JSONObject | undefined {
    return this.getColumnValue("attributes") as JSONObject | undefined;
  }

  public set attributes(v: JSONObject | undefined) {
    this.setColumnValue("attributes", v);
  }

  public get attributeKeys(): Array<string> | undefined {
    return this.getColumnValue("attributeKeys") as Array<string> | undefined;
  }

  public set attributeKeys(v: Array<string> | undefined) {
    this.setColumnValue("attributeKeys", v);
  }

  public get startTime(): Date | undefined {
    return this.getColumnValue("startTime") as Date | undefined;
  }

  public set startTime(v: Date | undefined) {
    this.setColumnValue("startTime", v);
  }

  public get startTimeUnixNano(): number | undefined {
    return this.getColumnValue("startTimeUnixNano") as number | undefined;
  }

  public set startTimeUnixNano(v: number | undefined) {
    this.setColumnValue("startTimeUnixNano", v);
  }

  public get timeUnixNano(): number | undefined {
    return this.getColumnValue("timeUnixNano") as number | undefined;
  }

  public set timeUnixNano(v: number | undefined) {
    this.setColumnValue("timeUnixNano", v);
  }

  public get count(): number | undefined {
    return this.getColumnValue("count") as number | undefined;
  }

  public set count(v: number | undefined) {
    this.setColumnValue("count", v);
  }

  public get sum(): number | undefined {
    return this.getColumnValue("sum") as number | undefined;
  }

  public set sum(v: number | undefined) {
    this.setColumnValue("sum", v);
  }

  public get value(): number | undefined {
    return this.getColumnValue("value") as number | undefined;
  }

  public set value(v: number | undefined) {
    this.setColumnValue("value", v);
  }

  public get min(): number | undefined {
    return this.getColumnValue("min") as number | undefined;
  }

  public set min(v: number | undefined) {
    this.setColumnValue("min", v);
  }

  public get max(): number | undefined {
    return this.getColumnValue("max") as number | undefined;
  }

  public set max(v: number | undefined) {
    this.setColumnValue("max", v);
  }

  public get bucketCounts(): Array<number> | undefined {
    return this.getColumnValue("bucketCounts") as Array<number> | undefined;
  }

  public set bucketCounts(v: Array<number> | undefined) {
    this.setColumnValue("bucketCounts", v);
  }

  public get explicitBounds(): Array<number> | undefined {
    return this.getColumnValue("explicitBounds") as Array<number> | undefined;
  }

  public set explicitBounds(v: Array<number> | undefined) {
    this.setColumnValue("explicitBounds", v);
  }

  public get traceId(): string | undefined {
    return this.getColumnValue("traceId") as string | undefined;
  }

  public set traceId(v: string | undefined) {
    this.setColumnValue("traceId", v);
  }

  public get spanId(): string | undefined {
    return this.getColumnValue("spanId") as string | undefined;
  }

  public set spanId(v: string | undefined) {
    this.setColumnValue("spanId", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }

  public get scale(): number | undefined {
    return this.getColumnValue("scale") as number | undefined;
  }

  public set scale(v: number | undefined) {
    this.setColumnValue("scale", v);
  }

  public get zeroCount(): number | undefined {
    return this.getColumnValue("zeroCount") as number | undefined;
  }

  public set zeroCount(v: number | undefined) {
    this.setColumnValue("zeroCount", v);
  }

  public get positiveOffset(): number | undefined {
    return this.getColumnValue("positiveOffset") as number | undefined;
  }

  public set positiveOffset(v: number | undefined) {
    this.setColumnValue("positiveOffset", v);
  }

  public get positiveBucketCounts(): Array<number> | undefined {
    return this.getColumnValue("positiveBucketCounts") as
      | Array<number>
      | undefined;
  }

  public set positiveBucketCounts(v: Array<number> | undefined) {
    this.setColumnValue("positiveBucketCounts", v);
  }

  public get negativeOffset(): number | undefined {
    return this.getColumnValue("negativeOffset") as number | undefined;
  }

  public set negativeOffset(v: number | undefined) {
    this.setColumnValue("negativeOffset", v);
  }

  public get negativeBucketCounts(): Array<number> | undefined {
    return this.getColumnValue("negativeBucketCounts") as
      | Array<number>
      | undefined;
  }

  public set negativeBucketCounts(v: Array<number> | undefined) {
    this.setColumnValue("negativeBucketCounts", v);
  }

  public get summaryQuantiles(): Array<number> | undefined {
    return this.getColumnValue("summaryQuantiles") as Array<number> | undefined;
  }

  public set summaryQuantiles(v: Array<number> | undefined) {
    this.setColumnValue("summaryQuantiles", v);
  }

  public get summaryValues(): Array<number> | undefined {
    return this.getColumnValue("summaryValues") as Array<number> | undefined;
  }

  public set summaryValues(v: Array<number> | undefined) {
    this.setColumnValue("summaryValues", v);
  }
}
