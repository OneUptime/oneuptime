import DeviceManagementConnection from "./DeviceManagementConnection";
import ManagedDevice from "./ManagedDevice";
import Project from "./Project";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

// As ManagedDevice: written by OneUptime, read by whoever may read Inventory.
const READ_PERMISSIONS: Array<Permission> = [
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
 * One app installed on a managed device, with its version, as the last read
 * of the device's apps found it (a device's apps are read every few hours,
 * one request per device). One row per app per device, by its package name:
 * a new version updates the row, and an app that was uninstalled is removed
 * with the next read of the device's apps.
 */
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/managed-device-app"))
@TableMetadata({
  tableName: "ManagedDeviceApp",
  singularName: "Managed Device App",
  pluralName: "Managed Device Apps",
  icon: IconProp.Squares,
  tableDescription:
    "Apps installed on the devices a device management connection imports, with their versions. Written by OneUptime; not user-editable.",
})
@Index(["managedDeviceId", "packageName"], { unique: true })
@Entity({
  name: "ManagedDeviceApp",
})
export default class ManagedDeviceApp extends BaseModel {
  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this app belongs to.",
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

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this app belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "connectionId",
    type: TableColumnType.Entity,
    modelType: DeviceManagementConnection,
    title: "Connection",
    description: "The device management connection that imports this app.",
  })
  @ManyToOne(
    () => {
      return DeviceManagementConnection;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "connectionId" })
  public connection?: DeviceManagementConnection = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Connection ID",
    description:
      "ID of the device management connection that imports this app.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public connectionId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "managedDeviceId",
    type: TableColumnType.Entity,
    modelType: ManagedDevice,
    title: "Managed Device",
    description: "The device this app is installed on.",
  })
  @ManyToOne(
    () => {
      return ManagedDevice;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "managedDeviceId" })
  public managedDevice?: ManagedDevice = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Managed Device ID",
    description: "ID of the device this app is installed on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public managedDeviceId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "App Name",
    description: "The app's name, as the device reports it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public appName?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Package Name",
    description: "The app's Android package name, like com.example.kiosk.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public packageName?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Version",
    description: "The installed version's name, like 2.4.1.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public versionName?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Version Code",
    description: "The installed version's code, the number Android compares.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public versionCode?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "State",
    description: "The app's state, as the service reports it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public state?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Kiosk App",
    description: "Whether the device runs this app in kiosk mode.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isKioskApp?: boolean = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Managed by Service",
    description:
      "Whether the device management service installed and manages this app, rather than the device's maker.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isManagedByService?: boolean = undefined;
}
