import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';
import User from './User';
import Project from './Project';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
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
import StatusPage from './StatusPage';
import CanAccessIfCanReadOn from 'Common/Types/Database/CanAccessIfCanReadOn';
import URL from 'Common/Types/API/URL';

@CanAccessIfCanReadOn('statusPage')
@TenantColumn('projectId')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
    read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
    delete: [Permission.ProjectOwner, Permission.CanDeleteStatusPageHeaderLink],
    update: [Permission.ProjectOwner, Permission.CanEditStatusPageHeaderLink],
})
@CrudApiEndpoint(new Route('/status-page-header-link'))
@SingularPluralName('Status Page Header Link', 'Status Page Header Links')
@Entity({
    name: 'StatusPageHeaderLink',
})
export default class StatusPageHeaderLink extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
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
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
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
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
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
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
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
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
        update: [Permission.ProjectOwner, Permission.CanEditStatusPageHeaderLink],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public title?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
        update: [Permission.ProjectOwner, Permission.CanEditStatusPageHeaderLink],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortURL })
    @Column({
        nullable: false,
        type: ColumnType.ShortURL,
        length: ColumnLength.ShortURL,
        transformer: URL.getDatabaseTransformer()
    })
    public link?: URL = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
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
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
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
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
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
        create: [Permission.ProjectOwner, Permission.CanCreateStatusPageHeaderLink],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageHeaderLink],
        update: [Permission.ProjectOwner, Permission.CanEditStatusPageHeaderLink],
    })
    @TableColumn({ isDefaultValueColumn: false, type: TableColumnType.Number })
    @Column({
        type: ColumnType.Number,
    })
    public order?: number = undefined;
}
