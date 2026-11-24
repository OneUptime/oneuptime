import CloudAccount from "./CloudAccount";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * AN OFF-HOURS SCHEDULE (#11010): stop non-production instances and
 * databases outside working hours, and start them again.
 *
 * A schedule picks its resources by a cloud tag of the team's own
 * (Schedule=office-hours), in one account or every account, and says
 * when they run: the working days, and the hours on them, in a time zone.
 * Outside those hours a worker stops every running resource it picks
 * (CloudOffHoursScheduler); inside them it starts again only what it
 * stopped itself, never what a person stopped. The saving is the hours
 * each stopped resource did not run (CloudSavingsAction.savedHours).
 *
 * It never touches production: a resource is stopped only when it is
 * known not to be (Types/Cloud/CloudResourceEnvironment - its environment
 * tag, its account, its labels). A tagged resource that is production, or
 * whose environment nothing says, is left running, and the schedule says
 * so. Each stop and start goes through the account's cloud connection, so
 * only where its Savings actions setting is on.
 *
 * Who may set one: those who may change the cloud resources, as a budget's.
 */

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateCloudResource,
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

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditCloudResource,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteCloudResource,
];

@EnableDocumentation()
@EnableMCP()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/cloud-off-hours-schedule"))
@TableMetadata({
  tableName: "CloudOffHoursSchedule",
  singularName: "Off-Hours Schedule",
  pluralName: "Off-Hours Schedules",
  icon: IconProp.Moon,
  tableDescription:
    "Schedules that stop non-production instances and databases outside working hours and start them again, picked by a cloud tag. The saving is the hours they no longer run.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@Entity({
  name: "CloudOffHoursSchedule",
})
export default class CloudOffHoursSchedule extends BaseModel {
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this schedule belongs to.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this schedule belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "What the schedule is called.",
    example: "Office hours",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Description",
    description: "What the schedule is for, in your team's words.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "Is Enabled",
    description: "Whether the schedule stops and starts its resources.",
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
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudAccountId",
    type: TableColumnType.Entity,
    modelType: CloudAccount,
    title: "Cloud Account",
    description:
      "The account whose resources the schedule stops. Empty: every account of the project.",
  })
  @ManyToOne(
    () => {
      return CloudAccount;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudAccountId" })
  public cloudAccount?: CloudAccount = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Cloud Account ID",
    description:
      "ID of the account whose resources the schedule stops. Empty: every account of the project.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudAccountId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    title: "Tag Key",
    description:
      "The cloud tag that picks the resources the schedule stops, such as Schedule.",
    example: "Schedule",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: false,
    length: ColumnLength.LongText,
  })
  public tagKey?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    title: "Tag Value",
    description:
      "The tag's value on the resources the schedule stops, such as office-hours.",
    example: "office-hours",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: false,
    length: ColumnLength.LongText,
  })
  public tagValue?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Time Zone",
    description:
      "The time zone the working hours are in, as the IANA database names it.",
    defaultValue: "UTC",
    isDefaultValueColumn: true,
    example: "Europe/Berlin",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
    default: "UTC",
  })
  public timezone?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Working Days",
    description:
      "The days resources run: Monday to Sunday. Every other day they stay stopped.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public workingDays?: Array<string> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Start Time",
    description:
      "When the resources start on a working day, as HH:MM on a 24-hour clock.",
    defaultValue: "08:00",
    isDefaultValueColumn: true,
    example: "08:00",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
    default: "08:00",
  })
  public startTime?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Stop Time",
    description:
      "When the resources stop on a working day, as HH:MM on a 24-hour clock.",
    defaultValue: "19:00",
    isDefaultValueColumn: true,
    example: "19:00",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
    default: "19:00",
  })
  public stopTime?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "Stops Instances",
    description: "Whether the schedule stops virtual machines and instances.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public stopsInstances?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "Stops Databases",
    description: "Whether the schedule stops databases (Amazon RDS).",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public stopsDatabases?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Run At",
    description: "When the schedule last looked at its resources.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastRunAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Last Run Summary",
    description:
      "What the schedule found and did last: the resources its tag matched, those it stopped and started, those it left alone and why, and the hours it saved this month.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public lastRunSummary?: JSONObject = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description: "Relation to the user who created this schedule.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Created by User ID",
    description: "ID of the user who created this schedule.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
