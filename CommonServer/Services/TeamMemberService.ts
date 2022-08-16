import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/TeamMember';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import AccessTokenService from './AccessTokenService';
import Email from 'Common/Types/Email';
import UserService from './UserService';
import User from 'Model/Models/User';
import UpdateBy from '../Types/Database/UpdateBy';
import DeleteBy from '../Types/Database/DeleteBy';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<CreateBy<Model>> {
        if (!createBy.data.hasAcceptedInvitation) {
            createBy.data.hasAcceptedInvitation = false;
        }

        if (createBy.miscDataProps && createBy.miscDataProps['email']) {
            const email: Email = new Email(
                createBy.miscDataProps['email'] as string
            );

            let user: User | null = await UserService.findByEmail(email, {
                isRoot: true,
            });

            if (!user) {
                user = await UserService.createByEmail(email, {
                    isRoot: true,
                });
            }

            createBy.data.userId = user.id!;
        }

        return createBy;
    }


    private async refreshTokens(userId: ObjectID, projectId: ObjectID) {
        /// Refresh tokens.
        await AccessTokenService.refreshUserGlobalAccessPermission(
            userId
        );

        await AccessTokenService.refreshUserProjectAccessPermission(
            userId,
            projectId
        );
    }

    protected override async onCreateSuccess(
        createBy: CreateBy<Model>
    ): Promise<CreateBy<Model>> {

        await this.refreshTokens(createBy.data.userId!, createBy.data.projectId!);
        return createBy;
    }

    protected override async onUpdateSuccess(updateBy: UpdateBy<Model>, updatedItems: Array<Model>): Promise<UpdateBy<Model>> {

        for (const item of updatedItems) {
            await this.refreshTokens(item.userId!, item.projectId!);
        }

        return updateBy;
    }

    protected override async onDeleteSuccess(deleteBy: DeleteBy<Model>, itemsBeforeDelete: Array<Model>): Promise<DeleteBy<Model>> {

        for (const item of itemsBeforeDelete) {
            await this.refreshTokens(item.userId!, item.projectId!);
        }

        return deleteBy;
    }

}
export default new Service();
