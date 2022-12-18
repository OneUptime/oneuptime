import {
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
} from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';
import User from './User';
import Project from './Project';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import SlugifyColumn from 'Common/Types/Database/SlugifyColumn';
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
import SingularPluralName from 'Common/Types/Database/SingularPluralName';
import Monitor from './Monitor';
import ScheduledMaintenanceState from './ScheduledMaintenanceState';
import MonitorStatus from './MonitorStatus';
import AccessControlColumn from 'Common/Types/Database/AccessControlColumn';
import MultiTenentQueryAllowed from 'Common/Types/Database/MultiTenentQueryAllowed';
import Label from './Label';
import StatusPage from './StatusPage';

@AccessControlColumn('labels')
@MultiTenentQueryAllowed(true)
@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.CanCreateProjectScheduledMaintenance,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.CanReadProjectScheduledMaintenance,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.CanDeleteProjectScheduledMaintenance,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.CanEditProjectScheduledMaintenance,
    ],
})
@CrudApiEndpoint(new Route('/scheduled-maintenance'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'ScheduledMaintenance',
})
@SingularPluralName(
    'Scheduled Maintenance Event',
    'Scheduled Maintenance Events'
)
export default class ScheduledMaintenance extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'projectId',
        type: TableColumnType.Entity,
        modelType: Project,
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
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        canReadOnPopulate: true,
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
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @Index()
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        canReadOnPopulate: true,
    })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public title?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @TableColumn({ required: false, type: TableColumnType.LongText })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public description?: string = undefined;

    @Index()
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [],
    })
    @TableColumn({ required: true, unique: true, type: TableColumnType.Slug })
    @Column({
        nullable: false,
        type: ColumnType.Slug,
        length: ColumnLength.Slug,
        unique: true,
    })
    public slug?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'createdByUserId',
        type: TableColumnType.Entity,
        modelType: User,
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
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
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
        type: TableColumnType.ObjectID,
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
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public deletedByUserId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.EntityArray,
        modelType: Monitor,
    })
    @ManyToMany(
        () => {
            return Monitor;
        },
        { eager: false }
    )
    @JoinTable({
        name: 'ScheduledMaintenanceMonitor',
        inverseJoinColumn: {
            name: 'monitorId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'scheduledMaintenanceId',
            referencedColumnName: '_id',
        },
    })
    public monitors?: Array<Monitor> = undefined; // monitors affected by this scheduledMaintenance.

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.EntityArray,
        modelType: StatusPage,
    })
    @ManyToMany(
        () => {
            return StatusPage;
        },
        { eager: false }
    )
    @JoinTable({
        name: 'ScheduledMaintenanceStatusPage',
        inverseJoinColumn: {
            name: 'statusPageId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'scheduledMaintenanceId',
            referencedColumnName: '_id',
        },
    })
    public statusPages?: Array<StatusPage> = undefined; // visible on which status page?

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.EntityArray,
        modelType: Label,
    })
    @ManyToMany(
        () => {
            return Label;
        },
        { eager: false }
    )
    @JoinTable({
        name: 'ScheduledMaintenanceLabel',
        inverseJoinColumn: {
            name: 'labelId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'scheduledMaintenanceId',
            referencedColumnName: '_id',
        },
    })
    public labels?: Array<Label> = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @TableColumn({
        manyToOneRelationColumn: 'currentScheduledMaintenanceStateId',
        type: TableColumnType.Entity,
        modelType: ScheduledMaintenanceState,
    })
    @ManyToOne(
        (_type: string) => {
            return ScheduledMaintenanceState;
        },
        {
            eager: false,
            nullable: true,
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'currentScheduledMaintenanceStateId' })
    public currentScheduledMaintenanceState?: ScheduledMaintenanceState = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public currentScheduledMaintenanceStateId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'changeMonitorStatusToId',
        type: TableColumnType.Entity,
        modelType: ScheduledMaintenanceState,
    })
    @ManyToOne(
        (_type: string) => {
            return MonitorStatus;
        },
        {
            eager: false,
            nullable: true,
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'changeMonitorStatusToId' })
    public changeMonitorStatusTo?: MonitorStatus = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: false })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public changeMonitorStatusToId?: ObjectID = undefined;

    @TableColumn({
        title: 'Start At',
        type: TableColumnType.Date,
        required: true,
    })
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @Column({
        nullable: false,
        type: ColumnType.Date,
    })
    public startsAt?: Date = undefined;

    @TableColumn({
        title: 'End At',
        type: TableColumnType.Date,
        required: true,
    })
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectScheduledMaintenance,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectScheduledMaintenance,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectScheduledMaintenance,
        ],
    })
    @Column({
        nullable: false,
        type: ColumnType.Date,
    })
    public endsAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isStatusPageSubscribersNotifiedOnEventScheduled?: boolean = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isStatusPageSubscribersNotifiedOnEventOngoing?: boolean = undefined;


}
