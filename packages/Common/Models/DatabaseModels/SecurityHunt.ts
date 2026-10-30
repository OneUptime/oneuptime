import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import {
  DEFAULT_SECURITY_HUNT_TIME_RANGE,
  SecurityHuntSchedule,
} from "../../Types/SecurityEvent/SecurityHunt";
import TimeRange from "../../Types/Time/TimeRange";
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
 * A hunt: a search over the project's security events, saved with a name
 * (Types/SecurityEvent/SecurityHunt has the rules). It holds the Events
 * search bar's text and the sidebar's chips, and how far back it looks when
 * it is opened; opened, it is the Events explorer with that search.
 *
 * It can run on a schedule (SecurityHuntScheduler): each run reads the
 * events that arrived since the run before, with the read access of the
 * person who set the schedule (scheduledByUserId), and when its search
 * finds any it tells the people and teams named here. OneUptime keeps what
 * each run found on the hunt; nobody writes those columns.
 *
 * A scheduled hunt watches the events the way a detection rule does, so it
 * is kept like one: whoever may create, edit or delete detection rules
 * creates, edits or deletes hunts, and every Security tier reads them.
 * Every change a person makes is audited; the runs' own bookkeeping is not.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadProjectDetectionRule,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateProjectDetectionRule,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditProjectDetectionRule,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.DeleteProjectDetectionRule,
];

const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
};

// What OneUptime writes as the hunt runs: read by every Security tier, written by none.
const runColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
/*
 * A scheduled hunt records each run on itself; a run is not a change anyone
 * made, so only what people change is audited.
 */
@EnableAuditLog({
  ignoreColumns: [
    "searchedUpToAt",
    "nextRunAt",
    "lastRunAt",
    "lastRunEventCount",
    "lastRunError",
    "lastFoundAt",
    "lastFoundSinceAt",
    "lastFoundEventCount",
  ],
})
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@CrudApiEndpoint(new Route("/security-hunt"))
@Entity({
  name: "SecurityHunt",
})
@TableMetadata({
  tableName: "SecurityHunt",
  singularName: "Hunt",
  pluralName: "Hunts",
  icon: IconProp.ViewfinderCircle,
  tableDescription:
    "Searches over security events saved with a name, to open again or to run on a schedule that tells people when it finds something.",
})
@Index(["nextRunAt"])
export default class SecurityHunt extends BaseModel {
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
    description: "Relation to the project this hunt belongs to.",
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
    description: "ID of the project this hunt belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What the hunt looks for, in a few words. At most 100 characters.",
    example: "Encoded PowerShell",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Description",
    description:
      "Why the hunt matters and what to do when it finds something, for whoever opens it later.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: true,
    title: "Search",
    description:
      "What the hunt searches for, in the Events search bar's language: words a message contains, fields such as severity:High or user:alice, and source attributes such as @threat.matched:true. At most 2,000 characters.",
    example: "processname:powershell.exe commandline:-enc",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public searchQuery?: string = undefined;

  /*
   * The chips the hunt keeps beside its search, as the Events sidebar makes
   * them: { "<facet key>": ["<value>", ...] }, the key `!`-prefixed for the
   * values it leaves out.
   */
  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Filters",
    description:
      "The Events sidebar's filters kept beside the search: each field's values, or with ! before the field the values it leaves out. At most 50 values.",
    // A source attribute's field is attributes.<key>.
    example: {
      severityName: ["High", "Critical"],
      "!statusName": ["Success"],
    },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public filters?: JSONObject = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Time Range",
    description:
      "How far back the hunt searches when it is opened, as the Events time picker names it: Past 1 Hour, Past 1 Day, Past 1 Week, Past 1 Month and the rest.",
    defaultValue: DEFAULT_SECURITY_HUNT_TIME_RANGE,
    isDefaultValueColumn: true,
    example: TimeRange.PAST_ONE_WEEK,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: DEFAULT_SECURITY_HUNT_TIME_RANGE,
  })
  public timeRange?: TimeRange = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Schedule",
    description:
      "How often the hunt runs on its own and tells people what it found: Not Scheduled, Every Hour, Every 6 Hours, Every Day or Every Week. Each run searches the events that arrived since the run before.",
    defaultValue: SecurityHuntSchedule.NotScheduled,
    isDefaultValueColumn: true,
    example: SecurityHuntSchedule.EveryDay,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityHuntSchedule.NotScheduled,
  })
  public schedule?: SecurityHuntSchedule = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: User,
    title: "Notify Users",
    description:
      "The people told when a scheduled run finds events, each as their notification settings say. Only people who can read security events are told.",
  })
  @ManyToMany(
    () => {
      return User;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SecurityHuntNotifyUser",
    inverseJoinColumn: {
      name: "userId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "securityHuntId",
      referencedColumnName: "_id",
    },
  })
  public notifyUsers?: Array<User> = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Notify Teams",
    description:
      "The teams whose members are told when a scheduled run finds events, each as their notification settings say. Only members who can read security events are told.",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SecurityHuntNotifyTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "securityHuntId",
      referencedColumnName: "_id",
    },
  })
  public notifyTeams?: Array<Team> = undefined;

  /*
   * Whose read access the scheduled runs use: the person who last set the
   * schedule or changed what the hunt searches for. Stamped by OneUptime
   * from the caller (SecurityHuntService); no request chooses it.
   */
  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "scheduledByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Scheduled By User",
    description:
      "The person the hunt's scheduled runs run as, and read what they can read: whoever last set its schedule, changed its search or saved its schedule as it was.",
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
  @JoinColumn({ name: "scheduledByUserId" })
  public scheduledByUser?: User = undefined;

  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Scheduled By User ID",
    description: "ID of the person the hunt's scheduled runs run as.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledByUserId?: ObjectID = undefined;

  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Searched Up To",
    description:
      "How far the scheduled runs have searched: the next run reads the events from here on. Set to the moment the schedule is set or the search changes.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public searchedUpToAt?: Date = undefined;

  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Next Run At",
    description:
      "When the hunt next runs on its schedule. Empty for a hunt that is not scheduled.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextRunAt?: Date = undefined;

  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Run At",
    description:
      "When the hunt last ran on its schedule, whether it found anything or not.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastRunAt?: Date = undefined;

  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Last Run Event Count",
    description: "How many events the hunt's last scheduled run found.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public lastRunEventCount?: number = undefined;

  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Last Run Error",
    description:
      "Why the hunt's last scheduled run could not be made. Empty when it ran.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public lastRunError?: string = undefined;

  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Found At",
    description:
      "The end of the events the last run that found something searched: what it found arrived before this.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastFoundAt?: Date = undefined;

  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Last Found Since",
    description:
      "The start of the events the last run that found something searched: what it found arrived after this.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastFoundSinceAt?: Date = undefined;

  @ColumnAccessControl(runColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Last Found Event Count",
    description: "How many events the last run that found something found.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public lastFoundEventCount?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person who saved the hunt.",
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
    title: "Created By User ID",
    description: "ID of the person who saved the hunt.",
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
    description: "The person who deleted the hunt.",
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
    description: "ID of the person who deleted the hunt.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
