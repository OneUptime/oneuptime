import Project from "./Project";
import Service from "./Service";
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
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A connection holds a credential that reads a whole cloud account (an
 * access key, an app's client secret, a service account key) or names a
 * role OneUptime may assume in it, so only project owners and admins may
 * add, change or remove one. Everyone who may read the project's cloud
 * resources may see that it exists and how it is doing; the credential
 * column is never readable by anyone.
 */
const adminPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

/*
 * One cloud account OneUptime reads on a schedule, with nothing to run in
 * the customer's cloud: an AWS account (CloudWatch), the Azure
 * subscriptions an app registration may read (Azure Monitor), or the
 * Google Cloud projects a service account may read (Cloud Monitoring).
 *
 * Each read lists the account's resources - they appear under Cloud >
 * All Resources, linked to the connection (CloudResource.cloudConnectionId)
 * - and reads their key metrics (CloudKeyMetrics) into the connection's
 * own telemetry service, through the same metrics ingest an OpenTelemetry
 * Collector's cloud receivers send to.
 *
 * The cloud decides which keys `config` and `secrets` carry
 * (CloudConnectionCatalog).
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/cloud-connection"))
@Entity({
  name: "CloudConnection",
})
@TableMetadata({
  tableName: "CloudConnection",
  singularName: "Cloud Connection",
  pluralName: "Cloud Connections",
  icon: IconProp.Cloud,
  tableDescription:
    "Connections to AWS, Azure and Google Cloud accounts: OneUptime lists their resources and reads their key metrics on a schedule, with read-only access and nothing to install.",
})
@TableAccessControl({
  create: adminPermissions,
  read: readPermissions,
  delete: adminPermissions,
  update: adminPermissions,
})
export default class CloudConnection extends BaseModel {
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
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Cloud",
    description:
      "Which cloud this connection reads: 'aws', 'azure' or 'gcp'. Fixed once created.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: CloudProvider = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Settings",
    description:
      "The cloud's settings that are not secret, such as a role ARN, a tenant or the regions to read. Keys are defined by the cloud.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public config?: JSONObject = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: [],
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credentials",
    description:
      "The cloud's secrets (a secret access key, a client secret, a service account key) as a JSON object. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public secrets?: string = undefined;

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
    description: "Whether this connection is read on its schedule.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "serviceId",
    type: TableColumnType.Entity,
    modelType: Service,
    title: "Service",
    description:
      "The telemetry service the metrics this connection reads belong to. Created with the connection.",
  })
  @ManyToOne(
    () => {
      return Service;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceId" })
  public service?: Service = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Service ID",
    description:
      "ID of the telemetry service the metrics this connection reads belong to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Next Read At",
    description:
      "When the connection is read next. Empty means as soon as possible.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public nextPullAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Read At",
    description: "When the connection was last read. Empty means never.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastPulledAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Successful Read At",
    description: "When a read last finished without an error.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSuccessfulPullAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Last Read Result",
    description:
      "What the last read found: the accounts, the resources by type and region, and the metrics it wrote.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public lastPullResult?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Last Error",
    description:
      "Why the last read failed, with credentials removed. Cleared by the next read that works.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.VeryLongText, nullable: true })
  public lastError?: string = undefined;

  /*
   * Where the last read got to (CloudConnectionPullState): server only, and
   * never shown - it holds no secret, but nothing on a screen needs it.
   */
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Read State",
    description: "Where the last read got to, so the next one resumes there.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public pullState?: JSONObject = undefined;

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
