import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/ScheduledMaintenance';
import DatabaseService, { OnCreate } from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import MonitorService from './MonitorService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import ScheduledMaintenanceStateTimelineService from './ScheduledMaintenanceStateTimelineService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateService from './ScheduledMaintenanceStateService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.props.tenantId) {
            throw new BadDataException('ProjectId required to create monitor.');
        }

        const scheduledMaintenanceState: ScheduledMaintenanceState | null =
            await ScheduledMaintenanceStateService.findOneBy({
                query: {
                    projectId: createBy.props.tenantId,
                    isScheduledState: true,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
            throw new BadDataException(
                'Created state not found for this project. Please add an operational status'
            );
        }

        createBy.data.currentScheduledMaintenanceStateId = scheduledMaintenanceState.id;

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

        if (!createdItem.currentScheduledMaintenanceStateId) {
            throw new BadDataException('currentScheduledMaintenanceStateId is required');
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

        await this.changeScheduledMaintenanceState(
            createdItem.projectId,
            createdItem.id,
            createdItem.currentScheduledMaintenanceStateId,
            onCreate.createBy.props
        );

        return createdItem;
    }

    public async changeScheduledMaintenanceState(
        projectId: ObjectID,
        scheduledMaintenanceId: ObjectID,
        scheduledMaintenanceStateId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        const statusTimeline: ScheduledMaintenanceStateTimeline =
            new ScheduledMaintenanceStateTimeline();

        statusTimeline.scheduledMaintenanceId = scheduledMaintenanceId;
        statusTimeline.scheduledMaintenanceStateId = scheduledMaintenanceStateId;
        statusTimeline.projectId = projectId;

        await ScheduledMaintenanceStateTimelineService.create({
            data: statusTimeline,
            props: props,
        });
    }
}
export default new Service();
