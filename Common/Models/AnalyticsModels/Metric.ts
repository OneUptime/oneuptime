import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import OperationalResource from "../../Types/Database/AccessControl/OperationalResource";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Service from "../DatabaseModels/Service";
import ServiceType from "../../Types/Telemetry/ServiceType";

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

@OperationalResource()
@OwnedThrough("primaryEntityId", Service, { includeProjectScope: true })
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    // this can also be the monitor id or the telemetry service id.
    const primaryEntityIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "primaryEntityId",
      title: "Service ID",
      description: "ID of the Service which created the Metric",
      required: true,
      type: TableColumnType.ObjectID,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    // this can also be the monitor id or the telemetry service id.
    const primaryEntityTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "primaryEntityType",
      isLowCardinality: true,
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    // add name and description
    const nameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "name",
      codec: { codec: "ZSTD", level: 1 },
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
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
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    const metricPointTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "metricPointType",
        isLowCardinality: true,
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
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    // this is end time.
    const timeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "time",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Time",
      description: "When did the Metric happen?",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const startTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "startTime",
      codec: { codec: "ZSTD", level: 1 },
      title: "Start Time",
      description: "When did the Metric happen?",
      required: false,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    // end time.
    const timeUnixNanoColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "timeUnixNano",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Time (in Unix Nano)",
      description: "When did the Metric happen?",
      required: true,
      type: TableColumnType.UInt64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const startTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "startTimeUnixNano",
        codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
        title: "Start Time (in Unix Nano)",
        description: "When did the Metric happen?",
        required: false,
        type: TableColumnType.UInt64,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      codec: { codec: "ZSTD", level: 3 },
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const attributeKeysColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributeKeys",
      codec: { codec: "ZSTD", level: 3 },
      title: "Attribute Keys",
      description: "Attribute keys extracted from attributes",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      skipIndex: {
        name: "idx_attribute_keys",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const countColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "count",
      codec: { codec: "ZSTD", level: 1 },
      title: "Count",
      description: "Count",
      required: false,
      type: TableColumnType.BigNumber,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const sumColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "sum",
      codec: [{ codec: "Gorilla" }, { codec: "ZSTD", level: 1 }],
      title: "Sum",
      description: "Sum",
      required: false,
      type: TableColumnType.Decimal,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const valueColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "value",
      codec: [{ codec: "Gorilla" }, { codec: "ZSTD", level: 1 }],
      title: "Value",
      description: "Value",
      required: false,
      type: TableColumnType.Decimal,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const minColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "min",
      codec: [{ codec: "Gorilla" }, { codec: "ZSTD", level: 1 }],
      title: "Min",
      description: "Min",
      required: false,
      type: TableColumnType.Decimal,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const maxColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "max",
      codec: [{ codec: "Gorilla" }, { codec: "ZSTD", level: 1 }],
      title: "Max",
      description: "Max",
      required: false,
      type: TableColumnType.Decimal,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const bucketCountsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "bucketCounts",
      codec: { codec: "ZSTD", level: 1 },
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const explicitBoundsColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "explicitBounds",
        codec: { codec: "ZSTD", level: 1 },
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
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
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
      codec: { codec: "ZSTD", level: 1 },
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const zeroCountColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "zeroCount",
      codec: { codec: "ZSTD", level: 1 },
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const positiveOffsetColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "positiveOffset",
        codec: { codec: "ZSTD", level: 1 },
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
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      },
    );

    const positiveBucketCountsColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "positiveBucketCounts",
        codec: { codec: "ZSTD", level: 1 },
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
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    const negativeOffsetColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "negativeOffset",
        codec: { codec: "ZSTD", level: 1 },
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
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      },
    );

    const negativeBucketCountsColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "negativeBucketCounts",
        codec: { codec: "ZSTD", level: 1 },
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
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
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
        codec: { codec: "ZSTD", level: 1 },
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
            Permission.Viewer,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.TelemetryViewer,
            Permission.ReadTelemetryServiceLog,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceLog,
          ],
          update: [],
        },
      });

    const summaryValuesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "summaryValues",
      codec: { codec: "ZSTD", level: 1 },
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const traceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceId",
      codec: { codec: "ZSTD", level: 1 },
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const spanIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "spanId",
      codec: { codec: "ZSTD", level: 1 },
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceLog,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceLog,
        ],
        update: [],
      },
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
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
      enableDocumentation: true,
      tableDescription:
        "OpenTelemetry metric data points. Query and aggregate time-series telemetry for dashboards, alerts, and analysis.",
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.EditTelemetryServiceTraces,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.DeleteTelemetryServiceTraces,
        ],
      },
      tableColumns: [
        projectIdColumn,
        primaryEntityIdColumn,
        primaryEntityTypeColumn,
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
      sortKeys: ["projectId", "name", "primaryEntityId", "time"],
      primaryKeys: ["projectId", "name", "primaryEntityId", "time"],
      partitionKey: "toYYYYMMDD(time)",
      tableSettings: "ttl_only_drop_parts = 1",
      ttlExpression: "retentionDate DELETE",
      /*
       * `time` is the 4th column of the Metric sort key (after
       * projectId + name + primaryEntityId). A list query that filters
       * by name (the typical "metric detail" drilldown) can still
       * stream from the index when sorting by `time DESC`. With
       * no name filter the sort is less efficient but still far
       * better than the legacy `createdAt DESC` fallback, which
       * isn't in the sort key at all.
       */
      defaultSortColumn: "time",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get primaryEntityId(): ObjectID | undefined {
    return this.getColumnValue("primaryEntityId") as ObjectID | undefined;
  }

  public get primaryEntityType(): ServiceType | undefined {
    return this.getColumnValue("primaryEntityType") as ServiceType | undefined;
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

  public set primaryEntityId(v: ObjectID | undefined) {
    this.setColumnValue("primaryEntityId", v);
  }

  public set primaryEntityType(v: ServiceType | undefined) {
    this.setColumnValue("primaryEntityType", v);
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
