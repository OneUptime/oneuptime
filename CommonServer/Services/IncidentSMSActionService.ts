import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/IncidentSMSAction';
import DatabaseService from './DatabaseService';

class Service extends DatabaseService<Model> {
    public constructor() {
        super(Model);
    }
}
export default Service;
