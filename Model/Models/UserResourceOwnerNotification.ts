import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import ColumnType from 'Common/Types/Database/ColumnType';
import TableColumn from 'Common/Types/Database/TableColumn';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import Route from 'Common/Types/API/Route';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import CurrentUserCanAccessRecordBy from 'Common/Types/Database/CurrentUserCanAccessRecordBy';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import AllowAccessIfSubscriptionIsUnpaid from 'Common/Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid';
import ObjectID from 'Common/Types/ObjectID';
import BaseModel from 'Common/Models/BaseModel';
import User from './User';
import Project from './Project';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableBillingAccessControl from 'Common/Types/Database/AccessControl/TableBillingAccessControl';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';

@TableBillingAccessControl({
    create: PlanSelect.Growth,
    read: PlanSelect.Growth,
    update: PlanSelect.Growth,
    delete: PlanSelect.Growth,
})
@TenantColumn('projectId')
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    delete: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route('/user-resource-owner-notification'))
@Entity({
    name: 'UserResourceOwnerNotification',
})
@TableMetadata({
    tableName: 'UserResourceOwnerNotification',
    singularName: 'Owner Notication',
    pluralName: 'OwnerNotifications',
    icon: IconProp.Email,
    tableDescription: 'Rules for sending notifications to resource owners',
})
@CurrentUserCanAccessRecordBy('userId')
class UserResourceOwnerNotification extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'projectId',
        type: TableColumnType.Entity,
        modelType: Project,
        title: 'Project',
        description:
            'Relation to Project Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return Project;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'projectId' })
    public project?: Project = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        canReadOnRelationQuery: true,
        title: 'Project ID',
        description:
            'ID of your OneUptime Project in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'user',
        type: TableColumnType.Entity,
        modelType: User,
        title: 'User',
        description: 'Relation to User who this email belongs to',
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
    @JoinColumn({ name: 'userId' })
    public user?: User = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'User ID',
        description: 'User ID who this email belongs to',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    @Index()
    public userId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Incident Created Notification',
        description:
            'Send an email to you when an incident is created if you are the owner of the incident.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendIncidentCreatedOwnerNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Incident Note Posted Notification',
        description:
            'Send an email to you when a note is posted to an incident if you are the owner of the incident.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendIncidentNotePostedOwnerNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Incident State Changed Notification',
        description:
            'Send an email to you when the state of an incident changes if you are the owner of the incident.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendIncidentStateChangedOwnerNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Incident Owner Added Notification',
        description:
            'Send an email to you when you are added as an owner of an incident.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendIncidentOwnerAddedNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Monitor Owner Added Notification',
        description:
            'Send an email to you when you are added as an owner of a monitor.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendMonitorOwnerAddedNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Monitor Created Notification',
        description:
            'Send an email to you when a monitor is created if you are the owner of the monitor.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendMonitorCreatedOwnerNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Monitor Status Changed Notification',
        description:
            'Send an email to you when the status of a monitor changes if you are the owner of the monitor.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendMonitorStatusChangedOwnerNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Scheduled Maintenance Created Notification',
        description:
            'Send an email to you when a scheduled maintenance is created if you are the owner of the scheduled maintenance event.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendScheduledMaintenanceCreatedOwnerNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Scheduled Maintenance Note Posted Notification',
        description:
            'Send an email to you when a note is posted to a scheduled maintenance event if you are the owner of the scheduled maintenance event.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendScheduledMaintenanceNotePostedOwnerNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Scheduled Maintenance Owner Added Notification',
        description:
            'Send an email to you when you are added as an owner of a scheduled maintenance event.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendScheduledMaintenanceOwnerAddedNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Scheduled Maintenance State Changed Notification',
        description:
            'Send an email to you when the state of a scheduled maintenance event changes if you are the owner of the scheduled maintenance event.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendScheduledMaintenanceStateChangedOwnerNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Status Page Announcement Created Notification',
        description:
            'Send an email to you when a status page announcement is created if you are the owner of the status page announcement.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendStatusPageAnnouncementCreatedOwnerNotification?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Status Page Created Notification',
        description:
            'Send an email to you when a status page is created if you are the owner of the status page.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendStatusPageCreatedOwnerNotificaiton?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        title: 'Send Status Page Owner Added Notification',
        description:
            'Send an email to you when you are added as an owner of a status page.',
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public sendStatusPageOwnerAddedNotification?: boolean = undefined;
}

export default UserResourceOwnerNotification;
