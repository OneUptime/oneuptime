import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService from './DatabaseService';
import MonitorProbe from 'Model/Models/MonitorProbe';

export class Service extends DatabaseService<MonitorProbe> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(MonitorProbe, postgresDatabase);
    }
}

export default new Service();
