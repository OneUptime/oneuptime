import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Incident';
import DatabaseService, { OnCreate } from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import MonitorService from './MonitorService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import IncidentStateTimelineService from './IncidentStateTimelineService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IncidentState from 'Model/Models/IncidentState';
import IncidentStateService from './IncidentStateService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.props.tenantId) {
            throw new BadDataException(
                'ProjectId required to create incident.'
            );
        }

        const incidentState: IncidentState | null =
            await IncidentStateService.findOneBy({
                query: {
                    projectId: createBy.props.tenantId,
                    isCreatedState: true,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!incidentState || !incidentState.id) {
            throw new BadDataException(
                'Created incident state not found for this project. Please add created incident state from settings.'
            );
        }

        createBy.data.currentIncidentStateId = incidentState.id;

        return { createBy, carryForward: null };
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        if (!createdItem.projectId) {
            throw new BadDataException('projectId is required');
        }

        if (!createdItem.id) {
            throw new BadDataException('id is required');
        }

        if (!createdItem.currentIncidentStateId) {
            throw new BadDataException('currentIncidentStateId is required');
        }

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

        await this.changeIncidentState(
            createdItem.projectId,
            createdItem.id,
            createdItem.currentIncidentStateId,
            onCreate.createBy.props
        );

        return createdItem;
    }

    public async changeIncidentState(
        projectId: ObjectID,
        incidentId: ObjectID,
        incidentStateId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        const statusTimeline: IncidentStateTimeline =
            new IncidentStateTimeline();

        statusTimeline.incidentId = incidentId;
        statusTimeline.incidentStateId = incidentStateId;
        statusTimeline.projectId = projectId;

        await IncidentStateTimelineService.create({
            data: statusTimeline,
            props: props,
        });
    }
}
export default new Service();
