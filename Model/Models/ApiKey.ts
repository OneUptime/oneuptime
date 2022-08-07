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
import Permission from 'Common/Types/Permission';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import EntityName from 'Common/Types/Database/EntityName';

@TenantColumn('projectId')
@CrudApiEndpoint(new Route('/api-key'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'ApiKey',
})
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateProjectApiKey],
    read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProjectApiKey],
    update: [
        Permission.ProjectOwner,
        Permission.CanEditProjectApiKeyPermissions,
        Permission.CanEditProjectApiKey,
    ],
})
@EntityName('API Key', 'API Keys')
export default class ApiKey extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectApiKey],
        read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectApiKey],
        read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectApiKey],
        read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
        update: [Permission.ProjectOwner, Permission.CanEditProjectApiKey],
    })
    @Index()
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectApiKey],
        read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
        update: [Permission.ProjectOwner, Permission.CanEditProjectApiKey],
    })
    @TableColumn({ required: false, type: TableColumnType.LongText })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public description?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectApiKey],
        read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectApiKey],
        read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectApiKey],
        read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
        update: [Permission.ProjectOwner, Permission.CanEditProjectApiKey],
    })
    @TableColumn({
        title: 'Expires At',
        type: TableColumnType.Date,
        required: true,
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    public expiresAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.CanReadProjectApiKey],
        update: [Permission.ProjectOwner, Permission.CanEditProjectApiKey],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        isDefaultValueColumn: false,
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public apiKey?: ObjectID = undefined;
}
