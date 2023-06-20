import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserNotificationRule';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {
        if(!createBy.data.userCallId && !createBy.data.userCall && !createBy.data.userEmail && !createBy.data.userSms && !createBy.data.userSmsId && !createBy.data.userEmailId) { 
            throw new BadDataException('Call, SMS, or Email is required');
        }

        return {
            createBy, 
            carryForward: null
        }
    }
}
export default new Service();
