import MetricDownsamplingRetentionDays from "../../Types/Metrics/MetricDownsamplingRetentionDays";
import TelemetryRetentionConfig from "../../Types/Telemetry/TelemetryRetentionConfig";
import AlertSeverity from "./AlertSeverity";
import Reseller from "./Reseller";
import ResellerPlan from "./ResellerPlan";
import User from "./User";
import TenantModel from "../../Models/DatabaseModels/DatabaseBaseModel/TenantModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "../../Types/Billing/SubscriptionStatus";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import ColumnBillingAccessControl from "../../Types/Database/AccessControl/ColumnBillingAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import MultiTenentQueryAllowed from "../../Types/Database/MultiTenentQueryAllowed";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import Email from "../../Types/Email";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Phone from "../../Types/Phone";
import PositiveNumber from "../../Types/PositiveNumber";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation({
  isMasterAdminApiDocs: true,
})
@AllowAccessIfSubscriptionIsUnpaid()
@MultiTenentQueryAllowed(true)
@TableAccessControl({
  create: [Permission.User],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.UnAuthorizedSsoUser,
    Permission.ProjectUser,
  ],
  delete: [Permission.ProjectOwner, Permission.DeleteProject],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ManageProjectBilling,
    Permission.EditProject,
  ],
})
@TableMetadata({
  tableName: "Project",
  singularName: "Project",
  pluralName: "Projects",
  icon: IconProp.Folder,
  tableDescription: "OneUptime Project, and everything happens inside it",
})
@CrudApiEndpoint(new Route("/project"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "Project",
})
@TenantColumn("_id")
export default class Project extends TenantModel {
  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "Any friendly name of this object",
    canReadOnRelationQuery: true,
    example: "My Awesome Project",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @Index()
  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    title: "Slug",
    description: "Friendly globally unique name for your object",
    computed: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
    unique: true,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public paymentProviderPlanId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public paymentProviderSubscriptionId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public paymentProviderMeteredSubscriptionId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Number })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
  })
  public paymentProviderSubscriptionSeats?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public trialEndsAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public paymentProviderCustomerId?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ManageProjectBilling],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Business Details / Billing Address",
    description:
      "Business legal name, address and any tax information to appear on invoices.",
    example:
      "Acme Corporation\n123 Main Street\nSan Francisco, CA 94102\nTax ID: 12-3456789",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public businessDetails?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ManageProjectBilling],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Business Country (ISO Alpha-2)",
    description:
      "Two-letter ISO country code for billing address (e.g., US, GB, DE).",
    example: "US",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public businessDetailsCountry?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ManageProjectBilling],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Finance / Accounting Email",
    description:
      "Invoices, receipts and billing related notifications will be sent to these emails in addition to project owner. Separate multiple emails with a comma.",
    example: "accounting@example.com, finance@example.com",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public financeAccountingEmail?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public paymentProviderSubscriptionStatus?: SubscriptionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public paymentProviderMeteredSubscriptionStatus?: SubscriptionStatus =
    undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public paymentProviderPromoCode?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
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
    create: [Permission.CurrentUser],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    isDefaultValueColumn: true,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isBlocked?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    isDefaultValueColumn: true,
    title: "Is Feature Flag Monitor Groups Enabled",
    description: "Is Feature Flag Monitor Groups Enabled",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    unique: false,
    default: false,
  })
  public isFeatureFlagMonitorGroupsEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.SmallPositiveNumber, computed: true })
  @Column({
    type: ColumnType.SmallPositiveNumber,
    nullable: true,
    unique: false,
  })
  public unpaidSubscriptionNotificationCount?: PositiveNumber = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public paymentFailedDate?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public paymentSuccessDate?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Number })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
  })
  public workflowRunsInLast30Days?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    isDefaultValueColumn: true,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Free,
  })
  public requireSsoForLogin?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Require SSO with specific provider",
    description:
      "If set, SSO-enforced login for this project is only satisfied by an SSO token issued by this specific provider id (a Project SSO/OIDC or a Global SSO/OIDC). When null, any trusted SSO provider satisfies enforcement.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public requireSsoWithSsoProviderId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Number })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
  })
  public activeMonitorsLimit?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Number })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
  })
  public seatLimit?: number = undefined; // this is used for stopping customers from adding more users than their plan allows. For ex: Some enterprise customers have a limit of 100 users. This is used to enforce that limit.

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    hideColumnInDocumentation: true,
    computed: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
  })
  public currentActiveMonitorsCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    hideColumnInDocumentation: true,
    computed: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 0,
  })
  public incidentCounter?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    hideColumnInDocumentation: true,
    computed: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 0,
  })
  public alertCounter?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    hideColumnInDocumentation: true,
    computed: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 0,
  })
  public scheduledMaintenanceCounter?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    hideColumnInDocumentation: true,
    computed: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 0,
  })
  public incidentEpisodeCounter?: number = undefined;

  /*
   * Numbers AI code-fix tasks only. Chat and investigation runs share the
   * AIRun table but are not tasks, so they never draw from this counter —
   * see AIRunService.onBeforeCreate.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    hideColumnInDocumentation: true,
    computed: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 0,
  })
  public aiRunCounter?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    hideColumnInDocumentation: true,
    computed: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 0,
  })
  public alertEpisodeCounter?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Incident Number Prefix",
    description:
      "Custom prefix for incident numbers (e.g., 'INC-'). If empty, '#' is used.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public incidentNumberPrefix?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Alert Number Prefix",
    description:
      "Custom prefix for alert numbers (e.g., 'ALT-'). If empty, '#' is used.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public alertNumberPrefix?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Scheduled Maintenance Number Prefix",
    description:
      "Custom prefix for scheduled maintenance numbers (e.g., 'SM-'). If empty, '#' is used.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public scheduledMaintenanceNumberPrefix?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Incident Episode Number Prefix",
    description:
      "Custom prefix for incident episode numbers (e.g., 'IE-'). If empty, '#' is used.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public incidentEpisodeNumberPrefix?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Alert Episode Number Prefix",
    description:
      "Custom prefix for alert episode numbers (e.g., 'AE-'). If empty, '#' is used.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public alertEpisodeNumberPrefix?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    title: "SMS, Call, and WhatsApp Current Balance",
    description: "Balance in USD for SMS, Call, and WhatsApp",
    defaultValue: 0,
    example: 2500,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 0,
  })
  public smsOrCallCurrentBalanceInUSDCents?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    title: "Auto Recharge Amount",
    description: "Auto recharge amount in USD for SMS, Call, and WhatsApp",
    defaultValue: 20,
    example: 20,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 20,
  })
  public autoRechargeSmsOrCallByBalanceInUSD?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    title: "Auto Recharge when current balance falls to",
    description:
      "Auto recharge is triggered when current balance falls to this amount in USD for SMS, Call, and WhatsApp",
    defaultValue: 10,
    example: 10,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 10,
  })
  public autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable SMS Notifications",
    description: "Enable SMS notifications for this project.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableSmsNotifications?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable WhatsApp Notifications",
    description: "Enable WhatsApp notifications for this project.",
    defaultValue: false,
    example: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableWhatsAppNotifications?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Telegram Notifications",
    description: "Enable Telegram notifications for this project.",
    defaultValue: false,
    example: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableTelegramNotifications?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Call Notifications",
    description: "Enable call notifications for this project.",
    defaultValue: false,
    example: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableCallNotifications?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable auto recharge for SMS, Call, and WhatsApp balance",
    description:
      "Enable auto recharge for SMS, Call, and WhatsApp balance for this project.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableAutoRechargeSmsOrCallBalance?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.Boolean,
    title: "Low SMS, Call, and WhatsApp Balance Notification Sent to Owners",
    description:
      "Low SMS, Call, and WhatsApp Balance Notification Sent to Owners",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public lowCallAndSMSBalanceNotificationSentToOwners?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    hideColumnInDocumentation: true,
    title:
      "Failed SMS, Call, and WhatsApp Balance Charge Notification Sent to Owners",
    description:
      "Failed SMS, Call, and WhatsApp Balance Charge Notification Sent to Owners",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public failedCallAndSMSBalanceChargeNotificationSentToOwners?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.Boolean,
    title: "Not Enabled SMS, Call, or WhatsApp Notification Sent to Owners",
    description:
      "Not Enabled SMS, Call, or WhatsApp Notification Sent to Owners",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public notEnabledSmsOrCallNotificationSentToOwners?: boolean = undefined;

  // AI Billing Fields

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    title: "AI Current Balance",
    description: "Balance in USD for AI services",
    defaultValue: 0,
    example: 2500,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 0,
  })
  public aiCurrentBalanceInUSDCents?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    title: "AI Auto Recharge Amount",
    description: "Auto recharge amount in USD for AI services",
    defaultValue: 20,
    example: 20,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 20,
  })
  public autoAiRechargeByBalanceInUSD?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    required: true,
    title: "AI Auto Recharge when current balance falls to",
    description:
      "Auto recharge is triggered when current balance falls to this amount in USD for AI services",
    defaultValue: 10,
    example: 10,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 10,
  })
  public autoRechargeAiWhenCurrentBalanceFallsInUSD?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable AI",
    description: "Enable AI services for this project.",
    defaultValue: true,
    example: true,
  })
  @Column({
    nullable: false,
    default: true,
    type: ColumnType.Boolean,
  })
  public enableAi?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Automatic Incident Investigation",
    description:
      "When enabled, OneUptime's AI SRE automatically investigates every new incident and posts a cited root cause analysis to the incident timeline. Requires AI to be enabled and an LLM provider to be configured.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableAutomaticIncidentInvestigation?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Automatic Alert Investigation",
    description:
      "When enabled, OneUptime's AI SRE automatically investigates every new alert and posts a cited root cause analysis to the alert timeline. Requires AI to be enabled and an LLM provider to be configured.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableAutomaticAlertInvestigation?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Instrumentation Fix Tasks",
    description:
      "When enabled, an AI investigation that ends inconclusive (telemetry was insufficient to determine a root cause) automatically queues an AI agent task that opens a pull request adding the missing instrumentation to the implicated code paths. Requires a repository connected through the GitHub App. Pull requests are always human-reviewed — nothing merges automatically.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableInstrumentationFixTasks?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable AI Insights",
    description:
      "When enabled, OneUptime AI continuously watches this project's telemetry with deterministic statistical sensors (error-log spikes, exception novelty and spikes, trace-latency regressions, week-over-week metric drift) and files quiet Insights — never pages, never opens incidents. Each new insight also gets a budgeted, read-only AI triage analysis when an LLM provider is configured.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableAiInsights?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Insight Fix Tasks",
    description:
      "When enabled, insights whose deterministic evidence points at code (new or spiking exceptions with a resolvable repository, trace-latency regressions with span-tree findings) automatically queue an AI agent task that opens a draft pull request with a proposed fix. Honors the daily fix task budget and per-repository open-PR caps. Pull requests are always human-reviewed — nothing merges automatically.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableInsightFixTasks?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Auto Archive Non-Actionable Exceptions",
    description:
      "When enabled, exception groups the AI triage classifies as expected denials (auth failures, plan/paywall rejections, scanner probes tripping intentional validation) are automatically archived so they stop surfacing in the unresolved list and never queue AI fix tasks. Groups classified as user errors or infrastructure conditions are NOT auto-archived — only clear expected denials are. Archiving is reversible from the Archived tab.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public autoArchiveNonActionableExceptions?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertInvestigationMinimumSeverityId",
    type: TableColumnType.Entity,
    modelType: AlertSeverity,
    title: "Alert Investigation Minimum Severity",
    description:
      "Only alerts at or above this severity are investigated automatically by AI. When unset, the top two severity tiers (by order) are investigated by default.",
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
  @JoinColumn({ name: "alertInvestigationMinimumSeverityId" })
  public alertInvestigationMinimumSeverity?: AlertSeverity = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Alert Investigation Minimum Severity ID",
    description:
      "ID of the minimum AlertSeverity that triggers automatic investigation.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertInvestigationMinimumSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Daily Autonomous AI Token Limit",
    description:
      "Maximum tokens per UTC day that autonomous AI investigations may consume for this project. When the limit is reached, new autonomous investigations are skipped until the next day — interactive AI chat is never blocked. Unset means no limit.",
    example: 500000,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public aiDailyAutonomousTokenLimit?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Daily AI Fix Task Limit",
    description:
      "Maximum AI fix tasks (agent runs that open pull requests) that may be created per UTC day for this project, across every fix recipe and trigger. Unset means the default of 25 per day; 0 pauses AI fix tasks entirely.",
    example: 25,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public aiDailyFixTaskLimit?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Alert Re-investigation Cooldown (Minutes)",
    description:
      "Repeat alerts from the same monitor within this many minutes are not re-investigated by AI — the first analysis stands. Unset means the default of 30 minutes; 0 disables the cooldown.",
    example: 30,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public alertInvestigationDedupeWindowMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Max Concurrent Investigations",
    description:
      "How many AI investigations may run at the same time for this project, shared across incidents and alerts. Unset means the default of 3. Minimum 1 — pause investigations with the opt-in toggles or a daily token limit of 0 instead.",
    example: 3,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public aiMaxConcurrentInvestigations?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable auto recharge for AI balance",
    description: "Enable auto recharge for AI balance for this project.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableAutoRechargeAiBalance?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ManageProjectBilling],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Send Invoices by Email",
    description:
      "When enabled, invoices will be automatically sent to the finance/accounting email when they are generated.",
    defaultValue: false,
    example: true,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public sendInvoicesByEmail?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.Boolean,
    title: "Low AI Balance Notification Sent to Owners",
    description: "Low AI Balance Notification Sent to Owners",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public lowAiBalanceNotificationSentToOwners?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    hideColumnInDocumentation: true,
    title: "Failed AI Balance Charge Notification Sent to Owners",
    description: "Failed AI Balance Charge Notification Sent to Owners",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public failedAiBalanceChargeNotificationSentToOwners?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.Boolean,
    title: "Not Enabled AI Notification Sent to Owners",
    description: "Not Enabled AI Notification Sent to Owners",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public notEnabledAiNotificationSentToOwners?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Plan Name",
    description: "Name of the plan this project is subscribed to.",
    canReadOnRelationQuery: true,
    hideColumnInDocumentation: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public planName?: PlanType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],

    update: [],
  })
  @TableColumn({ type: TableColumnType.Date })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public lastActive?: Date = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Phone, hideColumnInDocumentation: true })
  @Column({
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    nullable: true,
    unique: false,
    transformer: Phone.getDatabaseTransformer(),
  })
  public createdOwnerPhone?: Phone = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Email, hideColumnInDocumentation: true })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    nullable: true,
    unique: false,
    transformer: Email.getDatabaseTransformer(),
  })
  public createdOwnerEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Name, hideColumnInDocumentation: true })
  @Column({
    type: ColumnType.Name,
    length: ColumnLength.Name,
    nullable: true,
    unique: false,
    transformer: Name.getDatabaseTransformer(),
  })
  public createdOwnerName?: Name = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmSource?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmMedium?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmCampaign?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmTerm?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.LongText })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public utmContent?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,

    nullable: true,
    unique: false,
  })
  public utmUrl?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    hideColumnInDocumentation: true,
    title: "Ad Click IDs",
    description:
      "Ad platform click identifiers (gclid, fbclid, msclkid, etc.) copied from the user who created this project. Used for offline conversion uploads to ad platforms.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public clickIds?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    hideColumnInDocumentation: true,
    title: "First Touch Attribution",
    description:
      "First-touch attribution (UTM parameters, click IDs, landing URL, referrer) copied from the user who created this project. The utm* columns hold last-touch values.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public firstTouchAttribution?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,

    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public createdOwnerCompanyName?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [Permission.ProjectOwner],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "resellerId",
    type: TableColumnType.Entity,
    hideColumnInDocumentation: true,
    modelType: Reseller,
    title: "Reseller",
    description: "Relation to Reseller Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return Reseller;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "resellerId" })
  public reseller?: Reseller = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    hideColumnInDocumentation: true,
    title: "Reseller ID",
    description: "ID of your OneUptime Reseller in which this object belongs",
    example: "d4e5f6a7-b8c9-0123-def0-123456789abc",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public resellerId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [Permission.ProjectOwner],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "ResellerPlanId",
    type: TableColumnType.Entity,
    modelType: ResellerPlan,
    hideColumnInDocumentation: true,
    title: "ResellerPlan",
    description:
      "Relation to ResellerPlan Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return ResellerPlan;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "resellerPlanId" })
  public resellerPlan?: ResellerPlan = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [Permission.ProjectOwner],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    hideColumnInDocumentation: true,
    title: "Reseller Plan ID",
    description:
      "ID of your OneUptime Reseller Plan in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public resellerPlanId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "License ID",
    hideColumnInDocumentation: true,
    description: "License ID from a OneUptime Reseller",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public resellerLicenseId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Enterprise Annual Contract Value",
    hideColumnInDocumentation: true,
    description:
      "Annual contract value for this project (in USD). This field is only applicable for enterprise customers and is manually edited.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public enterpriseAnnualContractValue?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Let Customer Support Access Project",
    hideColumnInDocumentation: true,
    description:
      "OneUptime customer support can access this project. This is used for debugging purposes.",
    defaultValue: false,
  })
  @Column({
    nullable: true,
    default: false,
    type: ColumnType.Boolean,
  })
  public letCustomerSupportAccessProject?: boolean = undefined;

  /*
   * This is an internal field. This is used for internal analytics for example: Metabase.
   * Values can be between 0 and 100.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    hideColumnInDocumentation: true,
    title: "Discount Percent",
    description: "Discount percentage applied to the project billing",
    defaultValue: 0,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 0,
  })
  public discountPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    isDefaultValueColumn: false,
    title: "Do NOT auto-add Global Probes to new monitors",
    description:
      "If enabled, global probes will NOT be automatically added to new monitors. Enable this only if you are using ONLY custom probes to monitor your resources.",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public doNotAddGlobalProbesByDefaultOnNewMonitors?: boolean = undefined;

  // GitHub App Installation ID for this project
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "GitHub App Installation ID",
    description:
      "The GitHub App installation ID for this project. This is set when the GitHub App is installed on the organization.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    unique: false,
  })
  public gitHubAppInstallationId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Default Metric Cardinality Budget",
    description:
      "Project-wide default max distinct series per metric. Services without a per-service override use this value.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 10000,
  })
  public defaultMetricCardinalityBudget?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Default Telemetry Data Retention (Days)",
    description:
      "Project-wide default number of days to retain telemetry data (logs, traces, metrics). Services without a per-service override use this value.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 15,
  })
  public defaultTelemetryRetentionInDays?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Telemetry Data Retention Overrides",
    description:
      "Project-wide per-pillar retention overrides for telemetry data (logs by severity, traces by status, metrics, profiles). Falls back to defaultTelemetryRetentionInDays when a pillar or bucket is not set.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public telemetryRetentionConfig?: TelemetryRetentionConfig = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Default Metric Downsampling Retention (days per tier)",
    description:
      "Project-wide default retention for each downsampling tier (raw, 1m, 5m, 1h, 1d) in days.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public defaultMetricDownsamplingRetentionDays?: MetricDownsamplingRetentionDays =
    undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    isDefaultValueColumn: true,
    defaultValue: false,
    title: "Enable Audit Logs",
    description:
      "When enabled, changes to resources in this project are recorded as audit log entries.",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Enterprise,
    create: PlanType.Free,
  })
  public enableAuditLogs?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    isDefaultValueColumn: true,
    defaultValue: 7,
    title: "Audit Log Retention (days)",
    description:
      "Number of days to retain audit log entries. Minimum 7, maximum 180.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    unique: false,
    default: 7,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Enterprise,
    create: PlanType.Free,
  })
  public auditLogsRetentionInDays?: number = undefined;

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProject,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    isDefaultValueColumn: true,
    defaultValue: false,
    title: "Store System Events",
    description:
      "When enabled, audit logs will also include events triggered by the system. By default, only events triggered by users are recorded.",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Enterprise,
    create: PlanType.Free,
  })
  public storeSystemEventsInAuditLogs?: boolean = undefined;
}
