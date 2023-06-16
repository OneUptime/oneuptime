import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';
import Project from './Project';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import SmsStatus from 'Common/Types/SmsStatus';
import Route from 'Common/Types/API/Route';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableColumn from 'Common/Types/Database/TableColumn';
import ColumnType from 'Common/Types/Database/ColumnType';
import ObjectID from 'Common/Types/ObjectID';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import EnableWorkflow from 'Common/Types/Model/EnableWorkflow';
import IconProp from 'Common/Types/Icon/IconProp';
import EnableDocumentation from 'Common/Types/Model/EnableDocumentation';
import Phone from 'Common/Types/Phone';

@EnableDocumentation()
@TenantColumn('projectId')
@TableAccessControl({
    create: [],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.CanReadSmsLog,
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
            Permission.CanReadSmsLog,
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
            Permission.CanReadSmsLog,
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
            Permission.CanReadSmsLog,
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
            Permission.CanReadSmsLog,
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
            Permission.CanReadSmsLog,
        ],
        update: [],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongText,
        title: 'SMS Text',
        description: 'Text content of the message',
        canReadOnRelationQuery: false,
    })
    @Column({
        nullable: false,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public smsText?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanReadSmsLog,
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
            Permission.CanReadSmsLog,
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
            Permission.CanReadSmsLog,
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
}
