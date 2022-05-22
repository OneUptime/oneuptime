import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/GlobalConfig';
import DatabaseService from './DatabaseService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model);
    }
}

export default new Service();
