import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/TeamPermission';
import DatabaseService, {
    OnCreate,
    OnDelete,
    OnUpdate,
} from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import AccessTokenService from './AccessTokenService';
import TeamMemberService from './TeamMemberService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import TeamMember from 'Model/Models/TeamMember';
import BadDataException from 'Common/Types/Exception/BadDataException';
import TeamService from './TeamService';
import UpdateBy from '../Types/Database/UpdateBy';
import DeleteBy from '../Types/Database/DeleteBy';
import ObjectID from 'Common/Types/ObjectID';

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
        const team = await TeamService.findOneById({
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
        const teamPermissions = await this.findBy({
            query: updateBy.query,
            select: {
                _id: true,
                teamId: true,
                projectId: true,
            },
            populate: {
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
                    permission.data.projectId!
                );
            }
        }

        return onUpdate;
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        const teamPermissions = await this.findBy({
            query: deleteBy.query,
            select: {
                _id: true,
                teamId: true,
                projectId: true,
            },
            populate: {
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
            /// Refresh tokens.
            await AccessTokenService.refreshUserGlobalAccessPermission(
                member.userId!
            );
            await AccessTokenService.refreshUserTenantAccessPermission(
                member.userId!,
                member.data.projectId!
            );
        }

        return onDelete;
    }
}
export default new Service();
