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
import AccessControlColumn from 'Common/Types/Database/AccessControlColumn';
import Label from './Label';
import File from './File';

@AccessControlColumn('labels')
@TenantColumn('projectId')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateProjectStatusPage],
    read: [
        Permission.ProjectOwner,
        Permission.CanReadProjectStatusPage,
        Permission.ProjectMember,
    ],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProjectStatusPage],
    update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
})
@CrudApiEndpoint(new Route('/status-page'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'StatusPage',
})
@SingularPluralName('Status Page', 'Status Pages')
export default class StatusPage extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({ required: false, type: TableColumnType.ShortText })
    @Column({
        nullable: true,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public pageTitle?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({ required: false, type: TableColumnType.LongText })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public pageDescription?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
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
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
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
        name: 'StatusPageLabel',
        inverseJoinColumn: {
            name: 'labelId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'statusPageId',
            referencedColumnName: '_id',
        },
    })
    public labels?: Array<Label> = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
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

    //// Branding Files.

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({
        manyToOneRelationColumn: 'faviconFileId',
        type: TableColumnType.Entity,
        modelType: File,
    })
    @ManyToOne(
        (_type: string) => {
            return File;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'delete',
        }
    )
    @JoinColumn({ name: 'faviconFileId' })
    public faviconFile?: File = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public faviconFileId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({
        manyToOneRelationColumn: 'logoFileId',
        type: TableColumnType.Entity,
        modelType: File,
    })
    @ManyToOne(
        (_type: string) => {
            return File;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'delete',
        }
    )
    @JoinColumn({ name: 'logoFileId' })
    public logoFile?: File = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public logoFileId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({
        manyToOneRelationColumn: 'coverImageFileId',
        type: TableColumnType.Entity,
        modelType: File,
    })
    @ManyToOne(
        (_type: string) => {
            return File;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'delete',
        }
    )
    @JoinColumn({ name: 'coverImageFileId' })
    public coverImageFile?: File = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public coverImageFileId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({ required: false, type: TableColumnType.HTML })
    @Column({
        nullable: true,
        type: ColumnType.HTML,
    })
    public headerHTML?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({ required: false, type: TableColumnType.HTML })
    @Column({
        nullable: true,
        type: ColumnType.HTML,
    })
    public footerHTML?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({ required: false, type: TableColumnType.CSS })
    @Column({
        nullable: true,
        type: ColumnType.CSS,
    })
    public customCSS?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectStatusPage,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectStatusPage,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectStatusPage],
    })
    @TableColumn({ required: false, type: TableColumnType.JavaScript })
    @Column({
        nullable: true,
        type: ColumnType.JavaScript,
    })
    public customJavaScript?: string = undefined;
}
