import ObjectID from 'Common/Types/ObjectID';
import TeamMemberService from './TeamMemberService';
import TeamMember from 'Model/Models/TeamMember';
import GlobalCache from '../Infrastructure/GlobalCache';
import { JSONObject } from 'Common/Types/JSON';
import Permission, {
    UserGlobalAccessPermission,
    UserPermission,
    UserProjectAccessPermission,
} from 'Common/Types/Permission';
import TeamPermission from 'Model/Models/TeamPermission';
import TeamPermissionService from './TeamPermissionService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Label from 'Model/Models/Label';

enum PermissionNamespace {
    GlobalPermission = 'global-permissions',
    ProjectPermission = 'project-permissions',
}

export default class AccessTokenService {
    public static async refreshUserGlobalAccessPermission(
        userId: ObjectID
    ): Promise<UserGlobalAccessPermission> {
        // query for all projects user belongs to.
        const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
            query: {
                userId: userId,
                hasAcceptedInvitation: true,
            },
            select: {
                projectId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            },
        });

        const projectIds: Array<ObjectID> = teamMembers.map(
            (teamMember: TeamMember) => {
                return teamMember.projectId!;
            }
        );

        const permissionToStore: UserGlobalAccessPermission = {
            projectIds,
            globalPermissions: [Permission.Public, Permission.User],
        };

        // if user is a part of any project then, he is the project member.
        if (projectIds.length > 0) {
            permissionToStore.globalPermissions.push(Permission.ProjectMember);
        }

        await GlobalCache.setJSON('user', userId.toString(), permissionToStore);

        return permissionToStore;
    }

    public static async getUserGlobalAccessPermission(
        userId: ObjectID
    ): Promise<UserGlobalAccessPermission | null> {
        const json: JSONObject | null = await GlobalCache.getJSON(
            'user',
            userId.toString()
        );

        if (!json) {
            return null;
        }

        const accessPermission: UserGlobalAccessPermission =
            json as UserGlobalAccessPermission;

        return accessPermission;
    }

    public static async refreshUserProjectAccessPermission(
        userId: ObjectID,
        projectId: ObjectID
    ): Promise<UserProjectAccessPermission | null> {
        // query for all projects user belongs to.
        const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
            query: {
                userId: userId,
                projectId: projectId,
                hasAcceptedInvitation: true,
            },
            select: {
                teamId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            },
        });

        const teamIds: Array<ObjectID> = teamMembers.map(
            (teamMember: TeamMember) => {
                return teamMember.teamId!;
            }
        );

        if (teamIds.length === 0) {
            return null;
        }

        // get team permissions.
        const teamPermissions: Array<TeamPermission> =
            await TeamPermissionService.findBy({
                query: {
                    teamId: teamIds,
                },
                select: {
                    permission: true,
                    labels: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

        const userPermissions: Array<UserPermission> = [];

        for (const teamPermission of teamPermissions) {
            if (!teamPermission.labels) {
                teamPermission.labels = [];
            }

            userPermissions.push({
                permission: teamPermission.permission!,
                labelIds: teamPermission.labels.map((label: Label) => {
                    return label.id!;
                }),
            });
        }

        const permission: UserProjectAccessPermission = {
            projectId,
            permissions: userPermissions,
        };

        await GlobalCache.setJSON(
            PermissionNamespace.ProjectPermission,
            userId.toString() + projectId.toString(),
            permission
        );

        return permission;
    }

    public static async getUserProjectAccessPermission(
        userId: ObjectID,
        projectId: ObjectID
    ): Promise<UserProjectAccessPermission | null> {
        const json: UserProjectAccessPermission | null =
            (await GlobalCache.getJSON(
                PermissionNamespace.ProjectPermission,
                userId.toString() + projectId.toString()
            )) as UserProjectAccessPermission;

        return json;
    }
}
