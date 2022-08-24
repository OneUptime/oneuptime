import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Incident';
import DatabaseService, { OnCreate } from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import MonitorService from './MonitorService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import IncidentStateTimelineService from './IncidentStateTimelineService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        if (createdItem.changeMonitorStatusToId && createdItem.projectId) {
            // change status of all the monitors.
            await MonitorService.changeMonitorStatus(
                createdItem.projectId,
                createdItem.monitors?.map((monitor: Monitor) => {
                    return new ObjectID(monitor._id || '');
                }) || [],
                createdItem.changeMonitorStatusToId,
                onCreate.createBy.props
            );
        }

        return createdItem;
    }

    public async changeIncidentState(
        projectId: ObjectID,
        incidentId: ObjectID,
        incidentStateId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {

        const statusTimeline: IncidentStateTimeline = new IncidentStateTimeline();

        statusTimeline.incidentId = incidentId;
        statusTimeline.incidentStateId = incidentStateId;
        statusTimeline.projectId = projectId;

        await IncidentStateTimelineService.create({
            data: statusTimeline,
            props: props
        })
    }
}
export default new Service();
