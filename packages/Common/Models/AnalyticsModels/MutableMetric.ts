import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import { MetricPointType } from "./Metric";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ServiceType from "../../Types/Telemetry/ServiceType";

export default class MutableMetric extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
    });

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Primary Entity ID",
        description: "ID of the incident, alert, or other entity.",
        required: true,
        type: TableColumnType.ObjectID,
      });

    const primaryEntityTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityType",
        isLowCardinality: true,
        title: "Primary Entity Type",
        description: "Type of the primary entity.",
        required: true,
        type: TableColumnType.Text,
        skipIndex: {
          name: "idx_mutable_metric_entity_type",
          type: SkipIndexType.Set,
          params: [10],
          granularity: 4,
        },
      });

    const nameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "name",
      codec: { codec: "ZSTD", level: 1 },
      title: "Name",
      description: "Name of the metric.",
      required: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_mutable_metric_name",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
    });

    const metricPointIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "metricPointId",
      codec: { codec: "ZSTD", level: 1 },
      title: "Metric Point ID",
      description:
        "Stable identity for the mutable metric point within its entity and metric name.",
      required: true,
      type: TableColumnType.Text,
    });

    const metricPointTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "metricPointType",
        isLowCardinality: true,
        title: "Metric Point Type",
        description: "Metric point type.",
        required: false,
        type: TableColumnType.Text,
        skipIndex: {
          name: "idx_mutable_metric_point_type",
          type: SkipIndexType.Set,
          params: [5],
          granularity: 4,
        },
      });

    const timeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "time",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Time",
      description: "When this metric point happened.",
      required: true,
      type: TableColumnType.DateTime64,
    });

    const timeUnixNanoColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "timeUnixNano",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Time (in Unix Nano)",
      description: "When this metric point happened.",
      required: true,
      type: TableColumnType.UInt64,
    });

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      codec: { codec: "ZSTD", level: 3 },
      title: "Attributes",
      description: "Metric attributes.",
      required: true,
      type: TableColumnType.MapStringString,
      defaultValue: {},
      mapKeysColumn: "attributeKeys",
    });

    const attributeKeysColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributeKeys",
      codec: { codec: "ZSTD", level: 3 },
      title: "Attribute Keys",
      description: "Attribute keys extracted from attributes.",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      skipIndex: {
        name: "idx_mutable_metric_attribute_keys",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
    });

    const valueColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "value",
      codec: [{ codec: "Gorilla" }, { codec: "ZSTD", level: 1 }],
      title: "Value",
      description: "Metric value.",
      required: false,
      type: TableColumnType.Decimal,
    });

    const versionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "version",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Version",
      description:
        "Monotonic version for ReplacingMergeTree and version-aware reads.",
      required: true,
      type: TableColumnType.UInt64,
    });

    const isDeletedColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "isDeleted",
      title: "Is Deleted",
      description: "Tombstone marker for this metric point identity.",
      required: true,
      type: TableColumnType.Boolean,
      defaultValue: false,
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Retention Date",
      description: "Date after which this row is eligible for TTL deletion.",
      required: true,
      type: TableColumnType.Date,
    });

    super({
      tableName: AnalyticsTableName.MutableMetric,
      tableEngine: AnalyticsTableEngine.ReplacingMergeTree,
      singularName: "Mutable Metric",
      pluralName: "Mutable Metrics",
      tableDescription:
        "Versioned derived metric points for lifecycle metrics that can be corrected after initial emission.",
      tableColumns: [
        projectIdColumn,
        primaryEntityIdColumn,
        primaryEntityTypeColumn,
        nameColumn,
        metricPointIdColumn,
        metricPointTypeColumn,
        timeColumn,
        timeUnixNanoColumn,
        attributesColumn,
        attributeKeysColumn,
        valueColumn,
        versionColumn,
        isDeletedColumn,
        retentionDateColumn,
      ],
      projections: [],
      sortKeys: [
        "projectId",
        "name",
        "primaryEntityType",
        "primaryEntityId",
        "metricPointId",
      ],
      primaryKeys: [
        "projectId",
        "name",
        "primaryEntityType",
        "primaryEntityId",
        "metricPointId",
      ],
      partitionKey: "toYYYYMM(retentionDate)",
      shardingKey:
        "cityHash64(projectId, name, primaryEntityType, primaryEntityId, metricPointId)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
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

  public set primaryEntityId(v: ObjectID | undefined) {
    this.setColumnValue("primaryEntityId", v);
  }

  public get primaryEntityType(): ServiceType | undefined {
    return this.getColumnValue("primaryEntityType") as ServiceType | undefined;
  }

  public set primaryEntityType(v: ServiceType | undefined) {
    this.setColumnValue("primaryEntityType", v);
  }

  public get name(): string | undefined {
    return this.getColumnValue("name") as string | undefined;
  }

  public set name(v: string | undefined) {
    this.setColumnValue("name", v);
  }

  public get metricPointId(): string | undefined {
    return this.getColumnValue("metricPointId") as string | undefined;
  }

  public set metricPointId(v: string | undefined) {
    this.setColumnValue("metricPointId", v);
  }

  public get metricPointType(): MetricPointType | undefined {
    return this.getColumnValue("metricPointType") as
      | MetricPointType
      | undefined;
  }

  public set metricPointType(v: MetricPointType | undefined) {
    this.setColumnValue("metricPointType", v);
  }

  public get time(): Date | undefined {
    return this.getColumnValue("time") as Date | undefined;
  }

  public set time(v: Date | undefined) {
    this.setColumnValue("time", v);
  }

  public get timeUnixNano(): number | undefined {
    return this.getColumnValue("timeUnixNano") as number | undefined;
  }

  public set timeUnixNano(v: number | undefined) {
    this.setColumnValue("timeUnixNano", v);
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

  public get isDeleted(): boolean | undefined {
    return this.getColumnValue("isDeleted") as boolean | undefined;
  }

  public set isDeleted(v: boolean | undefined) {
    this.setColumnValue("isDeleted", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
