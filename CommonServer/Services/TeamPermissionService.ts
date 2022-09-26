import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/TeamPermission';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import AccessTokenService from './AccessTokenService';
import TeamMemberService from './TeamMemberService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import TeamMember from 'Model/Models/TeamMember';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
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

    // TODO - OnDelete and OnUpdate pending.
}
export default new Service();
