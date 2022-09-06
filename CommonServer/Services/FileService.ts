import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import File from 'Model/Models/File';
import DatabaseService from './DatabaseService';

export class Service extends DatabaseService<File> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(File, postgresDatabase);
    }
}
export default new Service();
