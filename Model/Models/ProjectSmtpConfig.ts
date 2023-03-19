import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';
import Hostname from 'Common/Types/API/Hostname';
import Email from 'Common/Types/Email';
import Port from 'Common/Types/Port';
import Permission from 'Common/Types/Permission';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import Route from 'Common/Types/API/Route';
import SlugifyColumn from 'Common/Types/Database/SlugifyColumn';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import ColumnType from 'Common/Types/Database/ColumnType';
import ObjectID from 'Common/Types/ObjectID';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import UniqueColumnBy from 'Common/Types/Database/UniqueColumnBy';

@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanCreateProjectSMTPConfig,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanReadProjectSMTPConfig,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanDeleteProjectSMTPConfig,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanEditProjectSMTPConfig,
    ],
})
@CrudApiEndpoint(new Route('/smtp-config'))
@SlugifyColumn('name', 'slug')
@TableMetadata({
    tableName: 'ProjectSMTPConfig',
    singularName: 'SMTP Config',
    pluralName: 'SMTP Configs',
    icon: IconProp.Email,
    tableDescription: 'Manage Custom SMTP Servers for your project',
})
@Entity({
    name: 'ProjectSMTPConfig',
})
export default class ProjectSmtpConfig extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
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
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
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
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSMTPConfig,
        ],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    @UniqueColumnBy('projectId')
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
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
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSMTPConfig,
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
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
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
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
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
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'deletedByUserId',
        type: TableColumnType.Entity,
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
            Permission.CanReadProjectSMTPConfig,
        ],
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
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSMTPConfig,
        ],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public username?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSMTPConfig,
        ],
    })
    @TableColumn({ required: true, type: TableColumnType.Password })
    @Column({
        nullable: false,
        type: ColumnType.Password,
        length: ColumnLength.Password,
    })
    public password?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSMTPConfig,
        ],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        transformer: Hostname.getDatabaseTransformer(),
    })
    public hostname?: Hostname = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSMTPConfig,
        ],
    })
    @TableColumn({ required: true, type: TableColumnType.Number })
    @Column({
        nullable: false,
        type: ColumnType.Number,
        transformer: Port.getDatabaseTransformer(),
    })
    public port?: Port = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSMTPConfig,
        ],
    })
    @TableColumn({ required: true, type: TableColumnType.Email })
    @Column({
        nullable: false,
        type: ColumnType.Email,
        length: ColumnLength.Email,
        transformer: Email.getDatabaseTransformer(),
    })
    public fromEmail?: Email = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSMTPConfig,
        ],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public fromName?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSMTPConfig,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSMTPConfig,
        ],
    })
    @TableColumn({ required: true, type: TableColumnType.Boolean })
    @Column({
        nullable: false,
        type: ColumnType.Boolean,
        default: true,
    })
    public secure?: boolean = undefined;
}
