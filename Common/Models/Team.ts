import {
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
} from 'typeorm';
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
import TeamPermission from './TeamPermission';
import TableAccessControl from '../Types/Database/AccessControl/TableAccessControl';
import Permission from '../Types/Permission';
import ColumnAccessControl from '../Types/Database/AccessControl/ColumnAccessControl';
import ProjectColumn from '../Types/Database/ProjectColumn';

@ProjectColumn('projectId')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateTeam],
    read: [
        Permission.ProjectOwner,
        Permission.CanReadTeam,
        Permission.AnyMember,
    ],
    delete: [Permission.ProjectOwner, Permission.CanDeleteTeam],
    update: [
        Permission.ProjectOwner,
        Permission.CanInviteTeamMembers,
        Permission.CanEditTeamPermissions,
        Permission.CanEditTeam,
    ],
})
@CrudApiEndpoint(new Route('/team'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Team',
})
export default class Team extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateTeam],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadTeam,
            Permission.AnyMember,
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
        create: [Permission.ProjectOwner, Permission.CanCreateTeam],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadTeam,
            Permission.AnyMember,
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
        create: [Permission.ProjectOwner, Permission.CanCreateTeam],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadTeam,
            Permission.AnyMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditTeam],
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
        create: [Permission.ProjectOwner, Permission.CanCreateTeam],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadTeam,
            Permission.AnyMember,
        ],
        update: [Permission.ProjectOwner, Permission.CanEditTeam],
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
        create: [Permission.ProjectOwner, Permission.CanCreateTeam],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadTeam,
            Permission.AnyMember,
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
        create: [Permission.ProjectOwner, Permission.CanCreateTeam],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadTeam,
            Permission.AnyMember,
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
        create: [Permission.ProjectOwner, Permission.CanCreateTeam],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadTeam,
            Permission.AnyMember,
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
    public deletedByUser?: User;

    @ColumnAccessControl({
        create: [],
        read: [Permission.AnyMember],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public deletedByUserId?: ObjectID;

    @ManyToMany(() => {
        return TeamPermission;
    })
    @JoinTable()
    public permissions?: Array<TeamPermission> = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.CanEditTeam,
            Permission.CanEditTeamPermissions,
        ],
        update: [],
    })
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: true,
    })
    public isPermissionsEditable?: boolean = undefined;
}
