import NetworkSite from "./NetworkSite";
import Project from "./Project";
import User from "./User";
import RuleBaseModel from "./DatabaseBaseModel/RuleBaseModel";
import Route from "../../Types/API/Route";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import ListOrderColumn from "../../Types/Database/ListOrderColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

/*
 * A NAMING RULE: what the network devices it matches are called (OneUptime
 * issue #6619).
 *
 * Which devices - its conditions on their IP address, discovered name, MAC
 * address, vendor and site - and a name pattern, such as
 * "UN{site.code}{lookup}", whose placeholders are filled in from each
 * device (Utils/NetworkDevice/Naming/NamePattern). A rule may carry a lookup
 * table - the last part of each device's address, its address, its MAC or
 * its discovered name, each with the value it stands for - that the pattern
 * puts where it says {lookup}.
 *
 * Rules are kept in order: the first enabled rule, from the top, that
 * matches a device and has every value its pattern needs names it
 * (DeviceNamingPlanner). A discovery import names each device it creates
 * that way (NetworkDeviceNamingRuleEngineService), and the rules can be
 * applied to the devices already in the project from the rules page and the
 * Devices list, after a preview.
 *
 * Who may write a rule decides what devices are called, so the rule's own
 * permissions are asked, as for the site assignment rules that decide where
 * they are.
 */
const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadNetworkDeviceNamingRule,
];

const CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateNetworkDeviceNamingRule,
];

const UPDATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditNetworkDeviceNamingRule,
];

const DELETE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteNetworkDeviceNamingRule,
];

@EnableDocumentation()
@TenantColumn("projectId")
@ListOrderColumn({
  column: "priority",
  scopeColumns: ["projectId"],
  sortOrder: SortOrder.Descending,
})
@TableAccessControl({
  create: CREATE_PERMISSIONS,
  read: READ_PERMISSIONS,
  delete: DELETE_PERMISSIONS,
  update: UPDATE_PERMISSIONS,
})
@CrudApiEndpoint(new Route("/network-device-naming-rule"))
@Entity({
  name: "NetworkDeviceNamingRule",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "NetworkDeviceNamingRule",
  singularName: "Network Device Naming Rule",
  pluralName: "Network Device Naming Rules",
  icon: IconProp.Label,
  tableDescription:
    "Rules that name network devices by your naming convention: which devices, and a name pattern such as UN{site.code}{lookup}. The first enabled rule that matches a device names it when discovery imports it, and the rules can be applied to the devices you already have.",
})
export default class NetworkDeviceNamingRule extends RuleBaseModel {
  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
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
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "A name for this rule, such as Menu boards.",
    example: "Menu boards",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "What this rule is for.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description:
      "Whether this rule names devices. A disabled rule is skipped and the next one is tried.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: false,
    type: TableColumnType.Number,
    title: "Priority",
    description:
      "Where this rule sits in the list: the first enabled rule from the top that matches a device, and has every value its name pattern needs, names it. The rule at the top has the highest number. A new rule is added to the end of the list, with the lowest number. Setting a number another rule already has puts this rule in that place, and the rules in the way move one place along to make room. In the dashboard, drag the rows to reorder them.",
    example: "0",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public priority?: number = undefined;

  // Match criteria: the conditions the rule builder stores in `criteria`.

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "IP Address",
    description:
      "Only devices whose IP address is in this range: a CIDR such as 10.48.145.0/24, or octet ranges such as 10.0-255.0-255.150-159, where * is any number (10.*.*.51). Leave empty to match any address.",
    example: "10.*.*.51",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public ipMatchTarget?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Discovered Name",
    description:
      "Regex or * wildcard pattern (case-insensitive) matched against the name discovery found for the device. Leave empty to match any name.",
    example: "dmb-*",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public discoveredNamePattern?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "MAC Address",
    description:
      "Regex or * wildcard pattern (case-insensitive) matched against the device's MAC address, in any spelling: 00:05:0b*, 00-05-0B* and 00050b* match the same devices. Leave empty to match any MAC address.",
    example: "00:05:0b*",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public macAddressPattern?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Vendor",
    description:
      "Regex or * wildcard pattern (case-insensitive) matched against who made the device. Leave empty to match any vendor.",
    example: "Samsung*",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public vendorPattern?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: NetworkSite,
    title: "Site",
    description:
      "Only devices in one of these sites, or in a site below one of them. Leave empty to match devices in any site, or in none.",
  })
  @ManyToMany(
    () => {
      return NetworkSite;
    },
    { eager: false },
  )
  @JoinTable({
    name: "NetworkDeviceNamingRuleSite",
    inverseJoinColumn: {
      name: "networkSiteId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "networkDeviceNamingRuleId",
      referencedColumnName: "_id",
    },
  })
  public sites?: Array<NetworkSite> = undefined;

  // What matched devices are called.

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Name Pattern",
    description:
      "What matched devices are called. Text, with placeholders in curly braces filled in from each device: {site.code}, {site}, {discoveredName}, {ip}, {ip.1} to {ip.4}, {mac}, {vendor} and {lookup}, the value of the rule's lookup table. {n}, {nn}, {nnn} or {nnnn} is the lowest number that makes the name unique. A placeholder can be followed by filters: {vendor|first:3|upper}, with upper, lower, first:N, last:N, digits and nospaces.",
    example: "UN{site.code}{lookup}",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public namePattern?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Lookup Table Key",
    description:
      "What the rows of the lookup table are keyed by: lastIpOctet (the last part of the device's IP address), ipAddress, macAddress or discoveredName.",
    example: "lastIpOctet",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public lookupKey?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: UPDATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Lookup Table",
    description:
      "Rows of a key and the value it stands for, put where the name pattern says {lookup}. A device whose key has no row is left to the next rule.",
    example: [
      { key: "51", value: "MNUPLR01" },
      { key: "151", value: "MNUSCR01" },
    ],
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public lookupEntries?: JSONArray = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
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
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
