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

export enum SpanKind {
  Server = "SPAN_KIND_SERVER",
  Client = "SPAN_KIND_CLIENT",
  Producer = "SPAN_KIND_PRODUCER",
  Consumer = "SPAN_KIND_CONSUMER",
  Internal = "SPAN_KIND_INTERNAL",
}

export enum SpanEventType {
  Exception = "exception",
  Event = "event",
}

export enum SpanStatus {
  Unset = 0,
  Ok = 1,
  Error = 2,
}

export interface SpanEvent {
  name: string;
  time: Date;
  timeUnixNano: number;
  attributes: JSONObject;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: JSONObject;
}

export default class Span extends AnalyticsBaseModel {
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
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const serviceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "serviceId",
      title: "Service ID",
      description: "ID of the Service which created the log",
      required: true,
      type: TableColumnType.ObjectID,
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
        update: [],
      },
    });

    const startTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "startTime",
      title: "Start Time",
      description: "When did the span start?",
      required: true,
      type: TableColumnType.DateTime64,
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
        update: [],
      },
    });

    const endTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "endTime",
      title: "End Time",
      description: "When did the span end?",
      required: true,
      type: TableColumnType.DateTime64,
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
        update: [],
      },
    });

    const startTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "startTimeUnixNano",
        title: "Start Time in Unix Nano",
        description: "When did the span start?",
        required: true,
        type: TableColumnType.LongNumber,
        codec: { codec: "ZSTD", level: 1 },
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
          update: [],
        },
      });

    const durationUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "durationUnixNano",
        title: "Duration in Unix Nano",
        description: "How long did the span last?",
        required: true,
        type: TableColumnType.LongNumber,
        codec: { codec: "ZSTD", level: 1 },
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
          update: [],
        },
      });

    const endTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "endTimeUnixNano",
        title: "End Time",
        description: "When did the span end?",
        required: true,
        type: TableColumnType.LongNumber,
        codec: { codec: "ZSTD", level: 1 },
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
          update: [],
        },
      });

    const traceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceId",
      title: "Trace ID",
      description: "ID of the trace",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
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
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const spanIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "spanId",
      title: "Span ID",
      description: "ID of the span",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
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
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const parentSpanIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "parentSpanId",
      title: "Parent Span ID",
      description: "ID of the parent span",
      required: false,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      skipIndex: {
        name: "idx_parent_span_id",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
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
        update: [],
      },
    });

    const traceStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceState",
      title: "Trace State",
      description: "Trace State",
      required: false,
      type: TableColumnType.Text,
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
        update: [],
      },
    });

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      title: "Attributes",
      description: "Attributes",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
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
          Permission.ReadTelemetryServiceTraces,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceTraces,
        ],
        update: [],
      },
    });

    const eventsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "events",
      title: "Events",
      description: "Span Events",
      required: true,
      defaultValue: [],
      type: TableColumnType.JSONArray,
      codec: { codec: "ZSTD", level: 3 },
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
        update: [],
      },
    });

    const linksColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "links",
      title: "Links",
      description: "Span Links",
      required: true,
      defaultValue: [],
      type: TableColumnType.JSON,
      codec: { codec: "ZSTD", level: 3 },
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
        update: [],
      },
    });

    const statusCodeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "statusCode",
      title: "Status Code",
      description: "Status Code",
      required: false,
      type: TableColumnType.Number,
      skipIndex: {
        name: "idx_status_code",
        type: SkipIndexType.Set,
        params: [5],
        granularity: 4,
      },
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
        update: [],
      },
    });

    const statusMessageColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "statusMessage",
      title: "Status Message",
      description: "Status Message",
      required: false,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
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
        update: [],
      },
    });

    const nameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "name",
      title: "Name",
      description: "Name of the span",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_name",
        type: SkipIndexType.TokenBF,
        params: [10240, 3, 0],
        granularity: 4,
      },
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
        update: [],
      },
    });

    const kindColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "kind",
      title: "Kind",
      description: "Kind of the span",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_kind",
        type: SkipIndexType.Set,
        params: [5],
        granularity: 4,
      },
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
        update: [],
      },
    });

    const hasExceptionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "hasException",
      title: "Has Exception",
      description:
        "Whether this span contains an exception event, populated at ingest time for fast error filtering",
      required: true,
      defaultValue: false,
      type: TableColumnType.Boolean,
      skipIndex: {
        name: "idx_has_exception",
        type: SkipIndexType.Set,
        params: [2],
        granularity: 4,
      },
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
        update: [],
      },
    });

    const isRootSpanColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "isRootSpan",
      title: "Is Root Span",
      description:
        "Whether this span is a root span (has no parent), populated at ingest time for fast root-only filtering",
      required: true,
      defaultValue: false,
      type: TableColumnType.Boolean,
      skipIndex: {
        name: "idx_is_root_span",
        type: SkipIndexType.Set,
        params: [2],
        granularity: 4,
      },
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
        update: [],
      },
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      title: "Retention Date",
      description:
        "Date after which this row is eligible for TTL deletion, computed at ingest time as startTime + service.retainTelemetryDataForDays",
      required: true,
      type: TableColumnType.Date,
      defaultValue: undefined,
    });

    super({
      tableName: AnalyticsTableName.Span,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Span",
      pluralName: "Spans",
      crudApiPath: new Route("/span"),
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
        startTimeColumn,
        endTimeColumn,
        startTimeUnixNanoColumn,
        durationUnixNanoColumn,
        endTimeUnixNanoColumn,
        traceIdColumn,
        spanIdColumn,
        parentSpanIdColumn,
        traceStateColumn,
        attributesColumn,
        attributeKeysColumn,
        eventsColumn,
        linksColumn,
        statusCodeColumn,
        statusMessageColumn,
        nameColumn,
        kindColumn,
        hasExceptionColumn,
        isRootSpanColumn,
        retentionDateColumn,
      ],
      projections: [
        {
          name: "proj_agg_by_service",
          query:
            "SELECT projectId, serviceId, toStartOfMinute(startTime) AS minute, count() AS cnt, avg(durationUnixNano) AS avg_duration, quantile(0.99)(durationUnixNano) AS p99_duration GROUP BY projectId, serviceId, minute",
        },
        {
          name: "proj_trace_by_id",
          query:
            "SELECT projectId, traceId, startTime, serviceId, spanId, parentSpanId, name, durationUnixNano, statusCode, hasException ORDER BY (projectId, traceId, startTime)",
        },
      ],
      sortKeys: ["projectId", "startTime", "serviceId", "traceId"],
      primaryKeys: ["projectId", "startTime", "serviceId", "traceId"],
      partitionKey: "sipHash64(projectId) % 16",
      ttlExpression: "retentionDate DELETE",
    });
  }

  public get startTimeUnixNano(): number | undefined {
    return this.getColumnValue("startTimeUnixNano") as number | undefined;
  }

  public set startTimeUnixNano(v: number | undefined) {
    this.setColumnValue("startTimeUnixNano", v);
  }

  public get durationUnixNano(): number | undefined {
    return this.getColumnValue("durationUnixNano") as number | undefined;
  }

  public set durationUnixNano(v: number | undefined) {
    this.setColumnValue("durationUnixNano", v);
  }

  public get endTimeUnixNano(): number | undefined {
    return this.getColumnValue("endTimeUnixNano") as number | undefined;
  }

  public set endTimeUnixNano(v: number | undefined) {
    this.setColumnValue("endTimeUnixNano", v);
  }

  public get name(): string | undefined {
    return this.getColumnValue("name") as string | undefined;
  }

  public set name(v: string | undefined) {
    this.setColumnValue("name", v);
  }

  public get kind(): SpanKind | undefined {
    return this.getColumnValue("kind") as SpanKind | undefined;
  }

  public set kind(v: SpanKind | undefined) {
    this.setColumnValue("kind", v);
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

  public set serviceId(v: ObjectID | undefined) {
    this.setColumnValue("serviceId", v);
  }

  public get startTime(): Date | undefined {
    return this.getColumnValue("startTime") as Date | undefined;
  }

  public set startTime(v: Date | undefined) {
    this.setColumnValue("startTime", v);
  }

  public get endTime(): Date | undefined {
    return this.getColumnValue("endTime") as Date | undefined;
  }

  public set endTime(v: Date | undefined) {
    this.setColumnValue("endTime", v);
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

  public get parentSpanId(): string | undefined {
    return this.getColumnValue("parentSpanId") as string | undefined;
  }

  public set parentSpanId(v: string | undefined) {
    this.setColumnValue("parentSpanId", v);
  }

  public get traceState(): string | undefined {
    return this.getColumnValue("traceState") as string | undefined;
  }

  public set traceState(v: string | undefined) {
    this.setColumnValue("traceState", v);
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

  public get events(): Array<SpanEvent> | undefined {
    return this.getColumnValue("events") as Array<SpanEvent> | undefined;
  }

  public set events(v: Array<SpanEvent> | undefined) {
    this.setColumnValue("events", v as Array<JSONObject> | undefined);
  }

  public get links(): Array<SpanLink> | undefined {
    return this.getColumnValue("links") as Array<SpanLink> | undefined;
  }

  public set links(v: Array<SpanLink> | undefined) {
    this.setColumnValue("links", v as Array<JSONObject> | undefined);
  }

  public get statusCode(): SpanStatus | undefined {
    return this.getColumnValue("statusCode") as SpanStatus | undefined;
  }

  public set statusCode(v: SpanStatus | undefined) {
    this.setColumnValue("statusCode", v);
  }

  public get statusMessage(): string | undefined {
    return this.getColumnValue("statusMessage") as string | undefined;
  }

  public set statusMessage(v: string | undefined) {
    this.setColumnValue("statusMessage", v);
  }

  public get hasException(): boolean | undefined {
    return this.getColumnValue("hasException") as boolean | undefined;
  }

  public set hasException(v: boolean | undefined) {
    this.setColumnValue("hasException", v);
  }

  public get isRootSpan(): boolean | undefined {
    return this.getColumnValue("isRootSpan") as boolean | undefined;
  }

  public set isRootSpan(v: boolean | undefined) {
    this.setColumnValue("isRootSpan", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
