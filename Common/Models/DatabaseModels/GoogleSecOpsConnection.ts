import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

const adminPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
];

/*
 * Managed pull connector for Google SecOps (Chronicle): the detections
 * poller. Each connection holds the tenant's instance resource name plus
 * a service-account credential; a Workers cron polls detection alerts on
 * an interval and ingests them as Detection Finding security events.
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/google-secops-connection"))
@Entity({
  name: "GoogleSecOpsConnection",
})
@TableMetadata({
  tableName: "GoogleSecOpsConnection",
  singularName: "Google SecOps Connection",
  pluralName: "Google SecOps Connections",
  icon: IconProp.ShieldCheck,
  tableDescription:
    "Connections to Google SecOps (Chronicle) tenants. Detection alerts are polled on an interval and ingested as security events.",
})
@TableAccessControl({
  create: adminPermissions,
  read: readPermissions,
  delete: adminPermissions,
  update: adminPermissions,
})
export default class GoogleSecOpsConnection extends BaseModel {
  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this connection belongs to.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this connection belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Friendly name for this connection.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Region",
    description:
      "Google SecOps regional endpoint prefix, e.g. 'us' or 'europe'. Used to build the API base URL.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public region?: string = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Instance Resource Name",
    description:
      "The Chronicle instance resource name: projects/{project}/locations/{location}/instances/{instance}.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public instanceResourceName?: string = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: [],
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Service Account JSON",
    description:
      "Google Cloud service-account key (JSON) with Chronicle API read access. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public serviceAccountJson?: string = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description: "Whether this connection is polled.",
    defaultValue: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    title: "Poll Interval (Minutes)",
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    description: "How often detection alerts are polled, in minutes.",
    defaultValue: 5,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 5,
  })
  public pollIntervalInMinutes?: number = undefined;

  /*
   * Poller-owned state. Written only by the Workers cron.
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Polled At",
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    description:
      "When this connection was last polled. Null means it has never run.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastPolledAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Cursor",
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    description:
      "Poll cursor: the newest detection timestamp already ingested, as an ISO string.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public cursor?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Error",
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    description:
      "The most recent poll error, if any. Cleared on the next successful poll.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public lastError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this connection.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this connection.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
