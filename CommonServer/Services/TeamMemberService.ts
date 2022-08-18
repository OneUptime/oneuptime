import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/TeamMember';
import DatabaseService, {
    OnCreate,
    OnDelete,
    OnUpdate,
} from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import AccessTokenService from './AccessTokenService';
import Email from 'Common/Types/Email';
import UserService from './UserService';
import User from 'Model/Models/User';
import UpdateBy from '../Types/Database/UpdateBy';
import DeleteBy from '../Types/Database/DeleteBy';
import ObjectID from 'Common/Types/ObjectID';
import QueryHelper from '../Types/Database/QueryHelper';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
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

        return { createBy, carryForward: null };
    }

    private async refreshTokens(
        userId: ObjectID,
        projectId: ObjectID
    ): Promise<void> {
        /// Refresh tokens.
        await AccessTokenService.refreshUserGlobalAccessPermission(userId);

        await AccessTokenService.refreshUserProjectAccessPermission(
            userId,
            projectId
        );
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        await this.refreshTokens(
            onCreate.createBy.data.userId!,
            onCreate.createBy.data.projectId!
        );
        return createdItem;
    }

    protected override async onUpdateSuccess(
        onUpdate: OnUpdate<Model>,
        updatedItemIds: Array<ObjectID>
    ): Promise<OnUpdate<Model>> {
        const updateBy: UpdateBy<Model> = onUpdate.updateBy;
        const items: Array<Model> = await this.findBy({
            query: {
                _id: QueryHelper.in(updatedItemIds),
            },
            select: {
                userId: true,
                projectId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            populate: {},
            props: {
                isRoot: true,
            },
        });

        for (const item of items) {
            await this.refreshTokens(item.userId!, item.projectId!);
        }

        return { updateBy, carryForward: onUpdate.carryForward };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        const items: Array<Model> = await this.findBy({
            query: deleteBy.query,
            select: {
                userId: true,
                projectId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            populate: {},
            props: {
                isRoot: true,
            },
        });

        return {
            deleteBy: deleteBy,
            carryForward: items,
        };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>
    ): Promise<OnDelete<Model>> {
        for (const item of onDelete.carryForward as Array<Model>) {
            await this.refreshTokens(item.userId!, item.projectId!);
        }

        return onDelete;
    }
}
export default new Service();
