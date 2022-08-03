import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/ApiKey';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<CreateBy<Model>> {
        createBy.data.apiKey = ObjectID.generate();
        return createBy;
    }
}

export default new Service();
