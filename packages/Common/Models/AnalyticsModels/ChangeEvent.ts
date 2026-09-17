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

/*
 * Deploys, config changes, scaling events — the "what changed?" signal.
 * Rows are posted by CI/CD pipelines through the change-events ingest API
 * (or created from the product) and rendered as vertical dashed markers
 * on metric charts, so "the spike started 40 seconds after deploy X" is
 * visible without leaving the chart.
 *
 * Peer of LogItemV3 in layout: tenant projectId, per-row retentionDate
 * TTL, Map(String,String) attributes with a bloom-indexed keys sidecar.
 * Deliberately narrow — this is an annotation stream, not a log store.
 */

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
];

@OperationalResource()
@OwnedThrough("primaryEntityId", Service, { includeProjectScope: true })
export default class ChangeEvent extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Service ID",
        description:
          "ID of the telemetry Service this change belongs to (the deployed service). Optional — project-wide changes carry none.",
        required: false,
        type: TableColumnType.ObjectID,
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      });

    const primaryEntityTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityType",
        isLowCardinality: true,
        title: "Service Type",
        description: "Discriminator for primaryEntityId",
        required: false,
        type: TableColumnType.Text,
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      });

    const timeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "time",
      title: "Time",
      description: "When the change happened",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const eventTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "eventType",
      isLowCardinality: true,
      title: "Event Type",
      description:
        'Kind of change — e.g. "deployment", "config-change", "scaling", "rollback", "custom"',
      required: true,
      defaultValue: "deployment",
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_change_event_type",
        type: SkipIndexType.Set,
        params: [16],
        granularity: 4,
      },
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const titleColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "title",
      title: "Title",
      description: 'Short human label, e.g. "Deploy v2.31.0"',
      required: true,
      type: TableColumnType.Text,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const descriptionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "description",
      title: "Description",
      description: "Optional detail — commit message, change summary, links",
      required: false,
      type: TableColumnType.Text,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const attributesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributes",
      codec: { codec: "ZSTD", level: 3 },
      title: "Attributes",
      description:
        "Arbitrary tags — version, commit sha, pipeline url, environment",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
      mapKeysColumn: "attributeKeys",
      accessControl: {
        read: readPermissions,
        create: createPermissions,
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
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Retention Date",
      description:
        "Date after which this row is eligible for TTL deletion, computed at ingest time",
      required: true,
      type: TableColumnType.Date,
      defaultValue: undefined,
    });

    super({
      tableName: AnalyticsTableName.ChangeEvent,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Change Event",
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.TelemetryAdmin,
        ],
      },
      pluralName: "Change Events",
      crudApiPath: new Route("/change-events"),
      enableMCP: true,
      enableDocumentation: true,
      tableDescription:
        "Change events (deployments, config changes, scaling) posted by CI/CD pipelines. Rendered as markers on metric charts so spikes can be correlated with what changed.",
      tableColumns: [
        projectIdColumn,
        primaryEntityIdColumn,
        primaryEntityTypeColumn,
        timeColumn,
        eventTypeColumn,
        titleColumn,
        descriptionColumn,
        attributesColumn,
        attributeKeysColumn,
        retentionDateColumn,
      ],
      sortKeys: ["projectId", "time"],
      primaryKeys: ["projectId", "time"],
      partitionKey: "toYYYYMMDD(time)",
      /*
       * Tiny volume (a handful of rows per deploy) — shard by the
       * always-present tenant + time pair; no hotspot risk at this rate.
       */
      shardingKey: "cityHash64(projectId, time)",
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

  public get time(): Date | undefined {
    return this.getColumnValue("time") as Date | undefined;
  }

  public set time(v: Date | undefined) {
    this.setColumnValue("time", v);
  }

  public get eventType(): string | undefined {
    return this.getColumnValue("eventType") as string | undefined;
  }

  public set eventType(v: string | undefined) {
    this.setColumnValue("eventType", v);
  }

  public get title(): string | undefined {
    return this.getColumnValue("title") as string | undefined;
  }

  public set title(v: string | undefined) {
    this.setColumnValue("title", v);
  }

  public get description(): string | undefined {
    return this.getColumnValue("description") as string | undefined;
  }

  public set description(v: string | undefined) {
    this.setColumnValue("description", v);
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

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
