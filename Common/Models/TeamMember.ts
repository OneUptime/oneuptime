import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import Route from '../Types/API/Route';
import ColumnAccessControl from '../Types/Database/AccessControl/ColumnAccessControl';
import TableAccessControl from '../Types/Database/AccessControl/TableAccessControl';
import ColumnType from '../Types/Database/ColumnType';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import EntityName from '../Types/Database/EntityName';
import ProjectColumn from '../Types/Database/ProjectColumn';
import TableColumn from '../Types/Database/TableColumn';
import TableColumnType from '../Types/Database/TableColumnType';
import UserColumn from '../Types/Database/UserColumn';
import ObjectID from '../Types/ObjectID';
import Permission from '../Types/Permission';
import BaseModel from './BaseModel';
import Project from './Project';

import Team from './Team';
import User from './User';

@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.CanCreateProjectTeam,
        Permission.CanInviteProjectTeamMembers,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.CanReadProjectTeam,
        Permission.ProjectMember,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.CanDeleteProjectTeam,
        Permission.CurrentUser,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.CanInviteProjectTeamMembers,
        Permission.CanEditProjectTeam,
    ],
})
@UserColumn('userId')
@ProjectColumn('projectId')
@CrudApiEndpoint(new Route('/team-member'))
@Entity({
    name: 'TeamMember',
})
@EntityName("Team Member", "Team Members")
export default class TeamMember extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectTeam,
            Permission.CanInviteProjectTeamMembers,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectTeam,
            Permission.ProjectMember,
        ],
        update: [],
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectTeam,
            Permission.CanInviteProjectTeamMembers,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectTeam,
            Permission.ProjectMember,
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
    public teamId?: ObjectID;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectTeam,
            Permission.CanInviteProjectTeamMembers,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectTeam,
            Permission.ProjectMember,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectTeam,
            Permission.CanInviteProjectTeamMembers,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectTeam,
            Permission.ProjectMember,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectTeam,
            Permission.CanInviteProjectTeamMembers,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectTeam,
            Permission.ProjectMember,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'userId',
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
    @JoinColumn({ name: 'userId' })
    public user?: User;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateProjectTeam,
            Permission.CanInviteProjectTeamMembers,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadProjectTeam,
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
    public userId?: ObjectID;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectMember],
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
    public createdByUserId?: ObjectID;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectMember],
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
        read: [Permission.ProjectMember],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public deletedByUserId?: ObjectID;
}
