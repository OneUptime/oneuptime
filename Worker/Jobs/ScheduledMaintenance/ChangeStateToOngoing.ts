import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";

RunCron(
  "ScheduledMaintenance:ChangeStateToOngoing",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const events: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findAllBy({
        query: {
          currentScheduledMaintenanceState: {
            isScheduledState: true,
          } as any,
          startsAt: QueryHelper.lessThan(OneUptimeDate.getCurrentDate()),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          projectId: true,
          changeMonitorStatusToId: true,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
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

      await ScheduledMaintenanceService.changeScheduledMaintenanceState({
        projectId: event.projectId!,
        scheduledMaintenanceId: event.id!,
        scheduledMaintenanceStateId: scheduledMaintenanceState.id,
        shouldNotifyStatusPageSubscribers: Boolean(
          event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
        ),
        isSubscribersNotified: false,
        notifyOwners: true,
        props: {
          isRoot: true,
        },
      });

      // change attached monitor states.
      await ScheduledMaintenanceService.changeAttachedMonitorStates(event, {
        isRoot: true,
      });
    }
  },
);
