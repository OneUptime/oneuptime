import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/IncomingCallRouting';
import DatabaseService from './DatabaseService';

export class Service extends DatabaseService<Model> {
    public constructor() {
        super(Model);
    }
}
export default new Service();
