import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";

/*
 * Ends every ongoing event whose end time has passed: moves it into its
 * project's ended state. The move does the rest, as any end does
 * (ScheduledMaintenanceStateTimelineService): it puts the monitors the
 * event holds back to operational and probes them again, reading them as
 * they are stored at that moment. So the job reads only what the move
 * needs - not the event's monitors, nor the status it changed them to.
 */
RunCron(
  "ScheduledMaintenance:ChangeStateToEnded",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const events: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findAllBy({
        query: {
          currentScheduledMaintenanceState: {
            isOngoingState: true,
          } as any,
          endsAt: QueryHelper.lessThan(OneUptimeDate.getCurrentDate()),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          projectId: true,
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
        },
      });

    // change their state to Ended.

    for (const event of events) {
      const scheduledMaintenanceState: ScheduledMaintenanceState | null =
        await ScheduledMaintenanceStateService.findOneBy({
          query: {
            projectId: event.projectId!,
            isEndedState: true,
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
          event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
        ),
        isSubscribersNotified: false,
        notifyOwners: true,
        props: {
          isRoot: true,
        },
      });
    }
  },
);
