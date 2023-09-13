import DataMigrationBase from './DataMigrationBase';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Project from 'Model/Models/Project';
import ProjectService from 'CommonServer/Services/ProjectService';
import ScheduledMaintenanceStateService from 'CommonServer/Services/ScheduledMaintenanceStateService';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import Color from 'Common/Types/Color';

export default class AddEndedState extends DataMigrationBase {
    public constructor() {
        super('AddEndedState');
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

            const resolvedState: ScheduledMaintenanceState | null =
                await ScheduledMaintenanceStateService.findOneBy({
                    query: {
                        projectId: project.id!,
                        isResolvedState: true,
                    },
                    select: {
                        order: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (!resolvedState) {
                continue;
            }

            let endedState: ScheduledMaintenanceState | null =
                await ScheduledMaintenanceStateService.findOneBy({
                    query: {
                        projectId: project.id!,
                        isEndedState: true,
                    },
                    select: {
                        order: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (endedState) {
                continue;
            }

            endedState = await ScheduledMaintenanceStateService.findOneBy({
                query: {
                    projectId: project.id!,
                    name: 'Ended',
                },
                select: {
                    order: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (endedState) {
                continue;
            }

            endedState = new ScheduledMaintenanceState();
            endedState.projectId = project.id!;
            endedState.name = 'Ended';
            endedState.description =
                'Scheduled maintenance events switch to this state when they end.';
            endedState.order = resolvedState.order!;
            endedState.isEndedState = true;
            endedState.color = new Color('#4A4A4A');

            await ScheduledMaintenanceStateService.create({
                data: endedState,
                props: {
                    isRoot: true,
                },
            });
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
