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
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ],
    update: [Permission.ProjectOwner, Permission.ManageProjectBilling],
  })
  @TableColumn({
    type: TableColumnType.Email,
    title: "Finance / Accounting Email",
    description:
      "Invoices, receipts and billing related notifications will be sent to this email in addition to project owner.",
    example: "accounting@example.com",
  })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
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
  @TableColumn({ type: TableColumnType.SmallPositiveNumber })
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
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
  })
  public currentActiveMonitorsCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
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

  @ColumnAccessControl({
    create: [Permission.User],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
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
}
