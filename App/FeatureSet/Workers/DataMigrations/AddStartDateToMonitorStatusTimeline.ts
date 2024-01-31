import DataMigrationBase from './DataMigrationBase';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Project from 'Model/Models/Project';
import ProjectService from 'CommonServer/Services/ProjectService';
import Monitor from 'Model/Models/Monitor';
import MonitorService from 'CommonServer/Services/MonitorService';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import MonitorStatusTimelineService from 'CommonServer/Services/MonitorStatusTimelineService';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';

export default class AddStartDateToMonitorStatusTimeline extends DataMigrationBase {
    public constructor() {
        super('AddStartDateToMonitorStatusTimeline');
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

            const monitors: Array<Monitor> = await MonitorService.findBy({
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

            for (const monitor of monitors) {
                const statusTimelines: Array<MonitorStatusTimeline> =
                    await MonitorStatusTimelineService.findBy({
                        query: {
                            monitorId: monitor.id!,
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

                for (let i: number = 0; i < statusTimelines.length; i++) {
                    const statusTimeline: MonitorStatusTimeline | undefined =
                        statusTimelines[i];

                    await MonitorStatusTimelineService.updateOneById({
                        id: statusTimeline!.id!,
                        data: {
                            startsAt: statusTimeline!.createdAt!,
                        },
                        props: {
                            isRoot: true,
                        },
                    });
                }
            }
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
