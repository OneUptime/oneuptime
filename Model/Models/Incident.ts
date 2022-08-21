import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
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
import IncidentState from './IncidentState';
import MonitorStatus from './MonitorStatus';

@TenantColumn('projectId')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
    read: [
        Permission.ProjectOwner,
        Permission.CanReadProjectIncident,
        Permission.ProjectMember,
    ],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProjectIncident],
    update: [Permission.ProjectOwner, Permission.CanEditProjectIncident],
})
@CrudApiEndpoint(new Route('/incident'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Incident',
})
@SingularPluralName('Incident', 'Incidents')
export default class Incident extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectIncident],
    })
    @Index()
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public title?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectIncident],
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
            Permission.ProjectMember,
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectIncident,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
            Permission.ProjectMember,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectIncident,
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
        { eager: true }
    )
    @JoinTable()
    public monitors?: Array<Monitor> = undefined; // monitors affected by this incident.


    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'currentIncidentStateId',
        type: TableColumnType.Entity,
        modelType: IncidentState,
    })
    @ManyToOne(
        (_type: string) => {
            return IncidentState;
        },
        {
            eager: false,
            nullable: true,
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'currentIncidentStateId' })
    public currentIncidentState?: IncidentState = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
            Permission.ProjectMember,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectIncident
        ],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public currentIncidentStateId?: ObjectID = undefined;



    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'changeMonitorStatusToId',
        type: TableColumnType.Entity,
        modelType: IncidentState,
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectIncident],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectIncident,
            Permission.ProjectMember,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditProjectIncident
        ],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public changeMonitorStatusToId?: ObjectID = undefined;
}
