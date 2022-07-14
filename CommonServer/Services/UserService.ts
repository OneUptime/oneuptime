import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/User';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import TeamMemberService from './TeamMemberService';
import TeamMember from 'Common/Models/TeamMember';
import GlobalCache from '../Infrastructure/GlobalCache';
import { JSONObject } from 'Common/Types/JSON';
import Permission, { UserGlobalAccessPermission, UserPermission, UserProjectAccessPermission } from 'Common/Types/Permission';
import TeamPermission from 'Common/Models/TeamPermission';
import TeamPermissionService from './TeamPermissionService';
import { In } from 'typeorm';
import LIMIT_MAX from '../Types/Database/LimitMax';
import Label from 'Common/Models/Labels';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';

enum PermissionNamespace { 
    GlobalPermission = "global-permissions", 
    ProjectPermission = "project-permissions"
}

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async refreshUserGlobalAccessPermission(userId: ObjectID): Promise<UserGlobalAccessPermission>{
        // query for all projects user belongs to. 
        const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
            query: {
                userId: userId
            },
            select: {
                projectId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            }
        });

        const projectIds: Array<ObjectID> = teamMembers.map((teamMember) => teamMember.projectId!);

        const permissionToStore: UserGlobalAccessPermission = {
            projectIds,
            globalPermissions: [Permission.Public, Permission.User]
        }

        await GlobalCache.setJSON("user", userId.toString(), {
            projectIds: permissionToStore.projectIds.map((item)=> item.toString()),
            globalPermissions: permissionToStore.globalPermissions
        });

        return permissionToStore;
    }

    public async getUserGlobalAccessPermission(userId: ObjectID): Promise<UserGlobalAccessPermission | null> {

        const json: JSONObject | null = await GlobalCache.getJSON("user", userId.toString());

        if (!json) {
            return null;
        }

        if (!json["projectIds"]) {
            json["projectIds"] = [];
        }

        if (!Array.isArray(json["globalPermissions"])) {
            json["globalPermissions"] = []
        }

        const accessPermission: UserGlobalAccessPermission = {
            projectIds: (json["projectIds"] as Array<string>).map((item) => new ObjectID(item)),
            globalPermissions: (json["globalPermissions"] || []) as Array<Permission>
        }

        return accessPermission
    }

    public async refreshUserProjectAccessPermission(userId: ObjectID, projectId: ObjectID): Promise<UserProjectAccessPermission>{
        // query for all projects user belongs to. 
        const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
            query: {
                userId: userId,
                projectId: projectId
            },
            select: {
                teamId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            }
        });

        const teamIds: Array<ObjectID> = teamMembers.map((teamMember) => teamMember.teamId!);

        if (teamIds.length === 0) {
            throw new NotAuthorizedException("User is not authorized to access this project");
        }

        // get team permissions. 

        const teamPermissions: Array<TeamPermission> = await TeamPermissionService.findBy({
            query: {
                teamId: In(teamIds)
            },
            select: {
                permission: true,
                labels: true
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            }
        });

        const userPermissions: Array<UserPermission> = [];

        for (const teamPermission of teamPermissions) {
            if (!teamPermission.labels) {
                teamPermission.labels = [];
            }

            userPermissions.push({
                permission: teamPermission.permission!,
                labelIds: teamPermission.labels.map((label: Label) => label.id!)
            })
        }

        const permission: UserProjectAccessPermission = {
            projectId, 
            permissions: userPermissions
        }

        await GlobalCache.setJSON(PermissionNamespace.ProjectPermission, userId.toString()+projectId.toString(), {
            projectIds: projectId,
            permissions: userPermissions.map((item) => {
                return {
                    permission: item.permission,
                    labelIds: item.labelIds.map((i)=> i.toString())
                }
            })
        });

        return permission;
    }

    public async getUserProjectAccessPermission(userId: ObjectID, projectId: ObjectID): Promise<UserProjectAccessPermission | null> {

        const json: JSONObject | null = await GlobalCache.getJSON(PermissionNamespace.ProjectPermission, userId.toString()+projectId.toString());

        if (!json) {
            return null;
        }

        if (!json["projectId"]) {
            return null;
        }

        if (!Array.isArray(json["permissions"])) {
            json["permissions"] = []
        }


        const userPermissions: Array<UserPermission> = [];

        for (const permission of json["permissions"] as Array<JSONObject>) {

            if (!permission["permission"]) {
                continue; 
            }
            userPermissions.push({
                permission: (permission["permission"] as string) as Permission,
                labelIds: (permission["labelIds"] as Array<string>).map((item) => new ObjectID(item))
            })
        }

        const accessPermission: UserProjectAccessPermission = {
            projectId: new ObjectID(json["projectId"] as string),
            permissions: userPermissions
        }

        return accessPermission
    }
}


export default new Service();
