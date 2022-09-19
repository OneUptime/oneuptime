import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import Route from 'Common/Types/API/Route';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import ColumnType from 'Common/Types/Database/ColumnType';
import MultiTenentQueryAllowed from 'Common/Types/Database/MultiTenentQueryAllowed';
import AllowUserQueryWithoutTenant from 'Common/Types/Database/AllowUserQueryWithoutTenant';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import UserColumn from 'Common/Types/Database/UserColumn';
import ObjectID from 'Common/Types/ObjectID';
import Permission from 'Common/Types/Permission';
import BaseModel from 'Common/Models/BaseModel';
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
@MultiTenentQueryAllowed(true)
@AllowUserQueryWithoutTenant(true)
@UserColumn('userId')
@TenantColumn('projectId')
@CrudApiEndpoint(new Route('/team-member'))
@Entity({
    name: 'TeamMember',
})
@SingularPluralName('Team Member', 'Team Members')
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
        modelType: Team,
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
    public team?: Team = undefined;

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
    public teamId?: ObjectID = undefined;

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
        modelType: User,
    })
    @ManyToOne(
        (_type: string) => {
            return User;
        },
        {
            eager: false,
            nullable: false,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userId' })
    public user?: User = undefined;

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
    @TableColumn({ type: TableColumnType.ObjectID, required: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectMember],
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
    public createdByUserId?: ObjectID = undefined;

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
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        isDefaultValueColumn: true,
        required: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public hasAcceptedInvitation?: boolean = undefined;

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
        update: [Permission.CurrentUser],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.Date,
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public invitationAcceptedAt?: Date = undefined;
}
