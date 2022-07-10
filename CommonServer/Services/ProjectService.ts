import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/Project';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override onBeforeCreate(
        data: CreateBy<Model>
    ): Promise<CreateBy<Model>> {
        if (data.userId) {
            data.data.createdByUserId = data.userId;
        } else {
            throw new NotAuthorizedException(
                'User should be logged in to create the project.'
            );
        }

        return Promise.resolve(data);
    }

    protected override onCreateSuccess(
        createdItem: CreateBy<Model>
    ): Promise<CreateBy<Model>> {
        // add a team member.

        return Promise.resolve(createdItem);
    }
}
export default new Service();
