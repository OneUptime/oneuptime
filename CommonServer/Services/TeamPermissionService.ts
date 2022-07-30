import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/TeamPermission';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import AccessTokenService from './AccessTokenService';
import TeamMemberService from './TeamMemberService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import TeamMember from 'Common/Models/TeamMember';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(
        createBy: CreateBy<Model>
    ): Promise<CreateBy<Model>> {
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
            await AccessTokenService.refreshUserProjectAccessPermission(
                member.userId!,
                createBy.data.projectId!
            );
        }

        return createBy;
    }

    // TODO - OnDelete and OnUpdate pending.
}
export default new Service();
