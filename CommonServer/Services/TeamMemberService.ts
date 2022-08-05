import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/TeamMember';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import AccessTokenService from './AccessTokenService';
import Email from 'Common/Types/Email';
import UserService from './UserService';
import User from 'Model/Models/User';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<CreateBy<Model>> {

        if (!createBy.data.hasAcceptedInvitation) {
            createBy.data.hasAcceptedInvitation = false; 
        }

        if (createBy.miscDataProps && createBy.miscDataProps["email"]) {
            const email: Email = new Email(createBy.miscDataProps["email"] as string);
            
            let user: User | null = await UserService.findByEmail(email, {
                isRoot: true
            });

            if (!user) {
                user = await UserService.createByEmail(email, {
                    isRoot: true
                })
            }

            createBy.data.userId = user.id!; 
        }

        return createBy;
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
