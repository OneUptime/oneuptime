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
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';

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
                'Scheduled state not found for this project. Please add an scheduled evenmt state from settings.'
            );
        }

        createBy.data.currentScheduledMaintenanceStateId =
            scheduledMaintenanceState.id;

        return { createBy, carryForward: null };
    }

    protected override async onCreateSuccess(
        _onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        // create new scheduled maintenance state timeline.

        const timeline: ScheduledMaintenanceStateTimeline =
            new ScheduledMaintenanceStateTimeline();
        timeline.projectId = createdItem.projectId!;
        timeline.scheduledMaintenanceId = createdItem.id!;
        timeline.scheduledMaintenanceStateId =
            createdItem.currentScheduledMaintenanceStateId!;

        await ScheduledMaintenanceStateTimelineService.create({
            data: timeline,
            props: {
                isRoot: true,
            },
        });

        return createdItem;
    }

    public async changeAttachedMonitorStates(
        item: Model,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        if (!item.projectId) {
            throw new BadDataException('projectId is required');
        }

        if (!item.id) {
            throw new BadDataException('id is required');
        }

        if (item.changeMonitorStatusToId && item.projectId) {
            // change status of all the monitors.
            await MonitorService.changeMonitorStatus(
                item.projectId,
                item.monitors?.map((monitor: Monitor) => {
                    return new ObjectID(monitor._id || '');
                }) || [],
                item.changeMonitorStatusToId,
                props
            );
        }
    }

    public async changeScheduledMaintenanceState(
        projectId: ObjectID,
        scheduledMaintenanceId: ObjectID,
        scheduledMaintenanceStateId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        await this.updateBy({
            data: {
                currentScheduledMaintenanceStateId:
                    scheduledMaintenanceStateId.id,
            },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            query: {
                _id: scheduledMaintenanceId.toString()!,
            },
            props: {
                isRoot: true,
            },
        });

        const statusTimeline: ScheduledMaintenanceStateTimeline =
            new ScheduledMaintenanceStateTimeline();

        statusTimeline.scheduledMaintenanceId = scheduledMaintenanceId;
        statusTimeline.scheduledMaintenanceStateId =
            scheduledMaintenanceStateId;
        statusTimeline.projectId = projectId;

        await ScheduledMaintenanceStateTimelineService.create({
            data: statusTimeline,
            props: props,
        });
    }
}
export default new Service();
