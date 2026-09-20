import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";

/*
 * Immutable audit trail. Nobody creates an entry through the API or as a
 * project user: every entry is written by the Enterprise Edition's audit-log
 * recorder, as root. So create is empty at table level and on every column,
 * and AuditLogService refuses any create that is not root (a master admin's
 * included, whom these lists do not bind). Update and delete are empty too;
 * entries leave only through the retention TTL.
 */
export default class AuditLog extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of the project this audit log belongs to.",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const resourceTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "resourceType",
      title: "Resource Type",
      description:
        "Type of the resource that was changed (e.g. Incident, Monitor).",
      required: true,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const resourceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "resourceId",
      title: "Resource ID",
      description: "ID of the resource that was changed.",
      required: true,
      type: TableColumnType.ObjectID,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const resourceNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "resourceName",
      title: "Resource Name",
      description: "Display name of the resource at the time of the change.",
      required: false,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    /*
     * The top-level resource a change belongs to. A top-level resource's rows
     * point at themselves; a child's rows point at its parent (an SLO burn
     * rate rule's at its SLO), which is what lets a resource's audit page list
     * its children's history with one filter. See
     * EnableAuditLogOn.rootResource. Nullable: rows written before these
     * columns existed are backfilled by the BackfillAuditLogRootResource data
     * migration.
     */
    const rootResourceTypeColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "rootResourceType",
        title: "Root Resource Type",
        description:
          "Type of the top-level resource this change belongs to. The same as Resource Type for a top-level resource, and the parent's type for a child resource (e.g. Service Level Objective for an SLO Burn Rate Rule).",
        required: false,
        type: TableColumnType.Text,
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.SettingsAdmin,
            Permission.ReadAuditLog,
          ],
          create: [],
          update: [],
        },
      });

    const rootResourceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "rootResourceId",
        title: "Root Resource ID",
        description:
          "ID of the top-level resource this change belongs to. The same as Resource ID for a top-level resource, and the parent's ID for a child resource.",
        required: false,
        type: TableColumnType.ObjectID,
        /*
         * A resource's audit page filters on this column. It cannot join the
         * sort key (an existing MergeTree's ORDER BY is fixed), so a bloom
         * filter lets ClickHouse skip the granules of the project's range that
         * cannot hold the id.
         */
        skipIndex: {
          name: "idx_root_resource_id",
          type: SkipIndexType.BloomFilter,
          params: [0.01],
          granularity: 1,
        },
        accessControl: {
          read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.SettingsAdmin,
            Permission.ReadAuditLog,
          ],
          create: [],
          update: [],
        },
      },
    );

    const actionColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "action",
      title: "Action",
      description: "The action performed: Create, Update, or Delete.",
      required: true,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const userIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "userId",
      title: "User ID",
      description: "ID of the user who performed the action, if any.",
      required: false,
      type: TableColumnType.ObjectID,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const userNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "userName",
      title: "User Name",
      description: "Display name of the user at the time of the action.",
      required: false,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const userEmailColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "userEmail",
      title: "User Email",
      description: "Email of the user at the time of the action.",
      required: false,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const userTypeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "userType",
      title: "User Type",
      description:
        "Type of actor: User, API, Automation, MasterAdmin, or System.",
      required: false,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const apiKeyIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "apiKeyId",
      title: "API Key ID",
      description:
        "ID of the API key used for this action, if performed via API.",
      required: false,
      type: TableColumnType.ObjectID,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const apiKeyNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "apiKeyName",
      title: "API Key Name",
      description: "Display name of the API key at the time of the action.",
      required: false,
      type: TableColumnType.Text,
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const changesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "changes",
      title: "Changes",
      description:
        "Field-level changes for Update actions, or full snapshot for Create/Delete. Redacted fields are omitted.",
      required: true,
      defaultValue: [],
      type: TableColumnType.JSONArray,
      codec: { codec: "ZSTD", level: 3 },
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
      },
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      title: "Retention Date",
      description:
        "Date after which this row is eligible for TTL deletion, computed at ingest time as createdAt + project.auditLogsRetentionInDays.",
      required: true,
      type: TableColumnType.Date,
      defaultValue: undefined,
    });

    super({
      tableName: AnalyticsTableName.AuditLog,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Audit Log",
      pluralName: "Audit Logs",
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadAuditLog,
        ],
        create: [],
        update: [],
        delete: [],
      },
      tableBillingAccessControl: {
        create: PlanType.Enterprise,
        read: PlanType.Enterprise,
        update: PlanType.Enterprise,
        delete: PlanType.Enterprise,
      },
      crudApiPath: new Route("/audit-log"),
      enableDocumentation: true,
      tableDescription:
        "Immutable audit-trail records of actions taken within your project.",
      tableColumns: [
        projectIdColumn,
        resourceTypeColumn,
        resourceIdColumn,
        resourceNameColumn,
        rootResourceTypeColumn,
        rootResourceIdColumn,
        actionColumn,
        userIdColumn,
        userNameColumn,
        userEmailColumn,
        userTypeColumn,
        apiKeyIdColumn,
        apiKeyNameColumn,
        changesColumn,
        retentionDateColumn,
      ],
      projections: [],
      sortKeys: ["projectId", "createdAt", "resourceType", "resourceId"],
      primaryKeys: ["projectId", "createdAt"],
      partitionKey: "toYYYYMM(createdAt)",
      // Shard by the audited resource so its history co-locates; spreads across shards.
      shardingKey: "cityHash64(projectId, resourceId)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
      /*
       * `createdAt` already participates in the AuditLog sort key
       * (position 2 after `projectId`), so the legacy `createdAt
       * DESC` default was already efficient here. Set it explicitly
       * so the choice is intentional rather than inherited from the
       * base class.
       */
      defaultSortColumn: "createdAt",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }
  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get resourceType(): string | undefined {
    return this.getColumnValue("resourceType") as string | undefined;
  }
  public set resourceType(v: string | undefined) {
    this.setColumnValue("resourceType", v);
  }

  public get resourceId(): ObjectID | undefined {
    return this.getColumnValue("resourceId") as ObjectID | undefined;
  }
  public set resourceId(v: ObjectID | undefined) {
    this.setColumnValue("resourceId", v);
  }

  public get resourceName(): string | undefined {
    return this.getColumnValue("resourceName") as string | undefined;
  }
  public set resourceName(v: string | undefined) {
    this.setColumnValue("resourceName", v);
  }

  public get rootResourceType(): string | undefined {
    return this.getColumnValue("rootResourceType") as string | undefined;
  }
  public set rootResourceType(v: string | undefined) {
    this.setColumnValue("rootResourceType", v);
  }

  public get rootResourceId(): ObjectID | undefined {
    return this.getColumnValue("rootResourceId") as ObjectID | undefined;
  }
  public set rootResourceId(v: ObjectID | undefined) {
    this.setColumnValue("rootResourceId", v);
  }

  public get action(): string | undefined {
    return this.getColumnValue("action") as string | undefined;
  }
  public set action(v: string | undefined) {
    this.setColumnValue("action", v);
  }

  public get userId(): ObjectID | undefined {
    return this.getColumnValue("userId") as ObjectID | undefined;
  }
  public set userId(v: ObjectID | undefined) {
    this.setColumnValue("userId", v);
  }

  public get userName(): string | undefined {
    return this.getColumnValue("userName") as string | undefined;
  }
  public set userName(v: string | undefined) {
    this.setColumnValue("userName", v);
  }

  public get userEmail(): string | undefined {
    return this.getColumnValue("userEmail") as string | undefined;
  }
  public set userEmail(v: string | undefined) {
    this.setColumnValue("userEmail", v);
  }

  public get userType(): string | undefined {
    return this.getColumnValue("userType") as string | undefined;
  }
  public set userType(v: string | undefined) {
    this.setColumnValue("userType", v);
  }

  public get apiKeyId(): ObjectID | undefined {
    return this.getColumnValue("apiKeyId") as ObjectID | undefined;
  }
  public set apiKeyId(v: ObjectID | undefined) {
    this.setColumnValue("apiKeyId", v);
  }

  public get apiKeyName(): string | undefined {
    return this.getColumnValue("apiKeyName") as string | undefined;
  }
  public set apiKeyName(v: string | undefined) {
    this.setColumnValue("apiKeyName", v);
  }

  public get changes(): JSONArray | undefined {
    return this.getColumnValue("changes") as JSONArray | undefined;
  }
  public set changes(v: JSONArray | undefined) {
    this.setColumnValue("changes", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }
  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
