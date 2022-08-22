import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Incident';
import DatabaseService, { OnCreate } from './DatabaseService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(onCreate: OnCreate<Model>, createdItem: Model): Promise<Model> {

        if (createdItem.changeMonitorStatusToId) {
            
        }

        return createdItem;
    }
}
export default new Service();
