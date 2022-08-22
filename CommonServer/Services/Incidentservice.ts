import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Incident';
import DatabaseService, { OnCreate } from './DatabaseService';
import MonitorService from './MonitorService';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        if (createdItem.changeMonitorStatusToId) {
            // change status of all the monitors.
            await MonitorService.changeMonitorStatus(
                createdItem.monitors?.map((monitor: Monitor) => {
                    return new ObjectID(monitor._id || '');
                }) || [],
                createdItem.changeMonitorStatusToId,
                onCreate.createBy.props
            );
        }

        return createdItem;
    }
}
export default new Service();
