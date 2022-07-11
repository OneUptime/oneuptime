import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import Route from '../Types/API/Route';
import TableColumnType from '../Types/Database/TableColumnType';
import TableColumn from '../Types/Database/TableColumn';
import ColumnType from '../Types/Database/ColumnType';
import ObjectID from '../Types/ObjectID';
import ColumnLength from '../Types/Database/ColumnLength';
import Permission from '../Types/Permission';
import Label from './Labels';
import Team from './Team';
import Project from './Project';
import ProjectColumn from '../Types/Database/ProjectColumn';
import TableAccessControl from '../Types/Database/AccessControl/TableAccessControl';
import ColumnAccessControl from '../Types/Database/AccessControl/ColumnAccessControl';

@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateTeam, Permission.CanEditTeamPermissions, ],
    read: [Permission.ProjectOwner, Permission.CanReadTeam, Permission.AnyMember],
    delete: [Permission.ProjectOwner, Permission.CanDeleteTeam,  Permission.CanEditTeamPermissions],
    update: [Permission.ProjectOwner, Permission.CanInviteTeamMembers, Permission.CanEditTeamPermissions, Permission.CanEditTeam]
})
@ProjectColumn("projectId")
@CrudApiEndpoint(new Route('/team-permission'))
@Entity({
    name: 'TeamPermission',
})
export default class TeamPermission extends BaseModel {


    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateTeam, Permission.CanEditTeamPermissions,],
        read: [Permission.ProjectOwner, Permission.CanReadTeam, Permission.AnyMember],
        update: []
    })
    @TableColumn({
        manyToOneRelationColumn: 'teamId',
        type: TableColumnType.Entity,
    })
    @ManyToOne(
        (_type: string) => {
            return Team;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'teamId' })
    public team?: Team;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateTeam, Permission.CanEditTeamPermissions,],
        read: [Permission.ProjectOwner, Permission.CanReadTeam, Permission.AnyMember],
        update: []
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
        create: [Permission.ProjectOwner, Permission.CanCreateTeam, Permission.CanEditTeamPermissions,],
        read: [Permission.ProjectOwner, Permission.CanReadTeam, Permission.AnyMember],
        update: []
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
        create: [Permission.ProjectOwner, Permission.CanCreateTeam, Permission.CanEditTeamPermissions,],
        read: [Permission.ProjectOwner, Permission.CanReadTeam, Permission.AnyMember],
        update: []
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public teamId?: ObjectID;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateTeam],
        read: [Permission.ProjectOwner,Permission.CanReadTeam, Permission.AnyMember],
        update: []
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
        read: [Permission.ProjectOwner,Permission.CanReadTeam, Permission.AnyMember],
        update: []
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public createdByUserId?: ObjectID;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateTeam],
        read: [Permission.ProjectOwner,Permission.CanReadTeam, Permission.AnyMember],
        update: []
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
        update: []
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public deletedByUserId?: ObjectID;


    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateTeam, Permission.CanEditTeamPermissions,],
        read: [Permission.ProjectOwner, Permission.CanReadTeam, Permission.AnyMember],
        update: [Permission.ProjectOwner, Permission.CanInviteTeamMembers, Permission.CanEditTeamPermissions, Permission.CanEditTeam]
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public permission?: Permission = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateTeam, Permission.CanEditTeamPermissions,],
        read: [Permission.ProjectOwner, Permission.CanReadTeam, Permission.AnyMember],
        update: [Permission.ProjectOwner, Permission.CanInviteTeamMembers, Permission.CanEditTeamPermissions, Permission.CanEditTeam]
    })
    @TableColumn({
        manyToOneRelationColumn: 'labelId',
        type: TableColumnType.Entity,
    })
    @ManyToOne(
        (_type: string) => {
            return Label;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'labelId' })
    public label?: Label = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateTeam, Permission.CanEditTeamPermissions,],
        read: [Permission.ProjectOwner, Permission.CanReadTeam, Permission.AnyMember],
        update: [Permission.ProjectOwner, Permission.CanInviteTeamMembers, Permission.CanEditTeamPermissions, Permission.CanEditTeam]
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public labelId?: ObjectID;
}
