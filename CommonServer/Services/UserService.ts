import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/User';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import TeamMemberService from './TeamMemberService';
import TeamMember from 'Common/Models/TeamMember';
import GlobalCache from '../Infrastructure/GlobalCache';
import { JSONObject } from 'Common/Types/JSON';
import Permission, { UserGlobalAccessPermission } from 'Common/Types/Permission';


export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async refreshUserAccessPermission(userId: ObjectID): Promise<UserGlobalAccessPermission>{
        // query for all projects user belongs to. 
        const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
            query: {
                userId: userId
            },
            select: {
                projectId: true,
            },
            limit: 1000,
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

    public async getUserAccessPermission(userId: ObjectID): Promise<UserGlobalAccessPermission | null> {

        const json: JSONObject | null = await GlobalCache.getJSON("user", userId.toString());

        if (!json) {
            return null;
        }

        if (!json["projectId"]) {
            json["projectId"] = [];
        }

        if (!Array.isArray(json["projectId"])) {
            json["projectId"] = []
        }

        const accessPermission: UserGlobalAccessPermission = {
            projectIds: (json["projectIds"] as Array<string>).map((item) => new ObjectID(item)),
            globalPermissions: []
        }

        return accessPermission
    }
}


export default new Service();
