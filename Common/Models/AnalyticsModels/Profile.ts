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

export default class Profile extends AnalyticsBaseModel {
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const serviceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "serviceId",
      title: "Service ID",
      description: "ID of the Service which created the profile",
      required: true,
      type: TableColumnType.ObjectID,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const profileIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "profileId",
      title: "Profile ID",
      description: "Unique identifier for the profile",
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const traceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "traceId",
      title: "Trace ID",
      description: "Correlation with traces",
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const spanIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "spanId",
      title: "Span ID",
      description: "Correlation with spans",
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const startTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "startTime",
      title: "Start Time",
      description: "Profile start timestamp",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const endTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "endTime",
      title: "End Time",
      description: "Profile end timestamp",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const startTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "startTimeUnixNano",
        title: "Start Time in Unix Nano",
        description: "Profile start timestamp in unix nanoseconds",
        required: true,
        type: TableColumnType.LongNumber,
        codec: { codec: "ZSTD", level: 1 },
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceProfiles,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceProfiles,
          ],
          update: [],
        },
      });

    const endTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "endTimeUnixNano",
        title: "End Time in Unix Nano",
        description: "Profile end timestamp in unix nanoseconds",
        required: true,
        type: TableColumnType.LongNumber,
        codec: { codec: "ZSTD", level: 1 },
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceProfiles,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceProfiles,
          ],
          update: [],
        },
      });

    const durationNanoColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "durationNano",
      title: "Duration in Nanoseconds",
      description: "Duration of the profile in nanoseconds",
      required: true,
      type: TableColumnType.LongNumber,
      codec: { codec: "ZSTD", level: 1 },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const profileTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "profileType",
      title: "Profile Type",
      description:
        "Type of profile (e.g., cpu, wall, alloc_objects, alloc_space, goroutine)",
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const unitColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "unit",
      title: "Unit",
      description: "Unit of the profile values (e.g., nanoseconds, bytes)",
      required: true,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const periodTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "periodType",
      title: "Period Type",
      description: "Sampling period type",
      required: false,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const periodColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "period",
      title: "Period",
      description: "Sampling period value",
      required: false,
      type: TableColumnType.LongNumber,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      title: "Attributes",
      description: "Profile-level attributes",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
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
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const sampleCountColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "sampleCount",
      title: "Sample Count",
      description: "Number of samples in this profile",
      required: true,
      type: TableColumnType.Number,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [],
      },
    });

    const originalPayloadFormatColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "originalPayloadFormat",
        title: "Original Payload Format",
        description: "Format of the original payload (e.g., pprofext)",
        required: false,
        type: TableColumnType.Text,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadTelemetryServiceProfiles,
          ],
          create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateTelemetryServiceProfiles,
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
      tableName: AnalyticsTableName.Profile,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Profile",
      pluralName: "Profiles",
      crudApiPath: new Route("/profile"),
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceProfiles,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceProfiles,
        ],
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.EditTelemetryServiceProfiles,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.DeleteTelemetryServiceProfiles,
        ],
      },
      tableColumns: [
        projectIdColumn,
        serviceIdColumn,
        profileIdColumn,
        traceIdColumn,
        spanIdColumn,
        startTimeColumn,
        endTimeColumn,
        startTimeUnixNanoColumn,
        endTimeUnixNanoColumn,
        durationNanoColumn,
        profileTypeColumn,
        unitColumn,
        periodTypeColumn,
        periodColumn,
        attributesColumn,
        attributeKeysColumn,
        sampleCountColumn,
        originalPayloadFormatColumn,
        retentionDateColumn,
      ],
      sortKeys: ["projectId", "startTime", "serviceId", "profileType"],
      primaryKeys: ["projectId", "startTime", "serviceId", "profileType"],
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

  public get startTimeUnixNano(): number | undefined {
    return this.getColumnValue("startTimeUnixNano") as number | undefined;
  }

  public set startTimeUnixNano(v: number | undefined) {
    this.setColumnValue("startTimeUnixNano", v);
  }

  public get endTimeUnixNano(): number | undefined {
    return this.getColumnValue("endTimeUnixNano") as number | undefined;
  }

  public set endTimeUnixNano(v: number | undefined) {
    this.setColumnValue("endTimeUnixNano", v);
  }

  public get durationNano(): number | undefined {
    return this.getColumnValue("durationNano") as number | undefined;
  }

  public set durationNano(v: number | undefined) {
    this.setColumnValue("durationNano", v);
  }

  public get profileType(): string | undefined {
    return this.getColumnValue("profileType") as string | undefined;
  }

  public set profileType(v: string | undefined) {
    this.setColumnValue("profileType", v);
  }

  public get unit(): string | undefined {
    return this.getColumnValue("unit") as string | undefined;
  }

  public set unit(v: string | undefined) {
    this.setColumnValue("unit", v);
  }

  public get periodType(): string | undefined {
    return this.getColumnValue("periodType") as string | undefined;
  }

  public set periodType(v: string | undefined) {
    this.setColumnValue("periodType", v);
  }

  public get period(): number | undefined {
    return this.getColumnValue("period") as number | undefined;
  }

  public set period(v: number | undefined) {
    this.setColumnValue("period", v);
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

  public get sampleCount(): number | undefined {
    return this.getColumnValue("sampleCount") as number | undefined;
  }

  public set sampleCount(v: number | undefined) {
    this.setColumnValue("sampleCount", v);
  }

  public get originalPayloadFormat(): string | undefined {
    return this.getColumnValue("originalPayloadFormat") as string | undefined;
  }

  public set originalPayloadFormat(v: string | undefined) {
    this.setColumnValue("originalPayloadFormat", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
