import UniqueNameWhenRequired from "../../Types/Database/UniqueNameWhenRequired";
import UNSYNCHRONIZED_INDEX from "../../Types/Database/UnsynchronizedIndex";
import AlertSeverity from "./AlertSeverity";
import CloudAccount from "./CloudAccount";
import CloudCostGroup from "./CloudCostGroup";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
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
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import {
  CloudBudgetPeriod,
  CloudBudgetPlanSplit,
  CloudBudgetScope,
  CloudBudgetUnusualDayUnit,
} from "../../Types/Cloud/CloudBudget";
import { CloudCostBasis } from "../../Types/Cloud/CloudCostBasis";
import { CloudCostRule } from "../../Types/Cloud/CloudCostRules";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
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
  ValueTransformer,
} from "typeorm";

/*
 * A budget for what the connected clouds cost, in one currency (#11008):
 *
 *   - for every account of the project, one account, a cost group as its
 *     rules sort the spend now (#11006), or a filter written as a group's
 *     rules are - "all of EC2 in eu-west-1" (scope);
 *   - for a calendar month, a quarter or a year, the quarters and the year
 *     from the fiscal year's first month (period, fiscalYearStartMonth);
 *   - for an amount each period (monthlyAmount, named from when every
 *     budget was monthly) or, a yearly budget, twelve monthly shares: equal,
 *     or one typed for each month (planSplit, monthlyPlan).
 *
 * A worker compares each enabled budget with what its scope cost in its
 * window so far - its period, or the month of a split year - and where it
 * is heading: the rest of this month at the last full week's pace, and the
 * window's later months as forecast (CloudBudgetEvaluator). The first time
 * in a window the spend passes each threshold - 80% and 100% of the budget
 * by default - and when the window is on course to pass it, the budget
 * tells someone: below 100%, the people it names (the cost group's team,
 * and those picked) through their own notification settings, with no
 * alert; at 100% and when on course to pass - and at every threshold of a
 * budget with nobody to tell - an alert that pages its on-call policies.
 * Unless turned off, a day that cost far more than usual is an alert too.
 * A new window starts again from nothing, and the last one's alerts are
 * resolved.
 *
 * A budget made before scopes and periods were is a monthly one, for every
 * account or one, and is checked exactly as it was: from its accounts' cost
 * summaries.
 *
 * Who may set one: those who may change the cloud resources (the Cloud
 * Resource permissions, as an account's are).
 *
 * The MCP server has its create, get, list, update, delete and count tools,
 * and the CLI its `cloud-budget` command, so AI agents and scripts manage
 * budgets as people do.
 */

// Postgres answers a decimal as text: read it back as the number it is.
const decimalTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return value;
  },
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number") {
      return value;
    }
    const parsed: number = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  },
};

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
@CrudApiEndpoint(new Route("/cloud-budget"))
@TableMetadata({
  tableName: "CloudBudget",
  singularName: "Cloud Budget",
  pluralName: "Cloud Budgets",
  icon: IconProp.Wallet,
  tableDescription:
    "Budgets for what your connected clouds cost: for every account, one account, a cost group or a filter of services, Regions and tags, each month, quarter or year. OneUptime tells the budget's people as the spend passes each threshold, and alerts at the budget and when the period is on course to pass it.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
/*
 * Serves the lookup of a name the project requires to be one of its kind
 * (RequiredUniqueNames, #10761): the project and the name as it reads, an
 * expression index built by migration 1809187640010-AddUniqueNameIndexes
 * that @Index() cannot express. Declared here only so the schema builder
 * leaves it alone (UNSYNCHRONIZED_INDEX).
 */
@Index(
  "IDX_CLOUDBUDGET_PROJECT_NAME_KEY",
  ["projectId", "name"],
  UNSYNCHRONIZED_INDEX,
)
@Entity({
  name: "CloudBudget",
})
export default class CloudBudget extends BaseModel {
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
    description: "Relation to the project this budget belongs to.",
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
    description: "ID of the project this budget belongs to.",
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
  @UniqueNameWhenRequired()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "What the budget is called.",
    example: "Production AWS",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "What the budget is for, in your team's words.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
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
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Whether the budget is watched and raises alerts.",
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
      "The account the budget is for. Empty: every account of the project.",
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
      "ID of the account the budget is for. Empty: every account of the project.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudAccountId?: ObjectID = undefined;

  /*
   * What the budget counts (CloudBudgetScope): every account, one account
   * (cloudAccountId), a cost group (cloudCostGroupId) or a filter
   * (filterRules). A budget made before scopes were is every account's, or
   * its account's (migration 1809187771008).
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudBudgetScope),
    title: "Scope",
    description:
      "What the budget counts: allAccounts (every account), account (the Cloud Account ID's), costGroup (the Cloud Cost Group ID's, as its rules sort the spend now) or filter (the costs the Filter's rules match).",
    defaultValue: CloudBudgetScope.AllAccounts,
    isDefaultValueColumn: true,
    example: "costGroup",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: CloudBudgetScope.AllAccounts,
  })
  public scope?: CloudBudgetScope = undefined;

  /*
   * A cost group's budget counts what the group is charged, as its rules,
   * line items and share of shared costs make it now: a changed rule
   * restates the period. A group deleted leaves the budget, unchecked, to
   * be pointed at another group or deleted.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudCostGroupId",
    type: TableColumnType.Entity,
    modelType: CloudCostGroup,
    title: "Cloud Cost Group",
    description: "The cost group the budget is for, when its scope is one.",
  })
  @ManyToOne(
    () => {
      return CloudCostGroup;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
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
    title: "Cloud Cost Group ID",
    description:
      "ID of the cost group the budget is for, when its scope is costGroup.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudCostGroupId?: ObjectID = undefined;

  /*
   * A filter budget's costs, written as a cost group's rules are
   * (CloudCostRules): a cost counts when any rule matches it, a rule when
   * all its conditions do. Checked on every write (CloudBudgetService), and
   * every record a rule names is the project's.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Filter",
    description:
      'The costs a filter budget counts, as a cost group\'s rules are written: a list of rules, any of which matches. A rule is {"conditions": [...]}, all of which must match; a condition is {"field", "operator", "values"} and, for a tag, "key". Fields: account, provider, service, region, resource, tag, ownerTeam, label, environment, app, kubernetesCluster, kubernetesNamespace.',
    example:
      '[{"conditions":[{"field":"service","operator":"is","values":["Amazon Elastic Compute Cloud - Compute"]},{"field":"region","operator":"is","values":["eu-west-1"]}]}]',
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public filterRules?: Array<CloudCostRule> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Amount",
    description:
      "What each period may cost, in its currency. A year split by month: the year's total.",
    example: "5000",
  })
  @Column({
    nullable: false,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public monthlyAmount?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Currency",
    description:
      "The currency of the amount, as the clouds bill the accounts: an account billed in another is not counted.",
    defaultValue: "USD",
    isDefaultValueColumn: true,
    example: "USD",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "USD",
  })
  public currency?: string = undefined;

  /*
   * The cost the budget watches (CloudCostBasis): billed, amortized or
   * net. Empty follows the project's cost basis (CloudCostSetting), which
   * is amortized unless someone picks another.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudCostBasis),
    title: "Cost Basis",
    description:
      "The cost the budget watches: billed, amortized or net. Empty follows the project's cost basis, set in Cloud settings.",
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
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudBudgetPeriod),
    title: "Period",
    description:
      "How long the amount is for: month (a calendar month), quarter or year. Quarters and years start in the Fiscal Year Start Month. All in UTC, as the clouds bill.",
    defaultValue: CloudBudgetPeriod.Month,
    isDefaultValueColumn: true,
    example: "quarter",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: CloudBudgetPeriod.Month,
  })
  public period?: CloudBudgetPeriod = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Fiscal Year Start Month",
    description:
      "The month a quarterly or yearly budget's year starts in, 1 (January) to 12 (December): 4 for a fiscal year from April.",
    defaultValue: 1,
    isDefaultValueColumn: true,
    example: "4",
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: 1,
  })
  public fiscalYearStartMonth?: number = undefined;

  /*
   * A yearly budget checked month by month (CloudBudgetPlanSplit): each
   * month against its share - an equal twelfth, or monthlyPlan's - rather
   * than the year so far against the year's amount.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudBudgetPlanSplit),
    title: "Plan",
    description:
      "How a yearly budget's amount is spread: none (the whole year), equal (twelve equal months) or byMonth (the Monthly Plan's amounts). A split budget is checked month by month against each month's share.",
    defaultValue: CloudBudgetPlanSplit.None,
    isDefaultValueColumn: true,
    example: "byMonth",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: CloudBudgetPlanSplit.None,
  })
  public planSplit?: CloudBudgetPlanSplit = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Monthly Plan",
    description:
      "A yearly budget's twelve monthly amounts, in its currency, from the fiscal year's first month on, when its Plan is byMonth. Their total is the budget's amount.",
    example: "[800,800,900,900,900,1000,1000,1100,1200,1600,900,800]",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public monthlyPlan?: Array<number> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Alert At",
    description:
      "The shares of the budget, in percent, comma separated, that tell someone the first time in a period the spend passes each: below 100 the budget's people, with no alert when it names any; from 100, an alert.",
    defaultValue: "80,100",
    isDefaultValueColumn: true,
    example: "80,100",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "80,100",
  })
  public alertThresholds?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Alert When On Course To Pass",
    description:
      "Also alert when the period is on course to pass the budget - the rest of this month at the pace of the last full week, the months after it as forecast - before the money is spent.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public alertOnProjection?: boolean = undefined;

  /*
   * A day that cost far more than usual - a service at twice its usual day,
   * or the whole account at half again (CloudCostAnomaly) - is an alert of
   * its own, the day after: a budget sees a month, and a spike adds up for
   * days before it passes a share of one.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Alert On Unusual Days",
    description:
      "Also alert when a day costs far more than usual: a service at twice its usual day, or the whole account at one and a half times.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public alertOnAnomaly?: boolean = undefined;

  /*
   * A budget's own unusual day, in place of the project-wide rule: a day of
   * its scope at least this far above its usual - an amount in its
   * currency, or a percentage (with at least 10 more than usual) - judged
   * on the scope's own daily spend. Empty: the project-wide rule.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Unusual Day Threshold",
    description:
      "How far above its usual a day of the budget's scope must cost to be unusual, in the Unusual Day Threshold Unit. Empty: the project-wide rule (a service at twice its usual day, the scope at one and a half times).",
    example: "250",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public unusualDayThreshold?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudBudgetUnusualDayUnit),
    title: "Unusual Day Threshold Unit",
    description:
      "What the Unusual Day Threshold is: amount (in the budget's currency) or percent (of the usual day, with at least 10 more than usual).",
    example: "percent",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public unusualDayThresholdUnit?: CloudBudgetUnusualDayUnit = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "alertSeverityId",
    type: TableColumnType.Entity,
    modelType: AlertSeverity,
    title: "Alert Severity",
    description: "The severity of the alerts the budget raises.",
  })
  @ManyToOne(
    () => {
      return AlertSeverity;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertSeverityId" })
  public alertSeverity?: AlertSeverity = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Alert Severity ID",
    description:
      "ID of the severity of the alerts the budget raises. Empty: the project's least severe.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OnCallDutyPolicy,
    title: "On-Call Policies",
    description: "The on-call policies the budget's alerts page.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "CloudBudgetOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "cloudBudgetId",
      referencedColumnName: "_id",
    },
  })
  public onCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined;

  /*
   * Who hears of the budget besides its on-call policies: below 100% they
   * are told with no alert raised, each through their own notification
   * settings (email, and Slack, Microsoft Teams and the rest as they turned
   * them on); from 100%, they own the alert. A cost group's budget tells
   * the group's team too, unless this is off.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Notify Cost Group Team",
    description:
      "For a cost group's budget: whether the group's team is notified, with the Notify Users and Notify Teams.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public notifyCostGroupTeam?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: User,
    title: "Notify Users",
    description:
      "The people told as the spend passes each threshold, each through their own notification settings. Below 100% they are told with no alert; from 100% they own the alert.",
  })
  @ManyToMany(
    () => {
      return User;
    },
    { eager: false },
  )
  @JoinTable({
    name: "CloudBudgetNotifyUser",
    inverseJoinColumn: {
      name: "userId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "cloudBudgetId",
      referencedColumnName: "_id",
    },
  })
  public notifyUsers?: Array<User> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Notify Teams",
    description:
      "The teams whose members are told as the spend passes each threshold, each through their own notification settings. Below 100% they are told with no alert; from 100% they own the alert.",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "CloudBudgetNotifyTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "cloudBudgetId",
      referencedColumnName: "_id",
    },
  })
  public notifyTeams?: Array<Team> = undefined;

  /*
   * What the worker last found, for the Budgets page: this month's spend so
   * far and its projection, the period's, in the budget's currency, and
   * when. A monthly budget's month is its period.
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Spent This Month",
    description: "What the accounts cost this month so far, when last checked.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public spentThisMonth?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Projected This Month",
    description:
      "What the accounts are on course to cost this month, at the pace of the last full week, when last checked.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public projectedThisMonth?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Spent This Period",
    description:
      "What the budget's scope cost in its current period so far (its month, quarter or year), when last checked.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public spentThisPeriod?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Projected This Period",
    description:
      "What the budget's scope is on course to cost by the end of its period, when last checked: the rest of this month at the pace of the last full week, and the period's later months as forecast.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public projectedThisPeriod?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Checked At",
    description:
      "When the budget was last compared with what the accounts cost.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastCheckedAt?: Date = undefined;

  /*
   * This month's alerts, so each threshold alerts once a month: which month,
   * the thresholds passed and whether the projection passed, and the alerts
   * raised. Server only.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Alert State",
    description:
      "Which of this month's alerts the budget raised. Used by OneUptime only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public alertState?: JSONObject = undefined;

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
    description: "Relation to the user who created this budget.",
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
    description: "ID of the user who created this budget.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
