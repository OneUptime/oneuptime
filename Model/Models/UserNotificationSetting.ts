import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import ColumnType from 'Common/Types/Database/ColumnType';
import ColumnLength from 'Common/Types/Database/ColumnLength';
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
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';

@TenantColumn('projectId')
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    delete: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route('/user-notification-setting'))
@Entity({
    name: 'UserNotificationSetting',
})
@TableMetadata({
    tableName: 'UserNotificationSetting',
    singularName: 'Notification Setting',
    pluralName: 'Notification Settings',
    icon: IconProp.Bell,
    tableDescription: 'Settings which will be used to send notifications.',
})
@CurrentUserCanAccessRecordBy('userId')
class UserNotificationSetting extends BaseModel {
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
    public eventType?: NotificationSettingEventType = undefined;

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
        create: [],
        read: [Permission.CurrentUser],

        update: [],
    })
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public alertByEmail?: boolean = undefined;


    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],

        update: [],
    })
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public alertBySMS?: boolean = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],

        update: [],
    })
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public alertByCall?: boolean = undefined;

}

export default UserNotificationSetting;
