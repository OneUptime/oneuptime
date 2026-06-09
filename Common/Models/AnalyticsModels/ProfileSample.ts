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

@OperationalResource()
@OwnedThrough("primaryEntityId", Service, { includeProjectScope: true })
export default class ProfileSample extends AnalyticsBaseModel {
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const primaryEntityIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "primaryEntityId",
      title: "Service ID",
      description:
        "ID of the resource the profile sample belongs to (Service / Host / DockerHost / KubernetesCluster / Monitor — disambiguated by primaryEntityType)",
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const primaryEntityTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const profileIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "profileId",
      title: "Profile ID",
      description: "FK to profile table",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      skipIndex: {
        name: "idx_profile_id",
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const traceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceId",
      title: "Trace ID",
      description: "Trace correlation (from Link table)",
      required: false,
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const spanIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "spanId",
      title: "Span ID",
      description: "Span correlation (from Link table)",
      required: false,
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
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const timeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "time",
      title: "Time",
      description: "Sample timestamp",
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const timeUnixNanoColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "timeUnixNano",
      title: "Time (in Unix Nano)",
      description: "Sample timestamp in unix nanoseconds",
      required: true,
      type: TableColumnType.UInt64,
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const stacktraceColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "stacktrace",
      title: "Stacktrace",
      description: "Fully-resolved stack frames (function@file:line)",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      codec: { codec: "ZSTD", level: 3 },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const stacktraceHashColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "stacktraceHash",
        title: "Stacktrace Hash",
        description: "Hash of stacktrace for grouping",
        required: true,
        type: TableColumnType.Text,
        codec: { codec: "ZSTD", level: 1 },
        skipIndex: {
          name: "idx_stacktrace_hash",
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
            Permission.ReadTelemetryServiceProfiles,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.TelemetryAdmin,
            Permission.TelemetryMember,
            Permission.CreateTelemetryServiceProfiles,
          ],
          update: [],
        },
      },
    );

    const frameTypesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "frameTypes",
      title: "Frame Types",
      description:
        "Per-frame runtime type (kernel, native, jvm, cpython, go, v8js, etc.)",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      codec: { codec: "ZSTD", level: 3 },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const valueColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "value",
      title: "Value",
      description: "Sample value (CPU time, bytes, count)",
      required: true,
      type: TableColumnType.LongNumber,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const profileTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "profileType",
      title: "Profile Type",
      description: "Denormalized profile type for filtering",
      required: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_profile_type",
        type: SkipIndexType.Set,
        params: [20],
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const labelsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "labels",
      title: "Labels",
      description: "Sample-level labels",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
      codec: { codec: "ZSTD", level: 3 },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
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
      tableName: AnalyticsTableName.ProfileSample,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "ProfileSample",
      pluralName: "ProfileSamples",
      crudApiPath: new Route("/profile-sample"),
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.TelemetryViewer,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.EditTelemetryServiceProfiles,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.TelemetryAdmin,
          Permission.TelemetryMember,
          Permission.DeleteTelemetryServiceProfiles,
        ],
      },
      tableColumns: [
        projectIdColumn,
        primaryEntityIdColumn,
        primaryEntityTypeColumn,
        profileIdColumn,
        traceIdColumn,
        spanIdColumn,
        timeColumn,
        timeUnixNanoColumn,
        stacktraceColumn,
        stacktraceHashColumn,
        frameTypesColumn,
        valueColumn,
        profileTypeColumn,
        labelsColumn,
        retentionDateColumn,
      ],
      sortKeys: [
        "projectId",
        "time",
        "primaryEntityId",
        "profileType",
        "stacktraceHash",
      ],
      primaryKeys: [
        "projectId",
        "time",
        "primaryEntityId",
        "profileType",
        "stacktraceHash",
      ],
      partitionKey: "toYYYYMMDD(time)",
      tableSettings: "ttl_only_drop_parts = 1",
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

  public get profileId(): string | undefined {
    return this.getColumnValue("profileId") as string | undefined;
  }

  public set profileId(v: string | undefined) {
    this.setColumnValue("profileId", v);
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

  public get stacktrace(): Array<string> | undefined {
    return this.getColumnValue("stacktrace") as Array<string> | undefined;
  }

  public set stacktrace(v: Array<string> | undefined) {
    this.setColumnValue("stacktrace", v);
  }

  public get stacktraceHash(): string | undefined {
    return this.getColumnValue("stacktraceHash") as string | undefined;
  }

  public set stacktraceHash(v: string | undefined) {
    this.setColumnValue("stacktraceHash", v);
  }

  public get frameTypes(): Array<string> | undefined {
    return this.getColumnValue("frameTypes") as Array<string> | undefined;
  }

  public set frameTypes(v: Array<string> | undefined) {
    this.setColumnValue("frameTypes", v);
  }

  public get value(): number | undefined {
    return this.getColumnValue("value") as number | undefined;
  }

  public set value(v: number | undefined) {
    this.setColumnValue("value", v);
  }

  public get profileType(): string | undefined {
    return this.getColumnValue("profileType") as string | undefined;
  }

  public set profileType(v: string | undefined) {
    this.setColumnValue("profileType", v);
  }

  public get labels(): JSONObject | undefined {
    return this.getColumnValue("labels") as JSONObject | undefined;
  }

  public set labels(v: JSONObject | undefined) {
    this.setColumnValue("labels", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
