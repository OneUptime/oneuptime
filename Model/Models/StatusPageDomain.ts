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
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import UniqueColumnBy from 'Common/Types/Database/UniqueColumnBy';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';
import StatusPage from './StatusPage';
import Domain from './Domain';

@TenantColumn('projectId')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
    read: [
        Permission.ProjectOwner,
        Permission.CanReadStatusPageDomain,
        Permission.ProjectMember,
    ],
    delete: [Permission.ProjectOwner, Permission.CanDeleteStatusPageDomain],
    update: [Permission.ProjectOwner, Permission.CanEditStatusPageDomain],
})
@CrudApiEndpoint(new Route('/status-page-domain'))
@SlugifyColumn('name', 'slug')
@SingularPluralName('Status Page Domain', 'Status Page Domains')
@Entity({
    name: 'StatusPageDomain',
})
export default class StatusPageDomain extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
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
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
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
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'domainId',
        type: TableColumnType.Entity,
        modelType: Domain,
    })
    @ManyToOne(
        (_type: string) => {
            return Domain;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'domainId' })
    public domain?: Domain = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
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
    public domainId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'statusPageId',
        type: TableColumnType.Entity,
        modelType: StatusPage,
    })
    @ManyToOne(
        (_type: string) => {
            return StatusPage;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'statusPageId' })
    public statusPage?: StatusPage = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
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
    public statusPageId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditStatusPageDomain],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    @UniqueColumnBy('projectId')
    public subdomain?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public fullDomain?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
            Permission.ProjectMember,
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
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageDomain],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
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
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageDomain,
            Permission.ProjectMember,
        ],
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
}
