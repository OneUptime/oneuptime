import AlertSeverity from "./AlertSeverity";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import {
  CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD,
  CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS_TEXT,
  CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
} from "../../Types/Cloud/CloudCommitmentAlerts";
import {
  CLOUD_COST_BASES,
  CLOUD_COST_DEFAULT_BASIS,
  CloudCostBasis,
} from "../../Types/Cloud/CloudCostBasis";
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
} from "typeorm";

/*
 * How Cloud shows a project's costs, and when it alerts on its
 * commitments: one row per project, made with these defaults the first
 * time anything asks for it (CloudCostSettingService.getOrCreateForProject),
 * and edited on Cloud > Settings > Costs.
 *
 *   - The cost basis the pages open on and budgets watch (CloudCostBasis):
 *     amortized unless someone picks another. A person's own pick on a
 *     page wins for them; a budget's own basis wins for it.
 *   - Commitment alerts (CloudCommitmentAlertEvaluator): how many days
 *     before a commitment ends to alert, the utilization under which a
 *     week of a commitment's use is alerted, and the coverage under which
 *     an account's falling coverage is - with the severity, on-call
 *     policies and owners the alerts take, as a budget's do.
 *
 * Who may change it: those who may change cloud resources, as a budget.
 */
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

const writePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditCloudResource,
];

const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: writePermissions,
};

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: [],
};

/*
 * No MCP tools: a project has one row, made on first use, which create and
 * delete tools would only get in the way of. The API reads and changes it.
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/cloud-cost-setting"))
@Entity({
  name: "CloudCostSetting",
})
@TableMetadata({
  tableName: "CloudCostSetting",
  singularName: "Cloud Cost Setting",
  pluralName: "Cloud Cost Settings",
  icon: IconProp.Billing,
  tableDescription:
    "How Cloud shows a project's costs - billed, amortized or net - and when it alerts on the project's Savings Plans, reservations and committed use discounts.",
})
@TableAccessControl({
  create: writePermissions,
  read: readPermissions,
  update: writePermissions,
  delete: writePermissions,
})
@Index(["projectId"], { unique: true })
export default class CloudCostSetting extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project these settings belong to.",
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

  // The unique index on the class is the index this column needs.
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project these settings belong to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Cost Basis",
    description:
      "The cost basis the Cloud pages open on and budgets watch unless they pick their own: billed, amortized (commitment fees spread over what they cover) or net (less credits, refunds and discounts).",
    defaultValue: CLOUD_COST_DEFAULT_BASIS,
    isDefaultValueColumn: true,
    allowedValues: [...CLOUD_COST_BASES],
    example: "amortized",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: CLOUD_COST_DEFAULT_BASIS,
  })
  public costBasis?: CloudCostBasis = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    canReadOnRelationQuery: true,
    title: "Alert On Commitments",
    description:
      "Whether OneUptime alerts before a commitment ends, while one is under-used, and when an account's coverage falls.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isCommitmentAlertsEnabled?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Alert Before a Commitment Ends",
    description:
      "How many days before a commitment ends to alert, separated by commas. Each is one alert.",
    defaultValue: CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS_TEXT,
    isDefaultValueColumn: true,
    example: "90, 30, 7",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: CLOUD_COMMITMENT_DEFAULT_EXPIRY_DAYS_TEXT,
  })
  public commitmentExpiryAlertDays?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    canReadOnRelationQuery: true,
    title: "Alert When Utilization Is Below",
    description:
      "A commitment whose last 7 days' utilization is below this percent alerts, with what its unused part cost.",
    defaultValue: CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
    isDefaultValueColumn: true,
    example: "80",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: CLOUD_COMMITMENT_DEFAULT_UTILIZATION_THRESHOLD,
  })
  public commitmentUtilizationThreshold?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "Alert When Coverage Falls Below",
    description:
      "An account whose commitments' coverage falls below this percent alerts. Empty: coverage does not alert.",
    defaultValue: CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD,
    isDefaultValueColumn: true,
    example: "60",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: CLOUD_COMMITMENT_DEFAULT_COVERAGE_THRESHOLD,
  })
  public commitmentCoverageThreshold?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "commitmentAlertSeverityId",
    type: TableColumnType.Entity,
    modelType: AlertSeverity,
    title: "Commitment Alert Severity",
    description: "The severity of the alerts commitments raise.",
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
  @JoinColumn({ name: "commitmentAlertSeverityId" })
  public commitmentAlertSeverity?: AlertSeverity = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Commitment Alert Severity ID",
    description:
      "ID of the severity of the alerts commitments raise. Empty: the project's least severe.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public commitmentAlertSeverityId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OnCallDutyPolicy,
    title: "Commitment On-Call Policies",
    description: "The on-call policies the alerts commitments raise page.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "CloudCostSettingOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "cloudCostSettingId",
      referencedColumnName: "_id",
    },
  })
  public commitmentOnCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: User,
    title: "Commitment Alert Owner Users",
    description:
      "People who own the alerts commitments raise, and are told of them.",
  })
  @ManyToMany(
    () => {
      return User;
    },
    { eager: false },
  )
  @JoinTable({
    name: "CloudCostSettingOwnerUser",
    inverseJoinColumn: {
      name: "userId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "cloudCostSettingId",
      referencedColumnName: "_id",
    },
  })
  public commitmentAlertOwnerUsers?: Array<User> = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Commitment Alert Owner Teams",
    description:
      "Teams who own the alerts commitments raise, and are told of them.",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "CloudCostSettingOwnerTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "cloudCostSettingId",
      referencedColumnName: "_id",
    },
  })
  public commitmentAlertOwnerTeams?: Array<Team> = undefined;

  /*
   * What the commitment alerts know between checks: each account's last
   * coverage, so a fall below the threshold is told once, and the alerts
   * it raised for it. Server only.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Commitment Alert State",
    description:
      "What the commitment alerts last saw of each account's coverage. Used by OneUptime only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public commitmentAlertState?: JSONObject = undefined;
}
