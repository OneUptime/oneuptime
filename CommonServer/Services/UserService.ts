import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/User';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import TeamMemberService from './TeamMemberService';
import TeamMember from 'Common/Models/TeamMember';
import GlobalCache from '../Infrastructure/GlobalCache';
import { JSONObject } from 'Common/Types/JSON';
import { UserAccessPermission } from 'Common/Types/Permission';


export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async refreshUserAccessPermission(userId: ObjectID): Promise<UserAccessPermission>{
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


        const permissionToStore: UserAccessPermission = {
            userId, 
            projectIds
        }

        await GlobalCache.setJSON("user", userId.toString(), {
            userId: permissionToStore.userId,
            projectIds: permissionToStore.projectIds
        });

        return permissionToStore;
    }

    public async getUserAccessPermission(userId: ObjectID): Promise<UserAccessPermission | null> {
        

        const json: JSONObject | null = await GlobalCache.getJSON("user", userId.toString());

        if (!json) {
            return null;
        }

        return {
            userId: json["userId"] as ObjectID,
            projectIds: json["projectIds"] as Array<ObjectID>
        } as UserAccessPermission
    }
}


export default new Service();
