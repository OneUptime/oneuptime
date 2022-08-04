import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/TeamMember';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import AccessTokenService from './AccessTokenService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(
        createBy: CreateBy<Model>
    ): Promise<CreateBy<Model>> {
        /// Refresh tokens.
        await AccessTokenService.refreshUserGlobalAccessPermission(
            createBy.data.userId!
        );

        await AccessTokenService.refreshUserProjectAccessPermission(
            createBy.data.userId!,
            createBy.data.projectId!
        );

        return createBy;
    }

    // TODO - OnDelete and OnUpdate pending.
}
export default new Service();
