import type PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/ApiKey';
import type { OnCreate } from './DatabaseService';
import DatabaseService from './DatabaseService';
import type CreateBy from '../Types/Database/CreateBy';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        createBy.data.apiKey = ObjectID.generate();
        return { createBy, carryForward: null };
    }
}

export default new Service();
