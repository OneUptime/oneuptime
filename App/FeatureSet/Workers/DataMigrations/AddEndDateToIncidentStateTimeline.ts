import DataMigrationBase from './DataMigrationBase';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Project from 'Model/Models/Project';
import ProjectService from 'CommonServer/Services/ProjectService';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import Incident from 'Model/Models/Incident';
import IncidentService from 'CommonServer/Services/IncidentService';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import IncidentStateTimelineService from 'CommonServer/Services/IncidentStateTimelineService';

export default class AddEndDateToIncidentStateTimeline extends DataMigrationBase {
    public constructor() {
        super('AddEndDateToIncidentStateTimeline');
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

            const incidents: Array<Incident> = await IncidentService.findBy({
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

            for (const incident of incidents) {
                const incidentStateTimelines: Array<IncidentStateTimeline> =
                    await IncidentStateTimelineService.findBy({
                        query: {
                            incidentId: incident.id!,
                            endsAt: QueryHelper.isNull(),
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
                    i < incidentStateTimelines.length;
                    i++
                ) {
                    const statusTimeline: IncidentStateTimeline | undefined =
                        incidentStateTimelines[i];

                    if (!statusTimeline) {
                        continue;
                    }

                    let endDate: Date | null = null;

                    if (
                        incidentStateTimelines[i + 1] &&
                        incidentStateTimelines[i + 1]?.createdAt
                    ) {
                        endDate = incidentStateTimelines[i + 1]!.createdAt!;
                    }

                    if (endDate) {
                        await IncidentStateTimelineService.updateOneById({
                            id: statusTimeline!.id!,
                            data: {
                                endsAt: endDate,
                            },
                            props: {
                                isRoot: true,
                            },
                        });
                    }
                }
            }
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
