import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import Hostname from '../Types/API/Hostname';
import Email from '../Types/Email';
import Port from '../Types/Port';
import Permission from '../Types/Permission';
import ProjectColumn from '../Types/Database/ProjectColumn';
import TableAccessControl from '../Types/Database/AccessControl/TableAccessControl';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import Route from '../Types/API/Route';
import SlugifyColumn from '../Types/Database/SlugifyColumn';
import EntityName from '../Types/Database/EntityName';
import ColumnAccessControl from '../Types/Database/AccessControl/ColumnAccessControl';
import TableColumn from '../Types/Database/TableColumn';
import TableColumnType from '../Types/Database/TableColumnType';
import ColumnType from '../Types/Database/ColumnType';
import ObjectID from '../Types/ObjectID';
import ColumnLength from '../Types/Database/ColumnLength';
import UniqueColumnBy from '../Types/Database/UniqueColumnBy';

@ProjectColumn('projectId')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateProjectSMTPConfig],
    read: [Permission.ProjectOwner, Permission.CanReadProjectSMTPConfig],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProjectSMTPConfig],
    update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
})
@CrudApiEndpoint(new Route('/smtp-config'))
@SlugifyColumn('name', 'slug')
@EntityName('SMTP Config', 'SMTP Configs')
@Entity({
    name: 'ProjectSMTPConfig',
})
export default class ProjectSmtpConfig extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
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
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
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
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
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
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
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
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
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
            Permission.CanReadProjectSMTPConfig,
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

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
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
    public deletedByUserId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
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
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
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
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
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
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
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
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
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
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
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
            Permission.CanCreateProjectSMTPConfig,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectSMTPConfig,
            Permission.ProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectSMTPConfig],
    })
    @TableColumn({ required: true, type: TableColumnType.Boolean })
    @Column({
        nullable: false,
        type: ColumnType.Boolean,
        default: true,
    })
    public secure?: boolean = undefined;
}
