import {
    Column,
    Entity,
    Index,
    JoinColumn,
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
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';
import MonitorStatus from './MonitorStatus';
import Monitor from './Monitor';

@TenantColumn('projectId')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitor],
    read: [
        Permission.ProjectOwner,
        Permission.CanReadProjectMonitor,
        Permission.ProjectMember,
    ],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProjectMonitor],
    update: [Permission.ProjectOwner, Permission.CanEditProjectMonitor],
})
@CrudApiEndpoint(new Route('/monitor-status-timeline'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Monitor',
})
@SingularPluralName('Monitor', 'Monitors')
export default class MonitorStatusTimeline extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitor],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectMonitor,
            Permission.ProjectMember,
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitor],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectMonitor,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID = undefined;



    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitor],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectMonitor,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'projectId',
        type: TableColumnType.Entity,
        modelType: Monitor,
    })
    @ManyToOne(
        (_type: string) => {
            return Monitor;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'projectId' })
    public monitor?: Monitor = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitor],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectMonitor,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public monitorId?: ObjectID = undefined;

   
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitor],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectMonitor,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'createdByUserId',
        type: TableColumnType.Entity,
        modelType: Project,
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitor],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectMonitor,
            Permission.ProjectMember,
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
        read: [Permission.ProjectMember],
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitor],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectMonitor,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectMonitor],
    })
    @TableColumn({
        manyToOneRelationColumn: 'monitorStatusId',
        type: TableColumnType.Entity,
        modelType: MonitorStatus,
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
    @JoinColumn({ name: 'monitorStatusId' })
    public monitorStatus?: MonitorStatus = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitor],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectMonitor,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectMonitor],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public monitorStatusId?: ObjectID = undefined;
}
