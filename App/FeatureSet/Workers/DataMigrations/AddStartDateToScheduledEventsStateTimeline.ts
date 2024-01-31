import DataMigrationBase from './DataMigrationBase';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Project from 'Model/Models/Project';
import ProjectService from 'CommonServer/Services/ProjectService';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenanceService from 'CommonServer/Services/ScheduledMaintenanceService';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import ScheduledMaintenanceStateTimelineService from 'CommonServer/Services/ScheduledMaintenanceStateTimelineService';

export default class AddStartDateToScheduledEventsStateTimeline extends DataMigrationBase {
    public constructor() {
        super('AddStartDateToScheduledEventsStateTimeline');
    }

    public override async migrate(): Promise<void> {
        // get all the users with email isVerified true.

        const projects: Array<Project> = await ProjectService.findBy({
            query: {},
            select: {
                _id: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
                isRoot: true,
            },
        });

        for (const project of projects) {
            // add ended scheduled maintenance state for each of these projects.
            // first fetch resolved state. Ended state order is -1 of resolved state.

            const scheduledEvents: Array<ScheduledMaintenance> =
                await ScheduledMaintenanceService.findBy({
                    query: {
                        projectId: project.id!,
                    },
                    select: {
                        _id: true,
                    },
                    skip: 0,
                    limit: LIMIT_MAX,
                    props: {
                        isRoot: true,
                    },
                });

            for (const scheduledEvent of scheduledEvents) {
                const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
                    await ScheduledMaintenanceStateTimelineService.findBy({
                        query: {
                            scheduledMaintenanceId: scheduledEvent.id!,
                            startsAt: QueryHelper.isNull(),
                        },
                        select: {
                            _id: true,
                            createdAt: true,
                        },
                        skip: 0,
                        limit: LIMIT_MAX,
                        props: {
                            isRoot: true,
                        },
                        sort: {
                            createdAt: SortOrder.Ascending,
                        },
                    });

                for (
                    let i: number = 0;
                    i < scheduledMaintenanceStateTimelines.length;
                    i++
                ) {
                    const statusTimeline:
                        | ScheduledMaintenanceStateTimeline
                        | undefined = scheduledMaintenanceStateTimelines[i];

                    await ScheduledMaintenanceStateTimelineService.updateOneById(
                        {
                            id: statusTimeline!.id!,
                            data: {
                                startsAt: statusTimeline!.createdAt!,
                            },
                            props: {
                                isRoot: true,
                            },
                        }
                    );
                }
            }
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
