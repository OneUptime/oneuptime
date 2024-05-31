import Project from './Project';
import User from './User';
import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import ColumnType from 'Common/Types/Database/ColumnType';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import EnableDocumentation from 'Common/Types/Database/EnableDocumentation';
import EnableWorkflow from 'Common/Types/Database/EnableWorkflow';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import IconProp from 'Common/Types/Icon/IconProp';
import ObjectID from 'Common/Types/ObjectID';
import Permission from 'Common/Types/Permission';
import Phone from 'Common/Types/Phone';
import SmsStatus from 'Common/Types/SmsStatus';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@EnableDocumentation()
@TenantColumn('projectId')
@TableAccessControl({
    create: [],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ReadSmsLog,
    ],
    delete: [],
    update: [],
})
@CrudApiEndpoint(new Route('/sms-log'))
@Entity({
    name: 'SmsLog',
})
@EnableWorkflow({
    create: true,
    delete: false,
    update: false,
    read: true,
})
@TableMetadata({
    tableName: 'SmsLog',
    singularName: 'SMS Log',
    pluralName: 'SMS Logs',
    icon: IconProp.SMS,
    tableDescription:
        'Logs of all the SMS sent out to all users and subscribers for this project.',
})
export default class SmsLog extends BaseModel {
    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadSmsLog,
        ],
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
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadSmsLog,
        ],
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
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadSmsLog,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        required: true,
        type: TableColumnType.Phone,
        title: 'To Number',
        description: 'Phone Number SMS was sent to',
        canReadOnRelationQuery: false,
    })
    @Column({
        nullable: false,
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        transformer: Phone.getDatabaseTransformer(),
    })
    public toNumber?: Phone = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadSmsLog,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        required: true,
        type: TableColumnType.Phone,
        title: 'From Number',
        description: 'Phone Number SMS was sent from',
        canReadOnRelationQuery: false,
    })
    @Column({
        nullable: false,
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        transformer: Phone.getDatabaseTransformer(),
    })
    public fromNumber?: Phone = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadSmsLog,
        ],
        update: [],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.VeryLongText,
        title: 'SMS Text',
        description: 'Text content of the message',
        canReadOnRelationQuery: false,
    })
    @Column({
        nullable: true,
        type: ColumnType.VeryLongText,
    })
    public smsText?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadSmsLog,
        ],
        update: [],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.LongText,
        title: 'Status Message',
        description: 'Status Message (if any)',
        canReadOnRelationQuery: false,
    })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public statusMessage?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadSmsLog,
        ],
        update: [],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        title: 'Status of the SMS',
        description: 'Status of the SMS sent',
        canReadOnRelationQuery: false,
    })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public status?: SmsStatus = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadSmsLog,
        ],
        update: [],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.Number,
        title: 'SMS Cost',
        description: 'SMS Cost in USD Cents',
        canReadOnRelationQuery: false,
        isDefaultValueColumn: true,
    })
    @Column({
        nullable: false,
        default: 0,
        type: ColumnType.Number,
    })
    public smsCostInUSDCents?: number = undefined;

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
}
