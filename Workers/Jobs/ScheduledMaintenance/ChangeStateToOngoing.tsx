
import { EVERY_MINUTE } from '../../Utils/CronTime';
import ScheduledMaintenanceService from 'CommonServer/Services/ScheduledMaintenanceService';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import OneUptimeDate from 'Common/Types/Date';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateService from 'CommonServer/Services/ScheduledMaintenanceStateService';
import RunCron from '../../Utils/Cron';

RunCron("ScheduledMaintenance:ChangeStateToOngoing", EVERY_MINUTE, async () => {


    // get all scheduled events of all the projects.
    const events: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findBy({
            query: {
                currentScheduledMaintenanceState: {
                    isScheduledState: true,
                } as any,
                startsAt: QueryHelper.lessThan(
                    OneUptimeDate.getCurrentDate()
                ),
            },
            props: {
                isRoot: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            select: {
                _id: true,
                projectId: true,
                changeMonitorStatusToId: true,
            },
            populate: {
                monitors: {
                    _id: true,
                },
            },
        });

    // change their state to Ongoing.

    for (const event of events) {
        const scheduledMaintenanceState: ScheduledMaintenanceState | null =
            await ScheduledMaintenanceStateService.findOneBy({
                query: {
                    projectId: event.projectId!,
                    isOngoingState: true,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                },
            });

        if (!scheduledMaintenanceState || !scheduledMaintenanceState.id) {
            continue;
        }

        await ScheduledMaintenanceService.changeScheduledMaintenanceState(
            event.projectId!,
            event.id!,
            scheduledMaintenanceState.id,
            {
                isRoot: true,
            }
        );

        // change attached monitor states.
        await ScheduledMaintenanceService.changeAttachedMonitorStates(
            event,
            { isRoot: true }
        );
    }

});
