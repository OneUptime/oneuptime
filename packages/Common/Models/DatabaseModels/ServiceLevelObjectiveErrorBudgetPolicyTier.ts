import AlertSeverity from "./AlertSeverity";
import IncidentSeverity from "./IncidentSeverity";
import Label from "./Label";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import Project from "./Project";
import ServiceLevelObjective from "./ServiceLevelObjective";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
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
 * Postgres returns `decimal` columns as strings; convert back to numbers so
 * callers see floats. Mirrors the decimal transformer used by
 * ServiceLevelObjectiveBurnRateRule.
 */
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
    return isNaN(parsed) ? null : parsed;
  },
};

/*
 * ONE TIER OF AN SLO'S ERROR BUDGET POLICY: a budget-left threshold, a name,
 * what the team agreed to do while the SLO is in it, and whether it freezes
 * deployments - the yes/no CI/CD reads on the SLO as deploymentsAllowed
 * (Common/Utils/Slo/SloErrorBudgetPolicy explains the policy, how the tier
 * an SLO is in is decided, and the deploy gate).
 *
 * A model of its own rather than a "budget left" condition on burn rate
 * rules: rules fire independently of each other, while tiers are mutually
 * exclusive states - an SLO is in one tier at a time, the tier it is in is
 * read on the Overview and through the API (ServiceLevelObjective
 * .currentErrorBudgetPolicyTier*), and entering a more severe tier
 * supersedes the one it was in. A burn rate condition and a budget level
 * share no columns but the outputs.
 *
 * The outputs are the burn rate rule's, column for column and with the same
 * names (shouldCreateAlert, the alert and incident options, the lifecycle
 * stamps), so the evaluation worker raises and resolves both through one
 * code path and the Dashboard reuses the rule form's fields. Two defaults
 * differ, on purpose: a tier raises nothing until someone switches an output
 * on - most of a policy is the agreement, not a page - so shouldCreateAlert
 * defaults to false here, and there is no re-fire suppression, because the
 * tier hysteresis already keeps a budget hovering at a threshold from
 * flapping.
 *
 * Editing a tier is an edit to the SLO: entries roll up to it (rootResource)
 * and show on the SLO's Audit Logs page. The lifecycle stamps are the
 * evaluation worker's bookkeeping, not an edit, and are not recorded.
 *
 * Join tables are named Slo... rather than ServiceLevelObjective...: the
 * long prefix would take the incident on-call table past Postgres' 63-byte
 * identifier limit.
 */
@EnableAuditLog({
  rootResource: {
    resourceType: "Service Level Objective",
    column: "serviceLevelObjectiveId",
  },
  ignoreColumns: [
    "lastAlertCreatedAt",
    "lastAlertResolvedAt",
    "lastIncidentCreatedAt",
    "lastIncidentResolvedAt",
  ],
})
@EnableDocumentation()
@CanAccessIfCanReadOn("serviceLevelObjective")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteServiceLevelObjectiveErrorBudgetPolicyTier,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
  ],
})
@CrudApiEndpoint(new Route("/service-level-objective-error-budget-policy-tier"))
@OwnedThrough("serviceLevelObjectiveId", ServiceLevelObjective)
@Entity({
  name: "ServiceLevelObjectiveErrorBudgetPolicyTier",
})
/*
 * One tier per threshold: two tiers at the same budget level would both
 * apply at once, and the policy could not say which agreement holds. The
 * service refuses a duplicate with its own words first; the index is what
 * keeps two concurrent writes (the recommended policy's starter clicked in
 * two tabs) from both getting through.
 */
@Index(["serviceLevelObjectiveId", "thresholdPercentage"], { unique: true })
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "ServiceLevelObjectiveErrorBudgetPolicyTier",
  singularName: "SLO Error Budget Policy Tier",
  pluralName: "SLO Error Budget Policy Tiers",
  icon: IconProp.Scale,
  tableDescription:
    "Tiers of a Service Level Objective's error budget policy: what the team does as the error budget runs down, and the alerts and incidents raised when the SLO enters a tier",
})
export default class ServiceLevelObjectiveErrorBudgetPolicyTier extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
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

  // Service Level Objective Relation

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "serviceLevelObjectiveId",
    type: TableColumnType.Entity,
    modelType: ServiceLevelObjective,
    title: "Service Level Objective",
    description:
      "The Service Level Objective whose error budget policy this tier belongs to",
  })
  @ManyToOne(
    () => {
      return ServiceLevelObjective;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceLevelObjectiveId" })
  public serviceLevelObjective?: ServiceLevelObjective = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Service Level Objective ID",
    description:
      "ID of the Service Level Objective whose error budget policy this tier belongs to",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceLevelObjectiveId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      'Name of this tier, for example "Reliability first". Shown on the SLO\'s Overview, in its feed and as {{policyTier}} in alert and incident templates.',
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  /*
   * Decimal, so a policy can draw a line at 2.5%. Read through
   * readSloPolicyTierThreshold everywhere, which takes the string a decimal
   * column can arrive as.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Budget Left Threshold (%)",
    description:
      "The tier applies while the share of the error budget left is at or below this percentage, from 0 to 100. 0 is the tier of an exhausted budget. The SLO is in the applying tier with the lowest threshold. Unique per SLO.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public thresholdPercentage?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Markdown,
    title: "What We Do",
    description:
      'What the team agreed to do while the SLO is in this tier, in Markdown - for example "Only reliability work and critical fixes ship." Shown on the SLO\'s Overview, in the feed item posted when the SLO enters the tier, and as {{policyTierWhatWeDo}} in alert and incident templates.',
  })
  @Column({
    nullable: false,
    type: ColumnType.Markdown,
  })
  public whatWeDo?: string = undefined;

  /*
   * The deploy gate. While the SLO is in a tier with this on, the evaluation
   * worker writes deploymentsAllowed = false on the SLO, so a CI/CD pipeline
   * that reads it holds back releases (Common/Utils/Slo/SloErrorBudgetPolicy,
   * "The deploy gate"). Part of the agreement, not an output: it raises
   * nothing, so it sits with the tier's own fields rather than with the
   * alert and incident options. Off by default, and written back by the
   * service as a real boolean, like the outputs.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Freeze Deployments",
    description:
      "While the SLO is in this tier, its deploymentsAllowed field is false, so CI/CD pipelines that check it hold back releases. Disabled by default.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public freezesDeployments?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description:
      "Whether this tier is part of the policy. A disabled tier never applies, and anything it raised is resolved.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  /*
   * What the tier RAISES when the SLO enters it - the burn rate rule's
   * outputs, column for column (see the class comment). Both are off by
   * default, so a tier is only the team's agreement until someone asks it to
   * page; ServiceLevelObjectiveErrorBudgetPolicyTierService writes both back
   * as real booleans, and the worker reads them with `=== true`.
   */

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Create Alert",
    description:
      "Raise an Alert when the SLO enters this tier. Disabled by default.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public shouldCreateAlert?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Declare Incident",
    description:
      "Declare an Incident when the SLO enters this tier. Disabled by default.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public shouldCreateIncident?: boolean = undefined;

  // Alert Configuration

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertSeverityId",
    type: TableColumnType.Entity,
    modelType: AlertSeverity,
    title: "Alert Severity",
    description: "Severity of the alert raised when the SLO enters this tier.",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Alert Severity ID",
    description:
      "ID of the Alert Severity of the alert raised when the SLO enters this tier",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OnCallDutyPolicy,
    title: "Alert On-Call Policies",
    description:
      "On-call policies attached to alerts raised by this tier. Incidents have their own list.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SloErrorBudgetPolicyTierAlertOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveErrorBudgetPolicyTierId",
      referencedColumnName: "_id",
    },
  })
  public onCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Alert Title Template",
    description:
      "Title of the alert raised when the SLO enters this tier. Supports template variables such as {{sloName}} and {{policyTier}}. Leave empty to use the default title.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public alertTitleTemplate?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Alert Description Template",
    description:
      "Description (in Markdown) of the alert raised when the SLO enters this tier. Supports template variables. Leave empty to use the default description.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public alertDescriptionTemplate?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Alert Remediation Notes",
    description:
      "Remediation notes (in Markdown) attached to the alert raised when the SLO enters this tier. Supports template variables.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public alertRemediationNotes?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Private Alert",
    description:
      "Make the alert raised by this tier private, so only its owners, project admins and project owners can see it. Disabled by default.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isAlertPrivate?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Auto Resolve Alert",
    description:
      "Resolve the alert automatically when the error budget recovers out of this tier. Enabled by default. When disabled, the alert stays open until someone resolves it. Entering a more severe tier always resolves it.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public autoResolveAlert?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Alert Labels",
    description: "Labels added to alerts raised by this tier.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SloErrorBudgetPolicyTierAlertLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveErrorBudgetPolicyTierId",
      referencedColumnName: "_id",
    },
  })
  public alertLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Alert Owner Teams",
    description: "Teams added as owners of alerts raised by this tier.",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SloErrorBudgetPolicyTierAlertOwnerTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveErrorBudgetPolicyTierId",
      referencedColumnName: "_id",
    },
  })
  public alertOwnerTeams?: Array<Team> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: User,
    title: "Alert Owner Users",
    description: "Users added as owners of alerts raised by this tier.",
  })
  @ManyToMany(
    () => {
      return User;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SloErrorBudgetPolicyTierAlertOwnerUser",
    inverseJoinColumn: {
      name: "userId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveErrorBudgetPolicyTierId",
      referencedColumnName: "_id",
    },
  })
  public alertOwnerUsers?: Array<User> = undefined;

  // Incident Configuration

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentSeverityId",
    type: TableColumnType.Entity,
    modelType: IncidentSeverity,
    title: "Incident Severity",
    description:
      "Severity of the incident declared when the SLO enters this tier.",
  })
  @ManyToOne(
    () => {
      return IncidentSeverity;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentSeverityId" })
  public incidentSeverity?: IncidentSeverity = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Incident Severity ID",
    description:
      "ID of the Incident Severity of the incident declared when the SLO enters this tier",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OnCallDutyPolicy,
    title: "Incident On-Call Policies",
    description:
      "On-call policies attached to incidents declared by this tier.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SloErrorBudgetPolicyTierIncidentOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveErrorBudgetPolicyTierId",
      referencedColumnName: "_id",
    },
  })
  public incidentOnCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Incident Title Template",
    description:
      "Title of the incident declared when the SLO enters this tier. Supports template variables such as {{sloName}} and {{policyTier}}. Leave empty to use the default title.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public incidentTitleTemplate?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Incident Description Template",
    description:
      "Description (in Markdown) of the incident declared when the SLO enters this tier. Supports template variables. Leave empty to use the default description.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public incidentDescriptionTemplate?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Incident Remediation Notes",
    description:
      "Remediation notes (in Markdown) attached to the incident declared when the SLO enters this tier. Supports template variables.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public incidentRemediationNotes?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Private Incident",
    description:
      "Make the incident declared by this tier private, so only its owners, project admins and project owners can see it. Disabled by default.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isIncidentPrivate?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Auto Resolve Incident",
    description:
      "Resolve the incident automatically when the error budget recovers out of this tier. Enabled by default. When disabled, the incident stays open until someone resolves it. Entering a more severe tier always resolves it.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public autoResolveIncident?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Incident Labels",
    description: "Labels added to incidents declared by this tier.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SloErrorBudgetPolicyTierIncidentLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveErrorBudgetPolicyTierId",
      referencedColumnName: "_id",
    },
  })
  public incidentLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Incident Owner Teams",
    description: "Teams added as owners of incidents declared by this tier.",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SloErrorBudgetPolicyTierIncidentOwnerTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveErrorBudgetPolicyTierId",
      referencedColumnName: "_id",
    },
  })
  public incidentOwnerTeams?: Array<Team> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: User,
    title: "Incident Owner Users",
    description: "Users added as owners of incidents declared by this tier.",
  })
  @ManyToMany(
    () => {
      return User;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SloErrorBudgetPolicyTierIncidentOwnerUser",
    inverseJoinColumn: {
      name: "userId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveErrorBudgetPolicyTierId",
      referencedColumnName: "_id",
    },
  })
  public incidentOwnerUsers?: Array<User> = undefined;

  // Applies to both outputs. Off by default, as on burn rate rules.
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Add SLO Owners As Owners",
    description:
      "Also add the owner users and owner teams of the Service Level Objective as owners of the alerts and incidents this tier raises. Disabled by default.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public addSloOwnersAsOwners?: boolean = undefined;

  /*
   * Worker-owned state, set by the SLO evaluation worker and never through
   * the API: the alert pair and the incident pair are separate lifecycles,
   * for the reasons ServiceLevelObjectiveBurnRateRule gives.
   */

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Alert Created At",
    description:
      "The last time an alert was raised by this tier. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastAlertCreatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Alert Resolved At",
    description:
      "The last time an alert raised by this tier was resolved. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastAlertResolvedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Incident Declared At",
    description:
      "The last time an incident was declared by this tier. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastIncidentCreatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Incident Resolved At",
    description:
      "The last time an incident declared by this tier was resolved. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastIncidentResolvedAt?: Date = undefined;

  // Created By / Deleted By User Relations

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ],
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
