import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserNotificationSetting';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import PositiveNumber from 'Common/Types/PositiveNumber';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {
        // check if the same event for same user is added. 
        if(!createBy.data.projectId) {
           throw new BadDataException("ProjectId is required for UserNotificationSetting");
        }

        if(!createBy.data.userId) {
            throw new BadDataException("UserId is required for UserNotificationSetting");
        }

        if(!createBy.data.eventType) {
            throw new BadDataException("EventType is required for UserNotificationSetting");
        }

        const count: PositiveNumber = await this.countBy({
            query: {
                projectId: createBy.data.projectId,
                userId: createBy.data.userId,
                eventType: createBy.data.eventType,
            },
            props: {
                isRoot: true, 
            }
        })

        if(count.toNumber() > 0) {
            throw new BadDataException("Notification Setting of the same event type already exists for the user.");
        }

        return {
            createBy, 
            carryForward: undefined
        }
    }
}

export default new Service();
