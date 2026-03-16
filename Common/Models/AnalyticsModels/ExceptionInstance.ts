import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { SpanStatus } from "./Span";

export default class ExceptionInstance extends AnalyticsBaseModel {
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
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
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
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const timeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "time",
      title: "Time",
      description: "When was the log created?",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const timeUnixNanoColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "timeUnixNano",
      title: "Time (in Unix Nano)",
      description: "When was the log created?",
      required: true,
      type: TableColumnType.LongNumber,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const exceptionTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "exceptionType",
      title: "Exception Type",
      description: "Exception Type", // Examples: java.net.ConnectException; OSError; etc.
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_exception_type",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const stackTraceColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "stackTrace",
      title: "Stack Trace",
      description: "Exception Stack Trace", // Examples: Division by zero; Can't convert 'int' object to str implicitly
      required: false,
      type: TableColumnType.Text,
      codec: {
        codec: "ZSTD",
        level: 3,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const messageColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "message",
      title: "Exception Message",
      description: "Exception Message", // Examples: Division by zero; Can't convert 'int' object to str implicitly
      required: false,
      type: TableColumnType.Text,
      codec: {
        codec: "ZSTD",
        level: 3,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const spanStatusCodeColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "spanStatusCode",
        title: "Span Status Code",
        description: "Span Status Code",
        required: false,
        type: TableColumnType.Number,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryException,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryException,
          ],
          update: [],
        },
      },
    );

    const escapedColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "escaped",
      title: "Exception Escaped",
      description: "Exception Escaped", // SHOULD be set to true if the exception event is recorded at a point where it is known that the exception is escaping the scope of the span.
      required: false,
      type: TableColumnType.Boolean,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const traceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceId",
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
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const spanIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "spanId",
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
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const fingerprintColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "fingerprint",
      title: "Fingerprint",
      description: "Fingerprint of the exception",
      required: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_fingerprint",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const spanNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "spanName",
      title: "Span Name",
      description: "Name of the span",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_span_name",
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

    const releaseColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "release",
      title: "Release",
      description:
        "Service version / release from service.version resource attribute",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_release",
        type: SkipIndexType.Set,
        params: [100],
        granularity: 4,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const environmentColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "environment",
      title: "Environment",
      description:
        "Deployment environment from deployment.environment resource attribute",
      required: false,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_environment",
        type: SkipIndexType.Set,
        params: [10],
        granularity: 4,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [],
      },
    });

    const parsedFramesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "parsedFrames",
      title: "Parsed Stack Frames",
      description: "Stack trace parsed into structured frames (JSON array)",
      required: false,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
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
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
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
      tableName: AnalyticsTableName.ExceptionInstance,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Exception Instance",
      pluralName: "Exception Instances",
      enableRealtimeEventsOn: {
        create: true,
      },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryException,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryException,
        ],
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.EditTelemetryException,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.DeleteTelemetryException,
        ],
      },
      crudApiPath: new Route("/exceptions"),
      tableColumns: [
        projectIdColumn,
        serviceIdColumn,
        timeColumn,
        timeUnixNanoColumn,
        exceptionTypeColumn,
        stackTraceColumn,
        messageColumn,
        spanStatusCodeColumn,
        escapedColumn,
        traceIdColumn,
        spanIdColumn,
        fingerprintColumn,
        spanNameColumn,
        releaseColumn,
        environmentColumn,
        parsedFramesColumn,
        attributesColumn,
        retentionDateColumn,
      ],
      projections: [
        {
          name: "proj_exception_group",
          query:
            "SELECT projectId, serviceId, fingerprint, exceptionType, count() AS cnt, max(time) AS last_seen GROUP BY projectId, serviceId, fingerprint, exceptionType ORDER BY (projectId, serviceId, fingerprint)",
        },
      ],
      sortKeys: ["projectId", "time", "serviceId", "fingerprint"],
      primaryKeys: ["projectId", "time", "serviceId", "fingerprint"],
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

  public set serviceId(v: ObjectID | undefined) {
    this.setColumnValue("serviceId", v);
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

  public get exceptionType(): string | undefined {
    return this.getColumnValue("exceptionType") as string | undefined;
  }

  public set exceptionType(v: string | undefined) {
    this.setColumnValue("exceptionType", v);
  }

  public get stackTrace(): string | undefined {
    return this.getColumnValue("stackTrace") as string | undefined;
  }

  public set stackTrace(v: string | undefined) {
    this.setColumnValue("stackTrace", v);
  }

  public get message(): string | undefined {
    return this.getColumnValue("message") as string | undefined;
  }

  public set message(v: string | undefined) {
    this.setColumnValue("message", v);
  }

  public get escaped(): boolean | undefined {
    return this.getColumnValue("escaped") as boolean | undefined;
  }

  public set escaped(v: boolean | undefined) {
    this.setColumnValue("escaped", v);
  }

  public get fingerprint(): string | undefined {
    return this.getColumnValue("fingerprint") as string | undefined;
  }

  public set fingerprint(v: string | undefined) {
    this.setColumnValue("fingerprint", v);
  }

  public get attributes(): Record<string, any> {
    return this.getColumnValue("attributes") as Record<string, any>;
  }

  public set attributes(v: Record<string, any>) {
    this.setColumnValue("attributes", v);
  }

  public get spanStatusCode(): SpanStatus | undefined {
    return this.getColumnValue("spanStatusCode") as SpanStatus | undefined;
  }

  public set spanStatusCode(v: SpanStatus | undefined) {
    this.setColumnValue("spanStatusCode", v);
  }

  public get spanName(): string | undefined {
    return this.getColumnValue("spanName") as string | undefined;
  }

  public set spanName(v: string | undefined) {
    this.setColumnValue("spanName", v);
  }

  public get release(): string | undefined {
    return this.getColumnValue("release") as string | undefined;
  }

  public set release(v: string | undefined) {
    this.setColumnValue("release", v);
  }

  public get environment(): string | undefined {
    return this.getColumnValue("environment") as string | undefined;
  }

  public set environment(v: string | undefined) {
    this.setColumnValue("environment", v);
  }

  public get parsedFrames(): string | undefined {
    return this.getColumnValue("parsedFrames") as string | undefined;
  }

  public set parsedFrames(v: string | undefined) {
    this.setColumnValue("parsedFrames", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
