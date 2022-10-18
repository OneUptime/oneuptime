import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
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
import Color from 'Common/Types/Color';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import UniqueColumnBy from 'Common/Types/Database/UniqueColumnBy';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';

@TenantColumn('projectId')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateProjectMonitorStatus],
    read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProjectMonitorStatus],
    update: [Permission.ProjectOwner, Permission.CanEditProjectMonitorStatus],
})
@CrudApiEndpoint(new Route('/monitor-status'))
@SlugifyColumn('name', 'slug')
@SingularPluralName('Monitor Status', 'Monitor Statuses')
@Entity({
    name: 'MonitorStatus',
})
export default class MonitorStatus extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
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
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
        update: [],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: true, canReadOnPopulate: true})
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectMonitorStatus,
        ],
    })
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
    @UniqueColumnBy('projectId')
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
        update: [],
    })
    @TableColumn({ required: true, unique: true, type: TableColumnType.Slug })
    @Column({
        nullable: false,
        type: ColumnType.Slug,
        length: ColumnLength.Slug,
    })
    public slug?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectMonitorStatus,
        ],
    })
    @TableColumn({ required: false, type: TableColumnType.LongText })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public description?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
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
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
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
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
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
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
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
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectMonitorStatus,
        ],
    })
    @TableColumn({
        title: 'Color',
        required: true,
        unique: false,
        type: TableColumnType.Color,
        canReadOnPopulate: true,
    })
    @Column({
        type: ColumnType.Color,
        length: ColumnLength.Color,
        unique: false,
        nullable: false,
        transformer: Color.getDatabaseTransformer(),
    })
    public color?: Color = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectMonitorStatus,
        ],
    })
    @TableColumn({
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
        canReadOnPopulate: true,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isOperationalState?: boolean = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectMonitorStatus,
        ],
    })
    @TableColumn({
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
        canReadOnPopulate: true,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isOfflineState?: boolean = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectMonitorStatus,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadProjectMonitorStatus],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectMonitorStatus,
        ],
    })
    @TableColumn({
        isDefaultValueColumn: false,
        type: TableColumnType.Number,
        canReadOnPopulate: true,
    })
    @Column({
        type: ColumnType.Number,
    })
    public priority?: number = undefined;
}
