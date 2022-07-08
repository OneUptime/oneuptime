import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/Project';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/DB/CreateBy';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override onBeforeCreate(data: CreateBy<Model>): Promise<CreateBy<Model>> {

        if (data.userId) {
            data.data.createdByUserId = data.userId;
        } else {
            throw new NotAuthorizedException("User should be logged in to create the project.");
        }

        return Promise.resolve(data);
    }
}
export default new Service();
