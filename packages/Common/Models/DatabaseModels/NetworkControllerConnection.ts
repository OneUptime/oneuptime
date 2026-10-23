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
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import NetworkControllerProvider from "../../Types/NetworkController/NetworkControllerProvider";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A connection holds an API key that reads a whole Meraki organization -
 * every network, device and client in it - so only project owners and
 * admins may add, change or remove one. Everyone who may read the
 * project's network devices may see that it exists and how it is doing;
 * the key itself is never readable by anyone.
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
  Permission.ReadNetworkDevice,
];

/*
 * One cloud-managed network OneUptime reads traffic from through its
 * controller's API, on a schedule, with nothing to set up on the devices
 * (OneUptime issue #5140): today a Meraki organization, read through the
 * Meraki dashboard API with a read-only administrator's key.
 *
 * Each read stores the organization's uplink usage, and every two hours
 * each network's application, destination and client usage, as
 * NetworkTrafficUsage rows the Traffic pages draw beside - or instead of -
 * flow records. What a read found, what went wrong and when it reads next
 * are kept here, so a failure shows on the connection, never silently.
 *
 * `config` holds what is not secret (NetworkControllerConnectionSettings:
 * the dashboard's region, the organization, how often to read) and
 * `secrets` the API key, encrypted at rest and never returned.
 */
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/network-controller-connection"))
@Entity({
  name: "NetworkControllerConnection",
})
@TableMetadata({
  tableName: "NetworkControllerConnection",
  singularName: "Network Controller Connection",
  pluralName: "Network Controller Connections",
  icon: IconProp.Cloud,
  tableDescription:
    "Meraki organizations OneUptime reads network traffic from through the Meraki dashboard API, on a schedule and with a read-only key.",
})
@TableAccessControl({
  create: adminPermissions,
  read: readPermissions,
  delete: adminPermissions,
  update: adminPermissions,
})
export default class NetworkControllerConnection extends BaseModel {
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
    description:
      "Friendly name for this connection. The organization's name when none is given.",
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
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Controller",
    description:
      "Which controller this connection reads: 'meraki' (the Meraki dashboard API). Fixed once created.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: NetworkControllerProvider = undefined;

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
      "What is not secret: the Meraki dashboard's region ('global', 'canada', 'china', 'india' or 'us-fedramp'), the organization's ID and name, and how often uplink usage is read (readIntervalInMinutes: 5, 10, 15, 30 or 60).",
    example: {
      region: "global",
      organizationId: "123456",
      organizationName: "Acme",
      readIntervalInMinutes: 5,
    },
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
      'The Meraki dashboard API key, as a JSON object: {"apiKey": "..."}. Encrypted at rest and never returned by the API. On an update, a key left empty keeps the stored one.',
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
      "What the last read found: the organization's networks and appliances, the windows and networks it stored, what it could not read and why, and how many API calls it made.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public lastPullResult?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Last Error",
    description:
      "Why the last read failed, with the API key removed. Cleared by the next read that works.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.VeryLongText, nullable: true })
  public lastError?: string = undefined;

  /*
   * Where the reads got to (NetworkControllerPullState): the end of the
   * last uplink window, each network's last application window. Server
   * only, and never shown - it holds no secret, but nothing on a screen
   * needs it.
   */
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Read State",
    description:
      "Where the last read got to, so the next one carries on there.",
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
