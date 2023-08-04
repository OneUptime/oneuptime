import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import TenantModel from 'Common/Models/TenantModel';
import User from './User';
import ColumnType from 'Common/Types/Database/ColumnType';
import PositiveNumber from 'Common/Types/PositiveNumber';
import ObjectID from 'Common/Types/ObjectID';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import TableColumn from 'Common/Types/Database/TableColumn';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import Route from 'Common/Types/API/Route';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import SlugifyColumn from 'Common/Types/Database/SlugifyColumn';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import AllowAccessIfSubscriptionIsUnpaid from 'Common/Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import MultiTenentQueryAllowed from 'Common/Types/Database/MultiTenentQueryAllowed';
import SubscriptionStatus from 'Common/Types/Billing/SubscriptionStatus';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';
import Phone from 'Common/Types/Phone';
import Email from 'Common/Types/Email';
import Name from 'Common/Types/Name';

@AllowAccessIfSubscriptionIsUnpaid()
@MultiTenentQueryAllowed(true)
@TableAccessControl({
    create: [Permission.User],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.CanReadProject,
        Permission.UnAuthorizedSsoUser,
        Permission.ProjectUser,
    ],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProject],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanManageProjectBilling,
        Permission.CanEditProject,
    ],
})
@TableMetadata({
    tableName: 'Project',
    singularName: 'Project',
    pluralName: 'Projects',
    icon: IconProp.Folder,
    tableDescription: 'OneUptime Project, and everything happens inside it',
})
@CrudApiEndpoint(new Route('/project'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Project',
})
@TenantColumn('_id')
export default class Model extends TenantModel {
    @ColumnAccessControl({
        create: [Permission.User],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanManageProjectBilling,
            Permission.CanEditProject,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        title: 'Name',
        description: 'Any friendly name of this object',
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [],
    })
    @TableColumn({
        required: true,
        unique: true,
        type: TableColumnType.Slug,
        title: 'Slug',
        description: 'Friendly globally unique name for your object',
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
            Permission.CanReadProject,
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
            Permission.CanReadProject,
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
            Permission.CanReadProject,
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
            Permission.CanReadProject,
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
            Permission.CanReadProject,
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
            Permission.CanReadProject,
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
            Permission.CanReadProject,
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
            Permission.CanReadProject,
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
    public paymentProviderMeteredSubscriptionStatus?: SubscriptionStatus = undefined;

    @ColumnAccessControl({
        create: [Permission.User],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanReadProject,
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'createdByUserId',
        type: TableColumnType.Entity,
        modelType: User,
        title: 'Created by User',
        description:
            'Relation to User who created this object (if this object was created by a User)',
    })
    @ManyToOne(
        (_type: string) => {
            return User;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'createdByUserId' })
    public createdByUser?: User = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Created by User ID',
        description:
            'User ID who created this object (if this object was created by a User)',
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
        manyToOneRelationColumn: 'deletedByUserId',
        type: TableColumnType.Entity,
        title: 'Deleted by User',
        description:
            'Relation to User who deleted this object (if this object was deleted by a User)',
    })
    @ManyToOne(
        (_type: string) => {
            return User;
        },
        {
            cascade: false,
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'deletedByUserId' })
    public deletedByUser?: User = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Deleted by User ID',
        description:
            'User ID who deleted this object (if this object was deleted by a User)',
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.CanReadWorkflow,
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProject,
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
    public requireSsoForLogin?: boolean = undefined;

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
    public activeMonitorsLimit?: number = undefined;

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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
        ],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        isDefaultValueColumn: true,
        required: true,
        title: 'SMS or Call Current Balance',
        description: 'Balance in USD for SMS or Call',
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
        ],
        update: [Permission.ProjectOwner, Permission.CanManageProjectBilling],
    })
    @TableColumn({
        type: TableColumnType.Number,
        isDefaultValueColumn: true,
        required: true,
        title: 'Auto Recharge Amount',
        description: 'Auto recharge amount in USD for SMS or Call',
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
        ],
        update: [Permission.ProjectOwner, Permission.CanManageProjectBilling],
    })
    @TableColumn({
        type: TableColumnType.Number,
        isDefaultValueColumn: true,
        required: true,
        title: 'Auto Recharge when current balance falls to',
        description:
            'Auto recharge is triggered when current balance falls to this amount in USD for SMS or Call',
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [Permission.ProjectOwner, Permission.CanManageProjectBilling],
    })
    @TableColumn({
        required: true,
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
        title: 'Enable SMS Notifications',
        description: 'Enable SMS notifications for this project.',
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [Permission.ProjectOwner, Permission.CanManageProjectBilling],
    })
    @TableColumn({
        required: true,
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
        title: 'Enable Call Notifications',
        description: 'Enable call notifications for this project.',
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [Permission.ProjectOwner, Permission.CanManageProjectBilling],
    })
    @TableColumn({
        required: true,
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
        title: 'Enable auto recharge SMS or Call balance',
        description:
            'Enable auto recharge SMS or Call balance for this project.',
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
        title: 'Low Call and SMS Balance Notification Sent to Owners',
        description: 'Low Call and SMS Balance Notification Sent to Owners',
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
        title: 'Failed Call and SMS Balance Charge Notification Sent to Owners',
        description:
            'Failed Call and SMS Balance Charge Notification Sent to Owners',
    })
    @Column({
        nullable: false,
        default: false,
        type: ColumnType.Boolean,
    })
    public failedCallAndSMSBalanceChargeNotificationSentToOwners?: boolean = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        required: true,
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
        title: 'Failed Call and SMS Balance Charge Notification Sent to Owners',
        description:
            'Failed Call and SMS Balance Charge Notification Sent to Owners',
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
            Permission.CanReadProject,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
        ],
        update: [],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.ShortText,
        title: 'Plan Name',
        description: 'Name of the plan this project is subscribed to.',
        canReadOnRelationQuery: true,
    })
    @Column({
        nullable: true,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public planName?: PlanSelect = undefined;

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
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public createdOwnerCompanyName?: string = undefined;
}
