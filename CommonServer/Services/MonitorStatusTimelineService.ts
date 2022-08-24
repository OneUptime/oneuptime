import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/MonitorStatusTimeline';
import DatabaseService, { OnCreate } from './DatabaseService';
import MonitorService from './MonitorService';
import BadDataException from 'Common/Types/Exception/BadDataException';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(onCreate: OnCreate<Model>, createdItem: Model): Promise<Model> {


        if (!createdItem.monitorId) {
            throw new BadDataException("monitorId is null");
        }

        if (!createdItem.monitorStatusId) {
            throw new BadDataException("monitorStatusId is null");
        }

        await MonitorService.updateBy({
            query: {
                _id: createdItem.monitorId?.toString()
            },
            data: {
                currentMonitorStatusId: createdItem.monitorStatusId,
            },
            props: onCreate.createBy.props,
        });


        return createdItem;
    }
}

export default new Service();
