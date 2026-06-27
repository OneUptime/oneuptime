import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import {
  attributeMapSkipIndexes,
  attributeValueTokensColumn,
} from "./AnalyticsModelAttributeIndexing";
import OperationalResource from "../../Types/Database/AccessControl/OperationalResource";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import LogSeverity from "../../Types/Log/LogSeverity";
import Service from "../DatabaseModels/Service";
import ServiceType from "../../Types/Telemetry/ServiceType";

@OperationalResource()
@OwnedThrough("primaryEntityId", Service, { includeProjectScope: true })
export default class Log extends AnalyticsBaseModel {
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

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Service ID",
        description:
          "ID of the resource the log belongs to (Service / Host / DockerHost / KubernetesCluster / Monitor — disambiguated by primaryEntityType)",
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

    const primaryEntityTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityType",
        isLowCardinality: true,
        title: "Service Type",
        description:
          "Discriminator for primaryEntityId — tells the read side which resource table to dispatch to",
        required: false,
        type: TableColumnType.Text,
        skipIndex: {
          name: "idx_service_type",
          type: SkipIndexType.Set,
          params: [10],
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

    const timeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "time",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Time",
      description: "When was the log created?",
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

    const timeUnixNanoColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "timeUnixNano",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Time (in Unix Nano)",
      description: "When was the log created?",
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

    const severityTextColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "severityText",
      isLowCardinality: true,
      title: "Severity Text",
      description: "Log Severity Text",
      required: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_severity",
        type: SkipIndexType.Set,
        params: [10],
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

    const severityNumberColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "severityNumber",
        title: "Severity Number",
        description: "Log Severity Number",
        required: true,
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

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      codec: { codec: "ZSTD", level: 3 },
      title: "Attributes",
      description: "Attributes",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
      skipIndexes: attributeMapSkipIndexes(),
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

    const entityKeysColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "entityKeys",
      codec: { codec: "ZSTD", level: 3 },
      title: "Entity Keys",
      description:
        "Stable keys of every OpenTelemetry entity (service, host, k8s.pod, container, ...) this signal belongs to. A superset that includes the primary entity. Enables cross-cutting membership queries via has(entityKeys, :key).",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      skipIndex: {
        name: "idx_entity_keys",
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

    /*
     * Scalar per-entity-type key columns — denormalized single-value
     * siblings of `entityKeys`. Each holds the 16-hex key (see
     * Common/Utils/Telemetry/EntityKey) of the row's entity of that type,
     * or '' when the resource carries no such entity (non-Nullable String,
     * so old rows read the type default ''). Unlike the array column, a
     * scalar equality predicate is usable as an MV/sort key and gets a
     * cheaper bloom-filter probe; only the high-traffic keys
     * (service/host/k8s.pod) carry skip indexes. Stamped at ingest by the
     * same extractor that fills `entityKeys`; never part of identity.
     */
    const scalarEntityKeyColumns: Array<AnalyticsTableColumn> = [
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
      { key: "k8sNodeEntityKey", title: "Kubernetes Node Entity Key" },
      { key: "k8sClusterEntityKey", title: "Kubernetes Cluster Entity Key" },
      { key: "containerEntityKey", title: "Container Entity Key" },
    ].map(
      (def: {
        key: string;
        title: string;
        indexName?: string | undefined;
      }): AnalyticsTableColumn => {
        return new AnalyticsTableColumn({
          key: def.key,
          title: def.title,
          description:
            "Scalar entity key for this entity type (see entityKeys); '' when the resource has no entity of this type.",
          required: true,
          defaultValue: "",
          type: TableColumnType.Text,
          codec: { codec: "ZSTD", level: 1 },
          skipIndex: def.indexName
            ? {
                name: def.indexName,
                type: SkipIndexType.BloomFilter,
                params: [0.01],
                granularity: 1,
              }
            : undefined,
          accessControl: entityKeysColumn.accessControl,
        });
      },
    );

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

    const traceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceId",
      codec: { codec: "ZSTD", level: 1 },
      title: "Trace ID",
      description: "ID of the trace",
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
      description: "ID of the span",
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

    const bodyColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "body",
      title: "Log Body",
      description: "Body of the Log",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_body",
        type: SkipIndexType.TokenBF,
        params: [10240, 3, 0],
        granularity: 4,
      },
      codec: {
        codec: "ZSTD",
        level: 3,
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

    const observedTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "observedTimeUnixNano",
        codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
        title: "Observed Time (in Unix Nano)",
        description:
          "When the log was observed/collected by the telemetry pipeline",
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

    const droppedAttributesCountColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "droppedAttributesCount",
        title: "Dropped Attributes Count",
        description: "Number of attributes that were dropped during collection",
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

    const flagsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "flags",
      title: "Flags",
      description: "Log record flags (e.g., W3C trace flags)",
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
      tableName: AnalyticsTableName.Log,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Log",
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
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.EditTelemetryServiceLog,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.DeleteTelemetryServiceLog,
        ],
      },
      pluralName: "Logs",
      crudApiPath: new Route("/logs"),
      enableDocumentation: true,
      tableDescription:
        "OpenTelemetry log records ingested from your services. Query, filter, and aggregate structured logs across your project.",
      tableColumns: [
        projectIdColumn,
        primaryEntityIdColumn,
        primaryEntityTypeColumn,
        timeColumn,
        timeUnixNanoColumn,
        severityTextColumn,
        severityNumberColumn,
        attributesColumn,
        attributeValueTokensColumn(attributesColumn.accessControl!),
        attributeKeysColumn,
        entityKeysColumn,
        ...scalarEntityKeyColumns,
        traceIdColumn,
        spanIdColumn,
        bodyColumn,
        observedTimeUnixNanoColumn,
        droppedAttributesCountColumn,
        flagsColumn,
        retentionDateColumn,
      ],
      projections: [
        {
          name: "proj_severity_histogram",
          query:
            "SELECT projectId, severityText, toStartOfInterval(time, INTERVAL 1 MINUTE) AS minute, count() AS cnt GROUP BY projectId, severityText, minute",
        },
      ],
      sortKeys: ["projectId", "time", "primaryEntityId"],
      primaryKeys: ["projectId", "time", "primaryEntityId"],
      partitionKey: "toYYYYMMDD(time)",
      /*
       * Shard by (projectId, primaryEntityId, time). traceId is NOT used: it is
       * Nullable on logs AND most logs have no trace, so a traceId hash would pile
       * the majority onto one shard. These three columns are always present
       * (non-nullable), and including the high-entropy `time` means even a single
       * very-high-volume service spreads evenly across all shards — no hotspot.
       * (Trace-scoped log reads scatter-gather, which is cheap via the traceId
       * bloom-filter skip index and rare here.)
       */
      shardingKey: "cityHash64(projectId, primaryEntityId, time)",
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

  public set body(v: string | undefined) {
    this.setColumnValue("body", v);
  }

  public get body(): string | undefined {
    return this.getColumnValue("body");
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

  public get severityText(): LogSeverity | undefined {
    return this.getColumnValue("severityText") as LogSeverity | undefined;
  }

  public set severityText(v: LogSeverity | undefined) {
    this.setColumnValue("severityText", v);
  }

  public get severityNumber(): number | undefined {
    return this.getColumnValue("severityNumber") as number | undefined;
  }

  public set severityNumber(v: number | undefined) {
    this.setColumnValue("severityNumber", v);
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

  public get entityKeys(): Array<string> | undefined {
    return this.getColumnValue("entityKeys") as Array<string> | undefined;
  }

  public set entityKeys(v: Array<string> | undefined) {
    this.setColumnValue("entityKeys", v);
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

  public get observedTimeUnixNano(): number | undefined {
    return this.getColumnValue("observedTimeUnixNano") as number | undefined;
  }

  public set observedTimeUnixNano(v: number | undefined) {
    this.setColumnValue("observedTimeUnixNano", v);
  }

  public get droppedAttributesCount(): number | undefined {
    return this.getColumnValue("droppedAttributesCount") as number | undefined;
  }

  public set droppedAttributesCount(v: number | undefined) {
    this.setColumnValue("droppedAttributesCount", v);
  }

  public get flags(): number | undefined {
    return this.getColumnValue("flags") as number | undefined;
  }

  public set flags(v: number | undefined) {
    this.setColumnValue("flags", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
