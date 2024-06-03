import Monitor from './Monitor';
import Project from './Project';
import User from './User';
import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import TableBillingAccessControl from 'Common/Types/Database/AccessControl/TableBillingAccessControl';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import ColumnType from 'Common/Types/Database/ColumnType';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import EnableDocumentation from 'Common/Types/Database/EnableDocumentation';
import EnableWorkflow from 'Common/Types/Database/EnableWorkflow';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import UniqueColumnBy from 'Common/Types/Database/UniqueColumnBy';
import IconProp from 'Common/Types/Icon/IconProp';
import ObjectID from 'Common/Types/ObjectID';
import Permission from 'Common/Types/Permission';
import {
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
} from 'typeorm';

@EnableDocumentation()
@TableBillingAccessControl({
    create: PlanSelect.Growth,
    read: PlanSelect.Growth,
    update: PlanSelect.Growth,
    delete: PlanSelect.Growth,
})
@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CreateMonitorSecret,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,

        Permission.ReadMonitorSecret,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.DeleteMonitorSecret,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditMonitorSecret,
    ],
})
@EnableWorkflow({
    create: true,
    delete: true,
    update: true,
    read: true,
})
@CrudApiEndpoint(new Route('/monitor-secret'))
@TableMetadata({
    tableName: 'MonitorSecret',
    singularName: 'Monitor Secret',
    pluralName: 'Monitor Secrets',
    icon: IconProp.Lock,
    tableDescription:
        'Monitor Secret is a secret variable that can be used in monitors. For example you can store auth tokens, passwords, etc. in Monitor Secret and use them in your monitors. Monitor Secret is encrypted and only accessible by the probe.',
})
@Entity({
    name: 'MonitorSecret',
})
export default class MonitorSecret extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CreateMonitorSecret,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadMonitorSecret,
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CreateMonitorSecret,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadMonitorSecret,
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CreateMonitorSecret,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadMonitorSecret,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.EditMonitorSecret,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        canReadOnRelationQuery: true,
        title: 'Name',
        description: 'Any friendly name of this object',
    })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    @UniqueColumnBy('projectId')
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CreateMonitorSecret,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadMonitorSecret,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.EditMonitorSecret,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.LongText,
        title: 'Description',
        description: 'Friendly description that will help you remember',
    })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public description?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CreateMonitorSecret,
        ],
        read: [],
        update: [],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.LongText,
        encrypted: true,
        title: 'Secret Value',
        description:
            'Secret value that you want to store in this object. This value will be encrypted and only accessible by the probe.',
    })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public secretValue?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ReadMonitorSecret,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ReadMonitorSecret,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.EditMonitorSecret,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.EntityArray,
        modelType: Monitor,
        title: 'Monitors',
        description: 'List of monitors that can access this secret',
    })
    @ManyToMany(
        () => {
            return Monitor;
        },
        { eager: false }
    )
    @JoinTable({
        name: 'MonitorSecretMonitor',
        inverseJoinColumn: {
            name: 'monitorId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'monitorSecretId',
            referencedColumnName: '_id',
        },
    })
    public monitors?: Array<Monitor> = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CreateMonitorSecret,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadMonitorSecret,
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CreateMonitorSecret,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadMonitorSecret,
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadMonitorSecret,
        ],
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

            Permission.ReadMonitorSecret,
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
}
