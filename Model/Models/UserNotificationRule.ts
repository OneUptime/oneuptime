import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import ColumnType from 'Common/Types/Database/ColumnType';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import NotificationRuleType from 'Common/Types/NotificationRule/NotificationRuleType';
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
import UserCall from './UserCall';
import UserEmail from './UserEmail';
import UserSMS from './UserSMS';
import IncidentSeverity from './IncidentSeverity';

@TenantColumn('projectId')
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    delete: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route('/user-notification-rule'))
@Entity({
    name: 'UserNotificationRule',
})
@TableMetadata({
    tableName: 'UserNotificationRule',
    singularName: 'Notification Rule',
    pluralName: 'Notification Rules',
    icon: IconProp.Email,
    tableDescription: 'Rules which will be used to send notifications.',
})
@CurrentUserCanAccessRecordBy('userId')
class UserNotificationRule extends BaseModel {
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
        title: 'Rule Type',
        required: true,
        unique: false,
        type: TableColumnType.ShortText,
        canReadOnRelationQuery: true,
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        unique: false,
        nullable: false,
    })
    public ruleType?: NotificationRuleType = undefined;

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
        read: [Permission.CurrentUser],
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
        read: [],
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
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'userCallId',
        type: TableColumnType.Entity,
        modelType: UserCall,
        title: 'User Call',
        description:
            'Relation to User Call Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return UserCall;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userCallId' })
    public userCall?: UserCall = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        canReadOnRelationQuery: true,
        title: 'User Call ID',
        description: 'ID of User Call in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userCallId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'userSmsId',
        type: TableColumnType.Entity,
        modelType: UserSMS,
        title: 'User SMS',
        description:
            'Relation to User SMS Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return UserSMS;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userSmsId' })
    public userSms?: UserSMS = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        canReadOnRelationQuery: true,
        title: 'User SMS ID',
        description: 'ID of User SMS in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userSmsId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'userEmailId',
        type: TableColumnType.Entity,
        modelType: UserEmail,
        title: 'User Email',
        description:
            'Relation to User Email Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return UserEmail;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userEmailId' })
    public userEmail?: UserEmail = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        canReadOnRelationQuery: true,
        title: 'User Email ID',
        description: 'ID of User Email in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userEmailId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [Permission.CurrentUser],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.Number,
        required: true,
        isDefaultValueColumn: true,
        canReadOnRelationQuery: true,
        title: 'Notify After Minutes',
        description:
            'How long should we wait before sending a notification to the user after the event has occured?',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public notifyAfterMinutes?: number = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'incidentSeverityId',
        type: TableColumnType.Entity,
        modelType: IncidentSeverity,
        title: 'Incident Severity',
        description:
            'Relation to Incident Severity Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return IncidentSeverity;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'incidentSeverityId' })
    public incidentSeverity?: IncidentSeverity = undefined;

    @ColumnAccessControl({
        create: [Permission.CurrentUser],
        read: [Permission.CurrentUser],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        canReadOnRelationQuery: true,
        title: 'Incident Severity ID',
        description: 'ID of Incident Severity in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public incidentSeverityId?: ObjectID = undefined;
}

export default UserNotificationRule;
