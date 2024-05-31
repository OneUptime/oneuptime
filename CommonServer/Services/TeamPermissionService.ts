import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import CreateBy from '../Types/Database/CreateBy';
import DeleteBy from '../Types/Database/DeleteBy';
import { OnCreate, OnDelete, OnUpdate } from '../Types/Database/Hooks';
import UpdateBy from '../Types/Database/UpdateBy';
import AccessTokenService from './AccessTokenService';
import DatabaseService from './DatabaseService';
import TeamMemberService from './TeamMemberService';
import TeamService from './TeamService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import Team from 'Model/Models/Team';
import TeamMember from 'Model/Models/TeamMember';
import Model from 'Model/Models/TeamPermission';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.data.teamId) {
            throw new BadDataException(
                'Team Id is required to create permission'
            );
        }

        // get team.
        const team: Team | null = await TeamService.findOneById({
            id: createBy.data.teamId!,
            select: {
                isPermissionsEditable: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!team) {
            throw new BadDataException('Invalid Team ID');
        }

        if (!team.isPermissionsEditable) {
            throw new BadDataException(
                'You cannot create new permissions for this team because this team is not editable'
            );
        }

        return { createBy, carryForward: null };
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        const createBy: CreateBy<Model> = onCreate.createBy;

        const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
            query: {
                teamId: createBy.data.teamId!,
            },
            select: {
                userId: true,
            },
            props: {
                isRoot: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
        });

        for (const member of teamMembers) {
            /// Refresh tokens.
            await AccessTokenService.refreshUserGlobalAccessPermission(
                member.userId!
            );
            await AccessTokenService.refreshUserTenantAccessPermission(
                member.userId!,
                createBy.data.projectId!
            );
        }

        return createdItem;
    }

    protected override async onBeforeUpdate(
        updateBy: UpdateBy<Model>
    ): Promise<OnUpdate<Model>> {
        const teamPermissions: Array<Model> = await this.findBy({
            query: updateBy.query,
            select: {
                _id: true,
                teamId: true,
                projectId: true,
                team: {
                    isPermissionsEditable: true,
                },
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
                isRoot: true,
            },
        });

        for (const permission of teamPermissions) {
            if (!permission.team?.isPermissionsEditable) {
                throw new BadDataException(
                    'Permissions for this team is not updateable. You can create a new team and add permissions to that team instead.'
                );
            }
        }

        return { updateBy, carryForward: teamPermissions };
    }

    protected override async onUpdateSuccess(
        onUpdate: OnUpdate<Model>,
        _updatedItemIds: ObjectID[]
    ): Promise<OnUpdate<Model>> {
        for (const permission of onUpdate.carryForward) {
            const teamMembers: Array<TeamMember> =
                await TeamMemberService.findBy({
                    query: {
                        teamId: permission.teamId!,
                    },
                    select: {
                        userId: true,
                        projectId: true,
                    },
                    props: {
                        isRoot: true,
                    },
                    limit: LIMIT_MAX,
                    skip: 0,
                });

            for (const member of teamMembers) {
                if (!member.userId) {
                    throw new BadDataException('Invalid User ID');
                }

                if (!member.projectId) {
                    throw new BadDataException('Invalid Project ID');
                }

                /// Refresh tokens.
                await AccessTokenService.refreshUserGlobalAccessPermission(
                    member.userId
                );
                await AccessTokenService.refreshUserTenantAccessPermission(
                    member.userId,
                    member.projectId
                );
            }
        }

        return onUpdate;
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        const teamPermissions: Array<Model> = await this.findBy({
            query: deleteBy.query,
            select: {
                _id: true,
                teamId: true,
                projectId: true,
                team: {
                    isPermissionsEditable: true,
                },
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
                isRoot: true,
            },
        });

        for (const permission of teamPermissions) {
            if (!permission.team?.isPermissionsEditable) {
                throw new BadDataException(
                    'Permissions for this team is not deleteable. You can create a new team and add permissions to that team instead.'
                );
            }
        }

        let teamMembers: Array<TeamMember> = [];

        for (const permission of teamPermissions) {
            const members: Array<TeamMember> = await TeamMemberService.findBy({
                query: {
                    teamId: permission.teamId!,
                },
                select: {
                    userId: true,
                    projectId: true,
                },
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
            });

            teamMembers = teamMembers.concat(members);
        }

        return { deleteBy, carryForward: teamMembers };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        for (const member of onDelete.carryForward) {
            const teamMember: TeamMember = member as TeamMember;

            if (!teamMember.userId) {
                throw new BadDataException('Invalid User ID');
            }

            if (!teamMember.projectId) {
                throw new BadDataException('Invalid Project ID');
            }

            /// Refresh tokens.
            await AccessTokenService.refreshUserGlobalAccessPermission(
                teamMember.userId
            );
            await AccessTokenService.refreshUserTenantAccessPermission(
                teamMember.userId,
                teamMember.projectId
            );
        }

        return onDelete;
    }
}
export default new Service();
