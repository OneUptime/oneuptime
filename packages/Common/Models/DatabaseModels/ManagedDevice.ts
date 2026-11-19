import DeviceManagementConnection from "./DeviceManagementConnection";
import InventoryItem from "./InventoryItem";
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
import { ManagedDeviceHostMatch } from "../../Types/DeviceManagement/ManagedDeviceIdentity";
import { ManagedDevicePlatform } from "../../Types/DeviceManagement/ManagedDevicePlatform";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Written by OneUptime only - each read of the device's connection - and
 * read by everyone who may read the project's Inventory, whose hosts these
 * devices are.
 */
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
 * One device a device management service enrolls (an Android device in an
 * Esper tenant), as the last read of its connection found it: what it is,
 * its group, its Android version, build and security patch, when it last
 * checked in, and whether it is still in the service's device list.
 *
 * One row per device per connection, by the service's own ID for it. A
 * device that leaves the service's list is kept, marked removed (removedAt),
 * so it is never silently left behind; it goes for good 30 days later.
 *
 * Each device is ONE host in Inventory (inventoryItemId): the host telemetry
 * names by the device's Esper name, or found by its serial number, or made
 * for it (ManagedDeviceIdentity), so a device whose apps or Android agent
 * send telemetry is one row with what they send.
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
@CrudApiEndpoint(new Route("/managed-device"))
@TableMetadata({
  tableName: "ManagedDevice",
  singularName: "Managed Device",
  pluralName: "Managed Devices",
  icon: IconProp.DevicePhoneMobile,
  tableDescription:
    "Devices a device management service such as Esper or Microsoft Intune enrolls, imported by a device management connection: each device's hardware, operating system, group and last check-in. Written by OneUptime; not user-editable.",
})
@Index(["connectionId", "providerDeviceId"], { unique: true })
@Index(["projectId", "removedAt"])
@Entity({
  name: "ManagedDevice",
})
export default class ManagedDevice extends BaseModel {
  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this device belongs to.",
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
    description: "ID of the project this device belongs to.",
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
    description: "The device management connection that imports this device.",
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
      "ID of the device management connection that imports this device.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public connectionId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Device ID",
    description:
      "The service's own ID for the device: Esper's device UUID, or Intune's managed device ID.",
    example: "811a2d27-13fd-4358-8dc3-aed049e73ce7",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public providerDeviceId?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Device Name",
    description:
      "The name the service gave the device (Esper's generated name, like ESP-ID-AAAAW, or its name in Intune): the device's host.name in Inventory, unless another device of the connection has it too.",
    example: "ESP-ID-AAAAW",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public deviceName?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Alias",
    description: "The name people gave the device in the service's console.",
    example: "Store 0412 Kiosk 2",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public alias?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Serial Number",
    description: "The device's serial number, when the service knows it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public serialNumber?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "IMEI",
    description: "The device's IMEI, when it has a cellular radio.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public imei?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Manufacturer",
    description: "Who made the device.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public manufacturer?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Brand",
    description: "The brand the device is sold under.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public brand?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    // Named "Model" in the API, and as a machine's model on screen (MeaningKeys).
    title: "Model (hardware model)",
    description: "The device's model.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public model?: string = undefined;

  /*
   * What the device runs (ManagedDevicePlatform): its operating system in
   * Inventory, and how long it may go without checking in before it is
   * offline. Empty on a row written before #9837, when every device was an
   * Esper Android device: read as Android.
   */
  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(ManagedDevicePlatform),
    canReadOnRelationQuery: true,
    title: "Platform",
    description:
      "What the device runs: 'android', 'ios', 'ipados', 'tvos', 'macos', 'windows', 'linux' or 'other'. Empty is Android.",
    example: "ipados",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public platform?: ManagedDevicePlatform = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "OS Version",
    description:
      "The version of the operating system the device runs: Android's, iOS's or iPadOS's, Windows' or macOS's.",
    example: "13",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public osVersion?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Build Number",
    description: "The operating system build the device runs.",
    example: "TQ3A.230901.001",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public buildNumber?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Security Patch Level",
    description: "The date of the Android security patch the device has.",
    example: "2024-09-01",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public securityPatchLevel?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Agent Version",
    description: "The version of the service's agent on the device.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public agentVersion?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Service State",
    description:
      "The device's state as the service reports it: Esper's state number (1 online, 20 disabled, 60 offline, 70 factory reset in progress, 30 to 200 provisioning steps). Empty for Intune, whose status is its last check-in.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public providerState?: number = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Check-In",
    description:
      "When the device last checked in with the service. A device that has not checked in for 30 minutes is offline.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastCheckInAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Group ID",
    description: "The service's ID of the group the device is in.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public groupId?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Group",
    description: "The name of the group the device is in.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public groupName?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Group Path",
    description:
      "Where the device's group sits among the service's groups, from the top.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public groupPath?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Kiosk Mode",
    description: "Whether the device runs one app in kiosk mode.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isKioskMode?: boolean = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Battery Level",
    description: "The device's battery charge, in percent, at its last report.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public batteryLevel?: number = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "IP Addresses",
    description: "The device's IP addresses at its last report.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public ipAddresses?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "MAC Address",
    description: "The device's Wi-Fi MAC address, or its Ethernet one.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public macAddress?: string = undefined;

  /*
   * The rest of what the service reports, read by the device's card:
   * memory and storage, its network, its second IMEI, its kernel and
   * bootloader, the app it runs in kiosk mode (ManagedDeviceDetails).
   */
  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Details",
    description:
      "The rest of what the service reports about the device: memory and storage, network, kernel and bootloader versions.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public details?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Provisioned At",
    description: "When the service enrolled the device.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public provisionedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Removed At",
    description:
      "When a read first found the device gone from the service's device list. Empty while it is enrolled.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public removedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Apps Read At",
    description: "When the device's installed apps were last read.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public appsReadAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "App Count",
    description: "How many apps the device had when they were last read.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public appCount?: number = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "inventoryItemId",
    type: TableColumnType.Entity,
    modelType: InventoryItem,
    title: "Inventory Item",
    description: "The device's host in Inventory.",
  })
  @ManyToOne(
    () => {
      return InventoryItem;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "inventoryItemId" })
  public inventoryItem?: InventoryItem = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Inventory Item ID",
    description: "ID of the device's host in Inventory.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public inventoryItemId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(ManagedDeviceHostMatch),
    title: "Inventory Match",
    description:
      "How the device's host in Inventory was found: 'name' (the host telemetry names by the device's name in the service), 'serial-number' (the one host whose host.serial_number or host.name is the device's serial number) or 'created' (none was found, so OneUptime made one).",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public inventoryMatch?: ManagedDeviceHostMatch = undefined;

  /*
   * What the import last wrote to the device's host: its attributes and
   * display name. A value telemetry or a person changed since is left
   * alone (ManagedDeviceInventory), so the import never fights them.
   * Server only.
   */
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Inventory Attributes Written",
    description:
      "What OneUptime last wrote to the device's host in Inventory, so it never overwrites what telemetry or a person changed since.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public inventoryAttributes?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Host Archived On Removal",
    description:
      "Whether OneUptime archived the device's host because the device left the service's device list. It is restored if the device comes back.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isInventoryItemArchivedOnRemoval?: boolean = undefined;
}
