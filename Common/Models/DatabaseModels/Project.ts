import Reseller from "./Reseller";
import ResellerPlan from "./ResellerPlan";
import User from "./User";
import TenantModel from "../../Models/BaseModels/BaseModel/TenantModel";
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
export default class Model extends TenantModel {
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
    update: [Permission.ProjectOwner],
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
      onDelete: "CASCADE",
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
      onDelete: "CASCADE",
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
  @TableColumn({ type: TableColumnType.Number })
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
    title: "SMS or Call Current Balance",
    description: "Balance in USD for SMS or Call",
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
    description: "Auto recharge amount in USD for SMS or Call",
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
      "Auto recharge is triggered when current balance falls to this amount in USD for SMS or Call",
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
    title: "Enable Call Notifications",
    description: "Enable call notifications for this project.",
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
    title: "Enable auto recharge SMS or Call balance",
    description: "Enable auto recharge SMS or Call balance for this project.",
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
    type: TableColumnType.Boolean,
    title: "Low Call and SMS Balance Notification Sent to Owners",
    description: "Low Call and SMS Balance Notification Sent to Owners",
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
    title: "Failed Call and SMS Balance Charge Notification Sent to Owners",
    description:
      "Failed Call and SMS Balance Charge Notification Sent to Owners",
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
    type: TableColumnType.Boolean,
    title: "Failed Call and SMS Balance Charge Notification Sent to Owners",
    description:
      "Failed Call and SMS Balance Charge Notification Sent to Owners",
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
  @TableColumn({ type: TableColumnType.Phone })
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
  @TableColumn({ type: TableColumnType.Email })
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
  @TableColumn({ type: TableColumnType.Name })
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
  @TableColumn({ type: TableColumnType.LongText })
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
  @TableColumn({ type: TableColumnType.LongText })
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
  @TableColumn({ type: TableColumnType.LongText })
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
  @TableColumn({ type: TableColumnType.LongText })
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
  @TableColumn({ type: TableColumnType.LongText })
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
  @TableColumn({ type: TableColumnType.ShortText })
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
    title: "Reseller ID",
    description: "ID of your OneUptime Reseller in which this object belongs",
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
    description:
      "OneUptime customer support can access this project. This is used for debugging purposes.",
  })
  @Column({
    nullable: true,
    default: false,
    type: ColumnType.Boolean,
  })
  public letCustomerSupportAccessProject?: boolean = undefined;
}
