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

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Service ID",
        description:
          "ID of the resource the profile belongs to (Service / Host / DockerHost / KubernetesCluster / Monitor — disambiguated by primaryEntityType)",
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

    const startTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "startTime",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Start Time",
      description: "Profile start timestamp",
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

    const endTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "endTime",
      /*
       * DoubleDelta works here (unlike Span.endTime): profiles cover
       * fixed-length collection windows, so endTime tracks startTime —
       * and endTimeUnixNano already compresses well with DoubleDelta.
       */
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "End Time",
      description: "Profile end timestamp",
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

    const startTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "startTimeUnixNano",
        title: "Start Time in Unix Nano",
        description: "Profile start timestamp in unix nanoseconds",
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

    const endTimeUnixNanoColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "endTimeUnixNano",
        title: "End Time in Unix Nano",
        description: "Profile end timestamp in unix nanoseconds",
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

    const durationNanoColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "durationNano",
      title: "Duration in Nanoseconds",
      description: "Duration of the profile in nanoseconds",
      required: true,
      type: TableColumnType.UInt64,
      codec: { codec: "ZSTD", level: 1 },
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

    const periodColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "period",
      codec: { codec: "ZSTD", level: 1 },
      title: "Period",
      description: "Sampling period value",
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

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      codec: { codec: "ZSTD", level: 3 },
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

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
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
        entityKeysColumn,
        ...scalarEntityKeyColumns,
        sampleCountColumn,
        originalPayloadFormatColumn,
        retentionDateColumn,
      ],
      sortKeys: ["projectId", "startTime", "primaryEntityId", "profileType"],
      primaryKeys: ["projectId", "startTime", "primaryEntityId", "profileType"],
      partitionKey: "toYYYYMMDD(startTime)",
      tableSettings: "ttl_only_drop_parts = 1",
      ttlExpression: "retentionDate DELETE",
      defaultSortColumn: "startTime",
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

  public get entityKeys(): Array<string> | undefined {
    return this.getColumnValue("entityKeys") as Array<string> | undefined;
  }

  public set entityKeys(v: Array<string> | undefined) {
    this.setColumnValue("entityKeys", v);
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
