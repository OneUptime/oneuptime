import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import CloudAccount from "./CloudAccount";
import CloudCostGroup from "./CloudCostGroup";
import CloudCostView from "./CloudCostView";
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
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import ServerOwned from "../../Types/Database/ServerOwned";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { CloudCostBasis } from "../../Types/Cloud/CloudCostBasis";
import {
  CloudCostReportPeriod,
  CloudCostReportScope,
} from "../../Types/Cloud/CloudCostReport";
import Recurring from "../../Types/Events/Recurring";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Timezone from "../../Types/Timezone";
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
 * A CLOUD COST REPORT (#11009): what the clouds cost, sent on a schedule to
 * the people who read it rather than open a cost tool - team leads,
 * finance, the executive who signs the budget.
 *
 * It says what it covers (every account, one account, a cost group, or a
 * cost view with its groups), its period (last week, last month or the
 * month so far) and its cost basis (billed, amortized or net, the
 * project's unless set). It goes out weekly or monthly on the workspace
 * summaries' schedule rules (recurringInterval, sendFirstReportAt,
 * timezone: WorkspaceSummaryScheduleUtil), in its creator's time zone:
 *
 *   - by email to people and teams of the project, each through their own
 *     notification settings, and read as each of them may read the costs;
 *   - by email to any address, and as a short message to Slack and
 *     Microsoft Teams channels, for a Cloud admin: read as the person who
 *     added them (outsideRecipientsSetByUserId), while they still may.
 *
 * A report over a cost view can send each group that has a team its own
 * section, to that team's members (isSentToGroupTeams).
 *
 * Who may set one up: whoever may create, edit and delete the Cloud
 * records (the Cloud Resource permissions, as budgets and cost groups).
 * The worker that sends them is Cloud:SendCloudCostReports.
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
@CrudApiEndpoint(new Route("/cloud-cost-report"))
@TableMetadata({
  tableName: "CloudCostReport",
  singularName: "Cloud Cost Report",
  pluralName: "Cloud Cost Reports",
  icon: IconProp.Report,
  tableDescription:
    "What your clouds cost, sent weekly or monthly by email to people, teams and addresses, and to Slack and Microsoft Teams channels: every account, one account, a cost group or a cost view with a section for each group's team.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@Entity({
  name: "CloudCostReport",
})
export default class CloudCostReport extends BaseModel {
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
    description: "Relation to the project this report belongs to.",
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
    description: "ID of the project this report belongs to.",
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
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What the report is called: its emails' subject. One of its kind in the project.",
    example: "Weekly cloud costs by team",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Whether the report goes out on its schedule.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  // ---------- What it covers ----------

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Scope",
    description:
      "What the report covers: AllAccounts, Account (its cloudAccountId), CostGroup (its cloudCostGroupId) or CostView (its cloudCostViewId, with all its groups).",
    defaultValue: CloudCostReportScope.AllAccounts,
    isDefaultValueColumn: true,
    allowedValues: Object.values(CloudCostReportScope),
    example: CloudCostReportScope.CostView,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: CloudCostReportScope.AllAccounts,
  })
  public scope?: CloudCostReportScope = undefined;

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
    description: "The account a report of one account covers.",
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
      "ID of the account a report of one account covers (scope Account).",
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
    manyToOneRelationColumn: "cloudCostViewId",
    type: TableColumnType.Entity,
    modelType: CloudCostView,
    title: "Cost View",
    description: "The cost view a report of a view covers, with its groups.",
  })
  @ManyToOne(
    () => {
      return CloudCostView;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudCostViewId" })
  public cloudCostView?: CloudCostView = undefined;

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
    title: "Cost View ID",
    description:
      "ID of the cost view a report of a view covers (scope CostView).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudCostViewId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudCostGroupId",
    type: TableColumnType.Entity,
    modelType: CloudCostGroup,
    title: "Cost Group",
    description: "The cost group a report of one group covers.",
  })
  @ManyToOne(
    () => {
      return CloudCostGroup;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudCostGroupId" })
  public cloudCostGroup?: CloudCostGroup = undefined;

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
    title: "Cost Group ID",
    description:
      "ID of the cost group a report of one group covers (scope CostGroup).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudCostGroupId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Period",
    description:
      "The days each report covers: LastWeek (Monday to Sunday), LastMonth, or MonthToDate.",
    defaultValue: CloudCostReportPeriod.LastWeek,
    isDefaultValueColumn: true,
    allowedValues: Object.values(CloudCostReportPeriod),
    example: CloudCostReportPeriod.LastMonth,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: CloudCostReportPeriod.LastWeek,
  })
  public period?: CloudCostReportPeriod = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Cost Basis",
    description:
      "The cost basis the report's figures are on: billed, amortized or net. Empty: the project's cost basis.",
    allowedValues: Object.values(CloudCostBasis),
    example: "amortized",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public costBasis?: CloudCostBasis = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Send Each Group's Team Its Section",
    description:
      "For a report of a cost view: each group that has a team gets its own section, by email to that team's members.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isSentToGroupTeams?: boolean = undefined;

  // ---------- Who it goes to ----------

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: User,
    title: "People",
    description:
      "The project's members the report is emailed to, each through their own notification settings and as they may read the costs.",
  })
  @ManyToMany(
    () => {
      return User;
    },
    { eager: false },
  )
  @JoinTable({
    name: "CloudCostReportUser",
    inverseJoinColumn: {
      name: "userId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "cloudCostReportId",
      referencedColumnName: "_id",
    },
  })
  public recipientUsers?: Array<User> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Teams",
    description:
      "The teams whose members the report is emailed to, each as they may read the costs.",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "CloudCostReportTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "cloudCostReportId",
      referencedColumnName: "_id",
    },
  })
  public recipientTeams?: Array<Team> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Email Addresses",
    description:
      "Addresses outside the project the report is emailed to, such as an accountant's: a list of up to 25. Setting them takes Cloud Admin, Project Admin or Project Owner.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public emailAddresses?: Array<string> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Slack Channels",
    description:
      "The Slack channels a short summary is posted to, by name, such as #finops. Setting them takes Cloud Admin, Project Admin or Project Owner.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public slackChannelNames?: Array<string> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Microsoft Teams Channels",
    description:
      "The Microsoft Teams channels a short summary is posted to, by name. Setting them takes Cloud Admin, Project Admin or Project Owner.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public microsoftTeamsChannelNames?: Array<string> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Microsoft Teams Team",
    description:
      "The Microsoft Teams team its channels are in, by name or ID. Empty: the connection's team.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public microsoftTeamsTeamName?: string = undefined;

  /*
   * Whose permissions the addresses outside the project and the channels
   * are read with: the Cloud admin who last set them. They go out only
   * while that person still may set them.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "outsideRecipientsSetByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Outside Recipients Set By",
    description:
      "The Cloud admin who last set the report's addresses and channels: they are read as this person may read the costs.",
    serverOwned: ServerOwned.Always,
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
  @JoinColumn({ name: "outsideRecipientsSetByUserId" })
  public outsideRecipientsSetByUser?: User = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Outside Recipients Set By User ID",
    description:
      "ID of the Cloud admin who last set the report's addresses and channels.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public outsideRecipientsSetByUserId?: ObjectID = undefined;

  // ---------- When it goes out ----------

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Recurring Interval",
    description:
      'How often the report goes out: {"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}, Week or Month. Every week when left out.',
    required: false,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
    transformer: Recurring.getDatabaseTransformer(),
  })
  public recurringInterval?: Recurring = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    title: "Send First Report At",
    description:
      "When the first report goes out: the day of the week (or of the month) and the time of day every report after it keeps. Next Monday (or the 1st) at 09:00 in the report's time zone when left out.",
    required: false,
    type: TableColumnType.Date,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public sendFirstReportAt?: Date = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    title: "Timezone",
    description:
      "The IANA time zone the schedule is read in, such as Europe/Berlin: the report goes out at the same time of day there all year. Left out, the time zone in the creator's profile, or UTC.",
    required: false,
    type: TableColumnType.ShortText,
    example: "Europe/Berlin",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public timezone?: Timezone = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Next Send At",
    description: "When the report goes out next.",
    serverOwned: ServerOwned.Always,
  })
  @Index()
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextSendAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Last Sent At",
    description: "When the report last went out to anyone.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSentAt?: Date = undefined;

  /*
   * What its last send did: when, the days it covered, how many people,
   * addresses and channels it reached, and who it left out and why
   * (CloudCostReportSendResult).
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Last Send Result",
    description:
      "What the last send did: who it reached, and who it left out and why. Written by OneUptime only.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public lastSendResult?: JSONObject = undefined;

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
    description: "Relation to the user who created this report.",
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
    title: "Created by User ID",
    description: "ID of the user who created this report.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
