import Model from 'Common/Models/ProjectSmtpConfig';
import DatabaseService from './DatabaseService';

class EmailSmtpService extends DatabaseService<Model> {
    public constructor() {
        super(Model);
    }
}

export default new EmailSmtpService();
