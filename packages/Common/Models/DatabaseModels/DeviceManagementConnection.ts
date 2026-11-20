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
import DeviceManagementProvider from "../../Types/DeviceManagement/DeviceManagementProvider";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A connection holds an API key that reads a whole Esper tenant - every
 * device in it, its groups and its apps - so only project owners and admins
 * may add, change or remove one. Everyone who may read the project's
 * Inventory may see that it exists and how it is doing; the key itself is
 * never readable by anyone.
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
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadTelemetryService,
];

/*
 * One device management service (MDM) OneUptime reads a fleet of devices
 * from, through the service's API, on a schedule, with nothing to install on
 * the devices (OneUptime issue #9586): an Esper tenant, read through Esper's
 * API with a key made in its console; a Microsoft Intune tenant, read
 * through Microsoft Graph as an app registration of its own (#9837); or a
 * Workspace ONE UEM (#10086) or SOTI MobiControl (#10087) server, read
 * through its REST API at the address the customer gives.
 *
 * Each read lists the tenant's devices, their groups and their last
 * check-ins - and, on a slower clock, each device's installed apps - into
 * ManagedDevice and ManagedDeviceApp rows, and each device is one host in
 * Inventory (ManagedDeviceIdentity). Neither service sends anything on its
 * own, so each is read on a schedule. What a read found, what went wrong and
 * when it reads next are kept here, so a failure shows on the connection,
 * never silently.
 *
 * `config` holds what is not secret (DeviceManagementConnectionSettings: the
 * tenant or server, the client ID, cloud, region or username a service
 * signs in with, and how often to read) and `secrets` the service's
 * secrets, encrypted at rest and never returned.
 */
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/device-management-connection"))
@Entity({
  name: "DeviceManagementConnection",
})
@TableMetadata({
  tableName: "DeviceManagementConnection",
  singularName: "Device Management Connection",
  pluralName: "Device Management Connections",
  icon: IconProp.DevicePhoneMobile,
  tableDescription:
    "Device management services - Esper, Microsoft Intune, Workspace ONE UEM and SOTI MobiControl - whose devices OneUptime imports through the service's API, on a schedule: each device, its group, its installed apps and its last check-in.",
})
@TableAccessControl({
  create: adminPermissions,
  read: readPermissions,
  delete: adminPermissions,
  update: adminPermissions,
})
export default class DeviceManagementConnection extends BaseModel {
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
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Friendly name for this connection. The tenant's name when none is given.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
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
    allowedValues: Object.values(DeviceManagementProvider),
    canReadOnRelationQuery: true,
    title: "Service",
    description:
      "Which device management service this connection reads: 'esper' (Esper's API), 'intune' (Microsoft Intune, through Microsoft Graph), 'workspaceone' (Workspace ONE UEM's REST API) or 'soti' (SOTI MobiControl's REST API). Fixed once created.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: DeviceManagementProvider = undefined;

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
      "What is not secret: the tenant (Esper's: the name before .esper.cloud in the console's address; Intune's: the Microsoft Entra directory ID, or a domain of it; Workspace ONE's and SOTI's: the server's host, like as1234.awmdm.com), for Intune the app registration's clientId and the cloud (public, gcc, usgov or dod), for Workspace ONE how it signs in (authMethod: oauth, with the OAuth client's clientId and the token service's region - na, emea, apac or uat - or basic, with an administrator's username), for SOTI the API client's clientId and the API user's username, and how often the devices are read (readIntervalInMinutes: 5, 10, 15, 30 or 60).",
    example: {
      tenant: "acme",
      readIntervalInMinutes: 15,
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
      'The service\'s secrets, as a JSON object: {"apiKey": "..."} for Esper, {"clientSecret": "..."} for Intune and for Workspace ONE with an OAuth client, {"password": "...", "apiKey": "..."} (the REST API key) for Workspace ONE with an administrator\'s account, {"clientSecret": "...", "password": "..."} for SOTI. Encrypted at rest and never returned by the API. On an update, a secret left empty keeps the stored one.',
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
      "What the last read found: how many devices the tenant has and how many are online, what changed since the read before, what it could not read and why, and how many API calls it made.",
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
   * Where the reads got to (DeviceManagementPullState): the end of the last
   * check-in window read, and when a device whose check-in no window had
   * was last asked about on its own. Server only, and never shown - it
   * holds no secret, but nothing on a screen needs it.
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
