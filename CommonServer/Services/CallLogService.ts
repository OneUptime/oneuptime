import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/CallLog';
import DatabaseService from './DatabaseService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
        this.hardDeleteItemsOlderThanInDays('createdAt', 30);
    }
}

export default new Service();
