import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import SlugifyColumn from '../Types/Database/SlugifyColumn';
import Route from '../Types/API/Route';
import TableColumnType from '../Types/Database/TableColumnType';
import TableColumn from '../Types/Database/TableColumn';
import ColumnType from '../Types/Database/ColumnType';
import ObjectID from '../Types/ObjectID';
import ColumnLength from '../Types/Database/ColumnLength';
import Color from '../Types/Color';
import TableAccessControl from '../Types/Database/AccessControl/TableAccessControl';
import Permission from '../Types/Permission';
import ColumnAccessControl from '../Types/Database/AccessControl/ColumnAccessControl';
import ProjectColumn from '../Types/Database/ProjectColumn';

@ProjectColumn('projectId')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateProjectLabel],
    read: [
        Permission.ProjectOwner,
        Permission.CanReadProjectLabel,
        Permission.AnyProjectMember,
    ],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProjectLabel],
    update: [Permission.ProjectOwner, Permission.CanEditProjectLabel],
})
@CrudApiEndpoint(new Route('/label'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Label',
})
export default class Label extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectLabel],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'projectId',
        type: TableColumnType.Entity,
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
    public project?: Project;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectLabel],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
        ],
        update: [],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectLabel],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectLabel],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectLabel],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectLabel],
    })
    @Index()
    @TableColumn({ required: false, type: TableColumnType.LongText })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public description?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectLabel],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'createdByUserId',
        type: TableColumnType.Entity,
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
    public createdByUser?: User;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectLabel],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public createdByUserId?: ObjectID;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
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
    public deletedByUser?: User;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public deletedByUserId?: ObjectID;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectLabel],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectLabel,
            Permission.AnyProjectMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditProjectLabel],
    })
    @TableColumn({
        title: 'Color',
        required: true,
        unique: false,
        type: TableColumnType.Color,
    })
    @Column({
        type: ColumnType.Color,
        length: ColumnLength.Color,
        unique: false,
        nullable: false,
        transformer: Color.getDatabaseTransformer(),
    })
    public color?: Color = undefined;
}
