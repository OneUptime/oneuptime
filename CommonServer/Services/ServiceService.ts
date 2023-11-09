import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Service';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import { OnCreate } from '../Types/Database/Hooks';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        createBy.data.serviceToken = ObjectID.generate();

        return {
            carryForward: null,
            createBy: createBy,
        };
    }
}

export default new Service();
