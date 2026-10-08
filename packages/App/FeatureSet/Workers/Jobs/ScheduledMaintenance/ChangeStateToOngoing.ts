import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStartUtil from "Common/Utils/ScheduledMaintenanceStart";

/*
 * Starts every scheduled event whose start time has passed: moves it into
 * its project's ongoing state. The move does the rest, as any start does
 * (ScheduledMaintenanceStateTimelineService): it stops probing the event's
 * monitors and changes them to the event's Change Monitor Status to, read
 * as it is stored at that moment. That status can be changed until the
 * event starts, so it is not read here, up to a minute before.
 *
 * The ongoing state is the project's - the first from the top flagged
 * ongoing (ScheduledMaintenanceStartUtil.getOngoingState) - read once per
 * project on each run.
 */
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
          shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
        },
      });

    // change their state to Ongoing.

    const ongoingStateByProjectId: Map<
      string,
      ScheduledMaintenanceState | null
    > = new Map<string, ScheduledMaintenanceState | null>();

    for (const event of events) {
      const projectKey: string = event.projectId?.toString() || "";

      if (!ongoingStateByProjectId.has(projectKey)) {
        ongoingStateByProjectId.set(
          projectKey,
          ScheduledMaintenanceStartUtil.getOngoingState({
            states:
              await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates(
                {
                  projectId: event.projectId!,
                  props: {
                    isRoot: true,
                  },
                },
              ),
          }),
        );
      }

      const scheduledMaintenanceState: ScheduledMaintenanceState | null =
        ongoingStateByProjectId.get(projectKey) || null;

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
    }
  },
);
