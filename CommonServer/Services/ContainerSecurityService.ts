import Model from 'Common/Models/ContainerSecurity';
import DatabaseService from './DatabaseService';

class Service extends DatabaseService {
    public constructor() {
        super(Model);
    }
}

export default new Service();
