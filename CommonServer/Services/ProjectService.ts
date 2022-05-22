import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/Project';
import DatabaseService from './DatabaseService';

class Service extends DatabaseService<Model> {
    public constructor() {
        super(Model);
    }
}
export default Service;
